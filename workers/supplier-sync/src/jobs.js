/**
 * Scheduled jobs beyond the price/stock sync. Each one checks its own switch in
 * site_settings (see schema.js DEFAULT_SETTINGS) and does nothing while it is off.
 */
import { getSettings, setSetting } from './schema.js';
import { sendEmail, emailReady, esc, siteUrl, wrap } from './email.js';
import { ordersReady, listOrders, ordersApi, payUrl } from './orders.js';
import { parseMoneyMail, smsOrders } from './money.js';
import { findSmsMatch, paymentCandidates } from './match.js';
import { wantsEmail, prefsFooter } from './customers.js';

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
const PROBLEM_LABEL = { place_order: 'failed order tries', js_error: 'page errors', load_products: 'price list failed to load' };

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
  const problems = await db
    .prepare("SELECT kind, COUNT(*) AS n FROM client_reports WHERE created_at > datetime('now', '-1 day') GROUP BY kind")
    .all()
    .then((r) => r.results || [])
    .catch(() => []);
  const problemText = problems.map((p) => `${p.n} ${PROBLEM_LABEL[p.kind] || p.kind}`).join(', ');
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
${problemText ? `<p style="color:#b00">Checkout problems on the shop in the last day: ${esc(problemText)}.</p>` : ''}
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
      if (!(await wantsEmail(db, w.email, 'price_alerts'))) continue;
      const foot = await prefsFooter(db, env, w.email, 'You asked to hear about price drops on this product.');
      const ok = await sendEmail(env, {
        to: w.email,
        subject: `Price drop: ${a.spbc_name}`,
        html: wrap(`<p><strong>${esc(a.spbc_name)}</strong> just got cheaper: ${parts.join(', ')}.</p>
<p><a href="${siteUrl(env)}/#prices" style="color:#b8860b">See the price list</a></p>
${foot.html}`),
        headers: { 'List-Unsubscribe': `<${foot.url}>` },
      });
      if (ok) {
        await db.prepare("UPDATE price_watch SET last_notified_at = datetime('now') WHERE id = ?").bind(w.id).run();
        sent += 1;
      }
    }
  }
  return { sent };
}

/**
 * Hands-free matching (site_settings.auto_match_on = '1'). Runs with the 2-hourly sync.
 *  1. A Venmo payment email (supplier@) with no order code: if exactly one unpaid website order
 *     has the same full name and the exact amount, mark it paid.
 *  2. A show-me-source tracking email from the last 3 days for an order Remy marked placed:
 *     if it matches by his typed show-me-source number, or name + ZIP, mark the website order
 *     shipped with that tracking (the customer gets the shipped email).
 * Each email is acted on once (logged as auto_paid / auto_shipped events).
 */
