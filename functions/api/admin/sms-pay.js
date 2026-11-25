/**
 * Admin -> Place Orders -> "Pay show-me-source in crypto" (functions/lib/smsCryptoPay.js).
 *   GET  /api/admin/sms-pay?order=<n>                         the saved payment for that order
 *   POST /api/admin/sms-pay { action: 'start', order_number, token, amount, recipient }
 *        -> { url } solana: link Remy opens in Phantom (he approves it there)
 *   POST /api/admin/sms-pay { action: 'check', order_number } -> finds it on-chain, keeps the TXID
 *   POST /api/admin/sms-pay { action: 'txid', order_number, signature } -> verifies a pasted TXID
 * Nothing here can send money: no key, only public addresses and blockchain reads.
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';
import {
  DEFAULT_RPC,
  DEFAULT_SMS_WALLET,
  TOKENS,
  findByReference,
  isSignature,
  isSolanaAddress,
  newReference,
  rpcClient,
  solanaPayUrl,
  verifySignature,
} from '../../lib/smsCryptoPay.js';

const cleanOrder = (v) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
const rpcOf = (env) => rpcClient(/^https:\/\//.test(String(env.SOLANA_RPC_URL || '')) ? env.SOLANA_RPC_URL : DEFAULT_RPC);
const view = (r) => (r ? { order_number: r.order_number, token: r.token, amount_cents: r.amount_cents, recipient: r.recipient, status: r.status, signature: r.signature, paid_at: r.paid_at } : null);

async function markPaid(db, row, signature) {
  try {
    await db
      .prepare("UPDATE sms_crypto_payments SET status = 'paid', signature = ?, paid_at = datetime('now') WHERE order_number = ? AND status != 'paid'")
      .bind(signature, row.order_number)
      .run();
  } catch {
    return { ok: false, error: 'txid_used', message: 'That transaction is already saved on another order.' };
  }
  // What was paid shows up in profit (only if nothing was entered by hand yet).
  await db
    .prepare(
      `INSERT INTO supplier_orders (order_number, sms_cost) VALUES (?, ?)
       ON CONFLICT(order_number) DO UPDATE SET sms_cost = COALESCE(supplier_orders.sms_cost, excluded.sms_cost)`
    )
    .bind(row.order_number, row.amount_cents / 100)
    .run();
  return { ok: true };
}

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const n = cleanOrder(new URL(request.url).searchParams.get('order'));
  const row = n ? await env.DB.prepare('SELECT * FROM sms_crypto_payments WHERE order_number = ?').bind(n).first() : null;
  return json({ ok: true, default_wallet: DEFAULT_SMS_WALLET, payment: view(row) });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const db = env.DB;
  const b = await request.json().catch(() => ({}));
  const n = cleanOrder(b.order_number);
  if (!n) return json({ error: 'validation_failed', message: 'Order number missing.' }, 400);
  const row = await db.prepare('SELECT * FROM sms_crypto_payments WHERE order_number = ?').bind(n).first();

  if (b.action === 'start') {
    const token = Object.prototype.hasOwnProperty.call(TOKENS, b.token) ? b.token : null;
    const cents = Math.round(Number(String(b.amount || '').replace(/[$,\s]/g, '')) * 100);
    const recipient = String(b.recipient || '').trim();
    if (!token) return json({ error: 'validation_failed', message: 'Pick USDC, USDT or PYUSD.' }, 400);
    if (!Number.isFinite(cents) || cents < 100 || cents > 2000000) return json({ error: 'validation_failed', message: 'Enter the exact amount from their payment screen.' }, 400);
    if (!isSolanaAddress(recipient)) return json({ error: 'validation_failed', message: 'That wallet address is not a valid Solana address. Copy it again from their payment screen.' }, 400);
    if (row && row.status === 'paid') return json({ error: 'already_paid', message: 'This order is already paid.', payment: view(row) }, 409);
    // Same request again keeps its reference (the link already opened in the wallet still matches).
    const same = row && row.token === token && row.amount_cents === cents && row.recipient === recipient;
    const reference = same ? row.reference : newReference();
    if (!same) {
      await db
        .prepare(
          `INSERT INTO sms_crypto_payments (order_number, token, amount_cents, recipient, reference, status)
           VALUES (?, ?, ?, ?, ?, 'pending')
           ON CONFLICT(order_number) DO UPDATE SET token = excluded.token, amount_cents = excluded.amount_cents,
             recipient = excluded.recipient, reference = excluded.reference, created_at = datetime('now')
           WHERE sms_crypto_payments.status != 'paid'`
        )
        .bind(n, token, cents, recipient, reference)
        .run();
    }
    return json({
      ok: true,
      url: solanaPayUrl({ recipient, amountCents: cents, token, reference, orderNumber: n }),
      amount: (cents / 100).toFixed(2),
      token_label: TOKENS[token].label,
      recipient,
      recipient_is_default: recipient === DEFAULT_SMS_WALLET,
    });
  }

  if (!row) return json({ error: 'not_started', message: 'Start the payment first.' }, 404);
  if (row.status === 'paid') return json({ ok: true, status: 'paid', signature: row.signature });

  if (b.action === 'check') {
    try {
      const f = await findByReference(rpcOf(env), row);
      if (f.paid) {
        const m = await markPaid(db, row, f.signature);
        return m.ok ? json({ ok: true, status: 'paid', signature: f.signature }) : json(m, 409);
      }
      if (f.short) return json({ ok: true, status: 'short', received: (Number(f.units) / 1e6).toFixed(2), needed: (row.amount_cents / 100).toFixed(2), signature: f.signature });
      return json({ ok: true, status: 'pending' });
    } catch (e) {
      return json({ ok: true, status: 'pending', note: 'Could not reach Solana just now.' });
    }
  }

  if (b.action === 'txid') {
    const sig = String(b.signature || '').trim();
    if (!isSignature(sig)) return json({ error: 'validation_failed', message: 'That does not look like a Solana transaction ID.' }, 400);
    try {
      const v = await verifySignature(rpcOf(env), row, sig);
      if (!v.paid) {
        return json({ error: 'not_matching', message: `That transaction did not send ${(row.amount_cents / 100).toFixed(2)} ${TOKENS[row.token].label} to the wallet on this payment.` }, 409);
      }
      const m = await markPaid(db, row, sig);
      return m.ok ? json({ ok: true, status: 'paid', signature: sig }) : json(m, 409);
    } catch {
      return json({ error: 'unavailable', message: 'Could not reach Solana just now. Try again in a minute.' }, 502);
    }
  }

  return json({ error: 'bad_action' }, 400);
}
