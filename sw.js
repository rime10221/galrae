// 오프라인 지원: 앱 파일은 캐시 우선 + 백그라운드 갱신, Google API는 항상 네트워크
// 새 버전을 설치할 때는 브라우저 HTTP 캐시를 거치지 않고 서버에서 받는다
const CACHE = 'galrae-v20';
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/sync.js', 'js/train.js', 'js/outline.js', 'js/graph.js', 'js/graphview.js', 'js/images.js', 'js/editor.js', 'js/zoom.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // OAuth 리디렉션(#access_token)은 해시라 서버 요청에 영향 없음
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      // 브라우저 HTTP 캐시(GitHub Pages 10분)를 건너뛰고 서버에 확인
      const net = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }),
  );
});
