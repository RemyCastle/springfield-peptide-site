/*
 * SPBC admin tools (loaded after the main admin script; uses its helpers: escapeHtml,
 * escapeAttr, formatCents, showLogin, showOrderDetail, productList, productsCache).
 *   - "To do" bar + search everything
 *   - customer notes/tags + one-tap messages on an order
 *   - risk flags on the Orders list
 *   - Price list: margins, price history, bulk edit, change log with Undo
 *   - Money tab: supplier bill check
 *   - Two-step login setup
 *   - installable admin (manifest + service worker)
 */
(function () {
  const ORDERS_BASE = 'https://spbc-orders.remycastle.workers.dev';
  const $ = (id) => document.getElementById(id);
  const money = (n) => (n == null ? '—' : '$' + Number(n).toFixed(2));

  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { credentials: 'same-origin' });
    if (res.status === 401) {
      showLogin();
      throw new Error('Signed out');
    }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.message || d.error || `Failed (${res.status})`);
    return d;
  }

  function toast(msg, ok = true) {
    let t = $('toolsToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toolsToast';
      t.className = 'fixed z-[200] left-1/2 -translate-x-1/2 bottom-4 px-4 py-2 rounded-xl text-sm font-semibold shadow-lg';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = t.className.replace(/bg-\S+|text-(black|white)/g, '') + (ok ? ' bg-emerald-600 text-white' : ' bg-red-700 text-white');
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(() => (t.hidden = true), 3500);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch (_) {
      window.prompt('Copy this:', text);
    }
  }

  /* ---------------- To do bar + search ---------------- */
  function injectTop() {
    const app = $('appSection');
    if (!app || $('todoBar')) return;
    const wrap = document.createElement('div');
    wrap.className = 'space-y-2 mb-3';
    wrap.innerHTML = `
      <div id="todoBar" class="flex flex-wrap gap-2 text-xs"></div>
      <form id="globalSearchForm" class="flex gap-2" role="search">
        <input id="globalSearch" type="search" enterkeyhint="search" placeholder="Search orders: name, email, phone or order #"
               class="admin-input flex-1 text-sm" aria-label="Search orders">
        <button type="submit" class="bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-4 rounded-xl text-sm">Search</button>
      </form>
      <div id="searchResults" class="hidden admin-card p-3 text-sm space-y-1"></div>`;
    app.insertBefore(wrap, app.firstElementChild);
    $('globalSearchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch($('globalSearch').value);
    });
  }

  async function loadTodo() {
    const bar = $('todoBar');
    if (!bar) return;
    try {
      const d = await api('/api/admin/tools?view=todo');
      const chip = (n, label, tab, warn) =>
        `<button type="button" data-todo-tab="${tab}" class="px-3 py-1.5 rounded-full border ${n ? (warn ? 'border-red-500 text-red-300' : 'border-[#FDD700] text-[#FDD700]') : 'border-zinc-700 text-zinc-500'}">${label}: <strong>${n == null ? '?' : n}</strong></button>`;
      const syncBad = d.last_sync && d.last_sync.status === 'error';
      bar.innerHTML =
        chip(d.to_place, 'To place', 'place') +
        chip(d.unpaid, 'Waiting for payment', 'orders') +
        chip(d.holds + d.new_products, 'Supplier items to check', 'sync') +
        (d.problems ? chip(d.problems, 'Checkout problems today', 'sync', true) : '') +
        (syncBad ? '<button type="button" data-todo-tab="sync" class="px-3 py-1.5 rounded-full border border-red-500 text-red-300">Supplier check failing</button>' : '');
      bar.querySelectorAll('[data-todo-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.todoTab)));
    } catch (_) {
      bar.innerHTML = '';
    }
  }

  async function runSearch(q) {
    const box = $('searchResults');
    q = String(q || '').trim();
    if (q.length < 2) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = '<p class="text-zinc-500">Searching…</p>';
    try {
      const d = await api(`/api/admin/tools?view=search&q=${encodeURIComponent(q)}`);
      let html = `<div class="flex justify-between"><p class="font-semibold text-white">Results for “${escapeHtml(q)}”</p>
        <button type="button" data-search-close class="text-zinc-400 hover:text-white">Close</button></div>`;
      if (d.orders_error) html += `<p class="text-red-400">${escapeHtml(d.orders_error)}</p>`;
      html += d.orders.length
        ? d.orders.map((o) => `<button type="button" data-search-order="${escapeAttr(o.order_number)}"
            class="block w-full text-left border-t border-zinc-800 py-1.5 hover:bg-zinc-800/60 rounded">
            <strong class="text-[#FDD700]">${escapeHtml(o.order_number)}</strong> · ${escapeHtml(o.customer_name || '')}
            <span class="text-zinc-500">${escapeHtml(o.customer_email || '')}</span> · ${formatCents(o.total_cents)} · ${escapeHtml(o.status)}
            <span class="text-zinc-600">${escapeHtml(String(o.created_at || '').slice(0, 10))}</span></button>`).join('')
        : '<p class="text-zinc-500">No orders found.</p>';
      if (d.notes.length) {
        html += '<p class="font-semibold text-white pt-2">Customer notes</p>' +
          d.notes.map((n) => `<p class="border-t border-zinc-800 py-1"><span class="text-zinc-300">${escapeHtml(n.email)}</span>
            ${n.tags ? `<span class="text-[11px] text-emerald-300">${escapeHtml(n.tags)}</span>` : ''} <span class="text-zinc-400">${escapeHtml(n.note || '')}</span></p>`).join('');
      }
      box.innerHTML = html;
      box.querySelector('[data-search-close]').addEventListener('click', () => box.classList.add('hidden'));
      box.querySelectorAll('[data-search-order]').forEach((b) =>
        b.addEventListener('click', async () => {
          await switchTab('orders');
          showOrderDetail(b.dataset.searchOrder);
          $('orderDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        })
      );
    } catch (e) {
      box.innerHTML = `<p class="text-red-400">${escapeHtml(e.message)}</p>`;
    }
  }

  /* ---------------- Order: customer notes + messages ---------------- */
  function templates(o) {
    const first = String(o.customer_name || '').trim().split(/\s+/)[0] || 'there';
    const num = o.order_number;
    const total = formatCents(o.total_cents);
    const pay = `${ORDERS_BASE}/pay/${encodeURIComponent(num)}`;
    const ship = `${ORDERS_BASE}/shipping/${encodeURIComponent(num)}`;
    const track = `https://springfieldpbc.com/track.html?order=${encodeURIComponent(num)}`;
    return {
      pay_reminder: {
        label: 'Payment reminder',
        subject: `Your SPBC order ${num} is waiting for payment`,
        text: `Hi ${first}, just a reminder that your SPBC order ${num} (${total}) is waiting for payment.\n\nPay here (your order number is filled in for you): ${pay}\n\nThanks!`,
      },
      need_address: {
        label: 'Need address',
        subject: `Shipping address for SPBC order ${num}`,
        text: `Hi ${first}, we still need your shipping address for order ${num}.\n\nAdd it here: ${ship}\n\nThanks!`,
      },
      shipped: {
        label: 'Shipped',
        subject: `Your SPBC order ${num} shipped`,
        text: `Hi ${first}, your SPBC order ${num} is on its way.\n\n${o.tracking_url ? `Track it here: ${o.tracking_url}` : `Check it here: ${track}`}\n\nThanks for your order!`,
      },
      delay: {
        label: 'Small delay',
        subject: `Update on SPBC order ${num}`,
        text: `Hi ${first}, a quick update on order ${num}: it is taking a little longer than usual to ship. It will go out as soon as possible and you will get tracking by email.\n\nSorry for the wait, and thanks for your patience!`,
      },
      thanks: {
        label: 'Thank you',
        subject: 'Thanks from SPBC',
        text: `Hi ${first}, thanks again for your order ${num}! If anything is not right, just reply to this email.`,
      },
      custom: { label: 'Write my own', subject: `About your SPBC order ${num}`, text: `Hi ${first}, ` },
    };
  }

  async function customerBox(o) {
    const helper = $('smsHelper');
    if (!helper || !o || !o.order_number) return;
    let box = $('customerBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'customerBox';
      helper.parentNode.insertBefore(box, helper);
    }
    const email = String(o.customer_email || '').toLowerCase();
    const realEmail = email.includes('@') && !email.endsWith('@springfieldpbc.com');
    const T = templates(o);
    let data = { note: null, messages: [] };
    if (realEmail) {
      try {
        data = await api(`/api/admin/tools?view=customer&email=${encodeURIComponent(email)}`);
      } catch (_) { /* shown empty */ }
    }
    const n = data.note || {};
    box.innerHTML = `<div class="grid gap-3 sm:grid-cols-2">
      <div class="border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 class="text-xs uppercase tracking-wide text-[#FDD700]">Customer notes</h3>
        ${realEmail ? `<input id="custTags" class="admin-input text-sm" placeholder="Tags, like vip, wholesale, slow payer" value="${escapeAttr(n.tags || '')}">
        <textarea id="custNote" rows="3" class="admin-input text-sm" placeholder="Only you see this">${escapeHtml(n.note || '')}</textarea>
        <button type="button" id="custSave" class="bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs">Save note</button>`
        : '<p class="text-xs text-zinc-500">No email on this order, so notes cannot be kept for this customer.</p>'}
      </div>
      <div class="border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 class="text-xs uppercase tracking-wide text-[#FDD700]">Message the customer</h3>
        <select id="msgTpl" class="admin-input text-sm">${Object.entries(T).map(([k, t]) => `<option value="${k}">${escapeHtml(t.label)}</option>`).join('')}</select>
        <textarea id="msgText" rows="5" class="admin-input text-sm"></textarea>
        <div class="flex flex-wrap gap-2">
          ${realEmail ? '<button type="button" id="msgSend" class="bg-[#FDD700] hover:bg-white text-black font-bold px-3 py-1.5 rounded-xl text-xs">Email it</button>' : ''}
          <button type="button" id="msgCopy" class="bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-3 py-1.5 rounded-xl text-xs">Copy for a text</button>
        </div>
        ${data.messages.length ? `<ul class="text-[11px] text-zinc-500">${data.messages.slice(0, 5).map((m) => `<li>${escapeHtml(String(m.created_at).slice(0, 16))} · ${escapeHtml(m.subject || m.template)} ${m.sent_ok ? '' : '<span class="text-red-400">(failed)</span>'}</li>`).join('')}</ul>` : ''}
      </div></div>`;
    const pickTpl = () => {
      const t = T[$('msgTpl').value];
      $('msgText').value = t.text;
    };
    const smart = o.status === 'pending_payment' ? (o.shipping_complete ? 'pay_reminder' : 'pay_reminder') : o.status === 'shipped' ? 'shipped' : o.status === 'paid' ? (o.shipping_complete ? 'delay' : 'need_address') : 'thanks';
    $('msgTpl').value = smart;
    pickTpl();
    $('msgTpl').addEventListener('change', pickTpl);
    $('msgCopy').addEventListener('click', () => copy($('msgText').value));
    $('msgSend')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const t = T[$('msgTpl').value];
        const r = await api('/api/admin/tools', { action: 'send_message', email, order_number: o.order_number, template: $('msgTpl').value, subject: t.subject, text: $('msgText').value });
        toast(r.message);
        customerBox(o);
      } catch (err) {
        toast(err.message, false);
        btn.disabled = false;
      }
    });
    $('custSave')?.addEventListener('click', async () => {
      try {
        const r = await api('/api/admin/tools', { action: 'customer_note', email, note: $('custNote').value, tags: $('custTags').value });
        toast(r.message);
      } catch (err) {
        toast(err.message, false);
      }
    });
  }

  /* ---------------- Orders list: risk flags ---------------- */
  const THROWAWAY = /@(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|sharklasers|trashmail|getnada|dispostable|maildrop|fakeinbox|throwawaymail)\./i;
  function riskFlags(o, orders) {
    const flags = [];
    const email = String(o.customer_email || '').toLowerCase();
    const total = Number(o.total_cents || 0) / 100;
    const same = (orders || []).filter((x) => String(x.customer_email || '').toLowerCase() === email);
    if (THROWAWAY.test(email)) flags.push('throwaway email address');
    if (total >= 600 && same.length <= 1) flags.push(`first order and large (${money(total)})`);
    const day = new Date(o.created_at || 0).getTime();
    const sameDay = same.filter((x) => Math.abs(new Date(x.created_at || 0).getTime() - day) < 86400000);
    if (sameDay.length >= 3) flags.push(`${sameDay.length} orders from this email in one day`);
    const name = String(o.customer_name || '').trim();
    if (name && !/\s/.test(name)) flags.push('only one name given');
    return flags;
  }
  function riskChip(o, orders) {
    if (!email(o)) return '';
    const f = riskFlags(o, orders);
    return f.length ? ` <span class="ml-1 text-[11px] px-1.5 py-0.5 rounded bg-red-950 border border-red-700 text-red-300" title="${escapeAttr(f.join(' · '))}">check: ${escapeHtml(f[0])}${f.length > 1 ? ` +${f.length - 1}` : ''}</span>` : '';
  }
  const email = (o) => String(o.customer_email || '').includes('@');

  /* ---------------- Price list: margins, history, bulk, change log ---------------- */
  let margins = new Map();
  async function afterProducts() {
    const list = typeof productList !== 'undefined' ? productList : null;
    if (!list) return;
    injectBulkBar(list);
    try {
      const d = await api('/api/admin/tools?view=margins');
      margins = new Map(d.margins.map((m) => [String(m.id), m]));
    } catch (_) {
      margins = new Map();
    }
    list.querySelectorAll('article[data-id]').forEach((card) => {
      if (card.querySelector('[data-tools]')) return;
      const m = margins.get(String(card.dataset.id)) || {};
      const line = (label, x) => (x ? `${label}: cost ${money(x.cost)} · profit <strong class="${x.profit >= 0 ? 'text-emerald-300' : 'text-red-400'}">${money(x.profit)}</strong> (${x.pct}%)` : '');
      const parts = [line('Vial', m.vial), line('Kit', m.kit)].filter(Boolean);
      const div = document.createElement('div');
      div.dataset.tools = '1';
      div.className = 'flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 border-t border-zinc-800 pt-2';
      div.innerHTML = `<label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" data-bulk-pick class="accent-[#FDD700]"> Select</label>
        <span>${parts.length ? parts.join(' · ') : '<span class="text-zinc-600">No supplier cost yet</span>'}</span>
        <button type="button" data-history class="underline hover:text-white">Price history</button>`;
      card.insertBefore(div, card.firstElementChild);
      div.querySelector('[data-history]').addEventListener('click', () => showHistory(card.querySelector('[data-field="name"]').value));
      div.querySelector('[data-bulk-pick]').addEventListener('change', updateBulkCount);
    });
  }

  function injectBulkBar(list) {
    if ($('bulkBar')) return;
    const bar = document.createElement('div');
    bar.id = 'bulkBar';
    bar.className = 'admin-card p-3 mb-3 flex flex-wrap items-center gap-2 text-sm';
    bar.innerHTML = `<span id="bulkCount" class="text-zinc-400">0 selected</span>
      <button type="button" data-bulk-all class="border border-zinc-600 text-zinc-300 px-2 py-1 rounded-lg text-xs">Select all</button>
      <select id="bulkOp" class="admin-input text-sm w-auto">
        <option value="show">Show on shop</option><option value="hide">Hide from shop</option>
        <option value="add_vial">Change vial price by $</option><option value="add_kit">Change kit price by $</option></select>
      <input id="bulkAmount" type="number" step="1" placeholder="+5 or -5" class="admin-input text-sm w-24">
      <button type="button" id="bulkApply" class="bg-[#FDD700] hover:bg-white text-black font-bold px-3 py-1.5 rounded-xl text-xs">Apply</button>
      <button type="button" id="changeLogBtn" class="ml-auto border border-zinc-600 text-zinc-300 px-3 py-1.5 rounded-xl text-xs">Change log / Undo</button>
      <div id="changeLog" class="hidden w-full"></div>`;
    list.parentNode.insertBefore(bar, list);
    bar.querySelector('[data-bulk-all]').addEventListener('click', () => {
      const boxes = [...document.querySelectorAll('[data-bulk-pick]')];
      const on = boxes.some((b) => !b.checked);
      boxes.forEach((b) => (b.checked = on));
      updateBulkCount();
    });
    $('bulkApply').addEventListener('click', async () => {
      const ids = [...document.querySelectorAll('[data-bulk-pick]:checked')].map((b) => b.closest('article').dataset.id);
      try {
        const r = await api('/api/admin/tools', { action: 'bulk', ids, op: $('bulkOp').value, amount: $('bulkAmount').value });
        toast(r.message);
        await loadProducts();
      } catch (e) {
        toast(e.message, false);
      }
    });
    $('changeLogBtn').addEventListener('click', toggleChangeLog);
  }
  function updateBulkCount() {
    const n = document.querySelectorAll('[data-bulk-pick]:checked').length;
    const el = $('bulkCount');
    if (el) el.textContent = `${n} selected`;
  }

  async function toggleChangeLog() {
    const box = $('changeLog');
    if (!box.classList.contains('hidden')) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = '<p class="text-zinc-500 text-xs">Loading…</p>';
    try {
      const d = await api('/api/admin/tools?view=changes');
      box.innerHTML = d.changes.length
        ? '<ul class="text-xs divide-y divide-zinc-800 mt-2">' + d.changes.map((c) => `<li class="py-1.5 flex flex-wrap justify-between gap-2">
            <span><span class="text-zinc-500">${escapeHtml(String(c.created_at).slice(0, 16))}</span> · ${escapeHtml(c.label)} ${describe(c)}</span>
            ${c.undone_at ? '<span class="text-zinc-600">undone</span>' : `<button type="button" data-undo="${c.id}" class="border border-zinc-600 text-zinc-200 px-2 py-0.5 rounded-lg">Undo</button>`}</li>`).join('') + '</ul>'
        : '<p class="text-zinc-500 text-xs mt-2">No changes yet.</p>';
      box.querySelectorAll('[data-undo]').forEach((b) =>
        b.addEventListener('click', async () => {
          try {
            const r = await api('/api/admin/tools', { action: 'undo', id: b.dataset.undo });
            toast(r.message);
            box.classList.add('hidden');
            await loadProducts();
            toggleChangeLog();
          } catch (e) {
            toast(e.message, false);
          }
        })
      );
    } catch (e) {
      box.innerHTML = `<p class="text-red-400 text-xs">${escapeHtml(e.message)}</p>`;
    }
  }
  function describe(c) {
    try {
      const b = JSON.parse(c.before || '{}') || {};
      const a = JSON.parse(c.after || '{}') || {};
      const keys = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      return '<span class="text-zinc-500">(' + keys.map((k) => `${escapeHtml(k)}: ${escapeHtml(String(b[k] ?? '—'))} → ${escapeHtml(String(a[k] ?? '—'))}`).join(', ') + ')</span>';
    } catch (_) {
      return '';
    }
  }

  async function showHistory(name) {
    let modal = $('historyModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'historyModal';
      modal.className = 'fixed inset-0 z-[150] bg-black/80 flex items-start sm:items-center justify-center p-4 overflow-auto';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.dataset.close) modal.remove();
      });
    }
    modal.innerHTML = '<div class="w-full max-w-md bg-zinc-900 border border-[#FDD700]/30 rounded-2xl p-5"><p class="text-zinc-400 text-sm">Loading…</p></div>';
    try {
      const d = await api(`/api/admin/tools?view=history&product=${encodeURIComponent(name)}`);
      modal.firstElementChild.innerHTML = `<div class="flex justify-between items-start mb-3"><h2 class="ducks-font text-2xl text-[#FDD700]">${escapeHtml(name)}</h2>
        <button type="button" data-close="1" class="text-zinc-400 hover:text-white text-2xl leading-none">&times;</button></div>
        ${d.history.length ? `<table class="w-full text-sm"><thead><tr class="text-left text-xs text-zinc-500"><th>When</th><th>By</th><th class="text-right">Vial</th><th class="text-right">Kit</th></tr></thead><tbody>
          ${d.history.map((h) => `<tr class="border-t border-zinc-800"><td class="py-1 text-xs">${escapeHtml(String(h.when).slice(0, 10))}</td><td class="text-xs">${escapeHtml(h.who)}</td>
            <td class="text-right tabular-nums">${h.vial == null ? '—' : '$' + h.vial}</td><td class="text-right tabular-nums">${h.kit == null ? '—' : '$' + h.kit}</td></tr>`).join('')}</tbody></table>`
          : '<p class="text-zinc-500 text-sm">No price changes recorded yet.</p>'}`;
    } catch (e) {
      modal.firstElementChild.innerHTML = `<p class="text-red-400">${escapeHtml(e.message)}</p>`;
    }
  }

  /* ---------------- Money tab: supplier bill check ---------------- */
  function billCheck(d, body) {
    const bc = d && d.bill_check;
    if (!bc || !body) return;
    const div = document.createElement('div');
    div.className = 'admin-card p-4';
    if (!bc.ready) {
      div.innerHTML = '<p class="font-semibold text-white">Supplier bill check</p><p class="text-xs text-zinc-500">Starts after the next supplier check saves today\'s show-me-source costs.</p>';
    } else {
      const flagged = bc.orders.filter((o) => o.flag);
      div.innerHTML = `<p class="font-semibold text-white mb-1">Supplier bill check ${flagged.length ? `<span class="text-red-300 text-sm">(${flagged.length} to look at)</span>` : '<span class="text-emerald-300 text-sm">(all fine)</span>'}</p>
        <p class="text-xs text-zinc-500 mb-2">What show-me-source charged vs. what it costs at today's pricing-code prices + $${Number(bc.ship).toFixed(2)} shipping. Prices change, so small gaps on old orders are normal.</p>
        <table class="w-full text-xs"><thead><tr class="text-left text-zinc-500"><th>Order</th><th>Date</th><th class="text-right">Charged</th><th class="text-right">Expected</th><th class="text-right">Gap</th></tr></thead><tbody>
        ${bc.orders.slice(0, 15).map((o) => `<tr class="border-t border-zinc-800 ${o.flag ? 'text-red-300' : ''}"><td class="py-1">${escapeHtml(o.sms)} <span class="text-zinc-500">${escapeHtml(o.name || '')}</span></td>
          <td>${escapeHtml(String(o.date || '').slice(0, 10))}</td><td class="text-right">${money(o.charged)}</td><td class="text-right">${money(o.expected)}</td>
          <td class="text-right">${o.diff == null ? '<span class="text-zinc-600">can\'t tell</span>' : (o.diff > 0 ? '+' : '') + money(o.diff).replace('$-', '-$')}</td></tr>`).join('')}</tbody></table>`;
    }
    body.appendChild(div);
  }

  /* ---------------- Two-step login ---------------- */
  async function securityModal() {
    let modal = $('securityModal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'securityModal';
    modal.className = 'fixed inset-0 z-[150] bg-black/80 flex items-start sm:items-center justify-center p-4 overflow-auto';
    modal.innerHTML = '<div class="w-full max-w-md bg-zinc-900 border border-[#FDD700]/30 rounded-2xl p-5 space-y-3 text-sm"><p class="text-zinc-400">Loading…</p></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.dataset.close) modal.remove();
    });
    const panel = modal.firstElementChild;
    const head = '<div class="flex justify-between items-start"><h2 class="ducks-font text-2xl text-[#FDD700]">Two-step login</h2><button type="button" data-close="1" class="text-zinc-400 hover:text-white text-2xl leading-none">&times;</button></div>';
    const s = await api('/api/admin/tools?view=security').catch(() => ({}));
    if (s.totp_on) {
      panel.innerHTML = `${head}<p class="text-emerald-300">On. Signing in needs your password and a code from your authenticator app.</p>
        <p class="text-zinc-400">To turn it off, enter a current code:</p>
        <input id="totpOffCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="admin-input" placeholder="123456">
        <button type="button" id="totpOffBtn" class="border border-red-700 text-red-300 font-bold px-4 py-2 rounded-xl">Turn off</button><p id="totpMsg" class="text-xs"></p>`;
      $('totpOffBtn').addEventListener('click', async () => {
        try {
          const r = await api('/api/admin/tools', { action: 'totp_off', code: $('totpOffCode').value });
          toast(r.message);
          modal.remove();
        } catch (e) {
          $('totpMsg').textContent = e.message;
          $('totpMsg').className = 'text-xs text-red-400';
        }
      });
      return;
    }
    panel.innerHTML = `${head}<p class="text-zinc-300">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) to your sign-in, so a stolen password alone can't get in.</p>
      <button type="button" id="totpStartBtn" class="bg-[#FDD700] hover:bg-white text-black font-bold px-4 py-2 rounded-xl">Set it up</button>
      <div id="totpSetup" class="hidden space-y-2"></div>`;
    $('totpStartBtn').addEventListener('click', async () => {
      try {
        const r = await api('/api/admin/tools', { action: 'totp_start' });
        const box = $('totpSetup');
        box.classList.remove('hidden');
        $('totpStartBtn').remove();
        box.innerHTML = `<p class="text-zinc-300"><strong>1.</strong> On your phone, tap <a href="${escapeAttr(r.otpauth)}" class="text-[#FDD700] underline">Add to my authenticator app</a>,
          or in the app choose "Enter a setup key" and type this key:</p>
          <p class="font-mono text-[#FDD700] break-all bg-black rounded-lg p-2 select-all">${escapeHtml(r.secret.replace(/(.{4})/g, '$1 ').trim())}</p>
          <p class="text-zinc-300"><strong>2.</strong> Type the 6-digit code the app shows:</p>
          <input id="totpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="admin-input" placeholder="123456">
          <button type="button" id="totpConfirmBtn" class="bg-[#FDD700] hover:bg-white text-black font-bold px-4 py-2 rounded-xl">Turn on</button>
          <p class="text-xs text-zinc-500">Keep the setup key somewhere safe (a password manager) in case you change phones.</p><p id="totpMsg" class="text-xs"></p>`;
        $('totpConfirmBtn').addEventListener('click', async () => {
          try {
            const c = await api('/api/admin/tools', { action: 'totp_confirm', code: $('totpCode').value });
            panel.innerHTML = `${head}<p class="text-emerald-300">${escapeHtml(c.message)}</p>`;
          } catch (e) {
            $('totpMsg').textContent = e.message;
            $('totpMsg').className = 'text-xs text-red-400';
          }
        });
      } catch (e) {
        toast(e.message, false);
      }
    });
  }

  function injectHeaderButton() {
    const pw = $('changePwBtn');
    if (!pw || $('twoStepBtn')) return;
    const b = document.createElement('button');
    b.id = 'twoStepBtn';
    b.type = 'button';
    b.className = pw.className;
    b.textContent = 'Two-step login';
    b.addEventListener('click', securityModal);
    pw.parentNode.insertBefore(b, pw);
  }

  /* ---------------- Installable admin ---------------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin' }).catch(() => null);
  }

  window.spbcAdminTools = {
    onApp() {
      injectTop();
      injectHeaderButton();
      loadTodo();
    },
    loadTodo,
    customerBox,
    riskChip,
    afterProducts,
    billCheck,
  };
  // The main script may have shown the app before this file loaded.
  if ($('appSection') && !$('appSection').classList.contains('hidden')) window.spbcAdminTools.onApp();
})();
