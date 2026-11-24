/**
 * Create an SPBC order in spbc-orders. Shared by the website checkout (POST /api/place-order)
 * and the admin Quick order (POST /api/admin/quick-order), so both use the same rules.
 *
 * Env: ORDER_WEBHOOK_SECRET (HMAC, same as spbc-orders), ORDERS_WEBHOOK_URL, ORDERS_PUBLIC_URL,
 *      TURNSTILE_SECRET (optional; bot check for website checkouts).
 * Prices always come from D1; anything the client sends about prices is ignored.
 *
 * Rules (site_settings, set in admin > Supplier sync > Automations):
 *   shipping speed  standard (ship_standard $) or priority (ship_priority $)
 *   free shipping   items >= free_ship_over $, or free_ship_after paid orders: Standard is free,
 *                   Priority costs only the difference
 *   stock           no more single vials than show-me-source sells right now (supplier_map.max_qty)
 *   vacation        vacation_on = '1' refuses new orders with vacation_message
 *   sales tax       tax_on: tax_rate % of items for orders shipping to tax_state (as its own line)
 *   duplicates      same email + same total within 10 minutes needs confirm_duplicate
 */
import { normalizeOrderItems, lineKind, stripLineSuffix } from './orderItems.js';
import { proxyOrdersAdmin } from './ordersProxy.js';

export const DEFAULT_ORDERS_URL = 'https://spbc-orders.remycastle.workers.dev';
export const TAX_SKU = 'SALES-TAX';
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

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

/** All shop settings with defaults (missing table = defaults). */
export async function shopSettings(env) {
  const out = {
    free_ship_over: '0',
    free_ship_after: '0',
    ship_standard: '10',
    ship_priority: '18',
    vacation_on: '0',
    vacation_message: '',
    announcement: '',
    tax_on: '0',
    tax_state: 'MO',
    tax_rate: '0',
  };
  try {
    const { results } = await env.DB.prepare('SELECT key, value FROM site_settings').all();
    for (const r of results) if (r.key in out) out[r.key] = r.value ?? '';
  } catch {
    /* defaults */
  }
  return out;
}

const dollars = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

/** Shipping prices in cents + the free threshold (0 = off). */
export function shippingTable(s) {
  return {
    standard: Math.round(dollars(s.ship_standard, 10) * 100),
    priority: Math.round(dollars(s.ship_priority, 18) * 100),
    freeOver: Math.round(dollars(s.free_ship_over, 0) * 100),
  };
}

export async function freeShipOverCents(env) {
  return shippingTable(await shopSettings(env)).freeOver;
}

/** Free shipping once this email has `free_ship_after` paid/shipped/complete SPBC orders. Errors = no perk. */
async function repeatBuyerFreeShipping(env, s, email) {
  try {
    const need = parseInt(s.free_ship_after, 10) || 0;
    if (need <= 0) return false;
    const qs = new URLSearchParams({ q: email, exclude_partner_retail: '1', limit: '100' });
    const res = await proxyOrdersAdmin(env, `/admin/orders?${qs}`);
    if (!res.ok) return false;
    const mine = String(email).trim().toLowerCase();
    return (
      (res.data.orders || []).filter(
        (o) => !o.partner_slug && String(o.customer_email || '').trim().toLowerCase() === mine && ['paid', 'shipped', 'complete'].includes(o.status)
      ).length >= need
    );
  } catch {
    return false;
  }
}

/** Same email + same total placed in the last 10 minutes (and not cancelled)? Errors = no. */
async function recentDuplicate(env, email, totalCents) {
  try {
    const qs = new URLSearchParams({ q: email, exclude_partner_retail: '1', limit: '20' });
    const res = await proxyOrdersAdmin(env, `/admin/orders?${qs}`);
    if (!res.ok) return null;
    const mine = String(email).trim().toLowerCase();
    const now = Date.now();
    return (
      (res.data.orders || []).find(
        (o) =>
          String(o.customer_email || '').trim().toLowerCase() === mine &&
          Number(o.total_cents) === totalCents &&
          o.status !== 'cancelled' &&
          now - (Date.parse(o.created_at || '') || 0) < DUPLICATE_WINDOW_MS
      ) || null
    );
  } catch {
    return null;
  }
}

/** Units (single vials) per product in the cart vs what show-me-source can sell now. */
async function stockProblem(env, items) {
  let caps;
  try {
    const { results } = await env.DB.prepare(
      'SELECT spbc_name, max_qty FROM supplier_map WHERE skip = 0 AND max_qty IS NOT NULL'
    ).all();
    caps = new Map(results.map((r) => [r.spbc_name, Number(r.max_qty)]));
  } catch {
    return null; // no stock data yet
  }
  const units = new Map();
  for (const it of items) {
    const name = stripLineSuffix(it.name);
    const n = (parseInt(it.qty, 10) || 0) * (lineKind(it) === 'vial' ? 1 : 10);
    units.set(name, (units.get(name) || 0) + n);
  }
  for (const [name, n] of units) {
    const max = caps.get(name);
    if (max != null && n > max) {
      const kits = Math.floor(max / 10);
      return `Only ${max} ${name} vial${max === 1 ? '' : 's'} left right now${kits ? ` (${kits} kit${kits === 1 ? '' : 's'})` : ''}. Please lower the amount.`;
    }
  }
  return null;
}

