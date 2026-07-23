/**
 * PATCH /api/admin/franchisees/:slug — e.g. { active: false } to soft-deactivate
 */
import { json, requireAdmin } from '../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../lib/ordersProxy.js';

export async function onRequestPatch({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const slug = String(params.slug || '')
    .toLowerCase()
    .trim();
  if (!slug) return json({ error: 'slug_required' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const result = await proxyOrdersAdmin(
    env,
    `/admin/partners/${encodeURIComponent(slug)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  );
  return json(result.data, result.status);
}
