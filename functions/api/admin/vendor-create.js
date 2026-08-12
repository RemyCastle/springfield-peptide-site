/**
 * POST /api/admin/vendor-create — stand up a new vendor shop.
 * Body: { name }
 *
 * The bot owns vendor shops, so this proxies with the shared secret and
 * returns the handover link to send the vendor plus a panel link for
 * stocking the shop before they claim it.
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
  const name = String(body.name || '').trim();
  if (!name) {
    return json({ error: 'validation_failed', message: 'Vendor name required' }, 400);
  }

  const secret = String(env.SUPPLIER_NOTIFY_SECRET || env.NOTIFY_SECRET || '').trim();
  if (!secret) {
    return json(
      { error: 'not_configured', message: 'SUPPLIER_NOTIFY_SECRET not set on Pages' },
      503
    );
  }
  const base = String(
    env.SUPPLIER_BOT_URL || 'https://spbc-supplier-bot.onrender.com/notify'
  )
    .trim()
    .replace(/\/notify\/?$/i, '');

  try {
    const res = await fetch(`${base}/vendor-create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Notify-Secret': secret },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    return json(data, res.status);
  } catch (e) {
    return json(
      { error: 'bot_unreachable', message: e instanceof Error ? e.message : String(e) },
      502
    );
  }
}
