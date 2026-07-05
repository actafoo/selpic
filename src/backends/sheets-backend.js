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
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ role, items }),
      });
      // ⚠️ 반드시 성공을 확인한다. 예전엔 응답을 안 봐서 서버 실패(락 타임아웃·6분 초과)도
      //    성공으로 착각 → 큐를 비워 점수를 통째로 잃었다. 실패면 throw → 호출부가 큐 유지·재전송.
      //    push는 멱등(같은 파일명+점수 재전송은 같은 결과)이라 의심스러우면 실패로 처리해도 안전.
      if (!res.ok) throw new Error('서버 응답 ' + res.status);
      let data;
      try { data = await res.json(); } catch { throw new Error('서버 응답을 읽지 못했어요'); }
      if (!data || data.ok !== true) throw new Error('서버 저장 실패: ' + ((data && data.error) || '알 수 없음'));
    },
  };
}
