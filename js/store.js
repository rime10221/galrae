// 데이터 저장소: 갈래(노드) 트리, 학습 기록, 프리셋, 설정
import { uid, now, lsGet, lsSet, todayKey, toast } from './util.js';

const KEY = 'galrae.v1.data';
const SKEY = 'galrae.v1.settings';

const listeners = new Set();
let data = null;
let idx = null; // { kids: Map, par: Map, depth: Map }
let source = null;

export const DEFAULT_SETTINGS = {
  theme: 'system',
  levelNames: ['과목', '대단원', '중단원', '소단원', '세부'],
  requeueAgain: true,
  showCount: true,
  cardScale: 1,
  graphColor: 'subject',
  graphLayout: 'tree',
  graphDepth: 0,
  lastTrain: null,
  tipsHidden: false,
};
export const settings = { ...DEFAULT_SETTINGS, ...lsGet(SKEY, {}) };
if (settings.graphLayout === 'radial') settings.graphLayout = 'tree'; // 예전 방사형 설정 이전
export function saveSettings(patch = {}) {
  Object.assign(settings, patch);
  lsSet(SKEY, settings);
}
export const levelName = (d) => settings.levelNames[d - 1] || `Lv${d}`;

const emptyData = () => ({ v: 1, nodes: {}, progress: {}, log: {}, presets: {}, meta: {} });

export const getData = () => data;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// 변경의 출처를 표시해 두면 리스너가 자기 자신이 만든 변경은 다시 그리지 않을 수 있다
export function as(src, fn) {
  const prev = source;
  source = src;
  try { return fn(); } finally { source = prev; }
}

export function load() {
  data = lsGet(KEY, null);
  if (!data || typeof data.nodes !== 'object') {
    data = emptyData();
    importOutline(SAMPLE, null, { silent: true });
    data.meta.sampleUntouched = true;
    persist();
  }
  normalize(data);
  idx = null;
}

function normalize(d) {
  for (const k of ['nodes', 'progress', 'log', 'presets', 'meta']) if (!d[k] || typeof d[k] !== 'object') d[k] = {};
  return d;
}

let warned = false;
function persist() {
  if (!lsSet(KEY, data) && !warned) {
    warned = true;
    toast('브라우저 저장 공간이 부족해 저장하지 못했어요. 설정에서 JSON 백업을 받아두세요.', { ms: 8000 });
  }
}

function emit(opts) {
  for (const fn of listeners) {
    try { fn(opts); } catch (e) { console.error(e); }
  }
}

// 로컬 변경 → 저장 + 알림 (동기화 예약 포함)
function touch() {
  idx = null;
  data.meta.sampleUntouched = false;
  persist();
  emit({ src: source, local: true });
}

// 동기화로 받아온 데이터로 교체
export function replaceData(next) {
  const meta = data.meta;
  data = normalize(next);
  data.meta = { ...meta, ...(next.meta || {}) };
  idx = null;
  persist();
  emit({ src: 'sync', local: false });
}

// ---------- 트리 인덱스 ----------
function index() {
  if (idx) return idx;
  const kids = new Map();
  const par = new Map();
  const nodes = data.nodes;
  const alive = (id) => id && nodes[id] && !nodes[id].deleted;
  for (const n of Object.values(nodes)) {
    if (n.deleted) continue;
    let p = alive(n.parent) ? n.parent : null;
    // 동기화 병합으로 생긴 순환은 끊어서 최상위로 올린다
    if (p) {
      const seen = new Set([n.id]);
      let cur = p;
      while (cur) {
        if (seen.has(cur)) { p = null; break; }
        seen.add(cur);
        cur = alive(nodes[cur].parent) ? nodes[cur].parent : null;
      }
    }
    par.set(n.id, p);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n.id);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => (nodes[a].order - nodes[b].order) || (nodes[a].created - nodes[b].created));
  }
  idx = { kids, par, depth: new Map() };
  return idx;
}

export const node = (id) => {
  const n = id && data.nodes[id];
  return n && !n.deleted ? n : null;
};
export const parentOf = (id) => index().par.get(id) ?? null;
export const children = (id) => index().kids.get(id ?? null) || [];
export const roots = () => children(null);
export const count = () => index().par.size;

export function path(id) {
  const out = [];
  let cur = id;
  while (cur) {
    const n = node(cur);
    if (!n) break;
    out.unshift(n);
    cur = parentOf(cur);
  }
  return out;
}

export function depth(id) {
  const ix = index();
  if (!ix.depth.has(id)) ix.depth.set(id, path(id).length);
  return ix.depth.get(id);
}

export function rootOf(id) {
  let cur = id;
  while (parentOf(cur)) cur = parentOf(cur);
  return cur;
}

