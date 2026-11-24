/* Customer pages: contact form, My orders, review, lab reports, email preferences. */
(function () {
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const money = (c) => (c == null ? '' : '$' + (Number(c) / 100).toFixed(2));
    const tokenFromHash = () => (new URLSearchParams(location.hash.slice(1)).get('t') || '').trim();

    async function post(url, body) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const d = await res.json().catch(() => ({}));
        return { ok: res.ok && d.ok !== false, status: res.status, d };
    }
    function say(el, msg, ok) {
        el.textContent = msg;
        el.className = `text-sm ${ok ? 'text-emerald-300' : 'text-red-400'}`;
        el.classList.remove('hidden');
    }
    function savedEmail() {
        try {
            return (JSON.parse(localStorage.getItem('spbc_contact_draft') || '{}') || {}).email || '';
        } catch (_) {
            return '';
        }
    }

    /* ---------- Contact form ---------- */
    const contact = $('contactForm');
    if (contact) {
        let tsToken = '';
        $('cEmail').value = savedEmail();
        fetch('/api/site-config').then((r) => r.json()).then((cfg) => {
            if (!cfg.turnstile_site_key) return;
            window.spbcContactTs = () => {
                const box = $('contactTurnstile');
                box.classList.remove('hidden');
                window.turnstile.render(box, { sitekey: cfg.turnstile_site_key, theme: 'dark', callback: (t) => (tsToken = t), 'expired-callback': () => (tsToken = '') });
            };
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=spbcContactTs';
            s.async = true;
            document.head.appendChild(s);
        }).catch(() => null);
        contact.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('cBtn');
            btn.disabled = true;
            const r = await post('/api/contact', {
                name: $('cName').value, email: $('cEmail').value, order_number: $('cOrder').value, message: $('cMessage').value, turnstile_token: tsToken || undefined,
            }).catch(() => ({ ok: false, d: {} }));
            say($('cMsg'), r.d.message || (r.ok ? 'Sent.' : 'Could not send. Please email us instead.'), r.ok);
            if (r.ok) {
                $('cMessage').value = '';
                btn.textContent = 'Sent';
            } else {
                btn.disabled = false;
                if (window.turnstile) try { window.turnstile.reset($('contactTurnstile')); tsToken = ''; } catch (_) {}
            }
        });
    }

    /* ---------- My orders ---------- */
    const myForm = $('myOrdersForm');
    if (myForm) {
        $('myEmail').value = savedEmail();
        myForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            $('myBtn').disabled = true;
            const r = await post('/api/my-orders', { action: 'link', email: $('myEmail').value }).catch(() => ({ ok: false, d: {} }));
            say($('myMsg'), r.d.message || 'Something went wrong. Please try again.', r.ok);
            $('myBtn').disabled = false;
        });
        const t = tokenFromHash();
        if (t) loadMyOrders(t);
    }
    async function loadMyOrders(token) {
        const list = $('myOrdersList');
        list.classList.remove('hidden');
        list.innerHTML = '<p class="text-zinc-500 text-sm text-center">Loading your orders…</p>';
        const r = await post('/api/my-orders', { action: 'list', token }).catch(() => ({ ok: false, d: {} }));
        if (!r.ok) {
            list.innerHTML = `<p class="text-red-400 text-sm text-center">${esc(r.d.message || 'Could not load your orders.')}</p>`;
            return;
        }
        history.replaceState(null, '', location.pathname); // keep the link out of the address bar
        $('myOrdersForm').classList.add('hidden');
        list.innerHTML = `<p class="text-sm text-zinc-400 text-center">Orders for <span class="text-white">${esc(r.d.email)}</span></p>` +
            (r.d.orders.length ? r.d.orders.map((o, i) => `<div class="depth-card p-4 space-y-2">
                <div class="flex justify-between gap-2"><p class="text-white font-bold">${esc(o.order_number)}</p><p class="text-sm text-[#EAB308] font-semibold">${esc(o.status_text)}</p></div>
                <p class="text-xs text-zinc-500">${esc(String(o.created_at || '').slice(0, 10))} · ${money(o.total_cents)}</p>
                <ul class="text-sm text-zinc-300">${o.items.filter((it) => it.sku !== 'SALES-TAX').map((it) => `<li>${esc(it.qty)} × ${esc(it.name)}</li>`).join('')}</ul>
                ${o.tracking ? `<p class="text-sm">Tracking: ${o.tracking.url && /^https:\/\//.test(o.tracking.url) ? `<a href="${esc(o.tracking.url)}" target="_blank" rel="noopener" class="text-[#EAB308] hover:underline">${esc(o.tracking.number)}</a>` : esc(o.tracking.number)}</p>` : ''}
                <div class="flex flex-wrap gap-2">
                  <button type="button" data-again="${i}" class="btn-primary px-4 py-2 rounded-xl text-xs font-bold">Order these again</button>
                  <a href="/track.html?order=${encodeURIComponent(o.order_number)}&email=${encodeURIComponent(r.d.email)}" class="btn-secondary px-4 py-2 rounded-xl text-xs">Details, receipt</a>
                </div></div>`).join('') : '<p class="text-zinc-400 text-sm text-center">No orders yet.</p>');
        list.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => orderAgain(r.d.orders[Number(b.dataset.again)].items)));
    }
    function orderAgain(items) {
        const draft = {};
        items.forEach((it) => {
            if (it.sku === 'SALES-TAX') return;
            const isVial = /\(\s*Vial\s*\)\s*$/i.test(it.name) || /-VIAL$/i.test(it.sku || '');
            const name = it.name.replace(/\s+\((?:10-Pack \/ Kit|Kit|Vial)\)\s*$/i, '').trim();
            if (!name || !it.qty) return;
            draft[name] = draft[name] || { vial: 0, pack: 0 };
            if (isVial) draft[name].vial += it.qty;
            else draft[name].pack += it.qty;
        });
        try { localStorage.setItem('spbc_cart_draft', JSON.stringify(draft)); } catch (_) {}
        location.href = '/#prices';
    }

    /* ---------- Review ---------- */
    const reviewForm = $('reviewForm');
    if (reviewForm) {
        const token = tokenFromHash();
        const state = $('reviewState');
        let rating = 0;
        const paint = () => document.querySelectorAll('[data-star]').forEach((b) => {
            const on = Number(b.dataset.star) <= rating;
            b.classList.toggle('text-[#FDD700]', on);
            b.classList.toggle('text-zinc-600', !on);
            b.setAttribute('aria-checked', String(Number(b.dataset.star) === rating));
        });
        document.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => { rating = Number(b.dataset.star); paint(); }));
        if (!token) {
            state.textContent = 'This page opens from the review link in your email.';
        } else {
            post('/api/review', { action: 'get', token }).then((r) => {
                if (!r.ok) { state.textContent = r.d.message || 'This review link is not valid.'; return; }
                if (r.d.done) { state.textContent = 'Thanks, we already have your review for this order.'; return; }
                state.classList.add('hidden');
                reviewForm.classList.remove('hidden');
                $('reviewFor').textContent = `Order ${r.d.order_number}${r.d.products.length ? ': ' + r.d.products.join(', ') : ''}`;
                $('reviewName').value = r.d.name;
            });
        }
        reviewForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!rating) return say($('reviewMsg'), 'Tap the stars to pick a rating.', false);
            $('reviewBtn').disabled = true;
            const r = await post('/api/review', { action: 'save', token, rating, body: $('reviewText').value, display_name: $('reviewName').value }).catch(() => ({ ok: false, d: {} }));
            say($('reviewMsg'), r.d.message || 'Could not send. Please try again.', r.ok);
            if (!r.ok) $('reviewBtn').disabled = false;
            else $('reviewBtn').textContent = 'Sent';
        });
    }

    /* ---------- Lab reports ---------- */
    const labList = $('labList');
    if (labList) {
        document.cookie = 'spbc_member=1; path=/; max-age=31536000; SameSite=Lax';
        fetch('/api/products', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
            const withLab = (d.products || []).filter((p) => p.lab_report);
            if (!withLab.length) {
                labList.innerHTML = '<p class="text-zinc-400 text-sm sm:col-span-2 text-center">Lab reports are coming soon. <a href="/contact.html" class="text-[#EAB308] hover:underline">Ask us</a> about a product.</p>';
                return;
            }
            const draw = (q) => {
                const rows = withLab.filter((p) => !q || p.name.toLowerCase().includes(q));
                labList.innerHTML = rows.map((p) => `<a href="/api/lab-report?p=${encodeURIComponent(p.name)}" target="_blank" rel="noopener" class="depth-card p-4 block group">
                    <p class="font-bold text-zinc-100 group-hover:text-[#EAB308] break-word">${esc(p.name)}</p><p class="text-xs text-emerald-300 mt-1">View lab report ↗</p></a>`).join('') ||
                    '<p class="text-zinc-500 text-sm sm:col-span-2 text-center">No match.</p>';
            };
            draw('');
            $('labSearch').addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
        }).catch(() => { labList.innerHTML = '<p class="text-red-400 text-sm">Could not load lab reports.</p>'; });
    }

    /* ---------- Email preferences ---------- */
    const prefsForm = $('prefsForm');
    if (prefsForm) {
        const token = tokenFromHash();
        const state = $('prefsState');
        const fill = (d) => {
            $('prefsEmail').textContent = `Choices for ${d.email}`;
            $('prefPrice').checked = d.price_alerts;
            $('prefReviews').checked = d.reviews;
            $('prefNews').checked = d.news;
        };
        if (!token) state.textContent = 'This page opens from the "Email Preferences" link at the bottom of our emails.';
        else post('/api/email-prefs', { token }).then((r) => {
            if (!r.ok) { state.textContent = r.d.message || 'This link is not valid.'; return; }
            state.classList.add('hidden');
            prefsForm.classList.remove('hidden');
            fill(r.d);
        });
        prefsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const r = await post('/api/email-prefs', { token, price_alerts: $('prefPrice').checked, reviews: $('prefReviews').checked, news: $('prefNews').checked });
            say($('prefsMsg'), r.d.message || (r.ok ? 'Saved.' : 'Could not save.'), r.ok);
        });
        $('prefsAllOff').addEventListener('click', async () => {
            const r = await post('/api/email-prefs', { token, all_off: true });
            if (r.ok) fill(r.d);
            say($('prefsMsg'), r.ok ? 'You are unsubscribed from all optional emails.' : r.d.message || 'Could not save.', r.ok);
        });
    }
})();
