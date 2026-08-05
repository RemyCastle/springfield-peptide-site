/**
 * SPBC schedule planner.
 *
 * HARD RULE: this file must never suggest, default or prefill a dose amount. Every step
 * amount starts empty and comes from the user. All it does is arithmetic on their numbers
 * (units to draw, doses per vial, vials needed) and turn the result into a cart quantity.
 * If you are tempted to add a "recommended" or "typical" ladder, don't — that turns a
 * calculator into dosing guidance, which this site does not give.
 *
 * Reuses the calculator's conventions: same catalog fetch (cookie set before the request
 * so the age-gate defer race can't cause a second one), same mg-from-name parse, same
 * U-100 maths. Graphics are hand-built SVG so no charting library is pulled in.
 */
(function () {
  'use strict';

  const MAX_UNITS = 100;
  const BAC_MAX = 3;
  const CART_KEY = 'spbc_cart_draft';
  /** Kit selects on the price list only offer these. */
  const KIT_STEPS = [1, 2, 3, 5];
  const VIAL_MAX = 10;

  const FALLBACK = [
    'SEMA 5MG', 'SEMA 10MG', 'CAGRI  5MG', 'CAGRI 10MG', 'TIRZ 10MG', 'TIRZ 30MG',
    'TIRZ 60MG', 'RETA 10MG', 'RETA 30MG', 'RETA 60 MG', 'GHK-CU 50MG', 'GHK-cu 100MG',
    'KPV 10 MG', 'NAD+ 500MG', 'NAD+ 1000MG', '5-AMINO-1MQ 50MG', 'MOTS-C 10MG',
    'MOTS-C 40MG', 'SS-31 10MG', 'BPC-157 10MG', 'TB-500 10MG', 'KLOW 80MG', 'IPA 10MG',
    'CJC/IPA NO DAC 10MG', 'Tesamorelin', 'PT-141 10 MG', 'MT1', 'MT2',
    'GLUTATHIONE 1200MG', 'DSIP 10MG',
  ];

  const $ = (id) => document.getElementById(id);
  const el = {
    compound: $('planCompound'), vialMg: $('planVialMg'), bacMl: $('planBacMl'),
    freq: $('planFreq'), conc: $('planConc'), rows: $('planStepRows'),
    addStep: $('planAddStep'), clearSteps: $('planClearSteps'), empty: $('planStepsEmpty'),
    chart: $('planChart'), syringe: $('planSyringe'), timeline: $('planTimeline'),
    stepPick: $('planStepPick'),
    outTotalMg: $('outTotalMg'), outDraws: $('outDraws'), outDosesPerVial: $('outDosesPerVial'),
    outVials: $('outVials'), outWeeks: $('outWeeks'), outVialLasts: $('outVialLasts'),
    buyNote: $('planBuyNote'), addToCart: $('planAddToCart'), addKit: $('planAddKit'),
    share: $('planShare'), cartMsg: $('planCartMsg'),
  };
  if (!el.rows) return;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const n = document.createElementNS(SVGNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v)));
    return n;
  };
  const clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild); };
  const fmt = (n, d = 2) => {
    if (!Number.isFinite(n)) return '—';
    const s = n.toFixed(d);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  };

  // ── catalog ────────────────────────────────────────────────
  function parseMgFromName(name) {
    const m = String(name || '').match(/(\d+(?:\.\d+)?)\s*MG\b/i);
    if (!m) return '';
    const n = Number(m[1]);
    return Number.isFinite(n) ? String(n) : '';
  }
  const isBacWater = (name) => /^BAC\s*WATER/i.test(String(name || '').trim());

  function fillCompounds(names, preferred) {
    const keep = preferred != null ? preferred : el.compound.value;
    el.compound.innerHTML = '';
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'Custom / other';
    el.compound.appendChild(custom);
    (names || []).forEach((name) => {
      if (!name || isBacWater(name)) return;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      const mg = parseMgFromName(name);
      if (mg) opt.dataset.mg = mg;
      el.compound.appendChild(opt);
    });
    if (keep) {
      const match = [...el.compound.options].find((o) => o.value === keep);
      if (match) el.compound.value = keep;
    }
  }

  async function loadCatalog() {
    fillCompounds(FALLBACK);
    try {
      document.cookie = 'spbc_member=1; path=/; max-age=31536000; SameSite=Lax';
      const res = await fetch('/api/products', {
        credentials: 'same-origin',
        headers: { 'X-SPBC-Member': '1' },
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const names = (Array.isArray(data.products) ? data.products : [])
        .filter((p) => p && p.active !== 0 && p.active !== false)
        .map((p) => p.name)
        .filter(Boolean);
      if (names.length) fillCompounds(names);
    } catch (_) { /* keep fallback */ }
  }

  // ── steps ──────────────────────────────────────────────────
  let stepSeq = 0;

  function addStep(preset) {
    stepSeq += 1;
    const tr = document.createElement('tr');
    tr.className = 'plan-row';
    tr.dataset.step = String(stepSeq);
    tr.innerHTML = `
      <td class="plan-cell-idx"><span class="plan-idx"></span></td>
      <td><input class="field field-sm" data-f="amount" type="number" min="0" step="any"
                 inputmode="decimal" autocomplete="off" aria-label="Amount for this step"></td>
      <td><select class="field field-sm" data-f="unit" aria-label="Unit for this step">
            <option value="mcg">mcg</option><option value="mg">mg</option>
          </select></td>
      <td><input class="field field-sm" data-f="weeks" type="number" min="1" max="52" step="1"
                 inputmode="numeric" autocomplete="off" aria-label="Weeks at this step"></td>
      <td class="plan-out" data-o="units">—</td>
      <td class="plan-out" data-o="vol">—</td>
      <td><button type="button" class="btn-ghost btn-xs" data-act="rm" aria-label="Remove this step">Remove</button></td>`;
    el.rows.appendChild(tr);
    if (preset) {
      // Only ever used to restore a shared link the user themselves created.
      tr.querySelector('[data-f="amount"]').value = preset.amount ?? '';
      tr.querySelector('[data-f="unit"]').value = preset.unit === 'mg' ? 'mg' : 'mcg';
      tr.querySelector('[data-f="weeks"]').value = preset.weeks ?? '';
    }
    recalc();
    return tr;
  }

  el.addStep.addEventListener('click', () => {
    const tr = addStep();
    const input = tr.querySelector('[data-f="amount"]');
    if (input) input.focus();
  });

  el.clearSteps.addEventListener('click', () => {
    clear(el.rows);
    recalc();
  });

  el.rows.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="rm"]');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (tr) tr.remove();
    recalc();
  });
  el.rows.addEventListener('input', recalc);
  el.rows.addEventListener('change', recalc);

  // ── maths ──────────────────────────────────────────────────
  function readSetup() {
    const vial = Number(el.vialMg.value);
    let bac = Number(el.bacMl.value);
    if (Number.isFinite(bac) && bac > BAC_MAX) { bac = BAC_MAX; el.bacMl.value = String(BAC_MAX); }
    const freq = Math.max(1, Math.round(Number(el.freq.value) || 1));
    const concMcgMl = vial > 0 && bac > 0 ? (vial * 1000) / bac : null;
    return { vial, bac, freq, concMcgMl };
  }

  function readSteps() {
    return [...el.rows.querySelectorAll('tr')].map((tr, i) => {
      const amount = Number(tr.querySelector('[data-f="amount"]').value);
      const unit = tr.querySelector('[data-f="unit"]').value === 'mg' ? 'mg' : 'mcg';
      const weeks = Number(tr.querySelector('[data-f="weeks"]').value);
      const mcg = Number.isFinite(amount) && amount > 0 ? (unit === 'mg' ? amount * 1000 : amount) : null;
      return { tr, i, amount, unit, weeks: Number.isFinite(weeks) && weeks > 0 ? weeks : null, mcg };
    });
  }

  function recalc() {
    const { vial, bac, freq, concMcgMl } = readSetup();
    const steps = readSteps();

    el.empty.hidden = steps.length > 0;
    el.conc.textContent = concMcgMl
      ? `Concentration: ${fmt(concMcgMl, 1)} mcg/mL · ${fmt(concMcgMl / 1000, 3)} mg/mL`
      : 'Enter a vial size and BAC volume to see the concentration.';

    let totalMcg = 0;
    let totalDraws = 0;
    let totalWeeks = 0;
    let overCapacity = false;

    steps.forEach((s, idx) => {
      s.tr.querySelector('.plan-idx').textContent = String(idx + 1);
      const unitsCell = s.tr.querySelector('[data-o="units"]');
      const volCell = s.tr.querySelector('[data-o="vol"]');
      if (!concMcgMl || s.mcg == null) {
        unitsCell.textContent = '—';
        volCell.textContent = '—';
      } else {
        const mlPerDose = s.mcg / concMcgMl;
        const units = mlPerDose * MAX_UNITS;
        unitsCell.textContent = `${fmt(units, 1)} u`;
        volCell.textContent = `${fmt(mlPerDose, 3)} mL`;
        unitsCell.classList.toggle('is-over', units > MAX_UNITS);
        if (units > MAX_UNITS) overCapacity = true;
      }
      if (s.mcg != null && s.weeks) {
        const draws = s.weeks * freq;
        totalDraws += draws;
        totalMcg += s.mcg * draws;
        totalWeeks += s.weeks;
      }
    });

    const totalMg = totalMcg / 1000;
    const vialsNeeded = vial > 0 && totalMg > 0 ? Math.ceil(totalMg / vial) : 0;

    // Doses per vial uses the largest step so the figure is conservative, not flattering.
    const biggest = steps.reduce((a, s) => (s.mcg && s.mcg > a ? s.mcg : a), 0);
    const dosesPerVial = biggest > 0 && vial > 0 ? Math.floor((vial * 1000) / biggest) : 0;

    el.outTotalMg.textContent = totalMg > 0 ? `${fmt(totalMg, 2)} mg` : '—';
    el.outDraws.textContent = totalDraws > 0 ? String(totalDraws) : '—';
    el.outDosesPerVial.textContent = dosesPerVial > 0 ? `${dosesPerVial} at the largest step` : '—';
    el.outVials.textContent = vialsNeeded > 0 ? `${vialsNeeded} × ${fmt(vial, 2)} mg` : '—';
    el.outWeeks.textContent = totalWeeks > 0 ? `${totalWeeks} week${totalWeeks === 1 ? '' : 's'}` : '—';
    el.outVialLasts.textContent = dosesPerVial > 0 && freq > 0
      ? `${fmt(dosesPerVial / freq, 1)} week${dosesPerVial / freq === 1 ? '' : 's'} at ${freq}/week`
      : '—';

    const notes = [];
    if (overCapacity) notes.push('One step needs more than 100 units — a single U-100 syringe will not hold it. More BAC water or a stronger vial would change that.');
    if (bac > 0 && bac > BAC_MAX) notes.push(`BAC capped at ${BAC_MAX} mL.`);
    if (vialsNeeded > 0 && vialsNeeded < 3) notes.push('Single vials have a 3-vial minimum on the price list.');
    if (vialsNeeded >= 6) notes.push('At this quantity a 10-pack kit is usually the cheaper route.');
    el.buyNote.textContent = notes.join(' ');

    el.addToCart.disabled = vialsNeeded <= 0;
    el.addKit.disabled = vialsNeeded <= 0;
    el.addToCart.dataset.vials = String(vialsNeeded);
    el.addToCart.textContent = vialsNeeded > 0
      ? `Add ${Math.min(vialsNeeded, VIAL_MAX)} vial${Math.min(vialsNeeded, VIAL_MAX) === 1 ? '' : 's'} to cart`
      : 'Add vials to cart';

    syncStepPick(steps);
    drawChart(steps);
    drawSyringe(steps, concMcgMl);
    drawTimeline(steps, dosesPerVial, freq);
  }

  // ── graphics ───────────────────────────────────────────────
  const GOLD = '#EAB308';
  const GREEN = '#16A34A';
  const INK = '#A8B8AC';

  function emptyState(svg, msg) {
    clear(svg);
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    const t = mk('text', { x: vb[2] / 2, y: vb[3] / 2, 'text-anchor': 'middle', fill: INK, 'font-size': 14 });
    t.textContent = msg;
    svg.appendChild(t);
  }

  function drawChart(steps) {
    const usable = steps.filter((s) => s.mcg != null && s.weeks);
    if (!usable.length) return emptyState(el.chart, 'Add a step with an amount and weeks');
    clear(el.chart);
    const W = 720, H = 240, padL = 54, padR = 16, padT = 18, padB = 40;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxVal = Math.max(...usable.map((s) => s.amount));
    const totalWeeks = usable.reduce((a, s) => a + s.weeks, 0);

    // axes
    el.chart.appendChild(mk('line', { x1: padL, y1: padT, x2: padL, y2: padT + plotH, stroke: 'rgba(168,184,172,0.45)', 'stroke-width': 1 }));
    el.chart.appendChild(mk('line', { x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, stroke: 'rgba(168,184,172,0.45)', 'stroke-width': 1 }));
    [0, 0.5, 1].forEach((f) => {
      const y = padT + plotH - f * plotH;
      const lbl = mk('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', fill: INK, 'font-size': 11 });
      lbl.textContent = fmt(maxVal * f, 1);
      el.chart.appendChild(lbl);
      if (f > 0) el.chart.appendChild(mk('line', { x1: padL, y1: y, x2: padL + plotW, y2: y, stroke: 'rgba(168,184,172,0.15)', 'stroke-width': 1 }));
    });

    // step blocks, width proportional to weeks
    let wAcc = 0;
    usable.forEach((s, i) => {
      const x = padL + (wAcc / totalWeeks) * plotW;
      const w = (s.weeks / totalWeeks) * plotW;
      const h = maxVal > 0 ? (s.amount / maxVal) * plotH : 0;
      const y = padT + plotH - h;
      el.chart.appendChild(mk('rect', {
        x: x + 1, y, width: Math.max(2, w - 2), height: h, rx: 3,
        fill: i % 2 ? 'rgba(234,179,8,0.75)' : 'rgba(22,163,74,0.75)',
        stroke: i % 2 ? GOLD : GREEN, 'stroke-width': 1,
      }));
      const v = mk('text', { x: x + w / 2, y: y - 5, 'text-anchor': 'middle', fill: '#F2F7F3', 'font-size': 11, 'font-weight': 700 });
      v.textContent = `${fmt(s.amount, 2)}${s.unit}`;
      el.chart.appendChild(v);
      const lab = mk('text', { x: x + w / 2, y: padT + plotH + 16, 'text-anchor': 'middle', fill: INK, 'font-size': 11 });
      lab.textContent = `${i + 1}`;
      el.chart.appendChild(lab);
      const wk = mk('text', { x: x + w / 2, y: padT + plotH + 30, 'text-anchor': 'middle', fill: INK, 'font-size': 10 });
      wk.textContent = `${s.weeks}w`;
      el.chart.appendChild(wk);
      wAcc += s.weeks;
    });
  }

  function syncStepPick(steps) {
    const prev = el.stepPick.value;
    el.stepPick.innerHTML = '';
    steps.forEach((s, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `Step ${i + 1}${s.amount ? ` · ${fmt(s.amount, 2)}${s.unit}` : ''}`;
      el.stepPick.appendChild(o);
    });
    if (prev && el.stepPick.options[Number(prev)]) el.stepPick.value = prev;
    el.stepPick.disabled = steps.length === 0;
  }
  el.stepPick.addEventListener('change', recalc);

  function drawSyringe(steps, concMcgMl) {
    const idx = Number(el.stepPick.value);
    const s = steps[Number.isFinite(idx) ? idx : 0];
    if (!s || s.mcg == null || !concMcgMl) return emptyState(el.syringe, 'Enter an amount to see the draw');
    clear(el.syringe);
    const units = Math.min((s.mcg / concMcgMl) * MAX_UNITS, MAX_UNITS);
    const X = 40, Y = 34, W = 620, H = 40;
    el.syringe.appendChild(mk('rect', { x: X, y: Y, width: W, height: H, rx: 6, fill: 'rgba(19,28,22,0.9)', stroke: 'rgba(168,184,172,0.5)', 'stroke-width': 1.5 }));
    el.syringe.appendChild(mk('rect', { x: X, y: Y, width: (units / MAX_UNITS) * W, height: H, rx: 6, fill: 'rgba(234,179,8,0.65)' }));
    for (let u = 0; u <= MAX_UNITS; u += 5) {
      const x = X + (u / MAX_UNITS) * W;
      const major = u % 10 === 0;
      el.syringe.appendChild(mk('line', { x1: x, y1: Y, x2: x, y2: Y + (major ? 12 : 7), stroke: 'rgba(242,247,243,0.65)', 'stroke-width': major ? 1.4 : 0.8 }));
      if (major) {
        const t = mk('text', { x, y: Y - 6, 'text-anchor': 'middle', fill: INK, 'font-size': 10 });
        t.textContent = String(u);
        el.syringe.appendChild(t);
      }
    }
    const label = mk('text', { x: X, y: Y + H + 22, fill: '#F2F7F3', 'font-size': 13, 'font-weight': 700 });
    label.textContent = `Draw to ${fmt(units, 1)} units`;
    el.syringe.appendChild(label);
  }

  function drawTimeline(steps, dosesPerVial, freq) {
    const usable = steps.filter((s) => s.mcg != null && s.weeks);
    if (!usable.length || !dosesPerVial) return emptyState(el.timeline, 'Add steps to see vial use');
    clear(el.timeline);
    const W = 720, padL = 20, padR = 20, y = 46, h = 26;
    const plotW = W - padL - padR;
    const totalWeeks = usable.reduce((a, s) => a + s.weeks, 0);
    el.timeline.appendChild(mk('rect', { x: padL, y, width: plotW, height: h, rx: 5, fill: 'rgba(19,28,22,0.9)', stroke: 'rgba(168,184,172,0.4)' }));
    // vial boundaries: a vial covers dosesPerVial draws => dosesPerVial/freq weeks
    const weeksPerVial = dosesPerVial / freq;
    let wk = weeksPerVial;
    let n = 1;
    while (wk < totalWeeks && n < 60) {
      const x = padL + (wk / totalWeeks) * plotW;
      el.timeline.appendChild(mk('line', { x1: x, y1: y - 6, x2: x, y2: y + h + 6, stroke: GOLD, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      const t = mk('text', { x, y: y - 10, 'text-anchor': 'middle', fill: GOLD, 'font-size': 10, 'font-weight': 700 });
      t.textContent = `vial ${n + 1}`;
      el.timeline.appendChild(t);
      wk += weeksPerVial;
      n += 1;
    }
    const v1 = mk('text', { x: padL, y: y + h + 20, fill: INK, 'font-size': 11 });
    v1.textContent = `Week 1`;
    el.timeline.appendChild(v1);
    const v2 = mk('text', { x: padL + plotW, y: y + h + 20, 'text-anchor': 'end', fill: INK, 'font-size': 11 });
    v2.textContent = `Week ${totalWeeks}`;
    el.timeline.appendChild(v2);
    const note = mk('text', { x: padL, y: 22, fill: '#F2F7F3', 'font-size': 12, 'font-weight': 700 });
    note.textContent = `About ${fmt(weeksPerVial, 1)} weeks per vial at ${freq}/week`;
    el.timeline.appendChild(note);
  }

  // ── cart ───────────────────────────────────────────────────
  function readCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' ? data : {};
    } catch (_) { return {}; }
  }

  /** Merge, never overwrite — the price list restores whatever is here. */
  function addToCart(name, kind, qty) {
    const cart = readCart();
    const cur = cart[name] || { vial: 0, pack: 0 };
    if (kind === 'vial') {
      cur.vial = Math.min(VIAL_MAX, (Number(cur.vial) || 0) + qty);
    } else {
      const next = (Number(cur.pack) || 0) + qty;
      cur.pack = KIT_STEPS.reduce((best, s) => (s <= next && s > best ? s : best), 0) || KIT_STEPS[0];
    }
    cart[name] = cur;
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (_) { return false; }
    return true;
  }

  function currentCompound() {
    const name = el.compound.value;
    if (name) return name;
    el.cartMsg.textContent = 'Pick a compound from the list first — a custom vial size has nothing to add to the cart.';
    return null;
  }

  el.addToCart.addEventListener('click', () => {
    const name = currentCompound();
    if (!name) return;
    const want = Number(el.addToCart.dataset.vials) || 0;
    const qty = Math.min(want, VIAL_MAX);
    if (!qty) return;
    if (!addToCart(name, 'vial', qty)) {
      el.cartMsg.textContent = 'Could not save to the cart in this browser.';
      return;
    }
    const capped = want > VIAL_MAX ? ` (capped at ${VIAL_MAX}; a kit covers more)` : '';
    el.cartMsg.textContent = `Added ${qty} × ${name}${capped}. Taking you to the price list…`;
    window.setTimeout(() => { window.location.href = '/#prices'; }, 900);
  });

  el.addKit.addEventListener('click', () => {
    const name = currentCompound();
    if (!name) return;
    if (!addToCart(name, 'pack', 1)) {
      el.cartMsg.textContent = 'Could not save to the cart in this browser.';
      return;
    }
    el.cartMsg.textContent = `Added a 10-pack kit of ${name}. Taking you to the price list…`;
    window.setTimeout(() => { window.location.href = '/#prices'; }, 900);
  });

  // ── share link (round-trips the user's own numbers) ────────
  function buildShare() {
    const p = new URLSearchParams();
    if (el.compound.value) p.set('c', el.compound.value);
    if (el.vialMg.value) p.set('mg', el.vialMg.value);
    if (el.bacMl.value) p.set('bac', el.bacMl.value);
    if (el.freq.value) p.set('f', el.freq.value);
    const steps = readSteps()
      .filter((s) => s.amount || s.weeks)
      .map((s) => `${s.amount || ''}${s.unit === 'mg' ? 'mg' : 'mcg'}x${s.weeks || ''}`);
    if (steps.length) p.set('s', steps.join(','));
    return `${location.origin}${location.pathname}?${p.toString()}`;
  }

  function applyShare() {
    const p = new URLSearchParams(location.search);
    if (!p.toString()) return;
    if (p.has('mg')) el.vialMg.value = p.get('mg');
    if (p.has('bac')) el.bacMl.value = p.get('bac');
    if (p.has('f')) el.freq.value = p.get('f');
    const c = p.get('c');
    if (c) {
      const match = [...el.compound.options].find((o) => o.value === c);
      if (match) el.compound.value = c;
    }
    const s = p.get('s');
    if (s) {
      clear(el.rows);
      s.split(',').forEach((tok) => {
        const m = tok.match(/^([\d.]*)(mcg|mg)x(\d*)$/i);
        if (!m) return;
        addStep({ amount: m[1], unit: m[2].toLowerCase(), weeks: m[3] });
      });
    }
  }

  el.share.addEventListener('click', async () => {
    const url = buildShare();
    try {
      await navigator.clipboard.writeText(url);
      el.cartMsg.textContent = 'Link copied — it carries your numbers, nothing else.';
    } catch (_) {
      el.cartMsg.textContent = url;
    }
  });

  // ── boot ───────────────────────────────────────────────────
  [el.compound, el.vialMg, el.bacMl, el.freq].forEach((n) => {
    n.addEventListener('input', recalc);
    n.addEventListener('change', recalc);
  });
  el.compound.addEventListener('change', () => {
    const opt = el.compound.selectedOptions[0];
    const mg = opt && opt.dataset ? opt.dataset.mg : '';
    if (mg) el.vialMg.value = mg;
    recalc();
  });

  loadCatalog().then(() => {
    applyShare();
    if (!el.rows.children.length) addStep();
    recalc();
  });
})();
