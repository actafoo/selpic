// 로컬 사진 폴더 접근. 사진은 여기서만 다루며 절대 네트워크로 나가지 않는다.
// - File System Access API(크롬/엣지): 폴더 핸들을 IndexedDB에 저장해 재접속 시 재사용
// - 미지원 브라우저: <input webkitdirectory> FileList 폴백
import { state, canon } from './ratings.js';

const IMG_RE = /\.jpe?g$/i;
const MAX_URLS = 150;              // 오브젝트 URL 캐시 상한(메모리 보호)

let fileMap = new Map();           // key(정규화) -> FileSystemFileHandle | File
let nameMap = new Map();           // key(정규화) -> 원래 파일명
let dirHandle = null;
const urlCache = new Map();        // key -> objectURL (삽입순 = LRU)

function naturalSort(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }
function put(name, ent) { const k = canon(name); fileMap.set(k, ent); nameMap.set(k, name); }  // 키로 저장 + 원래 이름 기록

function finalize() {
  const keys = [...fileMap.keys()].sort((a, b) => naturalSort(nameMap.get(a) || a, nameMap.get(b) || b));
  state.files = keys;              // 정규화 키 목록(표시명 기준 정렬)
  state.names = nameMap;
  state.folderName = dirHandle?.name || 'folder';
}

/* ---------- 폴더 열기 ---------- */
export async function pickFolder() {
  dirHandle = await window.showDirectoryPicker({ id: 'selpic', mode: 'read' });
  await idbSet('dir', dirHandle);
  await indexDir();
}
export async function resumeFolder() {
  dirHandle = await idbGet('dir');
  if (!dirHandle) throw new Error('저장된 폴더가 없어요');
  const opts = { mode: 'read' };
  let perm = await dirHandle.queryPermission(opts);
  if (perm !== 'granted') perm = await dirHandle.requestPermission(opts);
  if (perm !== 'granted') throw new Error('폴더 접근 권한이 필요해요');
  await indexDir();
}
async function indexDir() {
  fileMap = new Map(); nameMap = new Map();
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && IMG_RE.test(entry.name)) put(entry.name, entry);
  }
  finalize();
}
// 폴백: <input webkitdirectory>의 FileList
export function useFileList(files) {
  dirHandle = null;
  fileMap = new Map(); nameMap = new Map();
  for (const f of files) if (IMG_RE.test(f.name)) put(f.name, f);
  finalize();
}

// ----- 사진 추가(기존 선택에 덧붙이기) -----
export function addFiles(files) {                 // 다중 파일 선택으로 추가
  for (const f of files) if (IMG_RE.test(f.name)) put(f.name, f);
  finalize();
}
export async function addFolder() {               // 폴더로 추가(데스크톱)
  const h = await window.showDirectoryPicker({ id: 'selpic-add', mode: 'read' });
  for await (const entry of h.values()) {
    if (entry.kind === 'file' && IMG_RE.test(entry.name)) put(entry.name, entry);
  }
  finalize();
}
export async function hasSavedFolder() {
  if (!window.showDirectoryPicker) return false;
  try { return !!(await idbGet('dir')); } catch { return false; }
}

/* ---------- 이미지 로드 ---------- */
export async function getURL(name) {
  if (urlCache.has(name)) {                 // LRU: 최근 사용으로 이동
    const u = urlCache.get(name);
    urlCache.delete(name); urlCache.set(name, u);
    return u;
  }
  const ent = fileMap.get(name);
  if (!ent) return null;
  const file = ent.getFile ? await ent.getFile() : ent;
  const url = URL.createObjectURL(file);
  urlCache.set(name, url);
  evict();
  return url;
}
function evict() {
  while (urlCache.size > MAX_URLS) {
    const k = urlCache.keys().next().value;
    URL.revokeObjectURL(urlCache.get(k));
    urlCache.delete(k);
  }
}
export async function getFile(name) {
  const ent = fileMap.get(name);
  if (!ent) return null;
  return ent.getFile ? await ent.getFile() : ent;
}

/* ---------- 썸네일 ----------
   그리드가 원본(수천만 화소)을 매 셀마다 디코드하면 1000장+에서 스크롤이 멈춘다.
   → 320px 축소본을 만들어 캐시하고, 동시 생성 수를 제한해 모바일 과부하를 막는다. */
const THUMB = 320;                 // 썸네일 최대 변(px)
const THUMB_CONC = 3;              // 동시 디코드 수(아이폰 메모리·발열 보호)
const thumbCache = new Map();      // key -> objectURL(작은 jpg, ~20KB)
const thumbJobs = new Map();       // key -> 진행 중 Promise
const thumbQueue = [];
let thumbActive = 0;

export function peekThumbURL(name) { return thumbCache.get(name) || null; }   // 이미 만든 것만(동기)
export function getThumbURL(name) {
  if (thumbCache.has(name)) return Promise.resolve(thumbCache.get(name));
  let p = thumbJobs.get(name);
  if (!p) {
    p = new Promise((resolve) => { thumbQueue.push({ name, resolve }); });
    thumbJobs.set(name, p);
    pumpThumbs();
  }
  return p;
}
function pumpThumbs() {
  while (thumbActive < THUMB_CONC && thumbQueue.length) {
    const { name, resolve } = thumbQueue.shift();
    thumbActive++;
    makeThumb(name)
      .then((u) => { if (u) thumbCache.set(name, u); resolve(u); })
      .catch(() => resolve(null))
      .finally(() => { thumbActive--; thumbJobs.delete(name); pumpThumbs(); });
  }
}
async function makeThumb(name) {
  const ent = fileMap.get(name);
  if (!ent) return null;
  const file = ent.getFile ? await ent.getFile() : ent;
  let src = null, w = 0, h = 0, tmpUrl = null;
  try {                            // 지원 브라우저는 디코드 단계에서 곧바로 축소(빠르고 메모리 적음)
    src = await createImageBitmap(file, { resizeWidth: THUMB, resizeQuality: 'low' });
  } catch {
    try { src = await createImageBitmap(file); } catch {}
  }
  if (src) { w = src.width; h = src.height; }
  else {                           // createImageBitmap 미지원(구형 사파리): <img>로 디코드
    tmpUrl = URL.createObjectURL(file);
    src = new Image();
    src.src = tmpUrl;
    try { await src.decode(); } catch { URL.revokeObjectURL(tmpUrl); return null; }
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const k = Math.min(1, THUMB / Math.max(w, h, 1));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  if (src.close) src.close();
  if (tmpUrl) URL.revokeObjectURL(tmpUrl);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.72));
  return blob ? URL.createObjectURL(blob) : null;
}

/* ---------- IndexedDB (폴더 핸들 저장) ---------- */
const DB = 'selpic', STORE = 'handles';
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(k, v) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(v, k);
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
async function idbGet(k) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readonly');
    const rq = t.objectStore(STORE).get(k);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
