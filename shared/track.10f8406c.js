/* Track order page: lookup by order number + email, and "Order again". */
(function () {
    const CART_KEY = 'spbc_cart_draft';
    const form = document.getElementById('trackForm');
    if (!form) return;
    const orderEl = document.getElementById('trackOrder');
    const emailEl = document.getElementById('trackEmail');
    const errEl = document.getElementById('trackError');
    const btn = document.getElementById('trackBtn');
    const out = document.getElementById('trackResult');

    // Prefill from ?order=...&email=... (links in emails) or the last checkout.
    const qs = new URLSearchParams(location.search);
    if (qs.get('order')) orderEl.value = qs.get('order');
    if (qs.get('email')) emailEl.value = qs.get('email');
    if (!emailEl.value) {
        try {
            const c = JSON.parse(localStorage.getItem('spbc_contact_draft') || '{}');
            if (c && c.email) emailEl.value = c.email;
        } catch (_) { /* ignore */ }
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showError(msg) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
    }

    /** Cart draft format used by the price list: { name: { vial, pack } }. */
    function orderAgain(items) {
        const draft = {};
        items.forEach((it) => {
            const isVial = /\(\s*Vial\s*\)\s*$/i.test(it.name) || /-VIAL$/i.test(it.sku || '');
            const name = it.name.replace(/\s+\((?:10-Pack \/ Kit|Kit|Vial)\)\s*$/i, '').trim();
            if (!name || !it.qty) return;
            draft[name] = draft[name] || { vial: 0, pack: 0 };
            if (isVial) draft[name].vial += it.qty;
            else draft[name].pack += it.qty;
        });
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(draft));
        } catch (_) { /* ignore */ }
        location.href = '/#prices';
    }

    function render(d) {
        const steps = ['pending_payment', 'paid', 'shipped', 'complete'];
        const at = steps.indexOf(d.status);
        const bar = d.status === 'cancelled'
            ? '<p class="text-red-400 font-semibold">This order was cancelled.</p>'
            : '<ol class="grid grid-cols-4 gap-1 text-[11px] text-center">' +
              ['Ordered', 'Paid', 'Shipped', 'Delivered'].map((label, i) =>
                  `<li class="rounded-lg py-1.5 ${i <= at ? 'bg-[#FDD700] text-black font-bold' : 'bg-zinc-900 text-zinc-500'}">${label}</li>`
              ).join('') + '</ol>';
        let tracking = '';
        if (d.tracking) {
            const num = esc(d.tracking.number);
            tracking = `<div><p class="text-[10px] tracking-[0.2em] uppercase text-zinc-500 mb-1">Tracking</p>
                <p class="text-white">${d.tracking.url ? `<a href="${esc(d.tracking.url)}" target="_blank" rel="noopener" class="text-[#EAB308] hover:underline">${num}</a>` : num}
                ${d.tracking.carrier ? `<span class="text-zinc-400">(${esc(d.tracking.carrier)})</span>` : ''}</p></div>`;
        }
        const items = (d.items || []).map((it) =>
            `<li class="flex justify-between gap-2"><span class="break-word">${esc(it.name)}</span><span class="tabular-nums text-zinc-400">x${esc(it.qty)}</span></li>`
        ).join('');
        out.innerHTML = `
            <div class="flex items-baseline justify-between gap-2">
              <p class="text-white font-bold">Order ${esc(d.order_number)}</p>
              <p class="text-sm text-[#EAB308] font-semibold">${esc(d.status_text)}</p>
            </div>
            ${bar}
            ${tracking}
            <div><p class="text-[10px] tracking-[0.2em] uppercase text-zinc-500 mb-1">Items</p>
              <ul class="text-sm text-zinc-300 space-y-1">${items}</ul></div>
            ${d.total_cents != null ? `<p class="text-sm text-zinc-400">Total: <span class="text-white tabular-nums">$${(Number(d.total_cents) / 100).toFixed(2)}</span></p>` : ''}
            <button type="button" id="orderAgainBtn" class="btn-primary inline-flex w-full justify-center py-3 rounded-xl text-sm font-bold">Order these again</button>
            <p class="text-[11px] text-zinc-500 text-center">Fills your cart with the same items at today's prices. You review before ordering.</p>`;
        out.classList.remove('hidden');
        document.getElementById('orderAgainBtn').addEventListener('click', () => orderAgain(d.items || []));
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl.classList.add('hidden');
        out.classList.add('hidden');
        const order_number = orderEl.value.trim();
        const email = emailEl.value.trim();
        if (!order_number || !email) return showError('Enter your order number and email.');
        btn.disabled = true;
        btn.textContent = 'Looking up…';
        try {
            const res = await fetch('/api/order-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_number, email }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d.ok) return showError(d.message || 'Lookup failed. Please try again.');
            render(d);
        } catch (_) {
            showError('Lookup failed. Please try again.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Look up order';
        }
    });

    if (orderEl.value && emailEl.value && qs.get('order')) form.requestSubmit();
})();
