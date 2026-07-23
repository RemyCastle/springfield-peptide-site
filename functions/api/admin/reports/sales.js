/**
 * GET /api/admin/reports/sales — SPBC sales report, or one franchisee's.
 *
 *   ?partner_slug=patriotic   that franchisee's revenue/cost/profit
 *   (omitted)                 SPBC revenue by channel (no supplier cost stored)
 *   ?from=&to=                ISO timestamps
 *
 * Session-auth on site; Bearer ORDERS_ADMIN_TOKEN upstream to spbc-orders.
 */
import { json, requireAdmin } from '../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../lib/ordersProxy.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const qs = new URLSearchParams();
  for (const key of ['partner_slug', 'from', 'to']) {
    const v = url.searchParams.get(key);
    if (v) qs.set(key, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const result = await proxyOrdersAdmin(env, `/admin/reports/sales${suffix}`);
  return json(result.data, result.status);
}
