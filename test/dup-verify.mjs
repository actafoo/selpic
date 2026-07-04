// 실제 배포된 시트로 "같은 파일명, 두 역할" 이 한 행에 합쳐지는지 검증.
//   node test/dup-verify.mjs   (URL은 src/config.js의 DEFAULT_SHEET_URL 사용, SELPIC_URL로 덮어쓰기 가능)
import { DEFAULT_SHEET_URL } from '../src/config.js';
const URL = process.env.SELPIC_URL || DEFAULT_SHEET_URL;
const ts = Date.now();

const post = (role, filename, score) =>
  fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ role, items: [{ filename, score }] }) });
const getRows = async () => JSON.parse(await (await fetch(URL + '?_=' + Date.now())).text());
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

console.log(`URL: ${URL}\n`);

/* 1) 순차: 신랑 → 신부 (사용자 시나리오 그대로) */
console.log('[1] 순차 — 신랑이 먼저, 신부가 나중');
const f1 = `dup_seq_${ts}.jpg`;
await post('groom', f1, 5); await sleep(1500);
await post('bride', f1, 3); await sleep(1800);
let rows = await getRows();
let m1 = rows.filter(r => r.filename === f1);
ok(m1.length === 1, `한 행에만 존재 (개수=${m1.length})`);
ok(m1[0]?.groom === 5 && m1[0]?.bride === 3, `같은 행에 신랑5·신부3 (${JSON.stringify(m1[0])})`);

/* 2) 동시: 두 기기가 거의 같은 순간 (LockService 경쟁) */
console.log('\n[2] 동시 — 두 기기 동시 전송(경쟁 조건)');
const f2 = `dup_race_${ts}.jpg`;
await Promise.all([post('groom', f2, 4), post('bride', f2, 2)]);
await sleep(2200);
rows = await getRows();
let m2 = rows.filter(r => r.filename === f2);
ok(m2.length === 1, `동시에도 한 행 (개수=${m2.length})`);
ok(m2[0]?.groom === 4 && m2[0]?.bride === 2, `같은 행에 신랑4·신부2 (${JSON.stringify(m2[0])})`);

/* 3) 한글 파일명 정규화: 맥(NFD) ↔ 아이폰/윈도우(NFC) */
console.log('\n[3] 한글 파일명 — NFC(신랑) vs NFD(신부) 정규화 차이');
const base = `결혼_${ts}.jpg`;
const nfc = base.normalize('NFC');
const nfd = base.normalize('NFD');
ok(nfc !== nfd, `NFC와 NFD 바이트가 실제로 다름 (len ${nfc.length} vs ${nfd.length})`);
await post('groom', nfc, 5); await sleep(1500);
await post('bride', nfd, 4); await sleep(1800);
rows = await getRows();
const m3 = rows.filter(r => r.filename.normalize('NFC') === nfc);
ok(m3.length === 1, `한글도 한 행으로 합쳐짐 (개수=${m3.length})  ← 2면 정규화 버그`);
if (m3.length === 1) ok(m3[0].groom === 5 && m3[0].bride === 4, `한글 행에 신랑5·신부4 (${JSON.stringify(m3[0])})`);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
console.log(`\n※ 시트에 테스트 행이 남습니다: dup_seq_*, dup_race_*, 결혼_* → 확인 후 삭제하세요.`);
process.exit(fail ? 1 : 0);
