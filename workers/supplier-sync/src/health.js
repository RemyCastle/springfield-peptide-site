/**
 * Site health check (every 2 hours with the sync). Creates no orders and sends no customer email.
 *  1. Home page loads and every /shared/*.css|js it links returns the right content type
 *     (the 2026-11-22 breakage: a missing stylesheet came back as HTML).
 *  2. Admin page loads and its stylesheet is CSS.
 *  3. Checkout reaches the order system with a valid signature: a 1-kit order with an
 *     invalid email must come back as the order system's own "validation_failed" (a 401 means the
 *     shared secret broke; 5xx means something is down).
 * Problems are logged (kind 'health') and emailed to digest_to once per new problem.
 */
import { getSettings } from './schema.js';
import { sendEmail, emailReady, esc, siteUrl, wrap } from './email.js';

const TYPES = { css: /text\/css/i, js: /javascript/i };

async function checkPage(base, path) {
  const problems = [];
  const res = await fetch(`${base}${path}?health=${Date.now()}`, { headers: { 'User-Agent': 'spbc-health/1.0' } });
  if (!res.ok) return [`${path} returned HTTP ${res.status}`];
  const html = await res.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/shared\/[^"]+\.(css|js))"/g)].map((m) => `${m[1]}|${m[2]}`))];
  if (!assets.length) problems.push(`${path} links no /shared files (page looks wrong)`);
  for (const a of assets) {
    const [url, ext] = a.split('|');
    const r = await fetch(`${base}${url}`, { headers: { 'User-Agent': 'spbc-health/1.0' } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !TYPES[ext].test(type)) problems.push(`${url} came back as ${r.status} ${type || 'no type'}`);
  }
  return problems;
}

async function checkCheckout(base, db) {
  const p = await db.prepare('SELECT name, pack_price FROM products WHERE active = 1 AND pack_price > 0 ORDER BY sort_order LIMIT 1').first();
  if (!p) return ['no products for sale'];
  const res = await fetch(`${base}/api/place-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'spbc-health/1.0' },
    body: JSON.stringify({ customer: { name: 'Health Check', email: 'not-an-email' }, items: [{ name: `${p.name} (10-Pack / Kit)`, qty: 1 }] }),
  });
  const d = await res.json().catch(() => ({}));
  if (res.status === 400 && d.error === 'validation_failed' && d.details) return []; // order system answered: signature OK
  if (res.status === 401 || d.error === 'invalid_signature') return ['checkout: order system rejected the signature (ORDER_WEBHOOK_SECRET mismatch)'];
  return [`checkout: unexpected answer ${res.status} ${String(d.error || d.message || '').slice(0, 80)}`];
}

export async function healthCheck(env, db) {
  const base = siteUrl(env);
  let problems = [];
  try {
    problems = [...(await checkPage(base, '/')), ...(await checkPage(base, '/admin')), ...(await checkCheckout(base, db))];
  } catch (e) {
    problems = [`health check could not run: ${String(e.message || e).slice(0, 120)}`];
  }
  const ok = problems.length === 0;
  const last = await db
    .prepare("SELECT status, detail FROM supplier_sync_events WHERE kind = 'health' ORDER BY id DESC LIMIT 1")
    .first();
  const same = (t) => String(t || '').replace(/reference = \w+/g, 'reference');
  const lastText = same(last ? last.detail : '');
  const text = JSON.stringify({ problems });
  // Log every failure and the first OK after a failure (keeps the log short).
  if (!ok || (last && last.status === 'error')) {
    await db.prepare('INSERT INTO supplier_sync_events (kind, status, detail) VALUES (?, ?, ?)').bind('health', ok ? 'done' : 'error', text).run();
  }
  if (!ok && same(text) !== lastText) {
    const s = await getSettings(db);
    if (s.digest_to && emailReady(env)) {
      await sendEmail(env, {
        to: s.digest_to,
        subject: 'SPBC site problem found',
        html: wrap(`<p>The automatic check of springfieldpbc.com found:</p><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
<p>It checks again every 2 hours and emails again only if the problem changes.</p>`),
      });
    }
  }
  return { ok, problems };
}
