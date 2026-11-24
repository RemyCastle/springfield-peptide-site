/**
 * One email sender for every automation (restock, price drop, payment reminder, digest).
 * Uses Resend. Needs RESEND_API_KEY (secret) and RESTOCK_FROM (sender on a verified
 * domain). RESEND_API_URL exists only for local tests.
 */
export function emailReady(env) {
  return !!(env.RESEND_API_KEY && env.RESTOCK_FROM);
}

export async function sendEmail(env, { to, subject, html, text, headers }) {
  if (!emailReady(env)) return false;
  const res = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESTOCK_FROM, to: Array.isArray(to) ? to : [to], subject, html, ...(text ? { text } : {}), ...(headers ? { headers } : {}) }),
  });
  return res.ok;
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

export function siteUrl(env) {
  return String(env.SITE_URL || 'https://springfieldpbc.com').replace(/\/$/, '');
}

/** Plain, readable email wrapper. */
export function wrap(inner) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#14251C;max-width:560px">
<div style="background:#12392A;color:#F6F7F2;padding:12px 16px;border-radius:10px 10px 0 0;border-bottom:3px solid #F3D94A;font-weight:bold;letter-spacing:.06em">SPBC</div>
<div style="padding:16px;border:1px solid #DEDCD2;border-top:0;border-radius:0 0 10px 10px">${inner}
<p style="font-size:12px;color:#5F6E65;margin-top:24px">Springfield Peptide Buyers Club · research use only</p></div></div>`;
}
