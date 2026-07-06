// 진입점: 접속 화면 → 앱 화면 전환, 툴바 배선, 뷰 라우팅.
import { state, subscribe, emit, loadPersisted, counts, canon } from './ratings.js';
import * as fs from './fs.js';
import { startSync, pollNow, flush, setBackend, pushChunked } from './sync.js';
import { createSheetsBackend } from './backends/sheets-backend.js';
import { renderRate } from './ui-rate.js';
import { renderGrid } from './ui-grid.js';
import { renderCompare } from './ui-compare.js';
import { exportSelection } from './export.js';
import { renderStats } from './ui-stats.js';
import { el, clear } from './ui-common.js';
import { DEFAULT_SHEET_URL } from './config.js';

const $ = (s) => document.querySelector(s);
let selectedRole = null;
let currentView = null;   // { update, dispose }
let statsView = null;     // 별점 통계 패널(항상 표시, 뷰 전환과 무관)

/* ================= 접속 화면 ================= */
function initConnect() {
  const savedRole = localStorage.getItem('selpic:role');
  const savedUrl  = localStorage.getItem('selpic:url');

  // DEFAULT_SHEET_URL이 설정돼 있으면 항상 그것을 우선 사용(입력란 숨김).
  // config.js를 바꾸면 구 localStorage URL이 자동으로 교체된다.
  if (DEFAULT_SHEET_URL) {
    $('#urlInput').value = DEFAULT_SHEET_URL;
    $('#urlField').hidden = true;
  } else if (savedUrl) {
    $('#urlInput').value = savedUrl;
  }
  if (savedRole) selectRole(savedRole);

  document.querySelectorAll('.role-btn').forEach(b => b.onclick = () => selectRole(b.dataset.role));
  $('#urlInput').oninput = validateConnect;
  $('#pickBtn').onclick = onPick;
  $('#recoverBtn').onclick = onRecover;
  const onFiles = (e) => { if (e.target.files?.length) start(() => fs.useFileList(e.target.files)); };
  $('#folderFallback').onchange = onFiles;
  $('#filesFallback').onchange = onFiles;
  $('#resumeBtn').onclick = () => start(() => fs.resumeFolder());

  // 아이폰 등 폴더 선택 미지원 환경: 다중 파일 선택 안내
  if (!window.showDirectoryPicker && isIOS()) {
    $('#pickBtn').textContent = '🖼 사진 여러 장 선택 & 시작';
    const h = $('#pickHint'); h.hidden = false;
    h.textContent = '아이폰은 폴더 선택이 안 돼요. 파일 앱에서 웨딩 사진(jpg)을 전체 선택하세요. (매번 다시 선택해야 함)';
  }

  fs.hasSavedFolder().then(has => { if (has && savedRole && savedUrl) $('#resumeRow').hidden = false; });
  validateConnect();
}
function selectRole(r) {
  selectedRole = r;
  document.querySelectorAll('.role-btn').forEach(b => b.classList.toggle('sel', b.dataset.role === r));
  validateConnect();
  updateRecover(r);
}

// 이 브라우저에 저장된 '내 점수'(selpic:mine:role)는 지워지지 않으므로, 폴더를 안 열어도 개수를 알 수 있다.
// 시트가 유실됐을 때 이 원본을 다시 올려 복구하는 진입점.
function savedMine(role) {
  try { return JSON.parse(localStorage.getItem(`selpic:mine:${role}`) || '{}'); }
  catch { return {}; }
}
function updateRecover(r) {
  const n = Object.values(savedMine(r)).filter(s => Number(s) > 0).length;   // 실제 매긴 점수만
  $('#recoverCount').textContent = n;
  $('#recoverMsg').textContent = '';
  $('#recoverBtn').disabled = false;
  $('#recoverRow').hidden = n === 0;
}
async function onRecover() {
  const role = selectedRole;
  if (!role) return;
  const url = $('#urlInput').value.trim() || DEFAULT_SHEET_URL;
  if (!url) { $('#recoverMsg').textContent = '시트 URL이 없어요.'; return; }
  const items = Object.entries(savedMine(role))
    .map(([filename, score]) => ({ filename: canon(filename), score: Number(score) || 0 }))   // 예전 데이터도 정규화 키로
    .filter(it => it.score > 0);                       // 0(미평가)까지 올려 시트를 어지럽히지 않게
  if (!items.length) { $('#recoverMsg').textContent = '올릴 점수가 없어요.'; return; }
  const btn = $('#recoverBtn'), msg = $('#recoverMsg');
  btn.disabled = true;
  try {
    const backend = createSheetsBackend({ url });
    await pushChunked(backend, role, items, (done, total) => {
      msg.textContent = `올리는 중… ${done} / ${total}장 (창을 닫지 마세요)`;
    });
    msg.textContent = `✅ 완료! ${items.length}장을 시트에 다시 올렸어요. 잠시 후 반영됩니다.`;
  } catch (e) {
    msg.textContent = `⚠️ 중간에 실패했어요. 인터넷 확인 후 버튼을 다시 눌러 주세요. (${e.message || e})`;
    btn.disabled = false;
  }
}
function validateConnect() {
  $('#pickBtn').disabled = !(selectedRole && $('#urlInput').value.trim());
}
function isIOS() {
  return /iP(hone|od|ad)/.test(navigator.userAgent) ||
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS 13+
}
function onPick() {
  if (window.showDirectoryPicker) { start(() => fs.pickFolder()); return; }     // 데스크톱 크롬/엣지
  if (isIOS()) { $('#filesFallback').click(); return; }                         // 아이폰: 다중 파일 선택
  $('#folderFallback').click();                                                 // 데스크톱 파폭/사파리: 폴더 선택
}
function msg(t) { $('#connectMsg').textContent = t; }

