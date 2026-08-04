const MAX_BAC_ML = 3;
    const BARREL_X = 104;
    const BARREL_W = 252;
    const MAX_UNITS_SCALE = 100;

    const peptideName = document.getElementById('peptideName');
    const vialMg = document.getElementById('vialMg');
    const bacMl = document.getElementById('bacMl');
    const doseValue = document.getElementById('doseValue');
    const doseUnit = document.getElementById('doseUnit');
    const results = document.getElementById('results');
    const syringeFill = document.getElementById('syringeFill');
    const doseMarker = document.getElementById('doseMarker');
    const syringeLabel = document.getElementById('syringeLabel');
    const syringeSub = document.getElementById('syringeSub');

    /** Fallback = current catalog (non-BAC). Used when fetch fails / 401 so the dropdown never ships empty. */
    const FALLBACK_PEPTIDES = [
      'SEMA 5MG', 'SEMA 10MG', 'CAGRI  5MG', 'CAGRI 10MG',
      'TIRZ 10MG', 'TIRZ 30MG', 'TIRZ 60MG',
      'RETA 10MG', 'RETA 30MG', 'RETA 60 MG',
      'GHK-CU 50MG', 'GHK-cu 100MG', 'KPV 10 MG',
      'NAD+ 500MG', 'NAD+ 1000MG', '5-AMINO-1MQ 50MG',
      'MOTS-C 10MG', 'MOTS-C 40MG', 'SS-31 10MG',
      'BPC-157 10MG', 'TB-500 10MG', 'KLOW 80MG',
      'IPA 10MG', 'CJC/IPA NO DAC 10MG', 'Tesamorelin',
      'PT-141 10 MG', 'MT1', 'MT2',
      'GLUTATHIONE 1200MG', 'DSIP 10MG',
    ];

    /** Parse vial mg from product name: "RETA 30MG"→30, "NAD+ 1000MG"→1000, "CAGRI  5MG"→5. Empty when no mg (MT1, Tesamorelin). */
    function parseMgFromName(name) {
      const m = String(name || '').match(/(\d+(?:\.\d+)?)\s*MG\b/i);
      if (!m) return '';
      const n = Number(m[1]);
      return Number.isFinite(n) ? String(n) : '';
    }

    function isBacWater(name) {
      return /^BAC\s*WATER/i.test(String(name || '').trim());
    }

    function fillPeptideOptions(names, preferredValue) {
      const keep = preferredValue != null ? preferredValue : peptideName.value;
      peptideName.innerHTML = '';
      const custom = document.createElement('option');
      custom.value = '';
      custom.textContent = 'Custom / other';
      peptideName.appendChild(custom);
      (names || []).forEach((name) => {
        if (!name || isBacWater(name)) return;
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        const mg = parseMgFromName(name);
        if (mg) opt.dataset.mg = mg;
        peptideName.appendChild(opt);
      });
      if (keep) {
        const match = [...peptideName.options].find((o) => o.value === keep);
        if (match) peptideName.value = keep;
      }
    }

    async function loadPeptideCatalog() {
      fillPeptideOptions(FALLBACK_PEPTIDES);
      try {
        // Cookie before fetch so age-gate (defer) race never causes a second request.
        document.cookie = 'spbc_member=1; path=/; max-age=31536000; SameSite=Lax';
        const res = await fetch('/api/products', {
          credentials: 'same-origin',
          headers: { 'X-SPBC-Member': '1' },
        });
        if (!res.ok) return; // keep fallback
        const data = await res.json().catch(() => ({}));
        const products = Array.isArray(data.products) ? data.products : [];
        const names = products
          .filter((p) => p && p.active !== 0 && p.active !== false)
          .map((p) => p.name)
          .filter(Boolean);
        if (names.length) fillPeptideOptions(names);
      } catch (_) {
        /* keep fallback */
      }
    }

    (function buildTicks() {
      const g = document.getElementById('tickMarks');
      for (let u = 0; u <= 100; u += 5) {
        const x = BARREL_X + (u / MAX_UNITS_SCALE) * BARREL_W;
        const major = u % 10 === 0;
        const y1 = major ? 38 : 42;
        const y2 = major ? 68 : 64;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x);
        line.setAttribute('x2', x);
        line.setAttribute('y1', y1);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', major ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.15)');
        line.setAttribute('stroke-width', major ? '1.2' : '0.8');
        g.appendChild(line);
        if (major && u > 0 && u < 100) {
          const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          t.setAttribute('x', x);
          t.setAttribute('y', 32);
          t.setAttribute('text-anchor', 'middle');
          t.setAttribute('class', 'tick-label');
          t.textContent = String(u);
          g.appendChild(t);
        }
      }
    })();

    peptideName.addEventListener('change', () => {
      const opt = peptideName.selectedOptions[0];
      const mg = opt && opt.dataset.mg ? Number(opt.dataset.mg) : null;
      if (mg != null && Number.isFinite(mg)) vialMg.value = String(mg);
      calculate();
    });

    function clampBac() {
      let v = Number(bacMl.value);
      if (!Number.isFinite(v)) return;
      if (v > MAX_BAC_ML) {
        bacMl.value = String(MAX_BAC_ML);
      }
    }

    function fmt(n, digits = 2) {
      if (!Number.isFinite(n)) return '—';
      const f = Number(n.toFixed(digits));
      return Number.isInteger(f) ? String(f) : String(f);
    }

    function updateSyringe(units) {
      const safe = Number.isFinite(units) ? Math.max(0, units) : 0;
      const displayUnits = Math.min(safe, MAX_UNITS_SCALE);
      const over = safe > MAX_UNITS_SCALE;

      const fillWidth = Math.max(0, Math.min(BARREL_W, (displayUnits / MAX_UNITS_SCALE) * BARREL_W));
      syringeFill.setAttribute('x', String(BARREL_X));
      syringeFill.setAttribute('width', String(fillWidth));

      const markerX = BARREL_X + fillWidth;
      doseMarker.setAttribute('points', `${markerX},78 ${markerX + 6},88 ${markerX - 6},88`);

      const label = over
        ? `${fmt(safe, 1)} u (over 100)`
        : `${fmt(safe, 1)} units`;
      syringeLabel.textContent = label;
      syringeLabel.className = over
        ? 'text-sm font-bold text-amber-400'
        : 'text-sm font-bold text-[#EAB308]';

      if (!Number.isFinite(units) || units <= 0) {
        syringeSub.textContent = 'Enter values to see draw volume';
      } else if (over) {
        syringeSub.textContent = `Draw is ${fmt(safe, 1)} units (${fmt(safe / 100, 3)} mL) — exceeds 1 mL barrel. Reduce dose or BAC water.`;
      } else {
        syringeSub.textContent = `Draw to ${fmt(safe, 1)} units  ·  ${fmt(safe / 100, 3)} mL on the barrel`;
      }

      const desc = document.getElementById('syringe-desc');
      if (desc) {
        desc.textContent = Number.isFinite(units) && units > 0
          ? `Syringe shows ${fmt(safe, 1)} units of ${fmt(safe / 100, 3)} milliliters.`
          : 'Visual of a U-100 syringe barrel. Enter values to see fill level.';
      }
    }

    function calculate() {
      clampBac();
      const vial = Number(vialMg.value);
      let bac = Number(bacMl.value);
      let dose = Number(doseValue.value);

      if (Number.isFinite(bac) && bac > MAX_BAC_ML) {
        bac = MAX_BAC_ML;
        bacMl.value = String(MAX_BAC_ML);
      }

      if (!Number.isFinite(vial) || vial <= 0 || !Number.isFinite(bac) || bac <= 0 || !Number.isFinite(dose) || dose <= 0) {
        results.classList.add('hidden');
        updateSyringe(0);
        return;
      }
      if (doseUnit.value === 'mg') dose = dose * 1000;

      const concMcgPerMl = (vial * 1000) / bac;
      const volMl = dose / concMcgPerMl;
      const units = volMl * 100;
      const dosesPerVial = (vial * 1000) / dose;
      const doseMg = dose / 1000;

      const flash = (id, text) => {
        const el = document.getElementById(id);
        el.textContent = text;
        el.classList.remove('num-flash');
        void el.offsetWidth;
        el.classList.add('num-flash');
      };
      flash('outConc', `${fmt(concMcgPerMl, 1)} mcg/mL  ·  ${fmt(concMcgPerMl / 1000, 3)} mg/mL`);
      flash('outUnits', `${fmt(units, 1)} units`);
      flash('outVol', `${fmt(volMl, 3)} mL`);
      flash('outDoses', fmt(dosesPerVial, 1));
      flash('outDoseMg', `${fmt(doseMg, 3)} mg (${fmt(dose, 1)} mcg)`);

      updateSyringe(units);

      const warn = document.getElementById('outWarn');
      const msgs = [];
      if (bac >= MAX_BAC_ML) {
        msgs.push(`BAC water is at the ${MAX_BAC_ML} mL maximum.`);
      }
      if (units > 100) {
        msgs.push('Draw exceeds 100 units (1 mL). Use a lower dose, less BAC water (more concentrated), or multiple draws.');
      } else if (units > 50) {
        msgs.push('Draw is over 50 units — consider less BAC water for a smaller syringe volume.');
      }
      if (msgs.length) {
        warn.textContent = msgs.join(' ');
        warn.classList.remove('hidden');
      } else {
        warn.classList.add('hidden');
      }

      results.classList.remove('hidden');
    }

    function buildShareParams() {
      const params = new URLSearchParams();
      const peptide = peptideName.value;
      if (peptide) params.set('p', peptide);
      params.set('mg', vialMg.value);
      params.set('bac', bacMl.value);
      params.set('dose', doseValue.value);
      params.set('unit', doseUnit.value);
      return params;
    }

    function applyShareParams() {
      const params = new URLSearchParams(window.location.search);
      if (![...params.keys()].length) return false;
      const p = params.get('p');
      if (p) {
        const match = [...peptideName.options].find(o => o.value === p);
        if (match) peptideName.value = p;
      }
      if (params.has('mg')) vialMg.value = params.get('mg');
      if (params.has('bac')) bacMl.value = params.get('bac');
      if (params.has('dose')) doseValue.value = params.get('dose');
      if (params.has('unit') && (params.get('unit') === 'mg' || params.get('unit') === 'mcg')) {
        doseUnit.value = params.get('unit');
      }
      return true;
    }

    function flashShare(msg) {
      const el = document.getElementById('shareStatus');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 2200);
    }

    async function copyText(text, okMsg) {
      try {
        await navigator.clipboard.writeText(text);
        flashShare(okMsg);
      } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        flashShare(okMsg);
      }
    }

    document.getElementById('copyCalcLinkBtn').addEventListener('click', () => {
      const url = `${window.location.origin}${window.location.pathname}?${buildShareParams().toString()}`;
      copyText(url, 'Copied ✓');
      const btn = document.getElementById('copyCalcLinkBtn');
      const prev = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = prev; }, 1500);
      try {
        history.replaceState(null, '', `?${buildShareParams().toString()}`);
      } catch (_) {}
    });

    document.getElementById('copyResultsBtn').addEventListener('click', () => {
      const peptide = peptideName.value || 'Custom peptide';
      const text = [
        `SPBC Dosage Calculator`,
        `Peptide: ${peptide}`,
        `Vial: ${vialMg.value} mg · BAC: ${bacMl.value} mL`,
        `Dose: ${doseValue.value} ${doseUnit.value}`,
        `Concentration: ${document.getElementById('outConc').textContent}`,
        `Draw: ${document.getElementById('outUnits').textContent}`,
        `Volume: ${document.getElementById('outVol').textContent}`,
        `Doses/vial: ${document.getElementById('outDoses').textContent}`,
        `Research planning only — not medical advice.`,
      ].join('\n');
      copyText(text, 'Copied ✓');
      const btn = document.getElementById('copyResultsBtn');
      const prev = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = prev; }, 1500);
    });

    document.getElementById('calcBtn').addEventListener('click', calculate);
    [vialMg, bacMl, doseValue, doseUnit].forEach((el) => {
      el.addEventListener('input', calculate);
      el.addEventListener('change', calculate);
    });
    bacMl.addEventListener('blur', () => {
      clampBac();
      if (Number(bacMl.value) > MAX_BAC_ML) bacMl.value = String(MAX_BAC_ML);
      if (Number(bacMl.value) < 0.1) bacMl.value = '0.1';
      calculate();
    });
    // Populate peptide list (fallback immediately, then live catalog), preserve ?p= share links.
    (async function initPeptideSelect() {
      await loadPeptideCatalog();
      applyShareParams();
      calculate();
    })();
