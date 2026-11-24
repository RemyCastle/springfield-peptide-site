/**
 * Matching website orders with emails. Shared by the admin (Place orders tab) and the
 * hands-free job (jobs.js autoMatch), so both decide the same way.
 */
import { nameScore } from './money.js';

/** Tracking URL for the common carriers. */
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

/**
 * The show-me-source order for one website order.
 * @param {{ customer_name?: string, created_at?: string, address: { name?: string, postal?: string } }} order
 * @param {{ sms_ref?: string }|null} placed   supplier_orders row
 * @param {object[]} smsOrders                 from money.smsOrders()
 * @param {Set<string>} taken                  SMS numbers already linked to other website orders
 * @returns {object|null} { sms, name, cost, ..., score, why }  score 9 = typed number, 3 = name + ZIP, 2 = full name
 */
export function findSmsMatch(order, placed, smsOrders, taken = new Set()) {
  const view = (o, score, why) =>
    o && {
      sms: o.sms,
      name: o.name,
      cost: o.cost,
      date: o.date,
      items: o.items,
      ship_to: o.ship_to,
      carrier: o.carrier,
      tracking: o.tracking,
      tracking_url: trackingUrl(o.carrier, o.tracking),
      score,
      why,
    };
  if (placed && placed.sms_ref) {
    const exact = smsOrders.find((o) => o.sms === String(placed.sms_ref).toUpperCase());
    return view(exact, 9, 'their order number you typed');
  }
  const after = Date.parse(order.created_at || '') - 86400000 || 0;
  const who = (order.address && order.address.name) || order.customer_name;
  const zip = String((order.address && order.address.postal) || '').slice(0, 5);
  let best = null;
  for (const o of smsOrders) {
    if (taken.has(o.sms)) continue;
    if ((Date.parse(o.date || '') || 0) < after) continue;
    let score = nameScore(who, o.name);
    if (zip && o.ship_to && o.ship_to.includes(zip)) score += 1;
    if (score < 2) continue;
    if (!best || score > best.score || (score === best.score && String(o.date) < String(best.o.date))) best = { o, score };
  }
  return best ? view(best.o, best.score, best.score >= 3 ? 'name and ZIP match' : 'name matches') : null;
}

/**
 * Website orders a Venmo payment could be paying for: unpaid, same person (full-name match),
 * exact amount, ordered no more than 14 days before the payment.
 * @returns {object[]} candidate orders
 */
export function paymentCandidates(payment, unpaidOrders) {
  const paidAt = Date.parse(payment.date || '') || Date.now();
  const cents = Math.round(Number(payment.amount || 0) * 100);
  return unpaidOrders.filter((o) => {
    const made = Date.parse(o.created_at || '') || 0;
    if (made > paidAt + 86400000 || paidAt - made > 14 * 86400000) return false;
    if (Number(o.total_cents) !== cents) return false;
    return nameScore(payment.name, o.customer_name) === 2;
  });
}
