/**
 * GET /api/lab-report?p=<SPBC product name>
 * Shows the supplier's lab report (COA) for a product through springfieldpbc.com, so the
 * page never links customers to the supplier's site. Off unless Remy turns on
 * "Show lab reports" in the admin Supplier sync tab (site_settings.show_lab_reports = '1').
 */
import { json } from '../lib/auth.js';

const SUPPLIER_HOST = 'show-me-source.com';
const ALLOWED_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|gif))/i;

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: 'server_misconfigured' }, 500);
  const name = new URL(request.url).searchParams.get('p') || '';
  let row;
  try {
    const on = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'show_lab_reports'").first();
    if (!on || on.value !== '1') return json({ error: 'not_found' }, 404);
    row = await env.DB.prepare(
      `SELECT m.coa_url FROM supplier_map m JOIN products p ON p.name = m.spbc_name AND p.active = 1
       WHERE m.spbc_name = ? AND m.skip = 0`
    )
      .bind(name)
      .first();
  } catch {
    return json({ error: 'not_found' }, 404);
  }
  if (!row || !row.coa_url) return json({ error: 'not_found' }, 404);
  let url;
  try {
    url = new URL(row.coa_url);
  } catch {
    return json({ error: 'not_found' }, 404);
  }
  // Only ever the supplier's own files. SMS_BASE_URL exists only for local tests.
  const allowedOrigin = env.SMS_BASE_URL ? new URL(env.SMS_BASE_URL).origin : `https://${SUPPLIER_HOST}`;
  if (url.origin !== allowedOrigin) return json({ error: 'not_found' }, 404);

  const upstream = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; spbc-lab-report/1.0)' },
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  const type = upstream.headers.get('content-type') || '';
  if (!upstream.ok || !ALLOWED_TYPES.test(type)) {
    return json({ error: 'unavailable', message: 'Lab report is not available right now.' }, 502);
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
