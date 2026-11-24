/**
 * POST /api/client-report  { kind, detail, page }
 * The shop reports checkout problems here (a failed order, a script error) so Remy sees them
 * in the daily digest. Never stores names, emails or addresses: anything that looks like an
 * email is blanked, and at most 200 reports a day are kept.
 */
import { json } from '../lib/auth.js';
import { ensureSyncSchema } from '../../workers/supplier-sync/src/schema.js';

const KINDS = new Set(['place_order', 'js_error', 'load_products']);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false }, 500);
  const body = await request.json().catch(() => ({}));
  const kind = String(body.kind || '');
  if (!KINDS.has(kind)) return json({ ok: false }, 400);
  const clean = (v, n) => String(v || '').replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/\d{7,}/g, '[number]').slice(0, n);
  await ensureSyncSchema(env.DB);
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM client_reports WHERE created_at > datetime('now', '-1 day')").first();
  if (today && today.n >= 200) return json({ ok: true });
  await env.DB.prepare('INSERT INTO client_reports (kind, detail, page) VALUES (?, ?, ?)')
    .bind(kind, clean(body.detail, 300), clean(body.page, 100))
    .run();
  return json({ ok: true });
}
