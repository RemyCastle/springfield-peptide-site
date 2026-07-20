import {
  json,
  createSessionCookie,
  timingSafeEqualStr,
} from '../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) {
    return json({ error: 'Admin auth is not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Trim inputs + env secrets (PowerShell/wrangler pipes often add trailing \r\n)
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const expectedUser = String(env.ADMIN_USERNAME || '')
    .replace(/^\uFEFF/, '')
    .trim();
  const expectedPass = String(env.ADMIN_PASSWORD || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n$/g, '');

  const userOk = timingSafeEqualStr(username, expectedUser);
  const passOk = timingSafeEqualStr(password, expectedPass);

  if (!userOk || !passOk) {
    return json({ error: 'Invalid username or password' }, 401);
  }

  const cookie = await createSessionCookie(env);
  return json(
    { ok: true },
    200,
    { 'Set-Cookie': cookie }
  );
}
