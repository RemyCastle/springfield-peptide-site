/**
 * Reviews from real buyers.
 * POST /api/review { action: 'get', token }                       -> order number + products to review
 * POST /api/review { action: 'save', token, rating, body, display_name }
 * GET  /api/review                                                 -> approved reviews for the shop
 * A review is tied to one order through the emailed link; Remy approves it before it shows.
 */
import { json } from '../lib/auth.js';
import { ensureSyncSchema, getSetting } from '../../workers/supplier-sync/src/schema.js';
import { proxyOrdersAdmin } from '../lib/ordersProxy.js';
import { esc, wrap, siteUrl } from '../../workers/supplier-sync/src/email.js';
import { siteMail, siteMailReady } from '../lib/siteMail.js';

function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Club member';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

async function products(env, orderNumber) {
  const r = await proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(orderNumber)}`);
  const items = (r.ok && r.data.items) || [];
  return [...new Set(items.filter((i) => i.sku !== 'SALES-TAX').map((i) => String(i.name || '').replace(/\s+\((?:10-Pack \/ Kit|Kit|Vial)\)\s*$/i, '').trim()))].filter(Boolean);
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ reviews: [] });
  try {
    const { results } = await env.DB.prepare(
      "SELECT display_name, rating, body, products, created_at FROM reviews WHERE status = 'approved' ORDER BY id DESC LIMIT 30"
    ).all();
    const n = results.length;
    const avg = n ? Math.round((results.reduce((s, r) => s + r.rating, 0) / n) * 10) / 10 : null;
    return new Response(JSON.stringify({ reviews: results, count: n, average: avg }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return json({ reviews: [] });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  await ensureSyncSchema(env.DB);
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!/^[a-f0-9]{32}$/.test(token)) return json({ error: 'bad_link', message: 'This review link is not valid.' }, 400);
  const req = await env.DB.prepare('SELECT * FROM review_requests WHERE token = ?').bind(token).first();
  if (!req) return json({ error: 'bad_link', message: 'This review link is not valid.' }, 404);
  const existing = await env.DB.prepare('SELECT id FROM reviews WHERE order_number = ?').bind(req.order_number).first();

  if (body.action === 'get') {
    return json({ ok: true, order_number: req.order_number, name: shortName(req.name), products: await products(env, req.order_number), done: !!existing });
  }

  if (body.action === 'save') {
    if (existing) return json({ error: 'done', message: 'Thanks, we already have your review for this order.' }, 409);
    const rating = parseInt(body.rating, 10);
    if (!(rating >= 1 && rating <= 5)) return json({ error: 'validation_failed', message: 'Pick 1 to 5 stars.' }, 400);
    const text = String(body.body || '').replace(/[<>]/g, '').trim().slice(0, 1000);
    const display = String(body.display_name || '').replace(/[<>]/g, '').trim().slice(0, 40) || shortName(req.name);
    const prods = (await products(env, req.order_number)).join(', ').slice(0, 300);
    await env.DB.prepare('INSERT INTO reviews (order_number, display_name, rating, body, products) VALUES (?, ?, ?, ?, ?)')
      .bind(req.order_number, display, rating, text, prods)
      .run();
    const to = await getSetting(env.DB, 'digest_to', '');
    if (to && siteMailReady(env)) {
      await siteMail(env, {
        to,
        subject: `New SPBC review (${rating}★) waiting for approval`,
        html: wrap(`<p><strong>${'★'.repeat(rating)}</strong> from ${esc(display)} (order ${esc(req.order_number)})</p><p>${esc(text)}</p>
<p><a href="${siteUrl(env)}/admin">Approve or hide it in the admin</a></p>`),
      }).catch(() => false);
    }
    return json({ ok: true, message: rating >= 4 ? 'Thank you! Your review will show on the shop soon.' : "Thank you for telling us. We'll reach out to make it right." });
  }

  return json({ error: 'bad_action' }, 400);
}
