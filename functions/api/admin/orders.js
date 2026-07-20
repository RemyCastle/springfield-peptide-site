/**
 * GET /api/admin/orders
 * Proxies to spbc-orders GET /admin/orders (session-auth on site, Bearer upstream).
 *
 * Query: status, from, to, q, page, limit
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const key of ['status', 'from', 'to', 'q', 'page', 'limit']) {
    const v = url.searchParams.get(key);
    if (v != null && v !== '') params.set(key, v);
  }
  const qs = params.toString();
  const path = `/admin/orders${qs ? `?${qs}` : ''}`;

  const result = await proxyOrdersAdmin(env, path);
  return json(result.data, result.status);
}
