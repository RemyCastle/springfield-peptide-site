/**
 * PATCH /api/admin/franchisees/:slug/schedule
 * Body: { batch_weekday?: 0-6 (Sun-Sat), batch_tz?: string, fulfillment_mode?: 'batch'|'immediate' }
 *
 * 'batch'     — paid retail stacks all week, then ONE master wholesale order on batch_weekday.
 * 'immediate' — each paid retail order dropships on its own.
 * Emergency purchases are never part of the retail batch.
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

  const patch = {};
  if (body.batch_weekday !== undefined) patch.batch_weekday = Number(body.batch_weekday);
  if (body.batch_tz !== undefined) patch.batch_tz = body.batch_tz;
  if (body.fulfillment_mode !== undefined) patch.fulfillment_mode = body.fulfillment_mode;

  const result = await proxyOrdersAdmin(
    env,
    `/admin/partners/${encodeURIComponent(slug)}/schedule`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );
  return json(result.data, result.status);
}
