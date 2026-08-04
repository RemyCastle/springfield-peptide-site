/**
 * SPBC gym flyer builder — print-ready variants, US Letter LANDSCAPE 11 x 8.5in.
 *
 * Why HTML -> PDF instead of an AI-generated image: image models bake garbled text into
 * low-res raster. Rendering real text through Chrome gives vector type and a vector QR.
 *
 * Variants 01–10 are typography-led. Variants 11–16 place AI abstract art in DPI-safe
 * zones (side panels / bands / frames). Full-bleed art (15) is a heavily treated wash
 * only — softness reads as texture. Text and QR are NEVER baked into the art.
 *
 *   node flyers/build-flyers.mjs
 *
 * Outputs to Desktop\SPBC-Gym-Flyers: <id>.pdf (print) + <id>.png (300dpi preview).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import QRCode from 'qrcode';
import { chromium } from 'playwright';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(os.homedir(), 'Desktop', 'SPBC-Gym-Flyers');
const ART_DIR = path.join(HERE, 'art');
const DATA = JSON.parse(fs.readFileSync(path.join(HERE, 'variants.json'), 'utf8'));

/** Landscape US Letter — matches Remy's holders. */
const PAGE_W_IN = 11;
const PAGE_H_IN = 8.5;
const DPI = 300;

fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

/** Embed art as data URI so setContent does not need a base URL. */
function artDataUri(filename) {
  const p = path.join(ART_DIR, filename);
  if (!fs.existsSync(p)) throw new Error(`Missing art file: ${p}`);
  const buf = fs.readFileSync(p);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/** Native px of a JPEG via SOFn scan (no deps). */
function jpegSize(filename) {
  const buf = fs.readFileSync(path.join(ART_DIR, filename));
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return { w: 0, h: 0 };
}

async function qrSvg() {
  // ECC H so a scuffed, curled or partly shadowed print still scans.
  const svg = await QRCode.toString(DATA.shared.qrTarget, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 1,
    color: { dark: '#0B120E', light: '#FFFFFF' },
  });
  return svg.replace(/<\?xml[^>]*\?>/, '').replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ');
}

