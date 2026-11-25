/**
 * SPBC unified site header
 * - Marks active nav from body[data-page] (gold filled link — no sliding pill)
 * - Scroll state with hysteresis (no top-of-page thrashing)
 * - window.spbcHeaderRefresh() after age-gate accept / layout changes
 */
(function () {
  var bound = false;
  var active = null;
  var header = null;
  var links = [];
  var isScrolled = false;
  // Hysteresis: different enter/leave thresholds prevent sticky-header
  // height changes from bouncing scrollY across a single threshold.
  var SCROLL_ENTER = 48;
  var SCROLL_LEAVE = 8;

  function resolveActive() {
    var page = (document.body && document.body.dataset.page) || '';
    active = null;
    links.forEach(function (a) {
      if (a.dataset.nav === page) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
        active = a;
      } else {
        a.classList.remove('active');
        a.removeAttribute('aria-current');
      }
    });
  }

  function onScroll() {
    if (!header) return;
    var y = window.scrollY || window.pageYOffset || 0;
    var next = isScrolled;
    if (!isScrolled && y > SCROLL_ENTER) next = true;
    else if (isScrolled && y < SCROLL_LEAVE) next = false;

    if (next === isScrolled) return;
    isScrolled = next;
    header.classList.toggle('is-scrolled', isScrolled);
    syncStickyOffset();
  }

  /** Keep category sticky subheaders parked just below the real header height. */
  function syncStickyOffset() {
    if (!header) return;
    var h = Math.ceil(header.getBoundingClientRect().height);
    if (h > 0) {
      document.documentElement.style.setProperty('--spbc-header-sticky-offset', h + 'px');
    }
  }

  function bindOnce() {
    if (bound || !header) return;
    bound = true;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', syncStickyOffset, { passive: true });
  }

  function cartDraft() {
    try {
      var raw = localStorage.getItem('spbc_cart_draft');
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  function cartCount(draft) {
    return Object.keys(draft || {}).reduce(function (n, name) {
      var e = draft[name] || {};
      return n + (Number(e.pack) || 0) + (Number(e.vial) || 0);
    }, 0);
  }

  function refreshCartChip() {
    if (!header) return;
    var chip = header.querySelector('[data-header-cart]');
    var countEl = header.querySelector('[data-header-cart-count]');
    if (!chip || !countEl) return;
    var n = cartCount(cartDraft());
    countEl.textContent = String(n);
    if (n > 0) chip.removeAttribute('hidden');
    else chip.setAttribute('hidden', '');
  }

  function init() {
    header = document.querySelector('[data-site-header]');
    if (!header) return;
    links = Array.prototype.slice.call(header.querySelectorAll('.nav-link'));
    resolveActive();
    bindOnce();
    // Seed scrolled state without thrash (use enter threshold only on first paint)
    var y = window.scrollY || window.pageYOffset || 0;
    isScrolled = y > SCROLL_ENTER;
    header.classList.toggle('is-scrolled', isScrolled);
    syncStickyOffset();
    refreshCartChip();
  }

  window.spbcHeaderRefresh = function () {
    init();
  };

  window.addEventListener('storage', function (e) {
    if (e.key === 'spbc_cart_draft') refreshCartChip();
  });
  window.addEventListener('spbc-cart-changed', refreshCartChip);

  function boot() {
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve();
    fontsReady.then(function () { init(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/*
 * SPBC customer app (appended to site-header.js, so every page has it) (2026-11-25). On every customer page:
 *  - registers the offline-capable service worker and offers a one-tap update after a deploy
 *  - offers "add to home screen" once, right after a first order (Android prompt / iPhone steps)
 *  - in the installed app only: a bottom bar (Shop, Cart, Orders, Track) and the cart count on
 *    the app icon. The website in a browser looks exactly as before.
 *  - a small notice while offline (prices then come from the last saved list)
 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (/^\/(admin|qr)/.test(location.pathname)) return; // not the customer app
  if (standalone) document.documentElement.classList.add('is-app');

  function banner(id, html, onAction) {
    if ($('#' + id)) return $('#' + id);
    const b = document.createElement('div');
    b.id = id;
    b.className = 'app-banner';
    b.setAttribute('role', 'status');
    b.innerHTML = html;
    document.body.appendChild(b);
    const act = $('[data-act]', b);
    if (act && onAction) act.addEventListener('click', onAction);
    const x = $('[data-x]', b);
    if (x) x.addEventListener('click', () => b.remove());
    return b;
  }

  /* ---------- service worker + update ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    {
      navigator.serviceWorker.register('/shop-sw.js', { scope: '/' }).then((reg) => {
        const offer = (w) => banner('appUpdate', 'A new version of the shop is ready. <button type="button" data-act>Update</button>', () => w.postMessage('skipWaiting'));
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
        });
      }).catch(() => {});
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !$('#appUpdate')) return;
        reloading = true;
        location.reload();
      });
    }
  }

  /* ---------- install offer: once, after a first order ---------- */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  function installOffer() {
    if (standalone || ls.get('spbc_install_offered')) return;
    const box = $('#orderSuccess');
    if (!box || $('#appInstall', box)) return;
    const canPrompt = !!deferred;
    if (!canPrompt && !isIOS) return;
    ls.set('spbc_install_offered', '1');
    const row = document.createElement('div');
    row.id = 'appInstall';
    row.className = 'app-install';
    row.innerHTML = canPrompt
      ? '<p>Order again faster: add the shop to your home screen.</p><button type="button">Add to home screen</button>'
      : '<p>Order again faster: in Safari tap <strong>Share</strong> <span aria-hidden="true">⬆︎</span>, then <strong>Add to Home Screen</strong>.</p>';
    box.appendChild(row);
    const b = $('button', row);
    if (b) b.addEventListener('click', async () => {
      try { deferred.prompt(); await deferred.userChoice; } catch (_) {}
      deferred = null;
      row.remove();
    });
  }
  function watchOrder() {
    const box = $('#orderSuccess');
    if (!box) return;
    new MutationObserver(() => { if (!box.classList.contains('hidden')) setTimeout(installOffer, 600); })
      .observe(box, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- installed app: bottom bar + icon badge ---------- */
  function appBar() {
    if (!standalone || $('#appBar')) return;
    const here = location.pathname.replace(/\.html$/, '');
    const item = (href, label, icon, active, id) =>
      '<a href="' + href + '"' + (id ? ' id="' + id + '"' : '') + (active ? ' aria-current="page"' : '') + '>' + icon + '<span>' + label + '</span></a>';
    const svg = (d) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    const nav = document.createElement('nav');
    nav.id = 'appBar';
    nav.className = 'app-bar';
    nav.setAttribute('aria-label', 'App');
    nav.innerHTML =
      item('/#prices', 'Shop', svg('<path d="M3 9l1-5h16l1 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>'), here === '/' || here === '/index') +
      item('/#order', 'Cart', svg('<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.4 12h11.2L21 7H6"/>'), false, 'appBarCart') +
      item('/my-orders', 'Orders', svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'), here === '/my-orders') +
      item('/track', 'Track', svg('<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>'), here === '/track');
    document.body.appendChild(nav);
    const cart = $('#appBarCart');
    const headerCart = $('#headerCartBtn') || $('[data-header-cart]');
    if (cart && headerCart) cart.addEventListener('click', (e) => { e.preventDefault(); headerCart.click(); });
  }
  function badge() {
    const el = $('#cartBadge');
    if (!el || !('setAppBadge' in navigator) || !standalone) return;
    const sync = () => {
      const n = parseInt(el.textContent, 10) || 0;
      (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
    };
    new MutationObserver(sync).observe(el, { childList: true, characterData: true, subtree: true });
    sync();
  }

  /* ---------- offline notice ---------- */
  function offline() {
    const show = () => banner('appOffline', "You're offline. Prices shown are from the last time the list loaded. <button type=\"button\" data-x aria-label=\"Close\">×</button>");
    const hide = () => { const b = $('#appOffline'); if (b) b.remove(); };
    window.addEventListener('offline', show);
    window.addEventListener('online', hide);
    if (navigator.onLine === false) show();
  }

  function start() { watchOrder(); appBar(); badge(); offline(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
