import { json, productToPublic } from '../lib/auth.js';

/** Soft member session cookie set after password unlock (client). Not hard security. */
const MEMBER_COOKIE = 'spbc_member';

/** Customer markup: base × 1.20, nearest whole dollar. DB stores base only — never write markup. */
const CUSTOMER_MARKUP = 1.2;

function hasCookieMember(request) {
  const header = request.headers.get('Cookie') || '';
  return new RegExp(`(?:^|;\\s*)${MEMBER_COOKIE}=1(?:;|$)`).test(header);
}

/**
 * Server-to-server auth used by spbc-orders worker (dropship / franchisee pricing).
 * Cloudflare Workers cannot set Cookie on outbound fetch (forbidden header), so the
 * worker sends X-SPBC-Member: 1 and/or ?member=1.
 */
function isServerToServerMember(request) {
  const soft =
    (request.headers.get('X-SPBC-Member') || '').trim() ||
    (request.headers.get('x-spbc-member') || '').trim();
  if (soft === '1') return true;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('member') === '1') return true;
  } catch {
    /* ignore */
  }
  return false;
}

function hasMemberSession(request) {
  return hasCookieMember(request) || isServerToServerMember(request);
}

/** Customer-facing price only. Worker/S2S callers must receive base (no markup). */
function toCustomerPrice(baseDollars) {
  if (baseDollars == null || Number.isNaN(Number(baseDollars))) return null;
  return Math.round(Number(baseDollars) * CUSTOMER_MARKUP);
}

function productForCaller(row, serverToServer) {
  const p = productToPublic(row);
  // PRICE SPLIT (money-critical):
  // - Browser storefront (spbc_member cookie / open API): customer = round(base × 1.20)
  // - spbc-orders worker (X-SPBC-Member / ?member=1): BASE unchanged for franchisee/dropship
  // Do NOT change D1 product prices — markup is computed here only.
  if (!serverToServer) {
    if (p.vial_price != null) p.vial_price = toCustomerPrice(p.vial_price);
    p.pack_price = toCustomerPrice(p.pack_price);
  }
  return p;
}

export async function onRequestGet({ request, env }) {
  // Allow emergency open via Pages env MEMBERS_API_OPEN=1 (ops only)
  const open = String(env.MEMBERS_API_OPEN || '').trim() === '1';
  if (!open && !hasMemberSession(request)) {
    return json(
      {
        error: 'unauthorized',
        message: 'Member session required. Unlock the club password first.',
      },
      401
    );
  }

  if (!env.DB) {
    return json({ error: 'Database not configured' }, 500);
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, vial_price, pack_price, kit_only, sort_order, active
       FROM products
       WHERE active = 1
       ORDER BY sort_order ASC, id ASC`
    ).all();
    // S2S wins when header/query present so worker always gets base even if a cookie is set.
    const serverToServer = isServerToServerMember(request);
    return json({
      products: (results || []).map((row) => productForCaller(row, serverToServer)),
    });
  } catch (e) {
    return json({ error: 'Failed to load products', detail: String(e.message || e) }, 500);
  }
}
