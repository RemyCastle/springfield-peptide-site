/**
 * GET /api/admin/customers[?format=csv] -> SPBC's own customers (one row per email).
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';

const cell = (v) => {
  const t = String(v ?? '');
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const r = await proxyOrdersAdmin(env, '/admin/customers');
  if (!r.ok) return json({ error: 'unavailable', message: 'Could not load customers.' }, 502);
  if (new URL(request.url).searchParams.get('format') === 'csv') {
    const rows = [['email', 'name', 'orders', 'paid_orders', 'spent', 'first_order', 'last_order']];
    for (const c of r.data.customers || []) {
      rows.push([c.email, c.name, c.orders, c.paid_orders, (Number(c.spent_cents || 0) / 100).toFixed(2), c.first_order, c.last_order]);
    }
    return new Response(rows.map((x) => x.map(cell).join(',')).join('\n') + '\n', {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="spbc-customers.csv"', 'Cache-Control': 'no-store' },
    });
  }
  return json(r.data);
}
