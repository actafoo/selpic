// 별점 분포 통계 패널(화면 구석). 신랑·신부가 지금까지 1~5점을 몇 장씩 줬는지 미니 막대로.
import { ratingStats } from './ratings.js';
import { el, clear } from './ui-common.js';

export function renderStats(root) {
  root.append(el('div', { class: 'stats-title' }, '📊 별점 분포'));
  const body = el('div', { class: 'stats-body' });
  root.append(body);

  function paint() {
    clear(body);
    const s = ratingStats();
    body.append(roleRow('🤵 신랑', s.groom, ''), roleRow('👰 신부', s.bride, 'bride'));
  }
  paint();
  return { update: paint };
}

function roleRow(label, arr, cls) {
  const rated = arr[1] + arr[2] + arr[3] + arr[4] + arr[5];
  const sum = arr[1] + arr[2] * 2 + arr[3] * 3 + arr[4] * 4 + arr[5] * 5;
  const avg = rated ? (sum / rated).toFixed(1) : '-';
  const max = Math.max(1, arr[1], arr[2], arr[3], arr[4], arr[5]);

  const bars = el('div', { class: 'stats-bars' });
  for (let i = 1; i <= 5; i++) {
    bars.append(el('div', { class: 'stats-col' },
      el('div', { class: 'stats-count' }, String(arr[i])),
      el('div', { class: 'stats-bar-wrap' },
        el('div', { class: 'stats-bar ' + cls, style: { height: Math.round((arr[i] / max) * 100) + '%' } })),
      el('div', { class: 'stats-star' }, i + '★'),
    ));
  }
  return el('div', { class: 'stats-role' },
    el('div', { class: 'stats-head' }, el('span', {}, label), el('span', {}, `평균 ${avg} · ${rated}장`)),
    bars,
  );
}
