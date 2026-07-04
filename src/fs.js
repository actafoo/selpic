// 로컬 사진 폴더 접근. 사진은 여기서만 다루며 절대 네트워크로 나가지 않는다.
// - File System Access API(크롬/엣지): 폴더 핸들을 IndexedDB에 저장해 재접속 시 재사용
// - 미지원 브라우저: <input webkitdirectory> FileList 폴백
import { state } from './ratings.js';

const IMG_RE = /\.jpe?g$/i;
const MAX_URLS = 150;              // 오브젝트 URL 캐시 상한(메모리 보호)

let fileMap = new Map();           // name -> FileSystemFileHandle | File
let dirHandle = null;
const urlCache = new Map();        // name -> objectURL (삽입순 = LRU)

function naturalSort(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

function finalize() {
  const names = [...fileMap.keys()].sort(naturalSort);
  state.files = names.map(name => ({ name }));
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
// 파일명을 NFC로 정규화 → 맥(NFD)·윈도우/아이폰(NFC) 간 같은 한글 파일명이 일치하게 함
const norm = (s) => s.normalize('NFC');

async function indexDir() {
  fileMap = new Map();
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && IMG_RE.test(entry.name)) fileMap.set(norm(entry.name), entry);
  }
  finalize();
}
// 폴백: <input webkitdirectory>의 FileList
export function useFileList(files) {
  dirHandle = null;
  fileMap = new Map();
  for (const f of files) if (IMG_RE.test(f.name)) fileMap.set(norm(f.name), f);
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
