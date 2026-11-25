/*
 * SPBC customer app service worker (scope /).
 *
 * Pages: network first, the saved copy only when offline. Price list (/api/products): network
 * first, the last good copy when offline (the page shows its time). Static files: served from
 * the cache and refreshed in the background. Never touched: admin, payment and shipping pages,
 * and every other /api/ call (always live).
 *
 * BUILD_ID is replaced at build time, so a new deploy is a new worker and the page offers a
 * one-tap update.
 */
const BUILD_ID = '__BUILD_ID__';
const PAGES = 'spbc-pages-' + BUILD_ID;
const STATIC = 'spbc-static-' + BUILD_ID;
const DATA = 'spbc-data-v1';
const SHELL = ['/', '/calculator', '/track', '/my-orders', '/faq', '/lab-reports'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([caches.open(PAGES), caches.open(STATIC)]).then(([c, st]) => Promise.all(SHELL.map((u) =>
      fetch(new Request(u, { cache: 'reload' }))
        .then((res) => (res.ok ? res.text().then((html) => {
          // Also save every stylesheet, script and image the page uses, so the first offline
          // open looks right (files served from the memory cache never pass through here).
          const assets = [...html.matchAll(/(?:href|src)="(\/(?:shared|public|assets)\/[^"]+?\.(?:css|js|png|jpe?g|webp|svg)(?:\?[^"]*)?)"/g)].map((m) => m[1]);
          return Promise.all([
            c.put(new URL(res.url).pathname, new Response(html, { status: 200, headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8' } })),
            ...[...new Set(assets)].map((a) => st.match(a).then((hit) => hit || st.add(a)).catch(() => null)),
          ]);
        }) : null))
        .catch(() => null))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => (k.startsWith('spbc-pages-') && k !== PAGES) || (k.startsWith('spbc-static-') && k !== STATIC)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

const NEVER = /^\/(admin|api\/admin|qr)/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.test(url.pathname)) return;

  if (url.pathname === '/api/products') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put('/api/products', copy));
          }
          return res;
        })
        .catch(() => caches.open(DATA).then((c) => c.match('/api/products')).then((hit) => hit || Response.error()))
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const finalPath = new URL(res.url || req.url).pathname;
          if (res.ok && !finalPath.startsWith('/p/')) {
            // Saved as a plain copy under its final address: a redirected response
            // (e.g. /calculator.html -> /calculator) cannot be replayed for a navigation.
            const copy = res.clone();
            event.waitUntil(copy.blob().then((body) => caches.open(PAGES).then((c) =>
              c.put(finalPath, new Response(body, { status: 200, headers: { 'Content-Type': copy.headers.get('Content-Type') || 'text/html; charset=utf-8' } })))));
          }
          return res;
        })
        .catch(() =>
          caches.open(PAGES)
            .then((c) => c.match(url.pathname)
              .then((hit) => hit || c.match(url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/'))
              .then((hit) => hit || c.match('/')))
            .then((hit) => hit || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
        )
    );
    return;
  }

  if (/\.(css|js|png|jpe?g|webp|svg|woff2?|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then((c) =>
        c.match(req).then((hit) => {
          const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || fresh;
        })
      )
    );
  }
});
