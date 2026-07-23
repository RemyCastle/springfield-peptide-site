/**
 * POST /api/admin/orders/:orderNumber/void
 * Force an order to cancelled from any status, including 'complete', which the
 * normal status machine cannot leave. For correcting a mis-recorded sale.
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
    `/admin/orders/${encodeURIComponent(orderNumber)}/void`,
    { method: 'POST', body: JSON.stringify({ note: 'Voided from SPBC admin' }) }
  );
  return json(result.data, result.status);
}
