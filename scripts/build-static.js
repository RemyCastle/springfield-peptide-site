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
  for (const name of copied) console.log(`copied ${name} -> .cf-pages/${name}`);
  if (missing.length) console.log(`skipped (not present): ${missing.join(', ')}`);
  console.log(JSON.stringify({ ok: true, copied, missing }, null, 2));
}

if (require.main === module) main();

module.exports = { main, FILES };
