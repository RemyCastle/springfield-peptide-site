/**
 * GET /api/admin/supplier-queue
 *   queue    paid SPBC website orders not yet placed at show-me-source (oldest first)
 *   awaiting placed but not shipped yet (waiting for show-me-source's tracking)
 *   recent   last 15 placed
 * Each order carries `sms_match` when a show-me-source email (supplier@springfieldpbc.com)
 * looks like its supplier order: same show-me-source order number if Remy typed it, else
 * the customer's name (nicknames/typos ok) on an order made after the website order.
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';
import { nameScore } from '../../../workers/supplier-sync/src/money.js';
import { buildPlacement, supplierNameMap } from '../../lib/supplierPlacement.js';
import { loadSmsOrders, trackingUrl } from '../../lib/moneyMail.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  await ensureSyncSchema(env.DB);

  const paid = [];
  for (let page = 1; page <= 5; page++) {
    const qs = new URLSearchParams({ status: 'paid', exclude_partner_retail: '1', limit: '100', page: String(page) });
    const res = await proxyOrdersAdmin(env, `/admin/orders?${qs}`);
    if (!res.ok) return json(res.data, res.status);
    paid.push(...(res.data.orders || []).filter((o) => !o.partner_slug && o.status === 'paid'));
    if (!res.data.total_pages || page >= res.data.total_pages) break;
  }
  const placedRows = (await env.DB.prepare('SELECT * FROM supplier_orders ORDER BY placed_at DESC').all()).results;
  const placedBy = new Map(placedRows.map((r) => [r.order_number, r]));
  const byDate = (a, b) => String(a.paid_at || a.created_at).localeCompare(String(b.paid_at || b.created_at));
  const todo = paid.filter((o) => !placedBy.has(o.order_number)).sort(byDate);
  const waiting = paid.filter((o) => placedBy.has(o.order_number)).sort(byDate);

  const nameMap = await supplierNameMap(env.DB);
  const smsOrders = await loadSmsOrders(env.DB).catch(() => []);
  const takenSms = new Set(placedRows.map((r) => r.sms_ref).filter(Boolean).map((s) => s.toUpperCase()));

  const detail = async (list) => {
    const out = [];
    for (let i = 0; i < list.length; i += 8) {
      const batch = await Promise.all(
        list.slice(i, i + 8).map((o) => proxyOrdersAdmin(env, `/admin/orders/${encodeURIComponent(o.order_number)}`))
      );
      batch.forEach((r) => {
        if (!r.ok) return;
        const p = buildPlacement(r.data, nameMap);
        const placed = placedBy.get(p.order_number) || null;
        p.placed = placed;
        p.sms_match = findSmsMatch(p, placed, smsOrders, takenSms);
        out.push(p);
      });
    }
    return out;
  };

  return json({
    queue: await detail(todo),
    awaiting: await detail(waiting),
    recent: placedRows.slice(0, 15),
    checkout_email: env.SUPPLIER_CHECKOUT_EMAIL || 'supplier@springfieldpbc.com',
  });
}

function findSmsMatch(p, placed, smsOrders, takenSms) {
  const view = (o, why) =>
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
      why,
    };
  if (placed && placed.sms_ref) {
    const exact = smsOrders.find((o) => o.sms === String(placed.sms_ref).toUpperCase());
    return view(exact, 'their order number you typed');
  }
  const after = Date.parse(p.created_at || '') - 86400000 || 0;
  const who = p.address.name || p.customer_name;
  const zip = String(p.address.postal || '').slice(0, 5);
  let best = null;
  for (const o of smsOrders) {
    if (takenSms.has(o.sms)) continue;
    if ((Date.parse(o.date || '') || 0) < after) continue;
    let score = nameScore(who, o.name);
    if (zip && o.ship_to && o.ship_to.includes(zip)) score += 1;
    if (score < 2) continue; // name + zip, or a full name match
    if (!best || score > best.score || (score === best.score && String(o.date) < String(best.o.date))) best = { o, score };
  }
  return best ? view(best.o, best.score >= 3 ? 'name and ZIP match' : 'name matches') : null;
}
