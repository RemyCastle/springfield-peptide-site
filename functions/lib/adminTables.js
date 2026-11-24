/**
 * Admin-only tables: change log (with Undo), customer notes/tags, customer messages log.
 * Created on first use. Undo restores the "before" copy saved with each change.
 */
import { setSetting } from '../../workers/supplier-sync/src/schema.js';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS admin_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,          -- product | settings
    target TEXT,                 -- product id, or 'settings'
    label TEXT,
    before TEXT,
    after TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    undone_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS customer_notes (
    email TEXT PRIMARY KEY,
    note TEXT,
    tags TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS customer_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT,
    order_number TEXT,
    template TEXT,
    subject TEXT,
    sent_ok INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

let ready = false;
export async function ensureAdminTables(db) {
  if (ready) return;
  await db.batch(TABLES.map((sql) => db.prepare(sql)));
  ready = true;
}

export const PRODUCT_FIELDS = ['name', 'vial_price', 'pack_price', 'kit_only', 'active', 'sort_order'];

export function pick(row, fields) {
  const out = {};
  for (const f of fields) out[f] = row ? row[f] ?? null : null;
  return out;
}

export async function logChange(db, { kind, target, label, before, after }) {
  await ensureAdminTables(db);
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  const r = await db
    .prepare('INSERT INTO admin_changes (kind, target, label, before, after) VALUES (?, ?, ?, ?, ?)')
    .bind(kind, String(target ?? ''), String(label || '').slice(0, 200), JSON.stringify(before ?? null), JSON.stringify(after ?? null))
    .run();
  return r.meta?.last_row_id ?? null;
}

export async function productRow(db, id) {
  return db.prepare('SELECT id, name, vial_price, pack_price, kit_only, active, sort_order FROM products WHERE id = ?').bind(id).first();
}

/** Undo one change: put the "before" values back. Returns a message or throws. */
export async function undoChange(db, id) {
  await ensureAdminTables(db);
  const c = await db.prepare('SELECT * FROM admin_changes WHERE id = ?').bind(id).first();
  if (!c) throw new Error('That change was not found.');
  if (c.undone_at) throw new Error('That change was already undone.');
  const before = JSON.parse(c.before || 'null');
  if (c.kind === 'product') {
    const now = await productRow(db, c.target);
    if (!now) throw new Error('That product no longer exists.');
    const b = pick(before, PRODUCT_FIELDS);
    await db
      .prepare(
        "UPDATE products SET name = ?, vial_price = ?, pack_price = ?, kit_only = ?, active = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .bind(b.name, b.vial_price, b.pack_price, b.kit_only ? 1 : 0, b.active ? 1 : 0, b.sort_order, c.target)
      .run();
    await logChange(db, { kind: 'product', target: c.target, label: c.label.startsWith('Undo: ') ? c.label.slice(6) : `Undo: ${c.label}`, before: pick(now, PRODUCT_FIELDS), after: b });
  } else if (c.kind === 'settings') {
    for (const [k, v] of Object.entries(before || {})) await setSetting(db, k, v == null ? '' : String(v));
  } else {
    throw new Error('This kind of change cannot be undone.');
  }
  await db.prepare("UPDATE admin_changes SET undone_at = datetime('now') WHERE id = ?").bind(id).run();
  return `Undone: ${c.label}`;
}
