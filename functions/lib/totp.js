/**
 * Two-step admin login: standard 6-digit authenticator codes (TOTP, RFC 6238, SHA-1, 30 s),
 * the kind Google Authenticator, Microsoft Authenticator, 1Password and Authy all read.
 * The secret lives in D1 table admin_security, never in site_settings (that one is sent to
 * the admin page as "automation").
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export function base32Bytes(s) {
  let bits = '';
  for (const c of String(s).replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

export async function hotp(keyBytes, counter, digits = 6) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 2 ** 32));
  dv.setUint32(4, counter >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Returns the matching time step (for replay protection) or null. Allows one step of clock drift. */
export async function matchTotp(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const key = base32Bytes(secret);
  const t = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) if ((await hotp(key, t + d)) === c) return t + d;
  return null;
}

export function otpauthUrl(secret, account = 'remy') {
  return `otpauth://totp/${encodeURIComponent('SPBC admin')}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent('SPBC admin')}&digits=6&period=30`;
}

async function ensureTable(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS admin_security (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    .run();
}

export async function securityGet(db) {
  await ensureTable(db);
  const { results } = await db.prepare('SELECT key, value FROM admin_security').all();
  return Object.fromEntries((results || []).map((r) => [r.key, r.value]));
}

export async function securitySet(db, values) {
  await ensureTable(db);
  await db.batch(
    Object.entries(values).map(([k, v]) =>
      v == null
        ? db.prepare('DELETE FROM admin_security WHERE key = ?').bind(k)
        : db
            .prepare(
              "INSERT INTO admin_security (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
            )
            .bind(k, String(v))
    )
  );
}

/** Check a code against the saved secret and refuse a code that was already used. */
export async function useTotp(db, code, which = 'totp_secret') {
  const sec = await securityGet(db);
  const step = await matchTotp(sec[which], code);
  if (step == null) return false;
  // One atomic write: it only succeeds when this time step is newer than the last one used,
  // so two sign-ins racing with the same code cannot both pass.
  const r = await db
    .prepare(
      `INSERT INTO admin_security (key, value) VALUES ('totp_last_step', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
       WHERE CAST(admin_security.value AS INTEGER) < CAST(excluded.value AS INTEGER)`
    )
    .bind(String(step))
    .run();
  return (r.meta?.changes || 0) === 1;
}
