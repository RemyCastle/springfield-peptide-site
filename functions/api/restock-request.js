/**
 * POST /api/restock-request  { product, email }
 * "Email me when it's back" for a product the supplier sync hid as sold out.
 * The sync Worker emails everyone waiting once the product is for sale again.
 */
import { json } from '../lib/auth.js';
import { clientIp, overLimit } from '../lib/siteMail.js';
import { ensureSyncSchema } from '../../workers/supplier-sync/src/schema.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  // Each sign-up can lead to emails: cap it per connection so it cannot be used to spam.
  if (await overLimit(env.DB, `restock:${clientIp(request)}`, 20, 60)) {
    return json({ error: 'rate_limited', message: 'Too many sign-ups from this connection. Please try again later.' }, 429);
  }
  const body = await request.json().catch(() => ({}));
  const product = String(body.product || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  if (!product || !EMAIL_RE.test(email)) {
    return json({ error: 'validation_failed', message: 'Enter a valid email.' }, 400);
  }
  await ensureSyncSchema(env.DB);
  // Only for products the sync hid as sold out (not for things Remy took off the shop).
  const ok = await env.DB.prepare(
    `SELECT 1 FROM products p JOIN supplier_map m ON m.spbc_name = p.name AND m.skip = 0 AND m.hidden_by_sync = 1
     WHERE p.name = ? AND p.active = 0`
  )
    .bind(product)
    .first();
  if (!ok) return json({ error: 'not_waiting', message: 'That product is not waiting on a restock.' }, 400);
  const open = await env.DB.prepare('SELECT COUNT(*) AS n FROM restock_requests WHERE email = ? AND notified_at IS NULL')
    .bind(email)
    .first();
  if (open && open.n >= 20) return json({ error: 'too_many', message: 'You are already on many waiting lists.' }, 429);
  await env.DB.prepare(
    'INSERT INTO restock_requests (spbc_name, email) VALUES (?, ?) ON CONFLICT(spbc_name, email) DO UPDATE SET notified_at = NULL'
  )
    .bind(product, email)
    .run();
  return json({ ok: true, message: "We'll email you when it's back." });
}
