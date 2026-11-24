/**
 * Load trusted forwarded/direct emails from supplier_mail and turn them into money events
 * (Venmo payments, show-me-source orders). Shared by the Money tab and the Place orders tab.
 */
import { parseMoneyMail, smsOrders } from '../../workers/supplier-sync/src/money.js';

/** Last ~13 months of trusted mail, parsed. */
export async function loadMoneyEvents(db) {
  const { results } = await db
    .prepare(
      `SELECT id, from_addr, subject, sent_at, received_at, text_body, html_body
       FROM supplier_mail
       WHERE trusted = 1 AND kind <> 'other' AND kind <> 'unsupported_msg'
         AND received_at > datetime('now', '-400 days')
       ORDER BY id`
    )
    .all();
  return results.map(parseMoneyMail).filter(Boolean);
}

export async function loadSmsOrders(db) {
  return smsOrders(await loadMoneyEvents(db));
}

/** Tracking URL for the common carriers (customers get this in the shipped email). */
export function trackingUrl(carrier, number) {
  const n = encodeURIComponent(String(number || '').trim());
  const c = String(carrier || '').toLowerCase();
  if (!n) return '';
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (/^1Z/i.test(number)) return `https://www.ups.com/track?tracknum=${n}`;
  if (/^9\d{15,}$/.test(String(number))) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  return '';
}
