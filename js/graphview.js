// 마인드맵 화면: 툴바 + 캔버스 + 노트 카드
import * as S from './store.js';
import { Graph } from './graph.js';
import * as Ed from './editor.js';
import { $, esc, renderMd, debounce, lsGet, lsSet } from './util.js';

let el, api, g;
let scope = '';      // 특정 과목만 보기
let local = false;   // 선택 갈래 주변만 보기
let dirty = true;
// 마인드맵에서 펼친 갈래 (누르면 바로 아래 레벨이 보임)
const openSaved = lsGet('galrae.v1.mapOpen', null);
let open = new Set(openSaved || []);
let openInit = !openSaved;
let lastSel = null;
const saveOpen = () => lsSet('galrae.v1.mapOpen', [...open]);
// 애플 시스템 색 [라이트, 다크]
const PALETTE = [
  ['#007aff', '#0a84ff'], ['#ff9500', '#ff9f0a'], ['#34c759', '#30d158'], ['#af52de', '#bf5af2'],
  ['#ff2d55', '#ff375f'], ['#5ac8fa', '#64d2ff'], ['#5856d6', '#5e5ce6'], ['#ff3b30', '#ff453a'],
  ['#ffcc00', '#ffd60a'], ['#00c7be', '#63e6e2'],
];

export function init(root, hooks) {
  el = root;
  api = hooks;
  el.innerHTML = `<div class="graph-wrap">
    <div class="g-toolbar">
      <input class="input search" id="gSearch" placeholder="갈래 찾기" type="search" list="gList">
      <datalist id="gList"></datalist>
      <select class="input" id="gScope" title="범위"></select>
      <div class="seg" id="gLayout"><button data-v="tree">마인드맵</button><button data-v="force">자유</button></div>
      <div class="seg" id="gColor"><button data-v="subject">분류색</button><button data-v="mastery">숙련도</button></div>
      <label class="g-depth" title="이 단계까지 한 번에 펼치기">펼치기 <select class="input" id="gDepth"></select></label>
      <button class="btn small" id="gLocal" title="선택한 갈래 주변만">주변만</button>
      <button class="btn small" id="gFit" title="전체 보기">⤢</button>
    </div>
    <div class="g-body">
      <canvas id="gCanvas"></canvas>
      <div class="g-legend" id="gLegend"></div>
      <aside class="g-info" id="gInfo" hidden></aside>
    </div>
  </div>`;
  g = new Graph($('#gCanvas', el), {
    onSelect: (id) => { flushEdit(); onNodeTap(id); },
    onOpen: (id) => api.go('tree', id),
  });
  $('#gLayout', el).addEventListener('click', (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (!v) return;
    S.saveSettings({ graphLayout: v });
    refresh();
    setTimeout(() => g.fit(), v === 'tree' ? 50 : 700);
  });
  $('#gColor', el).addEventListener('click', (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (!v) return;
    S.saveSettings({ graphColor: v });
    refresh();
  });
  $('#gDepth', el).addEventListener('change', (e) => {
    const n = +e.target.value;
    open = new Set(S.descendants(null).filter((x) => !n || S.depth(x) < n));
    saveOpen();
    e.target.value = '';
    refresh(true);
    remember();
  });
  $('#gScope', el).addEventListener('change', (e) => { scope = e.target.value; refresh(true); });
  $('#gLocal', el).addEventListener('click', () => {
    local = !local;
    if (local && !g.sel) { local = false; return api.toast('먼저 갈래를 하나 선택해 주세요'); }
    refresh(true);
  });
  $('#gFit', el).addEventListener('click', () => g.fit());
  const search = $('#gSearch', el);
  search.addEventListener('change', () => {
    const q = search.value.trim();
    const id = S.findByTitle(q) || S.search(q, 1)[0];
    if (id) focus(id);
  });
  search.addEventListener('input', debounce(() => {
    $('#gList', el).innerHTML = S.search(search.value, 12).map((id) => `<option value="${esc(S.node(id).title)}">`).join('');
  }, 120));
  $('#gInfo', el).addEventListener('click', onInfoClick);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { g.readColors(); refresh(); });
}

export const graph = () => g;
export function markDirty() { dirty = true; }
export function update() { if (dirty) refresh(); }

export function show(id) {
  g.readColors();
  if (dirty || !g.nodes.length) refresh(true);
  if (id && S.node(id)) {
    if (scope && S.rootOf(id) !== scope) { scope = ''; refresh(true); }
    setTimeout(() => { focus(id, { record: false }); remember(true); }, 60);
  } else {
    if (!g.sel) setTimeout(() => g.fit(0), 30);
    remember(true);
  }
}

