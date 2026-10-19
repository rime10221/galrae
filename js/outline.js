// 트리(개요) 편집기 + 상세 패널
// Enter 새 항목 · Tab 들여쓰기 · Shift+Tab 내어쓰기 · Alt+↑↓ 이동 · Ctrl+Enter 상세 · 빈 줄에서 Backspace 삭제
import * as S from './store.js';
import * as Ed from './editor.js';
import { $, $$, esc, debounce, renderMd, lsGet, lsSet, composing, toast, confirmDlg, openDialog } from './util.js';

let el, api;
let sel = null;          // 상세 패널에 열린 노드
let filter = '';
let noteEd = null; // 상세 패널의 외울 것 편집기
let preview = lsGet('galrae.v1.notePreview', true);
// 트리에서 외울 것을 줄 아래에 펼쳐 보기 (갈래마다 토글, 기본은 접힘)
let notesOpen = new Set(lsGet('galrae.v1.notesOpen', []));
const saveNotesOpen = () => lsSet('galrae.v1.notesOpen', [...notesOpen]);
let collapsed = new Set(lsGet('galrae.v1.collapsed', []));
const saveCollapsed = () => lsSet('galrae.v1.collapsed', [...collapsed]);

export function init(root, hooks) {
  el = root;
  api = hooks;
  el.innerHTML = `<div class="tree-wrap">
    <div class="tree-main">
      <header class="tree-h"><h1>정리</h1><span class="muted small" id="treeStat"></span></header>
      <div class="toolbar">
        <input class="input search" id="treeFilter" placeholder="갈래 · 내용 · 단서 검색" type="search">
        <div class="tb-btns">
          <button class="btn small" data-act="notes" id="notesBtn" title="모든 외울 것 펼치기/접기">외울 것 모두 펼치기</button>
          <button class="btn small" data-act="expand-all" title="모두 펼치기">펼치기</button>
          <button class="btn small" data-act="collapse-all" title="모두 접기">접기</button>
          <button class="btn small" data-act="import">가져오기</button>
          <button class="btn small" data-act="export">내보내기</button>
          <button class="btn small primary" data-act="add-root">+ 과목</button>
        </div>
      </div>
      <div class="olist" id="olist"></div>
      <p class="tree-help muted small">Enter 새 항목 · Tab 들여쓰기 · Shift+Tab 내어쓰기 · Alt+↑↓ 순서 이동 · Ctrl+Enter 상세 · 빈 항목에서 Backspace 삭제 · ● 눌러 상세 열기</p>
    </div>
    <aside class="detail" id="detail"></aside>
    <div class="otools" id="otools">
      <button data-tool="outdent" title="내어쓰기">⇤</button><button data-tool="indent" title="들여쓰기">⇥</button>
      <button data-tool="up" title="위로">↑</button><button data-tool="down" title="아래로">↓</button>
      <button data-tool="add" title="새 항목">＋</button><button data-tool="child" title="하위 항목">↳</button>
      <button data-tool="open" title="상세">≡</button><button data-tool="del" title="삭제">🗑</button>
    </div>
  </div>`;
  const list = $('#olist', el);
  list.addEventListener('click', onListClick);
  list.addEventListener('keydown', onKey);
  list.addEventListener('input', (e) => { if (e.target.matches('.otitle')) commitLater(e.target); });
  list.addEventListener('focusout', (e) => { if (e.target.matches('.otitle')) commit(e.target); });
  list.addEventListener('focusin', () => el.classList.add('editing'));
  list.addEventListener('focusout', () => setTimeout(() => { if (!el.contains(document.activeElement) || !document.activeElement.matches('.otitle')) el.classList.remove('editing'); }, 150));
  $('#otools', el).addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-tool]'); if (b) { e.preventDefault(); tool(b.dataset.tool); } });
  $('.toolbar', el).addEventListener('click', onToolbar);
  $('#treeFilter', el).addEventListener('input', debounce((e) => { filter = e.target.value.trim(); renderList(); }, 150));
  const det = $('#detail', el);
  det.addEventListener('click', onDetailClick);
  det.addEventListener('input', onDetailInput);
}

export function show(id) {
  flushDetail();
  if (id && S.node(id)) {
    for (const n of S.path(id).slice(0, -1)) collapsed.delete(n.id);
    saveCollapsed();
    sel = id;
  }
  render();
  if (id) {
    el.classList.add('detail-open');
    requestAnimationFrame(() => $(`.orow[data-id="${id}"]`, el)?.scrollIntoView({ block: 'center' }));
  }
}

