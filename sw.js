/* Service worker : fonctionnement hors ligne + mise à jour quotidienne en arrière-plan. */
importScripts('./core.js');

const CACHE = 'collection-v1';
const SHELL = ['./', './index.html', './app.js', './core.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Fichiers de l'appli : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  // Images des cartes : cache d'abord.
  if (url.hostname === 'assets.tcgdex.net') {
    e.respondWith(
      caches.open('images-v1').then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; })))
    );
  }
});

// Mise à jour quotidienne (Chrome Android, appli installée).
self.addEventListener('periodicsync', e => {
  if (e.tag === 'maj-prix') e.waitUntil(runDaily());
});

async function runDaily() {
  try {
    const last = await Core.getMeta('lastUpdateDay', null);
    if (last === Core.today()) return;
    await Core.updateAll();
    const clients = await self.clients.matchAll();
    clients.forEach(c => c.postMessage({ type: 'updated' }));
  } catch (e) { /* nouvel essai au prochain passage */ }
}

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'run-daily') e.waitUntil(runDaily());
});
