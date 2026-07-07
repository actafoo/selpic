// 비교 모드: 담아둔 사진 2~4장을 나란히 보며 평점.
// 비슷한 구도끼리 담아 보고 '♥ 픽'으로 승자를 그 자리에서 최종 선택하는 화면.
import { state, toggleCompare, clearCompare, groomScore, brideScore, total, nameOf, isPicked, togglePick } from './ratings.js';
import { el, clear, myStars } from './ui-common.js';
import * as fs from './fs.js';

export function renderCompare(root) {
  const names = [...state.compare];
  if (!names.length) {
    root.append(el('div', { class: 'empty' }, '그리드에서 ⚖ 버튼으로 비교할 사진을 담아보세요. (최대 4장)\n비슷한 구도끼리 담아 보고 마음에 드는 쪽을 ♥ 픽!'));
    return { update() {}, dispose() {} };
  }

  // 위: 얇은 도구줄(담은 개수 + 전부 비우기), 아래: 패널 그리드
  const grid = el('div', { class: 'compare cols' + names.length });
  const tools = el('div', { class: 'cmp-tools' },
    el('span', { class: 'cmp-hint' }, `⚖ ${names.length}장 비교 중 — 마음에 드는 사진을 ♥ 픽`),
    el('button', { class: 'sm', onclick: () => { clearCompare(); rebuild(); } }, '✕ 전부 비우기'),
  );
  root.append(el('div', { class: 'cmp-wrap' }, tools, grid));
  const infos = new Map();

  for (const name of names) {
    const img = el('img', { class: 'cmp-photo', alt: '' });
    fs.getURL(name).then(u => { if (u) img.src = u; });
    const info = el('div', { class: 'cmp-info' });
    infos.set(name, info);
    grid.append(el('div', { class: 'cmp-panel' },
      img,
      info,
    ));
  }

  function paint() {
    for (const [name, info] of infos) {
      clear(info);
      const picked = isPicked(name);
      info.append(
        el('div', { class: 'fname' }, nameOf(name)),
        el('div', { class: 'myrate' }, myStars(name, 'md')),
        el('div', { class: 'scores' },
          el('span', {}, `🤵 ${groomScore(name) || '-'}`),
          el('span', {}, `👰 ${brideScore(name) || '-'}`),
          el('span', { class: 'tot' }, `합계 ${total(name)}`),
        ),
        el('div', { class: 'cmp-actions' },
          el('button', { class: 'pick-btn' + (picked ? ' on' : ''), onclick: () => togglePick(name) }, picked ? '♥ 픽됨' : '♡ 픽'),
          el('button', { class: 'link rm', onclick: () => { toggleCompare(name); rebuild(); } }, '✕ 빼기'),
        ),
      );
      info.parentElement.classList.toggle('picked', picked);
    }
  }
  // 패널 개수가 바뀌면 통째로 다시 그린다.
  function rebuild() { document.dispatchEvent(new CustomEvent('selpic:view', { detail: { view: 'compare' } })); }

  paint();
  return { update: paint, dispose() {} };
}
