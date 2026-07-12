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
const sheet = new Map();          // filename -> {groom, bride, picked}
let lastPost = null;
const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    const rows = [...sheet].map(([filename, v]) => ({ filename, groom: v.groom || 0, bride: v.bride || 0, picked: !!v.picked }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(rows));
    return;
  }
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const parsed = JSON.parse(body);
    lastPost = parsed;
    if (parsed.picks) {                             // 픽 동기화(Code.gs picks 경로와 동일)
      for (const it of parsed.picks) {
        const cur = sheet.get(it.filename) || { groom: 0, bride: 0 };
        cur.picked = !!it.picked;                   // 역할 무관 공유 플래그
        sheet.set(it.filename, cur);
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, count: parsed.picks.length }));
      return;
    }
    const { role, items } = parsed;
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
// 앱과 동일하게 '정규화 키'를 식별자로 사용(fs가 소문자 .jpg 키를 만든다)
const FILES = ['img_1.jpg', 'img_2.jpg', 'img_3.jpg', 'img_10.jpg'];
state.names = new Map(FILES.map(n => [n, n]));
state.files = FILES.slice();
sync.setBackend(createSheetsBackend({ url }));

/* ===== 1) ratings 순수 로직 ===== */
console.log('\n[1] ratings 로직');
state.role = 'groom'; R.loadPersisted();
R.setMyScore('img_1.jpg', 5);
R.setMyScore('img_2.jpg', 4);
R.setMyScore('img_10.jpg', 2);
eq(R.myScore('img_1.jpg'), 5, 'setMyScore 반영');
eq(R.myScore('img_9.jpg'), 0, '미평가는 0');
eq(R.navList(), ['img_1.jpg', 'img_2.jpg', 'img_3.jpg', 'img_10.jpg'], 'navList가 파일 순서 보존');
eq(R.counts(), { total: 4, rated: 3 }, '카운트');

/* ===== 2) 신랑 → 시트 push ===== */
console.log('\n[2] 신랑 점수 push');
await sync.flush();
eq(lastPost.role, 'groom', 'POST role=groom');
eq(sheet.get('img_1.jpg'), { groom: 5, bride: 0 }, '시트에 신랑 점수 저장');
eq([...state.pending].length, 0, 'flush 후 pending 비움');

/* ===== 3) 신부(다른 기기)로 전환해 push ===== */
console.log('\n[3] 신부 점수 push');
state.role = 'bride'; R.loadPersisted();
eq(R.myScore('img_1.jpg'), 0, '신부는 아직 로컬 점수 없음');
R.setMyScore('img_1.jpg', 4);
R.setMyScore('img_2.jpg', 5);
R.setMyScore('img_3.jpg', 5);
await sync.flush();
eq(sheet.get('img_1.jpg'), { groom: 5, bride: 4 }, '같은 파일에 신랑·신부 점수 공존');

/* ===== 4) 신랑이 다시 열어 동기화 → 합계 결합 ===== */
console.log('\n[4] 신랑 재접속 pull → 합계 결합');
state.role = 'groom'; R.loadPersisted();
await sync.pollNow();
eq(R.groomScore('img_1.jpg'), 5, 'groomScore');
eq(R.brideScore('img_1.jpg'), 4, 'brideScore(상대)');
eq(R.total('img_1.jpg'), 9, 'img_1 합계 9');
eq(R.total('img_2.jpg'), 9, 'img_2 합계 9');
eq(R.total('img_10.jpg'), 2, 'img_10 합계 2 (신랑만)');
eq(R.total('img_3.jpg'), 5, 'img_3 합계 5 (신부만)');
eq([...state.pending].length, 0, 'pull이 pending 재확인·정리');

/* ===== 5) 필터/정렬 ===== */
console.log('\n[5] 합계 필터·정렬');
state.filter = { minTotal: 9, mine: 'all', other: 'all', sortByTotal: true };
eq(R.navList(), ['img_1.jpg', 'img_2.jpg'], '합계≥9 필터 + 합계순');

console.log('\n[5b] 점수 필터(내/상대)');
state.filter = { minTotal: 0, mine: 'all', other: '5', sortByTotal: false };
eq(R.navList(), ['img_2.jpg', 'img_3.jpg'], '상대(신부) 5점만');
state.filter = { minTotal: 0, mine: '5', other: 'all', sortByTotal: false };
eq(R.navList(), ['img_1.jpg'], '내 5점만');
state.filter = { minTotal: 0, mine: 'all', other: 'ge4', sortByTotal: false };
eq(R.navList(), ['img_1.jpg', 'img_2.jpg', 'img_3.jpg'], '상대 4점 이상');
state.filter = { minTotal: 0, mine: 'unrated', other: 'all', sortByTotal: false };
eq(R.navList(), ['img_3.jpg'], '내 미평가만');

