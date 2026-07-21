import { json, verifySession } from '../../lib/auth.js';

export async function onRequestGet({ request, env }) {
  const ok = await verifySession(request, env);
  if (!ok) return json({ authenticated: false }, 401);
  return json({
    authenticated: true,
    user: {
      username: 'remy',
      display_name: 'Remy',
      role: 'master',
      must_change_password: false,
    },
  });
}
