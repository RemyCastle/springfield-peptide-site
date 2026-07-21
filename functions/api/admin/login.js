import {
  json,
  createSessionCookie,
  timingSafeEqualStr,
} from '../../lib/auth.js';

/** Shared master login with Patriotic: remy + MASTER_ADMIN_PASSWORD */
const DEFAULT_MASTER_USER = 'remy';

export async function onRequestPost({ request, env }) {
  const masterUser = String(env.MASTER_ADMIN_USERNAME || DEFAULT_MASTER_USER)
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
  const masterPass = String(
    env.MASTER_ADMIN_PASSWORD || env.ADMIN_PASSWORD || ''
  )
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n$/g, '');

  const legacyUser = String(env.ADMIN_USERNAME || '')
    .replace(/^\uFEFF/, '')
    .trim();
  const legacyPass = String(env.ADMIN_PASSWORD || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n$/g, '');

  if (!env.ADMIN_SESSION_SECRET) {
    return json({ error: 'Admin auth is not configured' }, 500);
  }
  if (!masterPass && !legacyPass) {
    return json({ error: 'Admin auth is not configured' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const userLower = username.toLowerCase();

  let ok = false;
  let role = 'master';
  let displayName = username;

  if (
    masterPass &&
    timingSafeEqualStr(userLower, masterUser) &&
    timingSafeEqualStr(password, masterPass)
  ) {
    ok = true;
    role = 'master';
    displayName = 'Remy';
  } else if (
    legacyUser &&
    legacyPass &&
    timingSafeEqualStr(username, legacyUser) &&
    timingSafeEqualStr(password, legacyPass)
  ) {
    ok = true;
    role = 'master';
    displayName = legacyUser;
  }

  if (!ok) {
    return json({ error: 'Invalid username or password' }, 401);
  }

  const cookie = await createSessionCookie(env);
  return json(
    {
      ok: true,
      user: {
        username: userLower,
        display_name: displayName,
        role,
        must_change_password: false,
      },
    },
    200,
    { 'Set-Cookie': cookie }
  );
}
