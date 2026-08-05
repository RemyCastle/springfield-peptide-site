/**
 * Admin credential stored in D1, hashed — replaces plaintext password env vars.
 *
 * Why this exists: the admin password lived in Pages secrets, which cannot be read
 * back, cannot be rotated from the UI, and got overwritten once by tooling trying to
 * get past a login. A hashed row in D1 can be rotated from the admin UI and is never
 * recoverable in plaintext by anyone, including us.
 *
 * PBKDF2-SHA256 via WebCrypto. 100k iterations keeps a Pages Function comfortably
 * inside its CPU budget while staying far above a trivially brute-forceable cost;
 * logins are rare so the cost is paid almost never.
 */
import { timingSafeEqualStr } from './auth.js';

const ITERATIONS = 100000;
const KEYLEN_BITS = 256;
const MIN_PASSWORD = 12;

async function ensureTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS admin_credential (
         id          INTEGER PRIMARY KEY CHECK (id = 1),
         username    TEXT NOT NULL,
         salt        TEXT NOT NULL,
         hash        TEXT NOT NULL,
         iterations  INTEGER NOT NULL,
         updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    )
    .run();
}

function toB64(bytes) {
  let s = '';
  const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    KEYLEN_BITS
  );
  return toB64(bits);
}

/** The stored credential row, or null when setup has not happened yet. */
async function getCredential(env) {
  if (!env.DB) return null;
  try {
    await ensureTable(env.DB);
    return (
      (await env.DB.prepare(
        `SELECT username, salt, hash, iterations, updated_at FROM admin_credential WHERE id = 1`
      ).first()) || null
    );
  } catch {
    return null;
  }
}

/** True when an env-var password is configured (the pre-D1 path). */
function envPasswordConfigured(env) {
  const master = String(env.MASTER_ADMIN_PASSWORD || '').trim();
  const legacy = String(env.ADMIN_PASSWORD || '').trim();
  return Boolean(master || legacy);
}

/**
 * Setup is only allowed while NO credential exists anywhere. Once one does, the
 * setup route must refuse — otherwise it is a permanent admin-takeover hole.
 */
async function needsSetup(env) {
  if (envPasswordConfigured(env)) return false;
  const cred = await getCredential(env);
  return !cred;
}

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (p !== p.trim()) {
    // A pasted trailing space silently broke the old env-var login. Reject it loudly.
    return 'Password cannot start or end with a space.';
  }
  return null;
}

async function setCredential(env, username, password) {
  const user = String(username || '').trim();
  if (!user) return { ok: false, error: 'Username is required.' };
  const bad = validatePassword(password);
  if (bad) return { ok: false, error: bad };
  if (!env.DB) return { ok: false, error: 'Database not configured.' };

  await ensureTable(env.DB);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  await env.DB.prepare(
    `INSERT INTO admin_credential (id, username, salt, hash, iterations, updated_at)
     VALUES (1, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username, salt = excluded.salt, hash = excluded.hash,
       iterations = excluded.iterations, updated_at = excluded.updated_at`
  )
    .bind(user, toB64(salt), hash, ITERATIONS)
    .run();
  return { ok: true };
}

/** Verify against the D1 credential. Returns null when there is no stored credential. */
async function verifyCredential(env, username, password) {
  const cred = await getCredential(env);
  if (!cred) return null;
  const userOk = timingSafeEqualStr(
    String(username || '').trim().toLowerCase(),
    String(cred.username || '').trim().toLowerCase()
  );
  const candidate = await derive(password, fromB64(cred.salt), Number(cred.iterations) || ITERATIONS);
  const passOk = timingSafeEqualStr(candidate, String(cred.hash));
  return { ok: userOk && passOk, username: cred.username };
}

export {
  getCredential,
  needsSetup,
  setCredential,
  verifyCredential,
  envPasswordConfigured,
  validatePassword,
  MIN_PASSWORD,
};
