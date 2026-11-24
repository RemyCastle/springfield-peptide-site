/**
 * Admin view + decisions for the show-me-source sync (workers/supplier-sync).
 *
 * GET  /api/admin/supplier-sync
 *   -> { runs, holds, new_products, recent, map, products }
 * POST /api/admin/supplier-sync  { action, id, spbc_name? }
 *   apply_hold   apply a held price change (event id)
 *   ignore_hold  keep the current price; the same target is not raised again
 *   map_new      link a new supplier product to an existing SPBC product (spbc_name)
 *   skip_new     never sell this supplier product
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { ensureSyncSchema, getSetting, setSetting, getSettings } from '../../../workers/supplier-sync/src/schema.js';
import { logChange } from '../../lib/adminTables.js';

const SWITCHES = ['reminders_on', 'digest_on', 'price_alerts_on', 'auto_match_on', 'vacation_on', 'tax_on'];
const NUMBERS = {
  reminder_hours: [1, 336],
  auto_cancel_days: [0, 60],
  free_ship_after: [0, 50],
  sms_ship_cost: [0, 200],
  free_ship_over: [0, 5000],
  ship_standard: [0, 100],
  ship_priority: [0, 200],
  tax_rate: [0, 15],
};
const DECIMALS = new Set(['sms_ship_cost', 'ship_standard', 'ship_priority', 'tax_rate']);
const TEXTS = { vacation_message: 300, announcement: 300 };
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** Only known switches, checked values. */
function cleanSettings(input) {
  const values = {};
  for (const k of SWITCHES) if (k in input) values[k] = input[k] === true || input[k] === '1' ? '1' : '0';
  for (const [k, [lo, hi]] of Object.entries(NUMBERS)) {
    if (!(k in input)) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: `${k} must be between ${lo} and ${hi}` };
    values[k] = String(DECIMALS.has(k) ? Math.round(n * 1000) / 1000 : Math.round(n));
  }
  for (const [k, max] of Object.entries(TEXTS)) {
    if (k in input) values[k] = String(input[k] || '').replace(/[<>]/g, '').trim().slice(0, max);
  }
  if ('tax_state' in input) {
    const st = String(input.tax_state || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(st)) return { error: 'Tax state must be 2 letters, like MO' };
    values.tax_state = st;
  }
  if ('digest_to' in input) {
    const e = String(input.digest_to || '').trim();
    if (e && !EMAIL_RE.test(e)) return { error: 'Digest email is not a valid address' };
    values.digest_to = e;
  }
  return { values };
}

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureSyncSchema(db);
  const all = async (sql) => (await db.prepare(sql).all()).results;
  const parse = (rows) => rows.map((r) => ({ ...r, detail: safeJson(r.detail) }));
  return json({
    runs: parse(await all("SELECT * FROM supplier_sync_events WHERE kind = 'run' ORDER BY id DESC LIMIT 12")),
    holds: parse(await all("SELECT * FROM supplier_sync_events WHERE kind = 'hold_price' AND status = 'pending' ORDER BY id DESC")),
    new_products: parse(await all("SELECT * FROM supplier_sync_events WHERE kind = 'new_product' AND status = 'pending' ORDER BY id DESC")),
    recent: parse(
      await all("SELECT * FROM supplier_sync_events WHERE kind <> 'run' AND status <> 'pending' ORDER BY id DESC LIMIT 40")
    ),
    products: await all('SELECT name, active FROM products ORDER BY sort_order, name'),
    settings: { show_lab_reports: (await getSetting(db, 'show_lab_reports', '0')) === '1' },
    automation: await getSettings(db),
    price_watchers: (await all('SELECT COUNT(*) AS n FROM price_watch'))[0].n,
    lab_reports_found: (await all("SELECT COUNT(*) AS n FROM supplier_map WHERE skip = 0 AND coa_url IS NOT NULL"))[0].n,
    restock_waiting: await all(
      'SELECT spbc_name, COUNT(*) AS n FROM restock_requests WHERE notified_at IS NULL GROUP BY spbc_name ORDER BY n DESC'
    ),
  });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureSyncSchema(db);
  const body = await request.json().catch(() => ({}));
  if (body.action === 'set_settings') {
    const clean = cleanSettings(body.settings || {});
    if (clean.error) return json({ error: 'validation_failed', message: clean.error }, 400);
    const old = await getSettings(db);
    const before = {};
    const after = {};
    for (const [k, v] of Object.entries(clean.values)) {
      if (String(old[k] ?? '') !== v) {
        before[k] = old[k] ?? '';
        after[k] = v;
      }
    }
    for (const [k, v] of Object.entries(clean.values)) await setSetting(db, k, v);
    if (Object.keys(after).length) {
      await logChange(db, { kind: 'settings', target: 'settings', label: `Settings: ${Object.keys(after).join(', ')}`, before, after }).catch(() => null);
    }
    return json({ ok: true, message: 'Saved', settings: await getSettings(db) });
  }
  if (body.action === 'set_lab_reports') {
    await setSetting(db, 'show_lab_reports', body.on ? '1' : '0');
    return json({ ok: true, message: body.on ? 'Lab reports are now shown on the shop' : 'Lab reports are hidden' });
  }
  const id = parseInt(body.id, 10);
  const ev = await db.prepare('SELECT * FROM supplier_sync_events WHERE id = ?').bind(id).first();
  if (!ev || ev.status !== 'pending') return json({ error: 'not_found', message: 'That item was already handled.' }, 404);
  const detail = safeJson(ev.detail);
  const mark = (status) =>
    db.prepare('UPDATE supplier_sync_events SET status = ? WHERE id = ?').bind(status, id);

  switch (body.action) {
    case 'apply_hold': {
      if (ev.kind !== 'hold_price') break;
      const t = detail.to || {};
      await db.batch([
        db
          .prepare("UPDATE products SET vial_price = ?, pack_price = ?, kit_only = ?, updated_at = datetime('now') WHERE id = ? AND name = ?")
          .bind(t.vial ?? null, t.kit, t.kitOnly ? 1 : 0, detail.product_id, detail.spbc_name),
        mark('applied'),
      ]);
      return json({ ok: true, message: `${detail.spbc_name} price updated` });
    }
    case 'ignore_hold':
      if (ev.kind !== 'hold_price') break;
      await mark('ignored').run();
      return json({ ok: true, message: 'Kept the current price' });
    case 'map_new': {
      if (ev.kind !== 'new_product') break;
      const name = String(body.spbc_name || '');
      const exists = await db.prepare('SELECT id FROM products WHERE name = ?').bind(name).first();
      if (!exists) return json({ error: 'unknown_product', message: 'Pick a product from the Price list first.' }, 400);
      await db.batch([
        db
          .prepare(
            "INSERT INTO supplier_map (supplier_id, supplier_name, spbc_name, skip, hidden_by_sync) VALUES (?, ?, ?, 0, 0) ON CONFLICT(supplier_id) DO UPDATE SET spbc_name = excluded.spbc_name, skip = 0, updated_at = datetime('now')"
          )
          .bind(ev.supplier_id, detail.supplier_name || null, name),
        mark('mapped'),
      ]);
      return json({ ok: true, message: `Linked to ${name}. The next sync sets its price.` });
    }
    case 'add_new': {
      if (ev.kind !== 'new_product') break;
      const t = detail.target || {};
      const name = String(body.spbc_name || detail.supplier_name || '').trim().slice(0, 120);
      if (!name) return json({ error: 'validation_failed', message: 'Give it a name for the shop.' }, 400);
      const taken = await db.prepare('SELECT id FROM products WHERE name = ?').bind(name).first();
      if (taken) return json({ error: 'name_taken', message: `${name} is already on the Price list. Use Link instead.` }, 400);
      if (!(Number(t.kit) > 0)) return json({ error: 'no_price', message: 'No price from the supplier yet. Try after the next sync.' }, 400);
      const minRow = await db.prepare('SELECT MIN(sort_order) AS m FROM products').first();
      const sortOrder = Number.isFinite(Number(minRow?.m)) ? Number(minRow.m) - 10 : 10;
      await db.batch([
        db
          .prepare(
            "INSERT INTO products (name, vial_price, pack_price, kit_only, sort_order, active, updated_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))"
          )
          .bind(name, t.kitOnly ? null : t.vial ?? null, t.kit, t.kitOnly ? 1 : 0, sortOrder),
        db
          .prepare(
            "INSERT INTO supplier_map (supplier_id, supplier_name, spbc_name, skip, hidden_by_sync) VALUES (?, ?, ?, 0, 0) ON CONFLICT(supplier_id) DO UPDATE SET spbc_name = excluded.spbc_name, skip = 0, updated_at = datetime('now')"
          )
          .bind(ev.supplier_id, detail.supplier_name || null, name),
        mark('mapped'),
      ]);
      return json({ ok: true, message: `${name} is now on the shop at the usual markup.` });
    }
    case 'skip_new':
      if (ev.kind !== 'new_product') break;
      await db.batch([
        db
          .prepare(
            "INSERT INTO supplier_map (supplier_id, supplier_name, spbc_name, skip) VALUES (?, ?, NULL, 1) ON CONFLICT(supplier_id) DO UPDATE SET skip = 1, updated_at = datetime('now')"
          )
          .bind(ev.supplier_id, detail.supplier_name || null),
        mark('skipped'),
      ]);
      return json({ ok: true, message: 'Skipped' });
    default:
      break;
  }
  return json({ error: 'bad_action', message: 'Unknown action for this item' }, 400);
}

function safeJson(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}
