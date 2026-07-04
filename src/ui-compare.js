// 비교 모드: 담아둔 사진 2~4장을 나란히 보며 평점.
import { state, toggleCompare, groomScore, brideScore, total, nameOf } from './ratings.js';
import { el, clear, myStars } from './ui-common.js';
import * as fs from './fs.js';

export function renderCompare(root) {
  const names = [...state.compare];
  if (!names.length) {
    root.append(el('div', { class: 'empty' }, '그리드에서 ⚖ 버튼으로 비교할 사진을 담아보세요. (최대 4장)'));
    return { update() {}, dispose() {} };
  }

  const wrap = el('div', { class: 'compare cols' + names.length });
  root.append(wrap);
  const infos = new Map();

  for (const name of names) {
    const img = el('img', { class: 'cmp-photo', alt: '' });
    fs.getURL(name).then(u => { if (u) img.src = u; });
    const info = el('div', { class: 'cmp-info' });
    infos.set(name, info);
    wrap.append(el('div', { class: 'cmp-panel' },
      img,
      el('button', { class: 'link rm', onclick: () => { toggleCompare(name); rebuild(); } }, '✕ 비교에서 빼기'),
      info,
    ));
  }

  function paint() {
    for (const [name, info] of infos) {
      clear(info);
      info.append(
        el('div', { class: 'fname' }, nameOf(name)),
        el('div', { class: 'myrate' }, myStars(name, 'md')),
        el('div', { class: 'scores' },
          el('span', {}, `🤵 ${groomScore(name) || '-'}`),
          el('span', {}, `👰 ${brideScore(name) || '-'}`),
          el('span', { class: 'tot' }, `합계 ${total(name)}`),
        ),
      );
    }
  }
  // 패널 개수가 바뀌면 통째로 다시 그린다.
  function rebuild() { document.dispatchEvent(new CustomEvent('selpic:view', { detail: { view: 'compare' } })); }

  paint();
  return { update: paint, dispose() {} };
}