async function start(loader) {
  try {
    state.role = selectedRole;
    state.webAppUrl = $('#urlInput').value.trim();
    localStorage.setItem('selpic:role', state.role);
    localStorage.setItem('selpic:url', state.webAppUrl);
    loadPersisted();
    msg('폴더 여는 중…');
    await loader();
    if (!state.files.length) { msg('jpg 파일을 찾지 못했어요. 다른 폴더를 선택해 주세요.'); return; }
    enterApp();
  } catch (e) {
    if (e?.name === 'AbortError') { msg(''); return; }   // 사용자가 취소
    console.error(e);
    msg('열기 실패: ' + (e.message || e));
  }
}

/* ================= 앱 화면 ================= */
function enterApp() {
  $('#connect').hidden = true;
  $('#app').hidden = false;
  $('#roleBadge').textContent = state.role === 'groom' ? '🤵 신랑' : '👰 신부';

  document.querySelectorAll('.view-btn').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('#minTotal').onchange   = (e) => { state.filter.minTotal = +e.target.value; emit(); rerender(); };
  $('#mineSel').onchange     = (e) => { state.filter.mine = e.target.value; emit(); rerender(); };
  $('#otherSel').onchange    = (e) => { state.filter.other = e.target.value; emit(); rerender(); };
  $('#sortToggle').onchange = (e) => { state.filter.sortByTotal = e.target.checked; emit(); rerender(); };
  $('#otherLabel').textContent = state.role === 'groom' ? '신부' : '신랑';   // 상대 역할 라벨
  $('#exportBtn').onclick   = exportSelection;
  $('#syncBtn').onclick     = async () => { status('동기화 중…'); await flush(); await pollNow(); status('동기화 완료'); };
  $('#addBtn').onclick      = addPhotos;                    // 상단바(모든 화면에서 보임)
  $('#addFiles').onchange   = (e) => { if (e.target.files?.length) { fs.addFiles(e.target.files); afterAdd(); } };

  document.addEventListener('selpic:open', (e) => { state.current = e.detail.name; switchView('rate'); });
  document.addEventListener('selpic:view', (e) => switchView(e.detail.view));

  // 별점 통계 패널(항상 표시, 📊로 토글)
  const statsPanel = el('aside', { id: 'statsPanel' });
  $('#app').append(statsPanel);
  statsView = renderStats(statsPanel);
  const positionStats = () => { statsPanel.style.top = (($('.topbar')?.offsetHeight || 48) + 6) + 'px'; };
  positionStats();
  window.addEventListener('resize', positionStats);
  // 모바일은 패널이 사진 위에 떠서 가리므로 기본 숨김(📊로 켜기), 데스크톱은 기본 표시
  const savedStats = localStorage.getItem('selpic:stats');
  const showStats = savedStats != null ? savedStats !== '0' : !matchMedia('(max-width: 640px)').matches;
  statsPanel.hidden = !showStats;
  $('#statsBtn').classList.toggle('active', showStats);
  const setStats = (on) => {
    statsPanel.hidden = !on;
    $('#statsBtn').classList.toggle('active', on);
    localStorage.setItem('selpic:stats', on ? '1' : '0');
  };
  $('#statsBtn').onclick = () => setStats(statsPanel.hidden);
  statsPanel.onclick = () => setStats(false);               // 사진을 가리면 패널을 탭해 바로 닫기
  statsPanel.title = '탭하면 닫혀요';

  subscribe(onStore);
  // 백엔드 교체 지점: 지금은 구글 시트. 배포 버전에선 createSupabaseBackend 등으로 교체.
  setBackend(createSheetsBackend({ url: state.webAppUrl }));
  startSync();
  switchView('rate');
}

async function addPhotos() {
  try {
    if (window.showDirectoryPicker) { await fs.addFolder(); afterAdd(); }  // 데스크톱: 폴더로 추가
    else { $('#addFiles').click(); }                                       // 아이폰/폴백: 다중 파일(onchange에서 처리)
  } catch (e) { if (e?.name !== 'AbortError') console.warn(e); }
}
function afterAdd() { emit(); rerender(); status(`사진 ${state.files.length}장`); }

function switchView(v) {
  state.view = v;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  rerender();
}
function rerender() {
  currentView?.dispose?.();
  const main = $('#main');
  clear(main);
  if (state.view === 'rate')        currentView = renderRate(main);
  else if (state.view === 'grid')   currentView = renderGrid(main);
  else                              currentView = renderCompare(main);
  updateTopbar();
}
function onStore() { updateTopbar(); currentView?.update?.(); statsView?.update?.(); }
function updateTopbar() {
  const c = counts();
  $('#progress').textContent = `${c.rated} / ${c.total} 매김`;
  $('#cmpCount').textContent = state.compare.size ? ` (${state.compare.size})` : '';
  // 저장 상태 표시: 시트로 못 보낸 점수가 있으면 경고색으로 개수를 보여준다(유실 사고 후 가시화)
  const p = state.pending.size;
  const ps = $('#pendState');
  ps.textContent = p ? `⏳ 저장 대기 ${p}` : (c.rated ? '✓ 저장됨' : '');
  ps.classList.toggle('warn', p > 0);
}

let statusT = null;
export function status(t) {
  $('#statusMsg').textContent = t;
  clearTimeout(statusT);
  statusT = setTimeout(() => { if ($('#statusMsg').textContent === t) $('#statusMsg').textContent = ''; }, 3000);
}

// 모바일에서 페이지 전체가 핀치로 확대되는 것 방지(사진만 앱 내부에서 확대)
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());

initConnect();
