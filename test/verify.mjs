// End-to-end 검증(브라우저 없이):
//  - ratings.js  : 점수 병합/역할별 조회/합계/필터·정렬/카운트
//  - sheets-backend.js + sync.js : 실제 fetch로 mock 시트에 push/pull
//  - 두 클라이언트(신랑↔신부) 동기화가 합계로 합쳐지는지
//  - export.js   : txt/csv 내보내기 내용
// mock 서버는 apps-script/Code.gs의 upsert 의미를 그대로 흉내낸다.
import http from 'node:http';

/* ---------- 브라우저 전역 shim (Node용) ---------- */
const ls = new Map();
globalThis.localStorage = {
  getItem: k => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: k => ls.delete(k),
};
const downloads = [];
globalThis.Blob = class { constructor(parts) { this._text = parts.join(''); } };
// 실제 URL 생성자는 유지(undici fetch가 씀). Blob URL 메서드만 얹는다.
URL.createObjectURL = b => { downloads.push(b._text); return 'blob:' + downloads.length; };
URL.revokeObjectURL = () => {};
globalThis.document = {
  createElement: () => ({ click() {}, remove() {}, set href(_) {}, set download(_) {} }),
  body: { append() {} },
};

/* ---------- Code.gs 의미를 흉내낸 mock 시트 서버 ---------- */
const sheet = new Map();          // filename -> {groom, bride}
let lastPost = null;
const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    const rows = [...sheet].map(([filename, v]) => ({ filename, groom: v.groom || 0, bride: v.bride || 0 }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(rows));
    return;
  }
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const { role, items } = JSON.parse(body);
    lastPost = { role, items };
    for (const it of items) {                       // upsert (Code.gs와 동일)
      const cur = sheet.get(it.filename) || { groom: 0, bride: 0 };
      cur[role] = Number(it.score) || 0;
      sheet.set(it.filename, cur);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, count: items.length }));
  });
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/exec`;

/* ---------- 모듈 로드 ---------- */
const R = await import('../src/ratings.js');
const { createSheetsBackend } = await import('../src/backends/sheets-backend.js');
const sync = await import('../src/sync.js');
const { exportSelection } = await import('../src/export.js');

/* ---------- 작은 assert ---------- */
let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}\n      got  ${g}\n      want ${w}`); }
};

const { state } = R;
state.webAppUrl = url;
// fs.js가 naturalSort로 정렬해 넘겨주는 순서를 그대로 재현(IMG_3 < IMG_10)
state.files = ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'IMG_10.jpg'].map(name => ({ name }));
sync.setBackend(createSheetsBackend({ url }));

/* ===== 1) ratings 순수 로직 ===== */
console.log('\n[1] ratings 로직');
state.role = 'groom'; R.loadPersisted();
R.setMyScore('IMG_1.jpg', 5);
R.setMyScore('IMG_2.jpg', 4);
R.setMyScore('IMG_10.jpg', 2);
eq(R.myScore('IMG_1.jpg'), 5, 'setMyScore 반영');
eq(R.myScore('IMG_9.jpg'), 0, '미평가는 0');
eq(R.navList(), ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg', 'IMG_10.jpg'], 'navList가 파일 순서 보존');
eq(R.counts(), { total: 4, rated: 3 }, '카운트');

/* ===== 2) 신랑 → 시트 push ===== */
console.log('\n[2] 신랑 점수 push');
await sync.flush();
eq(lastPost.role, 'groom', 'POST role=groom');
eq(sheet.get('IMG_1.jpg'), { groom: 5, bride: 0 }, '시트에 신랑 점수 저장');
eq([...state.pending].length, 0, 'flush 후 pending 비움');

/* ===== 3) 신부(다른 기기)로 전환해 push ===== */
console.log('\n[3] 신부 점수 push');
state.role = 'bride'; R.loadPersisted();
eq(R.myScore('IMG_1.jpg'), 0, '신부는 아직 로컬 점수 없음');
R.setMyScore('IMG_1.jpg', 4);
R.setMyScore('IMG_2.jpg', 5);
R.setMyScore('IMG_3.jpg', 5);
await sync.flush();
eq(sheet.get('IMG_1.jpg'), { groom: 5, bride: 4 }, '같은 파일에 신랑·신부 점수 공존');

/* ===== 4) 신랑이 다시 열어 동기화 → 합계 결합 ===== */
console.log('\n[4] 신랑 재접속 pull → 합계 결합');
state.role = 'groom'; R.loadPersisted();
await sync.pollNow();
eq(R.groomScore('IMG_1.jpg'), 5, 'groomScore');
eq(R.brideScore('IMG_1.jpg'), 4, 'brideScore(상대)');
eq(R.total('IMG_1.jpg'), 9, 'IMG_1 합계 9');
eq(R.total('IMG_2.jpg'), 9, 'IMG_2 합계 9');
eq(R.total('IMG_10.jpg'), 2, 'IMG_10 합계 2 (신랑만)');
eq(R.total('IMG_3.jpg'), 5, 'IMG_3 합계 5 (신부만)');
eq([...state.pending].length, 0, 'pull이 pending 재확인·정리');

/* ===== 5) 필터/정렬 ===== */
console.log('\n[5] 합계 필터·정렬');
state.filter = { minTotal: 9, mode: 'all', sortByTotal: true };
eq(R.navList(), ['IMG_1.jpg', 'IMG_2.jpg'], '합계≥9 필터 + 합계순');

/* ===== 6) 최종 내보내기 ===== */
console.log('\n[6] 최종 내보내기(txt/csv)');
downloads.length = 0;
exportSelection();
eq(downloads[0], 'IMG_1.jpg\nIMG_2.jpg', 'txt = 파일명 리스트');
const csv = downloads[1].replace(/^﻿/, '');
eq(csv, 'filename,groom,bride,total\nIMG_1.jpg,5,4,9\nIMG_2.jpg,4,5,9', 'csv = filename,groom,bride,total');

/* ---------- 결과 ---------- */
console.log(`\n결과: ${pass} passed, ${fail} failed`);
server.close();
process.exit(fail ? 1 : 0);
