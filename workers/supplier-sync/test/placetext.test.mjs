import assert from 'node:assert/strict';
import { placeTextBody } from '../src/jobs.js';
const body = placeTextBody(
  { order_number: 'L1IL2052J9', customer_name: 'Jane Doe' },
  [{ name: 'KPV 10 MG (Vial)', sku: 'KPV-VIAL', qty: 2 }, { name: 'BPC-157 10MG (10-Pack / Kit)', sku: 'BPC', qty: 1 }, { name: 'Sales tax', sku: 'SALES-TAX', qty: 1 }],
  'https://springfieldpbc.com/admin?place=L1IL2052J9#place'
);
assert.equal(body, 'SPBC paid L1IL2052J9 (Jane): KPV 10 MG vial x2, BPC-157 10MG kit x1. Place it: https://springfieldpbc.com/admin?place=L1IL2052J9#place');
console.log('ok: place text', body.length, 'chars');