async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // not set up yet
  if (!token) return false;
  try {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', String(token));
    if (ip) form.append('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const d = await r.json().catch(() => ({}));
    return !!d.success;
  } catch {
    return false;
  }
}

/**
 * @param {object} env
 * @param {{ name: string, email: string, items: object[], shipping?: object, notes?: string, eventId?: string,
 *           currency?: string, speed?: 'standard'|'priority', deliveryNotes?: string, confirmDuplicate?: boolean,
 *           turnstileToken?: string, ip?: string, fromAdmin?: boolean }} input
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function createOrder(env, input) {
  if (!env.ORDER_WEBHOOK_SECRET) {
    return { status: 500, body: { error: 'server_misconfigured', message: 'ORDER_WEBHOOK_SECRET not set on Pages' } };
  }
  const s = await shopSettings(env);
  // The health check's probe (email without "@") never becomes an order, so it passes the
  // pause and bot check and still tests the order system's signature.
  if (s.vacation_on === '1' && !input.fromAdmin && String(input.email || '').includes('@')) {
    return { status: 503, body: { error: 'paused', message: s.vacation_message || 'Ordering is paused for a few days. Please check back soon.' } };
  }
  // The 2-hourly health check sends an email with no "@": spbc-orders always rejects that, so it can
  // never become an order, and skipping the bot check lets the probe still test the signature.
  const probe = !String(input.email || '').includes('@');
  if (!input.fromAdmin && !probe && !(await turnstileOk(env, input.turnstileToken, input.ip))) {
    return { status: 400, body: { error: 'bot_check_failed', message: 'Please complete the quick "are you human" check and try again.' } };
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
  const stock = await stockProblem(env, priced.items);
  if (stock) return { status: 409, body: { error: 'not_enough_stock', message: stock } };

  const productsSubtotal = priced.items.reduce((sum, it) => sum + it.qty * it.unit_price_cents, 0);
  const table = shippingTable(s);
  const speed = input.speed === 'priority' ? 'priority' : 'standard';
  const overThreshold = table.freeOver > 0 && productsSubtotal >= table.freeOver;
  const repeat = overThreshold ? false : await repeatBuyerFreeShipping(env, s, email);
  const free = overThreshold || repeat;
  const shipping = free ? (speed === 'priority' ? Math.max(0, table.priority - table.standard) : 0) : table[speed];

  // Sales tax as its own line (only when switched on and shipping to the tax state).
  const lines = [...priced.items];
  const shipTo = input.shipping || {};
  const rate = dollars(s.tax_rate, 0);
  let taxCents = 0;
  if (s.tax_on === '1' && rate > 0 && String(shipTo.ship_state || '').trim().toUpperCase() === String(s.tax_state || '').toUpperCase()) {
    taxCents = Math.round((productsSubtotal * rate) / 100);
    if (taxCents > 0) {
      lines.push({ sku: TAX_SKU, name: `Sales tax (${String(s.tax_state).toUpperCase()} ${rate}%)`, qty: 1, unit_price_cents: taxCents });
    }
  }
  const subtotal = productsSubtotal + taxCents;
  const total = subtotal + shipping;

  if (!input.confirmDuplicate) {
    const dup = await recentDuplicate(env, email, total);
    if (dup) {
      return {
        status: 409,
        body: {
          error: 'possible_duplicate',
          // No order number here: anyone can type an email, so this must not confirm details
          // of someone else's order. The real customer has it in their order email.
          message: 'It looks like this same order was just placed a few minutes ago (check your email for it). Place another one anyway?',
        },
      };
    }
  }

  const delivery = String(input.deliveryNotes || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const notes = [
    `Shipping speed: ${speed === 'priority' ? 'Priority' : 'Standard'}`,
    delivery ? `Delivery notes: ${delivery}` : '',
    input.notes ? String(input.notes) : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);

  const payload = {
    event_id: String(input.eventId || '').trim() || `evt_site_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    customer: { name, email },
    items: lines,
    subtotal_cents: subtotal,
    shipping_cents: shipping,
    total_cents: total,
    currency: String(input.currency || 'USD').toUpperCase().slice(0, 3),
    notes,
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
  const ship = {
    ship_name: String(shipTo.ship_name || name).trim(),
    ship_line1: String(shipTo.ship_line1 || '').trim(),
    ship_line2: String(shipTo.ship_line2 || '').trim() || undefined,
    ship_city: String(shipTo.ship_city || '').trim(),
    ship_state: String(shipTo.ship_state || '').trim().toUpperCase(),
    ship_postal: String(shipTo.ship_postal || '').trim(),
    ship_country: 'US',
    ship_phone: String(shipTo.ship_phone || '').trim() || undefined,
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
      subtotal_cents: productsSubtotal,
      tax_cents: taxCents,
      shipping_cents: shipping,
      shipping_speed: speed,
      total_cents: data.total_cents ?? total,
      currency: data.currency || payload.currency,
      shipping_saved,
      pay_url: orderNumber ? `${publicBase}/pay/${encodeURIComponent(orderNumber)}` : null,
      shipping_url: orderNumber ? `${publicBase}/shipping/${encodeURIComponent(orderNumber)}` : null,
    },
  };
}