function css(theme) {
  const dark = theme === 'dark';
  const ink = dark ? '#F2F7F3' : '#10201A';
  const accent = dark ? '#FDD700' : '#0A5C22';
  return `
  @page { size: ${PAGE_W_IN}in ${PAGE_H_IN}in; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${PAGE_W_IN}in; height: ${PAGE_H_IN}in;
    font-family: 'Inter', system-ui, Arial, sans-serif;
    background: ${dark ? '#0B120E' : '#FFFFFF'}; color: ${ink};
    display: flex; flex-direction: column; overflow: hidden;
  }
  .sheet { flex: 1; display: flex; flex-direction: column; padding: 0.55in 0.6in 0.45in; position: relative; min-height: 0; }
  .rule-top { position: absolute; top: 0; left: 0; right: 0; height: 0.085in;
    background: linear-gradient(90deg,#006600,#EAB308 55%,#FDD700); }
  /* two-column body: copy left, QR panel right */
  .body { flex: 1; display: flex; gap: 0.55in; align-items: center; min-height: 0; }
  .copy { flex: 1; min-width: 0; }
  .aside { width: 3.15in; flex: none; text-align: center; }

  .brand { font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif;
    font-size: 14pt; letter-spacing: 0.10em; color: ${accent}; margin: 0 0 0.14in; }
  h1 { font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif; font-weight: 400;
    letter-spacing: 0.015em; line-height: 0.93; margin: 0 0 0.14in;
    font-size: 60pt; color: ${dark ? '#FFFFFF' : '#0B120E'}; }
  h1 .gold { color: ${accent}; }
  .sub { font-size: 13pt; line-height: 1.4; max-width: 5.6in; margin: 0 0 0.18in;
    color: ${dark ? 'rgba(242,247,243,0.88)' : '#33473C'}; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { font-size: 12pt; line-height: 1.45; padding-left: 0.26in; position: relative; margin-bottom: 0.05in;
    color: ${dark ? 'rgba(242,247,243,0.94)' : '#22332B'}; }
  li::before { content: ''; position: absolute; left: 0; top: 0.08in; width: 0.12in; height: 0.12in;
    border-radius: 2px; background: ${accent}; }

  .qr { width: 2.6in; height: 2.6in; background: #fff; padding: 0.1in; border-radius: 0.08in;
    box-shadow: 0 0 0 2px ${accent}; margin: 0 auto 0.14in; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .cta { font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif; font-size: 22pt;
    letter-spacing: 0.02em; line-height: 1.05; margin: 0 0 0.05in; color: ${dark ? '#FFFFFF' : '#0B120E'}; }
  .url { font-size: 14.5pt; font-weight: 700; color: ${accent}; margin: 0 0 0.04in; word-break: break-all; }
  .email { font-size: 10pt; color: ${dark ? 'rgba(242,247,243,0.7)' : '#4A5F55'}; margin: 0; word-break: break-all; }

  .compliance { border-top: 1px solid ${dark ? 'rgba(253,215,0,0.35)' : 'rgba(10,92,34,0.3)'};
    padding-top: 0.1in; margin-top: 0.14in; font-size: 8.4pt; line-height: 1.34; flex: none;
    color: ${dark ? 'rgba(242,247,243,0.72)' : '#4A5F55'}; }
  .compliance strong { color: ${accent}; }

  /* ---- layout variants (all 11x8.5) ---- */
  .l-hero-center .body { flex-direction: column; text-align: center; gap: 0.22in; justify-content: center; }
  .l-hero-center .copy { flex: none; }
  .l-hero-center .sub { margin-left: auto; margin-right: auto; }
  .l-hero-center ul { display: inline-flex; flex-wrap: wrap; gap: 0 0.4in; text-align: left; justify-content: center; }
  .l-hero-center .aside { width: auto; }
  .l-hero-center .qr { width: 1.9in; height: 1.9in; }

  .l-rule-left h1 { border-left: 0.055in solid ${accent}; padding-left: 0.2in; }
  .l-minimal h1 { font-size: 74pt; }
  .l-minimal ul { display: flex; flex-wrap: wrap; gap: 0 0.32in; }
  .l-qr-dominant .body { flex-direction: row-reverse; }
  .l-qr-dominant .aside { width: 4.05in; }
  .l-qr-dominant .qr { width: 3.85in; height: 3.85in; }
  .l-qr-dominant h1 { font-size: 52pt; }
  .l-big-type h1 { font-size: 86pt; line-height: 0.88; }
  .l-big-type .sub { font-size: 14pt; }
  .l-checklist li { font-size: 12.5pt; }

  /* tear-off tabs: 8 across 11in => 1.37in each, QR 1.05in (18mm tabs did NOT decode) */
  .tabs { display: flex; border-top: 2px dashed ${dark ? 'rgba(253,215,0,0.5)' : '#7A8F84'}; flex: none; }
  .tab { flex: 1; border-left: 1px dashed ${dark ? 'rgba(253,215,0,0.35)' : '#9AAFA4'};
    padding: 0.09in 0.02in; text-align: center; }
  .tab:first-child { border-left: none; }
  .tab svg { width: 1.05in; height: 1.05in; display: block; margin: 0 auto 0.03in; }
  .tab span { font-size: 7pt; font-weight: 700; color: ${accent}; display: block; line-height: 1.15; }
  .l-tear-tabs .qr { width: 1.75in; height: 1.75in; }
  .l-tear-tabs h1 { font-size: 46pt; }
  .l-tear-tabs .body { align-items: flex-start; }

  /* two-up: two stacked landscape halves (11 x 4.25), cut across the middle */
  .two-up { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .half { flex: 1; padding: 0.34in 0.5in; display: flex; flex-direction: column; min-height: 0; position: relative; }
  .half + .half { border-top: 2px dashed ${dark ? 'rgba(253,215,0,0.5)' : '#7A8F84'}; }
  .half .body { gap: 0.4in; }
  .half .brand { font-size: 10pt; margin-bottom: 0.07in; }
  .half h1 { font-size: 34pt; margin-bottom: 0.08in; }
  .half .sub { font-size: 10pt; margin-bottom: 0.08in; max-width: 4.6in; }
  .half li { font-size: 9pt; margin-bottom: 0.02in; }
  .half .aside { width: 2.1in; }
  .half .qr { width: 1.55in; height: 1.55in; margin-bottom: 0.06in; }
  .half .cta { font-size: 13pt; }
  .half .url { font-size: 10.5pt; }
  .half .email { display: none; }
  .half .compliance { font-size: 7pt; margin-top: 0.08in; padding-top: 0.07in; }
  .cut-note { position: absolute; right: 0.12in; bottom: 0.06in; font-size: 6.5pt;
    letter-spacing: 0.16em; color: ${dark ? 'rgba(242,247,243,0.45)' : '#8A9A91'}; }

  /* ========== ART-LED LAYOUTS 11–16 ========== */
  img.art { display: block; width: 100%; height: 100%; object-fit: cover; }

  /* 11 — art side panel: 4.1in × 6.15in image (832×1248 → 203 DPI), column fills page */
  .art-side {
    display: flex; flex-direction: row; padding: 0; min-height: 0; flex: 1;
  }
  .art-side .art-col {
    width: 4.1in; flex: none; height: 100%;
    background: #06100A; overflow: hidden;
    border-right: 0.04in solid ${accent};
    display: flex; align-items: center; justify-content: center;
  }
  .art-side .art-col img { width: 4.1in; height: 6.15in; object-fit: cover; flex: none; }
  .art-side .main {
    flex: 1; min-width: 0; display: flex; flex-direction: column;
    padding: 0.5in 0.5in 0.38in; position: relative;
  }
  .art-side .rule-top { left: 4.1in; }
  .art-side h1 { font-size: 48pt; }
  .art-side .sub { max-width: 5.2in; font-size: 12pt; }
  .art-side .body { gap: 0.4in; align-items: center; }
  .art-side .aside { width: 2.55in; }
  .art-side .qr { width: 2.2in; height: 2.2in; }
  .art-side .cta { font-size: 16pt; }
  .art-side .url { font-size: 12pt; }
  .art-side .email { font-size: 9pt; }
  .art-side .compliance { font-size: 7.8pt; }

  /* 12 — diagonal wedge (dark fill + DPI-safe art block inside clip, copy on solid) */
  .art-diagonal {
    display: flex; flex-direction: column; padding: 0; flex: 1; position: relative;
    overflow: hidden; background: #0B120E;
  }
  .art-diagonal .art-wedge {
    position: absolute; top: 0; left: 0; width: 5.4in; height: 8.5in;
    clip-path: polygon(0 0, 100% 0, 58% 100%, 0 100%);
    overflow: hidden; background: #06100A;
    display: flex; align-items: center; justify-content: center;
  }
  /* peptide 1248×832 landscape @ 5.0in × 3.33in → 250 DPI */
  .art-diagonal .art-wedge img {
    width: 5.0in; height: 3.33in; object-fit: cover; flex: none;
    transform: rotate(-12deg) scale(1.15);
  }
  .art-diagonal .gold-edge {
    position: absolute; top: 0; left: 0; width: 5.4in; height: 8.5in;
    clip-path: polygon(98.5% 0, 100% 0, 60% 100%, 56.5% 100%);
    background: linear-gradient(180deg, #FDD700, #EAB308 50%, #006600);
    pointer-events: none;
  }
  .art-diagonal .main {
    position: relative; z-index: 2; flex: 1; display: flex; flex-direction: column;
    padding: 0.5in 0.55in 0.38in 4.7in; min-height: 0;
  }
  .art-diagonal h1 { font-size: 46pt; }
  .art-diagonal .sub { max-width: 5.4in; font-size: 12pt; }
  .art-diagonal .body { flex-direction: column; align-items: flex-start; gap: 0.2in; }
  .art-diagonal .aside { width: auto; text-align: left; display: flex; gap: 0.28in; align-items: center; }
  .art-diagonal .qr { width: 2.1in; height: 2.1in; margin: 0; flex: none; }
  .art-diagonal .aside-text { text-align: left; }
  .art-diagonal .cta { font-size: 16pt; }
  .art-diagonal .url { font-size: 12pt; }
  .art-diagonal .compliance { font-size: 7.6pt; max-width: 5.8in; }

  /* 13 — top art band ~2.9in tall, art centred at safe width */
  .art-top-band {
    display: flex; flex-direction: column; padding: 0; flex: 1; min-height: 0;
  }
  .art-top-band .art-band {
    height: 2.9in; flex: none; background: #06100A;
    display: flex; align-items: center; justify-content: center;
    border-bottom: 0.035in solid ${accent}; overflow: hidden; position: relative;
  }
  /* native 1280x720 → display 5.15in × 2.9in = 248 DPI both axes */
  .art-top-band .art-band img {
    width: 5.15in; height: 2.9in; object-fit: cover; flex: none;
  }
  .art-top-band .art-band::before,
  .art-top-band .art-band::after {
    content: ''; position: absolute; top: 0; bottom: 0; width: 2.95in;
    background: linear-gradient(90deg, #06100A 0%, transparent 100%);
    pointer-events: none;
  }
  .art-top-band .art-band::before { left: 0; }
  .art-top-band .art-band::after {
    right: 0; background: linear-gradient(270deg, #06100A 0%, transparent 100%);
  }
  .art-top-band .main {
    flex: 1; display: flex; flex-direction: column; min-height: 0;
    padding: 0.32in 0.55in 0.32in;
  }
  .art-top-band h1 { font-size: 44pt; margin-bottom: 0.1in; }
  .art-top-band .sub { font-size: 11.5pt; margin-bottom: 0.12in; max-width: 6in; }
  .art-top-band .body { gap: 0.4in; align-items: center; }
  .art-top-band .aside { width: 2.5in; }
  .art-top-band .qr { width: 2.05in; height: 2.05in; }
  .art-top-band .cta { font-size: 15pt; }
  .art-top-band .url { font-size: 12pt; }
  .art-top-band .email { font-size: 9pt; }
  .art-top-band .compliance { font-size: 7.6pt; margin-top: 0.1in; }

  /* 14 — framed art block, copy wraps around */
  .art-framed {
    display: flex; flex-direction: column; padding: 0.45in 0.55in 0.35in; flex: 1; min-height: 0;
  }
  .art-framed .rule-top { display: block; }
  .art-framed .row {
    flex: 1; display: flex; gap: 0.4in; align-items: center; min-height: 0;
  }
  .art-framed .copy-col { flex: 1; min-width: 0; }
  .art-framed .frame {
    width: 3.55in; height: 3.55in; flex: none;
    border: 1.5pt solid ${accent}; padding: 0.08in;
    box-shadow: 0 0 0 0.5pt rgba(253,215,0,0.35);
    background: #06100A;
  }
  .art-framed .frame img { width: 100%; height: 100%; object-fit: cover; }
  /* 1024 / 3.55 ≈ 288 DPI */
  .art-framed h1 { font-size: 48pt; }
  .art-framed .sub { font-size: 12pt; max-width: 5.4in; }
  .art-framed .aside-row {
    display: flex; gap: 0.35in; align-items: center; margin-top: 0.12in;
  }
  .art-framed .qr { width: 2.05in; height: 2.05in; margin: 0; flex: none; }
  .art-framed .cta { font-size: 16pt; text-align: left; }
  .art-framed .url { font-size: 12pt; text-align: left; }
  .art-framed .email { font-size: 9pt; text-align: left; }
  .art-framed .compliance { font-size: 7.6pt; }

  /* 15 — duotone full-bleed treated wash (low effective DPI allowed as texture) */
  .art-bleed {
    display: flex; flex-direction: column; padding: 0; flex: 1; position: relative;
    overflow: hidden; background: #0B120E;
  }
  .art-bleed .bleed-bg {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; opacity: 1;
    /* 1280×720 over 11×8.5 → ~116 × 85 DPI — treated wash, not subject */
    filter: saturate(0.9) contrast(1.05) brightness(0.72);
  }
  .art-bleed .scrim {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse at 28% 38%, rgba(11,18,14,0.25) 0%, rgba(11,18,14,0.62) 50%, rgba(11,18,14,0.88) 100%),
      linear-gradient(105deg, rgba(11,18,14,0.35) 0%, rgba(11,18,14,0.72) 55%, rgba(11,18,14,0.9) 100%);
  }
  .art-bleed .grain {
    position: absolute; inset: 0; opacity: 0.18; pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
    background-size: 180px 180px; mix-blend-mode: overlay;
  }
  .art-bleed .main {
    position: relative; z-index: 2; flex: 1; display: flex; flex-direction: column;
    padding: 0.55in 0.65in 0.4in; min-height: 0;
  }
  .art-bleed .rule-top { z-index: 3; }
  .art-bleed h1 {
    font-size: 78pt; line-height: 0.9; color: #FFFFFF;
    text-shadow: 0 2px 18px rgba(0,0,0,0.55);
  }
  .art-bleed .sub {
    color: rgba(242,247,243,0.92); font-size: 13.5pt; max-width: 6in;
    text-shadow: 0 1px 8px rgba(0,0,0,0.5);
  }
  .art-bleed li { color: rgba(242,247,243,0.94); }
  .art-bleed .body { gap: 0.5in; align-items: center; }
  .art-bleed .aside { width: 2.7in; }
  .art-bleed .qr { width: 2.35in; height: 2.35in; }
  .art-bleed .cta { color: #FFFFFF; font-size: 18pt; text-shadow: 0 1px 6px rgba(0,0,0,0.45); }
  .art-bleed .compliance {
    color: rgba(242,247,243,0.78); border-color: rgba(253,215,0,0.4);
    font-size: 8pt; background: rgba(11,18,14,0.55); padding: 0.1in 0.12in; margin-top: 0.12in;
  }

  /* 16 — split 50/50, carbon fibre tiled at print-safe tile size, QR on the seam */
  .art-split {
    display: flex; flex-direction: row; padding: 0; flex: 1; position: relative;
    overflow: hidden;
  }
  .art-split .half-art {
    width: 50%; height: 100%; flex: none;
    /* tile at ~2.6in → 832/2.6 ≈ 320 DPI */
    background-color: #06100A;
    background-size: 2.6in auto;
    background-repeat: repeat;
    background-position: center;
    border-right: 0.03in solid ${accent};
  }
  .art-split .half-solid {
    width: 50%; flex: none; display: flex; flex-direction: column;
    padding: 0.45in 0.45in 0.32in 0.55in; background: #0B120E; min-height: 0;
  }
  .art-split h1 { font-size: 40pt; margin-bottom: 0.1in; }
  .art-split .sub { font-size: 11pt; max-width: 4.2in; margin-bottom: 0.12in; }
  .art-split li { font-size: 11pt; }
  /* QR sits on the seam, lower third so it does not eat headline/body */
  .art-split .qr-straddle {
    position: absolute; left: 50%; top: 68%; transform: translate(-50%, -50%);
    z-index: 4; text-align: center; width: 2.5in;
  }
  .art-split .qr-straddle .qr {
    width: 2.1in; height: 2.1in; margin: 0 auto 0.06in;
    box-shadow: 0 0 0 3px #0B120E, 0 0 0 5px ${accent};
  }
  .art-split .qr-straddle .cta { font-size: 12pt; color: #FFFFFF;
    background: rgba(11,18,14,0.92); padding: 0.04in 0.1in; display: inline-block; }
  .art-split .qr-straddle .url { font-size: 11pt; }
  .art-split .half-solid .copy { max-width: 4.35in; }
  /* reserve space under copy so body text never sits under the QR */
  .art-split .half-solid .copy-spacer { flex: 1; min-height: 2.4in; }
  .art-split .compliance { font-size: 7.2pt; margin-top: 0; padding-top: 0.08in; }
  `;
}

