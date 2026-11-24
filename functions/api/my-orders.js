/**
 * POST /api/my-orders
 *   { action: 'link', email }  -> emails a sign-in link (works 30 minutes). Always answers
 *                                  the same way, so it never tells anyone whether an email has orders.
 *   { action: 'list', token }  -> that email's orders (newest 15, items and tracking; no address).
 * Only a hash of the token is stored.
 */
import { json } from '../lib/auth.js';
import { proxyOrdersAdmin } from '../lib/ordersProxy.js';
import { ensureSyncSchema } from '../../workers/supplier-sync/src/schema.js';
import { randomToken, sha256Hex } from '../../workers/supplier-sync/src/customers.js';
import { esc, wrap, siteUrl } from '../../workers/supplier-sync/src/email.js';
import { siteMail, siteMailReady, clientIp, overLimit } from '../lib/siteMail.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const STATUS_WORDS = {
  pending_payment: 'Waiting for payment',
  paid: 'Paid, being prepared',
  shipped: 'Shipped',
  complete: 'Delivered / complete',
  cancelled: 'Cancelled',
};
const SENT = { ok: true, message: 'If we have orders for that email, a sign-in link is on its way. It works for 30 minutes.' };

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  await ensureSyncSchema(env.DB);
  const body = await request.json().catch(() => ({}));

  if (body.action === 'link') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: 'validation_failed', message: 'Enter the email you ordered with.' }, 400);
    const ip = clientIp(request);
    if ((await overLimit(env.DB, `mylink-ip:${ip}`, 6, 60)) || (await overLimit(env.DB, `mylink:${email}`, 3, 60))) {
      return json({ error: 'too_many', message: 'Too many tries. Please wait an hour and try again.' }, 429);
    }
    if (!siteMailReady(env)) return json({ error: 'unavailable', message: 'Sign-in links are not available yet. Use Track order with your order number.' }, 503);
    const r = await proxyOrdersAdmin(env, `/admin/orders?q=${encodeURIComponent(email)}&limit=5`);
    const has = r.ok && (r.data.orders || []).some((o) => String(o.customer_email || '').toLowerCase() === email && !o.partner_slug);
    if (!has) return json(SENT);
    const token = randomToken(24);
    await env.DB.prepare("INSERT INTO login_links (token_hash, email, expires_at) VALUES (?, ?, datetime('now', '+30 minutes'))")
      .bind(await sha256Hex(token), email)
      .run();
    const link = `${siteUrl(env)}/my-orders.html#t=${token}`;
    await siteMail(env, {
      to: email,
      subject: 'Your SPBC orders',
      html: wrap(`<p>Here is your link to see your SPBC orders. It works for 30 minutes.</p>
<p><a href="${link}" style="display:inline-block;background:#F3D94A;color:#13301F;font-weight:bold;padding:10px 18px;border-radius:10px;text-decoration:none">See my orders</a></p>
<p style="font-size:12px;color:#666">You (or someone typing your email) asked for this on springfieldpbc.com. If it wasn't you, ignore it.</p>`),
    }).catch(() => false);
    return json(SENT);
  }

  if (body.action === 'list') {
    const token = String(body.token || '').trim();
    if (!/^[a-f0-9]{48}$/.test(token)) return json({ error: 'bad_link', message: 'This link is not valid. Ask for a new one.' }, 400);
    const row = await env.DB.prepare("SELECT email FROM login_links WHERE token_hash = ? AND expires_at > datetime('now')")
      .bind(await sha256Hex(token))
      .first();
    if (!row) return json({ error: 'expired', message: 'This link has expired. Ask for a new one below.' }, 401);
    const email = row.email;
    const r = await proxyOrdersAdmin(env, `/admin/orders?q=${encodeURIComponent(email)}&limit=50`);
    if (!r.ok) return json({ error: 'unavailable', message: 'Orders are not available right now. Please try again soon.' }, 502);
    const mine = (r.data.orders || [])
      .filter((o) => String(o.customer_email || '').toLowerCase() === email && !o.partner_slug)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 15);
    const orders = [];
    for (const o of mine) {
      const d = await proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(o.order_number)}`);
      const full = (d.ok && d.data.order) || o;
      orders.push({
        order_number: o.order_number,
        status: full.status,
        status_text: STATUS_WORDS[full.status] || full.status,
        created_at: full.created_at,
        total_cents: full.total_cents,
        tracking: full.tracking_number ? { number: full.tracking_number, carrier: full.tracking_carrier || null, url: full.tracking_url || null } : null,
        items: ((d.ok && d.data.items) || []).map((it) => ({ name: String(it.name || ''), sku: String(it.sku || ''), qty: Number(it.qty) || 0 })),
      });
    }
    return json({ ok: true, email, orders });
  }

  return json({ error: 'bad_action' }, 400);
}
