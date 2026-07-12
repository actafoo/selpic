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
  filter: { minTotal: 0, mine: 'all', other: 'all', sortByTotal: false, picked: false },  // mine/other: 'all'|'1'~'5'|'ge2'~'ge4'|'rated'|'unrated'
  compare: new Set(),    // 비교에 담은 키(최대 4)
  picks: new Set(),      // 최종 선택(픽)한 키 — 부부가 함께 고르는 결과(표시용 병합 집합)
  remotePicks: new Set(),// 시트(공유 원본)의 픽 스냅샷
  pendingPicks: new Map(),// key -> boolean  아직 시트로 못 보낸 픽 토글(true=픽, false=해제)
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
  const remoteChanged = !sameRemote(state.remote, m);
  state.remote = m;
  let pendingChanged = false;
  // 시트에 내 점수가 이미 반영됐으면 pending에서 제거
  for (const [key, s] of [...state.pending]) {
    const saved = state.role === 'groom' ? m.get(key)?.groom : m.get(key)?.bride;
    if (saved === s) { state.pending.delete(key); pendingChanged = true; }
  }
  // 자기치유: 내가 매긴 점수(mine)가 시트에 아예 없으면(전송 실패·시트 유실) 자동으로 재전송 큐에 올린다.
  // 값이 서로 다른 경우(다른 기기에서 같은 역할로 매김)는 건드리지 않는다 — '없음(0)'만 복구.
  for (const [key, s] of state.mine) {
    if (s > 0 && !state.pending.has(key)) {
      const saved = state.role === 'groom' ? (m.get(key)?.groom || 0) : (m.get(key)?.bride || 0);
      if (saved === 0) { state.pending.set(key, s); pendingChanged = true; }
    }
  }
  if (pendingChanged) persistPending();

  // ── 최종 픽 병합: 시트가 공유 원본. 아직 못 보낸 로컬 토글(pendingPicks)만 그 위에 얹는다. ──
  // 이래야 신랑이 픽한 20장을 신부 기기가 pull로 그대로 보고, 각자 해제도 서로에게 전파된다.
  const rp = new Set();
  for (const r of rows) { if (r && r.filename && r.picked) rp.add(canon(r.filename)); }
  state.remotePicks = rp;
  let picksPendingChanged = false;
  // 서버가 내 대기 토글을 반영했으면(픽 여부가 내 의도와 일치) 큐에서 제거
  for (const [key, want] of [...state.pendingPicks]) {
    if (rp.has(key) === want) { state.pendingPicks.delete(key); picksPendingChanged = true; }
  }
  // 표시 픽 = 서버 픽 ∪/∖ 대기 중 토글
  const nextPicks = new Set(rp);
  for (const [key, want] of state.pendingPicks) { if (want) nextPicks.add(key); else nextPicks.delete(key); }
  let picksChanged = false;
  if (!sameSet(nextPicks, state.picks)) { state.picks = nextPicks; persistPicks(); picksChanged = true; }
  if (picksPendingChanged) persistPendingPicks();

  if (remoteChanged || pendingChanged || picksChanged) emit();   // 변화 없으면 emit 생략(1000장+ 그리드 불필요 repaint 방지)
}
function sameRemote(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (!w || w.groom !== v.groom || w.bride !== v.bride) return false;
  }
  return true;
}
function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}
// 시트로는 정규화 키를 보낸다(양쪽 기기가 같은 키로 씀)
export function getPending() { return [...state.pending].map(([filename, score]) => ({ filename, score })); }
export function markFlushed(items) {
  let changed = false;
  for (const it of items) {
    if (state.pending.get(it.filename) === it.score) { state.pending.delete(it.filename); changed = true; }
  }
  if (changed) { persistPending(); emit(); }   // '저장 대기 n' 표시가 전송 완료 즉시 사라지게
}

/* ---------- 비교 선택 ---------- */
export function toggleCompare(key) {
  if (state.compare.has(key)) { state.compare.delete(key); }
  else { if (state.compare.size >= 4) return false; state.compare.add(key); }
  emit();
  return true;
}
export function clearCompare() {
  if (!state.compare.size) return;
  state.compare.clear();
  emit();
}

/* ---------- 최종 픽 (시트로 공유 — 두 기기가 같은 픽 목록을 본다) ---------- */
export const isPicked = (key) => state.picks.has(key);
export function togglePick(key) {
  const want = !state.picks.has(key);
  if (want) state.picks.add(key); else state.picks.delete(key);
  state.pendingPicks.set(key, want);   // 시트로 보낼 픽 토글 큐(다음 flush로 상대 기기에 전파)
  persistPicks();
  persistPendingPicks();
  emit();
}
// 시트로 보낼 픽 토글(정규화 키 + 픽 여부)
export function getPendingPicks() { return [...state.pendingPicks].map(([filename, picked]) => ({ filename, picked })); }
export function markPicksFlushed(items) {
  let changed = false;
  for (const it of items) {
    if (state.pendingPicks.get(it.filename) === it.picked) { state.pendingPicks.delete(it.filename); changed = true; }
  }
  if (changed) persistPendingPicks();
}
// 픽 목록을 파일 순서(자연 정렬)로 — 폴더에 없는 픽(다른 세션 잔재)도 뒤에 붙여 유실 방지
export function pickedList() {
  const inFiles = state.files.filter(k => state.picks.has(k));
  const rest = [...state.picks].filter(k => !state.files.includes(k)).sort();
  return inFiles.concat(rest);
}

