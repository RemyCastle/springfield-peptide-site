/**
 * GET /api/admin/supplier-queue
 * Paid SPBC orders not yet placed at show-me-source (oldest first), each ready to place:
 * supplier product names, vial/kit counts, estimated cost, ship-to fields.
 * Also the last 15 placed ones for reference.
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';
import { buildPlacement, supplierNameMap } from '../../lib/supplierPlacement.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);

  const paid = [];
  for (let page = 1; page <= 5; page++) {
    const qs = new URLSearchParams({ status: 'paid', exclude_partner_retail: '1', limit: '100', page: String(page) });
    const res = await proxyOrdersAdmin(env, `/admin/orders?${qs}`);
    if (!res.ok) return json(res.data, res.status);
    paid.push(...(res.data.orders || []).filter((o) => !o.partner_slug && o.status === 'paid'));
    if (!res.data.total_pages || page >= res.data.total_pages) break;
  }
  const placedRows = (await env.DB.prepare('SELECT * FROM supplier_orders ORDER BY placed_at DESC').all()).results;
  const placed = new Set(placedRows.map((r) => r.order_number));
  const todo = paid
    .filter((o) => !placed.has(o.order_number))
    .sort((a, b) => String(a.paid_at || a.created_at).localeCompare(String(b.paid_at || b.created_at)));

  const nameMap = await supplierNameMap(env.DB);
  const queue = [];
  for (let i = 0; i < todo.length; i += 8) {
    const batch = await Promise.all(
      todo.slice(i, i + 8).map((o) => proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(o.order_number)}`))
    );
    batch.forEach((r) => {
      if (r.ok) queue.push(buildPlacement(r.data, nameMap));
    });
  }
  return json({
    queue,
    recent: placedRows.slice(0, 15),
    checkout_email: env.SUPPLIER_CHECKOUT_EMAIL || 'supplier@springfieldpbc.com',
  });
}
