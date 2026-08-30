
    (function () {
      const CART_KEY = 'spbc_cart_draft';
      const VIAL_MAX = 10;
      const KIT_ALLOWED = new Set([0, 1, 2, 3, 5]);
      const BAC_PREFERRED = window.SPBC_STACKS_BAC_PRODUCT || 'BAC WATER 2.5ML';
      const BAC_FALLBACKS = [BAC_PREFERRED, 'BAC WATER 2.5ML', 'BAC WATER 3ML'];

      /** @type {Record<string, {vial_price:number, pack_price:number, name:string, kit_only?:boolean}>} */
      let catalogByName = {};
      let catalogLoaded = false;

      /** Public storefront sells kits. Live catalog often has vial_price null (shows as $0 if we read it). */
      function sellUnitPrice(p) {
        if (!p) return null;
        const pack = Number(p.pack_price);
        if (Number.isFinite(pack) && pack > 0) return pack;
        const vial = Number(p.vial_price);
        if (Number.isFinite(vial) && vial > 0) return vial;
        return 0;
      }

      function resolveBacName() {
        for (const name of BAC_FALLBACKS) {
          if (name && catalogByName[name]) return name;
        }
        return BAC_PREFERRED;
      }

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
        try { window.dispatchEvent(new CustomEvent('spbc-cart-changed')); } catch (_) { /* ignore */ }
      }

      /**
       * Merge stack lines into existing cart (ADD kit quantities; never wipe).
       * Public storefront is kits-only — writing vial qty is invisible on Home and
       * then get wiped when Home rebuilds the draft from kit steppers.
       * Accepts `kits` or legacy `vials` (stack data still uses vials as the qty field).
       * @param {{product:string, kits?:number, vials?:number}[]} lines
       */
      function mergeIntoCart(lines) {
        const draft = loadCart();
        for (const line of lines) {
          if (!line || !line.product) continue;
          if (!catalogByName[line.product]) continue; // never add nonexistent names
          const rawQty = line.kits != null ? line.kits : line.vials;
          const addKit = clampKit(rawQty);
          if (addKit <= 0) continue;
          const prev = draft[line.product] || { vial: 0, pack: 0 };
          draft[line.product] = {
            vial: clampVial(prev.vial || 0),
            pack: clampKit((Number(prev.pack) || 0) + addKit),
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
          return sum + clampKit(it.vials);
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
          total += (sellUnitPrice(p) || 0) * clampKit(it.vials);
        }
        if (includeBac) {
          const bacName = resolveBacName();
          const bac = catalogByName[bacName];
          const bacQty = clampKit(stackVialCount(stack));
          if (bac && bacQty > 0) {
            total += (sellUnitPrice(bac) || 0) * bacQty;
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
          const bacDefault = false;
          const { total, known } = computeTotal(stack, bacDefault);
          const vialCount = stackVialCount(stack);
          const bacName = resolveBacName();
          const bacP = catalogByName[bacName];
          const bacLinePrice = bacP ? (sellUnitPrice(bacP) || 0) * clampKit(vialCount) : null;

          const itemsHtml = (stack.items || []).map((it) => {
            const p = catalogByName[it.product];
            const miss = catalogLoaded && !p;
            const qty = clampKit(it.vials);
            const line = p ? (sellUnitPrice(p) || 0) * qty : null;
            return `<div class="stack-item-row${miss ? ' opacity-60' : ''}">
              <div>
                <p class="text-sm font-semibold text-white">${escapeHtml(it.product)} <span class="text-zinc-400 font-normal">×${qty} kit${qty === 1 ? '' : 's'}</span>
                  ${miss ? '<span class="ml-1 text-amber-400 text-xs font-bold">currently unavailable</span>' : ''}
                </p>
                <p class="text-[11px] text-zinc-500 mt-0.5 leading-snug">${escapeHtml(it.refRange || '')}</p>
              </div>
              <div class="text-right text-sm text-zinc-300 whitespace-nowrap">${!catalogLoaded ? '…' : (miss ? '—' : money(line))}</div>
            </div>`;
          }).join('');

          const bacRow = `<div class="stack-item-row bac-price-row" data-stack-bac-row="${escapeHtml(stack.id)}">
            <div>
              <p class="text-sm font-semibold text-white">${escapeHtml(bacName)} <span class="text-zinc-400 font-normal bac-qty">×${clampKit(vialCount)} kit${clampKit(vialCount) === 1 ? '' : 's'}</span>
                ${catalogLoaded && !bacP ? '<span class="ml-1 text-amber-400 text-xs font-bold">currently unavailable</span>' : ''}
              </p>
              <p class="text-[11px] text-zinc-500 mt-0.5">Optional catalog item — add it if you want reconstitution water</p>
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
              <span>Add bacteriostatic water <span class="text-zinc-500">(${escapeHtml(bacName)} — 1 kit per peptide kit)</span></span>
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
      }

      function bindGridOnce() {
        const grid = document.getElementById('stacksGrid');
        if (!grid || grid.dataset.addBound === '1') return;
        grid.dataset.addBound = '1';
        // Delegation survives renderStacks() innerHTML replacements.
        grid.addEventListener('click', function (e) {
          const btn = e.target && e.target.closest ? e.target.closest('[data-add-stack]') : null;
          if (!btn || btn.disabled || btn.getAttribute('disabled') !== null) return;
          e.preventDefault();
          onAddStack(btn.getAttribute('data-add-stack'));
        });
        grid.addEventListener('change', function (e) {
          const cb = e.target && e.target.closest ? e.target.closest('.bac-toggle') : null;
          if (!cb) return;
          updateCardTotals(cb.getAttribute('data-stack-id'));
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

      function showStacksToast(message) {
        let toast = document.getElementById('spbcUndoToast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'spbcUndoToast';
          toast.className = 'spbc-undo-toast';
          toast.setAttribute('role', 'status');
          toast.innerHTML = '<span class="spbc-undo-msg"></span><a class="spbc-toast-link" href="/#prices">View cart</a>';
          document.body.appendChild(toast);
        }
        const msg = toast.querySelector('.spbc-undo-msg');
        if (msg) msg.textContent = message;
        toast.classList.add('is-visible');
        window.setTimeout(function () { toast.classList.remove('is-visible'); }, 4000);
      }

      function onAddStack(stackId) {
        try {
          const stack = (window.SPBC_STACKS || []).find((s) => s.id === stackId);
          if (!stack) {
            showStacksToast('Could not find that stack — refresh and try again.');
            return;
          }
          if (!catalogLoaded) {
            showStacksToast('Catalog is still loading — try again in a moment.');
            return;
          }
          if (!stackAvailable(stack)) {
            showStacksToast('This stack has products that are currently unavailable.');
            return;
          }
          const card = document.querySelector('[data-stack-card][data-stack-id="' + stackId + '"]');
          const includeBac = !!(card && card.querySelector('.bac-toggle') && card.querySelector('.bac-toggle').checked);
          const lines = (stack.items || [])
            .filter((it) => catalogByName[it.product])
            .map((it) => ({ product: it.product, kits: clampKit(it.vials) }));
          const bacName = resolveBacName();
          if (includeBac) {
            const bacQty = clampKit(stackVialCount(stack));
            if (bacQty > 0 && catalogByName[bacName]) {
              lines.push({ product: bacName, kits: bacQty });
            }
          }
          if (!lines.length) {
            showStacksToast('No available products to add.');
            return;
          }
          const { total } = computeTotal(stack, includeBac);
          mergeIntoCart(lines);
          renderCartStrip();
          if (typeof window.spbcHeaderRefresh === 'function') {
            window.spbcHeaderRefresh();
          }
          showStacksToast(stack.name + ' added — ' + money(total));
        } catch (err) {
          showStacksToast('Could not add this stack — try again.');
        }
      }

      function cartUnitCount(draft) {
        return Object.keys(draft || {}).reduce((n, name) => {
          const e = draft[name] || {};
          return n + (Number(e.pack) || 0) + (Number(e.vial) || 0);
        }, 0);
      }

      function renderCartStrip() {
        const el = document.getElementById('stacksCartStrip');
        const countEl = document.getElementById('stacksCartCount');
        if (!el || !countEl) return;
        const draft = loadCart();
        const n = cartUnitCount(draft);
        if (n <= 0) {
          el.hidden = true;
          countEl.textContent = '0 items';
          return;
        }
        el.hidden = false;
        countEl.textContent = n === 1 ? '1 item' : n + ' items';
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
        renderCartStrip();
      }

      bindGridOnce();
      renderStacks();
      renderCartStrip();
      window.addEventListener('storage', function (e) {
        if (e.key === CART_KEY) renderCartStrip();
      });
      window.addEventListener('spbc-cart-changed', renderCartStrip);
      loadCatalog();
    })();
  
