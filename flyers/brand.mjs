/**
 * SPBC flyer brand lockup — shared by every variant so branding is identical
 * and prominent on all of them.
 *
 * Remy's note: "branding a little more prominent." A 14pt eyebrow reads as a
 * caption from six feet away, which is the real viewing distance for a gym
 * holder. This gives a proper lockup: an SPBC badge plus a two-line wordmark,
 * mirroring the site header (SPRINGFIELD in gold, PEPTIDE BUYERS CLUB in white)
 * so print and web read as the same brand.
 *
 * Hierarchy rule: the badge + wordmark must be unmistakable but must NOT out-shout
 * the headline. Keep h1 at least ~2x the wordmark's cap height.
 */

export function brandCss(theme) {
  const dark = theme === 'dark';
  const accent = dark ? '#FDD700' : '#0A5C22';
  const solid = dark ? '#FFFFFF' : '#0B120E';
  const faint = dark ? 'rgba(242,247,243,0.62)' : '#5A6E64';
  return `
  /* ── brand lockup ─────────────────────────────────────────── */
  .brandbar { display: flex; align-items: center; gap: 0.22in; margin: 0 0 0.2in; flex: none; }
  .badge {
    width: 1.02in; height: 1.02in; flex: none;
    display: flex; align-items: center; justify-content: center;
    border: 0.035in solid ${accent}; border-radius: 0.12in;
    background: ${dark ? 'rgba(253,215,0,0.07)' : 'rgba(10,92,34,0.05)'};
    font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif;
    font-size: 33pt; line-height: 1; letter-spacing: 0.01em;
  }
  .badge .b-gold { color: ${accent}; }
  .badge .b-solid { color: ${solid}; }
  .wordmark { min-width: 0; }
  .wordmark .wm-1 {
    font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif;
    font-size: 27pt; line-height: 0.96; letter-spacing: 0.055em;
    color: ${accent}; margin: 0; white-space: nowrap;
  }
  .wordmark .wm-2 {
    font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif;
    font-size: 18.5pt; line-height: 1.02; letter-spacing: 0.075em;
    color: ${solid}; margin: 0; white-space: nowrap;
  }
  .wordmark .wm-3 {
    font-size: 8.6pt; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
    color: ${faint}; margin: 0.035in 0 0;
  }

  /* Repeat mark above the QR so a torn-off or photographed corner still carries the name. */
  .aside .brand-mini {
    font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif;
    font-size: 15pt; letter-spacing: 0.07em; margin: 0 0 0.08in; line-height: 1;
  }
  .aside .brand-mini .b-gold { color: ${accent}; }
  .aside .brand-mini .b-solid { color: ${solid}; }

  /* compact lockup for the two-up half sheets */
  .half .brandbar { gap: 0.15in; margin-bottom: 0.1in; }
  .half .badge { width: 0.66in; height: 0.66in; font-size: 21pt; border-width: 0.026in; border-radius: 0.08in; }
  .half .wordmark .wm-1 { font-size: 17pt; }
  .half .wordmark .wm-2 { font-size: 12pt; }
  .half .wordmark .wm-3 { display: none; }
  .half .aside .brand-mini { font-size: 10pt; }

  /* tear-off tabs carry the name, not just a bare URL */
  .tab .tab-brand {
    font-family: 'Bebas Neue', Impact, 'Arial Narrow', sans-serif;
    font-size: 11pt; letter-spacing: 0.05em; line-height: 1; margin: 0 0 0.02in;
  }
  .tab .tab-brand .b-gold { color: ${accent}; }
  .tab .tab-brand .b-solid { color: ${solid}; }

  /* On art-backed layouts the lockup needs its own contrast floor. */
  .on-art .brandbar { padding: 0.1in 0.16in; border-radius: 0.1in;
    background: ${dark ? 'rgba(11,18,14,0.72)' : 'rgba(255,255,255,0.82)'}; }
  `;
}

/** Badge + two-line wordmark. `tagline` is optional supporting text. */
export function brandBarHtml({ tagline = 'Vetted suppliers · Volume pricing · 21+' } = {}) {
  return `<div class="brandbar">
    <div class="badge"><span class="b-gold">SP</span><span class="b-solid">BC</span></div>
    <div class="wordmark">
      <p class="wm-1">SPRINGFIELD</p>
      <p class="wm-2">PEPTIDE BUYERS CLUB</p>
      ${tagline ? `<p class="wm-3">${tagline}</p>` : ''}
    </div>
  </div>`;
}

/** Small repeat mark for the QR panel. */
export function brandMiniHtml() {
  return `<p class="brand-mini"><span class="b-gold">SPRINGFIELD</span> <span class="b-solid">PEPTIDE BUYERS CLUB</span></p>`;
}

/** Brand line for a tear-off tab. */
export function tabBrandHtml() {
  return `<p class="tab-brand"><span class="b-gold">SP</span><span class="b-solid">BC</span></p>`;
}
