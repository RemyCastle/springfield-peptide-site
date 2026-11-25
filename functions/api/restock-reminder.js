/**
 * POST /api/restock-reminder { order_number, email, days }   days: 30 | 45 | 60 | 0 (= cancel)
 *
 * After ordering, the customer can ask for one "time to restock?" email. One row per order in
 * restock_reminders; the supplier-sync Worker's daily run sends it when due (with a one-tap
 * link that puts the same items back in the cart). Never sent unless the customer asks.
 */
import { json } from '../lib/auth.js';
import { proxyOrdersAdmin } from '../lib/ordersProxy.js';
import { ensureSyncSchema } from '../../workers/supplier-sync/src/schema.js';

const DAYS = new Set([30, 45, 60]);

/** Order items -> share-cart map { "PRODUCT NAME": { vial, pack } } (store.js cart format). */
function cartFromItems(items) {
  const map = {};
  for (const it of items || []) {
    const name = String(it.name || '').replace(/\s*\((vial|kit(?: \(10\))?)\)\s*$/i, '').trim();
    const qty = Math.max(0, Math.min(50, Number(it.qty) || 0));
    if (!name || !qty) continue;
    const kind = /-KIT$/i.test(String(it.sku || '')) || /\(kit/i.test(String(it.name || '')) ? 'pack' : 'vial';
    map[name] = map[name] || { vial: 0, pack: 0 };
    map[name][kind] += qty;
  }
  return map;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  const body = await request.json().catch(() => ({}));
  const orderNumber = String(body.order_number || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  const email = String(body.email || '').trim().toLowerCase();
  const days = Number(body.days);
  if (!orderNumber || !email || !(DAYS.has(days) || days === 0)) {
    return json({ error: 'bad_request', message: 'Pick 30, 45 or 60 days.' }, 400);
  }
  const notFound = () => json({ error: 'not_found', message: 'We could not match that order and email.' }, 404);
  const result = await proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(orderNumber)}`);
  if (result.status === 404) return notFound();
  if (!result.ok) return json({ error: 'unavailable', message: 'Please try again soon.' }, 502);
  const o = (result.data && result.data.order) || {};
  if (String(o.customer_email || '').trim().toLowerCase() !== email || o.partner_slug) return notFound();

  await ensureSyncSchema(env.DB);
  if (days === 0) {
    await env.DB.prepare('DELETE FROM restock_reminders WHERE order_number = ?').bind(orderNumber).run();
    return json({ ok: true, days: 0 });
  }
  const cart = cartFromItems((result.data && result.data.items) || []);
  await env.DB.prepare(
    `INSERT INTO restock_reminders (order_number, email, name, due_at, cart_json)
     VALUES (?, ?, ?, datetime('now', ?), ?)
     ON CONFLICT(order_number) DO UPDATE SET email = excluded.email, due_at = excluded.due_at, cart_json = excluded.cart_json, sent_at = NULL`
  )
    .bind(orderNumber, email, String(o.customer_name || '').slice(0, 120), `+${days} days`, JSON.stringify(cart))
    .run();
  return json({ ok: true, days });
}
