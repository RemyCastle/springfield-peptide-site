/**
 * One email sender for every automation (restock, price drop, payment reminder, digest).
 * Uses Resend. Needs RESEND_API_KEY (secret) and RESTOCK_FROM (sender on a verified
 * domain). RESEND_API_URL exists only for local tests.
 */
export function emailReady(env) {
  return !!(env.RESEND_API_KEY && env.RESTOCK_FROM);
}

export async function sendEmail(env, { to, subject, html }) {
  if (!emailReady(env)) return false;
  const res = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESTOCK_FROM, to: Array.isArray(to) ? to : [to], subject, html }),
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
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px">${inner}
<p style="font-size:12px;color:#666;margin-top:24px">Springfield Peptide Buyers Club · research use only</p></div>`;
}
