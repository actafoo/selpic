// 실제 배포된 Apps Script URL로 브라우저 CORS 왕복을 검증한다.
//   SELPIC_URL=<웹앱 URL> node test/real-verify.mjs
// 실제 크롬에서 앱을 띄우고: 신랑 평점 → POST(브라우저) → 시트 반영 확인,
// 그리고 시트에 신부 점수를 넣고 → 앱에서 GET(브라우저) → 합계 반영 확인.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const URL = process.env.SELPIC_URL;
if (!URL) { console.error('SELPIC_URL 환경변수가 필요합니다'); process.exit(2); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AV//Z', 'base64');
const ts = Date.now();
const NAMES = [`sttest_${ts}_1.jpg`, `sttest_${ts}_2.jpg`];   // 식별·삭제 쉬운 유니크 이름
const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selpic-real-'));
NAMES.forEach(n => fs.writeFileSync(path.join(imgDir, n), TINY_JPEG));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => srv.listen(0, r));
const APP_URL = `http://localhost:${srv.address().port}/`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getSheet = async () => JSON.parse(await (await fetch(URL)).text());

const browser = await chromium.launch();
const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
const warns = [];
page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
page.on('pageerror', e => warns.push(String(e)));

try {
  console.log(`\n실제 URL: ${URL}`);
  await page.goto(APP_URL);

  /* 1) 신랑으로 접속 + 폴더 로드 */
  console.log('\n[1] 접속');
  await page.click('.role-btn[data-role="groom"]');
  await page.fill('#urlInput', URL);
  await page.setInputFiles('#folderFallback', imgDir);
  await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
  ok(true, '앱 진입');

  /* 2) 브라우저에서 평점 → POST(실 CORS) */
  console.log('\n[2] 브라우저 POST → 시트 반영');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('5');                         // 1번 사진 = 5
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('4');                         // 2번 사진 = 4
  await page.click('#syncBtn');                           // flush(POST) + pollNow(GET)
  await sleep(2500);                                      // Apps Script 왕복 여유
  let rows = await getSheet();
  const r1 = rows.find(r => r.filename === NAMES[0]);
  const r2 = rows.find(r => r.filename === NAMES[1]);
  ok(r1 && r1.groom === 5, `시트에 ${NAMES[0]} groom=5 기록(브라우저 POST 성공)`);
  ok(r2 && r2.groom === 4, `시트에 ${NAMES[1]} groom=4 기록`);

  /* 3) 시트에 신부 점수 주입 → 앱 GET(실 CORS)으로 합계 반영 */
  console.log('\n[3] 시트→앱 GET → 합계 반영');
  await page.click('.view-btn[data-view="grid"]');       // 그리드 뷰로 전환(뱃지 확인용)
  await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ role: 'bride', items: NAMES.map(n => ({ filename: n, score: 3 })) }) });
  await sleep(1500);
  await page.click('#syncBtn');                           // 브라우저 GET으로 신부 점수 읽기
  await page.waitForFunction(
    (nm) => { const c = document.querySelector(`.grid .cell[data-name="${nm}"] .b-tot`); return c && c.textContent.trim() === '합 8'; },
    NAMES[0], { timeout: 8000 }
  ).then(() => ok(true, `앱이 신부 점수 GET → ${NAMES[0]} 합계 8 표시(브라우저 GET 성공)`))
   .catch(() => ok(false, `합계 8 미반영(GET/CORS 실패 가능)`));

  /* 4) CORS/네트워크 경고 없음 */
  console.log('\n[4] CORS/네트워크 경고');
  const bad = warns.filter(w => /CORS|실패|Failed|blocked/i.test(w));
  ok(bad.length === 0, `동기화 관련 오류 경고 없음${bad.length ? ' → ' + bad.join(' | ') : ''}`);
} catch (e) {
  fail++; console.log('  ✗ 예외:', e.message);
} finally {
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  console.log(`\n※ 시트 'ratings' 탭에 테스트 행이 남습니다: test_selpic.jpg, ${NAMES.join(', ')} → 실제 사용 전 지우세요.`);
  await browser.close(); srv.close();
  fs.rmSync(imgDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
