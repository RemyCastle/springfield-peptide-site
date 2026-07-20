/**
 * POST /api/admin/orders/:orderNumber/notify-supplier
 *
 * After payment only. Builds no-price payload (with suppliers from D1) and
 * POSTs to the always-on Render bot (SUPPLIER_BOT_URL + SUPPLIER_NOTIFY_SECRET).
 *
 * Env (Pages):
 *   ORDERS_ADMIN_TOKEN, ORDERS_PUBLIC_URL (proxy order detail)
 *   SUPPLIER_BOT_URL — e.g. https://spbc-supplier-bot.onrender.com/notify
 *   SUPPLIER_NOTIFY_SECRET — same as bot NOTIFY_SECRET
 *   (fallback) TELEGRAM_BOT_TOKEN + SUPPLIER_TELEGRAM_CHAT_ID if bot URL unset
 */
import { json, requireAdmin } from '../../../../lib/auth.js';
import { proxyOrdersAdmin } from '../../../../lib/ordersProxy.js';
import { ensureCatalogSchema } from '../../../../lib/db.js';

function stripKindSuffix(name) {
  return String(name || '')
    .replace(/\s*\((Vial|Kit|10-Pack\s*\/\s*Kit|10-Pack)\)$/i, '')
    .trim();
}

async function loadCatalog(env) {
  if (!env.DB) return { sources: {}, products: {}, suppliers: {} };
  await ensureCatalogSchema(env);
  const { results } = await env.DB.prepare(
    `SELECT p.name, p.source, p.supplier_id,
            s.name AS supplier_name, s.telegram_chat_id AS supplier_telegram_chat_id
     FROM products p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.active = 1`
  ).all();

  const sources = {};
  const products = {};
  const suppliers = {};
  for (const row of results || []) {
    if (!row.name) continue;
    const supplier =
      row.supplier_name != null && String(row.supplier_name).trim()
        ? String(row.supplier_name).trim()
        : null;
    const notes =
      row.source != null && String(row.source).trim()
        ? String(row.source).trim()
        : null;
    const chatId =
      row.supplier_telegram_chat_id != null &&
      String(row.supplier_telegram_chat_id).trim()
        ? String(row.supplier_telegram_chat_id).trim()
        : null;
    let label = supplier;
    if (supplier && notes) label = `${supplier} · ${notes}`;
    else if (!supplier && notes) label = notes;
    if (label) sources[String(row.name)] = label;
    products[String(row.name)] = {
      supplier,
      notes,
      supplier_id: row.supplier_id == null ? null : Number(row.supplier_id),
      telegram_chat_id: chatId,
    };
    if (supplier) {
      suppliers[supplier] = { name: supplier, telegram_chat_id: chatId };
    }
  }
  return { sources, products, suppliers };
}

function enrichItems(items, catalog) {
  return (items || []).map((it) => {
    const base = stripKindSuffix(it.name);
    const meta = catalog.products[base] || catalog.products[it.name] || {};
    const supplierName = meta.supplier || null;
    const chatFromMap =
      supplierName && catalog.suppliers[supplierName]
        ? catalog.suppliers[supplierName].telegram_chat_id
        : null;
    return {
      name: it.name,
      qty: it.qty,
      supplier: supplierName,
      source: meta.notes || catalog.sources[base] || catalog.sources[it.name] || null,
      telegram_chat_id: meta.telegram_chat_id || chatFromMap || null,
    };
  });
}

export async function onRequestPost({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const orderNumber = params?.orderNumber;
  if (!orderNumber) return json({ error: 'order_number required' }, 400);

  let adminNote = '';
  try {
    const body = await request.json();
    if (body && body.note) adminNote = String(body.note).trim().slice(0, 500);
  } catch {
    /* empty ok */
  }

  const result = await proxyOrdersAdmin(
    env,
    `/admin/orders/${encodeURIComponent(String(orderNumber).trim())}`
  );
  if (result.status >= 400 || !result.data?.order) {
    return json(
      result.data || { error: 'order_fetch_failed' },
      result.status >= 400 ? result.status : 502
    );
  }

  const order = result.data.order;
  const items = result.data.items || [];

  const paidStatuses = new Set(['paid', 'shipped', 'complete']);
  if (!paidStatuses.has(String(order.status || ''))) {
    return json(
      {
        error: 'payment_required',
        message:
          'Supplier Telegram only after payment (mark order paid first).',
        status: order.status,
      },
      400
    );
  }

  const catalog = await loadCatalog(env);
  const payload = {
    order_number: order.order_number,
    status: order.status,
    customer_name: order.customer_name,
    items: enrichItems(items, catalog),
    sources: catalog.sources,
    products: catalog.products,
    suppliers: catalog.suppliers,
    note: adminNote || undefined,
    shipping: order.shipping_complete
      ? {
          name: order.ship_name,
          line1: order.ship_line1,
          line2: order.ship_line2,
          city: order.ship_city,
          state: order.ship_state,
          postal: order.ship_postal,
          country: order.ship_country,
          phone: order.ship_phone,
        }
      : null,
  };

  const botUrl = String(
    env.SUPPLIER_BOT_URL || 'https://spbc-supplier-bot.onrender.com/notify'
  ).trim();
  const secret = String(env.SUPPLIER_NOTIFY_SECRET || env.NOTIFY_SECRET || '').trim();

  if (!secret) {
    return json(
      {
        error: 'telegram_not_configured',
        message:
          'Set Pages secret SUPPLIER_NOTIFY_SECRET (same as Render NOTIFY_SECRET).',
      },
      503
    );
  }

  try {
    const tgRes = await fetch(botUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Notify-Secret': secret,
      },
      body: JSON.stringify(payload),
    });
    const tgData = await tgRes.json().catch(() => ({}));
    if (!tgRes.ok || !tgData.ok) {
      return json(
        {
          error: 'telegram_send_failed',
          message: tgData.message || tgData.error || `Bot HTTP ${tgRes.status}`,
          detail: tgData,
        },
        502
      );
    }
    return json({
      ok: true,
      order_number: order.order_number,
      telegram_message_id: tgData.telegram_message_id ?? null,
      via: 'render_bot',
    });
  } catch (e) {
    return json(
      {
        error: 'telegram_send_failed',
        message: e instanceof Error ? e.message : String(e),
      },
      502
    );
  }
}
