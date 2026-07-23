/**
 * POST /api/admin/orders/:orderNumber/archive
 * Soft-clear order from admin list (proxies worker archive).
 */
import { json, requireAdmin } from '../../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../../lib/ordersProxy.js';

export async function onRequestPost({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const orderNumber = String(params.orderNumber || '').trim();
  if (!orderNumber) {
    return json({ error: 'order_number required' }, 400);
  }

  const result = await proxyOrdersAdmin(
    env,
    `/admin/orders/${encodeURIComponent(orderNumber)}/archive`,
    { method: 'POST', body: '{}' }
  );
  return json(result.data, result.status);
}
