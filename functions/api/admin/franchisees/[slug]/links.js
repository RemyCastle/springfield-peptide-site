/**
 * PUT /api/admin/franchisees/:slug/links
 * Body: { partner_name, spbc_name, partner_sku? }
 *
 * Upserts the partner's product_link. Required before franchisee prices can be set:
 * the worker's franchisee PATCH returns link_not_found when no link exists, which is
 * how a product could end up with NULL overrides silently tracking the public price.
 * Call this first, then PATCH .../prices.
 *
 * DELETE /api/admin/franchisees/:slug/links
 * Body: { partner_name }
 * Removes a product_link (e.g. stale names that no longer exist in the catalog).
 * Proxies worker DELETE /admin/partners/:slug/product-links — do not edit the worker.
 */
import { json, requireAdmin } from '../../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../../lib/ordersProxy.js';

export async function onRequestPut({ request, env, params }) {
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

  const partnerName = String(body.partner_name || '').trim();
  const spbcName = String(body.spbc_name || '').trim();
  if (!partnerName || !spbcName) {
    return json({ error: 'partner_name and spbc_name required' }, 400);
  }

  // Forward the catalog id when the caller knows it. Dropping it here made the worker
  // re-derive the id from spbc_name, which fails whenever our name and theirs differ.
  const rawId = body.spbc_product_id;
  const spbcProductId =
    rawId != null && Number.isFinite(Number(rawId)) ? Number(rawId) : null;

  const result = await proxyOrdersAdmin(
    env,
    `/admin/partners/${encodeURIComponent(slug)}/product-links`,
    {
      method: 'PUT',
      body: JSON.stringify({
        partner_name: partnerName,
        spbc_name: spbcName,
        partner_sku: body.partner_sku ?? null,
        spbc_product_id: spbcProductId,
      }),
    }
  );
  return json(result.data, result.status);
}

export async function onRequestDelete({ request, env, params }) {
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

  const partnerName = String(body.partner_name || '').trim();
  if (!partnerName) {
    return json({ error: 'partner_name required' }, 400);
  }

  const result = await proxyOrdersAdmin(
    env,
    `/admin/partners/${encodeURIComponent(slug)}/product-links`,
    {
      method: 'DELETE',
      body: JSON.stringify({ partner_name: partnerName }),
    }
  );
  return json(result.data, result.status);
}
