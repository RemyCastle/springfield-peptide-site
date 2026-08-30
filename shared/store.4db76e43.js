const CART_KEY = "spbc_cart_draft";
        const CONTACT_KEY = "spbc_contact_draft";
        const VIAL_OPTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // single vials: any qty 1–10
        const PACK_OPTS = [0, 1, 2, 3, 5];
        // No volume discounts on SPBC — no vial minimum.

        /**
         * Public storefront sells single vials (when vial_price is set) and 10-packs / kits.
         * True kit_only products (e.g. HGH, no vial_price) stay kit-only — no vial stepper.
         * Vial-only rows (RETA 66MG: kit_only + vial_price === pack_price, or pack_price 0)
         * show a Vial stepper, not a 10-pack. One vial is a legal checkout.
         */
        const PUBLIC_KITS_ONLY = false;
        /** Reconstitution water auto-added, one kit per peptide kit. Must match the product name exactly. */
        const AUTO_BAC_PREFERRED = [
            'BAC WATER 2.5ML',
            'BAC WATER 3ML',
            'BAC WATER 10 ML',
        ];

        /**
         * Single edit point for storefront category grouping.
         * Keys MUST match product names exactly (join key — never rename products).
         * Unmapped names fall through to FALLBACK_CATEGORY so new products never disappear.
         */
        const FALLBACK_CATEGORY = 'Other research';
        const PRODUCT_CATEGORY_ORDER = [
            'GLP-1 / metabolic',
            'Repair & recovery',
            'Skin & cosmetic',
            'Longevity & mitochondrial',
            'GH secretagogues',
            'Other research',
            'Supplies',
        ];
        const PRODUCT_CATEGORY_BY_NAME = {
            'SEMA 5MG': 'GLP-1 / metabolic',
            'SEMA 10MG': 'GLP-1 / metabolic',
            'CAGRI  5MG': 'GLP-1 / metabolic',
            'CAGRI 10MG': 'GLP-1 / metabolic',
            'TIRZ 10MG': 'GLP-1 / metabolic',
            'TIRZ 30MG': 'GLP-1 / metabolic',
            'TIRZ 60MG': 'GLP-1 / metabolic',
            'RETA 10MG': 'GLP-1 / metabolic',
            'RETA 30MG': 'GLP-1 / metabolic',
            'RETA 60 MG': 'GLP-1 / metabolic',
            'RETA 66MG': 'GLP-1 / metabolic',
            'BPC-157 10MG': 'Repair & recovery',
            'TB-500 10MG': 'Repair & recovery',
            'KPV 10 MG': 'Repair & recovery',
            'KLOW 80MG': 'Repair & recovery',
            'GHK-CU 50MG': 'Skin & cosmetic',
            'GHK-cu 100MG': 'Skin & cosmetic',
            'MOTS-C 10MG': 'Longevity & mitochondrial',
            'MOTS-C 40MG': 'Longevity & mitochondrial',
            'SS-31 10MG': 'Longevity & mitochondrial',
            'SS-31 50MG': 'Longevity & mitochondrial',
            'NAD+ 500MG': 'Longevity & mitochondrial',
            'NAD+ 1000MG': 'Longevity & mitochondrial',
            '5-AMINO-1MQ 50MG': 'Longevity & mitochondrial',
            'GLUTATHIONE 1200MG': 'Longevity & mitochondrial',
            'IPA 10MG': 'GH secretagogues',
            'CJC/IPA NO DAC 10MG': 'GH secretagogues',
            'Tesamorelin': 'GH secretagogues',
            'Tesamorelin 10MG': 'GH secretagogues',
            'Tesamorelin 20MG': 'GH secretagogues',
            'SEMAX 10MG': 'Other research',
            'PE-22-28 10MG': 'Other research',
            'PT-141 10 MG': 'Other research',
            'MT1': 'Other research',
            'MT2': 'Other research',
            'DSIP 10MG': 'Other research',
            'BAC WATER 2.5ML': 'Supplies',
            'BAC WATER 3ML': 'Supplies',
            'BAC WATER 10 ML': 'Supplies',
        };

        function categoryForProduct(name) {
            if (Object.prototype.hasOwnProperty.call(PRODUCT_CATEGORY_BY_NAME, name)) {
                return PRODUCT_CATEGORY_BY_NAME[name];
            }
            return FALLBACK_CATEGORY;
        }

        function groupProductsByCategory(products) {
            const buckets = new Map();
            PRODUCT_CATEGORY_ORDER.forEach((cat) => buckets.set(cat, []));
            (products || []).forEach((p) => {
                const cat = categoryForProduct(p && p.name);
                if (!buckets.has(cat)) buckets.set(cat, []);
                buckets.get(cat).push(p);
            });
            return buckets;
        }

        let activeFilter = 'all';
        let placingOrder = false;
        let stickyExpanded = false;

        function prefersReducedMotion() {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        }

        let cartUndoTimer = null;
        let cartUndoSnapshot = null;

        function hasPositivePrice(n) {
            const v = Number(n);
            return Number.isFinite(v) && v > 0;
        }

        /**
         * Sold as singles, not a 10-pack: pack_price is 0/missing, or kit_only with
         * vial_price === pack_price (RETA 66MG in D1: 70 / 70). HGH stays kit-only
         * because those rows have no vial_price.
         */
        function isVialOnlyListing(p) {
            if (!hasPositivePrice(p && p.vial_price)) return false;
            if (!hasPositivePrice(p.pack_price)) return true;
            return !!p.kit_only && Number(p.vial_price) === Number(p.pack_price);
        }

        function isTrueKitOnly(p) {
            return !!(p && p.kit_only) && !hasPositivePrice(p.vial_price);
        }

        function snapQty(n, allowed) {
            const opts = Array.isArray(allowed) && allowed.length ? allowed : PACK_OPTS;
            const v = Math.round(Number(n) || 0);
            let best = opts[0] || 0;
            for (const a of opts) {
                if (a <= v) best = a;
            }
            return best;
        }

        /**
         * When the storefront is kits-only, leftover {vial:N, pack:0} drafts
         * (older stacks writes) must land on the kit stepper or Home wipes them.
         * With vials enabled, vial qty stays on the vial stepper.
         */
        function storefrontKitQty(entry, allowed) {
            const saved = entry || {};
            const pack = Number(saved.pack) || 0;
            if (pack > 0) return snapQty(pack, allowed);
            if (PUBLIC_KITS_ONLY) {
                const vial = Number(saved.vial) || 0;
                if (vial > 0) return snapQty(vial, allowed);
            }
            return 0;
        }

        function notifyCartChanged() {
            try { window.dispatchEvent(new CustomEvent('spbc-cart-changed')); } catch (e) { /* ignore */ }
        }

        function applyCartMap(map) {
            document.querySelectorAll('#priceTable .price-card').forEach(card => {
                const name = card.getAttribute('data-name') || '';
                const entry = map[name] || { vial: 0, pack: 0 };
                const vialSel = card.querySelector('select[data-kind="vial"]');
                const packSel = card.querySelector('select[data-kind="pack"]');
                if (vialSel) {
                    const val = entry.vial || 0;
                    const allowed = [...vialSel.options].map(o => parseInt(o.value, 10));
                    vialSel.value = allowed.includes(val) ? String(val) : '0';
                    syncStepperFromSelect(vialSel);
                }
                if (packSel) {
                    const allowed = [...packSel.options].map(o => parseInt(o.value, 10));
                    const val = storefrontKitQty(entry, allowed);
                    packSel.value = allowed.includes(val) ? String(val) : '0';
                    syncStepperFromSelect(packSel);
                }
                const has = (entry.vial || 0) > 0 || (entry.pack || 0) > 0 || storefrontKitQty(entry) > 0;
                card.classList.toggle('in-cart', has);
            });
        }

        function snapshotCartMap() {
            const map = {};
            document.querySelectorAll('#priceTable .price-card').forEach(card => {
                const name = card.getAttribute('data-name') || '';
                if (!name) return;
                const vialSel = card.querySelector('select[data-kind="vial"]');
                const packSel = card.querySelector('select[data-kind="pack"]');
                const vial = vialSel ? (parseInt(vialSel.value, 10) || 0) : 0;
                const pack = packSel ? (parseInt(packSel.value, 10) || 0) : 0;
                if (vial || pack) map[name] = { vial, pack };
            });
            return map;
        }

        function showUndoToast(message) {
            let toast = document.getElementById('spbcUndoToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'spbcUndoToast';
                toast.className = 'spbc-undo-toast';
                toast.setAttribute('role', 'status');
                toast.innerHTML = '<span class="spbc-undo-msg"></span><button type="button" id="spbcUndoBtn">Undo</button>';
                document.body.appendChild(toast);
                document.getElementById('spbcUndoBtn').addEventListener('click', function () {
                    if (!cartUndoSnapshot) return;
                    applyCartMap(cartUndoSnapshot);
                    try { localStorage.setItem('spbc_cart_draft', JSON.stringify(cartUndoSnapshot)); } catch (e) {}
                    notifyCartChanged();
                    cartUndoSnapshot = null;
                    if (cartUndoTimer) { clearTimeout(cartUndoTimer); cartUndoTimer = null; }
                    toast.classList.remove('is-visible');
                    updateOrder();
                    announceCart('Cart restored');
                });
            }
            toast.querySelector('.spbc-undo-msg').textContent = message;
            toast.classList.add('is-visible');
            if (cartUndoTimer) clearTimeout(cartUndoTimer);
            cartUndoTimer = setTimeout(function () {
                toast.classList.remove('is-visible');
                cartUndoSnapshot = null;
                cartUndoTimer = null;
            }, 5000);
        }

        function announceCart(msg) {
            let live = document.getElementById('spbcCartLive');
            if (!live) {
                live = document.createElement('div');
                live.id = 'spbcCartLive';
                live.className = 'spbc-sr-live';
                live.setAttribute('aria-live', 'polite');
                live.setAttribute('aria-atomic', 'true');
                document.body.appendChild(live);
            }
            live.textContent = '';
            requestAnimationFrame(function () { live.textContent = msg; });
        }

        function clearCart(opts) {
            const skipConfirm = opts && opts.skipConfirm;
            const t = tallyOrder();
            if (!t.lines.length) return;
            // 5s Undo toast instead of bare confirm (skipConfirm still wipes immediately)
            if (!skipConfirm) {
                cartUndoSnapshot = snapshotCartMap();
            }
            document.querySelectorAll('#priceTable .price-card').forEach(card => {
                card.querySelectorAll('select.qty-select').forEach(sel => {
                    sel.value = '0';
                    const display = sel.closest('.qty-stepper')?.querySelector('.qty-display');
                    if (display) display.textContent = '0';
                    const minus = sel.closest('.qty-stepper')?.querySelector('.qty-btn[data-dir="-1"]');
                    const plus = sel.closest('.qty-stepper')?.querySelector('.qty-btn[data-dir="1"]');
                    if (minus) minus.disabled = true;
                    if (plus) plus.disabled = false;
                });
                card.classList.remove('in-cart');
            });
            clearCartDraft();
            stickyExpanded = false;
            const bar = document.getElementById('stickyOrderBar');
            if (bar) bar.classList.remove('expanded');
            const countBtn = document.getElementById('stickyCountBtn');
            if (countBtn) countBtn.setAttribute('aria-expanded', 'false');
            updateOrder();
            if (!skipConfirm) {
                showUndoToast('Cart cleared');
                announceCart('Cart cleared. Undo available for 5 seconds.');
            }
        }

        function syncStepperFromSelect(sel) {
            const wrap = sel.closest('.qty-stepper');
            if (!wrap) return;
            const val = parseInt(sel.value, 10) || 0;
            const display = wrap.querySelector('.qty-display');
            if (display) display.textContent = String(val);
            const opts = [...sel.options].map(o => parseInt(o.value, 10));
            const max = Math.max(...opts);
            const min = Math.min(...opts);
            const minus = wrap.querySelector('.qty-btn[data-dir="-1"]');
            const plus = wrap.querySelector('.qty-btn[data-dir="1"]');
            if (minus) minus.disabled = val <= min;
            if (plus) plus.disabled = val >= max;
        }

        function stepQty(sel, dir) {
            const opts = [...sel.options].map(o => parseInt(o.value, 10)).sort((a, b) => a - b);
            let idx = opts.indexOf(parseInt(sel.value, 10) || 0);
            if (idx < 0) idx = 0;
            const next = opts[Math.max(0, Math.min(opts.length - 1, idx + dir))];
            if (next === undefined || String(next) === sel.value) return;
            const prev = parseInt(sel.value, 10) || 0;
            sel.value = String(next);
            syncStepperFromSelect(sel);
            spawnQtyFloat(sel, (parseInt(sel.value, 10) || 0) - prev);
            onQtyChange(sel);
        }

        function spawnQtyFloat(sel, delta) {
            if (!delta || prefersReducedMotion()) return;
            const wrap = sel.closest('.price-controls') || sel.closest('.qty-stepper');
            if (!wrap) return;
            const span = document.createElement('span');
            span.className = 'qty-float' + (delta < 0 ? ' down' : '');
            span.textContent = delta > 0 ? `+${delta}` : String(delta);
            wrap.appendChild(span);
            setTimeout(() => span.remove(), 560);
        }

        function buildStepper(kind, opts, selected, ariaLabel) {
            const selVal = Number(selected) || 0;
            return `
                <div class="qty-stepper" data-stepper-kind="${kind}">
                    <button type="button" class="qty-btn" data-dir="-1" aria-label="Decrease ${escapeHtml(ariaLabel)}">−</button>
                    <select data-kind="${kind}" class="qty-select" aria-label="${escapeHtml(ariaLabel)}">
                        ${optionHtml(opts, selVal)}
                    </select>
                    <span class="qty-display" aria-hidden="true">${selVal}</span>
                    <button type="button" class="qty-btn" data-dir="1" aria-label="Increase ${escapeHtml(ariaLabel)}">+</button>
                </div>`;
        }

        function formatPrice(n) {
            const num = Number(n);
            if (!Number.isFinite(num)) return '';
            // API returns customer whole-dollar prices; keep cents only if present.
            const rounded = Math.round(num);
            if (Math.abs(num - rounded) < 1e-9) return String(rounded);
            return num.toFixed(2);
        }

        function money(n) {
            return Number(n).toFixed(2);
        }

        function optionHtml(values, selected) {
            const sel = Number(selected) || 0;
            return values.map(v => `<option value="${v}"${v === sel ? ' selected' : ''}>${v}</option>`).join('');
        }

        function escapeHtml(s) {
            return String(s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/"/g, '&quot;');
        }

        function loadCartDraft() {
            try {
                const raw = localStorage.getItem(CART_KEY);
                if (!raw) return {};
                const data = JSON.parse(raw);
                return data && typeof data === 'object' ? data : {};
            } catch (_) {
                return {};
            }
        }

        function saveCartDraft() {
            const cards = document.querySelectorAll('#priceTable .price-card');
            // Don't clobber a stack-written draft while the price table is still loading.
            if (!cards.length) return;
            const known = new Set();
            const fromDom = {};
            cards.forEach(card => {
                const name = card.getAttribute('data-name');
                if (!name) return;
                known.add(name);
                const vialSelect = card.querySelector('select[data-kind="vial"]');
                const kitSelect = card.querySelector('select[data-kind="pack"]');
                const vialQty = parseInt(vialSelect ? vialSelect.value : 0, 10) || 0;
                const kitQty = parseInt(kitSelect ? kitSelect.value : 0, 10) || 0;
                if (vialQty > 0 || kitQty > 0) {
                    fromDom[name] = { vial: vialQty, pack: kitQty };
                }
            });
            // Merge: keep draft lines for names the price table does not render.
            const prev = loadCartDraft();
            const draft = {};
            Object.keys(prev).forEach((k) => {
                if (!known.has(k)) draft[k] = prev[k];
            });
            Object.assign(draft, fromDom);
            try {
                if (Object.keys(draft).length) localStorage.setItem(CART_KEY, JSON.stringify(draft));
                else localStorage.removeItem(CART_KEY);
            } catch (_) { /* ignore quota */ }
            notifyCartChanged();
        }

        function clearCartDraft() {
            try { localStorage.removeItem(CART_KEY); } catch (_) {}
            notifyCartChanged();
        }

        function getShippingFromForm() {
            const shipStateEl = document.getElementById('shipState');
            if (shipStateEl) shipStateEl.value = (shipStateEl.value || '').trim().toUpperCase();
            return {
                ship_name: document.getElementById('name').value.trim() || 'Customer',
                ship_line1: document.getElementById('shipLine1').value.trim(),
                ship_line2: document.getElementById('shipLine2').value.trim(),
                ship_city: document.getElementById('shipCity').value.trim(),
                ship_state: (document.getElementById('shipState').value || '').trim().toUpperCase(),
                ship_postal: document.getElementById('shipPostal').value.trim(),
                ship_country: 'US',
                ship_phone: document.getElementById('shipPhone').value.trim(),
            };
        }

        function validateShippingFields() {
            const s = getShippingFromForm();
            if (!s.ship_line1) return { ok: false, reason: 'Street address is required.', focus: 'shipLine1' };
            if (!s.ship_city) return { ok: false, reason: 'City is required.', focus: 'shipCity' };
            if (!/^[A-Z]{2}$/.test(s.ship_state)) {
                return { ok: false, reason: 'State must be a 2-letter code (e.g. MO).', focus: 'shipState' };
            }
            if (!/^\d{5}(-\d{4})?$/.test(s.ship_postal)) {
                return { ok: false, reason: 'Enter a valid ZIP (12345 or 12345-6789).', focus: 'shipPostal' };
            }
            return { ok: true, reason: '', shipping: s };
        }

        function saveContactDraft() {
            try {
                localStorage.setItem(CONTACT_KEY, JSON.stringify({
                    name: document.getElementById('name').value.trim(),
                    email: document.getElementById('email').value.trim(),
                    ship_line1: document.getElementById('shipLine1')?.value.trim() || '',
                    ship_line2: document.getElementById('shipLine2')?.value.trim() || '',
                    ship_city: document.getElementById('shipCity')?.value.trim() || '',
                    ship_state: (document.getElementById('shipState')?.value || '').trim().toUpperCase(),
                    ship_postal: document.getElementById('shipPostal')?.value.trim() || '',
                    ship_phone: document.getElementById('shipPhone')?.value.trim() || '',
                }));
            } catch (_) {}
        }

        function restoreContactDraft() {
            try {
                const raw = localStorage.getItem(CONTACT_KEY);
                if (!raw) return;
                const d = JSON.parse(raw);
                if (d.name) document.getElementById('name').value = d.name;
                if (d.email) document.getElementById('email').value = d.email;
                if (d.ship_line1) document.getElementById('shipLine1').value = d.ship_line1;
                if (d.ship_line2) document.getElementById('shipLine2').value = d.ship_line2;
                if (d.ship_city) document.getElementById('shipCity').value = d.ship_city;
                if (d.ship_state) document.getElementById('shipState').value = String(d.ship_state).toUpperCase();
                if (d.ship_postal) document.getElementById('shipPostal').value = d.ship_postal;
                if (d.ship_phone) document.getElementById('shipPhone').value = d.ship_phone;
            } catch (_) {}
        }

        function flashCard(card) {
            if (!card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            card.classList.remove('qty-flash');
            void card.offsetWidth;
            card.classList.add('qty-flash');
            setTimeout(() => card.classList.remove('qty-flash'), 280);
        }

        function isBacName(name) {
            return /bac\s*water/i.test(String(name || ''));
        }

        function findBacCard() {
            const cards = [...document.querySelectorAll('#priceTable .price-card')];
            const bacCards = cards.filter((c) => isBacName(c.getAttribute('data-name')));
            for (const name of AUTO_BAC_PREFERRED) {
                const hit = bacCards.find((c) => c.getAttribute('data-name') === name);
                if (hit) return hit;
            }
            return bacCards[0] || null;
        }

        function setBacIncludeWarning(msg) {
            const el = document.getElementById('bacIncludeStatus');
            if (!el) return;
            if (!msg) {
                el.hidden = true;
                el.textContent = '';
                return;
            }
            el.hidden = false;
            el.textContent = msg;
        }

        function syncKitOnlyChip() {
            const chip = document.querySelector('.filter-chip[data-filter="kit-only"]');
            if (!chip) return;
            const cards = document.querySelectorAll('#priceTable .price-card');
            const kitOnlyCount = [...cards].filter((c) =>
                c.hasAttribute('data-kit') && !c.hasAttribute('data-pack')
            ).length;
            // This chip filters the admin kit_only flag. Hide it when the
            // storefront is kits-only (every card would match) or none exist.
            const hide = PUBLIC_KITS_ONLY || kitOnlyCount === 0;
            chip.hidden = hide;
            if (hide && activeFilter === 'kit-only') {
                activeFilter = 'all';
                document.querySelectorAll('.filter-chip').forEach((c) => {
                    const on = (c.getAttribute('data-filter') || '') === 'all';
                    c.classList.toggle('active', on);
                    c.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
            }
        }

        function applyProductFilter() {
            const q = (document.getElementById('productSearch').value || '').trim().toLowerCase();
            const cards = document.querySelectorAll('#priceTable .price-card');
            let visible = 0;
            cards.forEach(card => {
                const name = (card.getAttribute('data-name') || '').toLowerCase();
                const hasVial = card.hasAttribute('data-vial');
                const kitOnly = card.hasAttribute('data-kit') && !card.hasAttribute('data-pack');
                let typeOk = true;
                if (activeFilter === 'vials') typeOk = hasVial;
                if (activeFilter === 'kit-only') typeOk = kitOnly;
                const textOk = !q || name.includes(q);
                const show = typeOk && textOk;
                card.classList.toggle('hidden', !show);
                if (show) visible += 1;
            });
            // Hide empty groups (and their sticky subheaders) when filter/search is active
            document.querySelectorAll('#priceTable .price-group').forEach((group) => {
                const anyVisible = [...group.querySelectorAll('.price-card')].some(
                    (c) => !c.classList.contains('hidden')
                );
                group.classList.toggle('hidden', !anyVisible);
            });
            const filterActive = !!q || activeFilter !== 'all';
            const countEl = document.getElementById('filterResultCount');
            if (countEl) {
                if (filterActive && cards.length) {
                    countEl.hidden = false;
                    countEl.textContent = visible === 1
                        ? '1 product matches'
                        : `${visible} products match`;
                } else {
                    countEl.hidden = true;
                    countEl.textContent = '';
                }
            }
            const empty = document.getElementById('filterEmpty');
            if (empty) empty.classList.toggle('hidden', visible > 0 || !cards.length);
        }

        function onQtyChange(selectEl) {
            const card = selectEl.closest('.price-card');
            flashCard(card);
            syncStepperFromSelect(selectEl);
            updateOrder();
        }

        function wireStepper(article) {
            article.querySelectorAll('.qty-stepper').forEach(stepper => {
                const sel = stepper.querySelector('select.qty-select');
                if (!sel) return;
                syncStepperFromSelect(sel);
                stepper.querySelectorAll('.qty-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const dir = parseInt(btn.getAttribute('data-dir'), 10) || 0;
                        stepQty(sel, dir);
                    });
                });
                sel.addEventListener('change', () => onQtyChange(sel));
            });
        }

        function buildPriceCard(p, draft) {
            const name = p.name;
            const trueKitOnly = isTrueKitOnly(p);
            const vialOnly = isVialOnlyListing(p);
            const showVial = !PUBLIC_KITS_ONLY && hasPositivePrice(p.vial_price);
            const showPack = hasPositivePrice(p.pack_price) && !vialOnly;
            const saved = draft[name] || {};
            const savedPack = showPack ? storefrontKitQty(saved, trueKitOnly ? VIAL_OPTS : PACK_OPTS) : 0;
            let savedVial = saved.vial || 0;
            if (showVial && !(Number(saved.vial) > 0) && vialOnly && (Number(saved.pack) > 0)) {
                savedVial = snapQty(saved.pack, VIAL_OPTS);
            }
            const article = document.createElement('article');
            // No .reveal — design.md: never animate product card opacity (visibility must not depend on IO).
            article.className = 'price-card depth-card grid-item';
            article.setAttribute('data-name', name);
            if (showVial) article.setAttribute('data-vial', String(p.vial_price));
            if (showPack && trueKitOnly) {
                article.setAttribute('data-kit', String(p.pack_price));
            } else if (showPack) {
                article.setAttribute('data-pack', String(p.pack_price));
            }

            let body = `<h3 class="price-card-title break-word">${escapeHtml(name)}</h3><div class="price-card-body">`;
            // Vial stepper when D1 has a vial price. True kit_only (HGH) has no vial_price.
            // RETA 66MG is vial-only (same 70/70 dummy pack) — Vial, not 10-pack.
            if (showVial) {
                body += `
                    <div class="price-row">
                        <span class="price-label">Vial</span>
                        <div class="price-controls">
                            <span class="price-amount tabular-nums">$${formatPrice(p.vial_price)}</span>
                            ${buildStepper('vial', VIAL_OPTS, savedVial, name + ' vial qty')}
                        </div>
                    </div>`;
            }
            if (showPack) {
                body += `
                    <div class="price-row">
                        <span class="price-label">${trueKitOnly ? 'Kit' : '10-Pack / Kit'}</span>
                        <div class="price-controls">
                            <span class="price-amount tabular-nums">$${formatPrice(p.pack_price)}</span>
                            ${buildStepper('pack', trueKitOnly ? VIAL_OPTS : PACK_OPTS, savedPack, name + ' kit qty')}
                        </div>
                    </div>`;
            }
            body += `</div>`;
            article.innerHTML = body;
            wireStepper(article);
            return article;
        }

        function renderProducts(products) {
            const root = document.getElementById('priceTable');
            root.innerHTML = '';
            if (!products.length) {
                root.innerHTML = '<p class="text-center text-zinc-500 text-sm py-8">No products available.</p>';
                return;
            }
            const draft = loadCartDraft();
            const grouped = groupProductsByCategory(products);
            grouped.forEach((list, category) => {
                if (!list.length) return;
                const section = document.createElement('section');
                section.className = 'price-group';
                section.setAttribute('data-category', category);
                const heading = document.createElement('h3');
                heading.className = 'price-group-heading';
                heading.textContent = category;
                const grid = document.createElement('div');
                grid.className = 'price-group-grid';
                list.forEach((p) => {
                    grid.appendChild(buildPriceCard(p, draft));
                });
                section.appendChild(heading);
                section.appendChild(grid);
                root.appendChild(section);
            });
            syncKitOnlyChip();
            applyProductFilter();
            // Stack-written pack qty must land on kit steppers before saveCartDraft.
            applyCartMap(loadCartDraft());
            updateOrder();
            if (typeof window.spbcAtmosphereRefresh === 'function') {
                window.spbcAtmosphereRefresh();
            }
        }

        async function loadProducts() {
            const root = document.getElementById('priceTable');
            root.innerHTML = `
                <div id="priceLoading" class="price-table-loading" aria-busy="true" aria-label="Loading prices">
                    <div class="skeleton-card"></div>
                    <div class="skeleton-card"></div>
                    <div class="skeleton-card"></div>
                    <div class="skeleton-card"></div>
                    <div class="skeleton-card"></div>
                    <div class="skeleton-card"></div>
                </div>`;
            try {
                // Cookie before first fetch (age-gate is defer; this inline script races it).
                // Exactly one /api/products request per page load on the happy path.
                document.cookie = 'spbc_member=1; path=/; max-age=31536000; SameSite=Lax';
                const res = await fetch('/api/products', { credentials: 'same-origin' });
                if (!res.ok) throw new Error('bad status');
                const data = await res.json();
                renderProducts(data.products || []);
            } catch (e) {
                root.innerHTML = `
                    <div class="text-center py-8 space-y-3">
                        <p class="text-red-400 text-sm">Could not load prices.</p>
                        <button type="button" id="priceRetryBtn"
                            class="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 py-2 text-sm font-medium rounded-lg border border-[#FDD700]/40 text-[#FDD700] bg-zinc-900 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FDD700]/60">
                            Retry
                        </button>
                    </div>`;
                const btn = document.getElementById('priceRetryBtn');
                if (btn) btn.addEventListener('click', function () { loadProducts(); });
            }
        }

        function onStorefrontReady() {
            restoreContactDraft();
            loadProducts();
            if (typeof window.spbcHeaderRefresh === 'function') {
                requestAnimationFrame(function () { window.spbcHeaderRefresh(); });
            }
            if (typeof window.spbcAtmosphereRefresh === 'function') {
                requestAnimationFrame(function () { window.spbcAtmosphereRefresh(); });
            }
        }

        function skuFrom(name, kind) {
            const base = String(name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
            return `${base}-${kind === 'vial' ? 'VIAL' : 'KIT'}`.slice(0, 64);
        }

        function dollarsToCents(d) {
            return Math.round(Number(d) * 100);
        }

        function tallyOrder() {
            let singleVials = 0;
            let kitCount = 0;
            let vialSubtotal = 0;
            let packSubtotal = 0;
            // BAC water is a consumable, not a peptide — it never counts toward
            // volume thresholds and is never discounted. Charged at full price.
            let nonDiscountSubtotal = 0;
            const lines = [];
            const rawLines = [];
            const cards = document.querySelectorAll('#priceTable .price-card');
            cards.forEach(card => {
                const name = card.getAttribute('data-name');
                const isBac = /bac\s*water/i.test(name);
                const vialPrice = parseFloat(card.getAttribute('data-vial') || 0);
                const packPrice = parseFloat(card.getAttribute('data-pack') || card.getAttribute('data-kit') || 0);
                const vialSelect = card.querySelector('select[data-kind="vial"]');
                const kitSelect = card.querySelector('select[data-kind="pack"]');
                const vialQty = parseInt(vialSelect ? vialSelect.value : 0, 10) || 0;
                const kitQty = parseInt(kitSelect ? kitSelect.value : 0, 10) || 0;
                if (vialQty > 0) {
                    const line = vialQty * vialPrice;
                    if (isBac) {
                        nonDiscountSubtotal += line;
                    } else {
                        singleVials += vialQty;
                        vialSubtotal += line;
                    }
                    lines.push({ kind: 'vial', text: `${vialQty}x ${name} (Vial) — $${money(line)}` });
                    rawLines.push({
                        kind: 'vial',
                        name: `${name} (Vial)`,
                        sku: skuFrom(name, 'vial'),
                        qty: vialQty,
                        unit_price_dollars: vialPrice,
                        isBac,
                    });
                }
                if (kitQty > 0) {
                    const label = card.hasAttribute('data-kit') && !card.hasAttribute('data-pack') ? 'Kit' : '10-Pack / Kit';
                    const line = kitQty * packPrice;
                    if (isBac) {
                        nonDiscountSubtotal += line;
                    } else {
                        kitCount += kitQty;
                        packSubtotal += line;
                    }
                    lines.push({ kind: 'pack', text: `${kitQty}x ${name} (${label}) — $${money(line)}` });
                    rawLines.push({
                        kind: 'pack',
                        name: `${name} (${label})`,
                        sku: skuFrom(name, 'kit'),
                        qty: kitQty,
                        unit_price_dollars: packPrice,
                        isBac,
                    });
                }
            });

            /**
             * Automatic BAC water on every kit purchase (direct SPBC customers only).
             *
             * Each peptide kit needs reconstitution water, so one BAC kit is added per
             * peptide kit rather than leaving the customer to remember it. It is added
             * as a VISIBLE line so the total the customer approves is the total they
             * pay — never a silent server-side addition. Single-vial lines do not
             * trigger this. Franchisee ordering runs through the spbc-orders worker
             * and is untouched by this.
             *
             * If the customer already put BAC in the cart themselves, that counts
             * toward the requirement — we top up to the kit count, never double-charge.
             */
            if (kitCount > 0) {
                const bacCard = findBacCard();
                if (bacCard) {
                    const bacName = bacCard.getAttribute('data-name') || '';
                    const bacPrice = parseFloat(
                        bacCard.getAttribute('data-pack') || bacCard.getAttribute('data-kit') || 0
                    );
                    const alreadyChosen = rawLines
                        .filter((r) => r.isBac && r.kind === 'pack')
                        .reduce((n, r) => n + r.qty, 0);
                    const need = Math.max(0, kitCount - alreadyChosen);
                    if (need > 0 && bacPrice > 0) {
                        const line = need * bacPrice;
                        nonDiscountSubtotal += line;
                        lines.push({
                            kind: 'pack',
                            text: `${need}x ${bacName} (Kit) — $${money(line)} · included with every kit`,
                        });
                        rawLines.push({
                            kind: 'pack',
                            name: `${bacName} (Kit)`,
                            sku: skuFrom(bacName, 'kit'),
                            qty: need,
                            unit_price_dollars: bacPrice,
                            isBac: true,
                            autoAdded: true,
                        });
                    }
                    setBacIncludeWarning('');
                } else {
                    setBacIncludeWarning('BAC water is listed as included, but no BAC WATER product is in the live catalog — it was not added to this order. Email the club if you need reconstitution water.');
                }
            } else {
                setBacIncludeWarning('');
            }

            // No volume discounts on SPBC — every item bills at full price.
            const vialDiscountEligible = false;
            const vialDiscount = 0;
            const kitRate = 0;
            const kitDiscount = 0;
            const kitDiscountPct = 0;
            const total = vialSubtotal + packSubtotal + nonDiscountSubtotal;

            const items = rawLines.map((r) => {
                return {
                    sku: r.sku,
                    name: r.name,
                    qty: r.qty,
                    unit_price_cents: dollarsToCents(r.unit_price_dollars),
                };
            });

            return {
                singleVials,
                kitCount,
                vialSubtotal,
                packSubtotal,
                vialDiscount,
                vialDiscountEligible,
                kitDiscount,
                kitRate,
                kitDiscountPct,
                total,
                lines,
                items,
            };
        }

        function discountProgressMeta(t) {
            // No volume discounts and no vial minimum. Progress is just "has items".
            if (PUBLIC_KITS_ONLY) {
                if (t.kitCount > 0) {
                    return {
                        pct: 100,
                        hint: `Ready to order · BAC water included with ${t.kitCount === 1 ? 'your kit' : 'each kit'}`,
                    };
                }
                return { pct: 0, hint: 'Add a kit to start your order' };
            }
            if (t.singleVials === 0 && t.kitCount === 0) {
                return { pct: 0, hint: 'Add a vial or kit to start your order' };
            }
            if (t.kitCount > 0) {
                return {
                    pct: 100,
                    hint: `Ready to order · BAC water included with ${t.kitCount === 1 ? 'your kit' : 'each kit'}`,
                };
            }
            return { pct: 100, hint: 'Ready to order' };
        }

        function updateStickyBar(t) {
            const bar = document.getElementById('stickyOrderBar');
            const hasItems = t.lines.length > 0;
            bar.classList.toggle('visible', hasItems);
            bar.setAttribute('aria-hidden', hasItems ? 'false' : 'true');
            document.body.classList.toggle('has-cart-bar', hasItems);
            if (!hasItems) {
                stickyExpanded = false;
                bar.classList.remove('expanded');
                document.body.classList.remove('sticky-expanded');
            } else {
                bar.classList.toggle('expanded', stickyExpanded);
                document.body.classList.toggle('sticky-expanded', stickyExpanded);
            }

            const itemCount = t.items.reduce((s, it) => s + it.qty, 0);
            const prevCount = parseInt(document.getElementById('cartBadge')?.textContent || '0', 10) || 0;
            document.getElementById('stickyCount').textContent =
                `${itemCount} item${itemCount === 1 ? '' : 's'}`;
            const badge = document.getElementById('cartBadge');
            if (badge) {
                badge.textContent = String(itemCount);
                badge.style.display = itemCount > 0 ? 'inline-flex' : 'none';
                if (itemCount !== prevCount && itemCount > 0 && typeof window.spbcPulseCartBadge === 'function') {
                    window.spbcPulseCartBadge();
                }
            }
            const totalEl = document.getElementById('stickyTotal');
            const prevTotal = totalEl ? totalEl.textContent : '';
            const nextTotal = `$${money(t.total)}`;
            if (totalEl) totalEl.textContent = nextTotal;
            if (hasItems && nextTotal !== prevTotal) {
                announceCart(`${itemCount} item${itemCount === 1 ? '' : 's'}, total ${nextTotal}`);
            }

            // Savings line + count-up
            const savings = (t.vialDiscount || 0) + (t.kitDiscount || 0);
            const savingsLine = document.getElementById('savingsLine');
            const savingsAmount = document.getElementById('savingsAmount');
            if (savingsLine && savingsAmount) {
                if (savings > 0.005) {
                    savingsLine.classList.remove('hidden');
                    if (typeof window.spbcCountTo === 'function') {
                        window.spbcCountTo(savingsAmount, savings, 500);
                    } else {
                        savingsAmount.textContent = money(savings);
                    }
                } else {
                    savingsLine.classList.add('hidden');
                    savingsAmount.textContent = '0.00';
                }
            }

            const linesEl = document.getElementById('stickyLines');
            if (linesEl) {
                linesEl.innerHTML = t.lines.map(l => {
                    const parts = l.text.split(' — ');
                    return `<div class="sticky-line"><span class="break-word min-w-0">${escapeHtml(parts[0] || '')}</span><span class="text-[#EAB308] tabular-nums shrink-0">${escapeHtml(parts[1] || '')}</span></div>`;
                }).join('');
            }

            const formClear = document.getElementById('clearCartFormBtn');
            if (formClear) formClear.classList.toggle('hidden', !hasItems);

            // In-cart card highlight
            document.querySelectorAll('#priceTable .price-card').forEach(card => {
                const hasQty = [...card.querySelectorAll('select.qty-select')].some(s => (parseInt(s.value, 10) || 0) > 0);
                card.classList.toggle('in-cart', hasQty);
            });

            const meta = discountProgressMeta(t);
            const fill = document.getElementById('discountProgressFill');
            const prog = document.getElementById('discountProgress');
            const hint = document.getElementById('stickyProgressHint');
            fill.style.width = `${Math.max(0, Math.min(100, meta.pct))}%`;
            prog.setAttribute('aria-valuenow', String(meta.pct));
            hint.textContent = meta.hint;

            hint.classList.toggle('unlocked', meta.pct >= 100);

            const countBtn = document.getElementById('stickyCountBtn');
            if (countBtn) countBtn.setAttribute('aria-expanded', stickyExpanded ? 'true' : 'false');
        }

        function updateOrder() {
            const t = tallyOrder();
            saveCartDraft();

            let orderText = "ORDER SUMMARY:\n\n";
            if (!t.lines.length) {
                document.getElementById('message').value = "No items selected yet.";
            } else {
                t.lines.forEach(l => { orderText += l.text + "\n"; });
                if (!PUBLIC_KITS_ONLY) {
                    orderText += `\nSingle vials: ${t.singleVials}`;
                    if (t.vialSubtotal > 0) {
                        orderText += `\nSingle vial subtotal: $${money(t.vialSubtotal)}`;
                    }
                }
                orderText += `\nKits / 10-packs: ${t.kitCount}`;
                if (t.packSubtotal > 0) {
                    orderText += `\n10-pack / kit subtotal: $${money(t.packSubtotal)}`;
                }
                orderText += `\n\nESTIMATED TOTAL: $${money(t.total)}`;
                document.getElementById('message').value = orderText.trim();
            }

            const statusEl = document.getElementById('vialRuleStatus');
            const kitStatusEl = document.getElementById('kitRuleStatus');
            const hintEl = document.getElementById('orderRuleHint');
            let status = '';
            let tone = 'text-zinc-500';
            if (PUBLIC_KITS_ONLY) {
                status = t.kitCount > 0
                    ? 'Kits only · BAC water is added with each peptide kit'
                    : 'Kits only — add a kit to start your order';
                tone = t.kitCount > 0 ? 'text-zinc-400' : 'text-zinc-500';
            } else if (t.singleVials === 0 && t.packSubtotal === 0) {
                status = 'Add a vial or kit to start your order';
                tone = 'text-zinc-500';
            } else if (t.singleVials > 0) {
                status = `${t.singleVials} single vial${t.singleVials === 1 ? '' : 's'}`;
                tone = 'text-zinc-400';
            } else if (t.singleVials === 0) {
                status = 'No single vials selected';
                tone = 'text-zinc-500';
            }

            let kitStatus = '';
            let kitTone = 'text-zinc-500';
            if (t.kitCount > 0) {
                kitStatus = `✓ ${t.kitCount} kit${t.kitCount === 1 ? '' : 's'} / 10-pack${t.kitCount === 1 ? '' : 's'}`;
                kitTone = 'text-zinc-300';
            }

            statusEl.className = `mt-4 text-center text-sm ${tone}`;
            statusEl.textContent = status;
            kitStatusEl.className = `mt-2 text-center text-sm ${kitTone}`;
            kitStatusEl.textContent = kitStatus;

            const hints = [status, kitStatus].filter(Boolean).join(' · ');
            hintEl.textContent = hints;
            document.getElementById('submitError').classList.add('hidden');
            updateStickyBar(t);
            refreshSubmitEnabled();
        }

        function canSubmitOrder() {
            const t = tallyOrder();
            if (!t.lines.length) return { ok: false, reason: 'Select at least one item.' };
            const ship = validateShippingFields();
            if (!ship.ok) return { ok: false, reason: ship.reason, focus: ship.focus };
            return { ok: true, reason: '', shipping: ship.shipping };
        }

        const agreeCheckbox = document.getElementById('agree');
        const submitBtn = document.getElementById('submitBtn');

        function refreshSubmitEnabled() {
            const agreed = agreeCheckbox.checked;
            const check = canSubmitOrder();
            const enable = agreed && check.ok && !placingOrder;
            submitBtn.disabled = !enable;
            submitBtn.classList.toggle('opacity-50', !enable);
            submitBtn.classList.toggle('cursor-not-allowed', !enable);
        }

        function showSubmitError(msg, focusEl) {
            const err = document.getElementById('submitError');
            err.textContent = msg;
            err.classList.remove('hidden');
            if (focusEl && typeof focusEl.focus === 'function') {
                focusEl.focus({ preventScroll: false });
                focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        function openReviewModal() {
            const check = canSubmitOrder();
            if (!agreeCheckbox.checked) {
                showSubmitError('Please agree to the terms first.', agreeCheckbox);
                document.getElementById('orderForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            if (!check.ok) {
                const focusEl = check.focus ? document.getElementById(check.focus) : document.getElementById('orderForm');
                showSubmitError(check.reason, focusEl || document.getElementById('orderForm'));
                document.getElementById('orderForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }
            const email = document.getElementById('email').value.trim();
            if (!email) {
                showSubmitError('Email is required.', document.getElementById('email'));
                return;
            }
            const name = document.getElementById('name').value.trim() || 'Customer';
            const ship = check.shipping || getShippingFromForm();
            const t = tallyOrder();
            const linesEl = document.getElementById('reviewLines');
            // Map raw lines with product name for remove
            linesEl.innerHTML = '';
            document.querySelectorAll('#priceTable .price-card').forEach(card => {
                const pname = card.getAttribute('data-name') || '';
                const vialSel = card.querySelector('select[data-kind="vial"]');
                const packSel = card.querySelector('select[data-kind="pack"]');
                const vialQty = parseInt(vialSel ? vialSel.value : 0, 10) || 0;
                const packQty = parseInt(packSel ? packSel.value : 0, 10) || 0;
                if (vialQty > 0) {
                    const line = t.lines.find(l => l.kind === 'vial' && l.text.includes(pname));
                    const row = document.createElement('div');
                    row.className = 'flex items-center justify-between gap-2 border-b border-zinc-800 pb-2';
                    row.innerHTML = `<span class="break-word min-w-0 flex-1">${escapeHtml(line ? line.text.split(' — ')[0] : vialQty + 'x ' + pname + ' (Vial)')}</span>
                        <span class="text-[#EAB308] tabular-nums shrink-0">${escapeHtml(line ? (line.text.split(' — ')[1] || '') : '')}</span>
                        <button type="button" class="review-remove" data-name="${escapeHtml(pname)}" data-kind="vial" aria-label="Remove ${escapeHtml(pname)} vials">&times;</button>`;
                    linesEl.appendChild(row);
                }
                if (packQty > 0) {
                    const line = t.lines.find(l => l.kind === 'pack' && l.text.includes(pname));
                    const row = document.createElement('div');
                    row.className = 'flex items-center justify-between gap-2 border-b border-zinc-800 pb-2';
                    row.innerHTML = `<span class="break-word min-w-0 flex-1">${escapeHtml(line ? line.text.split(' — ')[0] : packQty + 'x ' + pname)}</span>
                        <span class="text-[#EAB308] tabular-nums shrink-0">${escapeHtml(line ? (line.text.split(' — ')[1] || '') : '')}</span>
                        <button type="button" class="review-remove" data-name="${escapeHtml(pname)}" data-kind="pack" aria-label="Remove ${escapeHtml(pname)} kits">&times;</button>`;
                    linesEl.appendChild(row);
                }
            });
            linesEl.querySelectorAll('.review-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    const pname = btn.getAttribute('data-name');
                    const kind = btn.getAttribute('data-kind');
                    const card = [...document.querySelectorAll('#priceTable .price-card')].find(c => c.getAttribute('data-name') === pname);
                    if (!card) return;
                    const sel = card.querySelector(`select[data-kind="${kind}"]`);
                    if (sel) {
                        sel.value = '0';
                        syncStepperFromSelect(sel);
                    }
                    updateOrder();
                    const check = canSubmitOrder();
                    if (!check.ok || !tallyOrder().lines.length) {
                        closeReviewModal();
                        showSubmitError(check.ok ? 'Cart is empty.' : check.reason, document.getElementById('orderForm'));
                        return;
                    }
                    openReviewModal();
                });
            });
            document.getElementById('reviewEmail').textContent = email;
            document.getElementById('reviewName').textContent = name;
            document.getElementById('reviewTotal').textContent = `$${money(t.total)}`;
            let reviewShip = document.getElementById('reviewShip');
            if (!reviewShip) {
                const wrap = document.getElementById('reviewEmail')?.closest('.border-t') || document.getElementById('reviewEmail')?.parentElement?.parentElement;
                if (wrap) {
                    reviewShip = document.createElement('div');
                    reviewShip.id = 'reviewShip';
                    reviewShip.className = 'flex justify-between gap-2';
                    reviewShip.innerHTML = '<span class="text-zinc-400">Ship to</span><span class="text-white text-right text-xs leading-snug"></span>';
                    const totalRow = wrap.querySelector('.text-base.font-bold') || wrap.lastElementChild;
                    wrap.insertBefore(reviewShip, totalRow);
                }
            }
            if (reviewShip) {
                const addr = [ship.ship_line1, ship.ship_line2, `${ship.ship_city}, ${ship.ship_state} ${ship.ship_postal}`]
                    .filter(Boolean)
                    .join(', ');
                const span = reviewShip.querySelector('span:last-child') || reviewShip;
                if (span !== reviewShip) span.textContent = addr;
                else reviewShip.textContent = addr;
            }
            document.getElementById('reviewError').classList.add('hidden');

            const modal = document.getElementById('reviewModal');
            modal.classList.remove('hidden');
            modal.removeAttribute('hidden');
            document.getElementById('reviewConfirmBtn').focus();
        }

        function closeReviewModal() {
            const modal = document.getElementById('reviewModal');
            modal.classList.add('hidden');
            modal.setAttribute('hidden', '');
        }

        async function placeOrder() {
            if (placingOrder) return;
            const check = canSubmitOrder();
            if (!agreeCheckbox.checked || !check.ok) return;

            const name = document.getElementById('name').value.trim() || 'Customer';
            const email = document.getElementById('email').value.trim();
            if (!email) {
                showSubmitError('Email is required.', document.getElementById('email'));
                closeReviewModal();
                return;
            }

            const t = tallyOrder();
            const notes = document.getElementById('message').value.trim();
            const items = t.items;
            const subtotalFinal = items.reduce((s, it) => s + it.qty * it.unit_price_cents, 0);
            const shipping = check.shipping || getShippingFromForm();
            shipping.ship_name = name;

            placingOrder = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'PLACING ORDER…';
            const confirmBtn = document.getElementById('reviewConfirmBtn');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Placing…';
            document.getElementById('submitError').classList.add('hidden');
            document.getElementById('submitSuccess').classList.add('hidden');
            document.getElementById('reviewError').classList.add('hidden');

            try {
                const res = await fetch('/api/place-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        customer: { name, email },
                        items,
                        shipping_cents: 0,
                        total_cents: subtotalFinal,
                        currency: 'USD',
                        notes: notes || undefined,
                        shipping,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ok) {
                    throw new Error(data.message || data.error || `Order failed (${res.status})`);
                }

                clearCartDraft();
                closeReviewModal();
                document.getElementById('orderForm').classList.add('hidden');
                document.getElementById('stickyOrderBar').classList.remove('visible');
                document.body.classList.remove('has-cart-bar');

                const box = document.getElementById('orderSuccess');
                box.classList.remove('hidden');
                document.getElementById('successOrderNumber').textContent = data.order_number;
                document.getElementById('successTotal').textContent =
                    '$' + (Number(data.total_cents || subtotalFinal) / 100).toFixed(2);
                document.getElementById('successPayLink').href =
                    data.pay_url || `https://spbc-orders.spbc.workers.dev/pay/${encodeURIComponent(data.order_number)}`;
                const shipLink = document.getElementById('successShipLink');
                shipLink.href =
                    data.shipping_url || `https://spbc-orders.spbc.workers.dev/shipping/${encodeURIComponent(data.order_number)}`;
                const shipNote = document.getElementById('successShipNote');
                if (data.shipping_saved === false) {
                    if (shipNote) shipNote.textContent = 'We still need your shipping address — use the link below.';
                    shipLink.textContent = 'Enter shipping address';
                    shipLink.classList.add('ring-2', 'ring-amber-400');
                } else {
                    if (shipNote) shipNote.textContent = 'Shipping address is on file.';
                    shipLink.textContent = 'Edit shipping address';
                }

                box.scrollIntoView({ behavior: 'smooth', block: 'center' });

                if (data.pay_url) {
                    window.setTimeout(() => {
                        window.location.href = data.pay_url;
                    }, 1600);
                }
            } catch (err) {
                const msg = err.message || 'Could not place order. Please try again.';
                document.getElementById('reviewError').textContent = msg;
                document.getElementById('reviewError').classList.remove('hidden');
                document.getElementById('submitError').textContent = msg;
                document.getElementById('submitError').classList.remove('hidden');
                placingOrder = false;
                submitBtn.disabled = false;
                submitBtn.textContent = 'PLACE ORDER & PAY';
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Confirm & place order';
                refreshSubmitEnabled();
            }
        }

        agreeCheckbox.addEventListener('change', refreshSubmitEnabled);
        ['name', 'email', 'shipLine1', 'shipLine2', 'shipCity', 'shipState', 'shipPostal', 'shipPhone'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', () => {
                if (id === 'shipState') el.value = el.value.toUpperCase();
                refreshSubmitEnabled();
                saveContactDraft();
            });
            el.addEventListener('change', saveContactDraft);
            el.addEventListener('blur', saveContactDraft);
        });

        document.getElementById('orderForm').addEventListener('submit', e => {
            e.preventDefault();
            openReviewModal();
        });

        document.getElementById('reviewConfirmBtn').addEventListener('click', placeOrder);
        document.getElementById('reviewCancelBtn').addEventListener('click', closeReviewModal);
        document.getElementById('reviewCloseBtn').addEventListener('click', closeReviewModal);
        document.getElementById('reviewModal').addEventListener('click', e => {
            if (e.target.id === 'reviewModal') closeReviewModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') closeReviewModal();
        });

        document.getElementById('stickyReviewBtn').addEventListener('click', () => {
            document.getElementById('orderForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
            const email = document.getElementById('email');
            if (!email.value.trim()) {
                setTimeout(() => email.focus(), 400);
            } else if (!agreeCheckbox.checked) {
                setTimeout(() => agreeCheckbox.focus(), 400);
            }
        });

        function onClearCartClick() {
            clearCart({ skipConfirm: false });
        }
        document.getElementById('stickyClearBtn').addEventListener('click', onClearCartClick);
        document.getElementById('clearCartFormBtn').addEventListener('click', onClearCartClick);

        // Inline validation on blur (aria-describedby error text, no alert)
        (function wireFieldValidation() {
            function setFieldState(id, ok, msg) {
                const el = document.getElementById(id);
                const err = document.getElementById(id + 'Error');
                if (!el) return;
                el.classList.toggle('is-invalid', !ok);
                el.classList.toggle('is-valid', ok && !!el.value.trim());
                el.setAttribute('aria-invalid', ok ? 'false' : 'true');
                if (err) {
                    if (ok) {
                        err.hidden = true;
                        err.textContent = '';
                    } else {
                        err.hidden = false;
                        err.textContent = msg || 'This field is required.';
                    }
                }
            }
            const rules = {
                name: (v) => v.trim().length >= 2 || 'Enter your name (at least 2 characters).',
                email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Enter a valid email address.',
                shipLine1: (v) => v.trim().length >= 3 || 'Street address is required.',
                shipCity: (v) => v.trim().length >= 2 || 'City is required.',
                shipState: (v) => /^[A-Za-z]{2}$/.test(v.trim()) || 'Use a 2-letter state code (e.g. MO).',
                shipPostal: (v) => /^\d{5}(-\d{4})?$/.test(v.trim()) || 'Enter a valid ZIP (12345 or 12345-6789).',
            };
            Object.keys(rules).forEach(function (id) {
                const el = document.getElementById(id);
                if (!el) return;
                el.addEventListener('blur', function () {
                    const result = rules[id](el.value || '');
                    setFieldState(id, result === true, typeof result === 'string' ? result : '');
                });
                el.addEventListener('input', function () {
                    if (el.classList.contains('is-invalid')) {
                        const result = rules[id](el.value || '');
                        if (result === true) setFieldState(id, true);
                    }
                });
            });
        })();

        function toggleStickyExpanded(force) {
            if (!tallyOrder().lines.length) return;
            stickyExpanded = typeof force === 'boolean' ? force : !stickyExpanded;
            const bar = document.getElementById('stickyOrderBar');
            if (bar) bar.classList.toggle('expanded', stickyExpanded);
            document.body.classList.toggle('sticky-expanded', stickyExpanded);
            const countBtn = document.getElementById('stickyCountBtn');
            if (countBtn) countBtn.setAttribute('aria-expanded', stickyExpanded ? 'true' : 'false');
        }

        const stickyToggle = document.getElementById('stickyCountBtn');
        if (stickyToggle) {
            stickyToggle.addEventListener('click', () => {
                toggleStickyExpanded();
            });
        }

        const orderMessage = document.getElementById('message');
        if (orderMessage && window.IntersectionObserver) {
            const formDock = new IntersectionObserver((entries) => {
                const hit = entries.some((en) => en.isIntersecting && en.intersectionRatio > 0.15);
                document.body.classList.toggle('cart-over-form', hit);
                if (hit && stickyExpanded) toggleStickyExpanded(false);
            }, { threshold: [0, 0.15, 0.4], rootMargin: '0px 0px -25% 0px' });
            formDock.observe(orderMessage);
        }

        document.getElementById('productSearch').addEventListener('input', applyProductFilter);
        document.getElementById('clearSearchBtn').addEventListener('click', () => {
            document.getElementById('productSearch').value = '';
            activeFilter = 'all';
            document.querySelectorAll('.filter-chip').forEach(c => {
                const on = (c.getAttribute('data-filter') || '') === 'all';
                c.classList.toggle('active', on);
                c.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            applyProductFilter();
            document.getElementById('productSearch').focus();
        });
        document.querySelectorAll('.filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                activeFilter = chip.getAttribute('data-filter') || 'all';
                document.querySelectorAll('.filter-chip').forEach(c => {
                    const on = c === chip;
                    c.classList.toggle('active', on);
                    c.setAttribute('aria-pressed', on ? 'true' : 'false');
                });
                applyProductFilter();
            });
        });

        document.getElementById('copyOrderBtn').addEventListener('click', async () => {
            const num = document.getElementById('successOrderNumber').textContent.trim();
            const label = document.getElementById('copyOrderLabel');
            if (!num) return;
            try {
                await navigator.clipboard.writeText(num);
                label.textContent = 'Copied!';
                setTimeout(() => { label.textContent = 'Copy order #'; }, 2000);
            } catch (_) {
                // Fallback
                const ta = document.createElement('textarea');
                ta.value = num;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                label.textContent = 'Copied!';
                setTimeout(() => { label.textContent = 'Copy order #'; }, 2000);
            }
        });

        onStorefrontReady();
