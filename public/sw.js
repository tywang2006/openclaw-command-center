const CACHE_NAME = 'cmd-center-v1';
const SHELL_ASSETS = [
  '/cmd/',
  '/cmd/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests for app shell (HTML, CSS, JS, images)
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Don't cache API requests or WebSocket
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cmd/api/') || url.pathname.includes('/ws')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // Network first for HTML, cache first for assets
      if (event.request.destination === 'document') {
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => cached || new Response('Offline', { status: 503 }));
      }

      // Cache first for static assets (they have hashes in filenames)
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && url.pathname.match(/\.(js|css|png|jpg|svg|woff2?)$/)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'ChaoClaw Command Center';
  const options = {
    body: data.body || '',
    icon: '/cmd/icon-192.png',
    badge: '/cmd/icon-192.png',
    tag: data.category || 'default',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/cmd/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/cmd/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/cmd') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
