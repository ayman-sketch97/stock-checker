// Service worker for phone notifications only. It caches nothing and does not touch page loads, so the site always shows
// fresh data. A push from the notification Worker carries no text; this asks the Worker for the text and shows one notification.
const CFG = 'sc-push-cfg';
async function cfg() {
  try { const r = await (await caches.open(CFG)).match('cfg'); return r ? await r.json() : null; } catch { return null; }
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let title = 'Stock Checker';
    let body = 'Open the Alert Centre to read what changed. Information only, not advice.';
    try {
      const c = await cfg();
      if (c && c.base && c.id) {
        const r = await fetch(`${c.base}/pending?id=${encodeURIComponent(c.id)}`, { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j.title) title = String(j.title).slice(0, 80); if (j.body) body = String(j.body).slice(0, 400); }
      }
    } catch { /* show the generic text */ }
    await self.registration.showNotification(title, { body, tag: 'sc-alerts', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: './?p=alerts' } });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './?p=alerts', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); try { await c.navigate(url); } catch { /* ignore */ } return; } }
    await self.clients.openWindow(url);
  })());
});
