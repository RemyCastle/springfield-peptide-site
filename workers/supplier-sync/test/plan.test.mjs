// Run: node workers/supplier-sync/test/plan.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSync, targetPrices, feedProblem } from '../src/plan.js';
import { SEED_MAP } from '../src/seedMap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'sms-fixture-2026-11-23.json'), 'utf8'));
const products = JSON.parse(fs.readFileSync(path.join(here, 'spbc-products-after-pricing.json'), 'utf8'));
const map = SEED_MAP.map((m) => ({ ...m, skip: m.skip ? 1 : 0, hidden_by_sync: m.hidden_by_sync ? 1 : 0 }));
const clone = (o) => JSON.parse(JSON.stringify(o));

// Formula
assert.deepEqual(targetPrices({ single_price: 24, bulk_price: 14.5 }), { vial: 49, kit: 345, kitOnly: false });
assert.deepEqual(targetPrices({ single_price: 7, bulk_price: 7, kits_only: true }), { vial: null, kit: 270, kitOnly: true });
assert.deepEqual(targetPrices({ single_price: 12.5, bulk_price: 7.5 }), { vial: 38, kit: 275, kitOnly: false }, 'whole dollars, halves up');
assert.deepEqual(targetPrices({ single_price: 12.49, bulk_price: 7.51 }), { vial: 37, kit: 275, kitOnly: false });

// Every SEED_MAP id exists in today's feed, and every feed id is mapped or skipped.
for (const m of SEED_MAP) assert.ok(fx.feed[String(m.supplier_id)], `map id ${m.supplier_id} not in feed`);
for (const id of Object.keys(fx.feed)) assert.ok(SEED_MAP.some((m) => String(m.supplier_id) === id), `feed id ${id} unmapped`);

// 1. Today's feed against the new SPBC prices: nothing to do.
{
  const { actions } = planSync({ ...fx, map, products });
  assert.deepEqual(actions, [], `expected no changes, got ${JSON.stringify(actions, null, 1)}`);
}

// 2. Small price move is applied; big one is held.
{
  const feed = clone(fx.feed);
  feed['1'].single_price = 26; // RETA 30MG vial 49 -> 51 (4%)
  feed['34'].bulk_price = 16; // RETA 10MG kit 280 -> 360 (29%)
  const { actions } = planSync({ feed, stock: fx.stock, map, products });
  const price = actions.find((a) => a.kind === 'price');
  const hold = actions.find((a) => a.kind === 'hold_price');
  assert.equal(price.spbc_name, 'RETA 30MG');
  assert.equal(price.to.vial, 51);
  assert.equal(hold.spbc_name, 'RETA 10MG');
  assert.equal(hold.to.kit, 360);
  assert.equal(actions.length, 2);
  // A hold Remy already ignored (or that is pending) is not raised again.
  const again = planSync({ feed, stock: fx.stock, map, products, decided: [{ spbc_name: 'RETA 10MG', vial: 40, kit: 360, status: 'ignored' }] });
  assert.equal(again.actions.filter((a) => a.kind === 'hold_price').length, 0);
}

// 3. Out of stock hides; back in stock shows only what the sync hid.
{
  const stock = clone(fx.stock);
  stock['7'].in_stock = false; // BPC-157
  const { actions } = planSync({ feed: fx.feed, stock, map, products });
  assert.deepEqual(actions.map((a) => [a.kind, a.spbc_name]), [['hide', 'BPC-157 10MG']]);

  stock['10'].in_stock = true; // CJC/IPA back
  const back = planSync({ feed: fx.feed, stock, map, products });
  assert.ok(back.actions.some((a) => a.kind === 'show' && a.spbc_name === 'CJC/IPA NO DAC 10MG'));
  const manual = planSync({ feed: fx.feed, stock, map: map.map((m) => (m.supplier_id === 10 ? { ...m, hidden_by_sync: 0 } : m)), products });
  assert.ok(!manual.actions.some((a) => a.kind === 'show'), 'a product Remy hid by hand stays hidden');
}

// 4. New supplier product is reported, never listed; product gone from the feed is hidden.
{
  const feed = clone(fx.feed);
  feed['99'] = { id: 99, name: 'NEW THING 5MG', single_price: 10, bulk_price: 6 };
  delete feed['3']; // KPV gone
  const { actions } = planSync({ feed, stock: fx.stock, map, products });
  assert.ok(actions.some((a) => a.kind === 'new_product' && a.supplier_id === 99 && a.target.kit === 260));
  assert.ok(actions.some((a) => a.kind === 'hide' && a.reason === 'gone_from_supplier' && a.spbc_name === 'KPV 10 MG'));
}

// 5. Wrong pricing tier or a mostly-empty feed stops the run.
assert.match(feedProblem({ tier: 'normal', feed: fx.feed, map }), /tier/);
assert.match(feedProblem({ tier: 'preferred', feed: { 1: fx.feed['1'] }, map }), /only 1 of/);
assert.equal(feedProblem({ tier: 'preferred', feed: fx.feed, map }), null);

console.log('ok: supplier sync plan (formula, holds, stock hide/show, new products, feed guard)');
