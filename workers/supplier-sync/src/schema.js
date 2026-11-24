/**
 * D1 tables for the show-me-source features. Shared by the sync Worker and the
 * Pages Functions (admin Supplier sync tab, restock sign-ups, lab reports, order helper).
 * All CREATE IF NOT EXISTS / add-column-if-missing: safe to call on every request.
 */
import { SEED_MAP } from './seedMap.js';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS supplier_map (
    supplier_id INTEGER PRIMARY KEY,
    supplier_name TEXT,
    spbc_name TEXT,
    skip INTEGER NOT NULL DEFAULT 0,
    hidden_by_sync INTEGER NOT NULL DEFAULT 0,
    low_inventory INTEGER NOT NULL DEFAULT 0,
    coa_url TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS supplier_sync_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    spbc_name TEXT,
    supplier_id INTEGER,
    vial REAL,
    kit REAL,
    detail TEXT
  )`,
  // "Email me when it's back" sign-ups.
  `CREATE TABLE IF NOT EXISTS restock_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spbc_name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    notified_at TEXT,
    UNIQUE (spbc_name, email)
  )`,
  // Small on/off switches Remy controls from the admin.
  `CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Payment reminder / auto-cancel bookkeeping (one reminder per order).
  `CREATE TABLE IF NOT EXISTS order_reminders (
    order_number TEXT PRIMARY KEY,
    reminded_at TEXT,
    cancelled_at TEXT
  )`,
  // "Tell me if the price drops" follows.
  `CREATE TABLE IF NOT EXISTS price_watch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    spbc_name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_notified_at TEXT,
    UNIQUE (spbc_name, email)
  )`,
  // Emails Remy forwards to supplier@springfieldpbc.com (show-me-source receipts and
  // shipping notices, payment notices). Read by the matching jobs.
  `CREATE TABLE IF NOT EXISTS supplier_mail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE,
    received_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT,
    envelope_from TEXT,
    from_addr TEXT,
    subject TEXT,
    kind TEXT,
    text_body TEXT,
    html_body TEXT,
    processed_at TEXT,
    result TEXT
  )`,
  // Remy's decisions in the Money tab: a payment belongs to a show-me-source order, or is not a sale.
  `CREATE TABLE IF NOT EXISTS money_links (
    payment_key TEXT PRIMARY KEY,
    sms TEXT,
    tag TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Which SPBC orders Remy has placed at show-me-source.
  `CREATE TABLE IF NOT EXISTS supplier_orders (
    order_number TEXT PRIMARY KEY,
    placed_at TEXT NOT NULL DEFAULT (datetime('now')),
    sms_ref TEXT,
    note TEXT
  )`,
  // Checkout problems the shop reported (no names, emails or addresses).
  `CREATE TABLE IF NOT EXISTS client_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    detail TEXT,
    page TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

const LATE_COLUMNS = [
  ['supplier_map', 'low_inventory', 'INTEGER NOT NULL DEFAULT 0'],
  ['supplier_map', 'coa_url', 'TEXT'],
  ['supplier_map', 'max_qty', 'INTEGER'], // how many single vials show-me-source will sell right now
  ['supplier_map', 'single_cost', 'REAL'], // today's show-me-source price for 1 vial (pricing-code tier)
  ['supplier_map', 'bulk_cost', 'REAL'], // today's show-me-source price per vial in a 10-vial kit
  ['supplier_orders', 'sms_cost', 'REAL'], // what Remy actually paid show-me-source (incl. their shipping)
  ['supplier_mail', 'trusted', 'INTEGER NOT NULL DEFAULT 0'],
  ['supplier_mail', 'auth', 'TEXT'], // forwarded | dkim | spf | none
];

let ready = false;

export async function ensureSyncSchema(db) {
  if (ready) return;
  await db.batch(TABLES.map((sql) => db.prepare(sql)));
  for (const [table, col, type] of LATE_COLUMNS) {
    const cols = (await db.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name);
    if (!cols.includes(col)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
  }
  const { results } = await db.prepare('SELECT COUNT(*) AS n FROM supplier_map').all();
  if (!results[0].n) {
    await db.batch(
      SEED_MAP.map((m) =>
        db
          .prepare(
            'INSERT OR IGNORE INTO supplier_map (supplier_id, supplier_name, spbc_name, skip, hidden_by_sync) VALUES (?, ?, ?, ?, ?)'
          )
          .bind(m.supplier_id, m.supplier_name, m.spbc_name ?? null, m.skip ? 1 : 0, m.hidden_by_sync ? 1 : 0)
      )
    );
  }
  ready = true;
}

/**
 * Automation switches. Everything that emails customers or changes money starts OFF;
 * Remy turns each on in the admin (Supplier sync tab, Automations card).
 */
export const DEFAULT_SETTINGS = {
  show_lab_reports: '0',
  reminders_on: '0', // email customers who have not paid
  reminder_hours: '24', // ...this many hours after ordering
  auto_cancel_days: '0', // cancel unpaid orders after this many days (0 = never)
  digest_on: '0', // morning email to Remy
  digest_to: '', // Remy's email for the digest
  free_ship_after: '0', // free shipping once a customer has this many paid orders (0 = off)
  price_alerts_on: '0', // "Tell me if the price drops" on the shop
  sms_ship_cost: '0', // what show-me-source charges you to ship one order (profit view)
  auto_match_on: '0', // hands-free: mark website orders paid/shipped from emails (strong matches only)
  free_ship_over: '0', // free shipping when the order's items reach this many dollars (0 = off)
  ship_standard: '10', // Standard shipping price (USPS Ground at show-me-source, 5-8 business days)
  ship_priority: '18', // Priority shipping price (USPS Priority at show-me-source, 2-3 business days)
  vacation_on: '0', // pause checkout
  vacation_message: '', // shown while paused
  announcement: '', // banner at the top of the shop ('' = none)
  tax_on: '0', // collect sales tax
  tax_state: 'MO', // ...on orders shipping to this state
  tax_rate: '0', // ...at this percent
};

export async function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const { results } = await db.prepare('SELECT key, value FROM site_settings').all();
    for (const r of results) if (r.key in out) out[r.key] = r.value ?? '';
  } catch {
    /* table not created yet: defaults */
  }
  return out;
}

export async function getSetting(db, key, fallback = null) {
  const row = await db.prepare('SELECT value FROM site_settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

export async function setSetting(db, key, value) {
  await db
    .prepare(
      "INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .bind(key, value == null ? null : String(value))
    .run();
}

/** Supplier cost of one SPBC order line, from SPBC's own price (vial -$25, kit -$200). */
export function supplierUnitCost(line) {
  const name = String(line.name || '');
  const unit = Number(line.unit_price_cents) / 100;
  const isVial = /\(\s*Vial\s*\)\s*$/i.test(name) || /-VIAL$/i.test(String(line.sku || ''));
  return Math.max(0, Math.round((unit - (isVial ? 25 : 200)) * 100) / 100);
}
