/**
 * POST /api/coaching-request  (PUBLIC)
 * SPBC coaching form → this function → worker POST /admin/coaching-lead, which
 * emails the SPBC coaching inbox (priority + [Coaching Request] subject).
 * No mailto dependency — the request is delivered server-side.
 */
import { proxyOrdersAdmin } from '../lib/ordersProxy.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const name = String((b && b.name) || '').trim();
  const email = String((b && b.email) || '').trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'validation_failed', message: 'Name and a valid email are required.' }, 400);
  }
  const result = await proxyOrdersAdmin(env, '/admin/coaching-lead', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      hours: b.hours != null ? String(b.hours).slice(0, 20) : '',
      focus: b.focus != null ? String(b.focus).slice(0, 120) : '',
      times: b.times != null ? String(b.times).slice(0, 300) : '',
      goals: b.goals != null ? String(b.goals).slice(0, 3000) : '',
    }),
  });
  if (!result.ok) {
    return json(
      { error: 'send_failed', message: (result.data && (result.data.message || result.data.error)) || 'Could not send your request. Please email us directly.' },
      result.status >= 400 ? result.status : 502
    );
  }
  return json({ ok: true });
}
