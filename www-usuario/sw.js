/* Service Worker — Qadras PWA
   Estratégia:
   - Navegações (páginas): network-first, com fallback pro cache e depois página offline.
   - Código do app (js/css/html): network-first. Cache-first aqui quebrava o app:
     os módulos ES atualizam em momentos diferentes, um import falha e como toda a
     UI é injetada por JS a tela ficava totalmente em branco.
   - Assets imutáveis (imagens, ícones, fontes): cache-first com atualização em background.
   - CDNs externas (fontes, Leaflet, imagens Unsplash) passam direto pela rede. */
/* Subir esta versao descarta os caches antigos no `activate`. Necessario
   sempre que um asset do SHELL mudar: sem isso, cliente que ja instalou o
   service worker pode seguir com o arquivo velho. */
const CACHE = 'pq-v10';
const SHELL = [
  '/',
  '/index.html',
  '/app.html',
  '/assets/css/tokens.css',
  '/assets/css/style.css',
  '/assets/css/mobile-v2.css',
  '/assets/css/desktop.css',
  '/assets/css/player-web.css',
  '/assets/js/ui.js',
  '/assets/js/app.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDNs externas: rede direta

  function cachePut(request, response) {
    if (!response || !response.ok) return response;
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy));
    return response;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => cachePut(req, res))
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Codigo do app precisa vir sempre da rede — cache so como fallback offline.
  const isAppCode = /\.(?:js|mjs|css|html|json|webmanifest)$/i.test(url.pathname);
  if (isAppCode) {
    event.respondWith(
      fetch(req)
        .then((res) => cachePut(req, res))
        .catch(() => caches.match(req))
    );
    return;
  }

  // Assets imutaveis: cache-first, atualizando em background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => cachePut(req, res))
        .catch(() => cached);
      return cached || network;
    })
  );
});
