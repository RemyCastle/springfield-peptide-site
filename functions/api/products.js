import { json, productToPublic } from '../lib/auth.js';

/** Soft member session cookie set after password unlock (client). Not hard security. */
const MEMBER_COOKIE = 'spbc_member';

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
    // Prices in D1 ARE the customer price (raised once). Everyone — storefront, admin,
    // and the spbc-orders worker — gets the same stored price. Franchisee cost is a
    // separate per-item override held in the worker (product_links.franchisee_*), not here.
    return json({ products: (results || []).map(productToPublic) });
  } catch (e) {
    return json({ error: 'Failed to load products', detail: String(e.message || e) }, 500);
  }
}
