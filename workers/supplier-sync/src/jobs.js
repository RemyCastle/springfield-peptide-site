/**
 * Scheduled jobs beyond the price/stock sync. Each one checks its own switch in
 * site_settings (see schema.js DEFAULT_SETTINGS) and does nothing while it is off.
 */
import { getSettings } from './schema.js';
import { sendEmail, emailReady, esc, siteUrl, wrap } from './email.js';
import { ordersReady, listOrders, ordersApi, payUrl } from './orders.js';

const HOUR = 3600 * 1000;

function ageHours(iso, now) {
  const t = Date.parse(String(iso || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso)) ? '' : 'Z'));
  return Number.isFinite(t) ? (now - t) / HOUR : 0;
}

function money(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

/**
 * Remind customers who have not paid; optionally cancel very old unpaid orders.
 * One reminder per order. Cancel only after a reminder went out (or reminders are off).
 */
export async function paymentReminders(env, db, now = Date.now()) {
  const s = await getSettings(db);
  const remindOn = s.reminders_on === '1';
  const cancelDays = Math.max(0, parseInt(s.auto_cancel_days, 10) || 0);
  if ((!remindOn && !cancelDays) || !ordersReady(env)) return { skipped: true };
  const hours = Math.max(1, parseInt(s.reminder_hours, 10) || 24);
  const unpaid = await listOrders(env, { status: 'pending_payment' });
  const done = new Map(
    (await db.prepare('SELECT * FROM order_reminders').all()).results.map((r) => [r.order_number, r])
  );
  let reminded = 0;
  let cancelled = 0;
  for (const o of unpaid) {
    const age = ageHours(o.created_at, now);
    const rec = done.get(o.order_number);
    if (rec && rec.cancelled_at) continue; // already cancelled by us
    if (cancelDays && age >= cancelDays * 24 && (!remindOn || (rec && rec.reminded_at))) {
      try {
        await ordersApi(env, `/admin/orders/${encodeURIComponent(o.order_number)}`, {
          method: 'PATCH',
          body: { status: 'cancelled', note: `Auto-cancelled: unpaid after ${cancelDays} days` },
        });
      } catch {
        continue; // e.g. paid meanwhile; try again next run
      }
      await db
        .prepare(
          "INSERT INTO order_reminders (order_number, cancelled_at) VALUES (?, datetime('now')) ON CONFLICT(order_number) DO UPDATE SET cancelled_at = datetime('now')"
        )
        .bind(o.order_number)
        .run();
      cancelled += 1;
      continue;
    }
    if (remindOn && emailReady(env) && age >= hours && !(rec && rec.reminded_at)) {
      const ok = await sendEmail(env, {
        to: o.customer_email,
        subject: `Your SPBC order ${o.order_number} is waiting for payment`,
        html: wrap(`<p>Hi ${esc(o.customer_name || 'there')},</p>
<p>Your order <strong>${esc(o.order_number)}</strong> (${money(o.total_cents)}) is reserved but we haven't received payment yet.</p>
<p><a href="${payUrl(env, o.order_number)}" style="color:#b8860b">Pay for your order</a></p>
${cancelDays ? `<p>Unpaid orders are cancelled after ${cancelDays} days.</p>` : ''}
<p>Already paid? Reply to this email with your payment details and we'll match it.</p>`),
      });
      if (ok) {
        await db
          .prepare(
            "INSERT INTO order_reminders (order_number, reminded_at) VALUES (?, datetime('now')) ON CONFLICT(order_number) DO UPDATE SET reminded_at = datetime('now')"
          )
          .bind(o.order_number)
          .run();
        reminded += 1;
      }
    }
  }
  return { reminded, cancelled, unpaid: unpaid.length };
}

/** Morning email to Remy: paid orders not yet placed at show-me-source, plus things waiting. */
export async function dailyDigest(env, db) {
  const s = await getSettings(db);
  if (s.digest_on !== '1' || !s.digest_to || !emailReady(env)) return { skipped: true };
  let toPlace = [];
  let ordersError = null;
  if (ordersReady(env)) {
    try {
      const paid = await listOrders(env, { status: 'paid' });
      const placed = new Set((await db.prepare('SELECT order_number FROM supplier_orders').all()).results.map((r) => r.order_number));
      toPlace = paid.filter((o) => !placed.has(o.order_number));
    } catch (e) {
      ordersError = String(e.message || e);
    }
  }
  const one = async (sql) => (await db.prepare(sql).first()) || {};
  const holds = (await one("SELECT COUNT(*) AS n FROM supplier_sync_events WHERE kind = 'hold_price' AND status = 'pending'")).n || 0;
  const newer = (await one("SELECT COUNT(*) AS n FROM supplier_sync_events WHERE kind = 'new_product' AND status = 'pending'")).n || 0;
  const lastRun = await one("SELECT status, created_at FROM supplier_sync_events WHERE kind = 'run' ORDER BY id DESC LIMIT 1");
  const admin = `${siteUrl(env)}/admin`;
  const rows = toPlace
    .map((o) => `<li><strong>${esc(o.order_number)}</strong> · ${esc(o.customer_name || '')} · ${money(o.total_cents)}</li>`)
    .join('');
  const html = wrap(`<p><strong>Good morning.</strong> Here's SPBC today.</p>
<p><strong>${toPlace.length}</strong> paid order${toPlace.length === 1 ? '' : 's'} to place at show-me-source${toPlace.length ? ':' : '.'}</p>
${rows ? `<ul>${rows}</ul>` : ''}
${ordersError ? `<p style="color:#b00">Could not read orders: ${esc(ordersError)}</p>` : ''}
${holds ? `<p>${holds} big price change${holds === 1 ? '' : 's'} waiting for you.</p>` : ''}
${newer ? `<p>${newer} new show-me-source product${newer === 1 ? '' : 's'} waiting for you.</p>` : ''}
${lastRun.status === 'error' ? '<p style="color:#b00">The last supplier check failed. Open Supplier sync in the admin.</p>' : ''}
<p><a href="${admin}" style="color:#b8860b">Open the admin</a></p>`);
  const ok = await sendEmail(env, {
    to: s.digest_to,
    subject: toPlace.length ? `SPBC: ${toPlace.length} order${toPlace.length === 1 ? '' : 's'} to place today` : 'SPBC: nothing to place today',
    html,
  });
  return { sent: ok, to_place: toPlace.length };
}

/** Email followers when a product's price went down (from this sync run's price changes). */
export async function priceDropAlerts(env, db, priceActions) {
  const s = await getSettings(db);
  if (s.price_alerts_on !== '1' || !emailReady(env)) return { skipped: true };
  let sent = 0;
  for (const a of priceActions || []) {
    const from = a.from || {};
    const to = a.to || {};
    const vialDrop = from.vial != null && to.vial != null && to.vial < from.vial;
    const kitDrop = from.kit != null && to.kit != null && to.kit < from.kit;
    if (!vialDrop && !kitDrop) continue;
    const { results } = await db.prepare('SELECT id, email FROM price_watch WHERE spbc_name = ?').bind(a.spbc_name).all();
    const parts = [];
    if (vialDrop) parts.push(`vial $${from.vial} → <strong>$${to.vial}</strong>`);
    if (kitDrop) parts.push(`kit $${from.kit} → <strong>$${to.kit}</strong>`);
    for (const w of results) {
      const ok = await sendEmail(env, {
        to: w.email,
        subject: `Price drop: ${a.spbc_name}`,
        html: wrap(`<p><strong>${esc(a.spbc_name)}</strong> just got cheaper: ${parts.join(', ')}.</p>
<p><a href="${siteUrl(env)}/#prices" style="color:#b8860b">See the price list</a></p>
<p style="font-size:12px;color:#666">You asked to hear about price drops on this product.</p>`),
      });
      if (ok) {
        await db.prepare("UPDATE price_watch SET last_notified_at = datetime('now') WHERE id = ?").bind(w.id).run();
        sent += 1;
      }
    }
  }
  return { sent };
}
