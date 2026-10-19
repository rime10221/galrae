// Google Drive 동기화 (drive.file 권한: 이 앱이 만든 파일만 접근)
// 내 드라이브/Galrae/galrae-data.json 하나에 전체 데이터를 저장하고, 항목별 updated 시각으로 병합한다.
import * as S from './store.js';
import * as Images from './images.js';
import { lsGet, lsSet, now } from './util.js';

export const DEFAULT_CLIENT_ID = '83549191023-4v8ggp4pbt9q8oen511nk0cvv2jo9c4a.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const AUTH_EP = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'Galrae';
const FILE = 'galrae-data.json';
const KEY = 'galrae.v1.sync';

const st = {
  enabled: false, auto: true, clientId: '', email: '', token: '', exp: 0,
  folderId: '', fileId: '', imgFolderId: '', lastSync: 0, dirty: false, needLogin: false,
  ...lsGet(KEY, {}),
};
const save = () => lsSet(KEY, st);

let status = st.enabled ? (st.needLogin ? 'login' : 'idle') : 'off';
let error = '';
let running = false, pending = false, timer = 0;
const subs = new Set();

export const info = () => ({ ...st, status, error, running });
export const onStatus = (fn) => { subs.add(fn); return () => subs.delete(fn); };
function setStatus(s, err = '') {
  status = s; error = err;
  for (const fn of subs) fn(info());
}

const clientId = () => st.clientId || DEFAULT_CLIENT_ID;
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

function authUrl(silent) {
  const p = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri(), response_type: 'token',
    scope: SCOPES, include_granted_scopes: 'true', state: silent ? 'silent' : 'interactive',
  });
  if (silent) p.set('prompt', 'none');
  if (st.email) p.set('login_hint', st.email);
  return `${AUTH_EP}?${p}`;
}

function storeToken(p) {
  st.token = p.get('access_token');
  st.exp = now() + Math.max(60, Number(p.get('expires_in') || 3600) - 90) * 1000;
  st.needLogin = false;
  save();
}

// 앱 시작 시 가장 먼저 호출. iframe(무음 갱신) 안이면 true를 돌려주고 앱을 띄우지 않는다.
export function handleAuthReturn() {
  const h = location.hash;
  if (!/access_token=|error=/.test(h)) return false;
  const p = new URLSearchParams(h.slice(1));
  if (window.parent !== window) {
    window.parent.postMessage({ galraeAuth: Object.fromEntries(p) }, location.origin);
    return true;
  }
  if (p.get('access_token')) {
    storeToken(p);
    st.enabled = true;
    save();
    justLoggedIn = true;
  } else {
    setStatus('error', '로그인이 취소되었거나 실패했어요: ' + (p.get('error') || ''));
  }
  history.replaceState(null, '', location.pathname + location.search + (sessionStorage.getItem('galrae.returnHash') || '#home'));
  sessionStorage.removeItem('galrae.returnHash');
  return false;
}
let justLoggedIn = false;

function silentIframe() {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.style.display = 'none';
    f.src = authUrl(true);
    const done = (fn, v) => { clearTimeout(to); window.removeEventListener('message', onMsg); f.remove(); fn(v); };
    const onMsg = (e) => {
      if (e.origin !== location.origin || !e.data?.galraeAuth) return;
      const p = new URLSearchParams(e.data.galraeAuth);
      if (p.get('access_token')) { storeToken(p); done(resolve, st.token); } else done(reject, new Error('login_required'));
    };
    const to = setTimeout(() => done(reject, new Error('login_required')), 8000);
    window.addEventListener('message', onMsg);
    document.body.append(f);
  });
}

export function login() {
  sessionStorage.setItem('galrae.returnHash', location.hash || '#home');
  location.href = authUrl(false);
}

export function logout() {
  if (st.token) fetch(`https://oauth2.googleapis.com/revoke?token=${st.token}`, { method: 'POST' }).catch(() => {});
  Object.assign(st, { enabled: false, token: '', exp: 0, email: '', folderId: '', fileId: '', imgFolderId: '', needLogin: false });
  save();
  setStatus('off');
}

async function getToken() {
  if (st.token && st.exp > now()) return st.token;
  try { return await silentIframe(); } catch {
    st.needLogin = true; save();
    throw new Error('login_required');
  }
}

async function gfetch(url, opt = {}) {
  const token = await getToken();
  const r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401) { st.token = ''; st.exp = 0; save(); }
  return r;
}

async function gjson(url, opt) {
  const r = await gfetch(url, opt);
  if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

async function ensureEmail() {
  if (st.email) return;
  try {
    const u = await gjson('https://www.googleapis.com/oauth2/v3/userinfo');
    st.email = u.email || ''; save();
  } catch {}
}

async function folderId() {
  if (st.folderId) return st.folderId;
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await gjson(`${API}/files?q=${q}&fields=files(id)&spaces=drive`);
  if (r.files?.length) st.folderId = r.files[0].id;
  else {
    const c = await gjson(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    });
    st.folderId = c.id;
  }
  save();
  return st.folderId;
}

