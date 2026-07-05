// 실제 크롬(Chromium)으로 UI를 구동하는 end-to-end 검증.
//  - 앱을 정적 서버로 띄우고, Apps Script(Code.gs)를 흉내낸 mock 시트 백엔드 연결
//  - 폴더 선택은 자동화가 어려우니 폴백 <input webkitdirectory>에 파일을 주입
//  - 역할 선택 → 평점(키보드/별) → 그리드 → 내보내기 → 신랑↔신부 동기화까지 확인
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 테스트용 실제 jpg 4장 생성 ---------- */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AV//Z', 'base64');
const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selpic-imgs-'));
const NAMES = ['photo_1.jpg', 'photo_2.jpg', 'photo_3.jpg', 'photo_10.jpg'];
// 세로로 긴 실제 사진(3000x4500 유사)을 재현: sips로 1200x1800 리사이즈.
let bigPortrait = false;
NAMES.forEach(n => {
  const p = path.join(imgDir, n);
  fs.writeFileSync(p, TINY_JPEG);
  try { execFileSync('sips', ['-z', '1800', '1200', p, '--out', p], { stdio: 'ignore' }); bigPortrait = true; }
  catch { /* sips 없으면 tiny 유지 */ }
});

/* ---------- mock 시트 백엔드 (Code.gs 의미 재현) ---------- */
const sheet = new Map();
const mock = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') {
    res.end(JSON.stringify([...sheet].map(([filename, v]) => ({ filename, groom: v.groom || 0, bride: v.bride || 0 }))));
    return;
  }
  let body = ''; req.on('data', c => body += c);
  req.on('end', () => {
    const { role, items } = JSON.parse(body);
    for (const it of items) { const c = sheet.get(it.filename) || { groom: 0, bride: 0 }; c[role] = Number(it.score) || 0; sheet.set(it.filename, c); }
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise(r => mock.listen(0, r));
const MOCK_URL = `http://localhost:${mock.address().port}/exec`;

/* ---------- 정적 파일 서버 (모듈 MIME 설정) ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const staticSrv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.statusCode = 404; res.end('nf'); return; }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => staticSrv.listen(0, r));
const APP_URL = `http://localhost:${staticSrv.address().port}/`;

/* ---------- assert ---------- */
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };
const eq = (g, w, msg) => ok(JSON.stringify(g) === JSON.stringify(w), `${msg} (got ${JSON.stringify(g)})`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 760 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(APP_URL);
  ok(!(await page.locator('#app').isVisible()), '초기엔 앱 화면 숨김');

  /* 1) 접속 */
  console.log('\n[1] 접속 & 폴더 로드');
  await page.click('.role-btn[data-role="groom"]');
  await page.$eval('#urlInput', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, MOCK_URL);
  await page.setInputFiles('#folderFallback', imgDir);     // 폴백 경로로 폴더 주입(디렉터리)
  await page.waitForSelector('#app:not([hidden])', { timeout: 5000 });
  ok(!(await page.locator('#connect').isVisible()), '접속 화면 숨김(앱만 표시)');
  ok((await page.textContent('#roleBadge')).includes('신랑'), '역할 배지 = 신랑');
  eq(await page.textContent('#progress'), '0 / 4 매김', '진행률 0/4');
  ok(await page.getAttribute('.photo', 'src'), '사진 blob 로드됨');

  // 세로로 긴 사진이 화면 안에 '한눈에' 들어오는지 (윗부분만 보이는 버그 방지)
  if (bigPortrait) {
    await page.waitForFunction(() => { const i = document.querySelector('.photo'); return i && i.complete && i.naturalHeight > 0; });
    const stageBox = await page.locator('.stage').boundingBox();
    const photoBox = await page.locator('.photo').boundingBox();
    const vh = page.viewportSize().height;
    ok(photoBox.height <= stageBox.height + 1, `세로 사진 높이가 스테이지 안에 맞음(잘림 없음) [${Math.round(photoBox.height)}≤${Math.round(stageBox.height)}]`);
    ok(photoBox.width <= stageBox.width + 1, '사진 너비가 스테이지 안에 맞음');
    ok(photoBox.y + photoBox.height <= vh + 1, '사진 전체가 뷰포트 안에 보임');
    await page.screenshot({ path: path.join(ROOT, 'test', 'screenshot-rate.png') });

    // 확대(줌) 기능
    const scaleOf = () => page.evaluate(() => {
      const t = getComputedStyle(document.querySelector('.photo')).transform;
      if (t === 'none') return 1;
      const m = t.match(/matrix\(([^)]+)\)/);
      return m ? parseFloat(m[1].split(',')[0]) : 1;
    });
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -500); await sleep(30); }  // 휠 위로 = 확대
    await sleep(120);
    const zoomed = await scaleOf();
    ok(zoomed > 1.1, `휠로 확대됨 (scale=${zoomed.toFixed(2)})`);
    ok(await page.locator('.stage.zoomed').count() === 1, '확대 상태 클래스 적용');
    await page.click('.zoom-bar .zlabel');              // %(숫자) 클릭 = 화면맞춤
    await sleep(120);
    const back = await scaleOf();
    ok(Math.abs(back - 1) < 0.01, `퍼센트 클릭으로 화면맞춤(100%) [got ${back}]`);

    // 전체화면 버튼(⤢): 폴백(pseudo) 경로 강제해 토글 검증
    await page.evaluate(() => { document.querySelector('.stage').requestFullscreen = undefined; });
    await page.click('.zoom-bar button:last-child');    // ⤢ 전체화면
    await sleep(80);
    ok(await page.locator('.stage.is-fs').count() === 1, '전체화면 진입(스테이지 확장)');
    await page.click('.zoom-bar button:last-child');    // 다시 눌러 종료
    await sleep(80);
    ok(await page.locator('.stage.is-fs').count() === 0, '전체화면 종료');
  }

  /* 2) 키보드 평점 */
  console.log('\n[2] 1장 모드 평점(키보드)');
  const firstName = await page.textContent('.fname');
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); // 파일 input 포커스 해제
  await page.keyboard.press('5');
  await page.waitForFunction(() => document.querySelectorAll('.stars .star.on').length === 5);
  ok(true, '숫자키 5 → 별 5개');
  eq(await page.textContent('#progress'), '1 / 4 매김', '진행률 1/4');
  await page.keyboard.press('ArrowRight');
  ok((await page.textContent('.fname')) !== firstName, '→ 키로 다음 사진 이동');
  await page.keyboard.press('4');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('3');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('5');
  eq(await page.textContent('#progress'), '4 / 4 매김', '4장 모두 평점');

  /* 3) 그리드 */
  console.log('\n[3] 그리드');
  await page.click('.view-btn[data-view="grid"]');
  await page.waitForSelector('.grid .cell');
  eq(await page.locator('.grid .cell[data-name]').count(), 4, '셀 4개');

  /* 4) 신랑 점수 시트로 전송 */
  console.log('\n[4] 동기화(push)');
  await page.click('#syncBtn');                            // flush + pollNow 즉시 실행
  await sleep(600);
  eq(sheet.get(firstName), { groom: 5, bride: 0 }, 'mock 시트에 신랑 점수 저장');

  /* 5) 신부(다른 기기)가 점수 추가 → 신랑 화면에 합계 반영 */
  console.log('\n[5] 신부 점수 → 합계 결합');
  await fetch(MOCK_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ role: 'bride', items: NAMES.map(n => ({ filename: n, score: 4 })) }) });
  await page.click('#syncBtn');                            // pollNow → applyRemote
  await sleep(600);
  const tot = await page.locator(`.grid .cell[data-name="${firstName}"] .b-tot`).textContent();
  eq(tot, '합 9', `${firstName} 합계 9 (신랑5+신부4) UI 반영`);

  /* 6) 최종 내보내기 */
  console.log('\n[6] 최종 내보내기');
  await page.selectOption('#minTotal', '9');               // 합계≥9 필터
  const dls = [];
  page.on('download', d => dls.push(d));
  await page.click('#exportBtn');
  await sleep(800);
  eq(dls.length, 2, 'txt + csv 2개 다운로드');
  const txt = fs.readFileSync(await dls[0].path(), 'utf8');
  const csv = fs.readFileSync(await dls[1].path(), 'utf8').replace(/^﻿/, '');
  // 신랑 5/4/3/5 + 신부 4/4/4/4 → 합계 9/8/7/9 → ≥9는 photo_1, photo_10 두 장
  eq(txt.split('\n').sort(), ['photo_1.jpg', 'photo_10.jpg'], 'txt = 합계≥9 파일명(2장)');
  ok(csv.startsWith('filename,groom,bride,total'), 'csv 헤더');
  ok(/,5,4,9/.test(csv), 'csv에 5,4,9 행 존재');

  /* 통계 패널 */
  console.log('\n[통계] 별점 분포 패널');
  ok(await page.locator('#statsPanel').isVisible(), '통계 패널 표시');
  const st = await page.textContent('#statsPanel');
  ok(st.includes('신랑') && st.includes('신부') && st.includes('평균'), '신랑·신부 분포·평균 표시');
  await page.click('#statsBtn');
  ok(!(await page.locator('#statsPanel').isVisible()), '📊 토글로 숨김');
  await page.click('#statsBtn');
  ok(await page.locator('#statsPanel').isVisible(), '📊 토글로 다시 표시');

  /* 6b) 복구: 접속 화면에서 로컬 저장 점수 재업로드 */
  console.log('\n[복구] 접속화면에서 저장된 점수 재업로드');
  const rp = await ctx.newPage();
  rp.on('pageerror', e => errors.push(String(e)));
  rp.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const RECOVER = { 'rec_1.jpg': 3, 'rec_2.jpg': 5, 'rec_3.jpg': 2 };   // 시트엔 없고 로컬에만 남은 신부 점수
  await rp.addInitScript(s => localStorage.setItem('selpic:mine:bride', s), JSON.stringify(RECOVER));
  await rp.goto(APP_URL);
  await rp.click('.role-btn[data-role="bride"]');
  ok(await rp.locator('#recoverRow').isVisible(), '역할 선택 시 복구 행 표시');
  eq(await rp.textContent('#recoverCount'), '3', '저장된 내 점수 개수 표시(3)');
  await rp.$eval('#urlInput', (el, v) => { el.value = v; }, MOCK_URL);   // 실 URL 대신 mock으로
  await rp.click('#recoverBtn');
  await rp.waitForFunction(() => /완료/.test(document.querySelector('#recoverMsg').textContent), { timeout: 5000 });
  eq(sheet.get('rec_2.jpg'), { groom: 0, bride: 5 }, '복구 재업로드 → mock 시트에 신부 점수 반영');
  eq(sheet.get('rec_1.jpg')?.bride, 3, '복구: 다른 항목도 반영(rec_1=3)');
  await rp.close();

  /* 7) 콘솔 에러 없음 */
  console.log('\n[7] 콘솔 에러');
  eq(errors, [], '페이지 런타임 에러 없음');

  await page.screenshot({ path: path.join(ROOT, 'test', 'screenshot.png'), fullPage: true });
  console.log('  · 스크린샷: test/screenshot.png');
} catch (e) {
  fail++; console.log('  ✗ 예외:', e.message);
} finally {
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  if (errors.length) console.log('errors:', errors);
  await browser.close(); mock.close(); staticSrv.close();
  fs.rmSync(imgDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
