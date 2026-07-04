// 진입점: 접속 화면 → 앱 화면 전환, 툴바 배선, 뷰 라우팅.
import { state, subscribe, emit, loadPersisted, counts } from './ratings.js';
import * as fs from './fs.js';
import { startSync, pollNow, flush, setBackend } from './sync.js';
import { createSheetsBackend } from './backends/sheets-backend.js';
import { renderRate } from './ui-rate.js';
import { renderGrid } from './ui-grid.js';
import { renderCompare } from './ui-compare.js';
import { exportSelection } from './export.js';
import { clear } from './ui-common.js';
import { DEFAULT_SHEET_URL } from './config.js';

const $ = (s) => document.querySelector(s);
let selectedRole = null;
let currentView = null;   // { update, dispose }

/* ================= 접속 화면 ================= */
function initConnect() {
  const savedRole = localStorage.getItem('selpic:role');
  const savedUrl  = localStorage.getItem('selpic:url');
  if (savedUrl) $('#urlInput').value = savedUrl;
  if (savedRole) selectRole(savedRole);

  // 기본 URL이 설정돼 있으면 입력칸을 숨기고 자동 사용(역할+폴더만 선택)
  if (DEFAULT_SHEET_URL) {
    if (!$('#urlInput').value) $('#urlInput').value = DEFAULT_SHEET_URL;
    $('#urlField').hidden = true;
  }

  document.querySelectorAll('.role-btn').forEach(b => b.onclick = () => selectRole(b.dataset.role));
  $('#urlInput').oninput = validateConnect;
  $('#pickBtn').onclick = onPick;
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
  $('#modeSel').onchange    = (e) => { state.filter.mode = e.target.value; emit(); rerender(); };
  $('#sortToggle').onchange = (e) => { state.filter.sortByTotal = e.target.checked; emit(); rerender(); };
  $('#exportBtn').onclick   = exportSelection;
  $('#syncBtn').onclick     = async () => { status('동기화 중…'); await flush(); await pollNow(); status('동기화 완료'); };
  $('#addBtn').onclick      = addPhotos;
  $('#addFiles').onchange   = (e) => { if (e.target.files?.length) { fs.addFiles(e.target.files); afterAdd(); } };

  document.addEventListener('selpic:open', (e) => { state.current = e.detail.name; switchView('rate'); });
  document.addEventListener('selpic:view', (e) => switchView(e.detail.view));

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
function onStore() { updateTopbar(); currentView?.update?.(); }
function updateTopbar() {
  const c = counts();
  $('#progress').textContent = `${c.rated} / ${c.total} 매김`;
  $('#cmpCount').textContent = state.compare.size ? ` (${state.compare.size})` : '';
}

let statusT = null;
export function status(t) {
  $('#statusMsg').textContent = t;
  clearTimeout(statusT);
  statusT = setTimeout(() => { if ($('#statusMsg').textContent === t) $('#statusMsg').textContent = ''; }, 3000);
}

initConnect();
