/**
 * Per-run extras for the sync: low-stock flags, lab report links, back-in-stock emails.
 */

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
    return u.host === allowed ? u.toString() : null; // only ever the supplier's own files
  } catch {
    return null;
  }
}

/** Update low_inventory + coa_url on supplier_map from this run's feed. */
export async function updateProductMeta(db, { stock, details, feed, baseUrl }) {
  const map = (await db.prepare('SELECT supplier_id, low_inventory, coa_url FROM supplier_map WHERE skip = 0').all()).results;
  const stmts = [];
  for (const m of map) {
    const id = String(m.supplier_id);
    const st = (stock || {})[id] || {};
    const row = (details || {})[id] || (feed || {})[id];
    const low = st.low_inventory === true || (row && row.low_inventory === true) ? 1 : 0;
    const coa = coaUrlFrom(row, baseUrl);
    if (low !== m.low_inventory || coa !== (m.coa_url || null)) {
      stmts.push(
        db
          .prepare("UPDATE supplier_map SET low_inventory = ?, coa_url = ?, updated_at = datetime('now') WHERE supplier_id = ?")
          .bind(low, coa, m.supplier_id)
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

function restockEmailHtml(name, siteUrl) {
  const safe = String(name).replace(/[<>&"]/g, '');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111">
  <p><strong>${safe}</strong> is back in stock at Springfield Peptide Buyers Club.</p>
  <p><a href="${siteUrl}/#prices" style="color:#b8860b">Order it here</a></p>
  <p style="font-size:12px;color:#666">You asked us to tell you when it came back. We won't email you about it again.</p>
</div>`;
}

/**
 * Email everyone waiting on a product that is now for sale. Needs RESEND_API_KEY and
 * RESTOCK_FROM (a sender on a domain verified in Resend). Without them nothing is sent
 * and the sign-ups stay waiting (the admin shows them).
 */
export async function sendRestockEmails(db, env, { limit = 50 } = {}) {
  if (!env.RESEND_API_KEY || !env.RESTOCK_FROM) return { sent: 0, skipped: 'email not configured' };
  const siteUrl = String(env.SITE_URL || 'https://springfieldpbc.com').replace(/\/$/, '');
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
    const res = await fetch(env.RESEND_API_URL || 'https://api.resend.com/emails', { // URL override: local tests only
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESTOCK_FROM,
        to: [r.email],
        subject: `${r.spbc_name} is back in stock`,
        html: restockEmailHtml(r.spbc_name, siteUrl),
      }),
    });
    if (res.ok) {
      await db.prepare("UPDATE restock_requests SET notified_at = datetime('now') WHERE id = ?").bind(r.id).run();
      sent += 1;
    }
  }
  return { sent };
}
