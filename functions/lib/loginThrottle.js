/**
 * Slow down password guessing on the admin login.
 * MAX_FAILS wrong logins from one IP within WINDOW_MIN minutes -> that IP is refused for
 * WINDOW_MIN minutes. A successful login clears its count. Stored in D1 (login_attempts).
 * Any database error lets the login through (never lock Remy out because of a hiccup).
 */
export const MAX_FAILS = 8;
export const WINDOW_MIN = 15;

function ipOf(request) {
  return (request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown').split(',')[0].trim().slice(0, 64);
}

async function ensure(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT NOT NULL,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    )
    .run();
}

/** Returns a 429 Response when this IP is locked, else null. */
export async function loginLocked(request, env) {
  if (!env.DB) return null;
  try {
    await ensure(env.DB);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > datetime('now', ?)`
    )
      .bind(ipOf(request), `-${WINDOW_MIN} minutes`)
      .first();
    if (row && row.n >= MAX_FAILS) {
      return new Response(JSON.stringify({ error: `Too many wrong logins. Try again in ${WINDOW_MIN} minutes.` }), {
        status: 429,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(WINDOW_MIN * 60) },
      });
    }
  } catch {
    /* fail open */
  }
  return null;
}

/** Call with the login response: records failures, clears on success, prunes old rows. */
export async function noteLoginResult(request, env, status) {
  if (!env.DB) return;
  try {
    const ip = ipOf(request);
    if (status === 401) {
      await env.DB.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(ip).run();
    } else if (status === 200) {
      await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
    }
    await env.DB.prepare("DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')").run();
  } catch {
    /* ignore */
  }
}
