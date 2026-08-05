/**
 * POST /api/admin/password — rotate the admin password from inside the panel.
 * Requires a valid session. Body: { username?, current_password?, new_password }
 *
 * `current_password` is required once a D1 credential exists; it stops a hijacked
 * session from silently changing the password and locking the owner out. When the
 * credential still lives in env vars there is nothing to check against, so a valid
 * session is the gate and this call migrates the credential into D1.
 */
import { json, requireAdmin } from '../../lib/auth.js';
import {
  getCredential,
  setCredential,
  verifyCredential,
} from '../../lib/adminCredential.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const existing = await getCredential(env);
  const username = String(body.username || existing?.username || 'remy').trim();

  if (existing) {
    const check = await verifyCredential(env, username, String(body.current_password || ''));
    if (!check || !check.ok) {
      return json(
        { error: 'bad_current_password', message: 'Current password is not correct.' },
        401
      );
    }
  }

  const result = await setCredential(env, username, String(body.new_password || ''));
  if (!result.ok) {
    return json({ error: 'invalid_input', message: result.error }, 400);
  }

  return json({
    ok: true,
    username,
    message: existing
      ? 'Password updated.'
      : 'Password saved to the database. The ADMIN_PASSWORD / MASTER_ADMIN_PASSWORD secrets are no longer used and can be deleted.',
  });
}