// id === null 이면 전체를 트리 순서로
export function descendants(id, includeSelf = true) {
  const out = [];
  const walk = (x) => { out.push(x); for (const c of children(x)) walk(c); };
  if (id == null) roots().forEach(walk);
  else {
    if (includeSelf) out.push(id);
    children(id).forEach(walk);
  }
  return out;
}

export function isAncestor(a, b) {
  let cur = parentOf(b);
  while (cur) {
    if (cur === a) return true;
    cur = parentOf(cur);
  }
  return false;
}

export function maxDepth() {
  let m = 0;
  for (const id of index().par.keys()) m = Math.max(m, depth(id));
  return m;
}

export function findByTitle(title) {
  const t = String(title).trim().toLowerCase();
  for (const id of descendants(null)) if (node(id).title.trim().toLowerCase() === t) return id;
  return null;
}

export function search(q, limit = 50) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hits = [];
  for (const id of descendants(null)) {
    const n = node(id);
    const t = n.title.toLowerCase();
    let score = -1;
    if (t === s) score = 0;
    else if (t.startsWith(s)) score = 1;
    else if (t.includes(s)) score = 2;
    else if ((n.cues || []).some((c) => c.toLowerCase().includes(s))) score = 3;
    else if ((n.note || '').toLowerCase().includes(s)) score = 4;
    if (score >= 0) hits.push({ id, score });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, limit).map((h) => h.id);
}

// ---------- 변경 ----------
function orderAt(parent, index, exclude) {
  const sibs = children(parent).filter((x) => x !== exclude);
  const prev = sibs[index - 1], next = sibs[index];
  const po = prev ? data.nodes[prev].order : null;
  const no = next ? data.nodes[next].order : null;
  if (po == null && no == null) return 0;
  if (po == null) return no - 1;
  if (no == null) return po + 1;
  return (po + no) / 2;
}

function rawAdd({ parent = null, title = '', index = null, note = '', cues = [] }) {
  if (index == null) index = children(parent).length;
  const t = now();
  const n = { id: uid(), parent, title, note, cues, order: orderAt(parent, index), star: false, created: t, updated: t };
  data.nodes[n.id] = n;
  idx = null;
  return n.id;
}

export function addNode(opts = {}) {
  const id = rawAdd(opts);
  touch();
  return id;
}

export function updateNode(id, patch) {
  const n = node(id);
  if (!n) return;
  Object.assign(n, patch, { updated: now() });
  touch();
}

export function moveNode(id, parent, index) {
  const n = node(id);
  if (!n) return false;
  if (parent && (parent === id || isAncestor(id, parent))) return false;
  if (index == null) index = children(parent).filter((x) => x !== id).length;
  n.order = orderAt(parent, index, id);
  n.parent = parent;
  n.updated = now();
  touch();
  return true;
}

export function indent(id) {
  const p = parentOf(id);
  const sibs = children(p);
  const i = sibs.indexOf(id);
  if (i <= 0) return null;
  const np = sibs[i - 1];
  moveNode(id, np, children(np).length);
  return np;
}

export function outdent(id) {
  const p = parentOf(id);
  if (!p) return false;
  const gp = parentOf(p);
  return moveNode(id, gp, children(gp).indexOf(p) + 1);
}

export function moveBy(id, delta) {
  const p = parentOf(id);
  const sibs = children(p);
  const j = sibs.indexOf(id) + delta;
  if (j < 0 || j >= sibs.length) return false;
  return moveNode(id, p, j);
}

export function deleteNode(id) {
  const ids = descendants(id);
  const t = now();
  for (const x of ids) Object.assign(data.nodes[x], { deleted: true, updated: t });
  touch();
  return ids;
}

export function restore(ids) {
  const t = now();
  for (const x of ids) if (data.nodes[x]) Object.assign(data.nodes[x], { deleted: false, updated: t });
  touch();
}

export function duplicate(id) {
  const map = new Map();
  const copy = (src, parent, index) => {
    const n = node(src);
    const nid = rawAdd({ parent, title: n.title, note: n.note, cues: [...(n.cues || [])], index });
    map.set(src, nid);
    for (const c of children(src)) copy(c, nid, null);
  };
  const p = parentOf(id);
  copy(id, p, children(p).indexOf(id) + 1);
  data.nodes[map.get(id)].title += ' (사본)';
  touch();
  return map.get(id);
}

// ---------- 학습 기록 ----------
export const INTERVALS = [10 * 60e3, 1, 3, 7, 16, 35].map((d, i) => (i ? d * 864e5 : d));
export const prog = (key) => data.progress[key] || null;