export function themeChanged() { if (g) { g.readColors(); g.kick(0); } }

// ---------- 뒤로 가기 = 마인드맵의 바로 전 상태 ----------
// 누를 때마다 (펼친 갈래 · 선택한 갈래)를 브라우저 기록에 쌓아 두고,
// 휴대폰 뒤로 가기를 누르면 한 단계씩 되돌린다. 맨 처음 상태에서 한 번 더 누르면 마인드맵을 나간다.
const snapshot = () => ({ open: [...open], sel: g.sel || null });
function remember(replace = false) {
  const st = { ...(history.state || {}), gmap: snapshot() };
  if (replace) history.replaceState(st, '');
  else history.pushState(st, '');
}
window.addEventListener('popstate', (e) => {
  const s = e.state?.gmap;
  if (!s || !el || el.hidden) return;
  flushEdit();
  editing = false;
  open = new Set(s.open);
  saveOpen();
  lastSel = s.sel;
  g.select(s.sel);
  refresh();
  showInfo(s.sel);
  if (s.sel && g.map.has(s.sel)) g.centerOn(s.sel, Math.max(g.view.k, 0.9), infoOffset());
});

// 누르면: 접혀 있으면 바로 아래 레벨 펼치기, 이미 펼친 걸 다시 누르면 접기
function onNodeTap(id) {
  if (!id) {
    if (!lastSel && !g.sel) return;
    lastSel = null;
    showInfo(null);
    return remember();
  }
  if (!local && S.children(id).length) {
    if (open.has(id) && lastSel === id) open.delete(id); else open.add(id);
    saveOpen();
    refresh();
  } else if (local) refresh();
  lastSel = id;
  showInfo(id);
  g.centerOn(id, Math.max(g.view.k, 0.9), infoOffset());
  remember();
}

function focus(id, { record = true } = {}) {
  // 경로를 펼쳐서 보이게
  for (const n of S.path(id).slice(0, -1)) open.add(n.id);
  saveOpen();
  lastSel = id;
  g.select(id);
  if (local) refresh();
  else { if (!g.map.has(id)) scope = ''; refresh(); }
  showInfo(id);
  g.centerOn(id, 1.3, infoOffset());
  if (record) remember();
}

function infoOffset() {
  const box = $('#gInfo', el);
  if (box.hidden) return { x: 0, y: 0 };
  const r = box.getBoundingClientRect(), c = $('#gCanvas', el).getBoundingClientRect();
  // 넓은 화면: 오른쪽 패널만큼 왼쪽으로, 좁은 화면: 아래 패널만큼 위로
  const tree = S.settings.graphLayout === 'tree';
  if (r.width < c.width * 0.7) {
    // 마인드맵은 하위가 오른쪽으로 뻗으니 선택 갈래를 보이는 영역의 왼쪽 1/4 지점에
    const visW = c.width - r.width - 14;
    return { x: (tree ? visW * 0.25 : visW / 2) - c.width / 2, y: 0 };
  }
  return { x: tree ? -c.width * 0.3 : 0, y: -(r.height + 8) / 2 };
}

function syncButtons() {
  for (const b of el.querySelectorAll('#gLayout button')) b.classList.toggle('on', b.dataset.v === S.settings.graphLayout);
  for (const b of el.querySelectorAll('#gColor button')) b.classList.toggle('on', b.dataset.v === S.settings.graphColor);
  $('#gLocal', el).classList.toggle('primary', local);
}

