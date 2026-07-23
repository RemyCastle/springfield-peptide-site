import { json, productToPublic } from '../lib/auth.js';

/** Soft member session cookie set after password unlock (client). Not hard security. */
const MEMBER_COOKIE = 'spbc_member';

function hasMemberSession(request) {
  const header = request.headers.get('Cookie') || '';
  if (new RegExp(`(?:^|;\\s*)${MEMBER_COOKIE}=1(?:;|$)`).test(header)) {
    return true;
  }
  // Cloudflare Workers cannot set Cookie on outbound fetch (forbidden header).
  // Server-to-server callers (spbc-orders dropship pricing) use header and/or query.
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
    return json({ products: (results || []).map(productToPublic) });
  } catch (e) {
    return json({ error: 'Failed to load products', detail: String(e.message || e) }, 500);
  }
}
