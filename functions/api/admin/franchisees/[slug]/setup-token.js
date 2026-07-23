/**
 * POST /api/admin/franchisees/:slug/setup-token
 * Rotate setup token; returns one-time setup_url.
 */
import { json, requireAdmin } from '../../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../../lib/ordersProxy.js';

export async function onRequestPost({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const slug = String(params.slug || '')
    .toLowerCase()
    .trim();
  if (!slug) return json({ error: 'slug_required' }, 400);

  const result = await proxyOrdersAdmin(
    env,
    `/admin/partners/${encodeURIComponent(slug)}/setup-token`,
    { method: 'POST', body: '{}' }
  );
  return json(result.data, result.status);
}
