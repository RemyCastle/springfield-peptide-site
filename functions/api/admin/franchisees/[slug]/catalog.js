/**
 * GET /api/admin/franchisees/:slug/catalog
 *
 * The franchisee's OWN product names, from their catalog snapshot. The products admin
 * needs these to tell a live product_link from an orphan: a link whose partner_name is
 * not in this list is invisible to their storefront, so a price saved onto it silently
 * does nothing. Returns names only — their retail prices are not our business here.
 *
 * Proxies worker GET /admin/partners/:slug/catalog-store.
 */
import { json, requireAdmin } from '../../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../../lib/ordersProxy.js';

export async function onRequestGet({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const slug = String(params.slug || '')
    .toLowerCase()
    .trim();
  if (!slug) return json({ error: 'slug_required' }, 400);

  const result = await proxyOrdersAdmin(
    env,
    `/admin/partners/${encodeURIComponent(slug)}/catalog-store`
  );
  if (!result.status || result.status >= 400) {
    return json(result.data ?? { error: 'catalog_unavailable' }, result.status || 502);
  }

  // The snapshot has moved shape before (bare array vs { products: [...] }). Accept both
  // rather than returning an empty list, which would mislabel every link as an orphan.
  const store = result.data?.store ?? result.data ?? null;
  const rows = Array.isArray(store) ? store : Array.isArray(store?.products) ? store.products : [];
  const names = rows
    .map((p) => String(p?.name || '').trim())
    .filter(Boolean);

  return json({ ok: true, names, count: names.length });
}