async function imgFolderId(fid) {
  if (st.imgFolderId) return st.imgFolderId;
  const q = encodeURIComponent(`name='images' and '${fid}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await gjson(`${API}/files?q=${q}&fields=files(id)&spaces=drive`);
  if (r.files?.length) st.imgFolderId = r.files[0].id;
  else {
    const c = await gjson(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'images', parents: [fid], mimeType: 'application/vnd.google-apps.folder' }),
    });
    st.imgFolderId = c.id;
  }
  save();
  return st.imgFolderId;
}

// 아직 드라이브에 없는 사진 올리기 → 메타데이터에 fileId 기록
async function uploadImages(fid) {
  const list = await Images.pending();
  if (!list.length) return;
  const folder = await imgFolderId(fid);
  for (const { meta, blob } of list) {
    const b = 'galraeimg' + now();
    const head = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: meta.id + '.jpg', parents: [folder] })}\r\n--${b}\r\nContent-Type: ${blob.type || 'image/jpeg'}\r\n\r\n`;
    const res = await gjson(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${b}` },
      body: new Blob([head, blob, `\r\n--${b}--`]),
    });
    S.patchImage(meta.id, { fileId: res.id });
    st.dirty = true;
  }
}

async function fileId(fid) {
  if (st.fileId) return st.fileId;
  const q = encodeURIComponent(`name='${FILE}' and '${fid}' in parents and trashed=false`);
  const r = await gjson(`${API}/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&spaces=drive`);
  st.fileId = r.files?.[0]?.id || '';
  save();
  return st.fileId;
}

async function download(id) {
  const r = await gfetch(`${API}/files/${id}?alt=media`);
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error(`Drive ${r.status}`);
  try {
    const d = await r.json();
    return d && typeof d.nodes === 'object' ? { data: d } : { data: null };
  } catch { return { data: null }; }
}

async function upload(fid, body) {
  const json = JSON.stringify(body);
  if (st.fileId) {
    const r = await gfetch(`${UPLOAD}/files/${st.fileId}?uploadType=media&fields=id`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json,
    });
    if (r.ok) return;
    if (r.status !== 404) throw new Error(`Drive 업로드 ${r.status}`);
    st.fileId = '';
  }
  const b = 'galrae' + now();
  const meta = JSON.stringify({ name: FILE, parents: [fid], mimeType: 'application/json' });
  const res = await gjson(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${b}--`,
  });
  st.fileId = res.id;
  save();
}

export async function runSync({ manual = false } = {}) {
  if (!st.enabled) return;
  if (running) { pending = true; return; }
  if (st.needLogin && !manual) { setStatus('login'); return; }
  running = true;
  setStatus('syncing');
  try {
    await getToken();
    await ensureEmail();
    const fid = await folderId();
    await uploadImages(fid);
    let id = await fileId(fid);
    let remote = null;
    if (id) {
      const r = await download(id);
      if (r.missing) { st.fileId = ''; id = ''; } else remote = r.data;
    }
    const local = S.getData();
    let base = local;
    // 새 기기의 손대지 않은 예시 데이터는 드라이브 데이터에 섞지 않는다
    if (remote && Object.keys(remote.nodes).length && local.meta.sampleUntouched) {
      base = { v: 1, nodes: {}, progress: {}, log: {}, presets: {}, meta: { sampleUntouched: false } };
    }
    if (remote) {
      const merged = S.merge(base, remote);
      const changed = JSON.stringify(stripMeta(merged)) !== JSON.stringify(stripMeta(S.merge(remote, {})));
      S.replaceData(merged);
      if (changed || st.dirty) await upload(fid, S.exportable());
    } else {
      await upload(fid, S.exportable());
    }
    st.dirty = false;
    st.lastSync = now();
    st.needLogin = false;
    save();
    setStatus('ok');
  } catch (e) {
    console.warn(e);
    if (String(e.message).includes('login_required')) setStatus('login', '로그인이 만료되었어요. 다시 로그인해 주세요.');
    else setStatus('error', navigator.onLine ? e.message : '오프라인이에요. 연결되면 다시 시도할게요.');
  } finally {
    running = false;
    if (pending) { pending = false; setTimeout(runSync, 500); }
  }
}

const stripMeta = (d) => ({ nodes: d.nodes, progress: d.progress, log: d.log, presets: d.presets, images: d.images });

export function scheduleSync() {
  st.dirty = true;
  save();
  if (!st.enabled || !st.auto || st.needLogin) return;
  clearTimeout(timer);
  timer = setTimeout(runSync, 2500);
}

export function setOptions(patch) {
  Object.assign(st, patch);
  if ('clientId' in patch) Object.assign(st, { token: '', exp: 0 });
  save();
  setStatus(st.enabled ? status : 'off');
}

export function init() {
  S.onChange((o) => { if (o.local) scheduleSync(); });
  // 다른 기기에서 올린 사진은 필요할 때 드라이브에서 받아온다
  Images.setFetcher(async (fileId) => {
    if (!st.enabled) return null;
    const r = await gfetch(`/files/${fileId}?alt=media`);
    return r.ok ? r.blob() : null;
  });
  if (!st.enabled) return;
  setTimeout(() => runSync({ manual: justLoggedIn }), 300);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && st.auto && now() - st.lastSync > 30e3) runSync();
  });
  window.addEventListener('online', () => st.auto && runSync());
}
