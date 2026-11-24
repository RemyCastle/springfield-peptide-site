/**
 * spbc-supplier-sync: scheduled Worker that keeps the SPBC catalog (D1 springfieldpeps-db)
 * in line with show-me-source (SMS) prices and stock. Decisions live in plan.js.
 *
 * Secrets (Remy sets them himself with `wrangler secret put`; never commit or print them):
 *   SMS_SITE_KEY      the show-me-source site key
 *   SMS_PRICING_CODE  Remy's pricing code
 *   RESEND_API_KEY    optional: sends "back in stock" emails (with RESTOCK_FROM)
 * Vars:
 *   DRY_RUN = "1"     log what would change, change nothing (default until Remy says go)
 *   RESTOCK_FROM      sender for back-in-stock emails, on a domain verified in Resend
 */
import { planSync, feedProblem } from './plan.js';
import { ensureSyncSchema } from './schema.js';
import { updateProductMeta, sendRestockEmails } from './extras.js';
import { paymentReminders, dailyDigest, priceDropAlerts } from './jobs.js';

export { ensureSyncSchema };

const DEFAULT_BASE = 'https://show-me-source.com';
/** SMS_BASE_URL only for local tests against a stub. */
const base = (env) => String(env.SMS_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
const UA = 'Mozilla/5.0 (compatible; spbc-supplier-sync/1.0)';

async function smsLogin(env) {
  const res = await fetch(`${base(env)}/`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ site_key: env.SMS_SITE_KEY }).toString(),
  });
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const cookie = raw.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error(`site key login returned no session (HTTP ${res.status})`);
  return cookie;
}

async function smsJson(env, path, cookie, init = {}) {
  const res = await fetch(`${base(env)}/${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`, {
    ...init,
    headers: { 'User-Agent': UA, Cookie: cookie, ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.success === false) {
    throw new Error(`${path}: HTTP ${res.status} ${data && data.error ? data.error : ''}`.trim());
  }
  return data;
}

/** Read the supplier catalog at Remy's pricing tier plus stock. */
export async function fetchSupplier(env) {
  if (!env.SMS_SITE_KEY || !env.SMS_PRICING_CODE) throw new Error('SMS_SITE_KEY / SMS_PRICING_CODE secrets are not set');
  const cookie = await smsLogin(env);
  const quote = await smsJson(env, 'inventory.php', cookie, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'promo_quote', promo_code: env.SMS_PRICING_CODE }),
  });
  const stock = await smsJson(env, 'inventory.php?stock=1', cookie);
  const feed = { ...(quote.products || {}), ...(quote.unlocked_products || {}) };
  // Full product rows (lab reports). Optional: the sync works without them.
  let details = {};
  try {
    const full = await smsJson(env, 'inventory.php', cookie);
    const list = full.products || {};
    details = Array.isArray(list) ? Object.fromEntries(list.map((r) => [String(r.id), r])) : list;
  } catch {
    details = {};
  }
  return { tier: quote.pricing_tier, feed, stock: stock.products || {}, details };
}