export function render() {
  if (!el) return;
  if (sel && !S.node(sel)) { sel = null; el.classList.remove('detail-open'); }
  renderList();
  renderDetail();
}

export function onStoreChange(o) {
  if (o.src === 'typing' || o.src === 'outline') return;
  // 상세 편집·사진 추가 중에는 편집칸을 다시 그리지 않는다
  if (o.src === 'detail' || o.src === 'image') return renderList();
  // 동기화 등 외부 변경: 편집 중인 칸은 건드리지 않고 포커스를 되살린다
  const a = document.activeElement;
  const det = $('#detail', el);
  if (a && det.contains(a) && a.matches('input,textarea,[contenteditable]')) return renderList();
  const fid = a?.matches?.('.otitle') ? a.closest('.orow').dataset.id : null;
  const caret = fid ? a.selectionStart : 0;
  render();
  if (fid) focusRow(fid, caret);
}

// ---------- 목록 ----------
function matchSet() {
  if (!filter) return null;
  const set = new Set();
  for (const id of S.search(filter, 500)) for (const n of S.path(id)) set.add(n.id);
  return set;
}

function renderList() {
  const list = $('#olist', el);
  const nb = $('#notesBtn', el);
  if (nb) { const w = S.descendants(null).filter((x) => S.node(x).note?.trim()); const all = w.length && w.every((x) => notesOpen.has(x)); nb.textContent = all ? '외울 것 모두 접기' : '외울 것 모두 펼치기'; nb.classList.toggle('primary', !!all); }
  const all = S.descendants(null);
  $('#treeStat', el).textContent = `갈래 ${all.length} · 외울 것 ${all.filter((x) => S.node(x).note?.trim()).length}`;
  const ms = matchSet();
  const mm = S.masteryMap();
  const rows = [];
  const walk = (id, d) => {
    if (ms && !ms.has(id)) return;
    const n = S.node(id);
    const kids = S.children(id);
    const closed = collapsed.has(id) && !ms;
    const m = mm.get(id);
    const meta = [
      n.note?.trim() ? `<button class="note-tg ${notesOpen.has(id) ? 'on' : ''}" data-act="note" tabindex="-1" title="외울 것 펼치기/접기">📝 외울 것</button>` : '',
      kids.length ? `<i class="cnt" title="하위 갈래">${kids.length}</i>` : '',
      n.star ? '<i class="st">★</i>' : '',
      m != null ? `<i class="dot" style="--m:${m}" title="숙련도 ${Math.round(m * 100)}%"></i>` : '',
    ].join('');
    rows.push(`<div class="orow ${id === sel ? 'sel' : ''} d${Math.min(d, 4)}" data-id="${id}" style="--d:${d}">
      <button class="caret ${kids.length ? (closed ? '' : 'open') : 'leaf'}" data-act="toggle" tabindex="-1" aria-label="펼치기"></button>
      <button class="bullet ${closed && kids.length ? 'has' : ''}" data-act="open" tabindex="-1" aria-label="상세"></button>
      <input class="otitle" value="${esc(n.title)}" placeholder="제목 없음" enterkeyhint="next" autocomplete="off">
      <span class="ometa">${meta}</span></div>`);
    if (notesOpen.has(id) && n.note?.trim()) rows.push(`<div class="onote md" data-note="${id}" style="--d:${d}">${renderMd(n.note)}</div>`);
    if (!closed) for (const k of kids) walk(k, d + 1);
  };
  S.roots().forEach((r) => walk(r, 0));
  list.innerHTML = rows.join('') || (filter
    ? '<p class="empty muted">검색 결과가 없어요</p>'
    : `<div class="empty"><p>아직 갈래가 없어요.</p><button class="btn primary" data-act="add-root">+ 첫 과목 만들기</button> <button class="btn" data-act="import">텍스트로 한 번에 가져오기</button></div>`);
}

const rowOf = (id) => $(`.orow[data-id="${id}"]`, el);
const visibleIds = () => $$('.orow', el).map((r) => r.dataset.id);

function focusRow(id, caret = 'end') {
  const inp = rowOf(id)?.querySelector('.otitle');
  if (!inp) return;
  inp.focus();
  const p = caret === 'end' ? inp.value.length : caret;
  try { inp.setSelectionRange(p, p); } catch {}
}

const commitLater = debounce((inp) => commit(inp), 400);
function commit(inp) {
  const id = inp.closest('.orow')?.dataset.id;
  const n = S.node(id);
  if (n && n.title !== inp.value) {
    S.as('typing', () => S.updateNode(id, { title: inp.value }));
    if (id === sel) { const t = $('.d-title', el); if (t && t !== document.activeElement) t.value = inp.value; }
  }
}

