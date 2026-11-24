/**
 * supplier@springfieldpbc.com
 *
 * Two ways mail arrives:
 *   1. Directly from show-me-source: Remy uses supplier@springfieldpbc.com as the email on
 *      his show-me-source orders, so their order receipts and shipping notices land here.
 *   2. Forwarded by Remy (from ALLOWED_FORWARDERS, a secret), e.g. older emails.
 *
 * Trust: forwarded mail is trusted when the envelope sender is in ALLOWED_FORWARDERS.
 * Direct mail is trusted when its From domain is in TRUSTED_SENDER_DOMAINS and Cloudflare's
 * Authentication-Results say DKIM or SPF passed for that domain (so nobody can fake it).
 * Anything else is kept as untrusted (so Remy can see who wrote) but the matching jobs
 * ignore it. Untrusted mail is capped per day so the inbox cannot be flooded.
 *
 * COPY_TO (optional var): a copy of trusted direct mail is forwarded there (Remy's Outlook),
 * so he still sees show-me-source emails. The address must be verified in Email Routing.
 *
 * Outlook often forwards emails AS ATTACHMENTS (always when several are forwarded at once).
 * For trusted forwards, each attached email (.eml / message/rfc822) is opened and saved as
 * its own row; the empty outer note is skipped. Outlook .msg files cannot be read here and
 * are logged as kind 'unsupported_msg' so Remy can be told to forward them inline.
 */
import { paymentAlert } from './jobs.js';
import PostalMime from 'postal-mime';
import { ensureSyncSchema } from './schema.js';

const MAX_BODY = 200000; // characters kept per email (text and html each)
const MAX_UNTRUSTED_PER_DAY = 100;

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

