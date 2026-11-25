/**
 * POST /api/price-watch  { product, email }
 * "Tell me if the price drops". The sync Worker emails followers when a price goes down.
 * Only while the admin switch "Price-drop alerts" is on.
 */
import { json } from '../lib/auth.js';
import { clientIp, overLimit } from '../lib/siteMail.js';
import { ensureSyncSchema, getSetting } from '../../workers/supplier-sync/src/schema.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  // Each sign-up can lead to emails: cap it per connection so it cannot be used to spam.
  if (await overLimit(env.DB, `watch:${clientIp(request)}`, 20, 60)) {
    return json({ error: 'rate_limited', message: 'Too many sign-ups from this connection. Please try again later.' }, 429);
  }
  const body = await request.json().catch(() => ({}));
  const product = String(body.product || '').trim().slice(0, 200);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  if (!product || !EMAIL_RE.test(email)) return json({ error: 'validation_failed', message: 'Enter a valid email.' }, 400);
  await ensureSyncSchema(env.DB);
  if ((await getSetting(env.DB, 'price_alerts_on', '0')) !== '1') {
    return json({ error: 'off', message: 'Price alerts are not available right now.' }, 400);
  }
  const exists = await env.DB.prepare('SELECT 1 FROM products WHERE name = ? AND active = 1').bind(product).first();
  if (!exists) return json({ error: 'unknown_product', message: 'That product is not on the price list.' }, 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM price_watch WHERE email = ?').bind(email).first();
  if (n && n.n >= 30) return json({ error: 'too_many', message: 'You are already following many products.' }, 429);
  await env.DB.prepare('INSERT OR IGNORE INTO price_watch (spbc_name, email) VALUES (?, ?)').bind(product, email).run();
  return json({ ok: true, message: "We'll email you if the price drops." });
}
