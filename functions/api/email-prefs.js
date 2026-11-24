/**
 * POST /api/email-prefs { token }                         -> current choices
 * POST /api/email-prefs { token, price_alerts, reviews, news } -> save (true = keep getting them)
 * POST /api/email-prefs { token, all_off: true }          -> one-click unsubscribe from everything optional
 * Order emails (receipt, payment, tracking) are not optional and are not affected.
 */
import { json } from '../lib/auth.js';
import { ensureSyncSchema } from '../../workers/supplier-sync/src/schema.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  await ensureSyncSchema(env.DB);
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (!/^[a-f0-9]{32}$/.test(token)) return json({ error: 'bad_link', message: 'This link is not valid.' }, 400);
  const row = await env.DB.prepare('SELECT * FROM email_prefs WHERE token = ?').bind(token).first();
  if (!row) return json({ error: 'bad_link', message: 'This link is not valid.' }, 404);
  const masked = row.email.replace(/^(.)[^@]*(@.*)$/, '$1•••$2');
  const view = (r) => ({ ok: true, email: masked, price_alerts: !r.no_price_alerts, reviews: !r.no_reviews, news: !r.no_news });

  if (body.all_off === true || 'price_alerts' in body || 'reviews' in body || 'news' in body) {
    const off = (k) => (body.all_off === true ? 1 : body[k] === false ? 1 : body[k] === true ? 0 : row[`no_${k}`]);
    const next = { no_price_alerts: off('price_alerts'), no_reviews: off('reviews'), no_news: off('news') };
    await env.DB.prepare("UPDATE email_prefs SET no_price_alerts = ?, no_reviews = ?, no_news = ?, updated_at = datetime('now') WHERE token = ?")
      .bind(next.no_price_alerts, next.no_reviews, next.no_news, token)
      .run();
    if (next.no_price_alerts) await env.DB.prepare('DELETE FROM price_watch WHERE email = ?').bind(row.email).run();
    return json({ ...view(next), message: 'Saved.' });
  }
  return json(view(row));
}
