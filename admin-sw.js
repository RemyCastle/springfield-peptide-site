/* SPBC admin service worker: makes the admin installable as a phone app. It caches nothing
   (orders and money must always be live); offline it shows a short notice instead of an error. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(
    fetch(e.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width"><body style="background:#0E2A1F;color:#fff;font-family:Arial,sans-serif;padding:24px"><h1 style="color:#F3D94A">SPBC admin</h1><p>You are offline. Reconnect and pull down to reload.</p>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
    )
  );
});
