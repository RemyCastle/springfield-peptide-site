/**
 * "Place at show-me-source" helper.
 * GET  /api/admin/supplier-orders?order=<n>  -> { placed, ready: { items, address, supplier_cost } }
 * GET  /api/admin/supplier-orders           -> { placed: { <order_number>: {...} } } (all, for badges)
 * POST /api/admin/supplier-orders  { order_number, placed: true|false, sms_ref?, sms_cost?, note? }
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';
import { buildPlacement, supplierNameMap } from '../../lib/supplierPlacement.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const orderNumber = (new URL(request.url).searchParams.get('order') || '').trim().toUpperCase();
  if (!orderNumber) {
    const { results } = await env.DB.prepare('SELECT * FROM supplier_orders ORDER BY placed_at DESC LIMIT 1000').all();
    return json({ placed: Object.fromEntries(results.map((r) => [r.order_number, r])) });
  }
  const placed = await env.DB.prepare('SELECT * FROM supplier_orders WHERE order_number = ?').bind(orderNumber).first();
  const res = await proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(orderNumber)}`);
  if (!res.ok) return json(res.data, res.status);
  return json({ placed, ready: buildPlacement(res.data, await supplierNameMap(env.DB)) });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const body = await request.json().catch(() => ({}));
  const orderNumber = String(body.order_number || '').trim().toUpperCase();
  if (!orderNumber) return json({ error: 'order_number required' }, 400);
  if (body.action === 'ship') {
    // Paid -> shipped with show-me-source's tracking. spbc-orders emails the customer.
    const number = String(body.tracking_number || '').trim().slice(0, 60);
    if (!/^[A-Za-z0-9]{8,40}$/.test(number)) {
      return json({ error: 'validation_failed', message: 'That tracking number does not look right.' }, 400);
    }
    const carrier = String(body.tracking_carrier || '').trim().slice(0, 30) || null;
    const url = String(body.tracking_url || '').trim();
    const res = await proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(orderNumber)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'shipped',
        tracking_number: number,
        tracking_carrier: carrier || undefined,
        tracking_url: /^https:\/\//.test(url) ? url : undefined,
        note: body.sms_ref ? `Tracking from show-me-source ${String(body.sms_ref).slice(0, 20)}` : 'Tracking from show-me-source',
      }),
    });
    if (!res.ok) return json(res.data, res.status);
    return json({ ok: true, message: `${orderNumber} marked shipped. The customer gets the tracking email.` });
  }
  if (body.placed === false) {
    await env.DB.prepare('DELETE FROM supplier_orders WHERE order_number = ?').bind(orderNumber).run();
    return json({ ok: true, message: 'Marked as not placed' });
  }
  const costRaw = body.sms_cost;
  const cost = costRaw === '' || costRaw == null ? null : Number(costRaw);
  if (cost != null && (!Number.isFinite(cost) || cost < 0 || cost > 100000)) {
    return json({ error: 'validation_failed', message: 'What you paid show-me-source must be a dollar amount.' }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO supplier_orders (order_number, sms_ref, note, sms_cost) VALUES (?, ?, ?, ?) ON CONFLICT(order_number) DO UPDATE SET sms_ref = COALESCE(excluded.sms_ref, supplier_orders.sms_ref), note = COALESCE(excluded.note, supplier_orders.note), sms_cost = COALESCE(excluded.sms_cost, supplier_orders.sms_cost)"
  )
    .bind(
      orderNumber,
      String(body.sms_ref || '').slice(0, 80) || null,
      String(body.note || '').slice(0, 500) || null,
      cost == null ? null : Math.round(cost * 100) / 100
    )
    .run();
  return json({ ok: true, message: 'Marked as placed at show-me-source' });
}