// 구조 변경 후 다시 그리고 포커스 복원
function structural(fn, focusId, caret) {
  const a = document.activeElement;
  if (a?.matches?.('.otitle')) commit(a);
  const r = S.as('outline', fn);
  renderList();
  renderDetail();
  if (focusId !== undefined) focusRow(typeof focusId === 'function' ? focusId(r) : focusId, caret);
  return r;
}

function addAfter(id) {
  const n = S.node(id);
  const kids = S.children(id);
  if (kids.length && !collapsed.has(id)) {
    return structural(() => S.addNode({ parent: id, index: 0 }), (nid) => nid);
  }
  const p = S.parentOf(id);
  return structural(() => S.addNode({ parent: p, index: S.children(p).indexOf(n.id) + 1 }), (nid) => nid);
}

function addChild(id) {
  collapsed.delete(id); saveCollapsed();
  return structural(() => S.addNode({ parent: id }), (nid) => nid);
}

async function remove(id, { quiet = false } = {}) {
  const n = S.node(id);
  const total = S.descendants(id).length;
  if (!quiet && (total > 1 || n.note?.trim()) && !(await confirmDlg(`'${n.title || '제목 없음'}'${total > 1 ? ` 과 하위 ${total - 1}개` : ''}를 삭제할까요?`, { ok: '삭제', danger: true }))) return false;
  const vis = visibleIds();
  const i = vis.indexOf(id);
  const ids = S.as('outline', () => S.deleteNode(id));
  if (sel && ids.includes(sel)) { sel = null; el.classList.remove('detail-open'); }
  renderList();
  renderDetail();
  const next = vis.slice(0, i).reverse().find((x) => S.node(x)) || vis.slice(i + 1).find((x) => S.node(x));
  if (next) focusRow(next);
  toast(`삭제했어요${ids.length > 1 ? ` (${ids.length}개)` : ''}`, { action: '되돌리기', onAction: () => { S.restore(ids); render(); } });
  return true;
}

function toggle(id, open) {
  const want = open ?? collapsed.has(id);
  if (want) collapsed.delete(id); else collapsed.add(id);
  saveCollapsed();
  renderList();
}

function openDetail(id) {
  flushDetail();
  sel = id;
  renderList();
  renderDetail();
  el.classList.add('detail-open');
}

function onListClick(e) {
  const nt = e.target.closest('[data-note]');
  if (nt) return openDetail(nt.dataset.note);
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'add-root') return addRoot();
  if (b.dataset.act === 'import') return api.importDialog(null);
  const id = b.closest('.orow')?.dataset.id;
  if (!id) return;
  if (b.dataset.act === 'toggle') toggle(id);
  if (b.dataset.act === 'note') { notesOpen.has(id) ? notesOpen.delete(id) : notesOpen.add(id); saveNotesOpen(); renderList(); }
  if (b.dataset.act === 'open') openDetail(id);
}

function onKey(e) {
  const inp = e.target;
  if (!inp.matches('.otitle') || composing(e)) return;
  const id = inp.closest('.orow').dataset.id;
  const vis = visibleIds();
  const i = vis.indexOf(id);
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Enter' && mod) { e.preventDefault(); commit(inp); openDetail(id); return; }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addAfter(id); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const caret = inp.selectionStart;
    if (e.shiftKey) structural(() => S.outdent(id), id, caret);
    else structural(() => { const np = S.indent(id); if (np) { collapsed.delete(np); saveCollapsed(); } }, id, caret);
    return;
  }
  if (e.key === 'Backspace' && !inp.value && !S.children(id).length) {
    e.preventDefault();
    remove(id, { quiet: true });
    return;
  }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    structural(() => S.moveBy(id, e.key === 'ArrowUp' ? -1 : 1), id, inp.selectionStart);
    return;
  }
  if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    toggle(id, e.key === 'ArrowDown');
    focusRow(id);
    return;
  }
  if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); commit(inp); focusRow(vis[i - 1], Math.min(inp.selectionStart, 999)); }
  if (e.key === 'ArrowDown' && i < vis.length - 1) { e.preventDefault(); commit(inp); focusRow(vis[i + 1], Math.min(inp.selectionStart, 999)); }
  if (e.key === 'Escape') inp.blur();
}