async function logEvent(db, e) {
  await db
    .prepare(
      'INSERT INTO supplier_sync_events (kind, status, spbc_name, supplier_id, vial, kit, detail) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(e.kind, e.status, e.spbc_name ?? null, e.supplier_id ?? null, e.vial ?? null, e.kit ?? null, JSON.stringify(e.detail ?? {}))
    .run();
}

/** Apply one approved price change (also used by the admin "Apply" button). */
export function priceStatement(db, a) {
  return db
    .prepare(
      "UPDATE products SET vial_price = ?, pack_price = ?, kit_only = ?, updated_at = datetime('now') WHERE id = ? AND name = ?"
    )
    .bind(a.to.vial, a.to.kit, a.to.kitOnly ? 1 : 0, a.product_id, a.spbc_name);
}

export async function runSync(env, { dryRun } = {}) {
  const db = env.DB;
  const dry = dryRun ?? String(env.DRY_RUN || '1') !== '0';
  await ensureSyncSchema(db);
  const status = dry ? 'dry_run' : 'done';

  let supplier;
  try {
    supplier = await fetchSupplier(env);
  } catch (err) {
    await logEvent(db, { kind: 'run', status: 'error', detail: { error: String(err.message || err) } });
    return { ok: false, error: String(err.message || err) };
  }

  const map = (await db.prepare('SELECT * FROM supplier_map').all()).results;
  const problem = feedProblem({ tier: supplier.tier, feed: supplier.feed, map });
  if (problem) {
    await logEvent(db, { kind: 'run', status: 'error', detail: { error: problem } });
    return { ok: false, error: problem };
  }

  const products = (await db.prepare('SELECT id, name, vial_price, pack_price, kit_only, active FROM products').all()).results;
  const decided = (
    await db
      .prepare("SELECT spbc_name, vial, kit, status FROM supplier_sync_events WHERE kind = 'hold_price' AND status IN ('pending', 'ignored')")
      .all()
  ).results;
  const knownNew = new Set(
    (await db.prepare("SELECT supplier_id FROM supplier_sync_events WHERE kind = 'new_product' AND status = 'pending'").all()).results.map(
      (r) => String(r.supplier_id)
    )
  );

  const { actions } = planSync({ feed: supplier.feed, stock: supplier.stock, map, products, decided });
  const counts = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] || 0) + 1;
  if (dry) {
    // Test mode: one summary row per run, nothing changed, no per-item rows to pile up.
    await logEvent(db, {
      kind: 'run',
      status: 'dry_run',
      detail: { tier: supplier.tier, feed_products: Object.keys(supplier.feed).length, counts, would_do: actions },
    });
    return { ok: true, dry, counts, actions };
  }
  for (const a of actions) {
    if (a.kind === 'price') {
      if (!dry) await priceStatement(db, a).run();
      await logEvent(db, { kind: 'price', status, spbc_name: a.spbc_name, supplier_id: a.supplier_id, vial: a.to.vial, kit: a.to.kit, detail: a });
    } else if (a.kind === 'hold_price') {
      await logEvent(db, { kind: 'hold_price', status: dry ? 'dry_run' : 'pending', spbc_name: a.spbc_name, supplier_id: a.supplier_id, vial: a.to.vial, kit: a.to.kit, detail: a });
    } else if (a.kind === 'hide' || a.kind === 'show') {
      if (!dry) {
        await db.batch([
          db.prepare("UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ? AND name = ?").bind(a.kind === 'show' ? 1 : 0, a.product_id, a.spbc_name),
          db.prepare("UPDATE supplier_map SET hidden_by_sync = ?, updated_at = datetime('now') WHERE supplier_id = ?").bind(a.kind === 'hide' ? 1 : 0, a.supplier_id),
        ]);
      }
      await logEvent(db, { kind: a.kind, status, spbc_name: a.spbc_name, supplier_id: a.supplier_id, detail: a });
    } else if (a.kind === 'new_product') {
      if (!knownNew.has(String(a.supplier_id))) {
        await logEvent(db, { kind: 'new_product', status: dry ? 'dry_run' : 'pending', supplier_id: a.supplier_id, vial: a.target.vial, kit: a.target.kit, detail: a });
      }
    } else {
      await logEvent(db, { kind: a.kind, status: 'error', spbc_name: a.spbc_name, supplier_id: a.supplier_id, detail: a });
    }
  }
  const metaUpdated = await updateProductMeta(db, {
    stock: supplier.stock,
    details: supplier.details,
    feed: supplier.feed,
    baseUrl: base(env),
  });
  const restock = await sendRestockEmails(db, env);
  const priceAlerts = await priceDropAlerts(env, db, actions.filter((a) => a.kind === 'price'));
  await logEvent(db, {
    kind: 'run',
    status,
    detail: { tier: supplier.tier, feed_products: Object.keys(supplier.feed).length, counts, meta_updated: metaUpdated, restock, price_alerts: priceAlerts },
  });
  return { ok: true, dry, counts, actions, restock };
}

/** Every 2 hours: price/stock sync + payment reminders. Daily (13:00 UTC): digest. */
export async function runScheduled(cron, env) {
  const db = env.DB;
  await ensureSyncSchema(db);
  if (cron === DIGEST_CRON) {
    const digest = await dailyDigest(env, db).catch((e) => ({ error: String(e.message || e) }));
    await logEvent(db, { kind: 'digest', status: digest.error ? 'error' : 'done', detail: digest });
    return { digest };
  }
  const sync = await runSync(env);
  const reminders = await paymentReminders(env, db).catch((e) => ({ error: String(e.message || e) }));
  if (!reminders.skipped) {
    await logEvent(db, { kind: 'reminders', status: reminders.error ? 'error' : 'done', detail: reminders });
  }
  return { sync, reminders };
}

const DIGEST_CRON = '0 13 * * *'; // not exported: a Worker's main module may only export handlers

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(event.cron, env));
  },
  async fetch() {
    return new Response('spbc-supplier-sync: runs on a schedule. See the SPBC admin, Supplier sync tab.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
