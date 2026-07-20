/**
 * Admin suppliers CRUD
 * GET  /api/admin/suppliers
 * POST /api/admin/suppliers  { name, notes?, telegram_chat_id?, active? }
 */
import { json, requireAdmin } from '../../lib/auth.js';
import {
  ensureCatalogSchema,
  listSuppliers,
  mapSupplierRow,
} from '../../lib/db.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  try {
    const suppliers = await listSuppliers(env, { activeOnly: false });
    return json({ suppliers });
  } catch (e) {
    return json(
      { error: 'Failed to load suppliers', detail: String(e.message || e) },
      500
    );
  }
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const name = String(body.name || '').trim();
  if (!name) return json({ error: 'Name is required' }, 400);
  const notes =
    body.notes == null || String(body.notes).trim() === ''
      ? null
      : String(body.notes).trim().slice(0, 1000);
  const telegramChatId =
    body.telegram_chat_id == null || String(body.telegram_chat_id).trim() === ''
      ? null
      : String(body.telegram_chat_id).trim().slice(0, 64);
  const active = body.active === false || body.active === 0 ? 0 : 1;

  try {
    await ensureCatalogSchema(env);
    const result = await env.DB.prepare(
      `INSERT INTO suppliers (name, notes, telegram_chat_id, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(name.slice(0, 200), notes, telegramChatId, active)
      .run();

    const id = result.meta?.last_row_id;
    const row = await env.DB.prepare(
      `SELECT id, name, notes, telegram_chat_id, active, created_at, updated_at
       FROM suppliers WHERE id = ?`
    )
      .bind(id)
      .first();

    return json({ supplier: mapSupplierRow(row) }, 201);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('UNIQUE')) {
      return json({ error: 'A supplier with that name already exists' }, 409);
    }
    return json({ error: 'Failed to create supplier', detail: msg }, 500);
  }
}
