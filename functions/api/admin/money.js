/**
 * Money tab: customer payments (Venmo emails) paired with show-me-source orders (their emails).
 * GET  /api/admin/money                 -> ledger (totals, months, customers, sales, unpaired)
 * POST /api/admin/money { payment_key, sms?, tag? }
 *        sms: 'SMS-123'  this payment paid for that show-me-source order
 *        tag: 'not_sale' this payment is not a sale (refund, training, friends and family)
 *        neither        undo the decision (back to automatic)
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { ensureSyncSchema, getSetting } from '../../../workers/supplier-sync/src/schema.js';
import { buildLedger, smsOrders, estimateCharge } from '../../../workers/supplier-sync/src/money.js';
import { loadMoneyEvents } from '../../lib/moneyMail.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const events = await loadMoneyEvents(env.DB);
  const links = (await env.DB.prepare('SELECT payment_key, sms, tag FROM money_links').all()).results;
  // SPBC prices keyed by show-me-source product name, for "what they should have paid".
  const { results: pr } = await env.DB.prepare(
    `SELECT m.supplier_name, p.vial_price, p.pack_price FROM supplier_map m JOIN products p ON p.name = m.spbc_name
     WHERE m.skip = 0 AND m.supplier_name IS NOT NULL`
  ).all();
  const prices = new Map(pr.map((r) => [String(r.supplier_name).toLowerCase(), { vial: r.vial_price, kit: r.pack_price }]));
  const ledger = buildLedger(events, { links, prices });
  return json({
    ...ledger,
    bill_check: await billCheck(env.DB, events),
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

/**
 * Supplier bill check: what show-me-source charged for each order vs what it should cost at
 * today's pricing-code prices (+ their shipping). Prices change, so a small gap on an old order
 * can be a price move; a big gap on a recent one is worth a look.
 */
async function billCheck(db, events) {
  const { results } = await db
    .prepare('SELECT supplier_name, single_cost, bulk_cost FROM supplier_map WHERE skip = 0 AND supplier_name IS NOT NULL AND single_cost IS NOT NULL')
    .all();
  if (!results.length) return { ready: false, orders: [] };
  const costs = new Map(
    results.map((r) => [String(r.supplier_name).toLowerCase(), { vial: r.single_cost, kit: r.bulk_cost ? Math.round(r.bulk_cost * 10 * 100) / 100 : null }])
  );
  const ship = Number(await getSetting(db, 'sms_ship_cost', '0')) || 8;
  const orders = smsOrders(events)
    .slice(-40)
    .map((o) => {
      const est = estimateCharge(o.items, costs, ship);
      const charged = o.cost ?? o.invoice;
      const diff = est.total && charged != null && !est.unknown ? Math.round((charged - est.total) * 100) / 100 : null;
      return { sms: o.sms, date: o.date, name: o.name, items: o.items, charged, expected: est.total || null, diff, flag: diff != null && diff > 2 };
    })
    .reverse();
  return { ready: true, ship, orders };
}
