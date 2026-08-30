import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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
assert.match(storeSrc, /'BAC WATER 2.5ML': 'Supplies'/);
assert.match(storeSrc, /'BAC WATER 3ML': 'Supplies'/);
assert.match(storeSrc, /'BAC WATER 10 ML': 'Supplies'/);
assert.doesNotMatch(storeSrc, /AUTO_BAC_PREFERRED/);
assert.doesNotMatch(storeSrc, /applyAutoBac/);
assert.doesNotMatch(storeSrc, /findBacCard/);
assert.doesNotMatch(storeSrc, /BAC water included/);
assert.doesNotMatch(storeSrc, /included with every kit/);

const orderItemsSrc = fs.readFileSync(path.join(root, 'functions/lib/orderItems.js'), 'utf8');
assert.doesNotMatch(orderItemsSrc, /applyAutoBac/);
assert.doesNotMatch(orderItemsSrc, /resolveBacRow/);

const headerSrc = fs.readFileSync(path.join(root, 'src/partials/header.html'), 'utf8');
assert.doesNotMatch(headerSrc, /stacks\.html/);
assert.doesNotMatch(headerSrc, /coaching\.html/);
assert.match(headerSrc, /calculator\.html/);
assert.match(headerSrc, /contact\.html/);

const indexPageSrc = fs.readFileSync(path.join(root, 'src/pages/index.html'), 'utf8');
assert.doesNotMatch(indexPageSrc, /Coaching · \$100\/hr/);
assert.doesNotMatch(indexPageSrc, /protocol coaching/);
assert.doesNotMatch(indexPageSrc, /coaching\.html/);
assert.match(indexPageSrc, /cta_secondary_href: \/calculator\.html/);

const contactBody = fs.readFileSync(path.join(root, 'src/pages/contact.body.html'), 'utf8');
assert.doesNotMatch(contactBody, /coaching\.html/);
assert.doesNotMatch(contactBody, /Coaching/);

const redirects = fs.readFileSync(path.join(root, '_redirects'), 'utf8');
assert.match(redirects, /\/stacks\s+\/\s+301/);
assert.match(redirects, /\/stacks\.html\s+\/\s+301/);
assert.match(redirects, /\/coaching\s+\/\s+301/);
assert.match(redirects, /\/coaching\.html\s+\/\s+301/);

assert.equal(fs.existsSync(path.join(root, 'stacks.html')), false);
assert.equal(fs.existsSync(path.join(root, 'coaching.html')), false);
assert.equal(fs.existsSync(path.join(root, 'src/pages/stacks.html')), false);
assert.equal(fs.existsSync(path.join(root, 'src/pages/coaching.html')), false);
assert.equal(fs.existsSync(path.join(root, 'functions/api/coaching-request.js')), false);
assert.equal(fs.existsSync(path.join(root, 'shared/stacks.js')), false);
assert.equal(fs.existsSync(path.join(root, 'shared/stacks-page.js')), false);
assert.equal(fs.existsSync(path.join(root, 'shared/coaching.js')), false);

for (const page of ['index.html', 'calculator.html', 'contact.html', 'titration.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert.doesNotMatch(html, /href="\/stacks\.html"/, `${page} must not link to stacks`);
  assert.doesNotMatch(html, /href="\/coaching\.html"/, `${page} must not link to coaching`);
  assert.doesNotMatch(html, /Coaching · \$100\/hr/, `${page} must not advertise coaching`);
  assert.doesNotMatch(html, /Common Stacks/, `${page} must not advertise stacks`);
}

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
assert.equal(oneVial.bacKits, 0);

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
assert.equal(kitOk.bacKits, 0);
assert.equal(kitOk.items.length, 1, 'kits do not auto-add BAC');
assert.equal(
  kitOk.items.some((it) => /bac\s*water/i.test(it.name)),
  false,
  'kit-only order must not inject a BAC line'
);

const kitPlusBac = normalizeOrderItems(
  [
    { name: 'HGH 10IU (Kit)', sku: 'HGH-10IU-KIT', qty: 1 },
    { name: 'BAC WATER 2.5ML (Kit)', sku: 'BAC-WATER-2-5ML-KIT', qty: 1 },
  ],
  catalog
);
assert.equal(kitPlusBac.ok, true, 'customer-added BAC stays on the order');
assert.equal(kitPlusBac.items.length, 2);
assert.equal(kitPlusBac.peptideKits, 1);
assert.equal(kitPlusBac.bacKits, 1);
assert.equal(kitPlusBac.items[1].name, 'BAC WATER 2.5ML (10-Pack / Kit)');
assert.equal(kitPlusBac.items[1].unit_price_cents, 1200);

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

console.log('ok: 1 vial checks out; RETA 66 is vial-only; HGH stays kit-only; BAC is optional, not auto-added; stacks and coaching are gone');
