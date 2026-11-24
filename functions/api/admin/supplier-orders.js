/**
 * "Place at show-me-source" helper.
 * GET  /api/admin/supplier-orders?order=<n>  -> { placed, ready: { items, address, supplier_cost } }
 * GET  /api/admin/supplier-orders           -> { placed: { <order_number>: {...} } } (all, for badges)
 * POST /api/admin/supplier-orders  { order_number, placed: true|false, sms_ref?, note? }
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';
import { ensureSyncSchema, supplierUnitCost } from '../../../workers/supplier-sync/src/schema.js';

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
  const o = res.data.order || {};
  // Supplier names for each SPBC line (what to pick on show-me-source).
  const map = (await env.DB.prepare('SELECT supplier_name, spbc_name FROM supplier_map WHERE skip = 0').all()).results;
  const bySpbc = new Map(map.map((m) => [m.spbc_name, m.supplier_name]));
  let cost = 0;
  const items = (res.data.items || []).map((it) => {
    const isVial = /\(\s*Vial\s*\)\s*$/i.test(it.name || '') || /-VIAL$/i.test(it.sku || '');
    const spbcName = String(it.name || '').replace(/\s+\((?:10-Pack \/ Kit|Kit|Vial)\)\s*$/i, '').trim();
    const unitCost = supplierUnitCost(it);
    cost += unitCost * (Number(it.qty) || 0);
    return {
      spbc_name: spbcName,
      supplier_name: bySpbc.get(spbcName) || null,
      kind: isVial ? 'vial' : 'kit',
      qty: Number(it.qty) || 0,
      supplier_unit_cost: unitCost,
    };
  });
  return json({
    placed,
    ready: {
      order_number: o.order_number,
      status: o.status,
      items,
      supplier_cost: Math.round(cost * 100) / 100,
      customer_paid_cents: o.total_cents,
      address: {
        name: o.ship_name || o.customer_name || '',
        line1: o.ship_line1 || '',
        line2: o.ship_line2 || '',
        city: o.ship_city || '',
        state: o.ship_state || '',
        postal: o.ship_postal || '',
        phone: o.ship_phone || '',
      },
    },
  });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const body = await request.json().catch(() => ({}));
  const orderNumber = String(body.order_number || '').trim().toUpperCase();
  if (!orderNumber) return json({ error: 'order_number required' }, 400);
  if (body.placed === false) {
    await env.DB.prepare('DELETE FROM supplier_orders WHERE order_number = ?').bind(orderNumber).run();
    return json({ ok: true, message: 'Marked as not placed' });
  }
  await env.DB.prepare(
    "INSERT INTO supplier_orders (order_number, sms_ref, note) VALUES (?, ?, ?) ON CONFLICT(order_number) DO UPDATE SET sms_ref = excluded.sms_ref, note = excluded.note, placed_at = datetime('now')"
  )
    .bind(orderNumber, String(body.sms_ref || '').slice(0, 80) || null, String(body.note || '').slice(0, 500) || null)
    .run();
  return json({ ok: true, message: 'Marked as placed at show-me-source' });
}
