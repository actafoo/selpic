// 작은 DOM 헬퍼 + 공용 별점 위젯.
import { myScore, setMyScore } from './ratings.js';

export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

// 내 점수를 매기는 인터랙티브 별점 (클릭 시 setMyScore → 스토어 갱신)
export function myStars(name, size = 'lg') {
  const cur = myScore(name);
  const wrap = el('div', { class: `stars ${size}`, 'data-name': name });
  for (let i = 1; i <= 5; i++) {
    wrap.append(el('button', {
      class: 'star' + (i <= cur ? ' on' : ''),
      type: 'button',
      title: `${i}점`,
      onclick: () => setMyScore(name, cur === i ? 0 : i), // 같은 별 다시 누르면 해제
    }, '★'));
  }
  return wrap;
}
