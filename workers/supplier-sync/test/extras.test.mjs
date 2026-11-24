// Run: node workers/supplier-sync/test/extras.test.mjs
import assert from 'node:assert/strict';
import { coaUrlFrom } from '../src/extras.js';
import { supplierUnitCost } from '../src/schema.js';

const B = 'https://show-me-source.com';
assert.equal(coaUrlFrom({ coa: 'coas/r30.pdf' }, B), 'https://show-me-source.com/coas/r30.pdf');
assert.equal(coaUrlFrom({ coa: '', coas: [{ url: '/coas/a.jpg' }] }, B), 'https://show-me-source.com/coas/a.jpg');
assert.equal(coaUrlFrom({ coas: ['coas/b.png'] }, B), 'https://show-me-source.com/coas/b.png');
assert.equal(coaUrlFrom({ coa: 'https://evil.example/x.pdf' }, B), null, 'other hosts are refused');
assert.equal(coaUrlFrom({ coa: 'https://show-me-source.com/pending' }, B), null, 'pending placeholder is not a report');
assert.equal(coaUrlFrom({ coa: '', coas: [] }, B), null);
assert.equal(coaUrlFrom(null, B), null);

assert.equal(supplierUnitCost({ name: 'RETA 30MG (Vial)', unit_price_cents: 4900 }), 24);
assert.equal(supplierUnitCost({ name: 'RETA 30MG (10-Pack / Kit)', unit_price_cents: 34500 }), 145);
assert.equal(supplierUnitCost({ name: 'MOTS-C 10MG (Kit)', sku: 'MOTS-C-10MG-KIT', unit_price_cents: 27000 }), 70);
console.log('ok: lab report links, supplier cost');
