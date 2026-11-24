/**
 * GET /api/address-check?zip=65804
 * Looks up a US ZIP (zippopotam.us, free, no key) so checkout can fill in city/state and warn
 * about typos. Only the 5-digit ZIP leaves the site. Cached by Cloudflare for a week.
 */
import { json } from '../lib/auth.js';

export async function onRequestGet({ request }) {
  const zip = new URL(request.url).searchParams.get('zip') || '';
  if (!/^\d{5}$/.test(zip)) return json({ error: 'bad_zip' }, 400);
  let res;
  try {
    res = await fetch(`https://api.zippopotam.us/us/${zip}`, { cf: { cacheTtl: 604800, cacheEverything: true } });
  } catch {
    return json({ error: 'lookup_failed' }, 502);
  }
  if (res.status === 404) return json({ error: 'not_found' }, 404);
  if (!res.ok) return json({ error: 'lookup_failed' }, 502);
  const d = await res.json().catch(() => null);
  const places = (d && Array.isArray(d.places) ? d.places : []).filter((p) => p && p['place name']);
  if (!places.length) return json({ error: 'not_found' }, 404);
  return new Response(
    JSON.stringify({
      zip,
      city: places[0]['place name'],
      state: places[0]['state abbreviation'],
      cities: [...new Set(places.map((p) => p['place name']))],
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } }
  );
}