export async function autoMatch(env, db, now = Date.now()) {
  const s = await getSettings(db);
  if (s.auto_match_on !== '1' || !ordersReady(env)) return { skipped: true };
  const { results: rows } = await db
    .prepare(
      `SELECT id, from_addr, subject, sent_at, received_at, text_body, html_body FROM supplier_mail
       WHERE trusted = 1 AND kind IN ('venmo','chime','paypal','sms_order','sms_shipping') AND received_at > datetime('now', '-30 days')`
    )
    .all();
  const events = rows.map((r) => ({ mail: r, e: parseMoneyMail(r) })).filter((x) => x.e);
  const done = new Set(
    (await db.prepare("SELECT detail FROM supplier_sync_events WHERE kind IN ('auto_paid','auto_shipped')").all()).results
      .map((r) => {
        try {
          return JSON.parse(r.detail).key;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
  const log = (kind, detail) =>
    db.prepare('INSERT INTO supplier_sync_events (kind, status, detail) VALUES (?, ?, ?)').bind(kind, 'done', JSON.stringify(detail)).run();
  let paid = 0;
  let shipped = 0;

  // 1. Payments -> unpaid website orders
  let unpaid = await listOrders(env, { status: 'pending_payment' });
  for (const { mail, e } of events) {
    if (e.type !== 'in') continue;
    const key = `pay:${e.txn || mail.id}`;
    if (done.has(key)) continue;
    const cands = paymentCandidates(e, unpaid);
    if (cands.length !== 1) continue;
    const o = cands[0];
    await ordersApi(env, `/admin/orders/${encodeURIComponent(o.order_number)}`, {
      method: 'PATCH',
      body: { status: 'paid', note: `Auto-matched ${e.source} payment from ${e.name} ($${e.amount})` },
    });
    await log('auto_paid', { key, order: o.order_number, payer: e.name, amount: e.amount });
    unpaid = unpaid.filter((x) => x.order_number !== o.order_number);
    paid += 1;
  }

  // 2. Tracking -> placed website orders
  const recentTracking = new Set(
    events
      .filter(
        ({ mail, e }) =>
          e.type === 'sms' && e.stage === 'tracking' && now - (Date.parse(String(mail.received_at).replace(' ', 'T') + 'Z') || 0) < 3 * 86400000
      )
      .map(({ e }) => e.sms)
  );
  if (recentTracking.size) {
    const orders = smsOrders(events.map((x) => x.e));
    const placedRows = (await db.prepare('SELECT * FROM supplier_orders').all()).results;
    const placedBy = new Map(placedRows.map((r) => [r.order_number, r]));
    const taken = new Set(placedRows.map((r) => String(r.sms_ref || '').toUpperCase()).filter(Boolean));
    const waiting = (await listOrders(env, { status: 'paid' })).filter((o) => placedBy.has(o.order_number));
    for (const o of waiting) {
      const placed = placedBy.get(o.order_number);
      const own = new Set([...taken].filter((x) => x !== String(placed.sms_ref || '').toUpperCase()));
      const view = { customer_name: o.customer_name, created_at: o.created_at, address: { name: o.ship_name || o.customer_name, postal: o.ship_postal } };
      const m = findSmsMatch(view, placed, orders, own);
      if (!m || !m.tracking || m.score < 3 || !recentTracking.has(m.sms)) continue;
      const key = `ship:${m.sms}`;
      if (done.has(key)) continue;
      await ordersApi(env, `/admin/orders/${encodeURIComponent(o.order_number)}`, {
        method: 'PATCH',
        body: {
          status: 'shipped',
          tracking_number: m.tracking,
          tracking_carrier: m.carrier || undefined,
          tracking_url: m.tracking_url || undefined,
          note: `Auto: tracking from show-me-source ${m.sms}`,
        },
      });
      if (!placed.sms_ref) {
        await db
          .prepare('UPDATE supplier_orders SET sms_ref = ?, sms_cost = COALESCE(sms_cost, ?) WHERE order_number = ?')
          .bind(m.sms, m.cost ?? null, o.order_number)
          .run();
      }
      await log('auto_shipped', { key, order: o.order_number, sms: m.sms, tracking: m.tracking });
      shipped += 1;
    }
  }
  return { paid, shipped };
}

/**
 * Best sellers: single vials sold per SPBC product over the last 90 days, from show-me-source's
 * order emails (these include sales made outside the website). Top 3 saved as
 * site_settings.best_sellers (JSON list of SPBC product names) for the shop's badges and sort.
 */
export async function computeBestSellers(db) {
  const { results: rows } = await db
    .prepare(
      `SELECT id, from_addr, subject, sent_at, received_at, text_body, html_body FROM supplier_mail
       WHERE trusted = 1 AND kind IN ('sms_order','sms_shipping') AND received_at > datetime('now', '-90 days')`
    )
    .all();
  const orders = smsOrders(rows.map(parseMoneyMail).filter(Boolean));
  const map = (await db.prepare('SELECT supplier_name, spbc_name FROM supplier_map WHERE skip = 0 AND spbc_name IS NOT NULL').all()).results;
  const bySupplier = new Map(map.map((m) => [String(m.supplier_name || '').toLowerCase(), m.spbc_name]));
  const units = new Map();
  for (const o of orders) {
    for (const part of String(o.items || '').split('|')) {
      const m = part.match(/^\s*(.+?)\s+x(\d+)/i);
      if (!m) continue;
      const spbc = bySupplier.get(m[1].trim().toLowerCase());
      if (!spbc) continue;
      units.set(spbc, (units.get(spbc) || 0) + (parseInt(m[2], 10) || 0));
    }
  }
  const top = [...units.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  await db
    .prepare(
      "INSERT INTO site_settings (key, value) VALUES ('best_sellers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
    )
    .bind(JSON.stringify(top))
    .run();
  return { top, counted: orders.length };
}

/**
 * Supplier sync broke: two failed checks in a row (about 4 hours) emails digest_to once.
 * The next good check clears it, so a later break alerts again.
 */
export async function syncBreakAlert(env, db) {
  const runs = (await db.prepare("SELECT status, detail, created_at FROM supplier_sync_events WHERE kind = 'run' ORDER BY id DESC LIMIT 2").all())
    .results;
  const s = await getSettings(db);
  if (!runs.length) return { skipped: true };
  if (runs[0].status !== 'error') {
    if (s.sync_alerted === '1') await setSetting(db, 'sync_alerted', '0');
    return { skipped: true };
  }
  if (runs.length < 2 || runs[1].status !== 'error' || s.sync_alerted === '1') return { skipped: true };
  if (!s.digest_to || !emailReady(env)) return { skipped: true, reason: 'no_email' };
  let why = '';
  try {
    why = JSON.parse(runs[0].detail || '{}').error || '';
  } catch {
    why = '';
  }
  const ok = await sendEmail(env, {
    to: s.digest_to,
    subject: 'SPBC: the show-me-source price check stopped working',
    html: wrap(`<p>The automatic show-me-source check failed twice in a row, so prices and stock on the shop are not being updated.</p>
<p>Last error: <strong>${esc(why || 'unknown')}</strong></p>
<p>Common causes: show-me-source changed their site key or pricing code, or their site is down. Open <a href="${siteUrl(env)}/admin" style="color:#b8860b">Supplier sync in the admin</a>.</p>
<p>You get this once; the next good check resets it.</p>`),
  });
  if (ok) await setSetting(db, 'sync_alerted', '1');
  return { sent: ok };
}
