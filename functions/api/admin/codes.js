/**
 * Admin: discount codes, custom prices per code, referral credit and store credit.
 *
 * GET  -> { codes, prices: { CODE: [...] }, products: [{ name, vial_cents, kit_cents, vial_cost, kit_cost }],
 *           balances: [{ email, balance_cents, earned_cents }], uses: [...] }
 * POST { action: 'save', code, label, owner_name, owner_email, pct_off, credit_pct, active }
 * POST { action: 'prices', code, prices: [{ product, vial_cents|null, kit_cents|null }] }  (never below cost)
 * POST { action: 'adjust_credit', email, cents, note }
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { CODE_RE, ensureCodeTables, normalizeCode, productCosts, SQUASH } from '../../../workers/supplier-sync/src/codes.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const toCents = (d) => (d == null || d === '' ? null : Math.round(Number(d) * 100));
const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureCodeTables(db);
  const [codes, priceRows, products, costs, balances, uses] = await Promise.all([
    all(
      db,
      `SELECT c.*, (SELECT COUNT(*) FROM code_uses u WHERE u.code = c.code AND u.status != 'void') AS uses,
              (SELECT COALESCE(SUM(u.credit_cents),0) FROM code_uses u WHERE u.code = c.code AND u.status = 'earned') AS credit_earned_cents,
              (SELECT COALESCE(SUM(u.products_paid_cents),0) FROM code_uses u WHERE u.code = c.code AND u.status = 'earned') AS sales_cents
         FROM discount_codes c ORDER BY c.active DESC, c.code`
    ),
    all(db, 'SELECT code, product, vial_cents, kit_cents FROM discount_code_prices ORDER BY code, product'),
    all(db, 'SELECT name, vial_price, pack_price, kit_only FROM products WHERE active = 1 ORDER BY sort_order, name'),
    productCosts(db),
    all(
      db,
      `SELECT email, SUM(CASE WHEN status IN ('final','held') THEN cents ELSE 0 END) AS balance_cents,
              SUM(CASE WHEN kind = 'earned' THEN cents ELSE 0 END) AS earned_cents
         FROM store_credit GROUP BY email ORDER BY balance_cents DESC`
    ),
    all(db, 'SELECT * FROM code_uses ORDER BY created_at DESC LIMIT 100'),
  ]);
  const prices = {};
  for (const r of priceRows) (prices[r.code] = prices[r.code] || []).push(r);
  return json({
    ok: true,
    codes,
    prices,
    products: products.map((p) => {
      const cost = costs.get(SQUASH(p.name)) || {};
      return {
        name: p.name,
        vial_cents: p.kit_only ? null : toCents(p.vial_price),
        kit_cents: toCents(p.pack_price),
        vial_cost: cost.vial ?? null,
        kit_cost: cost.kit ?? null,
      };
    }),
    balances,
    uses,
  });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureCodeTables(db);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').toLowerCase();

  if (action === 'save') {
    const code = normalizeCode(body.code);
    if (!CODE_RE.test(code)) return json({ error: 'validation_failed', message: 'Codes are 3 to 24 letters, numbers or dashes.' }, 400);
    const pct = Number(body.pct_off) || 0;
    const credit = Number(body.credit_pct) || 0;
    if (pct < 0 || pct > 90 || credit < 0 || credit > 50) return json({ error: 'validation_failed', message: 'Discount must be 0 to 90%, credit 0 to 50%.' }, 400);
    const ownerEmail = String(body.owner_email || '').trim().toLowerCase();
    if (credit > 0 && !EMAIL_RE.test(ownerEmail)) {
      return json({ error: 'validation_failed', message: 'A referral code needs the owner’s email (that is where the credit goes).' }, 400);
    }
    if (ownerEmail && !EMAIL_RE.test(ownerEmail)) return json({ error: 'validation_failed', message: 'That owner email does not look right.' }, 400);
    await db
      .prepare(
        `INSERT INTO discount_codes (code, label, owner_name, owner_email, pct_off, credit_pct, active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(code) DO UPDATE SET label = excluded.label, owner_name = excluded.owner_name, owner_email = excluded.owner_email,
           pct_off = excluded.pct_off, credit_pct = excluded.credit_pct, active = excluded.active, updated_at = datetime('now')`
      )
      .bind(
        code,
        String(body.label || '').trim().slice(0, 80) || null,
        String(body.owner_name || '').trim().slice(0, 80) || null,
        ownerEmail || null,
        pct,
        credit,
        body.active === false ? 0 : 1
      )
      .run();
    return json({ ok: true, code, message: `Saved ${code}.` });
  }

  if (action === 'prices') {
    const code = normalizeCode(body.code);
    if (!(await db.prepare('SELECT 1 FROM discount_codes WHERE code = ?').bind(code).first())) return json({ error: 'not_found' }, 404);
    const costs = await productCosts(db);
    const list = new Map(
      (await all(db, 'SELECT name, vial_price, pack_price FROM products WHERE active = 1')).map((p) => [SQUASH(p.name), p])
    );
    const rows = Array.isArray(body.prices) ? body.prices.slice(0, 300) : [];
    const problems = [];
    const stmts = [db.prepare('DELETE FROM discount_code_prices WHERE code = ?').bind(code)];
    for (const r of rows) {
      const name = String(r.product || '').trim();
      const p = list.get(SQUASH(name));
      if (!p) continue;
      const cost = costs.get(SQUASH(name)) || {};
      const vial = r.vial_cents == null || r.vial_cents === '' ? null : Math.round(Number(r.vial_cents));
      const kit = r.kit_cents == null || r.kit_cents === '' ? null : Math.round(Number(r.kit_cents));
      if (vial == null && kit == null) continue;
      if (vial != null && cost.vial != null && vial < cost.vial) problems.push(`${name} vial: $${(vial / 100).toFixed(2)} is below your cost $${(cost.vial / 100).toFixed(2)}`);
      if (kit != null && cost.kit != null && kit < cost.kit) problems.push(`${name} kit: $${(kit / 100).toFixed(2)} is below your cost $${(cost.kit / 100).toFixed(2)}`);
      if ((vial != null && vial <= 0) || (kit != null && kit <= 0)) problems.push(`${name}: prices must be above $0`);
      stmts.push(
        db.prepare('INSERT INTO discount_code_prices (code, product, vial_cents, kit_cents) VALUES (?, ?, ?, ?)').bind(code, p.name, vial, kit)
      );
    }
    if (problems.length) return json({ error: 'below_cost', message: 'Nothing saved. ' + problems.join('; ') }, 400);
    await db.batch(stmts);
    return json({ ok: true, saved: stmts.length - 1, message: `Saved ${stmts.length - 1} price${stmts.length - 1 === 1 ? '' : 's'} for ${code}.` });
  }

  if (action === 'adjust_credit') {
    const email = String(body.email || '').trim().toLowerCase();
    const cents = Math.round(Number(body.cents));
    if (!EMAIL_RE.test(email) || !Number.isFinite(cents) || cents === 0 || Math.abs(cents) > 100000) {
      return json({ error: 'validation_failed', message: 'Enter an email and an amount (use a minus sign to take credit away).' }, 400);
    }
    await db
      .prepare(`INSERT INTO store_credit (email, cents, kind, note, status) VALUES (?, ?, 'adjust', ?, 'final')`)
      .bind(email, cents, String(body.note || 'Changed by Remy').slice(0, 200))
      .run();
    return json({ ok: true, message: `${cents > 0 ? 'Added' : 'Removed'} $${(Math.abs(cents) / 100).toFixed(2)} ${cents > 0 ? 'to' : 'from'} ${email}.` });
  }

  return json({ error: 'bad_action' }, 400);
}
