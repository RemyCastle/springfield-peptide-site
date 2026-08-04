/**
 * Unit B helper: merge src/styles/*.page.css into shared/site-atmosphere.css
 * with design-token substitutions. Idempotent (skips if marker present).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ATM = path.join(ROOT, 'shared', 'site-atmosphere.css');
const MARKER = 'Migrated page styles (Unit B)';

const pages = ['index', 'calculator', 'stacks', 'coaching'];
let raw = pages
  .map((p) => {
    const f = path.join(ROOT, 'src', 'styles', `${p}.page.css`);
    return `/* from ${p}.page.css */\n` + fs.readFileSync(f, 'utf8');
  })
  .join('\n');

raw = raw.replace(/^[ \t]{2,}/gm, '');

const map = [
  [/#0B120E/gi, 'var(--bg)'],
  [/#131C16/gi, 'var(--surface)'],
  [/#1B2820/gi, 'var(--surface-2)'],
  [/#16A34A/gi, 'var(--brand)'],
  [/#006600/gi, 'var(--brand-deep)'],
  [/#EAB308/gi, 'var(--accent-gold)'],
  [/#FDD700/gi, 'var(--spbc-gold-legacy)'],
  [/#F2F7F3/gi, 'var(--text)'],
  [/#A8B8AC/gi, 'var(--text-muted)'],
  [/#263A2C/gi, 'var(--border)'],
  [/#DC2626/gi, 'var(--destructive)'],
  [/rgba\(\s*19,\s*28,\s*22,\s*0\.78\s*\)/g, 'var(--spbc-glass)'],
  [/rgba\(\s*19,\s*28,\s*22,\s*0\.85\s*\)/g, 'var(--spbc-glass)'],
  [/rgba\(\s*234,\s*179,\s*8,\s*0\.22\s*\)/g, 'var(--spbc-glass-border)'],
  [/200ms ease-out/g, 'var(--spbc-t-micro)'],
  [/320ms cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/g, 'var(--spbc-t-macro)'],
  [/0\.28s cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/g, 'var(--spbc-t-macro)'],
  [/border-radius:\s*1\.25rem/g, 'border-radius: var(--spbc-radius-lg)'],
  [/border-radius:\s*1\.5rem/g, 'border-radius: var(--spbc-radius-xl)'],
  [/border-radius:\s*1rem(?![-\w])/g, 'border-radius: var(--spbc-radius)'],
  [/z-index:\s*60(?!\d)/g, 'z-index: var(--spbc-z-sticky)'],
  [/z-index:\s*80(?!\d)/g, 'z-index: var(--spbc-z-modal)'],
  [/z-index:\s*200(?!\d)/g, 'z-index: calc(var(--spbc-z-modal) + 10)'],
];

let out = raw;
for (const [re, rep] of map) out = out.replace(re, rep);

// Drop duplicated chrome that we re-emit once below
out = out
  .replace(/html\s*\{[^}]+\}/g, '')
  .replace(/body\s*\{[^}]+\}/g, '')
  .replace(/\.ducks-font\s*\{[^}]+\}/g, '')
  .replace(/\.skip-link\s*\{[^}]+\}/g, '')
  .replace(/\.skip-link:focus\s*\{[^}]+\}/g, '')
  .replace(/input,\s*textarea,\s*select,\s*button\s*\{[^}]+\}/g, '');

const base = `
/* ═══ ${MARKER} — single stylesheet, tokens only ═══ */
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body.atmosphere {
  font-family: 'Inter', system-ui, sans-serif;
  padding-left: env(safe-area-inset-left, 0);
  padding-right: env(safe-area-inset-right, 0);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.ducks-font {
  font-family: 'Bebas Neue', Impact, sans-serif;
  font-weight: 400;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0.5rem;
  z-index: calc(var(--spbc-z-modal) + 10);
  background: var(--accent-gold);
  color: var(--bg);
  font-weight: 700;
  padding: 0.6rem 1rem;
  border-radius: 0.75rem;
  min-height: 44px;
}
.skip-link:focus {
  left: 0.5rem;
  outline: 2px solid #fff;
  outline-offset: 2px;
}
input, textarea, select, button {
  font-size: 16px;
  touch-action: manipulation;
}
.break-word { overflow-wrap: anywhere; word-break: break-word; }
#contact { scroll-margin-top: 88px; }
`;

const combined = base + '\n' + out + '\n';

let atm = fs.readFileSync(ATM, 'utf8');
if (atm.includes(MARKER)) {
  console.log('atmosphere already contains Unit B styles — not appending again');
} else {
  atm = atm.trimEnd() + '\n\n' + combined;
  fs.writeFileSync(ATM, atm);
  console.log('appended page styles → site-atmosphere.css', Buffer.byteLength(atm), 'bytes');
}

// Empty page CSS sources so build emits no <style> blocks
for (const p of pages) {
  const f = path.join(ROOT, 'src', 'styles', `${p}.page.css`);
  fs.writeFileSync(f, `/* styles migrated to shared/site-atmosphere.css (${MARKER}) */\n`);
  console.log('cleared', path.relative(ROOT, f));
}
