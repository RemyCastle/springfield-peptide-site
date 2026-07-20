import { json, requireAdmin, productToAdmin } from '../../../lib/auth.js';
import { ensureCatalogSchema } from '../../../lib/db.js';

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.vial_price, p.pack_price, p.kit_only, p.sort_order, p.active,
         p.source, p.supplier_id, p.updated_at, s.name AS supplier_name
  FROM products p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

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

  const kitOnly = body.kit_only ? 1 : 0;
  let vialPrice = body.vial_price;
  if (kitOnly || vialPrice === '' || vialPrice == null) {
    vialPrice = null;
  } else {
    vialPrice = Number(vialPrice);
    if (!Number.isFinite(vialPrice) || vialPrice < 0) {
      return json({ error: 'Invalid vial price' }, 400);
    }
  }

  const packPrice = Number(body.pack_price);
  if (!Number.isFinite(packPrice) || packPrice < 0) {
    return json({ error: 'Invalid pack/kit price' }, 400);
  }

  const sortOrder = Number.isFinite(Number(body.sort_order))
    ? Number(body.sort_order)
    : 0;
  const active = body.active === false || body.active === 0 ? 0 : 1;
  const source =
    body.source == null || String(body.source).trim() === ''
      ? null
      : String(body.source).trim().slice(0, 500);

  let supplierId = null;
  if (body.supplier_id != null && body.supplier_id !== '') {
    supplierId = parseInt(body.supplier_id, 10);
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      return json({ error: 'Invalid supplier_id' }, 400);
    }
  }

  try {
    await ensureCatalogSchema(env);
    const existing = await env.DB.prepare(`SELECT id FROM products WHERE id = ?`)
      .bind(id)
      .first();
    if (!existing) return json({ error: 'Not found' }, 404);

    if (supplierId) {
      const s = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ?`)
        .bind(supplierId)
        .first();
      if (!s) return json({ error: 'Supplier not found' }, 400);
    }

    await env.DB.prepare(
      `UPDATE products
       SET name = ?, vial_price = ?, pack_price = ?, kit_only = ?, sort_order = ?,
           active = ?, source = ?, supplier_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(name, vialPrice, packPrice, kitOnly, sortOrder, active, source, supplierId, id)
      .run();

    const row = await env.DB.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`)
      .bind(id)
      .first();

    return json({ product: productToAdmin(row) });
  } catch (e) {
    return json({ error: 'Failed to update product', detail: String(e.message || e) }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const id = parseId(params);
  if (!id) return json({ error: 'Invalid id' }, 400);

  try {
    const existing = await env.DB.prepare(`SELECT id FROM products WHERE id = ?`)
      .bind(id)
      .first();
    if (!existing) return json({ error: 'Not found' }, 404);

    await env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'Failed to delete product', detail: String(e.message || e) }, 500);
  }
}