export function nextDue(p, g) {
  const b = p ? p.b : 0;
  const nb = g === 1 ? 0 : g === 2 ? Math.max(1, b - 1) : Math.min(5, b + 1);
  return { b: nb, ms: g === 1 ? INTERVALS[0] : INTERVALS[nb] };
}

export function rate(key, g) {
  const old = data.progress[key];
  const p = { b: 0, n: 0, ok: 0, ng: 0, ...(old || {}) };
  const nx = nextDue(old, g);
  p.b = nx.b;
  p.n++;
  if (g === 1) p.ng++;
  if (g === 3) p.ok++;
  p.u = now();
  p.d = p.u + nx.ms;
  data.progress[key] = p;
  const k = todayKey();
  data.log[k] = { n: (data.log[k]?.n || 0) + 1, u: now() };
  touch();
  return old ? { ...old } : null;
}

export function setProg(key, val) {
  if (val) data.progress[key] = val;
  else delete data.progress[key];
  const k = todayKey();
  if (data.log[k]?.n) data.log[k] = { n: data.log[k].n - 1, u: now() };
  touch();
}

export function resetProgress() {
  data.progress = {};
  touch();
}

// 노드별 평균 숙련도 (0~1, 기록 없으면 없음)
export function masteryMap() {
  const sum = new Map();
  for (const [k, p] of Object.entries(data.progress)) {
    const id = k.slice(0, k.indexOf('|'));
    const s = sum.get(id) || [0, 0];
    s[0] += p.b / 5; s[1]++;
    sum.set(id, s);
  }
  const out = new Map();
  for (const [id, [a, n]] of sum) out.set(id, a / n);
  return out;
}

export function subtreeStats(id, mm = masteryMap()) {
  const ids = descendants(id);
  let seen = 0, tot = 0;
  for (const x of ids) if (mm.has(x)) { seen++; tot += mm.get(x); }
  return { count: ids.length, seen, mastery: seen ? tot / seen : 0, coverage: ids.length ? seen / ids.length : 0 };
}

export function dueKeys() {
  const t = now();
  return Object.entries(data.progress).filter(([k, p]) => p.d <= t && node(k.slice(0, k.indexOf('|')))).map(([k]) => k);
}

export function streak() {
  let s = 0;
  const d = new Date();
  if (!data.log[todayKey(d)]?.n) d.setDate(d.getDate() - 1);
  while (data.log[todayKey(d)]?.n) { s++; d.setDate(d.getDate() - 1); }
  return s;
}
export const todayCount = () => data.log[todayKey()]?.n || 0;

// ---------- 프리셋 ----------
export const presets = () => Object.values(data.presets).filter((p) => !p.deleted).sort((a, b) => a.created - b.created);
export function savePreset(name, opts) {
  const t = now();
  const id = uid();
  data.presets[id] = { id, name, opts, created: t, updated: t };
  touch();
}
export function deletePreset(id) {
  if (data.presets[id]) Object.assign(data.presets[id], { deleted: true, updated: now() });
  touch();
}

// ---------- 병합 (동기화) ----------
export function merge(a, b) {
  a = normalize({ ...a });
  b = normalize({ ...b });
  const out = emptyData();
  const newer = (x, y, k) => (!x ? y : !y ? x : (y[k] || 0) > (x[k] || 0) ? y : x);
  const mergeMap = (key, uk) => {
    const keys = new Set([...Object.keys(a[key]), ...Object.keys(b[key])]);
    for (const k of [...keys].sort()) out[key][k] = newer(a[key][k], b[key][k], uk);
  };
  mergeMap('nodes', 'updated');
  mergeMap('progress', 'u');
  mergeMap('presets', 'updated');
  const days = new Set([...Object.keys(a.log), ...Object.keys(b.log)]);
  for (const k of [...days].sort()) {
    const x = a.log[k], y = b.log[k];
    out.log[k] = !x ? y : !y ? x : { n: Math.max(x.n, y.n), u: Math.max(x.u, y.u) };
  }
  out.meta = a.meta;
  return out;
}

export function exportable() {
  const { v, nodes, progress, log, presets } = data;
  return { v, nodes, progress, log, presets, app: 'galrae', exported: now() };
}

export function importJSON(obj, mode = 'merge') {
  if (!obj || typeof obj.nodes !== 'object') throw new Error('갈래 백업 파일이 아니에요');
  const next = mode === 'replace' ? normalize({ ...obj, meta: {} }) : merge(data, obj);
  data = normalize(next);
  data.meta.sampleUntouched = false;
  idx = null;
  persist();
  emit({ src: 'import', local: true });
}

export function wipeAll() {
  const t = now();
  for (const n of Object.values(data.nodes)) if (!n.deleted) Object.assign(n, { deleted: true, updated: t });
  data.progress = {};
  touch();
}