/* ---------- 필터/정렬 뷰 (키 목록 반환) ---------- */
// 점수 필터 판정: 'all'=전체, '1'~'5'=정확히, 'ge4'=4점 이상, 'rated'=매김, 'unrated'=미평가
function matchScore(score, f) {
  if (!f || f === 'all') return true;
  if (f === 'rated')   return score >= 1;
  if (f === 'unrated') return score === 0;
  if (f[0] === 'g')    return score >= +f.slice(2);
  return score === +f;
}
export function navList() {
  let arr = [...state.files];
  const { minTotal, mine, other, sortByTotal, picked } = state.filter;
  if (picked)                   arr = arr.filter(k => state.picks.has(k));                 // 픽만
  if (mine  && mine  !== 'all') arr = arr.filter(k => matchScore(myScore(k), mine));      // 내 점수
  if (other && other !== 'all') arr = arr.filter(k => matchScore(otherScore(k), other));  // 상대 점수
  if (minTotal > 0)             arr = arr.filter(k => total(k) >= minTotal);               // 합계
  if (sortByTotal) arr = arr.slice().sort((a, b) => total(b) - total(a) || nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true }));
  return arr;
}
export function counts() {
  let rated = 0;
  for (const k of state.files) if (myScore(k) > 0) rated++;
  return { total: state.files.length, rated };
}

// 별점 분포: groom[0..5]/bride[0..5] (index 0 = 미평가, 1~5 = 별점별 장수)
// 내 점수: 로컬 파일 기준(미평가 포함 전체 장수 파악). 상대 점수: 시트 전체 기준
// (상대방 기기의 파일명이 내 로컬과 조금 달라도 시트에서 직접 집계해 0으로 뜨지 않게)
export function ratingStats() {
  const myRole = state.role;
  const g = [0, 0, 0, 0, 0, 0], b = [0, 0, 0, 0, 0, 0];
  // 내 점수 분포: 로컬 파일 목록 기준(내가 연 파일 전체)
  for (const k of state.files) {
    if (myRole === 'groom') g[groomScore(k)]++; else b[brideScore(k)]++;
  }
  // 상대 점수 분포: 시트(state.remote) 전체 기준 — 로컬 파일 키와 무관하게 집계
  for (const v of state.remote.values()) {
    const score = myRole === 'groom' ? (v.bride || 0) : (v.groom || 0);
    if (myRole === 'groom') b[score]++; else g[score]++;
  }
  return { groom: g, bride: b };
}

/* ---------- 로컬 영속화 ---------- */
function persistMine()    { localStorage.setItem(`selpic:mine:${state.role}`,    JSON.stringify(Object.fromEntries(state.mine))); }
function persistPending() { localStorage.setItem(`selpic:pending:${state.role}`, JSON.stringify(Object.fromEntries(state.pending))); }
function persistPicks()        { localStorage.setItem('selpic:picks', JSON.stringify([...state.picks])); }
function persistPendingPicks() { localStorage.setItem('selpic:pendingPicks', JSON.stringify(Object.fromEntries(state.pendingPicks))); }
export function loadPersisted() {
  const m = JSON.parse(localStorage.getItem(`selpic:mine:${state.role}`)    || '{}');
  const p = JSON.parse(localStorage.getItem(`selpic:pending:${state.role}`) || '{}');
  // 예전 버전의 원본-파일명 키를 정규화 키로 이관(확장자/대소문자 통일 이전 데이터 호환)
  state.mine    = new Map(Object.entries(m).map(([k, v]) => [canon(k), Number(v)]));
  state.pending = new Map(Object.entries(p).map(([k, v]) => [canon(k), Number(v)]));
  const picks = JSON.parse(localStorage.getItem('selpic:picks') || '[]');
  state.picks = new Set(picks.map(canon));
  state.remotePicks = new Set();
  const ppRaw = localStorage.getItem('selpic:pendingPicks');
  if (ppRaw == null) {
    // 최초 업그레이드: 이 기기에 있던 로컬 픽은 아직 시트에 없다 → 전부 전송 큐에 올려 상대 기기로 공유.
    // (안 그러면 첫 pull에서 '시트에 픽 없음'으로 보고 로컬 픽을 지워버림)
    state.pendingPicks = new Map([...state.picks].map(k => [k, true]));
    persistPendingPicks();
  } else {
    state.pendingPicks = new Map(Object.entries(JSON.parse(ppRaw)).map(([k, v]) => [canon(k), !!v]));
  }
}
