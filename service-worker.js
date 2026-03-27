const CACHE_NAME = 'xo-pwa-cache-v7';
// Только явные URL: «/» и «/index.html» вместе дают лишний запрос и иногда разные ответы для Cache.put.
const ASSETS_TO_CACHE = [
  '/index.html',
  '/manifest.json',
  '/app-icon-192.png',
  '/app-icon-512.png'
];

const SKIP_HEADER = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

/**
 * Сохраняем в Cache копию с телом в ArrayBuffer: иначе put() часто падает с NetworkError
 * при обрыве потока (ERR_CONNECTION_RESET), хотя статус уже 200.
 */
async function putResponseBuffered(cache, cacheKey, response) {
  const body = await response.arrayBuffer();
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (!SKIP_HEADER.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  headers.set('Content-Length', String(body.byteLength));
  const stored = new Response(body, {
    status: 200,
    statusText: 'OK',
    headers
  });
  await cache.put(cacheKey, stored);
}

/**
 * Netlify/CDN иногда отдаёт 206 Partial Content; при 206 повторяем с cache-bust — чаще приходит полный 200.
 */
async function precacheUrl(cache, url) {
  const bust = (u) => `${u}${u.includes('?') ? '&' : '?'}sw=${encodeURIComponent(CACHE_NAME)}`;

  let res = await fetch(url, {
    method: 'GET',
    cache: 'reload',
    credentials: 'omit',
    mode: 'same-origin',
    redirect: 'follow'
  });

  if (res.status === 206 || !res.ok) {
    res = await fetch(bust(url), {
      method: 'GET',
      cache: 'reload',
      credentials: 'omit',
      mode: 'same-origin',
      redirect: 'follow'
    });
  }

  if (res.ok && res.status === 200 && res.type !== 'opaque') {
    await putResponseBuffered(cache, url, res);
    return;
  }

  console.warn('PWA precache: пропуск (нужен полный ответ 200):', url, res.status);
}

async function precacheAll(cache) {
  for (const url of ASSETS_TO_CACHE) {
    try {
      await precacheUrl(cache, url);
    } catch (e) {
      console.warn('PWA precache: ошибка для', url, e);
    }
  }
}

// Установка Service Worker и кэширование ресурсов
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Кэширование ресурсов PWA...');
      return precacheAll(cache);
    })
  );
  self.skipWaiting();
});

// Активация Service Worker и очистка старого кэша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Удаление старого кэша:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Перехват сетевых запросов
self.addEventListener('fetch', (event) => {
  event.respondWith(
    (async () => {
      const req = event.request;
      let cached = await caches.match(req);
      if (!cached && req.mode === 'navigate') {
        const path = new URL(req.url).pathname;
        if (path === '/' || path === '') {
          cached = await caches.match('/index.html');
        }
      }
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch {
        if (req.mode === 'navigate') {
          return (await caches.match('/index.html')) || Response.error();
        }
        return Response.error();
      }
    })()
  );
});
