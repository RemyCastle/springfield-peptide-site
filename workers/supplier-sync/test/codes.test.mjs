// Run: node workers/supplier-sync/test/codes.test.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  applyCode,
  creditBalance,
  ensureCodeTables,
  recordOrderCodes,
  settleCodes,
  unitCodePrice,
} from '../src/codes.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (l) => { for (const s of l) await s.run(); return []; } };
}

const db = d1();
db.raw.exec(`CREATE TABLE supplier_map (supplier_id INTEGER, spbc_name TEXT, skip INTEGER DEFAULT 0, single_cost REAL, bulk_cost REAL)`);
// Costs: GHK vial $30, kit $250 (bulk $25 x10). TIRZ: no cost known.
db.raw.exec(`INSERT INTO supplier_map (supplier_id, spbc_name, skip, single_cost, bulk_cost) VALUES (1, 'GHK-CU 75MG', 0, 30, 25)`);
await ensureCodeTables(db);
db.raw.exec(`INSERT INTO discount_codes (code, label, owner_name, owner_email, pct_off, credit_pct, active) VALUES ('BUDDY15', 'Buddy 15% off', 'Buddy', 'buddy@x.co', 15, 5, 1)`);
db.raw.exec(`INSERT INTO discount_codes (code, label, owner_name, owner_email, pct_off, credit_pct, active) VALUES ('VIPJO', 'Jo pricing', 'Jo', 'jo@x.co', 0, 0, 1)`);
db.raw.exec(`INSERT INTO discount_code_prices (code, product, vial_cents, kit_cents) VALUES ('VIPJO', 'GHK-CU 75MG', 3200, NULL)`);

const opts = { kindOf: (it) => (/\(Vial\)$/.test(it.name) ? 'vial' : 'kit'), productOf: (it) => it.name.replace(/\s+\((Vial|Kit.*)\)$/, '') };
const ghkVial = { sku: 'GHK-CU-75MG-VIAL', name: 'GHK-CU 75MG (Vial)', qty: 2, unit_price_cents: 3600 };
const ghkKit = { sku: 'GHK-CU-75MG-KIT', name: 'GHK-CU 75MG (Kit (10))', qty: 1, unit_price_cents: 30000 };
const tirz = { sku: 'TIRZ-30MG-VIAL', name: 'TIRZ 30MG (Vial)', qty: 1, unit_price_cents: 10000 };

// Percentage never goes below cost: 15% off $36 = $30.60 (above $30 cost), 15% off $300 kit = $255 (above $250).
assert.equal(unitCodePrice({ pct_off: 15 }, undefined, { vial: 3000, kit: 25000 }, 'vial', 3600), 3060);
assert.equal(unitCodePrice({ pct_off: 50 }, undefined, { vial: 3000, kit: 25000 }, 'vial', 3600), 3000, 'floored at cost');
// Custom price below cost is lifted to cost; above list is capped at list.
assert.equal(unitCodePrice({ pct_off: 0 }, { vial: 2500, kit: null }, { vial: 3000 }, 'vial', 3600), 3000);
assert.equal(unitCodePrice({ pct_off: 0 }, { vial: 9999, kit: null }, { vial: 3000 }, 'vial', 3600), 3600);

let r = await applyCode(db, 'buddy15', [ghkVial, ghkKit, tirz], 'cust@x.co', opts);
assert.equal(r.ok, true);
// GHK vials: 2 x (3600-3060)=1080; GHK kit: 30000-25500=4500; TIRZ (no cost known): 15% of 10000=1500.
assert.equal(r.discount_cents, 1080 + 4500 + 1500);

// The owner cannot use their own referral code.
r = await applyCode(db, 'BUDDY15', [ghkVial], 'Buddy@x.co', opts);
assert.equal(r.ok, false);
// Custom price code: GHK vial at $32, kit untouched.
r = await applyCode(db, 'VIPJO', [ghkVial, ghkKit], 'jo@x.co', opts);
assert.equal(r.discount_cents, 2 * 400);
assert.equal((await applyCode(db, 'NOPE', [ghkVial], 'a@b.co', opts)).ok, false);

// Referral credit: earned only when the referred order is PAID; nothing for a cancelled one.
const use1 = await applyCode(db, 'BUDDY15', [tirz], 'cust@x.co', opts); // pays 8500 for products
await recordOrderCodes(db, { orderNumber: 'ORD1', email: 'cust@x.co', codeResult: use1, creditCents: 0 });
const use2 = await applyCode(db, 'BUDDY15', [tirz], 'cust2@x.co', opts);
await recordOrderCodes(db, { orderNumber: 'ORD2', email: 'cust2@x.co', codeResult: use2, creditCents: 0 });
const statuses = { ORD1: 'pending_payment', ORD2: 'pending_payment' };
await settleCodes(db, async (n) => statuses[n]);
assert.equal(await creditBalance(db, 'buddy@x.co'), 0, 'nothing until paid');
statuses.ORD1 = 'paid';
statuses.ORD2 = 'cancelled';
let s = await settleCodes(db, async (n) => statuses[n]);
assert.deepEqual([s.earned, s.voided], [1, 1]);
assert.equal(await creditBalance(db, 'buddy@x.co'), 425, '5% of $85.00');
await settleCodes(db, async (n) => statuses[n]);
assert.equal(await creditBalance(db, 'buddy@x.co'), 425, 'settled once only');

// Spending credit: held while the order is open, given back if it is cancelled, kept if paid.
await recordOrderCodes(db, { orderNumber: 'ORD3', email: 'buddy@x.co', codeResult: null, creditCents: 425 });
assert.equal(await creditBalance(db, 'buddy@x.co'), 0);
statuses.ORD3 = 'cancelled';
await settleCodes(db, async (n) => statuses[n]);
assert.equal(await creditBalance(db, 'buddy@x.co'), 425, 'cancelled order gives the credit back');
await recordOrderCodes(db, { orderNumber: 'ORD4', email: 'buddy@x.co', codeResult: null, creditCents: 425 });
statuses.ORD4 = 'paid';
await settleCodes(db, async (n) => statuses[n]);
assert.equal(await creditBalance(db, 'buddy@x.co'), 0, 'paid order keeps it spent');

console.log('ok: discount codes, cost floor, referral credit, store credit');
