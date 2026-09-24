/* 聴診トレーナー（肺音・心音） — Service Worker
   音源を含めて全部キャッシュするので、一度開けばオフラインでも動きます。
   中身を更新したら CACHE の数字を上げてください（古いキャッシュは自動で消えます）。 */

const CACHE = 'auscultation-trainer-v2';

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
  './sounds/lung/normal.mp4',
  './sounds/lung/wheeze.mp4',
  './sounds/lung/wheeze_copd.mp3',
  './sounds/lung/rhonchi.mp4',
  './sounds/lung/fine_crackles.mp4',
  './sounds/lung/coarse_crackles.mp4',
  './sounds/heart/01_apex_normal_s1_s2_supine_bell.m4a',
  './sounds/heart/02_apex_split_s1_supine_bell.m4a',
  './sounds/heart/03_apex_s4_lld_bell.m4a',
  './sounds/heart/04_apex_mid_sys_click_supine_bell.m4a',
  './sounds/heart/05_apex_s3_lld_bell.m4a',
  './sounds/heart/06_apex_early_sys_mur_supine_bell.m4a',
  './sounds/heart/07_apex_mid_sys_mur_supine_bell.m4a',
  './sounds/heart/08_apex_late_sys_mur_supine_bell.m4a',
  './sounds/heart/09_apex_holo_sys_mur_supine_bell.m4a',
  './sounds/heart/10_apex_sys_click__late_sys_mur_lld_bell.m4a',
  './sounds/heart/11_apex_s4__mid_sys_mur_lld_bell.m4a',
  './sounds/heart/12_apex_s3__holo_sys_mur_lld_bell.m4a',
  './sounds/heart/13_apex_os__dias_mur_lld_bell.m4a',
  './sounds/heart/14_aortic_normal_s1_s2_sitting_bell.m4a',
  './sounds/heart/15_aortic_sys_mur__absent_s2_sitting_bell.m4a',
  './sounds/heart/16_aortic_early_dias_mur_sitting_bell.m4a',
  './sounds/heart/17_aortic_sys__dias_mur_sitting_bell.m4a',
  './sounds/heart/19_pulm_spilt_s2_persistent_supine_diaph.m4a',
  './sounds/heart/20_pulm_spilt_s2_transient_supine_diaph.m4a',
  './sounds/heart/21_pulm_eject_sys_mur__trans_split_s2_supine_diaph.m4a',
  './sounds/heart/22_pulm_split_s2__eject_sys_mur_supine_diaph.m4a',
  './sounds/heart/23_pulm_eject_sys_mur__single_s2__eject_click_supine_diaph.m4a',
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
