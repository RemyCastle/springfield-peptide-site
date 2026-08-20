/**
 * SPBC pages builder — dependency-free include + token expander.
 *
 * Syntax:
 *   <!-- @include name -->          → src/partials/name.html
 *   <!-- @include name.ext -->      → src/partials/name.ext (or src/styles, src/scripts)
 *   {{token}}                       → page token map
 *   {{#if token}}...{{/if}}         → include block if token truthy
 *
 * Page sources live in src/pages/*.html and begin with a JSON front-matter
 * block between <!-- @page ... --> markers (optional single-line keys).
 *
 * Emits root HTML files marked GENERATED — do not edit by hand.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PARTIALS = path.join(SRC, 'partials');
const PAGES = path.join(SRC, 'pages');
const STYLES = path.join(SRC, 'styles');
const SCRIPTS = path.join(SRC, 'scripts');

const PAGE_NAMES = ['index', 'calculator', 'stacks', 'coaching', 'contact', 'titration'];

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function write(p, s) {
  fs.writeFileSync(p, s, 'utf8');
}

/** Load hashed asset basenames currently referenced in shared/ (newest by mtime). */
function resolveHashed(base, ext) {
  const dir = path.join(ROOT, 'shared');
  const re = new RegExp(`^${base}\\.([a-f0-9]{8})\\.${ext}$`);
  const hits = fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!hits.length) {
    // Fall back to unhashed if present (dev)
    const plain = `${base}.${ext}`;
    if (fs.existsSync(path.join(dir, plain))) return plain;
    throw new Error(`No hashed asset for ${base}.${ext}`);
  }
  return hits[0].f;
}

function assetTokens() {
  return {
    tailwind_css: resolveHashed('tailwind', 'css'),
    site_header_css: resolveHashed('site-header', 'css'),
    site_atmosphere_css: resolveHashed('site-atmosphere', 'css'),
    site_header_js: resolveHashed('site-header', 'js'),
    site_atmosphere_js: resolveHashed('site-atmosphere', 'js'),
    age_gate_js: resolveHashed('age-gate', 'js'),
    stacks_js: resolveHashed('stacks', 'js'),
    stacks_page_js: tryHashed('stacks-page', 'js'),
    // Page scripts (Unit C) — hashed when present
    store_js: tryHashed('store', 'js'),
    calculator_js: tryHashed('calculator', 'js'),
    coaching_js: tryHashed('coaching', 'js'),
    titration_js: tryHashed('titration', 'js'),
  };
}

function tryHashed(base, ext) {
  try {
    return resolveHashed(base, ext);
  } catch {
    return '';
  }
}

function parsePage(source) {
  // <!-- @page
  // key: value
  // key: """
  //   multiline
  // """
  // -->
  const m = source.match(/^<!--\s*@page\s*([\s\S]*?)-->\s*/);
  const tokens = {};
  let body = source;
  if (m) {
    body = source.slice(m[0].length);
    const block = m[1];
    let i = 0;
    const lines = block.split(/\r?\n/);
    while (i < lines.length) {
      const raw = lines[i];
      const t = raw.trim();
      i++;
      if (!t || t.startsWith('#')) continue;
      const colon = t.indexOf(':');
      if (colon < 0) continue;
      const key = t.slice(0, colon).trim();
      let val = t.slice(colon + 1).trim();
      if (val === '"""' || val === "'''") {
        const end = val;
        const buf = [];
        while (i < lines.length) {
          const L = lines[i];
          i++;
          if (L.trim() === end) break;
          buf.push(L.replace(/^\s{2}/, '')); // mild de-indent
        }
        val = buf.join('\n').trim();
      } else if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      tokens[key] = val;
    }
  }
  return { tokens, body };
}

function expandIf(template, tokens) {
  // {{#if key}}...{{/if}}  — truthy if token non-empty
  return template.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, block) => {
    const v = tokens[key];
    return v ? block : '';
  });
}

function expandTokens(template, tokens) {
  let out = expandIf(template, tokens);
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    if (!(key in tokens)) {
      // Allow empty optional
      return '';
    }
    return String(tokens[key]);
  });
  return out;
}

function resolveInclude(name, tokens) {
  const candidates = [
    path.join(PARTIALS, name),
    path.join(PARTIALS, `${name}.html`),
    path.join(PAGES, name),
    path.join(PAGES, `${name}.html`),
    path.join(STYLES, name),
    path.join(SCRIPTS, name),
    path.join(SRC, name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return expandAll(read(c), tokens);
    }
  }
  throw new Error(`Include not found: ${name}`);
}

function expandAll(template, tokens) {
  // Expand includes first (may nest), then tokens, then if-blocks (tokens already expanded inside includes)
  let out = template;
  let guard = 0;
  while (/<!--\s*@include\s+([^\s>]+)\s*-->/.test(out)) {
    if (++guard > 50) throw new Error('Include recursion limit');
    out = out.replace(/<!--\s*@include\s+([^\s>]+)\s*-->/g, (_, name) => resolveInclude(name.trim(), tokens));
  }
  out = expandTokens(out, tokens);
  return out;
}

function buildPage(pageName) {
  const pagePath = path.join(PAGES, `${pageName}.html`);
  if (!fs.existsSync(pagePath)) throw new Error(`Missing page source: ${pagePath}`);
  const { tokens: pageTokens, body } = parsePage(read(pagePath));

  // Load optional page style/script files into tokens
  const stylePath = path.join(STYLES, `${pageName}.page.css`);
  const scriptPath = path.join(SCRIPTS, `${pageName}.page.js`);
  const page_styles = fs.existsSync(stylePath) ? read(stylePath).trim() : '';
  const page_scripts = fs.existsSync(scriptPath) ? read(scriptPath).trim() : '';

  const assets = assetTokens();
  const pageAppMap = {
    index: assets.store_js,
    calculator: assets.calculator_js,
    titration: '', // retired notice only — do not load the old planner JS
    coaching: assets.coaching_js,
    stacks: '', // stacks uses stacks_script + stacks_page_js
  };
  const tokens = {
    ...assets,
    page: pageName,
    page_styles,
    page_scripts,
    page_app_js: pageAppMap[pageName] || '',
    body: '', // filled after body expand
    ...pageTokens,
  };

  // Body may itself include partials/tokens
  tokens.body = expandAll(body, tokens);

  const shellPath = path.join(PARTIALS, 'shell.html');
  if (!fs.existsSync(shellPath)) throw new Error('Missing partials/shell.html');
  let html = expandAll(read(shellPath), tokens);

  // Ensure GENERATED banner
  if (!html.startsWith('<!-- GENERATED')) {
    html =
      `<!-- GENERATED from src/pages/${pageName}.html — do not edit; run: node scripts/build-pages.js -->\n` +
      html;
  }

  const outPath = path.join(ROOT, pageName === 'index' ? 'index.html' : `${pageName}.html`);
  write(outPath, html);
  return { outPath, bytes: Buffer.byteLength(html, 'utf8') };
}

function main() {
  const results = [];
  for (const name of PAGE_NAMES) {
    const r = buildPage(name);
    results.push({ name, ...r });
    console.log(`built ${name} → ${path.relative(ROOT, r.outPath)} (${r.bytes} bytes)`);
  }
  console.log(JSON.stringify({ ok: true, pages: results.map((r) => r.name) }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { buildPage, assetTokens, main };
