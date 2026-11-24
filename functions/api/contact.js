/**
 * POST /api/contact  { name, email, order_number?, message, turnstile_token? }
 * Contact form: saved for the admin (To do bar -> Messages) and emailed to Remy's
 * digest address when email sending is set up. Bot check when Turnstile keys exist;
 * at most 5 messages per hour from one connection.
 */
import { json } from '../lib/auth.js';
import { ensureSyncSchema, getSetting } from '../../workers/supplier-sync/src/schema.js';
import { esc, wrap, siteUrl } from '../../workers/supplier-sync/src/email.js';
import { turnstileOk } from '../lib/createOrder.js';
import { siteMail, siteMailReady, clientIp, overLimit } from '../lib/siteMail.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
  const order = String(body.order_number || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
  const message = String(body.message || '').trim().slice(0, 4000);
  if (!EMAIL_RE.test(email)) return json({ error: 'validation_failed', message: 'Enter a valid email so we can reply.' }, 400);
  if (message.length < 5) return json({ error: 'validation_failed', message: 'Write a short message.' }, 400);
  const ip = clientIp(request);
  if (!(await turnstileOk(env, body.turnstile_token, ip))) {
    return json({ error: 'turnstile_failed', message: 'Please complete the "I am human" check and send again.' }, 400);
  }
  await ensureSyncSchema(env.DB);
  if (await overLimit(env.DB, `contact:${ip}`, 5, 60)) {
    return json({ error: 'too_many', message: 'Too many messages in a short time. Please try again later.' }, 429);
  }
  await env.DB.prepare('INSERT INTO contact_messages (name, email, order_number, body) VALUES (?, ?, ?, ?)')
    .bind(name, email, order || null, message)
    .run();
  const to = await getSetting(env.DB, 'digest_to', '');
  if (to && siteMailReady(env)) {
    await siteMail(env, {
      to,
      subject: `SPBC contact form: ${name || email}${order ? ` (${order})` : ''}`,
      html: wrap(`<p><strong>${esc(name || '(no name)')}</strong> &lt;${esc(email)}&gt;${order ? ` · order ${esc(order)}` : ''}</p>
<p>${esc(message).replace(/\n/g, '<br>')}</p>
<p style="font-size:12px;color:#666">Reply to them at ${esc(email)}. Also saved in the <a href="${siteUrl(env)}/admin">admin</a>.</p>`),
      headers: { 'Reply-To': email },
    }).catch(() => false);
  }
  return json({ ok: true, message: "Thanks! We got your message and will reply by email, usually within one business day." });
}
