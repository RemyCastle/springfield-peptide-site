/**
 * POST /api/admin/quick-order
 * Remy makes a real SPBC order for a customer who ordered by text/Venmo, then sends them the
 * pay link (Venmo note pre-filled with the order code) and the shipping-address link.
 * Same prices and rules as the website (lib/createOrder.js).
 *
 * Body: { name, email?, items: [{ product, kind: 'vial'|'kit', qty }], shipping?, notes? }
 * No email: the order uses a non-delivering address on springfieldpbc.com and Remy sends the
 * links himself (the customer then gets no automatic emails).
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { createOrder } from '../../lib/createOrder.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 120);
  let email = String(body.email || '').trim().toLowerCase();
  const noEmail = !email;
  if (!name) return json({ error: 'validation_failed', message: "Enter the customer's name." }, 400);
  if (email && !EMAIL_RE.test(email)) return json({ error: 'validation_failed', message: 'That email does not look right.' }, 400);
  if (noEmail) email = `noemail+${crypto.randomUUID().slice(0, 8)}@springfieldpbc.com`;

  const lines = (Array.isArray(body.items) ? body.items : [])
    .map((it) => ({
      product: String(it.product || '').trim(),
      kind: it.kind === 'vial' ? 'vial' : 'kit',
      qty: parseInt(it.qty, 10) || 0,
    }))
    .filter((it) => it.product && it.qty > 0);
  if (!lines.length) return json({ error: 'validation_failed', message: 'Add at least one item.' }, 400);

  const result = await createOrder(env, {
    name,
    email,
    items: lines.map((l) => ({ name: `${l.product} (${l.kind === 'vial' ? 'Vial' : '10-Pack / Kit'})`, qty: l.qty })),
    shipping: body.shipping,
    notes: ['Quick order made in the admin', body.notes ? String(body.notes) : ''].filter(Boolean).join(' · '),
  });
  if (result.status !== 200) return json(result.body, result.status);

  const o = result.body;
  const first = name.split(/\s+/)[0];
  const itemsText = lines.map((l) => `${l.qty} × ${l.product} ${l.kind === 'vial' ? 'vial' : 'kit'}`).join(', ');
  const total = `$${(Number(o.total_cents) / 100).toFixed(2)}`;
  const message = [
    `Hi ${first}! Your SPBC order ${o.order_number}: ${itemsText}. Total ${total}${o.shipping_cents ? ` (includes $${(o.shipping_cents / 100).toFixed(2)} shipping)` : ' (free shipping)'}.`,
    `Pay here (the order code is filled in for you): ${o.pay_url}`,
    o.shipping_saved ? '' : `Then add your shipping address: ${o.shipping_url}`,
  ]
    .filter(Boolean)
    .join('\n');
  return json({ ...o, no_email: noEmail, message });
}
