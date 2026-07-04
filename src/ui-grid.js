// 그리드 모드: 썸네일 격자 + 내 점수/합계 뱃지. 지연 로딩(IntersectionObserver).
import { state, navList, myScore, total, toggleCompare } from './ratings.js';
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
  const badges = new Map();   // name -> {my, tot}

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const cell = en.target;
      if (cell.dataset.loaded) continue;
      cell.dataset.loaded = '1';
      fs.getURL(cell.dataset.name).then(u => { if (u) cell.querySelector('img').src = u; });
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
    const cell = el('div', { class: 'cell', 'data-name': name },
      el('img', { class: 'thumb', alt: '' }),
      el('div', { class: 'cell-badges' }, my, tot),
      cmp,
      el('div', { class: 'cell-name' }, name),
    );
    cell.addEventListener('click', () => document.dispatchEvent(new CustomEvent('selpic:open', { detail: { name } })));
    badges.set(name, { my, tot });
    grid.append(cell);
    io.observe(cell);
  }

  function paint() {
    for (const [name, { my, tot }] of badges) {
      const m = myScore(name), t = total(name);
      my.textContent = m ? '나 ' + m : '';
      my.classList.toggle('none', !m);
      tot.textContent = '합 ' + t;
      tot.classList.toggle('hi', t >= 8);
    }
  }
  paint();
  return { update: paint, dispose() { io.disconnect(); } };
}