function tool(name) {
  const inp = document.activeElement?.matches?.('.otitle') ? document.activeElement : null;
  const id = inp?.closest('.orow')?.dataset.id || sel;
  if (!id) return;
  const caret = inp?.selectionStart ?? 'end';
  switch (name) {
    case 'outdent': return structural(() => S.outdent(id), id, caret);
    case 'indent': return structural(() => { const np = S.indent(id); if (np) { collapsed.delete(np); saveCollapsed(); } }, id, caret);
    case 'up': return structural(() => S.moveBy(id, -1), id, caret);
    case 'down': return structural(() => S.moveBy(id, 1), id, caret);
    case 'add': return addAfter(id);
    case 'child': return addChild(id);
    case 'open': if (inp) commit(inp); return openDetail(id);
    case 'del': return remove(id);
  }
}

function addRoot() {
  filter = '';
  $('#treeFilter', el).value = '';
  structural(() => S.addNode({ parent: null, title: '' }), (nid) => nid);
}

function onToolbar(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  switch (b.dataset.act) {
    case 'notes': {
      const withNote = S.descendants(null).filter((x) => S.node(x).note?.trim());
      const allOpen = withNote.length && withNote.every((x) => notesOpen.has(x));
      notesOpen = allOpen ? new Set() : new Set(withNote);
      saveNotesOpen();
      return renderList();
    }
    case 'expand-all': collapsed.clear(); saveCollapsed(); return renderList();
    case 'collapse-all':
      for (const id of S.descendants(null)) if (S.children(id).length && S.depth(id) >= 1) collapsed.add(id);
      saveCollapsed();
      return renderList();
    case 'import': return api.importDialog(sel);
    case 'export': return api.exportDialog(sel);
    case 'add-root': return addRoot();
  }
}

// ---------- 상세 패널 ----------
function renderDetail() {
  const det = $('#detail', el);
  const n = S.node(sel);
  if (!n) {
    det.innerHTML = `<div class="d-empty muted"><p>왼쪽 항목의 <b>●</b>를 누르면<br>외울 것을 읽고 편집할 수 있어요.</p></div>`;
    return;
  }
  const p = S.path(sel);
  const kids = S.children(sel);
  const modes = { card: '카드' };
  const stats = Object.entries(modes).map(([m, name]) => {
    const pr = S.prog(`${sel}|${m}`);
    return pr ? `<span class="pstat"><b>${name}</b> ${'●'.repeat(pr.b)}${'○'.repeat(5 - pr.b)} <small>${pr.ok}/${pr.n}</small></span>` : '';
  }).join('');
  det.innerHTML = `<div class="d-inner">
    <div class="d-head">
      <button class="icon-btn d-back" data-act="close" title="닫기">←</button>
      <div class="crumbs">${p.slice(0, -1).map((x) => `<a data-sel="${x.id}">${esc(x.title || '제목 없음')}</a>`).join('<i>›</i>') || '<span class="muted">최상위</span>'}</div>
      <button class="star ${n.star ? 'on' : ''}" data-act="star" title="별표">★</button>
    </div>
    <input class="d-title input" value="${esc(n.title)}" placeholder="제목">
    <div class="d-sub muted small">Lv${p.length} · ${esc(S.levelName(p.length))} · 하위 ${kids.length} · 전체 하위 ${S.descendants(sel).length - 1}</div>
    <div class="d-field">
      <div class="d-label"><span>외울 것 · 주요 내용</span>
        <div class="seg tiny"><button class="${preview ? '' : 'on'}" data-act="edit">편집</button><button class="${preview ? 'on' : ''}" data-act="preview">보기</button></div></div>
      ${preview
        ? `<div class="md note-view" data-act="edit">${renderMd(n.note) || '<span class="muted">비어 있어요. 눌러서 편집</span>'}</div>`
        : `<div class="d-note-host"></div>`}
    </div>
    <div class="d-field">
      <div class="d-label"><span>하위 갈래 ${kids.length}</span><button class="link" data-act="add-child">+ 하위 추가</button></div>
      <div class="chips">${kids.map((k) => `<button class="chip" data-sel="${k}">${esc(S.node(k).title || '제목 없음')}</button>`).join('') || '<span class="muted small">없음</span>'}</div>
    </div>
    ${stats ? `<div class="d-field"><div class="d-label"><span>학습 기록</span></div><div class="pstats">${stats}</div></div>` : ''}
    <div class="d-actions">
      <button class="btn primary" data-act="train">이 세트로 카드 학습</button>
      <button class="btn" data-act="graph">그래프</button>
      <button class="btn" data-act="move">이동</button>
      <button class="btn" data-act="dup">복제</button>
      <button class="btn" data-act="export">내보내기</button>
      <button class="btn danger ghost" data-act="del">삭제</button>
    </div>
  </div>`;
  const host = $('.d-note-host', det);
  const id = sel;
  noteEd = host ? Ed.mount(host, n.note || '', (v) => saveNote(id, v), { rows: 12 }) : null;
}

