/**
 * Customer-facing extras shared by the sync Worker (cron jobs) and the site (Pages functions):
 * email preferences, review requests, and the personal-data clean-up.
 */
import { getSettings } from './schema.js';
import { sendEmail, emailReady, esc, siteUrl, wrap } from './email.js';
import { listOrders } from './orders.js';

export function randomToken(bytes = 24) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The private "email preferences" token for an address (made on first use). */
export async function prefsToken(db, email) {
  const e = String(email || '').trim().toLowerCase();
  await db.prepare('INSERT OR IGNORE INTO email_prefs (email, token) VALUES (?, ?)').bind(e, randomToken(16)).run();
  const row = await db.prepare('SELECT token FROM email_prefs WHERE email = ?').bind(e).first();
  return row ? row.token : '';
}

/** kind: 'price_alerts' | 'reviews' | 'news' */
export async function wantsEmail(db, email, kind) {
  const row = await db.prepare('SELECT * FROM email_prefs WHERE email = ?').bind(String(email || '').trim().toLowerCase()).first();
  if (!row) return true;
  return !row[`no_${kind}`];
}

export async function prefsFooter(db, env, email, why) {
  const t = await prefsToken(db, email);
  const url = `${siteUrl(env)}/email-preferences.html#t=${t}`;
  return {
    url,
    html: `<p style="font-size:12px;color:#666">${esc(why)} <a href="${url}" style="color:#666">Email preferences / unsubscribe</a></p>`,
  };
}

/**
 * Review requests: review_days after an order shipped, email the buyer once asking for a
 * short review (only when reviews_on = '1' and they haven't turned review emails off).
 */
export async function reviewRequests(env, db) {
  const s = await getSettings(db);
  if (s.reviews_on !== '1') return { skipped: 'off' };
  if (!emailReady(env)) return { skipped: 'email not configured' };
  const days = Math.max(1, Number(s.review_days) || 10);
  const cutoff = Date.now() - days * 86400000;
  const tooOld = Date.now() - (days + 30) * 86400000; // never ask about very old orders
  const orders = [...(await listOrders(env, { status: 'shipped', max: 200 })), ...(await listOrders(env, { status: 'complete', max: 200 }))];
  const asked = new Set((await db.prepare('SELECT order_number FROM review_requests').all()).results.map((r) => r.order_number));
  let sent = 0;
  for (const o of orders) {
    if (sent >= 20) break;
    if (asked.has(o.order_number) || o.partner_slug) continue;
    const email = String(o.customer_email || '').toLowerCase();
    if (!email.includes('@') || email.endsWith('@springfieldpbc.com')) continue;
    const shipped = new Date(o.shipped_at || o.updated_at || o.created_at || 0).getTime();
    if (!shipped || shipped > cutoff || shipped < tooOld) continue;
    if (!(await wantsEmail(db, email, 'reviews'))) continue;
    const token = randomToken(16);
    await db
      .prepare('INSERT OR IGNORE INTO review_requests (order_number, email, name, token) VALUES (?, ?, ?, ?)')
      .bind(o.order_number, email, String(o.customer_name || '').slice(0, 120), token)
      .run();
    const first = String(o.customer_name || '').trim().split(/\s+/)[0] || 'there';
    const link = `${siteUrl(env)}/review.html#t=${token}`;
    const foot = await prefsFooter(db, env, email, 'You ordered from SPBC.');
    const ok = await sendEmail(env, {
      to: email,
      subject: 'How was your SPBC order?',
      html: wrap(`<p>Hi ${esc(first)},</p><p>How did order <strong>${esc(o.order_number)}</strong> go? A one-minute review helps other club members.</p>
<p><a href="${link}" style="display:inline-block;background:#F3D94A;color:#13301F;font-weight:bold;padding:10px 18px;border-radius:10px;text-decoration:none">Leave a quick review</a></p>
<p>If anything was wrong, just reply to this email and we'll make it right.</p>${foot.html}`),
      headers: { 'List-Unsubscribe': `<${foot.url}>` },
    });
    if (ok) {
      await db.prepare("UPDATE review_requests SET sent_at = datetime('now') WHERE order_number = ?").bind(o.order_number).run();
      sent += 1;
    }
  }
  return { sent };
}

/**
 * Personal-data clean-up (cleanup_months > 0). Removes old contact messages, sign-in links,
 * review requests, message logs, checkout reports, finished restock sign-ups and price alerts
 * nobody used. Payment/supplier emails (Money tab) and orders are kept as business records.
 */
export async function cleanupOldData(db) {
  const s = await getSettings(db);
  const months = Math.round(Number(s.cleanup_months) || 0);
  if (months < 1) return { skipped: 'off' };
  const age = `-${months} months`;
  const run = (sql) => db.prepare(sql).bind(age).run().then((r) => r.meta?.changes || 0).catch(() => 0);
  const out = {
    contact_messages: await run("DELETE FROM contact_messages WHERE created_at < datetime('now', ?)"),
    review_requests: await run("DELETE FROM review_requests WHERE created_at < datetime('now', ?)"),
    customer_messages: await run("DELETE FROM customer_messages WHERE created_at < datetime('now', ?)"),
    client_reports: await run("DELETE FROM client_reports WHERE created_at < datetime('now', ?)"),
    restock_requests: await run("DELETE FROM restock_requests WHERE notified_at IS NOT NULL AND notified_at < datetime('now', ?)"),
    price_watch: await run("DELETE FROM price_watch WHERE created_at < datetime('now', ?)"),
  };
  out.login_links = await db.prepare("DELETE FROM login_links WHERE expires_at < datetime('now', '-1 day')").run().then((r) => r.meta?.changes || 0).catch(() => 0);
  return out;
}
