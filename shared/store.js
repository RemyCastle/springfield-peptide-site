const CART_KEY = "spbc_cart_draft";
        const CONTACT_KEY = "spbc_contact_draft";
        const VIAL_OPTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // single vials: any qty 1–10
        const PACK_OPTS = [0, 1, 2, 3, 5];
        // No volume discounts on SPBC.
        // Order minimum: MIN_ORDER_VIALS single vials, or at least one kit (any mix).
        // Must match functions/lib/orderItems.js.
        const MIN_ORDER_VIALS = 2;
        // Shipping per order (show-me-source dropship). Server sets the real charge; these
        // defaults are replaced by /api/products (shop.shipping).
        let SHIP_RATES = { standard: 10, priority: 18 };
        let shopTax = null; // { state, rate } when Remy turns sales tax on
        let bestSellerSet = new Set();
        let turnstileKey = '';
        let turnstileToken = '';

        /**
         * Public storefront sells single vials (when vial_price is set) and 10-packs / kits.
         * True kit_only products (e.g. HGH, no vial_price) stay kit-only — no vial stepper.
         * Vial-only rows (RETA 66MG: kit_only + vial_price === pack_price, or pack_price 0)
         * show a Vial stepper, not a 10-pack. Minimum order: 2 vials or 1 kit.
         */
        const PUBLIC_KITS_ONLY = false;

        /**
         * Single edit point for storefront category grouping.
         * Keys MUST match product names exactly (join key — never rename products).
         * Unmapped names fall through to FALLBACK_CATEGORY so new products never disappear.
         */
        const FALLBACK_CATEGORY = 'Other Research';
        const PRODUCT_CATEGORY_ORDER = [
            'GLP-1 / Metabolic',
            'Repair & Recovery',
            'Skin & Cosmetic',
            'Longevity & Mitochondrial',
            'GH Secretagogues',
            'Other Research',
            'Supplies',
        ];
        const PRODUCT_CATEGORY_BY_NAME = {
            'SEMA 5MG': 'GLP-1 / Metabolic',
            'SEMA 10MG': 'GLP-1 / Metabolic',
            'CAGRI  5MG': 'GLP-1 / Metabolic',
            'CAGRI 10MG': 'GLP-1 / Metabolic',
            'TIRZ 10MG': 'GLP-1 / Metabolic',
            'TIRZ 30MG': 'GLP-1 / Metabolic',
            'TIRZ 60MG': 'GLP-1 / Metabolic',
            'RETA 10MG': 'GLP-1 / Metabolic',
            'RETA 30MG': 'GLP-1 / Metabolic',
            'RETA 60 MG': 'GLP-1 / Metabolic',
            'RETA 66MG': 'GLP-1 / Metabolic',
            'BPC-157 10MG': 'Repair & Recovery',
            'TB-500 10MG': 'Repair & Recovery',
            'KPV 10 MG': 'Repair & Recovery',
            'KLOW 80MG': 'Repair & Recovery',
            'GHK-CU 50MG': 'Skin & Cosmetic',
            'GHK-cu 100MG': 'Skin & Cosmetic',
            'MOTS-C 10MG': 'Longevity & Mitochondrial',
            'MOTS-C 40MG': 'Longevity & Mitochondrial',
            'SS-31 10MG': 'Longevity & Mitochondrial',
            'SS-31 50MG': 'Longevity & Mitochondrial',
            'NAD+ 500MG': 'Longevity & Mitochondrial',
            'NAD+ 1000MG': 'Longevity & Mitochondrial',
            '5-AMINO-1MQ 50MG': 'Longevity & Mitochondrial',
            'GLUTATHIONE 1200MG': 'Longevity & Mitochondrial',
            'IPA 10MG': 'GH Secretagogues',
            'CJC/IPA NO DAC 10MG': 'GH Secretagogues',
            'Tesamorelin': 'GH Secretagogues',
            'Tesamorelin 10MG': 'GH Secretagogues',
            'Tesamorelin 20MG': 'GH Secretagogues',
            'SEMAX 10MG': 'Other Research',
            'PE-22-28 10MG': 'Other Research',
            'PT-141 10 MG': 'Other Research',
            'MT1': 'Other Research',
            'MT2': 'Other Research',
            'DSIP 10MG': 'Other Research',
            'BAC WATER 2.5ML': 'Supplies',
            'BAC WATER 3ML': 'Supplies',
            'BAC WATER 10 ML': 'Supplies',
            // show-me-source catalog (2026-11-23)
            'TIRZ 100MG': 'GLP-1 / Metabolic',
            'WOLVERINE 20MG': 'Repair & Recovery',
            'GHK-CU 75MG': 'Skin & Cosmetic',
            'SS-31 30MG': 'Longevity & Mitochondrial',
            'EPITHALON': 'Longevity & Mitochondrial',
            'SELANK 10MG': 'Other Research',
            'THYMOSIN A1 10MG': 'Other Research',
            'THYMALIN 10MG': 'Other Research',
            'VIP 10MG': 'Other Research',
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
                if (activeFilter === 'popular') typeOk = card.hasAttribute('data-popular');
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

        /** Set from /api/products: show "Price drop alert" on each card. */
        let priceAlertsOn = false;
        /** Set from /api/products: items total (dollars) that ships free; 0 = off. The server decides the real charge. */
        let freeShipOver = 0;

        function savedContactEmail() {
            try { return (JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}').email) || ''; } catch (_) { return ''; }
        }

        function priceAlertHtml(name) {
            return `<div class="mt-2">
                <button type="button" class="text-[11px] text-zinc-400 hover:text-[#EAB308] underline" data-price-alert-open>Tell me if the price drops</button>
                <form class="hidden mt-1 flex gap-2" data-price-alert="${escapeHtml(name)}" novalidate>
                    <input type="email" required placeholder="Your email" value="${escapeHtml(savedContactEmail())}" aria-label="Email for ${escapeHtml(name)} price alerts"
                           class="min-w-0 flex-1 bg-black border border-zinc-700 rounded-lg px-2 py-1 text-xs text-white">
                    <button type="submit" class="shrink-0 px-2 py-1 rounded-lg text-xs font-bold bg-[#FDD700] text-black">Follow</button>
                </form>
                <p class="text-[11px] hidden" data-price-alert-msg></p>
            </div>`;
        }

        function wirePriceAlert(article) {
            const open = article.querySelector('[data-price-alert-open]');
            const form = article.querySelector('form[data-price-alert]');
            if (!open || !form) return;
            const msg = article.querySelector('[data-price-alert-msg]');
            open.addEventListener('click', () => {
                form.classList.remove('hidden');
                open.classList.add('hidden');
            });
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                msg.classList.remove('hidden');
                msg.className = 'text-[11px] text-zinc-400';
                msg.textContent = 'Saving…';
                try {
                    const res = await fetch('/api/price-watch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ product: form.getAttribute('data-price-alert'), email: form.querySelector('input').value.trim() }),
                    });
                    const d = await res.json().catch(() => ({}));
                    msg.textContent = d.message || (res.ok ? "We'll email you if the price drops." : 'Could not save.');
                    msg.className = `text-[11px] ${res.ok ? 'text-emerald-300' : 'text-red-400'}`;
                    if (res.ok) form.classList.add('hidden');
                } catch (_) {
                    msg.textContent = 'Could not save.';
                    msg.className = 'text-[11px] text-red-400';
                }
            });
        }

        /* ---------- One link per product (/p/<slug>) + native share ---------- */
        const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

        function productSlug(name) {
            return String(name || '').toLowerCase().replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        }

        function shareToast(msg) {
            let t = document.getElementById('spbcShareToast');
            if (!t) {
                t = document.createElement('div');
                t.id = 'spbcShareToast';
                t.className = 'spbc-share-toast';
                t.setAttribute('role', 'status');
                document.body.appendChild(t);
            }
            t.textContent = msg;
            t.hidden = false;
            clearTimeout(shareToast.timer);
            shareToast.timer = setTimeout(function () { t.hidden = true; }, 2200);
        }

        async function shareProduct(name) {
            const url = location.origin + '/p/' + productSlug(name);
            const data = { title: name + ' | Springfield Peptide Buyers Club', url: url };
            if (navigator.share) {
                try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; }
            }
            try {
                await navigator.clipboard.writeText(url);
                shareToast('Link copied');
            } catch (_) {
                window.prompt('Copy this link:', url);
            }
        }

        /** Arrived via /p/<slug>: scroll to that product and outline it once. */
        function openLinkedProduct() {
            const meta = document.querySelector('meta[name="spbc-open-product"]');
            const want = meta ? meta.getAttribute('content') : '';
            if (!want || openLinkedProduct.done) return;
            let ageOk = false;
            try { ageOk = localStorage.getItem('spbc_age_ok') === '1'; } catch (_) { ageOk = true; }
            if (!ageOk) {
                // Wait until the 21+ check is answered, then scroll.
                if (!openLinkedProduct.waiting) {
                    openLinkedProduct.waiting = true;
                    window.addEventListener('spbc:age-ok', function () { setTimeout(openLinkedProduct, 350); }, { once: true });
                }
                return;
            }
            const card = Array.from(document.querySelectorAll('#priceTable .price-card')).find(function (c) {
                return c.getAttribute('data-name') === want;
            });
            if (!card) return;
            openLinkedProduct.done = true;
            card.classList.add('is-linked');
            const r = card.getBoundingClientRect();
            const top = window.scrollY + r.top - Math.max(0, (window.innerHeight - r.height) / 2);
            window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
            setTimeout(function () { card.classList.remove('is-linked'); }, 4000);
        }

        function buildPriceCard(p, draft) {
            const name = p.name;
            const trueKitOnly = isTrueKitOnly(p);
            const vialOnly = isVialOnlyListing(p);
            const showVial = !PUBLIC_KITS_ONLY && hasPositivePrice(p.vial_price);
            const showPack = hasPositivePrice(p.pack_price) && !vialOnly;
            const saved = draft[name] || {};
            // show-me-source's stock limit (single vials). Kits use 10 vials each.
            const maxUnits = Number.isFinite(Number(p.max_units)) && p.max_units !== null ? Number(p.max_units) : null;
            const vialOpts = maxUnits === null ? VIAL_OPTS : VIAL_OPTS.filter((n) => n <= maxUnits);
            const packBase = trueKitOnly ? VIAL_OPTS : PACK_OPTS;
            const packOpts = maxUnits === null ? packBase : packBase.filter((n) => n * 10 <= maxUnits);
            const savedPack = showPack ? storefrontKitQty(saved, packOpts) : 0;
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

            if (bestSellerSet.has(name)) article.setAttribute('data-popular', '1');
            const fewLeft = maxUnits !== null && maxUnits > 0 && maxUnits <= 20;
            let body = `<h3 class="price-card-title break-word">${escapeHtml(name)}</h3>`;
            if (p.low_stock || p.lab_report || fewLeft || bestSellerSet.has(name)) {
                body += '<div class="flex flex-wrap items-center gap-2 mb-2">';
                if (bestSellerSet.has(name)) {
                    body += '<span class="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border border-[#EAB308]/40 text-[#EAB308]">Popular</span>';
                }
                if (fewLeft) {
                    body += `<span class="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border border-amber-700/30 text-amber-300">Only ${maxUnits} vial${maxUnits === 1 ? '' : 's'} left</span>`;
                }
                if (p.low_stock && !fewLeft) {
                    body += '<span class="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border border-amber-700/30 text-amber-300">Low Stock</span>';
                }
                if (p.lab_report) {
                    body += `<a href="/api/lab-report?p=${encodeURIComponent(name)}" target="_blank" rel="noopener" class="text-[11px] font-semibold text-emerald-300 hover:underline">View Lab Report</a>`;
                }
                body += '</div>';
            }
            body += `<div class="price-card-body">`;
            // Vial stepper when D1 has a vial price. True kit_only (HGH) has no vial_price.
            // RETA 66MG is vial-only (same 70/70 dummy pack) — Vial, not 10-pack.
            if (showVial && vialOpts.length > 1) {
                body += `
                    <div class="price-row">
                        <span class="price-label">Vial</span>
                        <div class="price-controls">
                            <span class="price-amount tabular-nums">$${formatPrice(p.vial_price)}</span>
                            ${buildStepper('vial', vialOpts, snapQty(savedVial, vialOpts), name + ' vial qty')}
                        </div>
                    </div>`;
            }
            if (showPack && packOpts.length > 1) {
                body += `
                    <div class="price-row">
                        <span class="price-label">${trueKitOnly ? 'Kit' : 'Kit (10)'}${!trueKitOnly && hasPositivePrice(p.vial_price) && p.vial_price * 10 - p.pack_price >= 1 ? `<span class="kit-save">Save $${formatPrice(p.vial_price * 10 - p.pack_price)}</span>` : ''}</span>
                        <div class="price-controls">
                            <span class="price-amount tabular-nums">$${formatPrice(p.pack_price)}</span>
                            ${buildStepper('pack', packOpts, savedPack, name + ' kit qty')}
                        </div>
                    </div>`;
            }
            body += `</div>`;
            if (priceAlertsOn) body += priceAlertHtml(name);
            body += `<button type="button" class="price-card-share" aria-label="Share ${escapeHtml(name)}" title="Share">${SHARE_ICON}</button>`;
            article.classList.add('has-share');
            article.innerHTML = body;
            article.querySelector('.price-card-share').addEventListener('click', function () { shareProduct(name); });
            wireStepper(article);
            if (priceAlertsOn) wirePriceAlert(article);
            return article;
        }

        /** Sold out at the supplier: name + "Email Me When It's Back". Lives outside #priceTable. */
        function renderSoldOut(list) {
            let box = document.getElementById('soldOutList');
            if (!box) {
                box = document.createElement('div');
                box.id = 'soldOutList';
                box.className = 'mt-8';
                const table = document.getElementById('priceTable');
                table.parentNode.insertBefore(box, table.nextSibling);
            }
            if (!list || !list.length) {
                box.innerHTML = '';
                return;
            }
            const savedEmail = savedContactEmail();
            box.innerHTML = `<h3 class="price-group-heading">Sold Out, Back Soon</h3>
                <div class="grid gap-3 sm:grid-cols-2">` +
                list.map((p) => `
                    <form class="depth-card p-4 space-y-2" data-restock="${escapeHtml(p.name)}" novalidate>
                        <p class="font-bold text-zinc-100 break-word">${escapeHtml(p.name)}</p>
                        <div class="flex gap-2">
                            <input type="email" required placeholder="Your email" value="${escapeHtml(savedEmail)}"
                                   aria-label="Email for ${escapeHtml(p.name)} restock"
                                   class="min-w-0 flex-1 bg-black border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white">
                            <button type="submit" class="shrink-0 px-3 py-2 rounded-xl text-sm font-bold bg-[#FDD700] text-black">Email Me When It's Back</button>
                        </div>
                        <p class="text-xs text-zinc-400 hidden" data-restock-msg></p>
                    </form>`).join('') +
                '</div>';
            box.querySelectorAll('form[data-restock]').forEach((form) => {
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const msg = form.querySelector('[data-restock-msg]');
                    const email = form.querySelector('input').value.trim();
                    msg.classList.remove('hidden');
                    msg.textContent = 'Saving…';
                    try {
                        const res = await fetch('/api/restock-request', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ product: form.getAttribute('data-restock'), email }),
                        });
                        const d = await res.json().catch(() => ({}));
                        msg.textContent = d.message || (res.ok ? "We'll email you when it's back." : 'Could not save. Try again.');
                        msg.className = `text-xs ${res.ok ? 'text-emerald-300' : 'text-red-400'}`;
                    } catch (_) {
                        msg.textContent = 'Could not save. Try again.';
                        msg.className = 'text-xs text-red-400';
                    }
                });
            });
        }

        /** Approved reviews from real buyers (Remy approves each one in the admin). */
        async function loadReviews() {
            try {
                const res = await fetch('/api/review');
                const d = await res.json();
                if (!d.reviews || !d.reviews.length) return;
                let box = document.getElementById('reviewsBox');
                if (!box) {
                    box = document.createElement('div');
                    box.id = 'reviewsBox';
                    box.className = 'mt-10';
                    const after = document.getElementById('soldOutList') || document.getElementById('priceTable');
                    after.parentNode.insertBefore(box, after.nextSibling);
                }
                const stars = (n) => '★★★★★'.slice(0, n) + '<span class="text-zinc-700">' + '★★★★★'.slice(0, 5 - n) + '</span>';
                box.innerHTML = `<h3 class="price-group-heading">What Members Say <span class="text-sm text-zinc-400 font-normal">${d.average}★ from ${d.count} review${d.count === 1 ? '' : 's'}</span></h3>
                    <div class="grid gap-3 sm:grid-cols-2">` +
                    d.reviews.slice(0, 6).map((r) => `<figure class="depth-card p-4 space-y-1">
                        <p class="text-[#EAB308] text-sm" aria-label="${Number(r.rating)} out of 5 stars">${stars(Number(r.rating))}</p>
                        ${r.body ? `<blockquote class="text-sm text-zinc-200">${escapeHtml(r.body)}</blockquote>` : ''}
                        <figcaption class="text-xs text-zinc-400">${escapeHtml(r.display_name)} <span class="text-emerald-300 font-semibold whitespace-nowrap">✓ Verified buyer</span>${r.products ? ' · ' + escapeHtml(r.products) : ''}</figcaption>
                    </figure>`).join('') + '</div>';
            } catch (_) { /* reviews are optional */ }
        }

        function renderProducts(products) {
            window.ppProducts = products;
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
            openLinkedProduct();
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
                priceAlertsOn = !!data.price_alerts;
                freeShipOver = Number(data.free_ship_over) || 0;
                applyShopSettings(data);
                renderProducts(data.products || []);
                renderSoldOut(data.out_of_stock || []);
                loadReviews();
            } catch (e) {
                reportClientProblem('load_products', e && e.message);
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

        /* ---------- Shop settings from /api/products (banners, shipping, tax, popular, bot check) ---------- */
        let shopPaused = '';

        function shippingSpeed() {
            const r = document.querySelector('input[name="ship_speed"]:checked');
            return r && r.value === 'priority' ? 'priority' : 'standard';
        }

        function applyShopSettings(data) {
            if (data.shipping && Number(data.shipping.standard) >= 0 && Number(data.shipping.priority) >= 0) {
                SHIP_RATES = { standard: Number(data.shipping.standard), priority: Number(data.shipping.priority) };
            }
            document.querySelectorAll('[data-speed-price]').forEach((el) => {
                el.textContent = '$' + money(SHIP_RATES[el.getAttribute('data-speed-price')]);
            });
            shopTax = data.tax && Number(data.tax.rate) > 0 ? { state: String(data.tax.state || '').toUpperCase(), rate: Number(data.tax.rate) } : null;
            bestSellerSet = new Set(Array.isArray(data.best_sellers) ? data.best_sellers : []);
            const popChip = document.querySelector('.filter-chip[data-filter="popular"]');
            if (popChip) popChip.hidden = bestSellerSet.size === 0;
            shopPaused = data.vacation ? (data.vacation.message || 'We are taking a short break. Orders are paused for now.') : '';
            const box = document.getElementById('shopBanners');
            if (box) {
                const parts = [];
                if (shopPaused) {
                    parts.push(`<div class="depth-card px-4 py-3 text-sm text-center border border-amber-500/40 text-amber-200" role="status"><strong class="text-amber-300">Orders paused.</strong> ${escapeHtml(shopPaused)}</div>`);
                }
                if (data.announcement) {
                    parts.push(`<div class="depth-card px-4 py-3 text-sm text-center text-zinc-200" role="status">${escapeHtml(data.announcement)}</div>`);
                }
                box.innerHTML = parts.join('');
            }
            if (data.turnstile_site_key && !turnstileKey) {
                turnstileKey = data.turnstile_site_key;
                loadTurnstile();
            }
        }

        function loadTurnstile() {
            const box = document.getElementById('turnstileBox');
            if (!box || !turnstileKey) return;
            window.spbcTurnstileReady = function () {
                box.classList.remove('hidden');
                window.turnstile.render(box, {
                    sitekey: turnstileKey,
                    theme: 'dark',
                    size: 'flexible',
                    callback: (tok) => { turnstileToken = tok; },
                    'expired-callback': () => { turnstileToken = ''; },
                    'error-callback': () => { turnstileToken = ''; },
                });
            };
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=spbcTurnstileReady';
            s.async = true;
            s.defer = true;
            document.head.appendChild(s);
        }

        function resetTurnstile() {
            turnstileToken = '';
            try { if (window.turnstile) window.turnstile.reset(document.getElementById('turnstileBox')); } catch (_) {}
        }

        /** Weekend or USPS holiday (Springfield time): tell people when the order actually goes out. */
        const USPS_HOLIDAYS = new Set([
            '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
            '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
            '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06',
            '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24',
        ]);
        function chicagoDate(d) {
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
            return parts; // YYYY-MM-DD
        }
        function isShipDay(ymd) {
            const dow = new Date(ymd + 'T12:00:00Z').getUTCDay();
            return dow !== 0 && dow !== 6 && !USPS_HOLIDAYS.has(ymd);
        }
        function updateShipDayNote() {
            const el = document.getElementById('shipDayNote');
            if (!el) return;
            const today = chicagoDate(new Date());
            if (isShipDay(today)) {
                el.classList.add('hidden');
                return;
            }
            let d = new Date(today + 'T12:00:00Z');
            for (let i = 0; i < 10; i++) {
                d = new Date(d.getTime() + 86400000);
                const ymd = d.toISOString().slice(0, 10);
                if (isShipDay(ymd)) {
                    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
                    el.textContent = `Post offices are closed today. Orders placed now ship ${label}.`;
                    el.classList.remove('hidden');
                    return;
                }
            }
        }

        /** ZIP check: fill city/state when empty, warn when they don't match the ZIP. */
        let lastZipChecked = '';
        async function checkZip() {
            const zipEl = document.getElementById('shipPostal');
            const hint = document.getElementById('zipHint');
            const zip = (zipEl?.value || '').trim().slice(0, 5);
            if (!/^\d{5}$/.test(zip) || zip === lastZipChecked) return;
            lastZipChecked = zip;
            try {
                const res = await fetch(`/api/address-check?zip=${zip}`);
                if (!res.ok) {
                    if (res.status === 404 && hint) {
                        hint.textContent = `We could not find ZIP ${zip}. Please double-check it.`;
                        hint.classList.remove('hidden');
                    }
                    return;
                }
                const d = await res.json();
                const cityEl = document.getElementById('shipCity');
                const stateEl = document.getElementById('shipState');
                if (cityEl && !cityEl.value.trim() && d.city) cityEl.value = d.city;
                if (stateEl && !stateEl.value.trim() && d.state) stateEl.value = d.state;
                const stateNow = (stateEl?.value || '').trim().toUpperCase();
                const cityNow = (cityEl?.value || '').trim().toLowerCase();
                const cities = (d.cities || [d.city]).map((c) => String(c).toLowerCase());
                let msg = '';
                if (d.state && stateNow && stateNow !== d.state) msg = `ZIP ${zip} is in ${d.state}, not ${stateNow}. Please check your address.`;
                else if (cityNow && cities.length && !cities.includes(cityNow)) msg = `ZIP ${zip} is usually ${d.city}, ${d.state}. Double-check the city if that's not right.`;
                if (hint) {
                    hint.textContent = msg;
                    hint.classList.toggle('hidden', !msg);
                }
                saveContactDraft();
                updateOrder();
            } catch (_) { /* address check is a helper only */ }
        }

        /** Checkout problem reports: no names, emails or addresses, just what broke. */
        let clientReports = 0;
        function reportClientProblem(kind, detail) {
            if (clientReports >= 3) return;
            clientReports += 1;
            try {
                const body = JSON.stringify({ kind, detail: String(detail || '').slice(0, 300), page: location.pathname });
                if (navigator.sendBeacon) navigator.sendBeacon('/api/client-report', new Blob([body], { type: 'application/json' }));
                else fetch('/api/client-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
            } catch (_) {}
        }
        window.addEventListener('error', (e) => {
            if (!e || !e.filename || !/springfieldpbc\.com|localhost|127\.0\.0\.1|pages\.dev/.test(e.filename)) return;
            reportClientProblem('js_error', `${e.message || ''} @ ${String(e.filename).split('/').pop()}:${e.lineno || 0}`);
        });

        function resetPlaceButtons() {
            placingOrder = false;
            submitBtn.disabled = false;
            submitBtn.textContent = 'PLACE ORDER & PAY';
            const confirmBtn = document.getElementById('reviewConfirmBtn');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm & Place Order';
            refreshSubmitEnabled();
        }

        /** Same order placed again within minutes: ask before making a second one. */
        function showDuplicateConfirm(message) {
            const err = document.getElementById('reviewError');
            err.innerHTML = `${escapeHtml(message || 'It looks like you just placed this same order.')}
                <span class="flex flex-col sm:flex-row gap-2 justify-center mt-2">
                    <button type="button" id="dupYesBtn" class="btn-secondary">Yes, place a second order</button>
                    <a href="/track.html" class="btn-secondary text-center">Check my order instead</a>
                </span>`;
            err.classList.remove('hidden');
            document.getElementById('dupYesBtn').addEventListener('click', () => {
                err.classList.add('hidden');
                placeOrder({ confirmDuplicate: true });
            });
        }


        function skuFrom(name, kind) {
            const base = String(name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
            return `${base}-${kind === 'vial' ? 'VIAL' : 'KIT'}`.slice(0, 64);
        }

        function dollarsToCents(d) {
            return Math.round(Number(d) * 100);
        }

        // Discount / referral code: { code, label, prices: { productName: { vial_cents, kit_cents } } }.
        // Display only; the server applies the code again (never below cost) when the order is placed.
        let ACTIVE_CODE = null;
        function codeUnitCents(name, kind, listCents) {
            if (!ACTIVE_CODE || !ACTIVE_CODE.prices) return listCents;
            const p = ACTIVE_CODE.prices[name];
            const v = p ? (kind === 'vial' ? p.vial_cents : p.kit_cents) : null;
            return v == null ? listCents : Math.min(listCents, v);
        }
        function showCodeMsg(text, ok) {
            const el = document.getElementById('codeMsg');
            if (!el) return;
            el.textContent = text;
            el.className = 'text-xs mt-1 ' + (ok ? 'text-emerald-400' : 'text-red-400');
        }
        async function applyCode(raw, quiet) {
            const code = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
            if (!code) { ACTIVE_CODE = null; showCodeMsg('', true); updateOrder(); return; }
            try {
                const r = await fetch('/api/code?c=' + encodeURIComponent(code), { credentials: 'same-origin' });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) {
                    ACTIVE_CODE = null;
                    if (!quiet) showCodeMsg(d.message || 'That code is not valid.', false);
                } else {
                    ACTIVE_CODE = d;
                    showCodeMsg('Code ' + d.code + ' applied: ' + d.label, true);
                    // Codes from shared links stick for 30 days on this device.
                    try { localStorage.setItem('spbc_code', JSON.stringify({ code: d.code, until: Date.now() + 30 * 86400000 })); } catch (_) {}
                }
            } catch (_) {
                if (!quiet) showCodeMsg('Could not check the code. Try again.', false);
            }
            updateOrder();
        }
        document.getElementById('applyCodeBtn')?.addEventListener('click', () => applyCode(document.getElementById('discountCode').value));
        document.getElementById('discountCode')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyCode(e.target.value); }
        });
        // Referral links: springfieldpbc.com/?code=BUDDY15 fills and applies the code.
        (function () {
            let c = '';
            try {
                c = new URLSearchParams(location.search).get('code') || '';
                if (!c) {
                    const saved = JSON.parse(localStorage.getItem('spbc_code') || 'null');
                    if (saved && saved.code && saved.until > Date.now()) c = saved.code;
                    else c = sessionStorage.getItem('spbc_code') || '';
                }
            } catch (_) {}
            if (c) {
                const el = document.getElementById('discountCode');
                if (el) el.value = c.toUpperCase();
                setTimeout(() => applyCode(c, true), 0);
            }
        })();

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
                    lines.push({ kind: 'vial', name, qty: vialQty, text: `${vialQty}x ${name} (Vial) — $${money(line)}` });
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
                    const label = card.hasAttribute('data-kit') && !card.hasAttribute('data-pack') ? 'Kit' : 'Kit (10)';
                    const line = kitQty * packPrice;
                    if (isBac) {
                        nonDiscountSubtotal += line;
                    } else {
                        kitCount += kitQty;
                        packSubtotal += line;
                    }
                    lines.push({ kind: 'pack', name, qty: kitQty, text: `${kitQty}x ${name} (${label}) — $${money(line)}` });
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

            // No volume discounts on SPBC — every item bills at full price.
            const vialDiscountEligible = false;
            const vialDiscount = 0;
            const kitRate = 0;
            const kitDiscount = 0;
            const kitDiscountPct = 0;
            const subtotal = vialSubtotal + packSubtotal + nonDiscountSubtotal;
            // Code discount (dollars): normal price minus the code price on each line.
            let codeDiscount = 0;
            for (const r of rawLines) {
                const list = dollarsToCents(r.unit_price_dollars);
                const baseName = r.name.replace(/\s+\((?:Vial|Kit(?: \(10\))?)\)$/, '');
                codeDiscount += ((list - codeUnitCents(baseName, r.kind === 'vial' ? 'vial' : 'kit', list)) * r.qty) / 100;
            }
            codeDiscount = Math.round(codeDiscount * 100) / 100;
            if (codeDiscount > 0) lines.push({ kind: 'code', text: `Code ${ACTIVE_CODE.code} (${ACTIVE_CODE.label}) — -$${money(codeDiscount)}` });
            const hasAny = singleVials > 0 || kitCount > 0;
            const freeShip = freeShipOver > 0 && subtotal - codeDiscount >= freeShipOver;
            const speed = shippingSpeed();
            // Free shipping covers Standard; Priority then costs only the difference.
            const shipping = !hasAny ? 0 : freeShip
                ? (speed === 'priority' ? Math.max(0, SHIP_RATES.priority - SHIP_RATES.standard) : 0)
                : SHIP_RATES[speed];
            const shipState = (document.getElementById('shipState')?.value || '').trim().toUpperCase();
            const tax = hasAny && shopTax && shipState === shopTax.state
                ? Math.round(subtotal * shopTax.rate) / 100
                : 0;
            const total = subtotal - codeDiscount + shipping + tax;
            const minimumMet = kitCount >= 1 || singleVials >= MIN_ORDER_VIALS;

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
                subtotal,
                codeDiscount,
                shipping,
                speed,
                freeShip,
                tax,
                minimumMet,
                total,
                lines,
                items,
            };
        }

        function discountProgressMeta(t) {
            // No volume discounts. Progress tracks the 2-vial / 1-kit minimum.
            if (PUBLIC_KITS_ONLY) {
                if (t.kitCount > 0) {
                    return { pct: 100, hint: 'Ready to order' };
                }
                return { pct: 0, hint: 'Add a kit to start your order' };
            }
            if (t.singleVials === 0 && t.kitCount === 0) {
                return { pct: 0, hint: `Add ${MIN_ORDER_VIALS} vials or 1 kit to start your order` };
            }
            if (!t.minimumMet) {
                const need = MIN_ORDER_VIALS - t.singleVials;
                return {
                    pct: Math.round((t.singleVials / MIN_ORDER_VIALS) * 100),
                    hint: `Add ${need} more vial${need === 1 ? '' : 's'} or any kit (${MIN_ORDER_VIALS}-vial minimum)`,
                };
            }
            if (freeShipOver > 0 && t.subtotal < freeShipOver) {
                return { pct: 100, hint: `Ready to order · add $${money(freeShipOver - t.subtotal)} more for free shipping` };
            }
            if (freeShipOver > 0) return { pct: 100, hint: 'Ready to order · free shipping' };
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
                    const label = String(parts[0] || '').replace(/^\d+x\s+/, '');
                    const step = l.name
                        ? `<span class="sticky-mini-step"><button type="button" data-dir="-1" aria-label="One less ${escapeHtml(label)}">−</button><span>${escapeHtml(String(l.qty))}</span><button type="button" data-dir="1" aria-label="One more ${escapeHtml(label)}">+</button></span>`
                        : '';
                    return `<div class="sticky-line" data-name="${escapeHtml(l.name || '')}" data-kind="${escapeHtml(l.kind || '')}">${step}<span class="break-word min-w-0 flex-1">${escapeHtml(l.name ? label : (parts[0] || ''))}</span><span class="text-[#EAB308] tabular-nums shrink-0">${escapeHtml(parts[1] || '')}</span></div>`;
                }).join('');
                linesEl.querySelectorAll('.sticky-mini-step button').forEach((btn) => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const line = btn.closest('.sticky-line');
                        const card = Array.from(document.querySelectorAll('#priceTable .price-card')).find((c) => c.getAttribute('data-name') === line.getAttribute('data-name'));
                        const sel = card && card.querySelector('select[data-kind="' + (line.getAttribute('data-kind') === 'pack' ? 'pack' : 'vial') + '"]');
                        if (sel) stepQty(sel, parseInt(btn.getAttribute('data-dir'), 10) || 0);
                    });
                });
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
                if (t.codeDiscount > 0) orderText += `\nCode ${ACTIVE_CODE.code}: -$${money(t.codeDiscount)}`;
                orderText += `\nShipping (${t.speed === 'priority' ? 'Priority' : 'Standard'}): $${money(t.shipping)}`;
                if (t.tax) orderText += `\nSales tax: $${money(t.tax)}`;
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
                    ? 'Kits only · ready to order'
                    : 'Kits only — add a kit to start your order';
                tone = t.kitCount > 0 ? 'text-zinc-400' : 'text-zinc-500';
            } else if (t.singleVials === 0 && t.packSubtotal === 0) {
                status = `Add ${MIN_ORDER_VIALS} vials or 1 kit to start your order`;
                tone = 'text-zinc-500';
            } else if (!t.minimumMet) {
                status = `${t.singleVials} vial · minimum is ${MIN_ORDER_VIALS} vials or 1 kit`;
                tone = 'text-amber-300';
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
            if (shopPaused) return { ok: false, reason: 'Orders are paused right now. ' + shopPaused };
            if (!t.lines.length) return { ok: false, reason: 'Select at least one item.' };
            if (!t.minimumMet) {
                return { ok: false, reason: `Minimum order is ${MIN_ORDER_VIALS} vials or 1 kit.` };
            }
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
            const rs = document.getElementById('reviewShipping');
            if (rs) rs.textContent = t.shipping ? `$${money(t.shipping)}` : 'Free';
            const rsl = document.getElementById('reviewShippingLabel');
            if (rsl) rsl.textContent = `Shipping (${t.speed === 'priority' ? 'Priority' : 'Standard'})`;
            const taxRow = document.getElementById('reviewTaxRow');
            if (taxRow) {
                taxRow.classList.toggle('hidden', !t.tax);
                document.getElementById('reviewTax').textContent = `$${money(t.tax)}`;
                document.getElementById('reviewTaxLabel').textContent = shopTax ? `Sales tax (${shopTax.state})` : 'Sales tax';
            }
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

        async function placeOrder(opts) {
            const confirmDuplicate = !!(opts && opts.confirmDuplicate === true);
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
                        // Server sets the real shipping; these are display hints only.
                        shipping_cents: dollarsToCents(tallyOrder().shipping),
                        total_cents: subtotalFinal + dollarsToCents(tallyOrder().shipping),
                        currency: 'USD',
                        notes: notes || undefined,
                        shipping,
                        shipping_speed: shippingSpeed(),
                        delivery_notes: (document.getElementById('deliveryNotes')?.value || '').trim() || undefined,
                        confirm_duplicate: confirmDuplicate || undefined,
                        turnstile_token: turnstileToken || undefined,
                        code: ACTIVE_CODE ? ACTIVE_CODE.code : undefined,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.status === 409 && data.error === 'possible_duplicate') {
                    resetPlaceButtons();
                    showDuplicateConfirm(data.message);
                    return;
                }
                if (!res.ok || !data.ok) {
                    // The server calls a failed bot check 'bot_check_failed' (older builds said 'turnstile_failed').
                    const botFail = data.error === 'bot_check_failed' || data.error === 'turnstile_failed';
                    if (!['not_enough_stock', 'paused', 'validation_failed', 'order_minimum', 'rate_limited', 'bad_code'].includes(data.error) && !botFail) {
                        reportClientProblem('place_order', `${res.status} ${data.error || ''}`);
                    }
                    if (botFail) resetTurnstile();
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
                    '$' + (Number(data.total_cents || subtotalFinal + dollarsToCents(t.shipping)) / 100).toFixed(2) +
                    (data.perk === 'free_shipping' ? ' (free shipping, thanks for coming back!)' : data.perk === 'free_shipping_over' ? ' (free shipping)' : '');
                document.getElementById('successPayLink').href =
                    data.pay_url || `https://spbc-orders.remycastle.workers.dev/pay/${encodeURIComponent(data.order_number)}`;
                const trackLink = document.getElementById('successTrackLink');
                if (trackLink) {
                    trackLink.href = `/track.html?order=${encodeURIComponent(data.order_number)}&email=${encodeURIComponent(email)}`;
                }
                const shipLink = document.getElementById('successShipLink');
                shipLink.href =
                    data.shipping_url || `https://spbc-orders.remycastle.workers.dev/shipping/${encodeURIComponent(data.order_number)}`;
                const shipNote = document.getElementById('successShipNote');
                if (data.shipping_saved === false) {
                    if (shipNote) shipNote.textContent = 'We still need your shipping address — use the link below.';
                    shipLink.textContent = 'Enter shipping address';
                    shipLink.classList.add('ring-2', 'ring-amber-400');
                } else {
                    if (shipNote) shipNote.textContent = 'Shipping address is on file.';
                    shipLink.textContent = 'Edit Shipping Address';
                }

                box.scrollIntoView({ behavior: 'smooth', block: 'center' });

                if (data.pay_url) {
                    window.setTimeout(() => {
                        window.location.href = data.pay_url;
                    }, 1600);
                }
            } catch (err) {
                if (err && err.name === 'TypeError') reportClientProblem('place_order', 'network');
                const msg = err.message || 'Could not place order. Please try again.';
                document.getElementById('reviewError').textContent = msg;
                document.getElementById('reviewError').classList.remove('hidden');
                document.getElementById('submitError').textContent = msg;
                document.getElementById('submitError').classList.remove('hidden');
                placingOrder = false;
                submitBtn.disabled = false;
                submitBtn.textContent = 'PLACE ORDER & PAY';
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Confirm & Place Order';
                refreshSubmitEnabled();
            }
        }

        agreeCheckbox.addEventListener('change', refreshSubmitEnabled);
        document.querySelectorAll('input[name="ship_speed"]').forEach((r) => r.addEventListener('change', () => {
            try { localStorage.setItem('spbc_ship_speed', shippingSpeed()); } catch (_) {}
            updateOrder();
        }));
        try {
            const savedSpeed = localStorage.getItem('spbc_ship_speed');
            const radio = savedSpeed && document.querySelector(`input[name="ship_speed"][value="${savedSpeed}"]`);
            if (radio) radio.checked = true;
        } catch (_) {}
        document.getElementById('shipState')?.addEventListener('change', updateOrder);
        document.getElementById('shipPostal')?.addEventListener('blur', checkZip);
        updateShipDayNote();
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

        document.getElementById('reviewConfirmBtn').addEventListener('click', () => placeOrder());
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
                setTimeout(() => { label.textContent = 'Copy Order #'; }, 2000);
            } catch (_) {
                // Fallback
                const ta = document.createElement('textarea');
                ta.value = num;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                label.textContent = 'Copied!';
                setTimeout(() => { label.textContent = 'Copy Order #'; }, 2000);
            }
        });

        onStorefrontReady();

