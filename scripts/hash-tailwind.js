/**
 * Copy shared/tailwind.build.css → shared/tailwind.<sha8>.css
 * Prints the hashed filename for deploy scripts.
 *
 * Also repoints STANDALONE root pages at the new hash. Pages built from src/partials get
 * the current hash injected by build-pages.js, but admin.html and qr.html are hand-written
 * and were never rewritten — so the CSS rebuild on 2026-08-14 left them pointing at
 * tailwind.3f252319.css, a file this script had already deleted locally. Pages still served
 * the old copy from a previous deploy: 26KB with no `.hidden` rule, which unstyled the
 * admin and left every "hidden" panel visible at once.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = path.join(__dirname, '..', 'shared', 'tailwind.build.css');
if (!fs.existsSync(src)) {
  console.error('Missing shared/tailwind.build.css — run npm run build:css first');
  process.exit(1);
}
const buf = fs.readFileSync(src);
const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
const destName = `tailwind.${hash}.css`;
const dest = path.join(__dirname, '..', 'shared', destName);
fs.writeFileSync(dest, buf);
// Remove prior hashed copies (keep build + input)
const sharedDir = path.join(__dirname, '..', 'shared');
for (const f of fs.readdirSync(sharedDir)) {
  if (/^tailwind\.[a-f0-9]{8}\.css$/.test(f) && f !== destName) {
    fs.unlinkSync(path.join(sharedDir, f));
  }
}
/**
 * Repoint any root HTML that names a tailwind hash directly. Generated pages are rewritten
 * from their partials anyway, so touching them here is harmless and idempotent; the point is
 * that a standalone page can no longer be left behind.
 */
const rootDir = path.join(__dirname, '..');
const stale = /tailwind\.[a-f0-9]{8}\.css/g;
const repointed = [];
for (const f of fs.readdirSync(rootDir)) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(rootDir, f);
  const before = fs.readFileSync(p, 'utf8');
  if (!stale.test(before)) {
    stale.lastIndex = 0;
    continue;
  }
  stale.lastIndex = 0;
  const after = before.replace(stale, destName);
  if (after !== before) {
    fs.writeFileSync(p, after, 'utf8');
    repointed.push(f);
  }
}
if (repointed.length) {
  console.error(`repointed to ${destName}: ${repointed.join(', ')}`);
}
console.log(destName);
