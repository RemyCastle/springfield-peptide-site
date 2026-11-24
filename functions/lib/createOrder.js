/**
 * Create an SPBC order in spbc-orders. Shared by the website checkout (POST /api/place-order)
 * and the admin Quick order (POST /api/admin/quick-order), so both use the same prices,
 * minimum and shipping rules.
 *
 * Env: ORDER_WEBHOOK_SECRET (HMAC, same as spbc-orders), ORDERS_WEBHOOK_URL, ORDERS_PUBLIC_URL.
 * Prices always come from D1; anything the client sends about prices is ignored.
 * Shipping: flat SHIPPING_CENTS, free when the order subtotal reaches site_settings.free_ship_over
 * (dollars, 0 = off) or the customer has site_settings.free_ship_after paid orders (0 = off).
 */
import { normalizeOrderItems, SHIPPING_CENTS } from './orderItems.js';
import { proxyOrdersAdmin } from './ordersProxy.js';

export const DEFAULT_ORDERS_URL = 'https://spbc-orders.remycastle.workers.dev';

async function loadActiveProducts(env) {
  if (!env.DB) return null;
  const { results } = await env.DB.prepare(
    `SELECT name, vial_price, pack_price, kit_only, active FROM products WHERE active = 1`
  ).all();
  return results || [];
}

function bufferToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(secret, rawBody) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bufferToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
}

async function setting(env, key) {
  try {
    const row = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first();
    return row ? row.value : null;
  } catch {
    return null; // settings table not created yet
  }
}

/** Free-shipping threshold in cents (0 = off). */
export async function freeShipOverCents(env) {
  const v = Number(await setting(env, 'free_ship_over'));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
}

/** Free shipping once this email has `free_ship_after` paid/shipped/complete SPBC orders. Errors = no perk. */
async function repeatBuyerFreeShipping(env, email) {
  try {
    const need = parseInt(await setting(env, 'free_ship_after'), 10) || 0;
    if (need <= 0) return false;
    const qs = new URLSearchParams({ q: email, exclude_partner_retail: '1', limit: '100' });
    const res = await proxyOrdersAdmin(env, `/admin/orders?${qs}`);
    if (!res.ok) return false;
    const mine = String(email).trim().toLowerCase();
    const paid = (res.data.orders || []).filter(
      (o) => !o.partner_slug && String(o.customer_email || '').trim().toLowerCase() === mine && ['paid', 'shipped', 'complete'].includes(o.status)
    ).length;
    return paid >= need;
  } catch {
    return false;
  }
}

/**
 * @param {object} env
 * @param {{ name: string, email: string, items: object[], shipping?: object, notes?: string, eventId?: string, currency?: string }} input
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function createOrder(env, input) {
  if (!env.ORDER_WEBHOOK_SECRET) {
    return { status: 500, body: { error: 'server_misconfigured', message: 'ORDER_WEBHOOK_SECRET not set on Pages' } };
  }
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim();
  const items = Array.isArray(input.items) ? input.items : [];
  if (!name || !email || !items.length) {
    return { status: 400, body: { error: 'validation_failed', message: 'name, email, and at least one item are required' } };
  }

  let catalog;
  try {
    catalog = await loadActiveProducts(env);
  } catch {
    return { status: 500, body: { error: 'catalog_unavailable', message: 'Could not read catalog prices' } };
  }
  if (!catalog) return { status: 500, body: { error: 'server_misconfigured', message: 'Database not configured' } };

  // Re-price from D1; minimum 2 vials or 1 kit; kit_only products cannot be ordered as vials.
  const priced = normalizeOrderItems(items, catalog);
  if (!priced.ok) return { status: priced.status, body: { error: priced.error, message: priced.message, item: priced.item } };

  const subtotal = priced.items.reduce((s, it) => s + it.qty * it.unit_price_cents, 0);
  const overCents = await freeShipOverCents(env);
  const overThreshold = overCents > 0 && subtotal >= overCents;
  const repeat = overThreshold ? false : await repeatBuyerFreeShipping(env, email);
  const shipping = overThreshold || repeat ? 0 : SHIPPING_CENTS;
  const total = subtotal + shipping;

  const payload = {
    event_id: String(input.eventId || '').trim() || `evt_site_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    customer: { name, email },
    items: priced.items,
    subtotal_cents: subtotal,
    shipping_cents: shipping,
    total_cents: total,
    currency: String(input.currency || 'USD').toUpperCase().slice(0, 3),
    notes: input.notes ? String(input.notes).slice(0, 2000) : undefined,
  };
  const rawBody = JSON.stringify(payload);
  const signature = await hmacSha256Hex(env.ORDER_WEBHOOK_SECRET, rawBody);
  const webhookUrl = env.ORDERS_WEBHOOK_URL || `${DEFAULT_ORDERS_URL}/webhooks/order`;
  const publicBase = String(env.ORDERS_PUBLIC_URL || DEFAULT_ORDERS_URL).replace(/\/$/, '');

  let upstream;
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SPBC-Signature': signature },
      body: rawBody,
    });
  } catch (e) {
    return { status: 502, body: { error: 'upstream_unreachable', message: e instanceof Error ? e.message : String(e) } };
  }
  let data;
  try {
    data = await upstream.json();
  } catch {
    return { status: 502, body: { error: 'upstream_bad_response', status: upstream.status } };
  }
  if (!upstream.ok) {
    return {
      status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      body: { error: data.error || 'order_failed', message: data.message || 'Orders service rejected the order', details: data },
    };
  }
  const orderNumber = data.order_number;

  // Shipping address, forwarded server-side. Failure still returns the order (the customer gets a shipping link).
  let shipping_saved = false;
  const s = input.shipping || {};
  const ship = {
    ship_name: String(s.ship_name || name).trim(),
    ship_line1: String(s.ship_line1 || '').trim(),
    ship_line2: String(s.ship_line2 || '').trim() || undefined,
    ship_city: String(s.ship_city || '').trim(),
    ship_state: String(s.ship_state || '').trim().toUpperCase(),
    ship_postal: String(s.ship_postal || '').trim(),
    ship_country: 'US',
    ship_phone: String(s.ship_phone || '').trim() || undefined,
  };
  if (orderNumber && ship.ship_name && ship.ship_line1 && ship.ship_city && ship.ship_state && ship.ship_postal) {
    try {
      const r = await fetch(`${publicBase}/shipping/${encodeURIComponent(orderNumber)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(ship),
      });
      shipping_saved = r.ok;
    } catch {
      shipping_saved = false;
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      perk: overThreshold ? 'free_shipping_over' : repeat ? 'free_shipping' : null,
      duplicate: Boolean(data.duplicate),
      order_number: orderNumber,
      status: data.status || 'pending_payment',
      subtotal_cents: subtotal,
      shipping_cents: shipping,
      total_cents: data.total_cents ?? total,
      currency: data.currency || payload.currency,
      shipping_saved,
      pay_url: orderNumber ? `${publicBase}/pay/${encodeURIComponent(orderNumber)}` : null,
      shipping_url: orderNumber ? `${publicBase}/shipping/${encodeURIComponent(orderNumber)}` : null,
    },
  };
}
