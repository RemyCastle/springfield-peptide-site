/**
 * PUT    /api/admin/suppliers/:id
 * DELETE /api/admin/suppliers/:id
 */
import { json, requireAdmin } from '../../../lib/auth.js';
import { ensureCatalogSchema, mapSupplierRow } from '../../../lib/db.js';

function parseId(params) {
  const id = parseInt(params.id, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function onRequestPut({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const id = parseId(params);
  if (!id) return json({ error: 'Invalid id' }, 400);

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
    const existing = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ?`)
      .bind(id)
      .first();
    if (!existing) return json({ error: 'Not found' }, 404);

    await env.DB.prepare(
      `UPDATE suppliers
       SET name = ?, notes = ?, telegram_chat_id = ?, active = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(name.slice(0, 200), notes, telegramChatId, active, id)
      .run();

    const row = await env.DB.prepare(
      `SELECT id, name, notes, telegram_chat_id, active, created_at, updated_at
       FROM suppliers WHERE id = ?`
    )
      .bind(id)
      .first();

    return json({ supplier: mapSupplierRow(row) });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('UNIQUE')) {
      return json({ error: 'A supplier with that name already exists' }, 409);
    }
    return json({ error: 'Failed to update supplier', detail: msg }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const id = parseId(params);
  if (!id) return json({ error: 'Invalid id' }, 400);

  try {
    await ensureCatalogSchema(env);
    const existing = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ?`)
      .bind(id)
      .first();
    if (!existing) return json({ error: 'Not found' }, 404);

    try {
      await env.DB.prepare(
        `UPDATE products SET supplier_id = NULL WHERE supplier_id = ?`
      )
        .bind(id)
        .run();
    } catch {
      /* ignore */
    }

    await env.DB.prepare(`DELETE FROM suppliers WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'Failed to delete supplier', detail: String(e.message || e) }, 500);
  }
}
