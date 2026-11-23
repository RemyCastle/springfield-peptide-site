/**
 * Copy hand-written static files into the Pages output dir (.cf-pages).
 *
 * build-pages.js only generates the 4 partial-driven pages (index, calculator,
 * contact, titration). admin.html and qr.html are hand-written and live at the
 * repo root, so without this step they were never refreshed in .cf-pages and
 * every deploy shipped a stale copy.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.cf-pages');

/** Root files that must be present in the deployed output. */
const FILES = [
  'admin.html',
  'qr.html',
  'favicon.svg',
  'robots.txt',
  'sitemap.xml',
  '_headers',
  '_redirects',
];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const copied = [];
  const missing = [];
  for (const name of FILES) {
    const src = path.join(ROOT, name);
    if (!fs.existsSync(src)) {
      missing.push(name);
      continue;
    }
    fs.copyFileSync(src, path.join(OUT, name));
    copied.push(name);
  }
  // Hashed shared assets (tailwind.<hash>.css etc.). admin.html and qr.html are copied above
  // with whatever hashes the build just wrote into them, so the matching files must ship
  // too. Without this, /shared/tailwind.<new>.css 404'd, Pages served index.html in its
  // place, and the admin rendered with no CSS (2026-11-22). Additive only: older hashes
  // stay so pages still pointing at them keep working.
  const sharedSrc = path.join(ROOT, 'shared');
  const sharedOut = path.join(OUT, 'shared');
  fs.mkdirSync(sharedOut, { recursive: true });
  for (const f of fs.readdirSync(sharedSrc)) {
    if (!/\.[a-f0-9]{8}\.(css|js)$/.test(f)) continue;
    fs.copyFileSync(path.join(sharedSrc, f), path.join(sharedOut, f));
    copied.push(`shared/${f}`);
  }
  for (const name of copied) console.log(`copied ${name} -> .cf-pages/${name}`);
  if (missing.length) console.log(`skipped (not present): ${missing.join(', ')}`);
  console.log(JSON.stringify({ ok: true, copied, missing }, null, 2));
}

if (require.main === module) main();

module.exports = { main, FILES };
