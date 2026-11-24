/**
 * Per-run extras for the sync: low-stock flags, lab report links, back-in-stock emails.
 */
import { sendEmail, emailReady, esc, siteUrl, wrap } from './email.js';

/** Pick the first lab report (COA) link from a supplier product row, as an absolute URL. */
export function coaUrlFrom(row, baseUrl) {
  if (!row) return null;
  let raw = row.coa;
  if (!raw && Array.isArray(row.coas) && row.coas.length) {
    const c = row.coas[0];
    raw = typeof c === 'string' ? c : c && (c.url || c.file || c.path || c.src);
  }
  raw = String(raw || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw, `${baseUrl}/`);
    const allowed = new URL(baseUrl).host;
    if (u.host !== allowed) return null; // only ever the supplier's own files
    // Must be an actual report file; placeholders like /pending are not a report.
    return /\.(pdf|jpe?g|png|webp)$/i.test(u.pathname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Update low_inventory + coa_url on supplier_map from this run's feed. */
export async function updateProductMeta(db, { stock, details, feed, baseUrl }) {
  const map = (await db.prepare('SELECT supplier_id, low_inventory, coa_url, max_qty, single_cost, bulk_cost FROM supplier_map WHERE skip = 0').all()).results;
  const stmts = [];
  for (const m of map) {
    const id = String(m.supplier_id);
    const st = (stock || {})[id] || {};
    const row = (details || {})[id] || (feed || {})[id];
    const low = st.low_inventory === true || (row && row.low_inventory === true) ? 1 : 0;
    const coa = coaUrlFrom(row, baseUrl);
    const maxRaw = Number(st.max_qty ?? (row && row.max_qty));
    const max = Number.isFinite(maxRaw) && maxRaw >= 0 ? Math.floor(maxRaw) : null;
    const f = (feed || {})[id] || {};
    const cost = (v, old) => (Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : old ?? null);
    const single = cost(f.single_price, m.single_cost);
    const bulk = cost(f.bulk_price, m.bulk_cost);
    if (
      low !== m.low_inventory ||
      coa !== (m.coa_url || null) ||
      max !== (m.max_qty ?? null) ||
      single !== (m.single_cost ?? null) ||
      bulk !== (m.bulk_cost ?? null)
    ) {
      stmts.push(
        db
          .prepare(
            "UPDATE supplier_map SET low_inventory = ?, coa_url = ?, max_qty = ?, single_cost = ?, bulk_cost = ?, updated_at = datetime('now') WHERE supplier_id = ?"
          )
          .bind(low, coa, max, single, bulk, m.supplier_id)
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

/**
 * Email everyone waiting on a product that is now for sale (one email each).
 * Without an email sender set up nothing is sent and the sign-ups keep waiting.
 */
export async function sendRestockEmails(db, env, { limit = 50 } = {}) {
  if (!emailReady(env)) return { sent: 0, skipped: 'email not configured' };
  const { results } = await db
    .prepare(
      `SELECT r.id, r.spbc_name, r.email FROM restock_requests r
       JOIN products p ON p.name = r.spbc_name AND p.active = 1
       WHERE r.notified_at IS NULL ORDER BY r.id LIMIT ?`
    )
    .bind(limit)
    .all();
  let sent = 0;
  for (const r of results) {
    const ok = await sendEmail(env, {
      to: r.email,
      subject: `${r.spbc_name} is back in stock`,
      html: wrap(`<p><strong>${esc(r.spbc_name)}</strong> is back in stock at Springfield Peptide Buyers Club.</p>
<p><a href="${siteUrl(env)}/#prices" style="color:#154530">Order it here</a></p>
<p style="font-size:12px;color:#666">You asked us to tell you when it came back. We won't email you about it again.</p>`),
    });
    if (ok) {
      await db.prepare("UPDATE restock_requests SET notified_at = datetime('now') WHERE id = ?").bind(r.id).run();
      sent += 1;
    }
  }
  return { sent };
}
