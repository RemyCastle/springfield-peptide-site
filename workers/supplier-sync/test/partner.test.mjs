// Run: node workers/supplier-sync/test/partner.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partnerPriceList } from '../src/partner.js';
import { SEED_MAP } from '../src/seedMap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, 'sms-fixture-2026-11-23.json'), 'utf8'));
const map = SEED_MAP.map((m) => ({ ...m, skip: m.skip ? 1 : 0 }));
const list = partnerPriceList({ feed: fx.feed, stock: fx.stock, map });

assert.ok(list.length > 10, 'has products');
for (const p of list) {
  assert.deepEqual(Object.keys(p).sort(), ['in_stock', 'kit_cents', 'kit_only', 'low_stock', 'name', 'vial_cents']);
}
// Formula check on one mapped product.
const m = map.find((x) => !x.skip && fx.feed[String(x.supplier_id)] && !fx.feed[String(x.supplier_id)].kits_only && Number(fx.feed[String(x.supplier_id)].single_price) > 0);
const sp = fx.feed[String(m.supplier_id)];
const row = list.find((p) => p.name === m.spbc_name);
assert.equal(row.vial_cents, Math.round((Number(sp.single_price) + 15) * 100));
assert.equal(row.kit_cents, Math.round((Number(sp.bulk_price) * 10 + 100) * 100));
// No supplier data leaks: no supplier names/ids/prices in the JSON.
const text = JSON.stringify(list);
assert.ok(!/supplier|single_price|bulk_price/i.test(text));
// Skipped items excluded.
for (const s of map.filter((x) => x.skip)) assert.ok(!list.some((p) => p.name === s.spbc_name && !map.some((y) => !y.skip && y.spbc_name === s.spbc_name)));
// Custom markups.
const l2 = partnerPriceList({ feed: fx.feed, stock: fx.stock, map }, { vialMarkup: 0, kitMarkup: 0 });
assert.equal(l2.find((p) => p.name === m.spbc_name).vial_cents, Math.round(Number(sp.single_price) * 100));
console.log('partner.test: ok', list.length, 'products');
