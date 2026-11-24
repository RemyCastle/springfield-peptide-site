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
import { ensureSyncSchema, getSetting, setSetting } from '../../../workers/supplier-sync/src/schema.js';

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