function list(v) {
  return String(v || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function allowedSender(env, from) {
  const allowed = list(env.ALLOWED_FORWARDERS);
  return allowed.length > 0 && allowed.includes(String(from || '').trim().toLowerCase());
}

function domainOf(addr) {
  return String(addr || '').toLowerCase().split('@')[1] || '';
}

/** True when `dom` equals `trusted` or is a subdomain of it. */
function sameOrSub(dom, trusted) {
  return dom === trusted || dom.endsWith(`.${trusted}`);
}

/**
 * Did DKIM or SPF pass for a trusted domain? Reads Authentication-Results headers
 * (added by Cloudflare Email Routing). Returns the passing method or ''.
 */
export function authPass(authHeaders, fromAddr, trustedDomains) {
  const fromDom = domainOf(fromAddr);
  const trusted = trustedDomains.find((t) => sameOrSub(fromDom, t));
  if (!trusted) return '';
  for (const h of authHeaders) {
    const v = String(h || '').toLowerCase();
    for (const m of v.matchAll(/dkim=pass[^;]*?header\.(?:d|i)=@?([a-z0-9.-]+)/g)) {
      if (sameOrSub(m[1], trusted)) return 'dkim';
    }
    for (const m of v.matchAll(/spf=pass[^;]*?smtp\.mailfrom=(?:[^@\s;]*@)?([a-z0-9.-]+)/g)) {
      if (sameOrSub(m[1], trusted)) return 'spf';
    }
  }
  return '';
}

function mask(addr) {
  const [user, dom] = String(addr || '').split('@');
  return `${(user || '').slice(0, 3)}***@${dom || '?'}`;
}

export async function handleEmail(message, env) {
  const envelopeFrom = String(message.from || '').trim().toLowerCase();
  const forwarded = allowedSender(env, envelopeFrom);
  const email = await PostalMime.parse(message.raw);
  const subject = String(email.subject || '').slice(0, 500);
  const text = String(email.text || '').slice(0, MAX_BODY);
  const html = String(email.html || '').slice(0, MAX_BODY);
  const origFrom = String((email.from && email.from.address) || '').toLowerCase();
  const authHeaders = (email.headers || [])
    .filter((h) => String(h.key || '').toLowerCase() === 'authentication-results')
    .map((h) => h.value);
  const trustedDomains = list(env.TRUSTED_SENDER_DOMAINS || 'show-me-source.com');
  const direct = forwarded ? '' : authPass(authHeaders, origFrom, trustedDomains);
  const trusted = forwarded || !!direct;
  const kind = mailKind(origFrom, subject, text || html);

  await ensureSyncSchema(env.DB);
  if (!trusted) {
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM supplier_mail WHERE trusted = 0 AND received_at > datetime('now', '-1 day')"
    ).first();
    if (n && n.n >= MAX_UNTRUSTED_PER_DAY) {
      console.log(JSON.stringify({ msg: 'supplier_mail.rejected_flood', from_masked: mask(origFrom || envelopeFrom) }));
      message.setReject('Mailbox busy');
      return { stored: false };
    }
  }

  // Emails Outlook attached to a forward: save each one (only for trusted forwards).
  const attached = forwarded ? await attachedEmails(email) : [];
  for (const a of attached) {
    await insertMail(env.DB, { ...a, envelopeFrom, trusted: true, auth: 'forwarded-attachment' });
  }
  const outerEmpty = !subject.trim() && !htmlToPlain(text || html).trim();
  let stored = false;
  if (!(attached.length && outerEmpty)) {
    stored = await insertMail(env.DB, {
      messageId: email.messageId,
      fromAddr: origFrom,
      subject,
      kind,
      text,
      html,
      sentAt: email.date,
      envelopeFrom,
      trusted,
      auth: forwarded ? 'forwarded' : direct || 'none',
    });
  }

  // A payment just arrived: match it and tell Remy right away (each step has its own switch).
  if (stored && trusted && kind === 'venmo') {
    try {
      await paymentAlert(env, env.DB, { from_addr: origFrom, subject, text_body: text, html_body: html, sent_at: email.date, received_at: new Date().toISOString() });
    } catch (e) {
      console.log(JSON.stringify({ msg: 'payment_alert.failed', error: String(e.message || e).slice(0, 120) }));
    }
  }

  // Keep Remy's Outlook in the loop for mail show-me-source sent here directly.
  if (stored && direct && env.COPY_TO) {
    try {
      await message.forward(env.COPY_TO);
    } catch (e) {
      console.log(JSON.stringify({ msg: 'supplier_mail.copy_failed', error: String(e.message || e).slice(0, 120) }));
    }
  }
  console.log(
    JSON.stringify({
      msg: stored ? 'supplier_mail.stored' : 'supplier_mail.duplicate',
      kind,
      trusted,
      via: forwarded ? 'forwarded' : direct || 'untrusted',
      from_masked: mask(origFrom || envelopeFrom),
      attachments_saved: attached.length,
    })
  );
  return { stored, kind, trusted, attached: attached.length };
}

function htmlToPlain(s) {
  return String(s || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

async function insertMail(db, m) {
  const res = await db
    .prepare(
      `INSERT INTO supplier_mail (message_id, envelope_from, from_addr, subject, kind, text_body, html_body, sent_at, trusted, auth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`
    )
    .bind(
      String(m.messageId || `${Date.now()}-${Math.random()}`).slice(0, 300),
      m.envelopeFrom,
      String(m.fromAddr || '').toLowerCase().slice(0, 300),
      String(m.subject || '').slice(0, 500),
      m.kind,
      String(m.text || '').slice(0, MAX_BODY),
      String(m.html || '').slice(0, MAX_BODY),
      m.sentAt || null,
      m.trusted ? 1 : 0,
      m.auth
    )
    .run();
  return !!(res && res.meta && res.meta.changes);
}

/** Emails attached to a forward (.eml / message/rfc822), parsed. .msg files are reported, not read. */
export async function attachedEmails(email) {
  const out = [];
  for (const att of email.attachments || []) {
    const type = String(att.mimeType || '').toLowerCase();
    const name = String(att.filename || '').toLowerCase();
    if (type === 'message/rfc822' || name.endsWith('.eml')) {
      try {
        const inner = await PostalMime.parse(att.content);
        const from = String((inner.from && inner.from.address) || '').toLowerCase();
        const text = String(inner.text || '');
        const html = String(inner.html || '');
        out.push({
          messageId: inner.messageId,
          fromAddr: from,
          subject: inner.subject || '',
          kind: mailKind(from, inner.subject || '', text || htmlToPlain(html)),
          text,
          html,
          sentAt: inner.date,
        });
      } catch (e) {
        console.log(JSON.stringify({ msg: 'supplier_mail.attachment_unreadable', error: String(e.message || e).slice(0, 120) }));
      }
    } else if (type === 'application/vnd.ms-outlook' || name.endsWith('.msg')) {
      out.push({
        messageId: `msg-${name}-${Date.now()}-${Math.random()}`,
        fromAddr: '',
        subject: att.filename || 'Outlook .msg attachment',
        kind: 'unsupported_msg',
        text: '',
        html: '',
        sentAt: null,
      });
    }
  }
  return out;
}
