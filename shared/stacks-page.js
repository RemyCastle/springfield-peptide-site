
    (function () {
      const CART_KEY = 'spbc_cart_draft';
      const VIAL_MAX = 10;
      const KIT_ALLOWED = new Set([0, 1, 2, 3, 5]);
      const BAC_NAME = window.SPBC_STACKS_BAC_PRODUCT || 'BAC WATER 3ML';

      /** @type {Record<string, {vial_price:number, pack_price:number, name:string}>} */
      let catalogByName = {};
      let catalogLoaded = false;

      function money(n) {
        const num = Number(n);
        if (!Number.isFinite(num)) return '—';
        const rounded = Math.round(num);
        if (Math.abs(num - rounded) < 1e-9) return '$' + String(rounded);
        return '$' + num.toFixed(2);
      }

      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function clampVial(n) {
        const v = Math.max(0, Math.min(VIAL_MAX, Math.round(Number(n) || 0)));
        return v;
      }

      function clampKit(n) {
        const v = Math.round(Number(n) || 0);
        if (KIT_ALLOWED.has(v)) return v;
        // snap down to nearest allowed
        const allowed = [0, 1, 2, 3, 5];
        let best = 0;
        for (const a of allowed) {
          if (a <= v) best = a;
        }
        return best;
      }

      function loadCart() {
        try {
          const raw = localStorage.getItem(CART_KEY);
          if (!raw) return {};
          const data = JSON.parse(raw);
          return data && typeof data === 'object' ? data : {};
        } catch (_) {
          return {};
        }
      }

      function saveCart(draft) {
        try {
          if (draft && Object.keys(draft).length) {
            localStorage.setItem(CART_KEY, JSON.stringify(draft));
          } else {
            localStorage.removeItem(CART_KEY);
          }
        } catch (_) { /* quota */ }
      }

      /**
       * Merge stack lines into existing cart (ADD quantities; never wipe).
       * @param {{product:string, vials:number}[]} lines
       */
      function mergeIntoCart(lines) {
        const draft = loadCart();
        for (const line of lines) {
          if (!line || !line.product) continue;
          if (!catalogByName[line.product]) continue; // never add nonexistent names
          const addVial = clampVial(line.vials);
          if (addVial <= 0) continue;
          const prev = draft[line.product] || { vial: 0, pack: 0 };
          draft[line.product] = {
            vial: clampVial((Number(prev.vial) || 0) + addVial),
            pack: clampKit(prev.pack || 0),
          };
        }
        // drop zero lines
        Object.keys(draft).forEach((k) => {
          const e = draft[k];
          if (!e || ((Number(e.vial) || 0) <= 0 && (Number(e.pack) || 0) <= 0)) delete draft[k];
        });
        saveCart(draft);
        return draft;
      }

      function stackVialCount(stack) {
        return (stack.items || []).reduce((sum, it) => {
          if (!catalogByName[it.product]) return sum;
          return sum + clampVial(it.vials);
        }, 0);
      }

      function stackAvailable(stack) {
        const items = stack.items || [];
        if (!items.length) return false;
        return items.every((it) => !!catalogByName[it.product]);
      }

      function stackMissing(stack) {
        return (stack.items || []).filter((it) => !catalogByName[it.product]).map((it) => it.product);
      }

      function computeTotal(stack, includeBac) {
        let total = 0;
        let known = true;
        for (const it of stack.items || []) {
          const p = catalogByName[it.product];
          if (!p) {
            known = false;
            continue;
          }
          total += (Number(p.vial_price) || 0) * clampVial(it.vials);
        }
        if (includeBac) {
          const bac = catalogByName[BAC_NAME];
          const bacQty = clampVial(stackVialCount(stack));
          if (bac && bacQty > 0) {
            total += (Number(bac.vial_price) || 0) * bacQty;
          } else if (bacQty > 0 && !bac) {
            known = false;
          }
        }
        return { total, known };
      }

      function renderStacks() {
        const grid = document.getElementById('stacksGrid');
        const status = document.getElementById('stacksStatus');
        const stacks = Array.isArray(window.SPBC_STACKS) ? window.SPBC_STACKS : [];
        if (!stacks.length) {
          status.textContent = 'No stacks configured.';
          grid.innerHTML = '';
          return;
        }
        if (catalogLoaded) {
          status.textContent = 'Prices from the live catalog. Add a stack to merge into your cart, then review on the price list.';
        }

        grid.innerHTML = stacks.map((stack) => {
          const available = catalogLoaded ? stackAvailable(stack) : true;
          const missing = catalogLoaded ? stackMissing(stack) : [];
          const bacDefault = true;
          const { total, known } = computeTotal(stack, bacDefault);
          const vialCount = stackVialCount(stack);
          const bacP = catalogByName[BAC_NAME];
          const bacLinePrice = bacP ? (Number(bacP.vial_price) || 0) * clampVial(vialCount) : null;

          const itemsHtml = (stack.items || []).map((it) => {
            const p = catalogByName[it.product];
            const miss = catalogLoaded && !p;
            const line = p ? (Number(p.vial_price) || 0) * clampVial(it.vials) : null;
            return `<div class="stack-item-row${miss ? ' opacity-60' : ''}">
              <div>
                <p class="text-sm font-semibold text-white">${escapeHtml(it.product)} <span class="text-zinc-400 font-normal">×${clampVial(it.vials)} vial${clampVial(it.vials) === 1 ? '' : 's'}</span>
                  ${miss ? '<span class="ml-1 text-amber-400 text-xs font-bold">currently unavailable</span>' : ''}
                </p>
                <p class="text-[11px] text-zinc-500 mt-0.5 leading-snug">${escapeHtml(it.refRange || '')}</p>
              </div>
              <div class="text-right text-sm text-zinc-300 whitespace-nowrap">${miss ? '—' : money(line)}</div>
            </div>`;
          }).join('');

          const bacRow = `<div class="stack-item-row bac-price-row" data-stack-bac-row="${escapeHtml(stack.id)}">
            <div>
              <p class="text-sm font-semibold text-white">${escapeHtml(BAC_NAME)} <span class="text-zinc-400 font-normal bac-qty">×${clampVial(vialCount)} vial${clampVial(vialCount) === 1 ? '' : 's'}</span>
                ${catalogLoaded && !bacP ? '<span class="ml-1 text-amber-400 text-xs font-bold">currently unavailable</span>' : ''}
              </p>
              <p class="text-[11px] text-zinc-500 mt-0.5">1 × 3 mL per stack vial (research reconstitution)</p>
            </div>
            <div class="text-right text-sm text-zinc-300 whitespace-nowrap bac-line-price">${bacLinePrice == null ? '—' : money(bacLinePrice)}</div>
          </div>`;

          // No .reveal on dynamic cards — they are injected after IO bind and would
          // stay opacity:0 under html.spbc-anim. Content must never depend on animation.
          return `<article class="stack-card depth-card${available ? '' : ' is-unavailable'}" data-stack-id="${escapeHtml(stack.id)}" data-stack-card>
            <div class="flex flex-wrap items-start justify-between gap-2 mb-2">
              <div>
                <h2 class="ducks-font text-2xl text-white leading-tight">${escapeHtml(stack.name)}</h2>
                <span class="stack-cat mt-2">${escapeHtml(stack.category)}</span>
              </div>
              ${available ? '' : '<span class="text-xs font-bold uppercase tracking-wide text-amber-400">Currently unavailable</span>'}
            </div>
            <p class="text-xs text-zinc-500 mb-3">Typical research duration: ${escapeHtml(stack.duration)}</p>
            <div class="mb-3">
              ${itemsHtml}
              ${bacRow}
            </div>
            <label class="bac-check mb-3 text-sm text-zinc-300">
              <input type="checkbox" class="bac-toggle" data-stack-id="${escapeHtml(stack.id)}" ${bacDefault ? 'checked' : ''} ${available ? '' : 'disabled'}>
              <span>Add bacteriostatic water <span class="text-zinc-500">(${escapeHtml(BAC_NAME)} — 1 per vial)</span></span>
            </label>
            <div class="flex items-end justify-between gap-3 mb-3">
              <div>
                <p class="text-[11px] uppercase tracking-wide text-zinc-500 font-semibold">Stack total</p>
                <p class="stack-total" data-stack-total="${escapeHtml(stack.id)}">${known ? money(total) : '—'}</p>
              </div>
              <p class="text-[10px] text-zinc-600 text-right max-w-[12rem] leading-snug">Research use only · not for human consumption</p>
            </div>
            <button type="button" class="btn-add-stack" data-add-stack="${escapeHtml(stack.id)}" ${available ? '' : 'disabled'}>
              ${available ? 'Add stack to cart' : 'Unavailable'}
            </button>
            ${missing.length ? `<p class="text-[11px] text-amber-400/90 mt-2">Missing from catalog: ${escapeHtml(missing.join(', '))}</p>` : ''}
            <p class="text-[10px] text-zinc-600 mt-3 leading-relaxed">
              Reference ranges are commonly cited research figures only — not medical, therapeutic, or disease-related claims.
            </p>
          </article>`;
        }).join('');

        // Wire events
        grid.querySelectorAll('.bac-toggle').forEach((cb) => {
          cb.addEventListener('change', () => updateCardTotals(cb.getAttribute('data-stack-id')));
        });
        grid.querySelectorAll('[data-add-stack]').forEach((btn) => {
          btn.addEventListener('click', () => onAddStack(btn.getAttribute('data-add-stack')));
        });
      }

      function updateCardTotals(stackId) {
        const stack = (window.SPBC_STACKS || []).find((s) => s.id === stackId);
        if (!stack) return;
        const card = document.querySelector(`[data-stack-card][data-stack-id="${stackId}"]`);
        if (!card) return;
        const includeBac = !!card.querySelector('.bac-toggle')?.checked;
        const bacRow = card.querySelector('[data-stack-bac-row]');
        if (bacRow) bacRow.style.display = includeBac ? '' : 'none';
        const { total, known } = computeTotal(stack, includeBac);
        const el = card.querySelector(`[data-stack-total="${stackId}"]`);
        if (el) el.textContent = known ? money(total) : '—';
      }

      function onAddStack(stackId) {
        const stack = (window.SPBC_STACKS || []).find((s) => s.id === stackId);
        if (!stack) return;
        if (!stackAvailable(stack)) {
          alert('This stack has products that are currently unavailable.');
          return;
        }
        const card = document.querySelector(`[data-stack-card][data-stack-id="${stackId}"]`);
        const includeBac = !!card?.querySelector('.bac-toggle')?.checked;
        const lines = (stack.items || [])
          .filter((it) => catalogByName[it.product])
          .map((it) => ({ product: it.product, vials: clampVial(it.vials) }));
        if (includeBac) {
          const bacQty = clampVial(stackVialCount(stack));
          if (bacQty > 0 && catalogByName[BAC_NAME]) {
            lines.push({ product: BAC_NAME, vials: bacQty });
          }
        }
        if (!lines.length) {
          alert('No available products to add.');
          return;
        }
        const { total } = computeTotal(stack, includeBac);
        const summary = lines.map((l) => `${l.product} ×${l.vials}`).join('\n');
        const ok = window.confirm(
          `Add this research stack to your cart?\n\n${stack.name}\n${summary}\n\nApprox. total: ${money(total)}\n\n(Existing cart quantities are kept and increased — nothing is wiped.)`
        );
        if (!ok) return;
        mergeIntoCart(lines);
        window.location.href = '/#prices';
      }

      async function loadCatalog() {
        try {
          // Cookie before fetch so age-gate (defer) race never causes a second request.
          document.cookie = 'spbc_member=1; path=/; max-age=31536000; SameSite=Lax';
          const res = await fetch('/api/products', {
            credentials: 'same-origin',
            headers: { 'X-SPBC-Member': '1' },
          });
          if (!res.ok) throw new Error('catalog ' + res.status);
          const data = await res.json();
          const products = Array.isArray(data.products) ? data.products : [];
          catalogByName = {};
          products.forEach((p) => {
            if (!p || !p.name) return;
            if (p.active === 0 || p.active === false) return;
            catalogByName[p.name] = p;
          });
          catalogLoaded = true;
        } catch (e) {
          catalogLoaded = false;
          const status = document.getElementById('stacksStatus');
          if (status) {
            status.textContent = 'Could not load live prices — complete the 21+ gate and refresh. Stacks still list compositions.';
          }
        }
        renderStacks();
        // hide/show bac rows for default checked state
        (window.SPBC_STACKS || []).forEach((s) => updateCardTotals(s.id));
      }

      renderStacks();
      loadCatalog();
    })();
  
