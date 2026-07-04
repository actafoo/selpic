// 구글 시트(Apps Script) 백엔드 어댑터.
// Backend 인터페이스(→ MIGRATION.md 참고):
//   pull(): Promise<Array<{filename, groom, bride}>>
//   push(role, items): Promise<void>
//   subscribe?(onRows): () => void      // 있으면 실시간, 없으면 sync.js가 폴링으로 폴백
//
// 시트는 실시간 푸시가 없으므로 subscribe를 구현하지 않는다(폴링 폴백).
export function createSheetsBackend({ url }) {
  return {
    async pull() {
      // 캐시 무력화: 브라우저가 GET 응답을 재사용하면 상대방의 새 점수가 안 보인다.
      const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
      const res = await fetch(bust, { method: 'GET', cache: 'no-store' });
      const data = await res.json();
      return Array.isArray(data) ? data : (data.rows || []);
    },
    async push(role, items) {
      // CORS preflight 회피용 text/plain (표준 우회 패턴)
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ role, items }),
      });
    },
  };
}
