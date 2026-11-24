/**
 * POST /api/order-status  { order_number, email }
 * Public order lookup: status, tracking and items for one order, only when the email
 * matches the order. Reads the spbc-orders admin API server-side (token stays here) and
 * returns no address, phone or payment details.
 */
import { json } from '../lib/auth.js';
import { proxyOrdersAdmin } from '../lib/ordersProxy.js';

const STATUS_WORDS = {
  pending_payment: 'Waiting for payment',
  paid: 'Paid, being prepared',
  shipped: 'Shipped',
  complete: 'Delivered / complete',
  cancelled: 'Cancelled',
};

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const orderNumber = String(body.order_number || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  const email = String(body.email || '').trim().toLowerCase();
  if (!orderNumber || !email) {
    return json({ error: 'validation_failed', message: 'Enter your order number and email.' }, 400);
  }
  const notFound = () =>
    json({ error: 'not_found', message: "We couldn't find an order with that number and email." }, 404);

  const result = await proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(orderNumber)}`);
  if (result.status === 404) return notFound();
  if (!result.ok) return json({ error: 'unavailable', message: 'Order lookup is down. Please try again soon.' }, 502);
  const o = (result.data && result.data.order) || {};
  if (String(o.customer_email || '').trim().toLowerCase() !== email) return notFound();
  // Orders from other shops on the same order system are not shown here.
  if (o.partner_slug) return notFound();

  const items = ((result.data && result.data.items) || []).map((it) => ({
    name: String(it.name || ''),
    sku: String(it.sku || ''),
    qty: Number(it.qty) || 0,
    unit_price_cents: Number(it.unit_price_cents) || 0,
  }));
  return json({
    ok: true,
    order_number: o.order_number || orderNumber,
    status: o.status,
    status_text: STATUS_WORDS[o.status] || o.status,
    created_at: o.created_at || null,
    total_cents: o.total_cents ?? null,
    // For the printable receipt (no address or payment details).
    receipt: {
      customer_name: o.customer_name || '',
      subtotal_cents: o.subtotal_cents ?? null,
      shipping_cents: o.shipping_cents ?? null,
      paid_at: o.paid_at || null,
      paid_cents: o.paid_amount_cents ?? null,
    },
    can_cancel: o.status === 'pending_payment',
    tracking: o.tracking_number
      ? { number: o.tracking_number, carrier: o.tracking_carrier || null, url: o.tracking_url || null }
      : null,
    items,
  });
}
