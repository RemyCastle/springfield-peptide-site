/**
 * GET /api/admin/profit?days=30   (days=0 = all time)
 * SPBC profit after show-me-source costs, from paid / shipped / complete orders.
 *   supplier cost per line = SPBC price - $25 (vial) or - $200 (kit)   (the dropship markup)
 *   shipping: what the customer paid minus site_settings.sms_ship_cost per order
 * Reads orders through the spbc-orders admin API (one detail call per order, max 400).
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';
import { supplierUnitCost, getSetting } from '../../../workers/supplier-sync/src/schema.js';

const SOLD = ['paid', 'shipped', 'complete'];
const MAX_ORDERS = 400;

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const days = Math.max(0, parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 0);
  const from = days ? new Date(Date.now() - days * 86400000).toISOString() : null;
  let smsShip = 0;
  try {
    smsShip = Math.max(0, Number(await getSetting(env.DB, 'sms_ship_cost', '0')) || 0);
  } catch {
    smsShip = 0;
  }

  // 1. Sold SPBC orders in range
  const orders = [];
  const seen = new Set();
  for (const status of SOLD) {
    for (let page = 1; page <= 10 && orders.length < MAX_ORDERS; page++) {
      const qs = new URLSearchParams({ status, exclude_partner_retail: '1', limit: '100', page: String(page) });
      if (from) qs.set('from', from);
      const res = await proxyOrdersAdmin(env, `/admin/orders?${qs}`);
      if (!res.ok) return json(res.data, res.status);
      for (const o of res.data.orders || []) {
        if (o.partner_slug || !SOLD.includes(o.status) || seen.has(o.order_number)) continue;
        seen.add(o.order_number);
        orders.push(o);
      }
      if (!res.data.total_pages || page >= res.data.total_pages) break;
    }
  }

  // 2. Items per order (8 at a time)
  const details = [];
  for (let i = 0; i < orders.length; i += 8) {
    const batch = await Promise.all(
      orders.slice(i, i + 8).map((o) => proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(o.order_number)}`))
    );
    details.push(...batch.map((r) => (r.ok ? r.data : null)));
  }

  const totals = { orders: 0, revenue: 0, supplier_cost: 0, shipping_collected: 0, shipping_paid: 0, profit: 0 };
  const byProduct = new Map();
  const byMonth = new Map();
  details.forEach((d) => {
    if (!d || !d.order) return;
    const o = d.order;
    let rev = 0;
    let cost = 0;
    for (const it of d.items || []) {
      const qty = Number(it.qty) || 0;
      const lineRev = (Number(it.unit_price_cents) / 100) * qty;
      const lineCost = supplierUnitCost(it) * qty;
      rev += lineRev;
      cost += lineCost;
      const key = String(it.name || '');
      const p = byProduct.get(key) || { name: key, units: 0, revenue: 0, supplier_cost: 0, profit: 0 };
      p.units += qty;
      p.revenue += lineRev;
      p.supplier_cost += lineCost;
      p.profit += lineRev - lineCost;
      byProduct.set(key, p);
    }
    const shipIn = (Number(o.shipping_cents) || 0) / 100;
    const profit = rev - cost + shipIn - smsShip;
    totals.orders += 1;
    totals.revenue += rev;
    totals.supplier_cost += cost;
    totals.shipping_collected += shipIn;
    totals.shipping_paid += smsShip;
    totals.profit += profit;
    const month = String(o.paid_at || o.created_at || '').slice(0, 7) || 'unknown';
    const m = byMonth.get(month) || { month, orders: 0, revenue: 0, profit: 0 };
    m.orders += 1;
    m.revenue += rev + shipIn;
    m.profit += profit;
    byMonth.set(month, m);
  });
  const r2 = (n) => Math.round(n * 100) / 100;
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
  return json({
    days,
    sms_ship_cost: smsShip,
    capped: orders.length >= MAX_ORDERS,
    totals: round(totals),
    months: [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).map(round),
    products: [...byProduct.values()].sort((a, b) => b.profit - a.profit).map(round),
  });
}
