import { json, requireAdmin, productToAdmin } from '../../lib/auth.js';
import { ensureCatalogSchema } from '../../lib/db.js';

const PRODUCT_SELECT = `
  SELECT p.id, p.name, p.vial_price, p.pack_price, p.kit_only, p.sort_order, p.active,
         p.source, p.supplier_id, p.updated_at, s.name AS supplier_name
  FROM products p
  LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  try {
    await ensureCatalogSchema(env);
    const { results } = await env.DB.prepare(
      `${PRODUCT_SELECT} ORDER BY p.sort_order ASC, p.id ASC`
    ).all();
    return json({ products: (results || []).map(productToAdmin) });
  } catch (e) {
    return json({ error: 'Failed to load products', detail: String(e.message || e) }, 500);
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
    : 999;
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
    if (supplierId) {
      const s = await env.DB.prepare(`SELECT id FROM suppliers WHERE id = ?`)
        .bind(supplierId)
        .first();
      if (!s) return json({ error: 'Supplier not found' }, 400);
    }

    const result = await env.DB.prepare(
      `INSERT INTO products (name, vial_price, pack_price, kit_only, sort_order, active, source, supplier_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(name, vialPrice, packPrice, kitOnly, sortOrder, active, source, supplierId)
      .run();

    const id = result.meta?.last_row_id;
    const row = await env.DB.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`)
      .bind(id)
      .first();

    return json({ product: productToAdmin(row) }, 201);
  } catch (e) {
    return json({ error: 'Failed to create product', detail: String(e.message || e) }, 500);
  }
}
