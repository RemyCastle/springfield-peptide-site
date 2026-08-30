/**
 * POST /api/place-order
 * Browser → this function (secret stays server-side) → SPBC Orders Worker webhook.
 *
 * Env (Pages secrets / vars):
 *   ORDER_WEBHOOK_SECRET  — same HMAC secret as spbc-orders
 *   ORDERS_WEBHOOK_URL    — optional, default https://spbc-orders.spbc.workers.dev/webhooks/order
 *   ORDERS_PUBLIC_URL     — optional, default https://spbc-orders.spbc.workers.dev
 *
 * No vial minimum. True kit_only products (HGH) cannot be ordered as vials.
 * Vial-only rows (RETA 66MG) are priced from vial_price.
 */
import { normalizeOrderItems } from '../lib/orderItems.js';

async function loadActiveProducts(env) {
  if (!env.DB) return null;
  const { results } = await env.DB.prepare(
    `SELECT name, vial_price, pack_price, kit_only, active
     FROM products
     WHERE active = 1`
  ).all();
  return results || [];
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function bufferToHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function hmacSha256Hex(secret, rawBody) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(rawBody)
  );
  return bufferToHex(sig);
}

export async function onRequestPost({ request, env }) {
  if (!env.ORDER_WEBHOOK_SECRET) {
    return json(
      {
        error: 'server_misconfigured',
        message: 'ORDER_WEBHOOK_SECRET not set on Pages',
      },
      500
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const customer = body.customer || {};
  const name = String(customer.name || '').trim();
  const email = String(customer.email || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!name || !email || !items.length) {
    return json(
      {
        error: 'validation_failed',
        message: 'name, email, and at least one item are required',
      },
      400
    );
  }

  let catalog;
  try {
    catalog = await loadActiveProducts(env);
  } catch (e) {
    return json(
      {
        error: 'catalog_unavailable',
        message: 'Could not read catalog prices',
      },
      500
    );
  }
  if (!catalog) {
    return json(
      {
        error: 'server_misconfigured',
        message: 'Database not configured',
      },
      500
    );
  }
  // Re-price from D1. Client qty/name/sku choose the line; client unit_price_cents is ignored.
  // One vial is legal. kit_only products cannot be ordered as vials.
  const priced = normalizeOrderItems(items, catalog);
  if (!priced.ok) {
    return json(
      {
        error: priced.error,
        message: priced.message,
        item: priced.item,
      },
      priced.status
    );
  }
  const normalizedItems = priced.items;

  const subtotal = normalizedItems.reduce(
    (s, it) => s + it.qty * it.unit_price_cents,
    0
  );
  const shipping = Math.max(0, parseInt(body.shipping_cents, 10) || 0);
  // Server total wins. Client total_cents is not trusted.
  const total = subtotal + shipping;

  const eventId =
    String(body.event_id || '').trim() ||
    `evt_site_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const payload = {
    event_id: eventId,
    customer: { name, email },
    items: normalizedItems,
    subtotal_cents: subtotal,
    shipping_cents: shipping,
    total_cents: total,
    currency: String(body.currency || 'USD').toUpperCase().slice(0, 3),
    notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
  };

  const rawBody = JSON.stringify(payload);
  const signature = await hmacSha256Hex(env.ORDER_WEBHOOK_SECRET, rawBody);

  const webhookUrl =
    env.ORDERS_WEBHOOK_URL ||
    'https://spbc-orders.spbc.workers.dev/webhooks/order';
  const publicBase =
    (env.ORDERS_PUBLIC_URL || 'https://spbc-orders.spbc.workers.dev').replace(
      /\/$/,
      ''
    );

  let upstream;
  try {
    upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SPBC-Signature': signature,
      },
      body: rawBody,
    });
  } catch (e) {
    return json(
      {
        error: 'upstream_unreachable',
        message: e instanceof Error ? e.message : String(e),
      },
      502
    );
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return json(
      {
        error: 'upstream_bad_response',
        status: upstream.status,
      },
      502
    );
  }

  if (!upstream.ok) {
    return json(
      {
        error: data.error || 'order_failed',
        message: data.message || 'Orders service rejected the order',
        details: data,
      },
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502
    );
  }

  const orderNumber = data.order_number;

  // Forward shipping address server-side (no browser→worker CORS).
  // On failure still return order success; client shows shipping link fallback.
  let shipping_saved = false;
  const shipIn = body.shipping || body.address || {};
  const ship_name = String(shipIn.ship_name || name).trim();
  const ship_line1 = String(shipIn.ship_line1 || '').trim();
  const ship_line2 = String(shipIn.ship_line2 || '').trim();
  const ship_city = String(shipIn.ship_city || '').trim();
  const ship_state = String(shipIn.ship_state || '').trim().toUpperCase();
  const ship_postal = String(shipIn.ship_postal || '').trim();
  const ship_phone = String(shipIn.ship_phone || '').trim();
  const ship_country = 'US';
  const hasShip =
    orderNumber &&
    ship_name &&
    ship_line1 &&
    ship_city &&
    ship_state &&
    ship_postal;

  if (hasShip) {
    try {
      const shipRes = await fetch(
        `${publicBase}/shipping/${encodeURIComponent(orderNumber)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            ship_name,
            ship_line1,
            ship_line2: ship_line2 || undefined,
            ship_city,
            ship_state,
            ship_postal,
            ship_country,
            ship_phone: ship_phone || undefined,
          }),
        }
      );
      shipping_saved = shipRes.ok;
    } catch {
      shipping_saved = false;
    }
  }

  return json({
    ok: true,
    duplicate: Boolean(data.duplicate),
    order_number: orderNumber,
    status: data.status || 'pending_payment',
    total_cents: data.total_cents ?? total,
    currency: data.currency || payload.currency,
    shipping_saved,
    pay_url: orderNumber ? `${publicBase}/pay/${encodeURIComponent(orderNumber)}` : null,
    shipping_url: orderNumber
      ? `${publicBase}/shipping/${encodeURIComponent(orderNumber)}`
      : null,
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
