/**
 * Payments the orders service could not apply by itself (no code, wrong amount, a customer's
 * "I've paid" claim...).
 * GET  /api/admin/receipts
 * POST /api/admin/receipts { action: 'confirm', id, order_number } | { action: 'dismiss', id }
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const r = await proxyOrdersAdmin(env, '/admin/receipts?status=pending');
  return json(r.ok ? r.data : { error: 'unavailable', message: 'Could not load payments to check.' }, r.ok ? 200 : 502);
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'bad_id' }, 400);
  const action = String(b.action || '');
  if (action !== 'confirm' && action !== 'dismiss') return json({ error: 'bad_action' }, 400);
  const order = String(b.order_number || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const r = await proxyOrdersAdmin(env, `/admin/receipts/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify(action === 'confirm' && order ? { order_number: order } : {}),
  });
  return json(r.data || {}, r.status || 502);
}
