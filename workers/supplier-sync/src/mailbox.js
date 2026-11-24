/**
 * supplier@springfieldpbc.com: Remy's Outlook forwards show-me-source order receipts and
 * shipping emails (and payment notices, for name matching) here. Each one is saved in
 * D1 `supplier_mail` so the matching jobs (and Claude, when building them) can read it.
 *
 * Only envelope senders in ALLOWED_FORWARDERS (a secret Remy sets, comma-separated)
 * are accepted, so strangers cannot inject fake receipts or tracking.
 */
import PostalMime from 'postal-mime';
import { ensureSyncSchema } from './schema.js';

const MAX_BODY = 200000; // characters kept per email (text and html each)

export function mailKind(from, subject, text) {
  const hay = `${from}\n${subject}\n${text}`.toLowerCase();
  if (hay.includes('show-me-source') || hay.includes('show me source')) {
    if (/tracking|shipped|label|on its way|out for delivery/.test(hay)) return 'sms_shipping';
    return 'sms_order';
  }
  if (/venmo/.test(hay)) return 'venmo';
  if (/chime/.test(hay)) return 'chime';
  if (/paypal/.test(hay)) return 'paypal';
  return 'other';
}

export function allowedSender(env, from) {
  const allowed = String(env.ALLOWED_FORWARDERS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(String(from || '').trim().toLowerCase());
}

function mask(addr) {
  const [user, dom] = String(addr || '').split('@');
  return `${(user || '').slice(0, 3)}***@${dom || '?'}`;
}

export async function handleEmail(message, env) {
  const envelopeFrom = String(message.from || '').trim().toLowerCase();
  if (!allowedSender(env, envelopeFrom)) {
    console.log(JSON.stringify({ msg: 'supplier_mail.rejected_sender', from_masked: mask(envelopeFrom) }));
    message.setReject('Sender not allowed');
    return { stored: false };
  }
  const email = await PostalMime.parse(message.raw);
  const subject = String(email.subject || '').slice(0, 500);
  const text = String(email.text || '').slice(0, MAX_BODY);
  const html = String(email.html || '').slice(0, MAX_BODY);
  const origFrom = (email.from && email.from.address) || '';
  const kind = mailKind(origFrom, subject, text || html);
  await ensureSyncSchema(env.DB);
  const res = await env.DB.prepare(
    `INSERT INTO supplier_mail (message_id, envelope_from, from_addr, subject, kind, text_body, html_body, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`
  )
    .bind(
      String(email.messageId || `${Date.now()}-${Math.random()}`).slice(0, 300),
      envelopeFrom,
      String(origFrom).slice(0, 300),
      subject,
      kind,
      text,
      html,
      email.date || null
    )
    .run();
  const stored = !!(res && res.meta && res.meta.changes);
  console.log(JSON.stringify({ msg: stored ? 'supplier_mail.stored' : 'supplier_mail.duplicate', kind, subject: subject.slice(0, 80) }));
  return { stored, kind };
}
