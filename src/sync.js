// 동기화 오케스트레이터 — 백엔드 어댑터 위에서 pull/push 타이밍만 관리한다.
// 백엔드는 교체 가능(setBackend). 시트=폴링, 향후 Supabase/Firebase=실시간(subscribe).
//
// Backend 인터페이스:
//   pull(): Promise<Array<{filename, groom, bride}>>
//   push(role, items): Promise<void>
//   subscribe?(onRows: (rows) => void): () => void   // 있으면 실시간, 없으면 폴링
import { state, applyRemote, getPending, markFlushed } from './ratings.js';

let backend = null;
let pollTimer = null, flushTimer = null, unsub = null;
const POLL_MS = 5000, FLUSH_MS = 3000;

export function setBackend(b) { backend = b; }

export function startSync() {
  if (!backend) { console.warn('백엔드가 설정되지 않았어요'); return; }
  pollNow();
  if (typeof backend.subscribe === 'function') {
    unsub = backend.subscribe(rows => applyRemote(rows));   // 실시간 경로
  } else {
    pollTimer = setInterval(pollNow, POLL_MS);              // 폴링 폴백(시트)
  }
  flushTimer = setInterval(flush, FLUSH_MS);
  window.addEventListener('beforeunload', () => { try { flush(); } catch {} });
}

export function stopSync() {
  clearInterval(pollTimer); clearInterval(flushTimer);
  if (unsub) unsub();
  pollTimer = flushTimer = unsub = null;
}

export async function pollNow() {
  if (!backend) return;
  try { applyRemote(await backend.pull()); }
  catch (e) { console.warn('pull 실패', e); }
}

export async function flush() {
  if (!backend) return;
  const items = getPending();
  if (!items.length) return;
  try { await backend.push(state.role, items); markFlushed(items); }
  catch (e) { console.warn('push 실패', e); }
}
