/**
 * PATCH /api/admin/franchisees/:slug/prices
 * Body: { partner_name, franchisee_vial_cents?, franchisee_pack_cents? }
 * null clears override → SPBC customer price fallback.
 */
import { json, requireAdmin } from '../../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../../lib/ordersProxy.js';

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
    `/admin/partners/${encodeURIComponent(slug)}/product-links/franchisee`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        partner_name: body.partner_name,
        franchisee_vial_cents: body.franchisee_vial_cents,
        franchisee_pack_cents: body.franchisee_pack_cents,
      }),
    }
  );
  return json(result.data, result.status);
}
