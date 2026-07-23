/**
 * GET  /api/admin/franchisees — list partners + product_links + franchisee/SPBC prices
 * POST /api/admin/franchisees — create partner (slug, name, clone_from?)
 *
 * Session-auth on site; Bearer ORDERS_ADMIN_TOKEN upstream to spbc-orders.
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const result = await proxyOrdersAdmin(env, '/admin/partners');
  return json(result.data, result.status);
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const result = await proxyOrdersAdmin(env, '/admin/partners', {
    method: 'POST',
    body: JSON.stringify({
      slug: body.slug,
      name: body.name,
      clone_from: body.clone_from ?? null,
    }),
  });
  return json(result.data, result.status);
}
