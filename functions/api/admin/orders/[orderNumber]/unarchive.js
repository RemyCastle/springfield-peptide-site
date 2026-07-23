/**
 * POST /api/admin/orders/:orderNumber/unarchive
 * Restore cleared order to admin list (proxies worker unarchive).
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
    `/admin/orders/${encodeURIComponent(orderNumber)}/unarchive`,
    { method: 'POST', body: '{}' }
  );
  return json(result.data, result.status);
}
