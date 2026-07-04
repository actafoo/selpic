// 중앙 상태 저장소 + 점수 병합/필터/정렬 로직.
// 사진 원본은 fs.js가 다루고, 여기서는 "파일명 → 점수"만 관리한다.
//
// 매칭은 '정규화 키(canon)'로 한다: 소문자 + .jpeg/.JPG → .jpg 통일.
// 두 기기의 확장자·대소문자가 달라도(예: NT.jpg vs NT.jpeg) 같은 사진으로 합쳐진다.
// 화면 표시·내보내기는 원래 파일명(state.names)을 쓴다.

export const state = {
  role: null,            // 'groom' | 'bride'
  webAppUrl: '',
  folderName: '',
  files: [],             // [key, ...] 정규화 키 목록(표시명 기준 자연 정렬)
  names: new Map(),      // key -> 원래 파일명(표시/내보내기용)
  remote: new Map(),     // key -> {groom, bride}  (시트에서 받아온 스냅샷, 키로 병합됨)
  mine: new Map(),       // key -> score           (내가 매긴 확정 점수)
  pending: new Map(),    // key -> score           (아직 시트로 못 보낸 점수)
  current: null,         // 1장 모드에서 보고 있는 키
  view: 'rate',
  filter: { minTotal: 0, mode: 'all', sortByTotal: false },
  compare: new Set(),    // 비교에 담은 키(최대 4)
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

// 파일명 → 정규화 매칭 키
export function canon(name) {
  return String(name).normalize('NFC').toLowerCase().replace(/\.jpe?g$/, '.jpg');
}
// 키 → 표시용 원래 파일명
export const nameOf = (key) => state.names.get(key) || key;

/* ---------- 점수 조회 (모두 키 기준) ---------- */
// 내 점수: 로컬 우선, 없으면 시트(remote)의 내 역할 값으로 폴백(기기·저장소 바뀌어도 유지)
export function myScore(key)    { return state.pending.get(key) ?? state.mine.get(key) ?? state.remote.get(key)?.[state.role] ?? 0; }
export function otherScore(key) {
  const r = state.remote.get(key);
  if (!r) return 0;
  return state.role === 'groom' ? (r.bride || 0) : (r.groom || 0);
}
export function groomScore(key) { return state.role === 'groom' ? myScore(key) : (state.remote.get(key)?.groom || 0); }
export function brideScore(key) { return state.role === 'bride' ? myScore(key) : (state.remote.get(key)?.bride || 0); }
export function total(key)      { return myScore(key) + otherScore(key); }

/* ---------- 점수 기록 ---------- */
export function setMyScore(key, score) {
  score = Math.max(0, Math.min(5, Number(score) || 0));
  state.mine.set(key, score);
  state.pending.set(key, score);   // 시트로 보낼 큐에 등록
  persistMine();
  persistPending();
  emit();
}

/* ---------- 동기화 연동 ---------- */
export function applyRemote(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r || !r.filename) continue;
    const k = canon(r.filename);                 // 확장자/대소문자 다른 행들을 한 키로 병합
    const cur = m.get(k) || { groom: 0, bride: 0 };
    cur.groom = Math.max(cur.groom, Number(r.groom) || 0);
    cur.bride = Math.max(cur.bride, Number(r.bride) || 0);
    m.set(k, cur);
  }
  state.remote = m;
  // 시트에 내 점수가 이미 반영됐으면 pending에서 제거
  for (const [key, s] of [...state.pending]) {
    const saved = state.role === 'groom' ? m.get(key)?.groom : m.get(key)?.bride;
    if (saved === s) state.pending.delete(key);
  }
  persistPending();
  emit();
}
// 시트로는 정규화 키를 보낸다(양쪽 기기가 같은 키로 씀)
export function getPending() { return [...state.pending].map(([filename, score]) => ({ filename, score })); }
export function markFlushed(items) {
  for (const it of items) if (state.pending.get(it.filename) === it.score) state.pending.delete(it.filename);
  persistPending();
}

/* ---------- 비교 선택 ---------- */
export function toggleCompare(key) {
  if (state.compare.has(key)) { state.compare.delete(key); }
  else { if (state.compare.size >= 4) return false; state.compare.add(key); }
  emit();
  return true;
}

/* ---------- 필터/정렬 뷰 (키 목록 반환) ---------- */
export function navList() {
  let arr = [...state.files];
  const { minTotal, mode, sortByTotal } = state.filter;
  if (mode === 'rated-mine')        arr = arr.filter(k => myScore(k) > 0);
  else if (mode === 'unrated-mine') arr = arr.filter(k => myScore(k) === 0);
  if (minTotal > 0)                 arr = arr.filter(k => total(k) >= minTotal);
  if (sortByTotal) arr = arr.slice().sort((a, b) => total(b) - total(a) || nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }));
  return arr;
}
export function counts() {
  let rated = 0;
  for (const k of state.files) if (myScore(k) > 0) rated++;
  return { total: state.files.length, rated };
}

/* ---------- 로컬 영속화 ---------- */
function persistMine()    { localStorage.setItem(`selpic:mine:${state.role}`,    JSON.stringify(Object.fromEntries(state.mine))); }
function persistPending() { localStorage.setItem(`selpic:pending:${state.role}`, JSON.stringify(Object.fromEntries(state.pending))); }
export function loadPersisted() {
  const m = JSON.parse(localStorage.getItem(`selpic:mine:${state.role}`)    || '{}');
  const p = JSON.parse(localStorage.getItem(`selpic:pending:${state.role}`) || '{}');
  // 예전 버전의 원본-파일명 키를 정규화 키로 이관(확장자/대소문자 통일 이전 데이터 호환)
  state.mine    = new Map(Object.entries(m).map(([k, v]) => [canon(k), Number(v)]));
  state.pending = new Map(Object.entries(p).map(([k, v]) => [canon(k), Number(v)]));
}
