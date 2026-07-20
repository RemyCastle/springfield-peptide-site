/**
 * GET   /api/admin/orders/:orderNumber  — order detail
 * PATCH /api/admin/orders/:orderNumber  — status transition
 */
import { json, requireAdmin } from '../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../lib/ordersProxy.js';

function orderPath(orderNumber) {
  return `/admin/orders/${encodeURIComponent(String(orderNumber).trim())}`;
}

export async function onRequestGet({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const orderNumber = params?.orderNumber;
  if (!orderNumber) return json({ error: 'order_number required' }, 400);

  const result = await proxyOrdersAdmin(env, orderPath(orderNumber));
  return json(result.data, result.status);
}

export async function onRequestPatch({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const orderNumber = params?.orderNumber;
  if (!orderNumber) return json({ error: 'order_number required' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const result = await proxyOrdersAdmin(env, orderPath(orderNumber), {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return json(result.data, result.status);
}