const saveNote = debounce((id, v) => S.as('detail', () => S.updateNode(id, { note: v })), 350);
const saveCues = debounce((id, v) => S.as('detail', () => S.updateNode(id, { cues: v.split('\n').map((x) => x.trim()).filter(Boolean) })), 350);
const saveTitle = debounce((id, v) => S.as('detail', () => S.updateNode(id, { title: v })), 300);

function onDetailInput(e) {
  const t = e.target;
  if (!sel) return;
  if (t.matches('.d-cues')) saveCues(sel, t.value);
  else if (t.matches('.d-title')) {
    saveTitle(sel, t.value);
    const ri = rowOf(sel)?.querySelector('.otitle');
    if (ri) ri.value = t.value;
  }
}

async function onDetailClick(e) {
  const b = e.target.closest('[data-act],[data-sel]');
  if (!b) {
    const wl = e.target.closest('.wikilink');
    if (wl) { const id = S.findByTitle(wl.dataset.link); if (id) show(id); else toast('그 제목의 갈래가 없어요'); }
    return;
  }
  if (b.dataset.sel) return show(b.dataset.sel);
  const n = S.node(sel);
  switch (b.dataset.act) {
    case 'close': el.classList.remove('detail-open'); return;
    case 'star': S.as('outline', () => S.updateNode(sel, { star: !n.star })); render(); return;
    case 'edit': if (preview) { flushDetail(); preview = false; lsSet('galrae.v1.notePreview', false); renderDetail(); noteEd?.focus(); } return;
    case 'preview': flushDetail(); preview = true; lsSet('galrae.v1.notePreview', true); return renderDetail();
    case 'add-child': return addChild(sel);
    case 'train': return api.train(sel);
    case 'graph': return api.go('graph', sel);
    case 'export': return api.exportDialog(sel);
    case 'dup': { const id = S.as('outline', () => S.duplicate(sel)); show(id); toast('복제했어요'); return; }
    case 'del': return remove(sel);
    case 'move': {
      const to = await pickParent(sel);
      if (to === undefined) return;
      S.as('outline', () => S.moveNode(sel, to));
      show(sel);
      toast('이동했어요');
    }
  }
}

function flushDetail() {
  saveNote.cancel(); saveCues.cancel(); saveTitle.cancel();
  const cu = $('.d-cues', el), ti = $('.d-title', el);
  const n = S.node(sel);
  if (!n) return;
  const patch = {};
  if (noteEd && document.contains(noteEd.rich)) { const v = noteEd.value(); if (v !== (n.note || '')) patch.note = v; }
  if (cu) { const c = cu.value.split('\n').map((x) => x.trim()).filter(Boolean); if (c.join('\n') !== (n.cues || []).join('\n')) patch.cues = c; }
  if (ti && ti.value !== n.title) patch.title = ti.value;
  if (Object.keys(patch).length) S.as('detail', () => S.updateNode(sel, patch));
}

// 이동할 상위 갈래 고르기. 취소하면 undefined, 최상위는 null
export function pickParent(id) {
  const banned = new Set(id ? S.descendants(id) : []);
  const list = (q) => {
    const ids = q ? S.search(q, 80) : S.descendants(null).slice(0, 300);
    return ids.filter((x) => !banned.has(x)).map((x) => {
      const p = S.path(x);
      return `<button class="pick-row" data-to="${x}" style="--d:${q ? 0 : p.length - 1}"><b>${esc(p[p.length - 1].title || '제목 없음')}</b>${q ? `<small>${p.slice(0, -1).map((y) => esc(y.title)).join(' › ')}</small>` : ''}</button>`;
    }).join('');
  };
  return openDialog(`<div class="dlg-body">
    <p class="dlg-msg">어디로 옮길까요?</p>
    <input class="input" placeholder="검색" type="search">
    <div class="pick-list"><button class="pick-row" data-to="">⌂ 최상위 (새 과목으로)</button><div class="pl">${list('')}</div></div>
    <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button></div></div>`, {
    onMount(d, close) {
      const inp = d.querySelector('input');
      inp.focus();
      inp.addEventListener('input', () => { d.querySelector('.pl').innerHTML = list(inp.value.trim()); });
      d.querySelector('.pick-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-to]');
        if (b) close(b.dataset.to || '__root');
      });
    },
  }).then((v) => (v == null ? undefined : v === '__root' ? null : v));
}
