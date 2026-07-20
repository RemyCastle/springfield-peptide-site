/**
 * POST /api/admin/telegram-resolve
 * Body: { username: "@foo" }
 * Proxies to Render bot /resolve-chat using SUPPLIER_BOT_URL + SUPPLIER_NOTIFY_SECRET.
 */
import { json, requireAdmin } from '../../lib/auth.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const username = String(body.username || body.telegram_username || '').trim();
  if (!username) {
    return json({ error: 'username_required', message: 'Telegram @username required' }, 400);
  }

  const secret = String(env.SUPPLIER_NOTIFY_SECRET || env.NOTIFY_SECRET || '').trim();
  let botBase = String(env.SUPPLIER_BOT_URL || 'https://spbc-supplier-bot.onrender.com/notify').trim();
  // SUPPLIER_BOT_URL may be full .../notify — resolve lives at host root
  botBase = botBase.replace(/\/notify\/?$/i, '');
  if (!secret) {
    return json(
      {
        error: 'not_configured',
        message: 'SUPPLIER_NOTIFY_SECRET not set on Pages',
      },
      503
    );
  }

  try {
    const res = await fetch(`${botBase}/resolve-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Notify-Secret': secret,
      },
      body: JSON.stringify({ username }),
    });
    const data = await res.json().catch(() => ({}));
    return json(data, res.status >= 400 ? res.status : 200);
  } catch (e) {
    return json(
      {
        error: 'upstream_failed',
        message: e instanceof Error ? e.message : String(e),
      },
      502
    );
  }
}