function refresh(refit = false) {
  dirty = false;
  const md = S.maxDepth();
  const depthSel = $('#gDepth', el);
  depthSel.innerHTML = `<option value="" disabled selected>단계</option>` + Array.from({ length: md }, (_, i) => `<option value="${i + 1}">${S.levelName(i + 1)}까지</option>`).join('') + `<option value="0">모두</option>`;
  const scopeSel = $('#gScope', el);
  if (scope && !S.node(scope)) scope = '';
  scopeSel.innerHTML = `<option value="">모든 과목</option>` + S.roots().map((r) => `<option value="${r}">${esc(S.node(r).title || '제목 없음')}</option>`).join('');
  scopeSel.value = scope;
  syncButtons();

  let ids = scope ? S.descendants(scope) : S.descendants(null);
  if (openInit) { S.roots().forEach((r) => open.add(r)); openInit = false; saveOpen(); }
  // 펼친 갈래의 바로 아래만 보인다
  if (!local) ids = ids.filter((x) => S.path(x).slice(0, -1).every((a) => open.has(a.id)));
  if (local && g.sel && S.node(g.sel)) {
    // 선택 갈래의 경로 + 형제 + 2단계 하위 + 링크
    const keep = new Set();
    const p = S.path(g.sel);
    for (const n of p) keep.add(n.id);
    const par = S.parentOf(g.sel);
    for (const s of S.children(par)) keep.add(s);
    for (const c of S.children(g.sel)) { keep.add(c); for (const cc of S.children(c)) keep.add(cc); }
    for (const [a, b] of links()) { if (a === g.sel) keep.add(b); if (b === g.sel) keep.add(a); }
    ids = ids.filter((x) => keep.has(x));
  } else local = false;

  const mm = S.masteryMap();
  const branchIdx = new Map();
  for (const r of S.roots()) S.children(r).forEach((b) => branchIdx.set(b, branchIdx.size));
  const colorMode = S.settings.graphColor;
  const dark = document.documentElement.dataset.dark === '1';
  const list = ids.map((id) => {
    const n = S.node(id);
    const d = S.depth(id);
    const size = S.descendants(id).length;
    let color;
    if (colorMode === 'mastery') {
      const m = mm.get(id);
      color = m == null ? (dark ? '#4a4d57' : '#c4c6cf') : `hsl(${Math.round(m * 125)}, 65%, ${dark ? 52 : 46}%)`;
    } else if (d === 1) {
      color = dark ? '#f5f5f7' : '#1d1d1f';
    } else {
      // 마인드맵처럼 대단원(2단계) 가지마다 한 가지 색
      const branch = S.path(id)[1].id;
      color = PALETTE[(branchIdx.get(branch) ?? 0) % PALETTE.length][dark ? 1 : 0];
    }
    const tree = S.settings.graphLayout === 'tree';
    const r = tree ? Math.max(4.5, 11 - d * 1.8) : Math.min(24, 4 + Math.sqrt(size) * 2.4 + (d === 1 ? 4 : 0));
    const hidden = !local && !open.has(id) ? S.children(id).length : 0;
    return { id, parent: S.parentOf(id), label: (n.title || '제목 없음') + (hidden ? `  +${hidden}` : ''), depth: d, color, r, more: hidden };
  });
  g.setLayout(S.settings.graphLayout);
  g.setData(list, links());
  g.highlight = g.sel ? new Set(S.path(g.sel).map((n) => n.id)) : null;
  $('#gLegend', el).innerHTML = colorMode === 'mastery'
    ? `<span><i style="background:hsl(0,65%,48%)"></i>약함</span><span><i style="background:hsl(62,65%,48%)"></i>보통</span><span><i style="background:hsl(125,65%,46%)"></i>강함</span><span><i style="background:${dark ? '#4a4d57' : '#c4c6cf'}"></i>미학습</span>`
    : `<span>${ids.length}개 갈래</span><span class="muted">누르면 펼치기/접기 · 더블클릭: 정리에서 보기</span>`;
  if (refit) setTimeout(() => g.fit(g.nodes.length > 1 ? 450 : 0), 30);
}

// 메모 속 [[제목]] 링크 → 점선 연결
function links() {
  const out = [];
  for (const id of S.descendants(null)) {
    const note = S.node(id).note;
    if (!note || !note.includes('[[')) continue;
    for (const m of note.matchAll(/\[\[(.+?)\]\]/g)) {
      const t = S.findByTitle(m[1]);
      if (t) out.push([id, t]);
    }
  }
  return out;
}

// ---------- 노트 카드 (선택한 갈래의 외울 것을 크게, 그 자리에서 편집) ----------
let editing = false;
let gEd = null;
const saveNote = debounce((id, v, done) => { S.as('graph-edit', () => S.updateNode(id, { note: v })); done?.(); }, 600);
const saveTitle = debounce((id, v) => S.as('graph-edit', () => S.updateNode(id, { title: v })), 300);

