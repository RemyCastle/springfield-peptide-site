/**
 * POST /api/admin/sign-out-everywhere -> ends every admin session (all devices, this one too).
 */
import { json, requireAdmin, revokeAllSessions, clearSessionCookie } from '../../lib/auth.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);
  await revokeAllSessions(env);
  const res = json({ ok: true, message: 'Signed out on every device. Sign in again.' });
  res.headers.append('Set-Cookie', clearSessionCookie());
  return res;
}
