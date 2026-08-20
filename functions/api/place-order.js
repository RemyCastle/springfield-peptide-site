/**
 * POST /api/place-order
 * Browser → this function (secret stays server-side) → SPBC Orders Worker webhook.
 *
 * Env (Pages secrets / vars):
 *   ORDER_WEBHOOK_SECRET  — same HMAC secret as spbc-orders
 *   ORDERS_WEBHOOK_URL    — optional, default https://spbc-orders.spbc.workers.dev/webhooks/order
 *   ORDERS_PUBLIC_URL     — optional, default https://spbc-orders.spbc.workers.dev
 */
function dollarsToCents(d) {
  return Math.round(Number(d) * 100);
}

function isBacName(name) {
  return /bac\s*water/i.test(String(name || ''));
}

function skuFrom(name, kind) {
  const base = String(name)
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  return `${base}-${kind === 'vial' ? 'VIAL' : 'KIT'}`.slice(0, 64);
}

function stripLineSuffix(itemName) {
  return String(itemName || '')
    .replace(/\s+\((?:10-Pack \/ Kit|Kit|Vial)\)\s*$/i, '')
    .trim();
}

function resolveBacRow(rows) {
  const bac = (rows || []).filter((r) => isBacName(r.name) && r.active !== 0);
  const prefer = ['BAC WATER 2.5ML', 'BAC WATER 3ML', 'BAC WATER 10 ML'];
  for (const name of prefer) {
    const hit = bac.find((r) => r.name === name);
    if (hit) return hit;
  }
  return bac[0] || null;
}

function packCents(row) {
  const n = Number(row && row.pack_price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return dollarsToCents(n);
}

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
  const byName = new Map(catalog.map((r) => [r.name, r]));

  // Re-price from D1. Client qty/name are the order; client unit_price_cents is ignored.
  const normalizedItems = [];
  let peptideKits = 0;
  let bacKits = 0;
  for (const it of items) {
    const itemName = String(it.name || '').trim().slice(0, 200);
    const qty = parseInt(it.qty, 10);
    const productName = stripLineSuffix(itemName);
    if (!productName || !Number.isFinite(qty) || qty < 1) {
      return json(
        {
          error: 'validation_failed',
          message: 'invalid item line',
          item: it,
        },
        400
      );
    }
    const row = byName.get(productName);
    if (!row) {
      return json(
        {
          error: 'validation_failed',
          message: `Unknown product: ${productName}`,
        },
        400
      );
    }
    const unit = packCents(row);
    if (unit == null) {
      return json(
        {
          error: 'validation_failed',
          message: `No catalog kit price for ${productName}`,
        },
        400
      );
    }
    const kitLabel = row.kit_only ? 'Kit' : '10-Pack / Kit';
    normalizedItems.push({
      sku: skuFrom(row.name, 'kit'),
      name: `${row.name} (${kitLabel})`,
      qty,
      unit_price_cents: unit,
    });
    if (isBacName(row.name)) bacKits += qty;
    else peptideKits += qty;
  }

  const bacRow = resolveBacRow(catalog);
  const bacNeed = Math.max(0, peptideKits - bacKits);
  if (bacNeed > 0 && bacRow) {
    const unit = packCents(bacRow);
    if (unit != null) {
      normalizedItems.push({
        sku: skuFrom(bacRow.name, 'kit'),
        name: `${bacRow.name} (Kit)`,
        qty: bacNeed,
        unit_price_cents: unit,
      });
    }
  }

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
