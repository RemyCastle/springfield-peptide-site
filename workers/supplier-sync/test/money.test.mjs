// Run: node workers/supplier-sync/test/money.test.mjs
// Made-up people; email shapes copied from real Venmo / show-me-source emails.
import assert from 'node:assert/strict';
import { parseMoneyMail, buildLedger, nameScore } from '../src/money.js';

const venmoIn = (id, name, amount, date, note, fee) => ({
  id,
  from_addr: 'venmo@venmo.com',
  subject: `${name} paid you $${amount}`,
  html_body: `<p>${name} paid you $${amount}</p><p>${name} paid you</p><p>$</p><p>${amount.split('.')[0]}</p><p>. ${amount.split('.')[1]}</p><p>${note}</p><p>See transaction</p>
    ${fee ? `<p>You were paid for a good or service and were charged a $${fee} fee.</p>` : ''}
    <p>Transaction details</p><p>Date</p><p>${date}</p><p>Transaction ID</p><p>T${id}</p><p>Sent to</p><p>@Someone</p>${'<p>padding text for length</p>'.repeat(10)}`,
});
const venmoOut = (id, name, amount, date, note) => ({
  id,
  from_addr: 'venmo@venmo.com',
  subject: `You paid ${name} $${amount}`,
  html_body: `<p>You paid ${name}</p><p>$</p><p>${amount.split('.')[0]}</p><p>. ${amount.split('.')[1]}</p><p>${note}</p><p>See transaction</p><p>Date</p><p>${date}</p><p>Transaction ID</p><p>O${id}</p>${'<p>padding</p>'.repeat(20)}`,
});
const sms = (id, order, stage, name, sent, extra = '') => ({
  id,
  from_addr: 'service@show-me-source.com',
  subject: `${{ invoice: 'Payment Required', paid: 'Payment Confirmed', tracking: 'Tracking Created' }[stage]} - Order ${order}`,
  sent_at: sent,
  html_body: `<p>SHOW ME SOURCE</p><p>Hi ${name} ,</p>${extra}`,
});

const rows = [
  venmoIn(1, 'Alex Rivers', '550.05', 'Nov 23, 2026', '2 kit', '16.95'),
  venmoIn(2, 'Jo Banks', '94.00', 'Nov 20, 2026', 'AB12CD34EF'),
  venmoIn(3, 'Pat Training', '1,435.00', 'Oct 15, 2026', 'Training refund'),
  venmoOut(4, 'JJ JJ', '98.00', 'Oct 30, 2026', '🥜'),
  sms(10, 'SMS-900', 'invoice', 'Alex Rivers', '2026-11-24T01:00:00Z', '<p>Exact amount: 316.57 PYUSD</p>'),
  sms(11, 'SMS-900', 'paid', 'Alex Rivers', '2026-11-24T01:10:00Z', '<p>Amount received: 316.57 PYUSD</p>'),
  sms(12, 'SMS-900', 'tracking', 'Alex Rivers', '2026-11-24T05:00:00Z',
    '<p>Carrier: USPS</p><p>Tracking number: 9305511000000000000001</p><p>Items: R 30 MG x20 (20 @ $15.00) = $300.00</p><p>Shipping to: 1 Test Rd, Eugene, OR 97402</p><p>Total paid: $316.57</p>'),
  sms(13, 'SMS-901', 'paid', 'Sam T', '2026-10-30T02:00:00Z', '<p>Amount received: 98.00 USDT</p>'),
  sms(14, 'SMS-902', 'invoice', 'Nobody Paid', '2026-10-01T00:00:00Z', '<p>Exact amount: 50.00 USDT</p>'),
];

const ev = rows.map(parseMoneyMail);
assert.deepEqual(
  { type: ev[0].type, name: ev[0].name, amount: ev[0].amount, fee: ev[0].fee, note: ev[0].note },
  { type: 'in', name: 'Alex Rivers', amount: 550.05, fee: 16.95, note: '2 kit' }
);
assert.equal(ev[1].note, 'AB12CD34EF', 'website order code in the Venmo note');
assert.equal(ev[2].amount, 1435);
assert.equal(ev[3].type, 'out');
assert.equal(ev[3].name, 'JJ JJ');
assert.equal(ev[6].stage, 'tracking');
assert.equal(ev[6].tracking, '9305511000000000000001');
assert.equal(ev[6].carrier, 'USPS');
assert.equal(ev[6].amount, 316.57);
assert.match(ev[6].ship_to, /Eugene, OR 97402/);
assert.equal(ev[8].stage, 'invoice');

// Names
assert.equal(nameScore('Nathan Milkowski', 'Nate Milkowski'), 2, 'nickname');
assert.equal(nameScore('Ashley Bruington', 'Ashley Bruingtom'), 2, 'one-letter typo');
assert.equal(nameScore('Sam T', 'Sam Tucker'), 1, 'initial only = likely');
assert.equal(nameScore('Austin Kocian', 'Tammy Kocian'), 1, 'same family = likely');
assert.equal(nameScore('Alex Rivers', 'Jo Banks'), 0);

// Ledger
let L = buildLedger(ev);
const sale = L.sales.find((s) => s.sms === 'SMS-900');
assert.equal(sale.cost, 316.57);
assert.equal(sale.money_in, 550.05);
assert.equal(sale.fees, 16.95);
assert.equal(sale.profit, 216.53);
assert.equal(sale.tracking, '9305511000000000000001');
assert.ok(!L.sales.some((s) => s.sms === 'SMS-902'), 'an unpaid bill is not a cost');
const sam = L.sales.find((s) => s.sms === 'SMS-901');
assert.equal(sam.paid_supplier_via, 'Venmo to JJ JJ', 'supplier paid by Venmo is not counted twice');
assert.ok(!L.other_out.some((o) => o.name === 'JJ JJ'));
assert.equal(L.unmatched_in.length, 2, 'Jo Banks + Pat Training not paired');

// Manual decisions: training refund is not a sale; Jo's payment belongs to SMS-901.
L = buildLedger(ev, {
  links: [
    { payment_key: 'T3', tag: 'not_sale' },
    { payment_key: 'T2', sms: 'SMS-901' },
  ],
});
assert.equal(L.unmatched_in.length, 0);
assert.equal(L.sales.find((s) => s.sms === 'SMS-901').profit, -4);
assert.equal(L.totals.sales, 2);
const alex = L.customers.find((c) => /Alex Rivers/.test(c.customer));
assert.equal(alex.profit, 216.53);
console.log('ok: money ledger (Venmo + show-me-source readers, name matching, pairing, manual links)');
// A linked payment counts for the order's customer in the per-customer table.
const L2 = buildLedger(ev, { links: [{ payment_key: 'T2', sms: 'SMS-901' }] });
const samGroup = L2.customers.find((c) => /Sam T/.test(c.customer));
assert.equal(samGroup.money_in, 94);
assert.ok(!L2.customers.some((c) => c.customer === 'Jo Banks'));
console.log('ok: linked payments group under the order customer');
