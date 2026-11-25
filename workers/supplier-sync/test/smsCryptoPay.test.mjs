// Run: node workers/supplier-sync/test/smsCryptoPay.test.mjs
// Paying show-me-source in stablecoins: address check, link, finding the transfer, TXID rules.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSessionCookie } from '../../../functions/lib/auth.js';
import { onRequestGet, onRequestPost } from '../../../functions/api/admin/sms-pay.js';
import { DEFAULT_SMS_WALLET, TOKENS, isSolanaAddress, receivedUnits, solanaPayUrl } from '../../../functions/lib/smsCryptoPay.js';

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

// Address checks: the wallet Remy gave, Remy's own, and near-misses.
assert.equal(isSolanaAddress(DEFAULT_SMS_WALLET), true);
assert.equal(DEFAULT_SMS_WALLET, 'BN8MBPbnnhLPX4843q4qVcm7JqiKXVyfzjHnS7RUDL5s');
assert.equal(isSolanaAddress('BjVNkUAw5eckQ5wuh4GaayYa7unceQYPWhnzGX5vuLXE'), true);
assert.equal(isSolanaAddress('0x' + 'a'.repeat(40)), false);
assert.equal(isSolanaAddress(DEFAULT_SMS_WALLET.slice(0, 40)), false, 'cut-off copy is caught');

// Link carries recipient, exact amount, token mint and reference.
const u = new URL(solanaPayUrl({ recipient: DEFAULT_SMS_WALLET, amountCents: 20850, token: 'pyusd', reference: 'REF', orderNumber: 'K7Q' }));
assert.equal(u.protocol, 'solana:');
assert.equal(u.pathname, DEFAULT_SMS_WALLET);
assert.equal(u.searchParams.get('amount'), '208.50');
assert.equal(u.searchParams.get('spl-token'), TOKENS.pyusd.mint);
assert.equal(u.searchParams.get('reference'), 'REF');

// Only what the recipient gained, in that token, in a successful transaction.
const tx = (units, { owner = DEFAULT_SMS_WALLET, mint = TOKENS.usdc.mint, err = null } = {}) => ({
  meta: { err, preTokenBalances: [{ accountIndex: 2, owner, mint, uiTokenAmount: { amount: '0' } }], postTokenBalances: [{ accountIndex: 2, owner, mint, uiTokenAmount: { amount: String(units) } }] },
});
assert.equal(receivedUnits(tx(5000000), DEFAULT_SMS_WALLET, TOKENS.usdc.mint), 5000000n);
assert.equal(receivedUnits(tx(5000000, { owner: 'x' }), DEFAULT_SMS_WALLET, TOKENS.usdc.mint), 0n);
assert.equal(receivedUnits(tx(5000000, { err: {} }), DEFAULT_SMS_WALLET, TOKENS.usdc.mint), 0n);

// ---- endpoint, with a fake blockchain
const db = d1();
db.raw.exec('CREATE TABLE supplier_map (supplier_id INTEGER PRIMARY KEY, supplier_name TEXT, spbc_name TEXT, skip INTEGER NOT NULL DEFAULT 0, hidden_by_sync INTEGER NOT NULL DEFAULT 0)');
db.raw.exec("INSERT INTO supplier_map (supplier_id, supplier_name, spbc_name) VALUES (1, 'x', 'x')");
const env = { DB: db, ADMIN_SESSION_SECRET: 'local-test-only-secret-123456' };
const cookie = (await createSessionCookie(env)).split(';')[0];
const chain = { byRef: {}, txs: {} };
globalThis.fetch = async (_url, init) => {
  const { method, params } = JSON.parse(init.body);
  const result = method === 'getSignaturesForAddress' ? (chain.byRef[params[0]] || []).map((s) => ({ signature: s, err: null })) : chain.txs[params[0]] || null;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
};
const post = async (body, signedIn = true) => {
  const r = await onRequestPost({ request: new Request('https://springfieldpbc.com/api/admin/sms-pay', { method: 'POST', headers: signedIn ? { cookie } : {}, body: JSON.stringify(body) }), env });
  return [r.status, await r.json()];
};
const SIG1 = '5'.repeat(88);
const SIG2 = '4'.repeat(88);