/* ===== 6) 최종 내보내기 ===== */
console.log('\n[6] 최종 내보내기(txt/csv)');
state.filter = { minTotal: 9, mine: 'all', other: 'all', sortByTotal: true };
downloads.length = 0;
exportSelection();
eq(downloads.length, 2, '픽 없으면 txt/csv 2개만');
eq(downloads[0], 'img_1.jpg\nimg_2.jpg', 'txt = 파일명 리스트');
const csv = downloads[1].replace(/^﻿/, '');
eq(csv, 'filename,groom,bride,total,picked\nimg_1.jpg,5,4,9,\nimg_2.jpg,4,5,9,', 'csv = filename,groom,bride,total,picked');

/* ===== 7) 정규화 키: 확장자/대소문자/NFD·NFC ===== */
console.log('\n[7] 파일명 정규화 키');
eq(R.canon('NT0612_4605.jpeg'), R.canon('NT0612_4605.jpg'), '.jpeg와 .jpg가 같은 키');
eq(R.canon('A.JPG'), R.canon('a.jpg'), '대소문자가 같은 키');
const nfd = '결혼사진.jpg'.normalize('NFD'), nfc = '결혼사진.jpg'.normalize('NFC');
eq(nfd !== nfc, true, 'NFD와 NFC 원본이 실제로 다름');
eq(R.canon(nfd), R.canon(nfc), 'NFD/NFC가 같은 키');

/* ===== 8) 확장자 다른 두 행 병합 → 서로 점수 보임 (실제 버그) ===== */
console.log('\n[8] 확장자 다른 같은 사진 병합');
state.role = 'groom'; state.mine = new Map(); state.pending = new Map();
R.applyRemote([
  { filename: 'NT0612_4605.jpeg', groom: 0, bride: 3 },   // 신부가 .jpeg로 매김
  { filename: 'NT0612_4605.jpg',  groom: 4, bride: 0 },   // 신랑이 .jpg로 매김
]);
const key = R.canon('NT0612_4605.jpg');
eq(R.groomScore(key), 4, '신랑 점수 4');
eq(R.brideScore(key), 3, '신부 점수 3 (병합돼 보임)');
eq(R.total(key), 7, '합계 7 — 서로 점수가 보인다');

/* ===== 9) fs는 원래 이름 유지하며 키만 정규화 ===== */
console.log('\n[9] fs 키 정규화 + 원래 이름 유지');
const fsmod = await import('../src/fs.js');
fsmod.useFileList([{ name: 'NT0612_4605.JPEG' }]);
eq(state.files[0], R.canon('NT0612_4605.jpg'), 'fs가 정규화 키 사용');
eq(R.nameOf(state.files[0]), 'NT0612_4605.JPEG', '표시는 원래 파일명 유지');

/* ===== 10) 자기치유: 시트에서 사라진 내 점수 자동 재큐잉 ===== */
console.log('\n[10] 자기치유(시트 유실 자동 복구)');
state.role = 'groom';
state.mine = new Map([['lost_1.jpg', 5], ['ok_1.jpg', 4], ['unrated_0.jpg', 0]]);
state.pending = new Map();
R.applyRemote([{ filename: 'ok_1.jpg', groom: 4, bride: 0 }]);   // lost_1이 시트에 없음(유실 상황)
eq(state.pending.get('lost_1.jpg'), 5, '시트에 없는 내 점수 → pending 자동 재등록');
eq(state.pending.has('ok_1.jpg'), false, '시트에 반영된 점수는 재전송 안 함');
eq(state.pending.has('unrated_0.jpg'), false, '0점(미평가)은 재전송 안 함');
await sync.flush();
eq(sheet.get('lost_1.jpg'), { groom: 5, bride: 0 }, 'flush로 시트에 자동 복구');
eq([...state.pending].length, 0, '복구 후 pending 비움');

