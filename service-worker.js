const CACHE_NAME = 'xo-pwa-cache-v6';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/app-icon-192.png',
  '/app-icon-512.png'
];

/**
 * Netlify/CDN иногда отдаёт 206 Partial Content; Cache.add/addAll с таким ответом падают с NetworkError.
 * Тянем ресурс отдельным fetch, при 206 повторяем с cache-bust query — обычно приходит полный 200.
 */
async function precacheUrl(cache, url) {
  const bust = (u) => `${u}${u.includes('?') ? '&' : '?'}sw=${encodeURIComponent(CACHE_NAME)}`;

  let res = await fetch(url, {
    method: 'GET',
    cache: 'reload',
    credentials: 'omit',
    mode: 'same-origin'
  });

  if (res.status === 206 || !res.ok) {
    res = await fetch(bust(url), {
      method: 'GET',
      cache: 'reload',
      credentials: 'omit',
      mode: 'same-origin'
    });
  }

  if (res.ok && res.status === 200 && res.type !== 'opaque') {
    await cache.put(url, res.clone());
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
    caches.match(event.request).then((response) => {
      // Если ресурс найден в кэше, возвращаем его. Иначе идем в сеть.
      return response || fetch(event.request).catch(() => {
        // Если сеть недоступна, а ресурса нет в кэше (например, оффлайн)
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
