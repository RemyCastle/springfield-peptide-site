/**
 * Email from the website itself (Pages functions): same Resend sender as the sync Worker.
 * Needs RESEND_API_KEY as a Pages secret; RESTOCK_FROM defaults to orders@springfieldpbc.com.
 */
import { sendEmail } from '../../workers/supplier-sync/src/email.js';
import { sha256Hex } from '../../workers/supplier-sync/src/customers.js';

export function siteMailReady(env) {
  return !!env.RESEND_API_KEY;
}

export function siteMail(env, msg) {
  return sendEmail({ ...env, RESTOCK_FROM: env.RESTOCK_FROM || 'SPBC <orders@springfieldpbc.com>' }, msg);
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

/** Small per-key rate limit kept in D1 (rate_hits). Returns true when over the limit. */
export async function overLimit(db, rawKey, max, minutes) {
  const key = (await sha256Hex(rawKey)).slice(0, 32); // no raw IPs or emails stored
  await db
    .prepare("CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))")
    .run();
  const since = `-${minutes} minutes`;
  const row = await db.prepare("SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND at > datetime('now', ?)").bind(key, since).first();
  if (row && row.n >= max) return true;
  await db.prepare('INSERT INTO rate_hits (key) VALUES (?)').bind(key).run();
  await db.prepare("DELETE FROM rate_hits WHERE at < datetime('now', '-1 day')").run();
  return false;
}