function copyBlock(v, s) {
  const pts = (v.points || []).map((p) => `<li>${esc(p)}</li>`).join('');
  const headline = nl2br(v.headline).replace(
    /(VETTED|SOURCED|VERIFIED|BUYERS CLUB|DIRECT|VOLUME)/g,
    '<span class="gold">$1</span>'
  );
  return `<div class="copy">
    <p class="brand">${esc(s.brand)}</p>
    <h1>${headline}</h1>
    <p class="sub">${esc(v.subhead)}</p>
    ${pts ? `<ul>${pts}</ul>` : ''}
  </div>`;
}

function asideBlock(s, qr) {
  return `<div class="aside">
    <div class="qr">${qr}</div>
    <p class="cta">${esc(s.cta)}</p>
    <p class="url">${esc(s.url)}</p>
    <p class="email">${esc(s.email)}</p>
  </div>`;
}

const complianceBlock = (s) =>
  `<p class="compliance"><strong>21+ · RESEARCH USE ONLY.</strong> ${esc(s.compliance)}</p>`;

function pageHtml(v, s, qr) {
  let inner;
  const artSrc = v.art ? artDataUri(v.art) : null;

  if (v.layout === 'two-up') {
    const half = `<div class="half">
        <div class="body">${copyBlock(v, s)}${asideBlock(s, qr)}</div>
        ${complianceBlock(s)}<span class="cut-note">CUT HERE</span>
      </div>`;
    inner = `<div class="two-up">${half}${half}</div>`;
  } else if (v.layout === 'tear-tabs') {
    const tabs = Array.from({ length: 8 })
      .map(() => `<div class="tab">${qr}<span>${esc(s.url)}</span></div>`)
      .join('');
    inner = `<div class="sheet l-tear-tabs"><div class="rule-top"></div>
        <div class="body">${copyBlock(v, s)}${asideBlock(s, qr)}</div>
        ${complianceBlock(s)}
      </div><div class="tabs">${tabs}</div>`;
  } else if (v.layout === 'art-side') {
    inner = `<div class="sheet art-side">
      <div class="art-col"><img class="art" src="${artSrc}" alt=""></div>
      <div class="main">
        <div class="rule-top"></div>
        <div class="body">${copyBlock(v, s)}${asideBlock(s, qr)}</div>
        ${complianceBlock(s)}
      </div>
    </div>`;
  } else if (v.layout === 'art-diagonal') {
    inner = `<div class="sheet art-diagonal">
      <div class="art-wedge"><img class="art" src="${artSrc}" alt=""></div>
      <div class="gold-edge"></div>
      <div class="main">
        ${copyBlock(v, s)}
        <div class="body">
          <div class="aside">
            <div class="qr">${qr}</div>
            <div class="aside-text">
              <p class="cta">${esc(s.cta)}</p>
              <p class="url">${esc(s.url)}</p>
              <p class="email">${esc(s.email)}</p>
            </div>
          </div>
        </div>
        ${complianceBlock(s)}
      </div>
    </div>`;
  } else if (v.layout === 'art-top-band') {
    inner = `<div class="sheet art-top-band">
      <div class="art-band"><img class="art" src="${artSrc}" alt=""></div>
      <div class="main">
        <div class="body">${copyBlock(v, s)}${asideBlock(s, qr)}</div>
        ${complianceBlock(s)}
      </div>
    </div>`;
  } else if (v.layout === 'art-framed') {
    inner = `<div class="sheet art-framed">
      <div class="rule-top"></div>
      <div class="row">
        <div class="copy-col">
          ${copyBlock(v, s)}
          <div class="aside-row">
            <div class="qr">${qr}</div>
            <div>
              <p class="cta">${esc(s.cta)}</p>
              <p class="url">${esc(s.url)}</p>
              <p class="email">${esc(s.email)}</p>
            </div>
          </div>
        </div>
        <div class="frame"><img class="art" src="${artSrc}" alt=""></div>
      </div>
      ${complianceBlock(s)}
    </div>`;
  } else if (v.layout === 'art-duotone-bleed') {
    inner = `<div class="sheet art-bleed">
      <img class="bleed-bg" src="${artSrc}" alt="">
      <div class="scrim"></div>
      <div class="grain"></div>
      <div class="rule-top"></div>
      <div class="main">
        <div class="body">${copyBlock(v, s)}${asideBlock(s, qr)}</div>
        ${complianceBlock(s)}
      </div>
    </div>`;
  } else if (v.layout === 'art-split') {
    inner = `<div class="sheet art-split">
      <div class="half-art" style="background-image:url('${artSrc}')"></div>
      <div class="half-solid">
        ${copyBlock(v, s)}
        <div class="copy-spacer" aria-hidden="true"></div>
        ${complianceBlock(s)}
      </div>
      <div class="qr-straddle">
        <div class="qr">${qr}</div>
        <p class="cta">${esc(s.cta)}</p>
        <p class="url">${esc(s.url)}</p>
      </div>
    </div>`;
  } else {
    inner = `<div class="sheet l-${v.layout}"><div class="rule-top"></div>
        <div class="body">${copyBlock(v, s)}${asideBlock(s, qr)}</div>
        ${complianceBlock(s)}
      </div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>${css(v.theme)}</style></head><body>${inner}</body></html>`;
}

/** Placement sizes used for DPI reporting (must match CSS). */
const ART_PLACEMENT = {
  'art-side': { label: 'side panel image 4.1in × 6.15in', wIn: 4.1, hIn: 6.15, mode: 'exact' },
  'art-diagonal': {
    label: 'diagonal art block 5.0in × 3.33in (inside clip)',
    wIn: 5.0,
    hIn: 3.33,
    mode: 'exact',
  },
  'art-top-band': { label: 'centred band 5.15in × 2.9in', wIn: 5.15, hIn: 2.9, mode: 'exact' },
  'art-framed': { label: 'framed block 3.55in × 3.55in', wIn: 3.55, hIn: 3.55, mode: 'exact' },
  'art-duotone-bleed': {
    label: 'full-bleed wash 11in × 8.5in (treated duotone+grain+scrim)',
    wIn: 11,
    hIn: 8.5,
    mode: 'cover',
    treatedWash: true,
  },
  'art-split': {
    label: 'tiled left half, tile 2.6in wide (texture)',
    wIn: 2.6,
    hIn: null,
    mode: 'tile',
    tileWIn: 2.6,
  },
};

function reportDpi(v) {
  if (!v.art) return null;
  const { w, h } = jpegSize(v.art);
  const place = ART_PLACEMENT[v.layout];
  if (!place) return { file: v.art, native: `${w}x${h}` };
  let effW;
  let effH;
  let note = place.label;
  if (place.mode === 'tile') {
    const tileHIn = place.tileWIn * (h / w);
    effW = w / place.tileWIn;
    effH = h / tileHIn;
    note += ` · tile ${place.tileWIn}in × ${tileHIn.toFixed(2)}in`;
  } else if (place.mode === 'exact') {
    effW = w / place.wIn;
    effH = h / place.hIn;
  } else {
    // cover: s = max(wIn/w, hIn/h) inches per px → DPI = 1/s
    const s = Math.max(place.wIn / w, place.hIn / h);
    const dpi = 1 / s;
    effW = dpi;
    effH = dpi;
  }
  return {
    file: v.art,
    native: `${w}x${h}`,
    place: note,
    effDpiW: Math.round(effW),
    effDpiH: Math.round(effH),
    treatedWash: !!place.treatedWash,
  };
}

const run = async () => {
  const s = DATA.shared;
  const qr = await qrSvg();
  const browser = await chromium.launch();
  const made = [];
  const dpiReport = [];
  let overflowFail = 0;

  for (const v of DATA.variants) {
    const page = await browser.newPage({
      viewport: { width: Math.round(PAGE_W_IN * 96), height: Math.round(PAGE_H_IN * 96) },
      deviceScaleFactor: DPI / 96,
    });
    await page.setContent(pageHtml(v, s, qr), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    // Guard: landscape has less vertical room — fail loudly rather than print clipped copy.
    const overflow = await page.evaluate(
      () => document.body.scrollHeight - document.body.clientHeight
    );
    if (overflow > 2) {
      overflowFail++;
      console.warn(`  ! ${v.id} overflows by ${overflow}px — tighten copy`);
    }
    const pdf = path.join(OUT, `${v.id}.pdf`);
    const png = path.join(OUT, `${v.id}.png`);
    await page.pdf({
      path: pdf,
      width: `${PAGE_W_IN}in`,
      height: `${PAGE_H_IN}in`,
      printBackground: true,
      landscape: false, // page box is already 11x8.5
    });
    await page.screenshot({ path: png, fullPage: false });
    await page.close();
    const dpi = reportDpi(v);
    if (dpi) dpiReport.push({ id: v.id, ...dpi });
    made.push({ id: v.id, theme: v.theme, layout: v.layout, art: v.art || null, overflowPx: overflow });
    console.log('built', v.id, overflow > 2 ? `(OVERFLOW ${overflow}px)` : '', dpi ? `art ${dpi.native} → ~${dpi.effDpiW}dpi` : '');
  }
  await browser.close();

  fs.writeFileSync(
    path.join(OUT, 'manifest.json'),
    JSON.stringify(
      {
        page: '11x8.5in landscape',
        dpi: DPI,
        qrTarget: s.qrTarget,
        made,
        artDpi: dpiReport,
      },
      null,
      2
    )
  );
  console.log(`\n${made.length} landscape flyers -> ${OUT}`);
  if (dpiReport.length) {
    console.log('\nArt DPI report:');
    for (const r of dpiReport) {
      const flag =
        r.treatedWash
          ? ' [TREATED WASH — low DPI allowed]'
          : r.effDpiW < 200 || r.effDpiH < 200
            ? ' [BELOW 200 — REJECT]'
            : '';
      console.log(
        `  ${r.id}: ${r.file} native ${r.native} | ${r.place} | ~${r.effDpiW}×${r.effDpiH} dpi${flag}`
      );
    }
  }
  if (overflowFail) {
    console.error(`\n${overflowFail} variant(s) overflowed — treat as failure`);
    process.exit(1);
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
