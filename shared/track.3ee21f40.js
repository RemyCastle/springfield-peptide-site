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
            if (it.sku === 'SALES-TAX' || /^ADJ-/i.test(it.sku || '')) return; // tax, code discount, store credit
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
                <p class="text-white">${d.tracking.url && /^https:\/\//.test(d.tracking.url) ? `<a href="${esc(d.tracking.url)}" target="_blank" rel="noopener" class="text-[#EAB308] hover:underline">${num}</a>` : num}
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
            <p class="text-[11px] text-zinc-500 text-center">Fills your cart with the same items at today's prices. You review before ordering.</p>
            <div class="flex flex-wrap gap-2 justify-center">
              <button type="button" id="receiptBtn" class="btn-secondary px-4 py-2 rounded-xl text-xs">Download receipt</button>
              ${d.can_cancel ? '<button type="button" id="cancelBtn" class="px-4 py-2 rounded-xl text-xs font-bold border border-red-700 text-red-300 hover:bg-red-950">Cancel this order</button>' : ''}
            </div>
            <p id="cancelMsg" class="text-sm text-center hidden" role="status"></p>`;
        out.classList.remove('hidden');
        document.getElementById('orderAgainBtn').addEventListener('click', () => orderAgain(d.items || []));
        document.getElementById('receiptBtn').addEventListener('click', () => receipt(d));
        const cancelBtn = document.getElementById('cancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => cancelOrder(d, cancelBtn));
    }

    /** Ask twice, then cancel an order that is still waiting for payment. */
    async function cancelOrder(d, btn) {
        if (btn.dataset.sure !== '1') {
            btn.dataset.sure = '1';
            btn.textContent = 'Tap again to cancel it';
            return;
        }
        btn.disabled = true;
        const msg = document.getElementById('cancelMsg');
        try {
            const res = await fetch('/api/order-cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order_number: d.order_number, email: emailEl.value.trim() }),
            });
            const r = await res.json().catch(() => ({}));
            msg.textContent = r.message || (res.ok ? 'Cancelled.' : 'Could not cancel.');
            msg.className = `text-sm text-center ${res.ok ? 'text-emerald-300' : 'text-red-400'}`;
            if (res.ok) setTimeout(() => form.requestSubmit(), 1200);
            else btn.disabled = false;
        } catch (_) {
            msg.textContent = 'Could not cancel. Please contact us.';
            msg.className = 'text-sm text-center text-red-400';
            btn.disabled = false;
        }
    }

    /** Printable receipt in a new window (print it or save it as a PDF). */
    function receipt(d) {
        const r = d.receipt || {};
        const m = (c) => (c == null ? '' : '$' + (Number(c) / 100).toFixed(2));
        const rows = (d.items || []).map((it) => `<tr><td>${esc(it.name)}</td><td style="text-align:right">${esc(it.qty)}</td>
            <td style="text-align:right">${m(it.unit_price_cents)}</td><td style="text-align:right">${m(it.unit_price_cents * it.qty)}</td></tr>`).join('');
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(`<!doctype html><meta charset="utf-8"><title>Receipt ${esc(d.order_number)}</title>
<style>body{font-family:Arial,sans-serif;max-width:640px;margin:32px auto;color:#111;padding:0 16px}table{width:100%;border-collapse:collapse}td,th{padding:6px 4px;border-bottom:1px solid #ddd;font-size:14px}th{text-align:left;font-size:12px;color:#555}.t td{border:0}@media print{button{display:none}}</style>
<h1 style="margin:0">Springfield Peptide Buyers Club</h1><p style="color:#555;margin:4px 0 20px">springfieldpbc.com · Receipt</p>
<p><strong>Order ${esc(d.order_number)}</strong><br>${esc(r.customer_name || '')}<br>Ordered ${esc(String(d.created_at || '').slice(0, 10))}${r.paid_at ? ` · Paid ${esc(String(r.paid_at).slice(0, 10))}` : ''}<br>Status: ${esc(d.status_text)}</p>
<table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Each</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody>
<tbody class="t"><tr><td colspan="3" style="text-align:right">Items + tax</td><td style="text-align:right">${m(r.subtotal_cents)}</td></tr>
<tr><td colspan="3" style="text-align:right">Shipping</td><td style="text-align:right">${m(r.shipping_cents)}</td></tr>
<tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td style="text-align:right"><strong>${m(d.total_cents)}</strong></td></tr>
${r.paid_cents ? `<tr><td colspan="3" style="text-align:right">Paid</td><td style="text-align:right">${m(r.paid_cents)}</td></tr>` : ''}</tbody></table>
<p style="font-size:12px;color:#555;margin-top:24px">All products are research chemicals for laboratory research use only.</p>
<button onclick="print()" style="margin-top:12px;padding:8px 16px">Print / save as PDF</button>`);
        w.document.close();
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
            btn.textContent = 'Look Up Order';
        }
    });

    if (orderEl.value && emailEl.value && qs.get('order')) form.requestSubmit();
})();
