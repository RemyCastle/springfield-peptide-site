/**
 * Assemble the Cloudflare Pages output dir (.cf-pages) from repo sources.
 *
 * Runs last in `npm run build`, after build:css, build:hash and build:pages have
 * regenerated the root HTML and the hashed shared/* files.
 *
 * History: .cf-pages was always filled by hand ("copy root HTML + shared/* to
 * .cf-pages", .ai/decisions.md 2026-07-20). This script used to copy only
 * admin.html, qr.html and a few root files, so the storefront pages in
 * .cf-pages froze at the 2026-08-29 build. It now builds the whole dir.
 *
 * Each run:
 *   1. moves the previous .cf-pages to _trash/cf-pages-<timestamp> (never deleted)
 *   2. writes a fresh .cf-pages from the repo (pages, root files, hashed shared
 *      assets, assets/)
 *   3. carries over hashed shared/* files from the previous build that are not
 *      in the new one, so a browser holding cached old HTML still gets its CSS/JS
 *      instead of index.html (the 2026-11-22 admin breakage). Pass --clean to
 *      skip this and get output that depends only on the repo. (After a --clean
 *      run the old hashes are only in _trash, so the next normal build cannot
 *      carry them; copy them back from _trash before deploying.)
 *   4. checks that every /shared/ and /assets/ file the pages reference exists.
 *
 * functions/ is NOT copied: wrangler deploys Pages Functions from ./functions
 * at the repo root.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.cf-pages');
const TRASH = path.join(ROOT, '_trash');

/** Generated pages (scripts/build-pages.js) and hand-written pages. */
const PAGES = ['index.html', 'calculator.html', 'contact.html', 'titration.html', 'track.html', 'admin.html', 'qr.html', 'my-orders.html', 'review.html', 'lab-reports.html', 'email-preferences.html', 'privacy.html', 'faq.html'];

/** Other root files that must be present in the deployed output. */
const ROOT_FILES = ['404.html', 'favicon.svg', 'robots.txt', 'sitemap.xml', '_headers', '_redirects', 'admin-sw.js', 'admin.webmanifest'];

const HASHED = /\.[a-f0-9]{8}\.(css|js)$/;
/** Files under assets/ that are tools, not site content. */
const ASSET_SKIP = /\.(py|psd|ai|bak)$/i;

function copyDir(src, dest, copied, rel) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    const r = `${rel}/${ent.name}`;
    if (ent.isDirectory()) copyDir(s, d, copied, r);
    else if (!ASSET_SKIP.test(ent.name)) {
      fs.copyFileSync(s, d);
      copied.push(r);
    }
  }
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function main() {
  const clean = process.argv.includes('--clean');
  const copied = [];
  const carried = [];

  // 1. Move the previous build aside.
  let prev = null;
  if (fs.existsSync(OUT)) {
    fs.mkdirSync(TRASH, { recursive: true });
    prev = path.join(TRASH, `cf-pages-${stamp()}`);
    fs.renameSync(OUT, prev);
  }
  fs.mkdirSync(OUT, { recursive: true });

  // 2. Fresh copy from the repo.
  const missing = [];
  for (const name of [...PAGES, ...ROOT_FILES]) {
    const src = path.join(ROOT, name);
    if (!fs.existsSync(src)) {
      missing.push(name);
      continue;
    }
    fs.copyFileSync(src, path.join(OUT, name));
    copied.push(name);
  }
  if (missing.length) throw new Error(`Missing required files: ${missing.join(', ')}`);

  const sharedOut = path.join(OUT, 'shared');
  fs.mkdirSync(sharedOut, { recursive: true });
  for (const f of fs.readdirSync(path.join(ROOT, 'shared'))) {
    if (!HASHED.test(f)) continue;
    fs.copyFileSync(path.join(ROOT, 'shared', f), path.join(sharedOut, f));
    copied.push(`shared/${f}`);
  }

  copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'), copied, 'assets');

  // 3. Keep older hashed shared files for cached HTML (skipped with --clean).
  const prevShared = prev && path.join(prev, 'shared');
  if (!clean && prevShared && fs.existsSync(prevShared)) {
    for (const f of fs.readdirSync(prevShared)) {
      if (!HASHED.test(f) || fs.existsSync(path.join(sharedOut, f))) continue;
      fs.copyFileSync(path.join(prevShared, f), path.join(sharedOut, f));
      carried.push(`shared/${f}`);
    }
  }

  // 4. Every local /shared/ or /assets/ reference must resolve.
  const broken = [];
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(OUT, page), 'utf8');
    for (const m of html.matchAll(/["'(](\/(?:shared|assets)\/[^"'()\s?#]+)/g)) {
      if (!fs.existsSync(path.join(OUT, m[1]))) broken.push(`${page} -> ${m[1]}`);
    }
  }
  if (broken.length) throw new Error(`Broken asset references:\n  ${broken.join('\n  ')}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: '.cf-pages',
        previous_moved_to: prev ? path.relative(ROOT, prev) : null,
        copied: copied.length,
        carried_over_old_hashes: carried,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`build-static failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { main, PAGES, ROOT_FILES };