function showInfo(id) {
  const box = $('#gInfo', el);
  g.highlight = id ? new Set(S.path(id).map((n) => n.id)) : null;
  g.kick(0);
  if (!id || !S.node(id)) { box.hidden = true; editing = false; return; }
  if (box.dataset.id !== id) editing = false;
  box.dataset.id = id;
  const n = S.node(id);
  const p = S.path(id);
  const kids = S.children(id);
  const sibs = S.children(S.parentOf(id));
  const note = (n.note || '').trim();
  box.hidden = false;
  box.innerHTML = `<button class="gi-grab" data-act="grow" aria-label="크게 보기"></button>
    <div class="gi-head">
      <div class="crumbs">${p.slice(0, -1).map((x) => `<a data-focus="${x.id}">${esc(x.title)}</a>`).join('<i>›</i>') || `<span class="muted">${esc(S.levelName(1))}</span>`}</div>
      <button class="icon-btn" data-act="full" title="크게 보기">${box.classList.contains('full') ? '⤡' : '⤢'}</button>
      <button class="icon-btn" data-act="close" title="닫기">✕</button>
    </div>
    ${editing
      ? `<input class="input gi-title-in" value="${esc(n.title)}" placeholder="제목">
         <div class="gi-note-host"></div>
         <div class="gi-actions gi-save"><span class="save-state" id="gSaveState">자동 저장돼요</span><button class="btn primary" data-act="done" title="저장 (Ctrl+S)">저장</button></div>`
      : `<h2 class="gi-title">${esc(n.title || '제목 없음')}${n.star ? ' <span class="st">★</span>' : ''}</h2>
         <div class="gi-sub muted small">${esc(S.levelName(p.length))}${sibs.length > 1 ? ` · 같은 층 ${sibs.length}가지 중 ${sibs.indexOf(id) + 1}번째` : ''}</div>
         <div class="gi-note ${note ? '' : 'empty'}" data-act="edit">${note ? `<div class="md big">${renderMd(note)}</div>` : '<p class="muted">외울 것이 없어요. 눌러서 추가</p>'}</div>
         ${kids.length ? `<div class="gi-sec"><h4>하위 ${kids.length}</h4><div class="gi-kids">${kids.map((k, i) => {
           const kn = S.node(k);
           return `<button data-focus="${k}"><em>${i + 1}</em><span>${esc(kn.title || '제목 없음')}</span>${kn.note?.trim() ? '<i>📝</i>' : ''}${S.children(k).length ? `<small>${S.children(k).length}</small>` : ''}</button>`;
         }).join('')}</div></div>` : ''}
         ${sibs.length > 1 ? `<div class="gi-sec"><h4>같은 층</h4><div class="chips">${sibs.map((s) => `<button class="chip ${s === id ? 'on' : ''}" data-focus="${s}">${esc(S.node(s).title)}</button>`).join('')}</div></div>` : ''}
         <div class="gi-actions">
           <button class="btn small" data-act="edit">✎ 편집</button>
           <button class="btn small" data-act="train">카드 학습</button>
           <button class="btn small" data-act="tree">정리에서 보기</button>
           <button class="btn small ghost" data-act="local">${local ? '전체 보기' : '주변만'}</button>
         </div>`}`;
  if (editing) {
    const st = (t) => { const s = $('#gSaveState', box); if (s) s.textContent = t; };
    gEd = Ed.mount($('.gi-note-host', box), n.note || '', (v) => { st('저장 중…'); saveNote(id, v, () => st('저장됨 ✓')); }, { rows: 16, onSave: () => { flushEdit(); st('저장됨 ✓'); api.toast('저장했어요', { ms: 1200 }); } });
    const ti = $('.gi-title-in', box);
    ti.addEventListener('input', () => saveTitle(id, ti.value));
  }
}

function onInfoClick(e) {
  const wl = e.target.closest('.wikilink');
  if (wl) { const id = S.findByTitle(wl.dataset.link); if (id) focus(id); return; }
  const b = e.target.closest('[data-act],[data-focus]');
  if (!b) return;
  if (b.dataset.focus) { flushEdit(); return focus(b.dataset.focus); }
  switch (b.dataset.act) {
    case 'close': flushEdit(); g.select(null); lastSel = null; showInfo(null); if (local) { local = false; refresh(true); } return remember();
    case 'grow': $('#gInfo', el).classList.toggle('grown'); return;
    case 'edit': editing = true; showInfo(g.sel); gEd?.focus(); return;
    case 'done': flushEdit(); editing = false; refresh(); api.toast('저장했어요', { ms: 1200 }); return showInfo(g.sel);
    case 'cancel-edit': flushEdit(); editing = false; refresh(); return showInfo(g.sel);
    case 'full': {
      const box = $('#gInfo', el);
      box.classList.toggle('full');
      b.textContent = box.classList.contains('full') ? '⤡' : '⤢';
      return;
    }
    case 'train': return api.train(g.sel);
    case 'tree': return api.go('tree', g.sel);
    case 'local': local = !local; refresh(true); return showInfo(g.sel);
  }
}

function flushEdit() {
  if (!editing) return;
  saveNote.cancel(); saveTitle.cancel();
  const id = $('#gInfo', el).dataset.id;
  const ti = $('.gi-title-in', el);
  const n = S.node(id);
  if (!n) return;
  const patch = {};
  if (gEd && document.contains(gEd.rich)) { const v = gEd.value(); if (v !== (n.note || '')) patch.note = v; }
  if (ti && ti.value !== n.title) patch.title = ti.value;
  if (Object.keys(patch).length) S.as('graph-edit', () => S.updateNode(id, patch));
}