/**
 * Money tab: customer payments (Venmo emails) paired with show-me-source orders (their emails).
 * GET  /api/admin/money                 -> ledger (totals, months, customers, sales, unpaired)
 * POST /api/admin/money { payment_key, sms?, tag? }
 *        sms: 'SMS-123'  this payment paid for that show-me-source order
 *        tag: 'not_sale' this payment is not a sale (refund, training, friends and family)
 *        neither        undo the decision (back to automatic)
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';
import { buildLedger } from '../../../workers/supplier-sync/src/money.js';
import { loadMoneyEvents } from '../../lib/moneyMail.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const events = await loadMoneyEvents(env.DB);
  const links = (await env.DB.prepare('SELECT payment_key, sms, tag FROM money_links').all()).results;
  const ledger = buildLedger(events, { links });
  return json({
    ...ledger,
    links,
    sms_options: ledger.sales.map((s) => ({ sms: s.sms, customer: s.customer, date: s.date, cost: s.cost })),
    emails: events.length,
  });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const body = await request.json().catch(() => ({}));
  const key = String(body.payment_key || '').trim().slice(0, 120);
  if (!key) return json({ error: 'payment_key required' }, 400);
  const sms = body.sms ? String(body.sms).trim().toUpperCase().slice(0, 20) : null;
  const tag = body.tag === 'not_sale' ? 'not_sale' : null;
  if (sms && !/^SMS-\d+$/.test(sms)) return json({ error: 'validation_failed', message: 'Pick a show-me-source order.' }, 400);
  if (!sms && !tag) {
    await env.DB.prepare('DELETE FROM money_links WHERE payment_key = ?').bind(key).run();
    return json({ ok: true, message: 'Back to automatic matching' });
  }
  await env.DB.prepare(
    "INSERT INTO money_links (payment_key, sms, tag) VALUES (?, ?, ?) ON CONFLICT(payment_key) DO UPDATE SET sms = excluded.sms, tag = excluded.tag, updated_at = datetime('now')"
  )
    .bind(key, sms, tag)
    .run();
  return json({ ok: true, message: sms ? `Linked to ${sms}` : 'Marked as not a sale' });
}