/* ===== 11) 최종 픽: 토글·필터·영속·내보내기 ===== */
console.log('\n[11] 최종 픽');
state.files = ['a.jpg', 'b.jpg', 'c.jpg'];
state.names = new Map([['a.jpg', 'A.JPG']]);            // 표시명은 원래 파일명 유지 확인용
state.mine = new Map(); state.pending = new Map(); state.remote = new Map();
state.picks = new Set();
R.togglePick('a.jpg');
R.togglePick('c.jpg');
eq(R.isPicked('a.jpg'), true, 'togglePick → 픽됨');
eq(state.picks.size, 2, '픽 2장 카운트');
state.filter = { minTotal: 0, mine: 'all', other: 'all', sortByTotal: false, picked: true };
eq(R.navList(), ['a.jpg', 'c.jpg'], "'픽만' 필터");
R.togglePick('c.jpg');
eq(R.navList(), ['a.jpg'], '픽 해제가 필터에 반영');
R.togglePick('c.jpg');
eq(R.pickedList(), ['a.jpg', 'c.jpg'], 'pickedList = 파일 순서');
state.picks = new Set();
R.loadPersisted();                                       // localStorage에서 복원
eq([...state.picks].sort(), ['a.jpg', 'c.jpg'], '픽이 localStorage에 영속');
state.filter = { minTotal: 0, mine: 'all', other: 'all', sortByTotal: false, picked: false };
downloads.length = 0;
exportSelection();
eq(downloads.length, 3, '픽 있으면 final txt 추가(3개 다운로드)');
eq(downloads[2], 'A.JPG\nc.jpg', 'final txt = 픽된 원래 파일명만');
{
  const c = downloads[1].replace(/^﻿/, '').split('\n');
  eq(c[0], 'filename,groom,bride,total,picked', 'csv picked 열');
  eq(c[1], 'A.JPG,0,0,0,1', '픽된 행 picked=1');
  eq(c[2], 'b.jpg,0,0,0,', '안 픽된 행은 빈칸');
}

/* ===== 12) 최종 픽 동기화(두 기기 공유) ===== */
console.log('\n[12] 최종 픽 동기화');
state.mine = new Map(); state.pending = new Map();
state.role = 'groom';
state.picks = new Set(); state.pendingPicks = new Map(); state.remotePicks = new Set();
R.togglePick('psync1.jpg');
eq(R.getPendingPicks().length, 1, '픽 토글이 전송 큐에 쌓임');
await sync.flush();
eq(sheet.get('psync1.jpg')?.picked, true, 'flush로 픽이 시트에 기록');
eq(R.getPendingPicks().length, 0, '전송 완료 후 큐 비움');

// 신부 기기: pull만 해도 신랑이 고른 픽이 그대로 보인다(공유)
state.role = 'bride';
state.mine = new Map(); state.pending = new Map();
state.picks = new Set(); state.pendingPicks = new Map(); state.remotePicks = new Set();
await sync.pollNow();
eq(R.isPicked('psync1.jpg'), true, '상대 기기에서 픽이 그대로 보임');

// 신부가 픽 추가 → 신랑이 pull하면 두 픽이 합쳐진다
R.togglePick('psync2.jpg');
await sync.flush();
state.role = 'groom';
state.picks = new Set(); state.pendingPicks = new Map(); state.remotePicks = new Set();
await sync.pollNow();
eq(R.isPicked('psync1.jpg') && R.isPicked('psync2.jpg'), true, '양쪽 픽이 합쳐져 보임');

// 픽 해제도 전파: 신랑이 해제 → 신부 기기의 픽이 사라진다
R.togglePick('psync1.jpg');   // 해제
await sync.flush();
eq(sheet.get('psync1.jpg')?.picked, false, '해제가 시트에 반영(빈칸)');
state.role = 'bride';
state.picks = new Set(['psync1.jpg', 'psync2.jpg']); state.pendingPicks = new Map();
await sync.pollNow();
eq(R.isPicked('psync1.jpg'), false, '픽 해제가 상대 기기에 전파');
eq(R.isPicked('psync2.jpg'), true, '해제 안 한 픽은 유지');

// 아직 못 보낸 로컬 토글은 pull이 덮어쓰지 않는다(전송 대기 중 유실 방지)
state.pendingPicks = new Map([['psync3.jpg', true]]);
state.picks = new Set(['psync3.jpg']);
await sync.pollNow();          // 시트엔 psync3 픽이 아직 없음
eq(R.isPicked('psync3.jpg'), true, '전송 대기 중 픽은 pull이 안 지움');

/* ---------- 결과 ---------- */
console.log(`\n결과: ${pass} passed, ${fail} failed`);
server.close();
process.exit(fail ? 1 : 0);
