// 그리드 모드: 썸네일 격자 + 내 점수/합계 뱃지. 지연 로딩(IntersectionObserver).
import { state, navList, myScore, total, toggleCompare, nameOf, isPicked, togglePick } from './ratings.js';
import { el } from './ui-common.js';
import * as fs from './fs.js';

export function renderGrid(root) {
  const list = navList();
  if (!list.length) {
    root.append(el('div', { class: 'empty' }, '표시할 사진이 없어요. (필터를 확인해 주세요)'));
    return { update() {}, dispose() {} };
  }

  const grid = el('div', { class: 'grid' });
  root.append(grid);
  const badges = new Map();   // name -> {my, tot, pick, cell}

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const cell = en.target;
      if (cell.dataset.loaded) continue;
      cell.dataset.loaded = '1';
      // 원본 대신 320px 썸네일(원본 디코드는 1000장+에서 스크롤을 멈추게 한다)
      fs.getThumbURL(cell.dataset.name)
        .then(u => u || fs.getURL(cell.dataset.name))     // 썸네일 실패 시 원본 폴백
        .then(u => { if (u) cell.querySelector('img').src = u; });
      io.unobserve(cell);
    }
  }, { root: null, rootMargin: '500px' });

  for (const name of list) {
    const my  = el('span', { class: 'b-my' });
    const tot = el('span', { class: 'b-tot' });
    const cmp = el('button', {
      class: 'cmp-add' + (state.compare.has(name) ? ' on' : ''),
      title: '비교에 담기 (최대 4장)',
      onclick: (e) => { e.stopPropagation(); toggleCompare(name); cmp.classList.toggle('on', state.compare.has(name)); },
    }, '⚖');
    const pick = el('button', {
      class: 'pick-add',
      title: '최종 픽',
      onclick: (e) => { e.stopPropagation(); togglePick(name); },
    }, '♡');
    const cell = el('div', { class: 'cell', 'data-name': name },
      el('img', { class: 'thumb', alt: '', decoding: 'async' }),
      el('div', { class: 'cell-badges' }, my, tot),
      cmp,
      pick,
      el('div', { class: 'cell-name' }, nameOf(name)),
    );
    cell.addEventListener('click', () => document.dispatchEvent(new CustomEvent('selpic:open', { detail: { name } })));
    badges.set(name, { my, tot, pick, cell });
    grid.append(cell);
    io.observe(cell);
  }

  function paint() {
    // '픽만' 필터 중 그리드에서 픽을 해제하면 목록 자체가 줄어듦 → 통째로 다시 그림
    if (state.filter.picked && navList().length !== badges.size) {
      document.dispatchEvent(new CustomEvent('selpic:view', { detail: { view: 'grid' } }));
      return;
    }
    for (const [name, { my, tot, pick, cell }] of badges) {
      const m = myScore(name), t = total(name);
      my.textContent = m ? '나 ' + m : '';
      my.classList.toggle('none', !m);
      tot.textContent = '합 ' + t;
      tot.classList.toggle('hi', t >= 8);
      const p = isPicked(name);
      pick.textContent = p ? '♥' : '♡';
      pick.classList.toggle('on', p);
      cell.classList.toggle('picked', p);
    }
  }
  paint();
  return { update: paint, dispose() { io.disconnect(); } };
}
