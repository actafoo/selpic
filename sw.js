// network-first 서비스워커: 온라인이면 항상 최신을 받아오고(브라우저 캐시로 인한 구버전 방지),
// 오프라인일 때만 캐시로 폴백. 외부(구글 시트 등)는 개입하지 않는다.
const CACHE = 'selpic-cache';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // 시트 API 등은 그대로 통과
  e.respondWith(
    fetch(req)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req))
  );
});
