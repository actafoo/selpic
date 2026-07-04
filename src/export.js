// 최종 내보내기: 현재 필터/정렬이 적용된 목록을 파일명 리스트로 저장.
// - selpic-selected.txt : 한 줄에 파일명 하나
// - selpic-selected.csv : filename, groom, bride, total
import { navList, groomScore, brideScore, total, nameOf } from './ratings.js';

export function exportSelection() {
  const list = navList();
  if (!list.length) { alert('내보낼 사진이 없어요. 필터(합계≥ 등)를 조정해 주세요.'); return; }

  const stamp = new Date().toISOString().slice(0, 10);

  download(`selpic-${stamp}.txt`, list.map(nameOf).join('\n'), 'text/plain');   // 원래 파일명으로 내보내기

  const rows = [['filename', 'groom', 'bride', 'total']];
  for (const n of list) rows.push([nameOf(n), groomScore(n), brideScore(n), total(n)]);
  const csv = rows.map(r => r.map(cell).join(',')).join('\n');
  download(`selpic-${stamp}.csv`, '﻿' + csv, 'text/csv');   // BOM: 엑셀 한글 대응
}

function cell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type: type + ';charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
