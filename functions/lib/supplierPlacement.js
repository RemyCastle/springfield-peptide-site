/**
 * Turn an SPBC order (spbc-orders admin detail) into what Remy needs to place it at
 * show-me-source: their product names, vial/kit counts, estimated cost, ship-to fields.
 * Used by the order-detail helper and the admin "Place orders" tab.
 */
import { supplierUnitCost } from '../../workers/supplier-sync/src/schema.js';

export async function supplierNameMap(db) {
  const { results } = await db.prepare('SELECT supplier_id, supplier_name, spbc_name FROM supplier_map WHERE skip = 0').all();
  return new Map(results.map((m) => [m.spbc_name, { name: m.supplier_name, id: m.supplier_id }]));
}

export function buildPlacement(detail, nameMap) {
  const o = (detail && detail.order) || {};
  let cost = 0;
  const items = ((detail && detail.items) || []).map((it) => {
    const isVial = /\(\s*Vial\s*\)\s*$/i.test(it.name || '') || /-VIAL$/i.test(it.sku || '');
    const spbcName = String(it.name || '').replace(/\s+\((?:10-Pack \/ Kit|Kit|Vial)\)\s*$/i, '').trim();
    const unitCost = supplierUnitCost(it);
    const qty = Number(it.qty) || 0;
    cost += unitCost * qty;
    const sup = nameMap.get(spbcName) || {};
    return {
      spbc_name: spbcName,
      supplier_name: sup.name || null,
      supplier_id: sup.id ?? null,
      kind: isVial ? 'vial' : 'kit',
      qty,
      supplier_unit_cost: unitCost,
    };
  });
  return {
    order_number: o.order_number,
    status: o.status,
    customer_name: o.customer_name || '',
    created_at: o.created_at || null,
    paid_at: o.paid_at || null,
    items,
    supplier_cost: Math.round(cost * 100) / 100,
    customer_paid_cents: o.paid_amount_cents || o.total_cents,
    address: {
      name: o.ship_name || o.customer_name || '',
      line1: o.ship_line1 || '',
      line2: o.ship_line2 || '',
      city: o.ship_city || '',
      state: o.ship_state || '',
      postal: o.ship_postal || '',
      phone: o.ship_phone || '',
    },
    has_address: !!(o.ship_line1 && o.ship_city && o.ship_state && o.ship_postal),
  };
}
