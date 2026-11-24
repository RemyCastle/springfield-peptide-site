// Run: node workers/supplier-sync/test/match.test.mjs
import assert from 'node:assert/strict';
import { findSmsMatch, paymentCandidates, trackingUrl } from '../src/match.js';

const sms = [
  { sms: 'SMS-1', name: 'Alex Rivers', date: '2026-11-24T02:00:00Z', ship_to: '1 Test Rd, Eugene, OR 97402', tracking: '9305511000000000000001', carrier: 'USPS', cost: 100 },
  { sms: 'SMS-2', name: 'Alex Rivers', date: '2026-11-01T02:00:00Z', ship_to: '1 Test Rd, Eugene, OR 97402', tracking: '9305511000000000000002', carrier: 'USPS', cost: 90 },
  { sms: 'SMS-3', name: 'Sam Tucker', date: '2026-11-24T03:00:00Z', ship_to: '9 Other St, Bend, OR 97701', tracking: '', carrier: '', cost: 50 },
];
const order = { customer_name: 'Alex Rivers', created_at: '2026-11-23T20:00:00Z', address: { name: 'Alex Rivers', postal: '97402' } };

let m = findSmsMatch(order, null, sms);
assert.equal(m.sms, 'SMS-1', 'older supplier orders (before the website order) are ignored');
assert.equal(m.score, 3);
assert.match(m.tracking_url, /usps\.com/);
assert.equal(findSmsMatch(order, null, sms, new Set(['SMS-1'])), null, 'already linked elsewhere');
assert.equal(findSmsMatch(order, { sms_ref: 'sms-2' }, sms).sms, 'SMS-2', 'typed number wins');
assert.equal(findSmsMatch({ ...order, customer_name: 'Sam T', address: { name: 'Sam T', postal: '11111' } }, null, sms), null, 'initial-only name is not enough');

const unpaid = [
  { order_number: 'A1', customer_name: 'Alex Rivers', total_cents: 36000, created_at: '2026-11-20T00:00:00Z' },
  { order_number: 'A2', customer_name: 'Alex Rivers', total_cents: 9500, created_at: '2026-11-20T00:00:00Z' },
  { order_number: 'B1', customer_name: 'Bea Rivers', total_cents: 36000, created_at: '2026-11-20T00:00:00Z' },
];
const pay = { name: 'Alex Rivers', amount: 360, date: '2026-11-21T00:00:00Z' };
assert.deepEqual(paymentCandidates(pay, unpaid).map((o) => o.order_number), ['A1'], 'exact amount + full name only');
assert.equal(paymentCandidates({ ...pay, date: '2026-12-30T00:00:00Z' }, unpaid).length, 0, 'too long after the order');
assert.equal(paymentCandidates({ ...pay, name: 'Alex R' }, unpaid).length, 0, 'partial name is not enough');
assert.equal(trackingUrl('', '1Z999AA10123456784'), 'https://www.ups.com/track?tracknum=1Z999AA10123456784');
console.log('ok: matching (show-me-source order, payments, tracking links)');
