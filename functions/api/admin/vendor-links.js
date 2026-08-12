/**
 * Vendor product matching — admin only.
 *
 * GET  /api/admin/vendor-links          → every vendor shop, its products and
 *                                         its current SPBC→vendor mappings
 * POST /api/admin/vendor-links          → { spbc_name, shop_chat_id,
 *                                           vendor_product_id }  (or clear:true)
 *
 * The mapping lives in the bot (it owns vendor shops and their stock); this
 * proxies with the shared secret so the browser never sees it. Routing prefers
 * a mapping over matching by name, which is how a vendor who calls SPBC's
 * "HGH 360IU" their "H36" still gets quoted.
 */
import { json, requireAdmin } from '../../lib/auth.js';

function botBase(env) {
  const raw = String(
    env.SUPPLIER_BOT_URL || 'https://spbc-supplier-bot.onrender.com/notify'
  ).trim();
  return raw.replace(/\/notify\/?$/i, '');
}

function secretOf(env) {
  return String(env.SUPPLIER_NOTIFY_SECRET || env.NOTIFY_SECRET || '').trim();
}

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const secret = secretOf(env);
  if (!secret) {
    return json(
      { error: 'not_configured', message: 'SUPPLIER_NOTIFY_SECRET not set on Pages' },
      503
    );
  }
  try {
    const res = await fetch(`${botBase(env)}/vendor-catalogs`, {
      headers: { 'X-Notify-Secret': secret },
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

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const spbcName = String(body.spbc_name || '').trim();
  const shopChatId = Number(body.shop_chat_id);
  if (!spbcName || !Number.isFinite(shopChatId)) {
    return json(
      { error: 'validation_failed', message: 'spbc_name and shop_chat_id required' },
      400
    );
  }

  const secret = secretOf(env);
  if (!secret) {
    return json(
      { error: 'not_configured', message: 'SUPPLIER_NOTIFY_SECRET not set on Pages' },
      503
    );
  }

  const payload = { spbc_name: spbcName, shop_chat_id: shopChatId };
  if (body.clear) {
    payload.clear = true;
  } else {
    const pid = Number(body.vendor_product_id);
    if (!Number.isFinite(pid) || pid <= 0) {
      return json(
        { error: 'validation_failed', message: 'vendor_product_id required' },
        400
      );
    }
    payload.vendor_product_id = pid;
  }

  try {
    const res = await fetch(`${botBase(env)}/vendor-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Notify-Secret': secret },
      body: JSON.stringify(payload),
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
