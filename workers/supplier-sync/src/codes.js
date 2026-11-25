/**
 * Discount codes, referral credit and store credit (SPBC, springfieldpeps-db).
 *
 * A code can give:
 *   - pct_off      a percentage off every product (e.g. a buddy's 15% referral code), and/or
 *   - custom prices per product (vial and/or kit) for that code.
 * Either way a code price is NEVER below Remy's cost (supplier_map single_cost / bulk_cost x10)
 * and never above the normal price. Where the cost is unknown, only custom prices Remy typed apply
 * as is (the admin warns about it).
 *
 * credit_pct > 0 makes it a referral code: when a referred order is PAID, the code owner earns
 * credit_pct% of what the customer paid for products, as store credit. The owner cannot use their
 * own referral code. Store credit is applied automatically to the owner's next website order
 * (matched by email), never to shipping. Credit used on an order is held until that order is paid
 * (kept) or cancelled (given back).
 *
 * Order lines: the products stay at their normal price; the code discount and the store credit are
 * separate negative lines (sku ADJ-CODE / ADJ-CREDIT) so emails, reports and the drop shipper text
 * all stay correct.
 */

export const CODE_RE = /^[A-Z0-9-]{3,24}$/;
export const SQUASH = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();

export function normalizeCode(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

export async function ensureCodeTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS discount_codes (
      code TEXT PRIMARY KEY,
      label TEXT,
      owner_name TEXT,
      owner_email TEXT,
      pct_off REAL NOT NULL DEFAULT 0,
      credit_pct REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS discount_code_prices (
      code TEXT NOT NULL,
      product TEXT NOT NULL,
      vial_cents INTEGER,
      kit_cents INTEGER,
      PRIMARY KEY (code, product)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS code_uses (
      order_number TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      customer_email TEXT,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      products_paid_cents INTEGER NOT NULL DEFAULT 0,
      credit_cents INTEGER NOT NULL DEFAULT 0,
      credit_to TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS store_credit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      cents INTEGER NOT NULL,
      kind TEXT NOT NULL,
      order_number TEXT,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'final',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_store_credit_email ON store_credit (email)`),
  ]);
}

export async function getCode(db, code) {
  const c = normalizeCode(code);
  if (!CODE_RE.test(c)) return null;
  return db.prepare('SELECT * FROM discount_codes WHERE code = ?').bind(c).first();
}

/** product (lower-cased, no spaces) -> { vial: cents|null, kit: cents|null } */
export async function codePriceMap(db, code) {
  const { results } = await db.prepare('SELECT product, vial_cents, kit_cents FROM discount_code_prices WHERE code = ?').bind(normalizeCode(code)).all();
  const m = new Map();
  for (const r of results || []) m.set(SQUASH(r.product), { vial: r.vial_cents ?? null, kit: r.kit_cents ?? null });
  return m;
}

/** product (squashed) -> { vial: cost cents|null, kit: cost cents|null } from the supplier price map. */
export async function productCosts(db) {
  let rows = [];
  try {
    rows = (await db.prepare('SELECT spbc_name, single_cost, bulk_cost FROM supplier_map WHERE skip = 0').all()).results || [];
  } catch {
    rows = [];
  }
  const m = new Map();
  for (const r of rows) {
    const vial = Number(r.single_cost) > 0 ? Math.round(Number(r.single_cost) * 100) : null;
    const kit = Number(r.bulk_cost) > 0 ? Math.round(Number(r.bulk_cost) * 10 * 100) : null;
    m.set(SQUASH(r.spbc_name), { vial, kit });
  }
  return m;
}

/**
 * The price one unit costs with this code. Never below cost (when known), never above the list price.
 * @param {{pct_off:number}} code
 * @param {{vial:number|null, kit:number|null}|undefined} custom
 * @param {{vial:number|null, kit:number|null}|undefined} cost
 */
export function unitCodePrice(code, custom, cost, kind, listCents) {
  const k = kind === 'kit' ? 'kit' : 'vial';
  const floor = cost && cost[k] != null ? cost[k] : null;
  let price = listCents;
  if (custom && custom[k] != null) price = custom[k];
  else if (Number(code.pct_off) > 0) price = Math.round(listCents * (1 - Number(code.pct_off) / 100));
  if (floor != null) price = Math.max(price, floor);
  return Math.max(0, Math.min(listCents, price));
}

/**
 * Apply a code to priced order lines ({ sku, name, qty, unit_price_cents }; product names may carry
 * " (Vial)" / " (Kit)"). Returns { ok, code, discount_cents, products_after_cents } or { ok:false, message }.
 */
export async function applyCode(db, codeStr, items, customerEmail, { kindOf, productOf }) {
  const code = await getCode(db, codeStr);
  if (!code || !Number(code.active)) return { ok: false, message: 'That code is not valid.' };
  const email = String(customerEmail || '').trim().toLowerCase();
  if (Number(code.credit_pct) > 0 && code.owner_email && email && String(code.owner_email).trim().toLowerCase() === email) {
    return { ok: false, message: 'You cannot use your own referral code. Your earned credit is applied automatically instead.' };
  }
  const [custom, costs] = await Promise.all([codePriceMap(db, code.code), productCosts(db)]);
  let discount = 0;
  let products = 0;
  for (const it of items) {
    if (/^(ADJ-|SALES-TAX)/i.test(String(it.sku || ''))) continue;
    const kind = kindOf(it);
    const key = SQUASH(productOf(it));
    const unit = unitCodePrice(code, custom.get(key), costs.get(key), kind, it.unit_price_cents);
    discount += (it.unit_price_cents - unit) * it.qty;
    products += it.unit_price_cents * it.qty;
  }
  return { ok: true, code, discount_cents: discount, products_after_cents: products - discount };
}

/** Spendable store credit: final entries plus credit held by open orders. */
export async function creditBalance(db, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return 0;
  const r = await db
    .prepare(`SELECT COALESCE(SUM(cents), 0) AS bal FROM store_credit WHERE email = ? AND status IN ('final','held')`)
    .bind(e)
    .first();
  return Math.max(0, Number(r && r.bal) || 0);
}

/** After the order exists: remember the code use and hold the credit spent. */
export async function recordOrderCodes(db, { orderNumber, email, codeResult, creditCents }) {
  const stmts = [];
  if (codeResult && codeResult.ok) {
    const c = codeResult.code;
    const earn = Number(c.credit_pct) > 0 && c.owner_email ? Math.round((codeResult.products_after_cents * Number(c.credit_pct)) / 100) : 0;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO code_uses (order_number, code, customer_email, discount_cents, products_paid_cents, credit_cents, credit_to)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(orderNumber, c.code, String(email || '').toLowerCase(), codeResult.discount_cents, codeResult.products_after_cents, earn, earn ? String(c.owner_email).toLowerCase() : null)
    );
  }
  if (creditCents > 0) {
    stmts.push(
      db
        .prepare(`INSERT INTO store_credit (email, cents, kind, order_number, note, status) VALUES (?, ?, 'used', ?, 'Used on an order', 'held')`)
        .bind(String(email || '').toLowerCase(), -creditCents, orderNumber)
    );
  }
  if (stmts.length) await db.batch(stmts);
}

/**
 * Every 2 hours: settle code uses and held credit by the order's real status.
 * Paid / shipped / complete -> referral credit is earned, held credit is kept.
 * Cancelled -> no referral credit, held credit goes back to the customer.
 */
export async function settleCodes(db, getStatus) {
  await ensureCodeTables(db);
  const pendingUses = (await db.prepare(`SELECT * FROM code_uses WHERE status = 'pending' ORDER BY created_at LIMIT 100`).all()).results || [];
  const held = (await db.prepare(`SELECT * FROM store_credit WHERE status = 'held' ORDER BY created_at LIMIT 100`).all()).results || [];
  const orders = new Set([...pendingUses.map((u) => u.order_number), ...held.map((h) => h.order_number)]);
  const out = { earned: 0, voided: 0, kept: 0, released: 0 };
  for (const n of orders) {
    const status = await getStatus(n).catch(() => null);
    if (!status) continue;
    const paid = ['paid', 'shipped', 'complete'].includes(status);
    const gone = status === 'cancelled';
    if (!paid && !gone) continue;
    const stmts = [];
    for (const u of pendingUses.filter((x) => x.order_number === n)) {
      stmts.push(db.prepare(`UPDATE code_uses SET status = ?, settled_at = datetime('now') WHERE order_number = ? AND status = 'pending'`).bind(paid ? 'earned' : 'void', n));
      if (paid && u.credit_cents > 0 && u.credit_to) {
        stmts.push(
          db
            .prepare(`INSERT INTO store_credit (email, cents, kind, order_number, note, status) VALUES (?, ?, 'earned', ?, ?, 'final')`)
            .bind(u.credit_to, u.credit_cents, n, `Referral: code ${u.code}`)
        );
        out.earned += 1;
      } else if (!paid) out.voided += 1;
    }
    for (const h of held.filter((x) => x.order_number === n)) {
      stmts.push(db.prepare(`UPDATE store_credit SET status = ? WHERE id = ? AND status = 'held'`).bind(paid ? 'final' : 'released', h.id));
      if (paid) out.kept += 1;
      else out.released += 1;
    }
    if (stmts.length) await db.batch(stmts);
  }
  return out;
}
