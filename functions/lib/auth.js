const COOKIE_NAME = 'spbc_admin';
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function b64urlEncode(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlDecodeToBytes(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64urlEncode(sig);
}

async function hmacVerify(secret, message, signatureB64url) {
  const expected = await hmacSign(secret, message);
  return timingSafeEqualStr(expected, signatureB64url);
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) {
    // still walk to reduce timing leak on length
    let x = 0;
    for (let i = 0; i < ab.length; i++) x |= ab[i];
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function sessionSecret(env) {
  return String(env.ADMIN_SESSION_SECRET || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n$/g, '')
    .trim();
}

async function createSessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `admin:${exp}`;
  const sig = await hmacSign(sessionSecret(env), payload);
  const value = `${b64urlEncode(new TextEncoder().encode(payload))}.${sig}`;
  // Path=/; Secure; SameSite=Lax so cookie is sent on top-level navigations
  // and same-site fetches. Avoid encoding the value (breaks some clients).
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function verifySession(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return false;
  const raw = getCookie(request, COOKIE_NAME);
  if (!raw) return false;
  const [payloadB64, sig] = raw.split('.');
  if (!payloadB64 || !sig) return false;
  let payload;
  try {
    payload = new TextDecoder().decode(b64urlDecodeToBytes(payloadB64));
  } catch {
    return false;
  }
  const ok = await hmacVerify(secret, payload, sig);
  if (!ok) return false;
  const [role, expStr] = payload.split(':');
  if (role !== 'admin') return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

async function requireAdmin(request, env) {
  const ok = await verifySession(request, env);
  if (!ok) return json({ error: 'Unauthorized' }, 401);
  return null;
}

function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return null;
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, (m) => (m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m));
}

/** Customer-facing product shape — never include internal fields (source, etc.). */
function productToPublic(row) {
  return {
    id: row.id,
    name: row.name,
    vial_price: row.vial_price == null ? null : Number(row.vial_price),
    pack_price: Number(row.pack_price),
    kit_only: !!row.kit_only,
    sort_order: row.sort_order,
    active: !!row.active,
  };
}

/** Admin product shape — includes private catalog metadata. */
function productToAdmin(row) {
  return {
    ...productToPublic(row),
    // Admin only — never on public storefront API
    supplier_id: row.supplier_id == null ? null : Number(row.supplier_id),
    supplier_name:
      row.supplier_name == null || row.supplier_name === ''
        ? null
        : String(row.supplier_name),
    // Optional free-text notes (warehouse SKU, etc.)
    source: row.source == null || row.source === '' ? null : String(row.source),
    updated_at: row.updated_at || null,
  };
}

export {
  json,
  createSessionCookie,
  clearSessionCookie,
  verifySession,
  requireAdmin,
  timingSafeEqualStr,
  productToPublic,
  productToAdmin,
  COOKIE_NAME,
};
