// 1장 모드: 큰 사진 한 장, 방향키 이동, 숫자키(1~5) 즉시 평점.
// 확대: 휠/버튼/단축키(+,-,f)로 줌, 확대 상태에서 드래그로 이동(팬), 더블클릭 토글.
import { state, navList, setMyScore, groomScore, brideScore, total } from './ratings.js';
import { el, clear, myStars } from './ui-common.js';
import * as fs from './fs.js';

const MAX_ZOOM = 8;

export function renderRate(root) {
  const img   = el('img', { class: 'photo', alt: '' });
  const empty = el('div', { class: 'empty' }, '표시할 사진이 없어요. (필터를 확인해 주세요)');
  const zlabel = el('span', { class: 'zlabel' }, '100%');
  const zoomBar = el('div', { class: 'zoom-bar' },
    el('button', { class: 'zbtn', title: '축소 (-)', onclick: () => zoomAt(1 / 1.4, cx(), cy()) }, '−'),
    zlabel,
    el('button', { class: 'zbtn', title: '확대 (+)', onclick: () => zoomAt(1.4, cx(), cy()) }, '+'),
    el('button', { class: 'zbtn', title: '화면맞춤 (f)', onclick: resetZoom }, '⤢'),
  );
  const stage = el('div', { class: 'stage' }, img, zoomBar);
  // 하단은 사진을 가리지 않게 얇은 한 줄 바(평점·이동은 주로 단축키 1~5 / ←→ 사용)
  const info = el('div', { class: 'rate-info' });
  const center = el('span', { class: 'rate-center' });
  const bar = el('div', { class: 'rate-bar' },
    el('button', { class: 'navbtn sm', title: '이전 (←)', onclick: () => step(-1) }, '◀'),
    center,
    info,
    el('button', { class: 'navbtn sm', title: '다음 (→)', onclick: () => step(1) }, '▶'),
  );
  root.append(el('div', { class: 'rate' }, stage, bar));

  let shown = null;

  /* ---------- 줌/팬 ---------- */
  let scale = 1, tx = 0, ty = 0;
  const cx = () => { const r = stage.getBoundingClientRect(); return r.left + r.width / 2; };
  const cy = () => { const r = stage.getBoundingClientRect(); return r.top + r.height / 2; };
  function clampPan() {
    const mx = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const my = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }
  function apply() {
    clampPan();
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? 'grab' : 'default';
    stage.classList.toggle('zoomed', scale > 1);
    zlabel.textContent = Math.round(scale * 100) + '%';
  }
  function resetZoom() { scale = 1; tx = 0; ty = 0; apply(); }
  function zoomAt(factor, clientX, clientY) {
    const r = stage.getBoundingClientRect();
    const mX = clientX - (r.left + r.width / 2);      // 커서 위치(스테이지 중심 기준)
    const mY = clientY - (r.top + r.height / 2);
    const ns = Math.min(MAX_ZOOM, Math.max(1, scale * factor));
    const k = ns / scale;
    if (k === 1) return;
    tx = mX * (1 - k) + k * tx;                        // 커서 아래 지점을 고정한 채 확대
    ty = mY * (1 - k) + k * ty;
    scale = ns;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }
  // 휠 확대: deltaY 크기에 비례. 마우스(큰 delta)는 상한으로 안정, 트랙패드(작은 delta)는 계수로 반응.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.min(1.45, Math.max(0.69, Math.exp(-e.deltaY * 0.006)));
    zoomAt(f, e.clientX, e.clientY);
  }, { passive: false });
  // 더블클릭: 맞춤 ↔ 2.5배 토글
  stage.addEventListener('dblclick', (e) => { if (scale > 1) resetZoom(); else zoomAt(2.5, e.clientX, e.clientY); });
  // 드래그 이동(팬, 손가락 1개) + 핀치 확대(손가락 2개)
  const pointers = new Map();
  let drag = false, sx = 0, sy = 0, stx = 0, sty = 0, pinchDist = 0;
  const dist2 = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const mid2  = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoom-bar')) return;                 // 줌 버튼 클릭은 제외
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {                                 // 핀치 시작
      drag = false; pinchDist = dist2();
    } else if (pointers.size === 1 && scale > 1 && e.button === 0) {  // 팬 시작(확대 상태)
      drag = true; sx = e.clientX; sy = e.clientY; stx = tx; sty = ty; img.style.cursor = 'grabbing';
      if (e.pointerType === 'mouse') stage.setPointerCapture(e.pointerId);
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {                                  // 핀치 확대
      const d = dist2(), m = mid2();
      if (pinchDist > 0) zoomAt(d / pinchDist, m.x, m.y);
      pinchDist = d;
    } else if (drag) {
      tx = stx + (e.clientX - sx); ty = sty + (e.clientY - sy); apply();
    }
  });
  const endPtr = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0 && drag) { drag = false; img.style.cursor = scale > 1 ? 'grab' : 'default'; try { stage.releasePointerCapture(e.pointerId); } catch {} }
  };
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);

  /* ---------- 네비게이션/렌더 ---------- */
  function resolve(list) {
    let c = state.current;
    if (!c || !list.includes(c)) c = list[0] || null;
    state.current = c;
    return c;
  }
  async function loadImage(name) {
    if (name === shown) return;
    shown = name;
    resetZoom();                                        // 사진 바뀌면 확대 초기화
    if (!name) { img.hidden = true; if (!stage.contains(empty)) stage.append(empty); return; }
    if (stage.contains(empty)) empty.remove();
    img.hidden = false;
    const url = await fs.getURL(name);
    if (shown === name) img.src = url || '';
    const list = navList(), i = list.indexOf(name);     // 이웃 미리 로드
    for (const j of [i + 1, i - 1, i + 2]) if (list[j]) fs.getURL(list[j]);
  }
  function step(d) {
    const list = navList();
    if (!list.length) return;
    let i = list.indexOf(resolve(list));
    i = Math.max(0, Math.min(list.length - 1, i + d));
    state.current = list[i];
    update();
  }
  function update() {
    const list = navList();
    const cur = resolve(list);
    loadImage(cur);
    clear(info);
    if (!cur) { center.textContent = ''; return; }
    center.textContent = `${list.indexOf(cur) + 1} / ${list.length}`;
    info.append(
      el('div', { class: 'fname' }, cur),
      myStars(cur, 'md'),
      el('div', { class: 'scores' },
        el('span', {}, `🤵 ${groomScore(cur) || '-'}`),
        el('span', {}, `👰 ${brideScore(cur) || '-'}`),
        el('span', { class: 'tot' }, `합계 ${total(cur)}`),
      ),
    );
  }

  function onKey(e) {
    if (state.view !== 'rate') return;
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'ArrowRight')      { step(1);  e.preventDefault(); }
    else if (e.key === 'ArrowLeft')  { step(-1); e.preventDefault(); }
    else if (e.key >= '1' && e.key <= '5') { if (state.current) setMyScore(state.current, +e.key); }
    else if (e.key === '0')          { if (state.current) setMyScore(state.current, 0); }
    else if (e.key === '+' || e.key === '=') { zoomAt(1.25, cx(), cy()); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { zoomAt(1 / 1.25, cx(), cy()); e.preventDefault(); }
    else if (e.key === 'f' || e.key === 'F') { resetZoom(); }
  }
  document.addEventListener('keydown', onKey);

  update();
  return { update, dispose() { document.removeEventListener('keydown', onKey); } };
}
