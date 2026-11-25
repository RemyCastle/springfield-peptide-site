/**
 * GET /api/admin/health -> the things that fail quietly, in one place:
 * orders service, payment emails, owner emails, the 2-hourly sync job and its last errors.
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  const orders = await proxyOrdersAdmin(env, '/admin/health');
  const one = (sql, ...b) => env.DB.prepare(sql).bind(...b).first().catch(() => null);
  const [lastRun, lastError, errors24h] = await Promise.all([
    one(`SELECT MAX(created_at) AS at FROM supplier_sync_events`),
    one(`SELECT created_at, kind, detail FROM supplier_sync_events WHERE status = 'error' ORDER BY id DESC LIMIT 1`),
    one(`SELECT COUNT(*) AS n FROM supplier_sync_events WHERE status = 'error' AND created_at > datetime('now', '-1 day')`),
  ]);
  return json({
    ok: true,
    orders_service: orders.ok ? 'ok' : `error ${orders.status}`,
    health: orders.ok ? orders.data : null,
    sync_last_event: lastRun ? lastRun.at : null,
    sync_errors_24h: errors24h ? Number(errors24h.n) : null,
    sync_last_error: lastError ? { at: lastError.created_at, kind: lastError.kind, detail: String(lastError.detail || '').slice(0, 300) } : null,
  });
}
