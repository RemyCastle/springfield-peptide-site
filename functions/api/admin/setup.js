/**
 * GET  /api/admin/setup  → { needs_setup, token_required }
 * POST /api/admin/setup  → { setup_token, username, password } sets the first credential
 *
 * SECURITY — read before changing anything here.
 *
 * This route can create the admin credential WITHOUT an existing session, so it is the
 * one place on the site where getting it wrong hands someone else the admin panel.
 * Two gates, both required:
 *
 *   1. It refuses unless NO credential exists anywhere (no D1 row, no env password).
 *      After first use it is permanently closed until a credential is deliberately
 *      removed again.
 *   2. It requires ADMIN_SETUP_TOKEN to be set as a Pages secret and supplied in the
 *      body. Only someone who can write project secrets can mint that, which is the
 *      same level of access as setting the password directly. If the token is not
 *      configured, setup is disabled entirely — it does NOT fall open.
 *
 * Do not "simplify" either gate away.
 */
import { json, createSessionCookie, timingSafeEqualStr } from '../../lib/auth.js';
import { needsSetup, setCredential, MIN_PASSWORD } from '../../lib/adminCredential.js';

function setupToken(env) {
  return String(env.ADMIN_SETUP_TOKEN || '')
    .replace(/^﻿/, '')
    .replace(/\r?\n$/g, '')
    .trim();
}

export async function onRequestGet({ env }) {
  const pending = await needsSetup(env);
  return json({
    needs_setup: pending,
    // Tells the UI whether to even offer the form; never reveals the token itself.
    token_required: true,
    token_configured: Boolean(setupToken(env)),
    min_password: MIN_PASSWORD,
  });
}

export async function onRequestPost({ request, env }) {
  const pending = await needsSetup(env);
  if (!pending) {
    return json(
      {
        error: 'setup_closed',
        message:
          'An admin credential already exists. Sign in instead, or change the password from inside the admin panel.',
      },
      409
    );
  }

  const token = setupToken(env);
  if (!token) {
    return json(
      {
        error: 'setup_disabled',
        message:
          'First-run setup is not enabled. Set the ADMIN_SETUP_TOKEN secret on the Pages project, redeploy, then reload this page.',
      },
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const supplied = String(body.setup_token || '')
    .replace(/^﻿/, '')
    .trim();
  if (!supplied || !timingSafeEqualStr(supplied, token)) {
    return json({ error: 'bad_token', message: 'That setup code is not correct.' }, 401);
  }

  const result = await setCredential(env, body.username, body.password);
  if (!result.ok) {
    return json({ error: 'invalid_input', message: result.error }, 400);
  }

  if (!env.ADMIN_SESSION_SECRET) {
    // Credential is saved; they just cannot be logged in until this is configured.
    return json(
      {
        ok: true,
        signed_in: false,
        message: 'Credential saved, but ADMIN_SESSION_SECRET is not set so sessions cannot be issued.',
      },
      200
    );
  }

  const cookie = await createSessionCookie(env);
  return json(
    {
      ok: true,
      signed_in: true,
      user: { username: String(body.username || '').trim(), role: 'master' },
      message: 'Admin password set. Delete the ADMIN_SETUP_TOKEN secret now — setup is closed.',
    },
    200,
    { 'Set-Cookie': cookie }
  );
}
