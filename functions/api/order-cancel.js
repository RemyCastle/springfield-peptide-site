/**
 * POST /api/order-cancel  { order_number, email }
 * A customer cancels their own order from the Track page, only while it is still waiting for
 * payment and only when the email matches the order.
 */
import { json } from '../lib/auth.js';
import { proxyOrdersAdmin } from '../lib/ordersProxy.js';
import { clientIp, overLimit } from '../lib/siteMail.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const orderNumber = String(body.order_number || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  const email = String(body.email || '').trim().toLowerCase();
  if (!orderNumber || !email) return json({ error: 'validation_failed', message: 'Enter your order number and email.' }, 400);
  if (env.DB && (await overLimit(env.DB, `cancel:${clientIp(request)}`, 10, 60))) {
    return json({ error: 'too_many', message: 'Too many tries. Please wait a bit.' }, 429);
  }
  const path = `/admin/orders/${encodeURIComponent(orderNumber)}`;
  const r = await proxyOrdersAdmin(env, path);
  const o = (r.ok && r.data && r.data.order) || null;
  if (!o || String(o.customer_email || '').trim().toLowerCase() !== email || o.partner_slug) {
    return json({ error: 'not_found', message: "We couldn't find an order with that number and email." }, 404);
  }
  if (o.status !== 'pending_payment') {
    return json({ error: 'cannot_cancel', message: 'This order is already paid or closed, so it cannot be cancelled here. Contact us instead.' }, 409);
  }
  const p = await proxyOrdersAdmin(env, path, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled', note: 'Cancelled by the customer on the Track page' }),
  });
  if (!p.ok) return json({ error: 'failed', message: 'Could not cancel right now. Please contact us.' }, 502);
  return json({ ok: true, message: `Order ${orderNumber} is cancelled. Nothing is owed.` });
}
