import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAutoBac,
  isVialOnlyListing,
  lineKind,
  normalizeOrderItems,
} from '../functions/lib/orderItems.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const storeSrc = fs.readFileSync(path.join(root, 'shared/store.js'), 'utf8');
assert.match(storeSrc, /const PUBLIC_KITS_ONLY = false/);
assert.doesNotMatch(storeSrc, /MIN_SINGLE_VIALS/);
assert.doesNotMatch(storeSrc, /singleVials < MIN_SINGLE/);
assert.doesNotMatch(storeSrc, /Single-vial orders need/);
assert.doesNotMatch(storeSrc, /vial minimum met/);
assert.match(storeSrc, /'RETA 66MG': 'GLP-1 \/ metabolic'/);
assert.match(storeSrc, /'SEMAX 10MG': 'Other research'/);
assert.match(storeSrc, /'SS-31 50MG': 'Longevity & mitochondrial'/);
assert.match(storeSrc, /'PE-22-28 10MG': 'Other research'/);
assert.match(storeSrc, /'Tesamorelin 10MG': 'GH secretagogues'/);
assert.match(storeSrc, /'Tesamorelin 20MG': 'GH secretagogues'/);
assert.match(storeSrc, /'RETA 60 MG': 'GLP-1 \/ metabolic'/);
assert.match(storeSrc, /'Tesamorelin': 'GH secretagogues'/);

const catalog = [
  { name: 'TIRZ 10MG', vial_price: 41, pack_price: 345, kit_only: 0, active: 1 },
  { name: 'HGH 10IU', vial_price: null, pack_price: 220, kit_only: 1, active: 1 },
  { name: 'RETA 66MG', vial_price: 70, pack_price: 70, kit_only: 1, active: 1 },
  { name: 'SEMAX 10MG', vial_price: 35, pack_price: 0, kit_only: 0, active: 1 },
  { name: 'BAC WATER 2.5ML', vial_price: 5, pack_price: 12, kit_only: 0, active: 1 },
];

assert.equal(isVialOnlyListing(catalog[2]), true);
assert.equal(isVialOnlyListing(catalog[3]), true);
assert.equal(isVialOnlyListing(catalog[1]), false);

assert.equal(lineKind({ name: 'TIRZ 10MG (Vial)', sku: 'TIRZ-10MG-VIAL' }), 'vial');
assert.equal(lineKind({ name: 'TIRZ 10MG (10-Pack / Kit)', sku: 'TIRZ-10MG-KIT' }), 'kit');

const oneVial = normalizeOrderItems(
  [{ name: 'TIRZ 10MG (Vial)', sku: 'TIRZ-10MG-VIAL', qty: 1 }],
  catalog
);
assert.equal(oneVial.ok, true, '1 vial must be legal');
assert.equal(oneVial.items.length, 1);
assert.equal(oneVial.items[0].unit_price_cents, 4100);
assert.equal(oneVial.items[0].sku, 'TIRZ-10MG-VIAL');
assert.equal(oneVial.peptideKits, 0);

const afterBac = applyAutoBac(
  [...oneVial.items],
  catalog,
  oneVial.peptideKits,
  oneVial.bacKits
);
assert.equal(afterBac.length, 1, 'vial-only orders do not auto-add BAC');

const kitOnlyAsVial = normalizeOrderItems(
  [{ name: 'HGH 10IU (Vial)', sku: 'HGH-10IU-VIAL', qty: 1 }],
  catalog
);
assert.equal(kitOnlyAsVial.ok, false);
assert.match(kitOnlyAsVial.message, /kit-only/i);

const kitOk = normalizeOrderItems(
  [{ name: 'HGH 10IU (Kit)', sku: 'HGH-10IU-KIT', qty: 1 }],
  catalog
);
assert.equal(kitOk.ok, true);
assert.equal(kitOk.items[0].unit_price_cents, 22000);
assert.equal(kitOk.peptideKits, 1);

const kitWithBac = applyAutoBac([...kitOk.items], catalog, kitOk.peptideKits, kitOk.bacKits);
assert.equal(kitWithBac.length, 2);
assert.equal(kitWithBac[1].name, 'BAC WATER 2.5ML (Kit)');

const reta66 = normalizeOrderItems(
  [{ name: 'RETA 66MG (Vial)', sku: 'RETA-66MG-VIAL', qty: 1 }],
  catalog
);
assert.equal(reta66.ok, true, 'RETA 66MG 1 vial must be legal');
assert.equal(reta66.items[0].unit_price_cents, 7000);
assert.equal(reta66.items[0].name, 'RETA 66MG (Vial)');

const reta66AsKit = normalizeOrderItems(
  [{ name: 'RETA 66MG (10-Pack / Kit)', sku: 'RETA-66MG-KIT', qty: 1 }],
  catalog
);
assert.equal(reta66AsKit.ok, false);
assert.match(reta66AsKit.message, /single vial/i);

const packZeroAsKit = normalizeOrderItems(
  [{ name: 'SEMAX 10MG (10-Pack / Kit)', qty: 1 }],
  catalog
);
assert.equal(packZeroAsKit.ok, false);

console.log('ok: 1 vial checks out; RETA 66 is vial-only; HGH stays kit-only; BAC still per kit');
