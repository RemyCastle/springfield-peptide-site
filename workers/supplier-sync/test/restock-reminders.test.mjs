// Restock reminders: the site endpoint stores one row per order, the daily job sends it once.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureSyncSchema } from '../src/schema.js';
import { restockReminders } from '../src/customers.js';
import { onRequestPost } from '../../../functions/api/restock-reminder.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (l) => { const o = []; for (const s of l) o.push(await s.run()); return o; } };
}

const mails = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/admin/orders/SP1')) {
    return Response.json({ order: { order_number: 'SP1', customer_email: 'buyer@example.com', customer_name: 'Sam Buyer' },
      items: [{ name: 'BPC-157 10MG (Vial)', sku: 'BPC-157-10MG-VIAL', qty: 2 }, { name: 'SEMA 10MG (Kit (10))', sku: 'SEMA-10MG-KIT', qty: 1 }] });
  }
  if (u.includes('/admin/orders/')) return Response.json({ error: 'not_found' }, { status: 404 });
  if (u.includes('resend')) { mails.push(JSON.parse(init.body)); return Response.json({ id: 'm1' }); }
  return Response.json({}, { status: 404 });
};

const db = d1();
await ensureSyncSchema(db);
const env = { DB: db, ORDERS_ADMIN_TOKEN: 't', ORDERS_API_URL: 'https://orders.test', SPBC_ORDERS_URL: 'https://orders.test', RESEND_API_KEY: 'k', RESTOCK_FROM: 'SPBC <x@y.z>', SITE_URL: 'https://springfieldpbc.com' };
const post = async (body) => {
  const r = await onRequestPost({ env, request: new Request('https://s/api/restock-reminder', { method: 'POST', body: JSON.stringify(body) }) });
  return r.status;
};

assert.equal(await post({ order_number: 'SP1', email: 'other@example.com', days: 30 }), 404);
assert.equal(await post({ order_number: 'SP1', email: 'buyer@example.com', days: 10 }), 400);
assert.equal(await post({ order_number: 'SP1', email: 'buyer@example.com', days: 30 }), 200);
let row = db.raw.prepare('SELECT * FROM restock_reminders').get();
assert.deepEqual(JSON.parse(row.cart_json), { 'BPC-157 10MG': { vial: 2, pack: 0 }, 'SEMA 10MG': { vial: 0, pack: 1 } });

assert.deepEqual(await restockReminders(env, db), { sent: 0 }, 'not due yet');
db.raw.prepare("UPDATE restock_reminders SET due_at = datetime('now', '-1 minute')").run();
assert.deepEqual(await restockReminders(env, db), { sent: 1 });
assert.equal(mails.length, 1);
assert.match(mails[0].html, /\/\?cart=[A-Za-z0-9_-]+/);
assert.match(mails[0].html, /SEMA 10MG · 1 kit/);
assert.deepEqual(await restockReminders(env, db), { sent: 0 }, 'sent once only');
assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM restock_reminders').get().n, 0, 'row removed after sending');

assert.equal(await post({ order_number: 'SP1', email: 'buyer@example.com', days: 0 }), 200);
assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM restock_reminders').get().n, 0);
console.log('restock-reminders.test: ok');
