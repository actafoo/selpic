// 아이폰 환경 시뮬레이션: showDirectoryPicker 제거 + iOS UA.
// 폴더 선택이 안 되는 대신 다중 파일 선택(#filesFallback)으로 앱이 뜨는지 검증.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8AV//Z', 'base64');
const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selpic-ios-'));
const NAMES = ['IMG_001.jpg', 'IMG_002.jpg', 'IMG_003.jpg'];
const paths = NAMES.map(n => { const p = path.join(imgDir, n); fs.writeFileSync(p, TINY_JPEG); return p; });
const EXTRA = ['IMG_004.jpg', 'IMG_005.jpg'].map(n => { const p = path.join(imgDir, n); fs.writeFileSync(p, TINY_JPEG); return p; });

const sheet = new Map();
const mock = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') { res.end(JSON.stringify([...sheet].map(([filename, v]) => ({ filename, ...v })))); return; }
  let b = ''; req.on('data', c => b += c); req.on('end', () => { const { role, items } = JSON.parse(b); for (const it of items) { const c = sheet.get(it.filename) || { groom: 0, bride: 0 }; c[role] = it.score; sheet.set(it.filename, c); } res.end('{}'); });
});
await new Promise(r => mock.listen(0, r));
const MOCK_URL = `http://localhost:${mock.address().port}/exec`;

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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  viewport: { width: 390, height: 844 },
});
const page = await ctx.newPage();
await page.addInitScript(() => { try { delete window.showDirectoryPicker; } catch { window.showDirectoryPicker = undefined; } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

try {
  console.log('\n[아이폰 시뮬레이션]');
  await page.goto(APP_URL);
  ok(await page.evaluate(() => window.showDirectoryPicker === undefined), 'showDirectoryPicker 없음(iOS 재현)');
  ok((await page.textContent('#pickBtn')).includes('사진 여러 장'), '버튼이 다중 선택 문구로 전환');
  ok(await page.locator('#pickHint').isVisible(), 'iOS 안내 문구 노출');

  await page.click('.role-btn[data-role="bride"]');
  await page.$eval('#urlInput', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, MOCK_URL);
  await page.setInputFiles('#filesFallback', paths);     // 아이폰: 사진 여러 장 선택
  await page.waitForSelector('#app:not([hidden])', { timeout: 5000 });
  ok(true, '다중 파일 선택으로 앱 진입');
  ok((await page.textContent('#progress')).includes('/ 3'), '사진 3장 로드');
  ok(await page.getAttribute('.photo', 'src'), '사진 표시됨');

  // 모바일 레이아웃(390px): 오버플로 없음 + 주요 버튼 보임
  ok(await page.locator('.view-btn').first().isVisible(), '뷰 버튼 보임');
  ok(await page.locator('#exportBtn').isVisible(), '내보내기 버튼 보임');
  ok(await page.locator('#addBtn').isVisible(), '1장 화면에서도 ＋사진 추가 버튼 보임');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), '가로 오버플로 없음');
  await page.screenshot({ path: path.join(ROOT, 'test', 'screenshot-mobile-rate.png') });

  // 이전/다음 버튼이 양쪽 끝(엄지 코너)에 있는지
  const vw = page.viewportSize().width;
  const prevBox = await page.locator('.rate-bar .navbtn').first().boundingBox();
  const nextBox = await page.locator('.rate-bar .navbtn').last().boundingBox();
  ok(prevBox.x < vw * 0.22, '이전 버튼이 왼쪽 끝');
  ok(nextBox.x + nextBox.width > vw * 0.78, '다음 버튼이 오른쪽 끝');

  // 스와이프로 넘기기(터치): 왼쪽으로 밀면 다음, 오른쪽으로 밀면 이전
  const swipe = (fromFrac, toFrac) => page.evaluate(([f, t]) => {
    const st = document.querySelector('.stage'); const r = st.getBoundingClientRect();
    const y = r.top + r.height / 2, sx = r.left + r.width * f, ex = r.left + r.width * t;
    const ev = (type, x) => st.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, button: 0, bubbles: true }));
    ev('pointerdown', sx); ev('pointermove', (sx + ex) / 2); ev('pointerup', ex);
  }, [fromFrac, toFrac]);
  const counter = () => page.locator('.rate-bar .rate-center').textContent();
  const c0 = await counter();
  await swipe(0.75, 0.25); await sleep(120);           // 왼쪽으로 스와이프 = 다음
  const c1 = await counter();
  ok(c0.startsWith('1') && c1.startsWith('2'), `스와이프로 다음 (${c0} → ${c1})`);
  await swipe(0.25, 0.75); await sleep(120);           // 오른쪽으로 스와이프 = 이전
  ok((await counter()).startsWith('1'), '스와이프로 이전 복귀');

  // 핀치로 '사진만' 확대 (두 손가락 포인터)
  const scaleOf = () => page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('.photo')).transform;
    const m = t && t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : 1;
  });
  await page.evaluate(() => {
    const st = document.querySelector('.stage'); const r = st.getBoundingClientRect();
    const y = r.top + r.height / 2, cxx = r.left + r.width / 2;
    const ev = (t, id, x) => st.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, bubbles: true }));
    ev('pointerdown', 1, cxx - 30); ev('pointerdown', 2, cxx + 30);
    ev('pointermove', 1, cxx - 120); ev('pointermove', 2, cxx + 120);
    ev('pointerup', 1, cxx - 120); ev('pointerup', 2, cxx + 120);
  });
  await sleep(100);
  ok((await scaleOf()) > 1.1, '핀치로 사진 확대(scale>1)');
  await page.click('.zoom-bar .zlabel'); await sleep(80);   // 원상복구

  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('4');
  await page.click('#syncBtn');
  await page.waitForTimeout(500);
  ok(sheet.get('img_001.jpg')?.bride === 4, '아이폰에서 평점 → 시트 반영(정규화 키)');

  // 사진 추가(덧붙이기): 2장 더 → 총 5장, 기존 평점 유지
  await page.setInputFiles('#addFiles', EXTRA);
  await sleep(250);
  ok((await page.textContent('#progress')).includes('/ 5'), '사진 추가 → 총 5장');

  await page.click('.view-btn[data-view="grid"]');
  await page.waitForSelector('.grid .cell');
  ok(await page.locator('.grid .cell[data-name]').count() === 5, '그리드 5장(추가 반영)');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), '그리드도 가로 오버플로 없음');
  await page.screenshot({ path: path.join(ROOT, 'test', 'screenshot-mobile-grid.png') });

  ok(errs.length === 0, `런타임 에러 없음${errs.length ? ' → ' + errs.join(' | ') : ''}`);
} catch (e) {
  fail++; console.log('  ✗ 예외:', e.message);
} finally {
  console.log(`\n결과: ${pass} passed, ${fail} failed`);
  await browser.close(); mock.close(); srv.close();
  fs.rmSync(imgDir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
