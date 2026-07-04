// 중앙 상태 저장소 + 점수 병합/필터/정렬 로직.
// 사진 원본은 fs.js가 다루고, 여기서는 "파일명 → 점수"만 관리한다.

export const state = {
  role: null,            // 'groom' | 'bride'
  webAppUrl: '',
  folderName: '',
  files: [],             // [{name}] — 자연 정렬된 전체 파일 목록
  remote: new Map(),     // name -> {groom, bride}  (시트에서 받아온 스냅샷)
  mine: new Map(),       // name -> score           (내가 매긴 확정 점수)
  pending: new Map(),    // name -> score           (아직 시트로 못 보낸 점수)
  current: null,         // 1장 모드에서 보고 있는 파일명
  view: 'rate',
  filter: { minTotal: 0, mode: 'all', sortByTotal: false },
  compare: new Set(),    // 비교에 담은 파일명(최대 4)
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

/* ---------- 점수 조회 ---------- */
export function myScore(name)    { return state.pending.get(name) ?? state.mine.get(name) ?? 0; }
export function otherScore(name) {
  const r = state.remote.get(name);
  if (!r) return 0;
  return state.role === 'groom' ? (r.bride || 0) : (r.groom || 0);
}
export function groomScore(name) { return state.role === 'groom' ? myScore(name) : (state.remote.get(name)?.groom || 0); }
export function brideScore(name) { return state.role === 'bride' ? myScore(name) : (state.remote.get(name)?.bride || 0); }
export function total(name)      { return myScore(name) + otherScore(name); }

/* ---------- 점수 기록 ---------- */
export function setMyScore(name, score) {
  score = Math.max(0, Math.min(5, Number(score) || 0));
  state.mine.set(name, score);
  state.pending.set(name, score);   // 시트로 보낼 큐에 등록
  persistMine();
  persistPending();
  emit();
}

/* ---------- 동기화 연동 ---------- */
export function applyRemote(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r && r.filename) m.set(r.filename, { groom: Number(r.groom) || 0, bride: Number(r.bride) || 0 });
  }
  state.remote = m;
  // 시트에 내 점수가 이미 반영됐으면 pending에서 제거
  for (const [name, s] of [...state.pending]) {
    const saved = state.role === 'groom' ? m.get(name)?.groom : m.get(name)?.bride;
    if (saved === s) state.pending.delete(name);
  }
  persistPending();
  emit();
}
export function getPending() { return [...state.pending].map(([filename, score]) => ({ filename, score })); }
export function markFlushed(items) {
  for (const it of items) if (state.pending.get(it.filename) === it.score) state.pending.delete(it.filename);
  persistPending();
}

/* ---------- 비교 선택 ---------- */
export function toggleCompare(name) {
  if (state.compare.has(name)) { state.compare.delete(name); }
  else { if (state.compare.size >= 4) return false; state.compare.add(name); }
  emit();
  return true;
}

/* ---------- 필터/정렬 뷰 ---------- */
export function navList() {
  let arr = state.files.map(f => f.name);
  const { minTotal, mode, sortByTotal } = state.filter;
  if (mode === 'rated-mine')        arr = arr.filter(n => myScore(n) > 0);
  else if (mode === 'unrated-mine') arr = arr.filter(n => myScore(n) === 0);
  if (minTotal > 0)                 arr = arr.filter(n => total(n) >= minTotal);
  if (sortByTotal) arr = arr.slice().sort((a, b) => total(b) - total(a) || a.localeCompare(b, undefined, { numeric: true }));
  return arr;
}
export function counts() {
  let rated = 0;
  for (const f of state.files) if (myScore(f.name) > 0) rated++;
  return { total: state.files.length, rated };
}

/* ---------- 로컬 영속화 ---------- */
function persistMine()    { localStorage.setItem(`selpic:mine:${state.role}`,    JSON.stringify(Object.fromEntries(state.mine))); }
function persistPending() { localStorage.setItem(`selpic:pending:${state.role}`, JSON.stringify(Object.fromEntries(state.pending))); }
export function loadPersisted() {
  const m = JSON.parse(localStorage.getItem(`selpic:mine:${state.role}`)    || '{}');
  const p = JSON.parse(localStorage.getItem(`selpic:pending:${state.role}`) || '{}');
  state.mine    = new Map(Object.entries(m).map(([k, v]) => [k, Number(v)]));
  state.pending = new Map(Object.entries(p).map(([k, v]) => [k, Number(v)]));
}