// ---------- 텍스트(개요) 가져오기 / 내보내기 ----------
// 들여쓰기(탭/스페이스) 또는 #제목, - 목록으로 계층을 만든다.
// "> 내용" 은 바로 위 항목의 외울 것, "? 내용" 은 문제 단서.
export function parseOutline(text) {
  const items = [];
  let headLv = -1, stack = [], last = null;
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    const w = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const t = raw.trim();
    let m;
    if ((m = t.match(/^(#{1,6})\s+(.+)$/))) {
      headLv = Math.min(m[1].length - 1, last ? last.level + 1 : 0);
      stack = [];
      last = { title: m[2].trim(), level: headLv, note: [], cues: [] };
      items.push(last);
      continue;
    }
    if (t.startsWith('>')) { if (last) last.note.push(raw.replace(/^[ \t]*>\s?/, '')); continue; }
    if (/^\?\s*\S/.test(t)) { if (last) last.cues.push(t.replace(/^\?\s*/, '')); continue; }
    while (stack.length && w < stack[stack.length - 1]) stack.pop();
    if (!stack.length || w > stack[stack.length - 1]) stack.push(w);
    let lv = headLv + stack.length;
    if (lv > (last ? last.level : -1) + 1) lv = (last ? last.level : -1) + 1;
    last = { title: t.replace(/^([-*+•]|\d+[.)])\s+/, '').trim(), level: lv, note: [], cues: [] };
    items.push(last);
  }
  return items;
}

export function importOutline(text, parent = null, { silent = false } = {}) {
  const items = parseOutline(text);
  const lastAt = [];
  let added = 0, merged = 0;
  for (const it of items) {
    const par = it.level === 0 ? parent : lastAt[it.level - 1];
    if (par === undefined || !it.title) continue;
    const noteStr = it.note.join('\n').trim();
    let id = children(par).find((c) => node(c).title.trim() === it.title);
    if (id) {
      const n = node(id);
      if (noteStr && !(n.note || '').includes(noteStr)) n.note = n.note ? n.note + '\n' + noteStr : noteStr;
      const cues = n.cues || [];
      for (const c of it.cues) if (!cues.includes(c)) cues.push(c);
      n.cues = cues;
      n.updated = now();
      merged++;
    } else {
      id = rawAdd({ parent: par, title: it.title, note: noteStr, cues: it.cues });
      added++;
    }
    lastAt[it.level] = id;
    lastAt.length = it.level + 1;
  }
  idx = null;
  if (!silent) touch();
  return { added, merged };
}

export function exportOutline(rootId = null) {
  const lines = [];
  const walk = (id, lv) => {
    const n = node(id);
    const ind = '\t'.repeat(lv);
    lines.push(ind + n.title);
    if (n.note && n.note.trim()) for (const l of n.note.split('\n')) lines.push(`${ind}\t> ${l}`.trimEnd());
    for (const c of n.cues || []) if (c.trim()) lines.push(`${ind}\t? ${c}`);
    for (const c of children(id)) walk(c, lv + 1);
  };
  if (rootId) walk(rootId, 0);
  else roots().forEach((r) => walk(r, 0));
  return lines.join('\n');
}

const SAMPLE = `# 산부인과
## 정상 임신과 산전 관리
- 임신의 진단
- 산전 진찰
- 임신 중 영양
## 임신의 내외과적 질환
- 임신과 당뇨병
	> - 선별검사 시기: 임신 ==24~28주==
	> - 2단계법: ==50g GCT== → 양성이면 ==100g OGTT==
	> - 1단계법: ==75g OGTT== (공복·1시간·2시간 중 하나라도 기준 이상이면 진단)
	> - 치료: 식이·운동 -> 조절 안 되면 ==인슐린==
	> - 태아·신생아 합병증: 거대아, 견갑난산, ==신생아 저혈당==
	> - 분만 후 ==4~12주==에 75g OGTT 재검
	? 임신 26주 산모, 50g 경구당부하 1시간 혈당 165 mg/dL
	? 임신 중 식이요법으로 혈당 조절이 안 될 때 1차 약물은?
- 임신과 감염질환
	- B군 연쇄상구균(GBS)
		> - 선별: 임신 ==36~37주== 질·직장 배양
		> - 양성 -> 분만 시 ==페니실린 G== 정맥 예방요법
		? 임신 36주 질·직장 배양 검사에서 양성
	- TORCH 감염
- 임신과 소화·신장·비뇨기 질환
- 임신과 순환·호흡기 질환
- 임신과 내분비 및 기타 질환
## 분만과 산욕
- 정상 분만
- 산욕기 관리
`;
