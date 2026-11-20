// Garde l'interface en cache pour un démarrage rapide ; les données passent toujours par le réseau.
const CACHE = 'phoning-v16';
const FILES = ['./', './index.html', './app.js', './config.js', './departements.txt', './manifest.webmanifest', './icone-192.png', './icone-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // Supabase : jamais en cache
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

// Notifications : affichage et ouverture de l'appli au bon onglet
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { titre: '2A Travail', texte: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titre || '2A Travail', { body: d.texte || '', icon: './icone-192.png', badge: './icone-192.png', data: { url: d.url || './' }, tag: 'tache', renotify: true }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => { for (const c of l) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } } return clients.openWindow(url); }));
});
