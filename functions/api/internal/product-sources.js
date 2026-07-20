/**
 * GET /api/internal/product-sources
 * Auth: X-Notify-Secret
 *
 * Returns supplier + telegram_chat_id + notes for multi-supplier Telegram routing.
 */
import { json } from '../../lib/auth.js';
import { ensureCatalogSchema } from '../../lib/db.js';

function checkSecret(request, env) {
  const expected = String(
    env.SUPPLIER_NOTIFY_SECRET || env.NOTIFY_SECRET || ''
  ).trim();
  if (!expected) return false;
  const header =
    request.headers.get('X-Notify-Secret') ||
    (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return header === expected;
}

export async function onRequestGet({ request, env }) {
  if (!checkSecret(request, env)) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!env.DB) {
    return json({ error: 'no_db' }, 500);
  }

  try {
    await ensureCatalogSchema(env);
    const { results } = await env.DB.prepare(
      `SELECT p.name, p.source, p.supplier_id,
              s.name AS supplier_name, s.telegram_chat_id AS supplier_telegram_chat_id
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.active = 1`
    ).all();

    const sources = {};
    const products = {};
    const suppliersByName = {};

    for (const row of results || []) {
      if (!row.name) continue;
      const supplier =
        row.supplier_name != null && String(row.supplier_name).trim()
          ? String(row.supplier_name).trim()
          : null;
      const notes =
        row.source != null && String(row.source).trim()
          ? String(row.source).trim()
          : null;
      const chatId =
        row.supplier_telegram_chat_id != null &&
        String(row.supplier_telegram_chat_id).trim()
          ? String(row.supplier_telegram_chat_id).trim()
          : null;

      let label = supplier;
      if (supplier && notes) label = `${supplier} · ${notes}`;
      else if (!supplier && notes) label = notes;
      if (label) sources[String(row.name)] = label;

      products[String(row.name)] = {
        supplier,
        notes,
        supplier_id: row.supplier_id == null ? null : Number(row.supplier_id),
        telegram_chat_id: chatId,
      };

      if (supplier) {
        suppliersByName[supplier] = {
          name: supplier,
          telegram_chat_id: chatId,
        };
      }
    }

    return json({ sources, products, suppliers: suppliersByName });
  } catch (e) {
    return json({ error: 'failed', detail: String(e.message || e) }, 500);
  }
}
