import { ensureSyncSchema } from '../../workers/supplier-sync/src/schema.js';
import { json, productToPublic } from '../lib/auth.js';
import { shopSettings, shippingTable } from '../lib/createOrder.js';

/** Soft member session cookie set after 21+ age gate accept (client). Not hard security. */
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
        message: 'Member session required. Complete the 21+ age gate first.',
      },
      401
    );
  }

  if (!env.DB) {
    return json({ error: 'Database not configured' }, 500);
  }
  try {
    // Supplier extras (low stock, lab report, out of stock) come from the show-me-source
    // sync tables. If those tables are not there yet, fall back to the plain list.
    const s = await shopSettings(env);
    const t = shippingTable(s);
    // Shop-wide info for the storefront (shipping prices, pause, banner, tax, best sellers).
    const shop = {
      free_ship_over: t.freeOver / 100,
      shipping: { standard: t.standard / 100, priority: t.priority / 100 },
      vacation: s.vacation_on === '1' ? { message: s.vacation_message || 'Ordering is paused for a few days.' } : null,
      announcement: String(s.announcement || '').slice(0, 300),
      tax: s.tax_on === '1' && Number(s.tax_rate) > 0 ? { state: String(s.tax_state || '').toUpperCase(), rate: Number(s.tax_rate) } : null,
      best_sellers: await bestSellers(env.DB),
      turnstile_site_key: String(env.TURNSTILE_SITE_KEY || ''),
    };
    const free_ship_over = shop.free_ship_over;
    const extras = await loadSupplierExtras(env.DB);
    if (extras) return json({ ...extras, ...shop, free_ship_over });
    const { results } = await env.DB.prepare(
      `SELECT id, name, vial_price, pack_price, kit_only, sort_order, active
       FROM products
       WHERE active = 1
       ORDER BY sort_order ASC, id ASC`
    ).all();
    // Prices in D1 ARE the customer price. Everyone (storefront, admin, spbc-orders) gets
    // the same stored price.
    return json({ products: (results || []).map(productToPublic), out_of_stock: [], ...shop, free_ship_over });
  } catch (e) {
    return json({ error: 'Failed to load products', detail: String(e.message || e) }, 500);
  }
}

/**
 * products: active rows + low_stock / lab_report flags.
 * out_of_stock: products the supplier sync hid (sold out at show-me-source), so the
 * shop can offer "Email me when it's back". Kept out of `products` on purpose: the
 * spbc-orders worker also reads this list.
 */
/** Top sellers (product names), worked out daily by the sync job. */
async function bestSellers(db) {
  try {
    const row = await db.prepare("SELECT value FROM site_settings WHERE key = 'best_sellers'").first();
    const list = JSON.parse((row && row.value) || '[]');
    return Array.isArray(list) ? list.slice(0, 10).map(String) : [];
  } catch {
    return [];
  }
}

async function loadSupplierExtras(db) {
  try {
    // Adds new columns (like max_qty) right after a deploy, once per server start.
    await ensureSyncSchema(db).catch(() => null);
    const labOn = await db
      .prepare("SELECT value FROM site_settings WHERE key = 'show_lab_reports'")
      .first();
    const showLab = !!labOn && labOn.value === '1';
    const alertsOn = await db
      .prepare("SELECT value FROM site_settings WHERE key = 'price_alerts_on'")
      .first();
    const { results } = await db
      .prepare(
        `SELECT p.id, p.name, p.vial_price, p.pack_price, p.kit_only, p.sort_order, p.active,
                m.low_inventory, m.coa_url, m.max_qty
         FROM products p
         LEFT JOIN supplier_map m ON m.spbc_name = p.name AND m.skip = 0
         WHERE p.active = 1
         ORDER BY p.sort_order ASC, p.id ASC`
      )
      .all();
    const out = await db
      .prepare(
        `SELECT p.name, p.sort_order FROM products p
         JOIN supplier_map m ON m.spbc_name = p.name AND m.skip = 0 AND m.hidden_by_sync = 1
         WHERE p.active = 0 ORDER BY p.sort_order ASC, p.id ASC`
      )
      .all();
    return {
      products: (results || []).map((r) => ({
        ...productToPublic(r),
        low_stock: r.low_inventory === 1,
        lab_report: showLab && !!r.coa_url,
        // Single vials show-me-source will sell right now (null = unknown); the shop caps steppers to it.
        max_units: r.max_qty == null ? null : Number(r.max_qty),
      })),
      out_of_stock: (out.results || []).map((r) => ({ name: r.name })),
      price_alerts: !!alertsOn && alertsOn.value === '1',
    };
  } catch {
    return null; // sync tables not created yet
  }
}
