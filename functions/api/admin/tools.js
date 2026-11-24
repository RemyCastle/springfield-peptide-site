/**
 * /api/admin/tools — small admin helpers that share one endpoint.
 *
 * GET ?view=todo                 what needs Remy today (orders to place, unpaid, waiting items)
 * GET ?view=search&q=            orders by name/email/phone/order #, plus customer notes
 * GET ?view=changes              last 60 changes (with Undo)
 * GET ?view=history&product=     price history of one product
 * GET ?view=margins              supplier cost vs shop price per product
 * GET ?view=customer&email=      notes, tags and messages sent to one customer
 * GET ?view=security             is two-step login on?
 *
 * POST { action: 'undo', id }
 * POST { action: 'customer_note', email, note, tags }
 * POST { action: 'send_message', email, order_number, template, subject, text }
 * POST { action: 'bulk', ids: [..], op: 'show'|'hide'|'add_vial'|'add_kit', amount }
 * POST { action: 'totp_start' } -> new secret to add to the authenticator app (not on yet)
 * POST { action: 'totp_confirm', code } -> turns two-step login on
 * POST { action: 'totp_off', code }
 */
import { json, requireAdmin } from '../../lib/auth.js';
import { ensureSyncSchema } from '../../../workers/supplier-sync/src/schema.js';
import { sendEmail, esc, wrap } from '../../../workers/supplier-sync/src/email.js';
import { proxyOrdersAdmin } from '../../lib/ordersProxy.js';
import { ensureAdminTables, logChange, undoChange, productRow, pick, PRODUCT_FIELDS } from '../../lib/adminTables.js';
import { newSecret, otpauthUrl, securityGet, securitySet, matchTotp, useTotp } from '../../lib/totp.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const all = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).all()).results || [];

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureSyncSchema(db);
  await ensureAdminTables(db);
  const url = new URL(request.url);
  const view = url.searchParams.get('view');

  if (view === 'todo') {
    const count = async (status) => {
      const r = await proxyOrdersAdmin(env, `/admin/orders?status=${status}&limit=100&exclude_partner_retail=1`);
      return r.ok ? (r.data.orders || []) : null;
    };
    const [paid, unpaid] = await Promise.all([count('paid'), count('pending_payment')]);
    const placed = new Set((await all(db, 'SELECT order_number FROM supplier_orders')).map((r) => r.order_number));
    const one = async (sql) => (await db.prepare(sql).first()) || {};
    return json({
      orders_ok: paid !== null,
      to_place: paid ? paid.filter((o) => !placed.has(o.order_number)).length : null,
      unpaid: unpaid ? unpaid.length : null,
      holds: (await one("SELECT COUNT(*) AS n FROM supplier_sync_events WHERE kind = 'hold_price' AND status = 'pending'")).n || 0,
      new_products: (await one("SELECT COUNT(*) AS n FROM supplier_sync_events WHERE kind = 'new_product' AND status = 'pending'")).n || 0,
      problems: (await one("SELECT COUNT(*) AS n FROM client_reports WHERE created_at > datetime('now', '-1 day')")).n || 0,
      messages: (await one("SELECT COUNT(*) AS n FROM contact_messages WHERE status = 'new'")).n || 0,
      reviews: (await one("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'")).n || 0,
      last_sync: await one("SELECT status, created_at FROM supplier_sync_events WHERE kind = 'run' ORDER BY id DESC LIMIT 1"),
    });
  }

  if (view === 'search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return json({ orders: [], notes: [] });
    const r = await proxyOrdersAdmin(env, `/admin/orders?q=${encodeURIComponent(q)}&limit=25`);
    const like = `%${q.toLowerCase()}%`;
    const notes = await all(
      db,
      'SELECT email, note, tags FROM customer_notes WHERE lower(email) LIKE ? OR lower(note) LIKE ? OR lower(tags) LIKE ? LIMIT 20',
      like,
      like,
      like
    );
    return json({ orders: r.ok ? r.data.orders || [] : [], orders_error: r.ok ? null : r.data?.message || 'Could not search orders', notes });
  }

  if (view === 'changes') {
    return json({ changes: await all(db, 'SELECT id, kind, target, label, before, after, created_at, undone_at FROM admin_changes ORDER BY id DESC LIMIT 60') });
  }

  if (view === 'history') {
    const name = String(url.searchParams.get('product') || '');
    const p = await db.prepare('SELECT id FROM products WHERE name = ?').bind(name).first();
    const sync = await all(
      db,
      "SELECT created_at, kind, status, vial, kit FROM supplier_sync_events WHERE spbc_name = ? AND kind IN ('price', 'hold_price') ORDER BY id DESC LIMIT 40",
      name
    );
    const manual = p
      ? await all(db, "SELECT created_at, label, before, after FROM admin_changes WHERE kind = 'product' AND target = ? ORDER BY id DESC LIMIT 40", String(p.id))
      : [];
    const rows = [
      ...sync.map((s) => ({
        when: s.created_at,
        who: s.kind === 'price' ? 'Supplier sync' : s.status === 'applied' ? 'Big change you approved' : `Big change (${s.status})`,
        vial: s.vial,
        kit: s.kit,
      })),
      ...manual.map((m) => {
        const a = JSON.parse(m.after || '{}');
        return { when: m.created_at, who: m.label.startsWith('Undo') ? 'Undo' : 'You', vial: a.vial_price, kit: a.pack_price };
      }),
    ].sort((a, b) => String(b.when).localeCompare(String(a.when)));
    return json({ product: name, history: rows });
  }

  if (view === 'margins') {
    const rows = await all(
      db,
      `SELECT p.id, p.name, p.vial_price, p.pack_price, p.kit_only, m.single_cost, m.bulk_cost
       FROM products p LEFT JOIN supplier_map m ON m.spbc_name = p.name AND m.skip = 0`
    );
    return json({
      margins: rows.map((r) => {
        const kitCost = r.bulk_cost ? Math.round(r.bulk_cost * 10 * 100) / 100 : null;
        const m = (price, cost) =>
          price > 0 && cost > 0 ? { cost, profit: Math.round((price - cost) * 100) / 100, pct: Math.round(((price - cost) / price) * 100) } : null;
        return { id: r.id, name: r.name, vial: m(r.vial_price, r.single_cost), kit: m(r.pack_price, kitCost) };
      }),
    });
  }

  if (view === 'customer') {
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
    const note = await db.prepare('SELECT note, tags, updated_at FROM customer_notes WHERE email = ?').bind(email).first();
    const messages = await all(db, 'SELECT order_number, template, subject, sent_ok, created_at FROM customer_messages WHERE email = ? ORDER BY id DESC LIMIT 20', email);
    return json({ email, note: note || null, messages });
  }

  if (view === 'reviews') {
    return json({ reviews: await all(db, 'SELECT id, order_number, display_name, rating, body, products, status, created_at FROM reviews ORDER BY id DESC LIMIT 60') });
  }

  if (view === 'contact') {
    return json({ messages: await all(db, 'SELECT id, name, email, order_number, body, status, created_at FROM contact_messages ORDER BY id DESC LIMIT 60') });
  }

  if (view === 'security') {
    const sec = await securityGet(db);
    return json({ totp_on: sec.totp_on === '1', pending: !!sec.totp_pending });
  }

  return json({ error: 'unknown_view' }, 400);
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureSyncSchema(db);
  await ensureAdminTables(db);
  const body = await request.json().catch(() => ({}));

  switch (body.action) {
    case 'undo': {
      try {
        return json({ ok: true, message: await undoChange(db, parseInt(body.id, 10)) });
      } catch (e) {
        return json({ error: 'undo_failed', message: String(e.message || e) }, 400);
      }
    }

    case 'customer_note': {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ error: 'validation_failed', message: 'No customer email on this order.' }, 400);
      const note = String(body.note || '').trim().slice(0, 2000);
      const tags = String(body.tags || '')
        .split(',')
        .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 -]/g, ''))
        .filter(Boolean)
        .slice(0, 10)
        .join(', ');
      if (!note && !tags) {
        await db.prepare('DELETE FROM customer_notes WHERE email = ?').bind(email).run();
        return json({ ok: true, message: 'Note cleared' });
      }
      await db
        .prepare(
          "INSERT INTO customer_notes (email, note, tags) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET note = excluded.note, tags = excluded.tags, updated_at = datetime('now')"
        )
        .bind(email, note, tags)
        .run();
      return json({ ok: true, message: 'Note saved' });
    }

    case 'send_message': {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.endsWith('@springfieldpbc.com')) {
        return json({ error: 'no_email', message: 'This customer has no email on file. Use "Copy for a text" instead.' }, 400);
      }
      const subject = String(body.subject || '').trim().slice(0, 150) || 'About your SPBC order';
      const text = String(body.text || '').trim().slice(0, 4000);
      if (!text) return json({ error: 'validation_failed', message: 'The message is empty.' }, 400);
      const mailEnv = { ...env, RESTOCK_FROM: env.RESTOCK_FROM || 'SPBC <orders@springfieldpbc.com>' };
      if (!env.RESEND_API_KEY) {
        return json({ error: 'email_not_set_up', message: 'Email sending is not set up on the site yet (RESEND_API_KEY). Copy it for a text instead.' }, 503);
      }
      const html = wrap(
        esc(text)
          .split(/\n{2,}/)
          .map((p) => `<p>${p.replace(/\n/g, '<br>').replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#b8860b">$1</a>')}</p>`)
          .join('')
      );
      const ok = await sendEmail(mailEnv, { to: email, subject, html });
      await db
        .prepare('INSERT INTO customer_messages (email, order_number, template, subject, sent_ok) VALUES (?, ?, ?, ?, ?)')
        .bind(email, String(body.order_number || '').slice(0, 40), String(body.template || 'custom').slice(0, 30), subject, ok ? 1 : 0)
        .run();
      return ok ? json({ ok: true, message: `Sent to ${email}` }) : json({ error: 'send_failed', message: 'The email did not send. Try again later.' }, 502);
    }

    case 'bulk': {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 200);
      if (!ids.length) return json({ error: 'validation_failed', message: 'Tick at least one product.' }, 400);
      const op = String(body.op || '');
      const amount = Number(body.amount);
      if ((op === 'add_vial' || op === 'add_kit') && (!Number.isFinite(amount) || Math.abs(amount) > 500 || amount === 0)) {
        return json({ error: 'validation_failed', message: 'Enter a dollar amount (use a minus sign to lower prices).' }, 400);
      }
      if (!['show', 'hide', 'add_vial', 'add_kit'].includes(op)) return json({ error: 'validation_failed', message: 'Pick what to do.' }, 400);
      let changed = 0;
      for (const id of ids) {
        const before = await productRow(db, id);
        if (!before) continue;
        const after = { ...before };
        if (op === 'show') after.active = 1;
        if (op === 'hide') after.active = 0;
        if (op === 'add_vial' && before.vial_price > 0) after.vial_price = Math.max(1, Math.round(before.vial_price + amount));
        if (op === 'add_kit' && before.pack_price > 0) after.pack_price = Math.max(1, Math.round(before.pack_price + amount));
        if (JSON.stringify(pick(before, PRODUCT_FIELDS)) === JSON.stringify(pick(after, PRODUCT_FIELDS))) continue;
        await db
          .prepare("UPDATE products SET vial_price = ?, pack_price = ?, active = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(after.vial_price, after.pack_price, after.active, id)
          .run();
        const label = { show: 'Shown', hide: 'Hidden', add_vial: `Vial ${amount > 0 ? '+' : ''}${amount}`, add_kit: `Kit ${amount > 0 ? '+' : ''}${amount}` }[op];
        await logChange(db, { kind: 'product', target: id, label: `Bulk: ${label} ${before.name}`, before: pick(before, PRODUCT_FIELDS), after: pick(after, PRODUCT_FIELDS) });
        changed += 1;
      }
      return json({ ok: true, message: `${changed} product${changed === 1 ? '' : 's'} changed (Undo is in Change log)` });
    }

    case 'review_set': {
      const status = ['approved', 'hidden', 'pending'].includes(body.status) ? body.status : null;
      if (!status) return json({ error: 'validation_failed' }, 400);
      await db.prepare('UPDATE reviews SET status = ? WHERE id = ?').bind(status, parseInt(body.id, 10)).run();
      return json({ ok: true, message: status === 'approved' ? 'Review is on the shop' : status === 'hidden' ? 'Review hidden' : 'Back to waiting' });
    }

    case 'contact_done': {
      await db.prepare("UPDATE contact_messages SET status = ? WHERE id = ?").bind(body.undo ? 'new' : 'done', parseInt(body.id, 10)).run();
      return json({ ok: true, message: body.undo ? 'Marked as new' : 'Marked as handled' });
    }

    case 'totp_start': {
      const sec = await securityGet(db);
      if (sec.totp_on === '1') return json({ error: 'already_on', message: 'Two-step login is already on.' }, 400);
      const secret = newSecret();
      await securitySet(db, { totp_pending: secret });
      return json({ ok: true, secret, otpauth: otpauthUrl(secret) });
    }
    case 'totp_confirm': {
      const sec = await securityGet(db);
      if (!sec.totp_pending) return json({ error: 'not_started', message: 'Start the setup first.' }, 400);
      const step = await matchTotp(sec.totp_pending, body.code);
      if (step == null) return json({ error: 'bad_code', message: 'That code is not right. Check the app and try the newest code.' }, 400);
      await securitySet(db, { totp_secret: sec.totp_pending, totp_pending: null, totp_on: '1', totp_last_step: step });
      return json({ ok: true, message: 'Two-step login is on. You will need a code from the app each time you sign in.' });
    }
    case 'totp_off': {
      if (!(await useTotp(db, body.code))) return json({ error: 'bad_code', message: 'Enter a current code from the app to turn it off.' }, 400);
      await securitySet(db, { totp_on: '0', totp_secret: null, totp_pending: null });
      return json({ ok: true, message: 'Two-step login is off.' });
    }
    default:
      return json({ error: 'bad_action' }, 400);
  }
}
