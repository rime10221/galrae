// 외울 것에 넣는 사진: 압축해서 IndexedDB에 저장, 메모에는 ![](img:ID) 로 참조.
// 메타데이터(data.images)는 동기화되고, 원본은 Drive Galrae/images/ 에 올라간다.
import * as S from './store.js';
import { uid, openDialog, toast } from './util.js';

const DB = 'galrae-img', STORE = 'blobs';
const MAX = 1600, QUALITY = 0.82;
let dbp = null;
let fetcher = null; // 동기화 모듈이 등록: (fileId) => Promise<Blob>
const urls = new Map();

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export const getBlob = (id) => tx('readonly', (s) => s.get(id)).catch(() => null);
export const putBlob = (id, blob) => tx('readwrite', (s) => s.put(blob, id));

export const setFetcher = (fn) => { fetcher = fn; };

// 파일 → 압축 JPEG → 저장. 새 이미지 id 반환
export async function addImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('이미지 파일이 아니에요');
  let blob = file, w = 0, h = 0;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    w = Math.round(bmp.width * k); h = Math.round(bmp.height * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', QUALITY));
    if (out && (out.size < file.size || file.type !== 'image/jpeg')) blob = out;
  } catch { /* 디코딩 실패 시 원본 그대로 */ }
  const id = 'i' + uid();
  await putBlob(id, blob);
  S.as('image', () => S.addImageMeta(id, { w, h, size: blob.size, type: blob.type || 'image/jpeg' }));
  return id;
}

export async function urlFor(id) {
  if (urls.has(id)) return urls.get(id);
  let blob = await getBlob(id);
  const meta = S.imageMeta(id);
  if (!blob && meta?.fileId && fetcher) {
    try { blob = await fetcher(meta.fileId); if (blob) await putBlob(id, blob); } catch (e) { console.warn('사진 받기 실패', id, e); blob = null; }
  }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

// 화면에 새로 그려진 <img data-img> 에 실제 주소를 채운다
async function hydrate(img) {
  if (img.dataset.state) return;
  img.dataset.state = 'loading';
  const u = await urlFor(img.dataset.img);
  if (u) { img.src = u; img.dataset.state = 'ok'; }
  else { img.dataset.state = 'missing'; img.alt = '사진을 불러오지 못했어요 (동기화 후 다시 시도)'; }
}
// 못 불러온 사진을 다시 시도 (동기화가 끝난 뒤)
export function retryMissing() {
  document.querySelectorAll('img[data-img][data-state="missing"]').forEach((img) => { delete img.dataset.state; img.alt = ''; hydrate(img); });
}
function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.('img[data-img]')) hydrate(root);
  root.querySelectorAll?.('img[data-img]').forEach(hydrate);
}

export function init() {
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(scan); }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
  // 사진 누르면 크게 보기
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.md-img');
    if (!img || !img.src || e.target.closest('.flip:not(.flipped)') || e.target.closest('[contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    openDialog(`<div class="lightbox" data-close=""><img src="${img.src}" alt=""></div>`, { cls: 'lb' });
  }, true);
}

// 업로드가 필요한 이미지 (동기화용)
export async function pending() {
  const out = [];
  for (const m of S.imageList()) {
    if (m.fileId || m.deleted) continue;
    const blob = await getBlob(m.id);
    if (blob) out.push({ meta: m, blob });
  }
  return out;
}

// 텍스트 영역에 사진 삽입 (붙여넣기·끌어놓기·파일 선택 공용)
export async function insertInto(ta, files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return false;
  for (const f of list) {
    try {
      const id = await addImage(f);
      const s = ta.selectionStart, v = ta.value;
      const before = s && v[s - 1] !== '\n' ? '\n' : '';
      ta.setRangeText(`${before}![](img:${id})\n`, s, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { toast(e.message); }
  }
  return true;
}
