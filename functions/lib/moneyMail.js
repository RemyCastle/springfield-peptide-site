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

export { trackingUrl } from '../../workers/supplier-sync/src/match.js';