let [st, d] = await post({ action: 'start', order_number: 'K7Q', token: 'usdc', amount: '208.50', recipient: DEFAULT_SMS_WALLET }, false);
assert.equal(st, 401);
[st, d] = await post({ action: 'start', order_number: 'K7Q', token: 'usdc', amount: '208.50', recipient: 'nope' });
assert.equal(st, 400);
[st, d] = await post({ action: 'start', order_number: 'K7Q', token: 'doge', amount: '208.50', recipient: DEFAULT_SMS_WALLET });
assert.equal(st, 400);
[st, d] = await post({ action: 'start', order_number: 'K7Q', token: 'usdc', amount: '$208.50', recipient: DEFAULT_SMS_WALLET });
assert.equal(st, 200, JSON.stringify(d));
assert.equal(d.amount, '208.50');
assert.equal(d.recipient_is_default, true);
const ref = new URL(d.url).searchParams.get('reference');
// Same request again keeps the same reference (a link already opened in the wallet still matches).
[st, d] = await post({ action: 'start', order_number: 'K7Q', token: 'usdc', amount: '208.50', recipient: DEFAULT_SMS_WALLET });
assert.equal(new URL(d.url).searchParams.get('reference'), ref);

// Nothing sent yet.
[st, d] = await post({ action: 'check', order_number: 'K7Q' });
assert.equal(d.status, 'pending');
// Short payment is reported, not accepted.
chain.byRef[ref] = [SIG2];
chain.txs[SIG2] = tx(200000000);
[st, d] = await post({ action: 'check', order_number: 'K7Q' });
assert.equal(d.status, 'short');
assert.equal(d.received, '200.00');
// Full payment: paid, TXID kept, cost recorded for profit.
chain.byRef[ref] = [SIG1];
chain.txs[SIG1] = tx(208500000);
[st, d] = await post({ action: 'check', order_number: 'K7Q' });
assert.deepEqual([d.status, d.signature], ['paid', SIG1]);
assert.equal(db.raw.prepare("SELECT sms_cost FROM supplier_orders WHERE order_number = 'K7Q'").get().sms_cost, 208.5);
const g = await (await onRequestGet({ request: new Request('https://springfieldpbc.com/api/admin/sms-pay?order=K7Q', { headers: { cookie } }), env })).json();
assert.equal(g.payment.signature, SIG1);
// Paid orders cannot be restarted.
[st] = await post({ action: 'start', order_number: 'K7Q', token: 'usdc', amount: '1.00', recipient: DEFAULT_SMS_WALLET });
assert.equal(st, 409);

// Pasted TXID: must pay this wallet the amount in that token; one TXID never counts for two orders.
await post({ action: 'start', order_number: 'Z9Z', token: 'usdt', amount: '50.00', recipient: DEFAULT_SMS_WALLET });
[st, d] = await post({ action: 'txid', order_number: 'Z9Z', signature: 'not-a-txid' });
assert.equal(st, 400);
chain.txs[SIG2] = tx(50000000, { mint: TOKENS.usdc.mint });
[st, d] = await post({ action: 'txid', order_number: 'Z9Z', signature: SIG2 });
assert.equal(st, 409, 'USDC sent but the payment was set up as USDT');
chain.txs[SIG1] = tx(50000000, { mint: TOKENS.usdt.mint });
[st, d] = await post({ action: 'txid', order_number: 'Z9Z', signature: SIG1 });
assert.equal(st, 409, 'TXID already used for K7Q');
assert.equal(d.error, 'txid_used');

console.log('smsCryptoPay: ok');
