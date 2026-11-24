/**
 * POST /api/place-order  (website checkout)
 * Browser -> this function (secret stays server-side) -> SPBC Orders Worker webhook.
 * All pricing, minimum and shipping rules live in ../lib/createOrder.js (shared with the
 * admin Quick order). Client prices, totals and shipping_cents are ignored.
 */
import { createOrder } from '../lib/createOrder.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const customer = body.customer || {};
  const result = await createOrder(env, {
    name: customer.name,
    email: customer.email,
    items: body.items,
    shipping: body.shipping || body.address,
    notes: body.notes,
    eventId: body.event_id,
    currency: body.currency,
    speed: body.shipping_speed,
    deliveryNotes: body.delivery_notes,
    confirmDuplicate: body.confirm_duplicate === true,
    turnstileToken: body.turnstile_token,
    ip: request.headers.get('CF-Connecting-IP') || '',
  });
  return json(result.body, result.status);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}
