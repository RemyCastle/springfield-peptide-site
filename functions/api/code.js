/**
 * GET /api/code?c=CODE  -> the prices this code gives on every product, for the cart preview.
 * The server applies the code again when the order is placed (this is display only).
 */
import { json } from '../lib/auth.js';
import { clientIp, overLimit } from '../lib/siteMail.js';
import { codePriceMap, ensureCodeTables, getCode, productCosts, SQUASH, unitCodePrice } from '../../workers/supplier-sync/src/codes.js';

const cents = (d) => (d == null || d === '' ? null : Math.round(Number(d) * 100));

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  // Codes are short: cap lookups so they cannot be guessed by brute force.
  if (await overLimit(env.DB, `code:${clientIp(request)}`, 30, 60)) {
    return json({ error: 'too_many', message: 'Too many tries. Please wait a few minutes.' }, 429);
  }
  await ensureCodeTables(env.DB);
  const code = await getCode(env.DB, new URL(request.url).searchParams.get('c'));
  if (!code || !Number(code.active)) return json({ error: 'bad_code', message: 'That code is not valid.' }, 404);
  const [custom, costs, rows] = await Promise.all([
    codePriceMap(env.DB, code.code),
    productCosts(env.DB),
    env.DB.prepare('SELECT name, vial_price, pack_price FROM products WHERE active = 1').all(),
  ]);
  const prices = {};
  for (const p of rows.results || []) {
    const key = SQUASH(p.name);
    const vial = cents(p.vial_price);
    const kit = cents(p.pack_price);
    prices[p.name] = {
      vial_cents: vial ? unitCodePrice(code, custom.get(key), costs.get(key), 'vial', vial) : null,
      kit_cents: kit ? unitCodePrice(code, custom.get(key), costs.get(key), 'kit', kit) : null,
    };
  }
  return json({
    ok: true,
    code: code.code,
    label: code.label || (Number(code.pct_off) > 0 ? `${Number(code.pct_off)}% off` : 'Special pricing'),
    referral: Number(code.credit_pct) > 0,
    prices,
  });
}
