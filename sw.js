/* 肺音聴診トレーナー — Service Worker
   音源を含めて全部キャッシュするので、一度開けばオフラインでも動きます。
   中身を更新したら CACHE の数字を上げてください（古いキャッシュは自動で消えます）。 */

const CACHE = 'lung-trainer-v1';

/* SW から見た相対パスで解決する（GitHub Pages のサブパス配信に対応） */
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './sounds/normal.mp4',
  './sounds/wheeze.mp4',
  './sounds/wheeze_copd.mp3',
  './sounds/rhonchi.mp4',
  './sounds/fine_crackles.mp4',
  './sounds/coarse_crackles.mp4',
].map(p => new URL(p, self.registration.scope).toString());

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つ失敗しても全体を落とさない
    await Promise.allSettled(ASSETS.map(u => cache.add(new Request(u, {cache: 'reload'}))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Google Fonts 等はブラウザ任せ

  e.respondWith((async () => {
    const cached = await caches.match(req, {ignoreSearch: true});
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // オフラインでナビゲーションに失敗したらトップを返す
      if (req.mode === 'navigate') {
        const fallback = await caches.match(new URL('./index.html', self.registration.scope).toString());
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
