// 동기화 오케스트레이터 — 백엔드 어댑터 위에서 pull/push 타이밍만 관리한다.
// 백엔드는 교체 가능(setBackend). 시트=폴링, 향후 Supabase/Firebase=실시간(subscribe).
//
// Backend 인터페이스:
//   pull(): Promise<Array<{filename, groom, bride}>>
//   push(role, items): Promise<void>
//   subscribe?(onRows: (rows) => void): () => void   // 있으면 실시간, 없으면 폴링
import { state, applyRemote, getPending, markFlushed, getPendingPicks, markPicksFlushed } from './ratings.js';

let backend = null;
let pollTimer = null, flushTimer = null, unsub = null, onWake = null, onOnline = null;
let flushing = false;                       // 중복 flush 방지(3초 타이머가 이전 flush 끝나기 전에 또 쏘던 문제)
const POLL_MS = 5000, FLUSH_MS = 3000;
export const PUSH_CHUNK = 100;              // 한 요청에 너무 많이 보내면 서버(Apps Script)가 6분·락 한도로 죽는다 → 쪼갬

export function setBackend(b) { backend = b; }

// 큰 목록을 청크로 나눠 순차 전송(복구 재업로드 등에 재사용). onProgress(done, total).
export async function pushChunked(b, role, items, onProgress) {
  let done = 0;
  for (let i = 0; i < items.length; i += PUSH_CHUNK) {
    const chunk = items.slice(i, i + PUSH_CHUNK);
    await b.push(role, chunk);              // 실패하면 throw → 여기서 중단(이미 보낸 청크는 서버에 남음)
    done += chunk.length;
    if (onProgress) onProgress(done, items.length);
  }
}

export function startSync() {
  if (!backend) { console.warn('백엔드가 설정되지 않았어요'); return; }
  pollNow();
  if (typeof backend.subscribe === 'function') {
    unsub = backend.subscribe(rows => applyRemote(rows));   // 실시간 경로
  } else {
    pollTimer = setInterval(pollNow, POLL_MS);              // 폴링 폴백(시트)
  }
  flushTimer = setInterval(flush, FLUSH_MS);
  // iOS 사파리·백그라운드 탭은 타이머가 멈춘다 → 화면 복귀/이탈·온라인 복귀 순간에 즉시 밀어넣기
  onWake = () => {
    if (document.visibilityState === 'visible') { pollNow(); flush(); }
    else { flush(); }                                       // 백그라운드 진입 직전 마지막 전송 시도
  };
  document.addEventListener('visibilitychange', onWake);
  onOnline = () => flush();
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onOnline);            // 닫기 직전 최선 노력(실패해도 pending은 localStorage에 남음)
  window.addEventListener('beforeunload', () => { try { flush(); } catch {} });
}

export function stopSync() {
  clearInterval(pollTimer); clearInterval(flushTimer);
  if (unsub) unsub();
  if (onWake) document.removeEventListener('visibilitychange', onWake);
  if (onOnline) { window.removeEventListener('online', onOnline); window.removeEventListener('pagehide', onOnline); }
  pollTimer = flushTimer = unsub = onWake = onOnline = null;
}

export async function pollNow() {
  if (!backend) return;
  try { applyRemote(await backend.pull()); }
  catch (e) { console.warn('pull 실패', e); }
}

export async function flush() {
  if (!backend || flushing) return;         // 이전 flush가 아직 진행 중이면 건너뜀(겹침 방지)
  const items = getPending();
  const picks = typeof backend.pushPicks === 'function' ? getPendingPicks() : [];
  if (!items.length && !picks.length) return;
  flushing = true;
  try {
    // 청크 단위로 보내고, 각 청크가 성공했을 때만 그만큼 큐에서 제거(중간 실패해도 나머지는 다음 주기 재시도)
    for (let i = 0; i < items.length; i += PUSH_CHUNK) {
      const chunk = items.slice(i, i + PUSH_CHUNK);
      await backend.push(state.role, chunk);
      markFlushed(chunk);
    }
    // 최종 픽 토글도 함께 전송(시트 공유 → 상대 기기가 pull로 같은 픽을 본다)
    for (let i = 0; i < picks.length; i += PUSH_CHUNK) {
      const chunk = picks.slice(i, i + PUSH_CHUNK);
      await backend.pushPicks(chunk);
      markPicksFlushed(chunk);
    }
  } catch (e) { console.warn('push 실패(다음 주기에 재시도)', e); }
  finally { flushing = false; }
}