/* ---------- Shop extras (2026-11-25): same set as Patriotic's shop-extras.js ----------
 * Sort, favorites, quick look (tap a product name: per-mg prices, compare two, calculator,
 * lab report, reviews), Enter-to-add from search, back to top, BAC water suggestion in the
 * cart, share-cart link, order your usual again. Cards stay as they are apart from a small
 * chevron on the name and a star when you favorite one.
 */
(function () {
  'use strict';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const fmt = (n) => (Number(n) % 1 ? Number(n).toFixed(2) : String(Number(n)));
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  const FAV_KEY = 'spbc_favorites';
  const SORT_KEY = 'spbc_sort';
  const USUAL_KEY = 'spbc_usual';
  const cartKey = typeof CART_KEY === 'string' ? CART_KEY : 'spbc_cart_draft';

  function toast(msg) {
    if (typeof shareToast === 'function') return shareToast(msg);
  }

  /* ---------- products as rendered ---------- */
  function cards() { return $$('#priceTable .price-card'); }
  function cardFor(name) { return cards().find((c) => c.getAttribute('data-name') === name) || null; }
  function productFor(name) {
    const list = window.ppProducts || [];
    return list.find((p) => (typeof displayProductName === 'function' ? displayProductName(p.name) : p.name) === name) || null;
  }
  function mgOf(name) {
    const m = String(name).match(/(\d[\d.]*)\s*mg\b/i);
    return m ? Number(m[1]) : null;
  }
  function unitPrice(card) {
    return Number(card.getAttribute('data-vial') || card.getAttribute('data-kit') || card.getAttribute('data-pack') || 0);
  }

  /* ---------- favorites (star on the photo corner, float to the top) ---------- */
  const favs = new Set(store.get(FAV_KEY, []));
  function toggleFav(name) {
    if (favs.has(name)) favs.delete(name); else favs.add(name);
    store.set(FAV_KEY, Array.from(favs));
    decorate();
    applySort();
  }

  /* ---------- sort ---------- */
  function addSortMenu() {
    const search = $('#productSearch');
    if (!search || $('#ppSort')) return;
    const wrap = document.createElement('div');
    wrap.className = 'pp-sort-row';
    wrap.innerHTML =
      '<label for="ppSort" class="pp-sort-label">Sort</label>' +
      '<select id="ppSort" class="pp-sort">' +
      '<option value="featured">Featured</option>' +
      '<option value="low">Price: low to high</option>' +
      '<option value="high">Price: high to low</option>' +
      '<option value="az">Name A to Z</option>' +
      '</select>';
    // Outside the search box wrapper, so an icon positioned inside it stays put.
    const anchor = search.parentElement && search.parentElement.querySelector('.absolute') ? search.parentElement : search;
    anchor.insertAdjacentElement('afterend', wrap);
    const sel = $('#ppSort');
    sel.value = store.get(SORT_KEY, 'featured');
    sel.addEventListener('change', () => { store.set(SORT_KEY, sel.value); applySort(); });
  }
  let sorting = false;
  function applySort() {
    const mode = ($('#ppSort') && $('#ppSort').value) || 'featured';
    const by = {
      featured: (a, b) => (favs.has(b.dataset.name) - favs.has(a.dataset.name)) || (a.dataset.origIndex - b.dataset.origIndex),
      low: (a, b) => unitPrice(a) - unitPrice(b),
      high: (a, b) => unitPrice(b) - unitPrice(a),
      az: (a, b) => a.dataset.name.localeCompare(b.dataset.name),
    }[mode];
    sorting = true;
    $$('#priceTable .price-group-grid').forEach((grid) => {
      const list = $$('.price-card', grid);
      list.forEach((c, i) => { if (!c.dataset.origIndex) c.dataset.origIndex = String(i); });
      const sorted = list.slice().sort(by);
      if (!sorted.every((c, i) => c === list[i])) sorted.forEach((c) => grid.appendChild(c));
    });
    sorting = false;
  }

  /* ---------- per-card touches (photo opens quick look, favorite star) ---------- */
  function decorate() {
    cards().forEach((card) => {
      const name = card.getAttribute('data-name');
      const title = $('.price-card-title', card);
      if (title && !title.dataset.ql) {
        title.dataset.ql = '1';
        title.classList.add('pp-ql-title');
        title.setAttribute('role', 'button');
        title.setAttribute('tabindex', '0');
        title.setAttribute('aria-label', 'More about ' + name);
        title.insertAdjacentHTML('beforeend', '<span class="pp-chev" aria-hidden="true">›</span>');
        title.addEventListener('click', () => openQuickLook(name));
        title.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openQuickLook(name); } });
      }
      let star = $('.card-fav', card);
      if (favs.has(name)) {
        if (!star && title) {
          star = document.createElement('span');
          star.className = 'card-fav';
          star.setAttribute('aria-label', 'In your favorites');
          star.textContent = '★ ';
          title.insertBefore(star, title.firstChild);
        }
      } else if (star) star.remove();
    });
  }

  /* ---------- quick look sheet ---------- */
  let reviews = null;
  async function loadReviews() {
    if (reviews) return reviews;
    try { const r = await fetch('/api/review'); reviews = r.ok ? ((await r.json()).reviews || []) : []; } catch (_) { reviews = []; }
    return reviews;
  }
  function ensureSheet() {
    let d = $('#ppQuickLook');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'ppQuickLook';
    d.className = 'pp-sheet';
    d.setAttribute('aria-labelledby', 'ppQlTitle');
    document.body.appendChild(d);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => { if (location.hash === '#look') history.back(); });
    return d;
  }
  function priceLines(card) {
    const out = [];
    const v = card.getAttribute('data-vial');
    const pk = card.getAttribute('data-pack');
    const kit = card.getAttribute('data-kit');
    const mg = mgOf(card.dataset.name);
    if (v) out.push(['Single vial', '$' + fmt(v) + (mg ? ' · $' + (v / mg).toFixed(2) + '/mg' : '')]);
    if (pk) out.push(['Kit (10)', '$' + fmt(pk) + (mg ? ' · $' + (pk / (mg * 10)).toFixed(2) + '/mg' : '')]);
    if (kit) out.push(['Kit', '$' + fmt(kit)]);
    return out;
  }
  async function openQuickLook(name) {
    const card = cardFor(name);
    if (!card) return;
    const d = ensureSheet();
    const p = productFor(name) || {};
    const img = $('.card-vial', card);
    const lab = $('a[href*="lab-report"]', card);
    const others = cards().map((c) => c.dataset.name).filter((n) => n !== name);
    d.innerHTML =
      '<div class="pp-sheet-inner">' +
      '<button type="button" class="pp-sheet-x" aria-label="Close">×</button>' +
      (img ? '<img class="pp-sheet-img" src="' + esc(img.getAttribute('src')) + '" alt="">' : '') +
      '<h2 id="ppQlTitle" class="pp-sheet-title">' + esc(name) + '</h2>' +
      '<p class="pp-sheet-stars" hidden></p>' +
      '<dl class="pp-sheet-prices">' + priceLines(card).map((l) => '<div><dt>' + l[0] + '</dt><dd>' + l[1] + '</dd></div>').join('') + '</dl>' +
      '<div class="pp-sheet-actions">' +
      '<button type="button" class="pp-act" data-act="fav">' + (favs.has(name) ? '★ Favorite' : '☆ Add to favorites') + '</button>' +
      '<button type="button" class="pp-act" data-act="share">Share</button>' +
      '<a class="pp-act" href="/calculator.html?p=' + encodeURIComponent(name) + '">Dose calculator</a>' +
      (lab ? '<a class="pp-act" href="' + esc(lab.getAttribute('href')) + '" target="_blank" rel="noopener noreferrer">Lab report</a>' : '') +
      '</div>' +
      (others.length ? '<label class="pp-compare-label" for="ppCompare">Compare with</label><select id="ppCompare" class="pp-sort"><option value="">Pick a product…</option>' +
        others.map((n) => '<option>' + esc(n) + '</option>').join('') + '</select><div id="ppCompareOut"></div>' : '') +
      '<p class="pp-sheet-note">For laboratory research only.</p>' +
      '</div>';
    $('.pp-sheet-x', d).addEventListener('click', () => d.close());
    $('[data-act="fav"]', d).addEventListener('click', (e) => {
      toggleFav(name);
      e.currentTarget.textContent = favs.has(name) ? '★ Favorite' : '☆ Add to favorites';
    });
    $('[data-act="share"]', d).addEventListener('click', () => { if (typeof shareProduct === 'function') shareProduct(name); });
    const cmp = $('#ppCompare', d);
    if (cmp) cmp.addEventListener('change', () => renderCompare(name, cmp.value));
    if (!d.open) {
      d.showModal();
      history.pushState({ ppLook: 1 }, '', '#look');
    }
    // Stars only when this product has reviews.
    const list = (await loadReviews()).filter((r) => String(r.products || '').toUpperCase().includes(name.toUpperCase()));
    if (list.length && d.open) {
      const avg = list.reduce((a, r) => a + Number(r.rating || 0), 0) / list.length;
      const s = $('.pp-sheet-stars', d);
      s.textContent = '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) + '  ' + avg.toFixed(1) + ' (' + list.length + ' review' + (list.length === 1 ? '' : 's') + ')';
      s.setAttribute('aria-label', avg.toFixed(1) + ' out of 5 stars from ' + list.length + ' reviews');
      s.hidden = false;
    }
  }
  function renderCompare(a, b) {
    const out = $('#ppCompareOut');
    if (!out) return;
    if (!b) { out.innerHTML = ''; return; }
    const ca = cardFor(a); const cb = cardFor(b);
    if (!ca || !cb) return;
    const rows = (c) => {
      const mg = mgOf(c.dataset.name);
      const v = Number(c.getAttribute('data-vial') || 0);
      const k = Number(c.getAttribute('data-pack') || c.getAttribute('data-kit') || 0);
      return [
        mg ? mg + ' mg' : '—',
        v ? '$' + fmt(v) : '—',
        v && mg ? '$' + (v / mg).toFixed(2) : '—',
        k ? '$' + fmt(k) : '—',
        $('a[href*="lab-report"]', c) ? 'Yes' : '—',
      ];
    };
    const labels = ['Amount', 'Vial', 'Per mg (vial)', 'Kit', 'Lab report'];
    const ra = rows(ca); const rb = rows(cb);
    out.innerHTML = '<table class="pp-compare"><thead><tr><th></th><th>' + esc(a) + '</th><th>' + esc(b) + '</th></tr></thead><tbody>' +
      labels.map((l, i) => '<tr><th scope="row">' + l + '</th><td>' + ra[i] + '</td><td>' + rb[i] + '</td></tr>').join('') + '</tbody></table>';
  }
  // Phone back button closes the sheet instead of leaving the page.
  window.addEventListener('popstate', () => { const d = $('#ppQuickLook'); if (d && d.open) d.close(); });

  /* ---------- quick add from search: Enter with exactly one match adds it ---------- */
  function wireSearchAdd() {
    const input = $('#productSearch');
    if (!input || input.dataset.quickAdd) return;
    input.dataset.quickAdd = '1';
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const shown = cards().filter((c) => !c.classList.contains('hidden'));
      if (shown.length !== 1 || !input.value.trim()) return;
      e.preventDefault();
      const card = shown[0];
      const sel = $('select[data-kind="vial"]', card) || $('select[data-kind="pack"]', card);
      if (!sel || typeof stepQty !== 'function') return;
      stepQty(sel, 1);
      toast('Added ' + card.dataset.name);
    });
    input.setAttribute('aria-describedby', 'ppSearchTip');
    const tip = document.createElement('p');
    tip.id = 'ppSearchTip';
    tip.className = 'sr-only';
    tip.textContent = 'When only one product matches, press Enter to add it to your cart.';
    (input.parentElement || input).appendChild(tip);
  }

  /* ---------- back to top ---------- */
  function addBackToTop() {
    if ($('#ppTop')) return;
    const b = document.createElement('button');
    b.id = 'ppTop';
    b.type = 'button';
    b.className = 'pp-top';
    b.setAttribute('aria-label', 'Back to top');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
    b.hidden = true;
    b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.body.appendChild(b);
    const place = () => {
      b.hidden = window.scrollY < window.innerHeight * 2;
      const bar = $('#stickyOrderBar');
      const barUp = bar && bar.getAttribute('aria-hidden') === 'false';
      const covered = barUp ? Math.max(0, window.innerHeight - bar.getBoundingClientRect().top) : 0;
      b.style.bottom = covered ? (covered + 12) + 'px' : 'calc(16px + env(safe-area-inset-bottom))';
    };
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    window.ppPlaceTop = place;
    place();
  }

  /* ---------- cart drawer: one suggestion (BAC water) + share this cart ---------- */
  function suggestInCart() {
    const lines = $('#stickyLines');
    if (!lines) return;
    const old = $('.pp-suggest', lines);
    if (old) old.remove();
    const inCart = $$('.sticky-line', lines).map((l) => l.getAttribute('data-name') || '');
    if (!inCart.length || inCart.some((n) => /bac/i.test(n))) return;
    const bac = cards().find((c) => /bac\s*water/i.test(c.dataset.name));
    if (!bac) return;
    const sel = $('select[data-kind="vial"]', bac) || $('select[data-kind="pack"]', bac);
    if (!sel) return;
    const row = document.createElement('div');
    row.className = 'pp-suggest';
    row.innerHTML = '<span>Need ' + esc(bac.dataset.name) + '?</span><button type="button">+ Add</button>';
    $('button', row).addEventListener('click', (e) => { e.stopPropagation(); stepQty(sel, 1); });
    lines.appendChild(row);
  }
  function addShareCart() {
    const actions = $('.sticky-actions');
    if (!actions || $('#ppShareCart')) return;
    const b = document.createElement('button');
    b.id = 'ppShareCart';
    b.type = 'button';
    b.className = 'pp-share-cart';
    b.setAttribute('aria-label', 'Share this cart');
    b.title = 'Share this cart';
    b.innerHTML = typeof SHARE_ICON === 'string' ? SHARE_ICON : 'Share';
    b.addEventListener('click', async () => {
      const draft = store.get(cartKey, {});
      if (!Object.keys(draft).length) return;
      const code = btoa(unescape(encodeURIComponent(JSON.stringify(draft)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const url = location.origin + '/?cart=' + code;
      if (navigator.share) { try { await navigator.share({ title: 'My SPBC cart', url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(url); toast('Cart link copied'); } catch (_) { window.prompt('Copy this link:', url); }
    });
    actions.insertBefore(b, actions.firstChild);
  }
  // Opening a shared cart link: load it into this device's cart before the list renders.
  (function takeSharedCart() {
    const params = new URLSearchParams(location.search);
    const code = params.get('cart');
    if (!code) return;
    try {
      const json = decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/'))));
      const draft = JSON.parse(json);
      const clean = {};
      Object.keys(draft || {}).slice(0, 40).forEach((k) => {
        const v = Number(draft[k] && draft[k].vial) || 0;
        const p = Number(draft[k] && draft[k].pack) || 0;
        if ((v > 0 || p > 0) && v <= 50 && p <= 50) clean[String(k).slice(0, 80)] = { vial: v, pack: p };
      });
      if (Object.keys(clean).length) { store.set(cartKey, clean); window.ppSharedCartLoaded = true; }
    } catch (_) { /* bad link: ignore */ }
    params.delete('cart');
    history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
  })();

  /* ---------- your usual: last order, one tap to load it again when the cart is empty ---------- */
  function wireUsual() {
    const form = $('#orderForm');
    if (form && !form.dataset.usual) {
      form.dataset.usual = '1';
      form.addEventListener('submit', () => { window.ppPendingUsual = store.get(cartKey, {}); }, true);
      const ok = $('#orderSuccess');
      if (ok) new MutationObserver(() => {
        if (!ok.classList.contains('hidden') && window.ppPendingUsual && Object.keys(window.ppPendingUsual).length) {
          store.set(USUAL_KEY, window.ppPendingUsual);
          window.ppPendingUsual = null;
        }
      }).observe(ok, { attributes: true, attributeFilter: ['class'] });
    }
    showUsual();
  }
  function showUsual() {
    const usual = store.get(USUAL_KEY, {});
    const names = Object.keys(usual).filter((n) => cardFor(n));
    const cartEmpty = !Object.keys(store.get(cartKey, {})).length;
    let row = $('#ppUsual');
    if (!names.length || !cartEmpty) { if (row) row.remove(); return; }
    if (!row) {
      row = document.createElement('div');
      row.id = 'ppUsual';
      row.className = 'pp-usual';
      const sortRow = $('.pp-sort-row');
      (sortRow || $('#productSearch')).insertAdjacentElement('afterend', row);
    }
    row.innerHTML = '<button type="button">Order your usual again <span>(' + names.length + ' item' + (names.length === 1 ? '' : 's') + ')</span></button>';
    $('button', row).addEventListener('click', () => {
      names.forEach((n) => {
        const card = cardFor(n);
        ['vial', 'pack'].forEach((kind) => {
          const want = Number(usual[n][kind]) || 0;
          const sel = card && $('select[data-kind="' + kind + '"]', card);
          if (!sel || !want) return;
          let guard = 0;
          while ((parseInt(sel.value, 10) || 0) < want && guard++ < 60) stepQty(sel, 1);
        });
      });
      if (typeof saveCartDraft === 'function') saveCartDraft();
      row.remove();
      toast('Your usual is in the cart');
    });
  }

  /* ---------- paste a list: "BPC-157 x3, tirz 30 kit" -> preview -> add ---------- */
  const loose = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  function parseList(text) {
    const all = cards().map((c) => ({ card: c, name: c.dataset.name, key: loose(c.dataset.name), base: loose(String(c.dataset.name).replace(/\d[\d.]*\s*(mg|ml|mcg|iu)\b/ig, '')) }));
    return String(text || '').split(/[\n,;]+/).map((raw) => raw.trim()).filter(Boolean).slice(0, 40).map((raw) => {
      const l = loose(raw);
      // Longest full name (with dose) inside the line wins; else a name without the dose if only one size exists.
      let hit = all.filter((p) => p.key && l.includes(p.key)).sort((a, b) => b.key.length - a.key.length)[0];
      if (!hit) {
        const byBase = all.filter((p) => p.base && l.includes(p.base));
        const doseM = raw.match(/(\d[\d.]*)\s*(mg|ml|mcg|iu)?\b/i);
        if (byBase.length === 1) hit = byBase[0];
        else if (byBase.length > 1 && doseM) hit = byBase.find((p) => loose(p.name).includes(loose(doseM[1] + (doseM[2] || 'mg'))));
      }
      if (!hit) {
        // Short names: "tirz", "reta", "sema" match the start of the full name.
        const word = loose((raw.toLowerCase().match(/[a-z][a-z+-]{2,}/) || [''])[0]);
        const byPrefix = word.length >= 3 ? all.filter((p) => p.base.startsWith(word)) : [];
        const doseN = (raw.match(/(\d[\d.]*)\s*(mg|ml|mcg|iu)?\b/i) || [])[1];
        if (byPrefix.length === 1) hit = byPrefix[0];
        else if (byPrefix.length > 1 && doseN) hit = byPrefix.find((p) => new RegExp('(^|[^\\d.])' + doseN.replace('.', '\\.') + '\\s*(mg|ml|mcg|iu)', 'i').test(p.name));
      }
      if (!hit) return { raw, ok: false };
      const kitWanted = /\bkits?\b|\b10.?pack\b/i.test(raw);
      let rest = raw.replace(/\d[\d.]*\s*(mg|ml|mcg|iu)\b/ig, ' ').replace(/\b(?!x\d)[a-z]+-?\d+\b/ig, ' ').replace(/\b\d+-[a-z]+\b/ig, ' ');
      // "tirz 30 kit": the 30 is the size, not how many.
      const sizeM = String(hit.name).match(/(\d[\d.]*)\s*(mg|ml|mcg|iu)\b/i);
      if (sizeM) rest = rest.replace(new RegExp('(^|[^\\d.])' + sizeM[1].replace('.', '\\.') + '(?![\\d.])'), '$1 ');
      const qm = rest.match(/(?:^|[^\d])(\d{1,2})(?!\d)/);
      const qty = Math.max(1, Math.min(20, qm ? parseInt(qm[1], 10) : 1));
      const vialSel = $('select[data-kind="vial"]', hit.card);
      const packSel = $('select[data-kind="pack"]', hit.card);
      const sel = kitWanted ? (packSel || vialSel) : (vialSel || packSel);
      const kind = sel === packSel ? 'kit' : 'vial';
      return { raw, ok: !!sel, name: hit.name, sel, qty, kind };
    });
  }
  function openPasteList() {
    let d = $('#ppPaste');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'ppPaste';
      d.className = 'pp-sheet';
      d.setAttribute('aria-labelledby', 'ppPasteTitle');
      d.innerHTML = '<div class="pp-sheet-inner">' +
        '<button type="button" class="pp-sheet-x" aria-label="Close">×</button>' +
        '<h2 id="ppPasteTitle" class="pp-sheet-title">Paste a list</h2>' +
        '<label for="ppPasteText" class="pp-compare-label">One product per line. Add a number for how many, and "kit" for kits.</label>' +
        '<textarea id="ppPasteText" class="pp-paste-text" rows="5" placeholder="BPC-157 x3&#10;Tirzepatide 30mg kit"></textarea>' +
        '<div id="ppPasteOut" class="pp-paste-out" aria-live="polite"></div>' +
        '<div class="pp-sheet-actions"><button type="button" class="pp-act" id="ppPasteAdd" disabled>Add to cart</button></div>' +
        '</div>';
      document.body.appendChild(d);
      $('.pp-sheet-x', d).addEventListener('click', () => d.close());
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      const ta = $('#ppPasteText', d);
      const out = $('#ppPasteOut', d);
      const add = $('#ppPasteAdd', d);
      let rows = [];
      ta.addEventListener('input', () => {
        rows = parseList(ta.value);
        out.innerHTML = rows.map((r) => r.ok
          ? '<p class="ok">✓ ' + esc(r.name) + ' · ' + r.qty + ' ' + r.kind + (r.qty === 1 ? '' : 's') + '</p>'
          : '<p class="no">Not found: ' + esc(r.raw) + '</p>').join('');
        add.disabled = !rows.some((r) => r.ok);
      });
      add.addEventListener('click', () => {
        let n = 0;
        rows.filter((r) => r.ok).forEach((r) => {
          for (let i = 0; i < r.qty; i++) {
            const before = r.sel.value;
            stepQty(r.sel, 1);
            if (r.sel.value === before) break; // hit the most allowed
            n += 1;
          }
        });
        if (typeof saveCartDraft === 'function') saveCartDraft();
        d.close();
        ta.value = '';
        out.innerHTML = '';
        add.disabled = true;
        toast(n ? 'Added to your cart' : 'Nothing could be added');
      });
    }
    d.showModal();
    setTimeout(() => { const ta = $('#ppPasteText'); if (ta) ta.focus(); }, 50);
  }
  function addPasteLink() {
    const row = $('.pp-sort-row');
    if (!row || $('#ppPasteBtn')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'ppPasteBtn';
    b.className = 'pp-paste';
    b.textContent = 'Paste a list';
    b.addEventListener('click', openPasteList);
    row.insertBefore(b, row.firstChild);
  }

  /* ---------- run after every (re)render of the list ---------- */
  let queued = false;
  function afterRender() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      addSortMenu();
      addPasteLink();
      wireSearchAdd();
      decorate();
      applySort();
      wireUsual();
      addShareCart();
      if (window.ppSharedCartLoaded) { window.ppSharedCartLoaded = false; toast('Shared cart loaded'); }
    }, 0);
  }
  function start() {
    const table = $('#priceTable');
    if (table) new MutationObserver(() => { if (!sorting) afterRender(); }).observe(table, { childList: true });
    const lines = $('#stickyLines');
    if (lines) new MutationObserver((m) => {
      if (m.some((x) => Array.from(x.addedNodes).some((n) => n.classList && n.classList.contains('pp-suggest')))) return;
      suggestInCart();
      showUsual();
      if (window.ppPlaceTop) setTimeout(window.ppPlaceTop, 350);
    }).observe(lines, { childList: true });
    addBackToTop();
    afterRender();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
