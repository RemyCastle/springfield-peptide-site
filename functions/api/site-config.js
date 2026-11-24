/** GET /api/site-config -> public settings the forms need (the bot-check site key is public). */
export function onRequestGet({ env }) {
  return new Response(JSON.stringify({ turnstile_site_key: String(env.TURNSTILE_SITE_KEY || '') }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
