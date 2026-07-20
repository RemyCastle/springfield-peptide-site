/**
 * D1 helpers — ensure catalog schema (suppliers + product.supplier_id).
 */

export async function ensureCatalogSchema(env) {
  if (!env.DB) return;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS suppliers (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       name       TEXT NOT NULL UNIQUE,
       notes      TEXT,
       telegram_chat_id TEXT,
       active     INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ).run();

  // Older DBs may have suppliers without telegram_chat_id
  try {
    await env.DB.prepare(`SELECT telegram_chat_id FROM suppliers LIMIT 1`).first();
  } catch {
    try {
      await env.DB.prepare(
        `ALTER TABLE suppliers ADD COLUMN telegram_chat_id TEXT`
      ).run();
    } catch {
      /* ignore */
    }
  }

  // products.source — free-form notes (optional)
  try {
    await env.DB.prepare(`SELECT source FROM products LIMIT 1`).first();
  } catch {
    try {
      await env.DB.prepare(`ALTER TABLE products ADD COLUMN source TEXT`).run();
    } catch {
      /* ignore */
    }
  }

  // products.supplier_id — FK-ish to suppliers
  try {
    await env.DB.prepare(`SELECT supplier_id FROM products LIMIT 1`).first();
  } catch {
    try {
      await env.DB.prepare(
        `ALTER TABLE products ADD COLUMN supplier_id INTEGER`
      ).run();
    } catch {
      /* ignore */
    }
  }
}

export async function listSuppliers(env, { activeOnly = false } = {}) {
  await ensureCatalogSchema(env);
  const sql = activeOnly
    ? `SELECT id, name, notes, telegram_chat_id, active, created_at, updated_at
       FROM suppliers WHERE active = 1 ORDER BY name COLLATE NOCASE ASC`
    : `SELECT id, name, notes, telegram_chat_id, active, created_at, updated_at
       FROM suppliers ORDER BY active DESC, name COLLATE NOCASE ASC`;
  const { results } = await env.DB.prepare(sql).all();
  return (results || []).map((r) => ({
    id: r.id,
    name: r.name,
    notes: r.notes || null,
    telegram_chat_id:
      r.telegram_chat_id == null || String(r.telegram_chat_id).trim() === ''
        ? null
        : String(r.telegram_chat_id).trim(),
    active: !!r.active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export function mapSupplierRow(row) {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes || null,
    telegram_chat_id:
      row.telegram_chat_id == null || String(row.telegram_chat_id).trim() === ''
        ? null
        : String(row.telegram_chat_id).trim(),
    active: !!row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
