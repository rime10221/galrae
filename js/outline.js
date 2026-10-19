// 정리(트리) + 상세 패널
// 한 번 누르면 선택, ✎ · 더블클릭 · F2 로 이름 바꾸기, ＋ 로 하위 추가
// 선택한 상태에서: ↑↓ 이동 · ←→ 접기/펼치기 · Enter/F2 이름 · Tab 같은 레벨 다음(없으면 새 항목) · Alt+←→ 내어/들여쓰기 · Alt+↑↓ 순서 · Delete 삭제
// ⠿ 를 끌어서 순서 바꾸기 (줄 위/아래에 놓으면 그 앞/뒤, 가운데에 놓으면 그 갈래의 하위로)
import * as S from './store.js';
import * as Ed from './editor.js';
import * as Zoom from './zoom.js';
import * as Subject from './subject.js';
import { $, $$, esc, debounce, renderMd, firstLine, lsGet, lsSet, composing, toast, confirmDlg, openDialog, promptDlg } from './util.js';

let el, api;
let sel = null;          // 선택한(상세 패널에 열린) 노드
let editingId = null;    // 이름을 고치고 있는 노드
let editingNew = false;  // 방금 만든 노드인지 (비워 두면 지운다)
let filter = '';
let noteEd = null; // 상세 패널의 외울 것 편집기
// 외울 것 읽기/편집: 내용이 있으면 갈래를 열 때마다 읽기부터 (편집 버튼을 눌러야 편집)
let preview = true;
let modeFor = null;
// 상세의 외울 것 칸: 접으면 버튼 한 줄, 펼치면 크게 (기본은 접힘)
let noteOpen = lsGet('galrae.v1.noteOpen', false);
const setNoteOpen = (v) => { noteOpen = v; lsSet('galrae.v1.noteOpen', v); };
// 트리에서 외울 것을 줄 아래에 펼쳐 보기 (갈래마다 토글, 기본은 접힘)
let notesOpen = new Set(lsGet('galrae.v1.notesOpen', []));
const saveNotesOpen = () => lsSet('galrae.v1.notesOpen', [...notesOpen]);
let collapsed = new Set(lsGet('galrae.v1.collapsed', []));
const saveCollapsed = () => lsSet('galrae.v1.collapsed', [...collapsed]);
const narrow = () => matchMedia('(max-width: 860px)').matches;

export function init(root, hooks) {
  el = root;
  api = hooks;
  el.innerHTML = `<div class="tree-wrap">
    <div class="tree-main">
      <header class="tree-h"><h1>정리</h1><span class="muted small" id="treeStat"></span></header>
      <div class="toolbar">
        <input class="input search" id="treeFilter" placeholder="갈래 · 내용 검색" type="search">
        <div class="tb-btns">
          <button class="btn small" data-act="notes" id="notesBtn" title="모든 외울 것 펼치기/접기">외울 것 모두 펼치기</button>
          <button class="btn small" data-act="expand-all" title="모두 펼치기">펼치기</button>
          <button class="btn small" data-act="collapse-all" title="모두 접기">접기</button>
          <button class="btn small" data-act="import">가져오기</button>
          <button class="btn small" data-act="export">내보내기</button>
        </div>
      </div>
      <div id="subjTabs"></div>
      <div class="olist" id="olist" tabindex="0"></div>
      <p class="tree-help muted small">누르면 선택 · ⠿ 끌어서 순서 바꾸기 · ✎/더블클릭/F2 이름 바꾸기 · ＋ 하위 추가 · 🗑 삭제 · ↑↓ 이동 · ←→ 접기/펼치기 · Tab 같은 레벨 다음 항목(마지막이면 새 항목) · Alt+←→ 내어/들여쓰기 · Alt+↑↓ 순서</p>
    </div>
    <aside class="detail" id="detail"></aside>
    <div class="otools" id="otools">
      <button data-tool="outdent" title="내어쓰기">⇤</button><button data-tool="indent" title="들여쓰기">⇥</button>
      <button data-tool="up" title="위로">↑</button><button data-tool="down" title="아래로">↓</button>
      <button data-tool="rename" title="이름 바꾸기">✎</button><button data-tool="add" title="아래에 새 항목">＋</button>
      <button data-tool="child" title="하위 항목">↳</button><button data-tool="open" title="외울 것 열기">≡</button><button data-tool="del" title="삭제">🗑</button>
    </div>
  </div>`;
  const list = $('#olist', el);
  list.addEventListener('click', onListClick);
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.orow');
    if (row && !e.target.closest('button,input')) startEdit(row.dataset.id);
  });
  list.addEventListener('keydown', onKey);
  list.addEventListener('pointerdown', onGripDown);
  // 다른 곳을 누르면 이름 저장 (다시 그리면서 사라진 입력칸의 blur 는 무시)
  list.addEventListener('focusout', (e) => {
    if (!e.target.matches('.otitle')) return;
    const id = e.target.closest('.orow')?.dataset.id;
    setTimeout(() => { if (editingId === id && e.target.isConnected && document.activeElement !== e.target) finishEdit(true); }, 0);
  });
  $('#otools', el).addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-tool]'); if (b) { e.preventDefault(); tool(b.dataset.tool); } });
  $('.toolbar', el).addEventListener('click', onToolbar);
  // 과목 탭: 누르면 그 과목만 보기 (과목 자체가 선택되어 상세에 열린다)
  $('#subjTabs', el).addEventListener('click', (e) => {
    const t = e.target.closest('[data-subject],[data-act="add-root"]');
    if (!t) return;
    if (t.dataset.act === 'add-root') return addRoot();
    Subject.set(t.dataset.subject);
    $('#olist', el).scrollTo({ top: 0, left: 0 });
    select(t.dataset.subject);
  });
  // 창 크기가 바뀌어 목록이 좁아지면 보고 있던 줄의 제목이 보이도록 옆으로 맞춘다
  new ResizeObserver(() => { const r = sel && rowOf(sel); if (r) revealX(r); }).observe(list);
  $('#treeFilter', el).addEventListener('input', debounce((e) => { filter = e.target.value.trim(); renderList(); }, 150));
  const det = $('#detail', el);
  det.addEventListener('click', onDetailClick);
  det.addEventListener('input', onDetailInput);
}

export function show(id) {
  flushDetail();
  if (id && S.node(id)) {
    Subject.set(id);
    for (const n of S.path(id).slice(0, -1)) collapsed.delete(n.id);
    saveCollapsed();
    sel = id;
  }
  render();
  if (id) {
    el.classList.add('detail-open');
    requestAnimationFrame(() => rowOf(id)?.scrollIntoView({ block: 'center' }));
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
  // 이름 고치는 중이거나 상세에서 입력 중이면 목록만 (입력칸 유지)
  const a = document.activeElement;
  const det = $('#detail', el);
  if (editingId) return;
  if (a && det.contains(a) && a.matches('input,textarea,[contenteditable]')) return renderList();
  render();
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
  if (editingId && !S.node(editingId)) editingId = null;
  el.classList.toggle('has-sel', !!sel);
  const nb = $('#notesBtn', el);
  if (nb) { const w = S.descendants(null).filter((x) => S.node(x).note?.trim()); const all = w.length && w.every((x) => notesOpen.has(x)); nb.textContent = all ? '외울 것 모두 접기' : '외울 것 모두 펼치기'; nb.classList.toggle('primary', !!all); }
  const all = S.descendants(null);
  $('#treeStat', el).textContent = `갈래 ${all.length} · 외울 것 ${all.filter((x) => S.node(x).note?.trim()).length}`;
  const ms = matchSet();
  const mm = S.masteryMap();
  // 과목은 탭으로 나누고, 고른 과목의 하위만 목록에 (검색 중에는 모든 과목)
  let subj = Subject.current();
  if (sel && S.node(sel) && !filter && S.rootOf(sel) !== subj) { Subject.set(sel); subj = S.rootOf(sel); }
  $('#subjTabs', el).innerHTML = filter ? '' : Subject.tabsHtml(subj, { add: true });
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
    const editing = id === editingId;
    rows.push(`<div class="orow ${id === sel ? 'sel' : ''} ${editing ? 'editing-row' : ''} d${Math.min(d, 4)}" data-id="${id}" style="--d:${d}">
      <button class="caret ${kids.length ? (closed ? '' : 'open') : 'leaf'}" data-act="toggle" tabindex="-1" aria-label="펼치기"></button>
      <button class="bullet ${closed && kids.length ? 'has' : ''}" data-act="open" tabindex="-1" aria-label="외울 것 열기"></button>
      ${editing
        ? `<input class="otitle" value="${esc(n.title)}" placeholder="제목" enterkeyhint="done" autocomplete="off">`
        : `<span class="otext ${n.title ? '' : 'empty'}">${esc(n.title || '제목 없음')}</span>`}
      <span class="ometa">${meta}</span>
      ${editing ? '' : `<span class="oacts"><button data-act="grip" class="grip" tabindex="-1" title="끌어서 순서 바꾸기 (Alt+↑↓)">⠿</button><button data-act="add-child" tabindex="-1" title="하위 항목 추가">＋</button><button data-act="rename" tabindex="-1" title="이름 바꾸기 (F2 · 더블클릭)">✎</button><button data-act="delete" class="del" tabindex="-1" title="삭제 (Delete)">🗑</button></span>`}
    </div>`);
    if (notesOpen.has(id) && n.note?.trim()) rows.push(`<div class="onote md" data-note="${id}" style="--d:${d}">${renderMd(n.note)}</div>`);
    if (!closed) for (const k of kids) walk(k, d + 1);
  };
  if (filter) S.roots().forEach((r) => walk(r, 0));
  else if (subj) S.children(subj).forEach((k) => walk(k, 0));
  list.innerHTML = rows.join('') || (filter
    ? '<p class="empty muted">검색 결과가 없어요</p>'
    : subj
      ? `<div class="empty"><p>'${esc(S.node(subj).title || '제목 없음')}'에 아직 하위 갈래가 없어요.</p><button class="btn primary" data-act="add-first">+ 첫 항목 추가</button></div>`
      : `<div class="empty"><p>아직 갈래가 없어요.</p><button class="btn primary" data-act="add-root">+ 첫 과목 만들기</button> <button class="btn" data-act="import">텍스트로 한 번에 가져오기</button></div>`);
  if (editingId) {
    const inp = rowOf(editingId)?.querySelector('.otitle');
    if (inp) { inp.focus(); inp.select(); }
  }
}

const rowOf = (id) => $(`.orow[data-id="${id}"]`, el);
const visibleIds = () => $$('.orow', el).map((r) => r.dataset.id);
// 선택 줄로 키보드 포커스 (화면 밖이면 스크롤)
function focusList(id = sel) {
  const r = id && rowOf(id);
  if (r) { r.scrollIntoView({ block: 'nearest', inline: 'nearest' }); revealX(r); }
  if (!editingId && !narrow()) $('#olist', el).focus({ preventScroll: true });
}

// 목록이 좁아 제목이 잘리면, 그 줄의 레벨(들여쓰기)만큼 옆으로 밀어서 제목이 보이게
function revealX(r) {
  const list = $('#olist', el);
  if (list.scrollWidth <= list.clientWidth + 1) { if (list.scrollLeft) list.scrollLeft = 0; return; }
  const t = r.querySelector('.otext, .otitle');
  if (!t) return;
  const lb = list.getBoundingClientRect(), tb = t.getBoundingClientRect();
  const x = tb.left - lb.left + list.scrollLeft;
  const lead = 40; // 접기 화살표·점이 보이도록 조금 앞에서
  if (x - lead >= list.scrollLeft && x + tb.width <= list.scrollLeft + list.clientWidth) return;
  list.scrollTo({ left: Math.max(0, x - lead), behavior: 'smooth' });
}

// ---------- 선택 / 이름 바꾸기 ----------
function select(id, { open = false } = {}) {
  if (editingId && editingId !== id) finishEdit(true);
  if (sel !== id) flushDetail();
  sel = id;
  renderList();
  renderDetail();
  if (open) el.classList.add('detail-open');
  focusList(id);
}

function startEdit(id, isNew = false) {
  if (!S.node(id)) return;
  if (editingId && editingId !== id) finishEdit(true);
  editingId = id;
  editingNew = isNew;
  if (sel !== id) { flushDetail(); sel = id; renderDetail(); }
  renderList();
}

// save: 입력한 이름 저장 / 취소. next: 이어서 아래에 새 항목
function finishEdit(save, { next = false } = {}) {
  const id = editingId;
  if (!id) return;
  const inp = rowOf(id)?.querySelector('.otitle');
  const n = S.node(id);
  const value = inp ? inp.value.trim() : n?.title;
  editingId = null;
  const wasNew = editingNew;
  editingNew = false;
  if (n && wasNew && !value) {
    // 새로 만들었다가 비워 두면 지운다
    S.as('outline', () => S.deleteNode(id));
    sel = S.parentOf(id) || null;
    renderList(); renderDetail(); focusList();
    return;
  }
  if (n && save && value !== n.title) S.as('outline', () => S.updateNode(id, { title: value }));
  renderList();
  renderDetail();
  if (next && wasNew && value) return addAfter(id);
  focusList(id);
}

// 구조 변경 후 다시 그리고 선택 유지
function structural(fn, keepId) {
  if (editingId) finishEdit(true);
  const r = S.as('outline', fn);
  renderList();
  renderDetail();
  focusList(keepId ?? sel);
  return r;
}

// 같은 레벨에서 앞/뒤 항목으로. 뒤가 없으면 같은 레벨에 새 항목 추가 (edit: 다음 항목도 바로 이름 고치기)
function stepSibling(id, dir, { edit = false } = {}) {
  const sibs = S.children(S.parentOf(id));
  const j = sibs.indexOf(id) + dir;
  if (j < 0) return;
  if (j >= sibs.length) return addAfter(id);
  if (edit) return startEdit(sibs[j]);
  select(sibs[j]);
}

function addAfter(id) {
  const p = S.parentOf(id);
  const nid = S.as('outline', () => S.addNode({ parent: p, index: S.children(p).indexOf(id) + 1 }));
  startEdit(nid, true);
  return nid;
}

function addChild(id) {
  collapsed.delete(id); saveCollapsed();
  const nid = S.as('outline', () => S.addNode({ parent: id }));
  startEdit(nid, true);
  return nid;
}

async function remove(id, { quiet = false } = {}) {
  const n = S.node(id);
  if (!n) return false;
  const total = S.descendants(id).length;
  if (!quiet && !(await confirmDlg(`'${n.title || '제목 없음'}'${total > 1 ? ` 과 하위 ${total - 1}개` : ''}를 삭제할까요?`, { ok: '삭제', danger: true }))) return false;
  const vis = visibleIds();
  const i = vis.indexOf(id);
  const ids = S.as('outline', () => S.deleteNode(id));
  const next = vis.slice(i + 1).find((x) => S.node(x)) || vis.slice(0, i).reverse().find((x) => S.node(x)) || null;
  if (sel && ids.includes(sel)) { sel = next; el.classList.remove('detail-open'); }
  renderList();
  renderDetail();
  focusList();
  toast(`삭제했어요${ids.length > 1 ? ` (${ids.length}개)` : ''}`, { action: '되돌리기', onAction: () => { S.restore(ids); render(); } });
  return true;
}

function toggle(id, open) {
  const want = open ?? collapsed.has(id);
  if (want) collapsed.delete(id); else collapsed.add(id);
  saveCollapsed();
  renderList();
  focusList();
}

function openDetail(id) {
  select(id, { open: true });
}

function onListClick(e) {
  const nt = e.target.closest('[data-note]');
  if (nt) return openDetail(nt.dataset.note);
  const b = e.target.closest('[data-act]');
  const row = e.target.closest('.orow');
  if (b) {
    if (b.dataset.act === 'add-root') return addRoot();
    if (b.dataset.act === 'add-first') return addChild(Subject.current());
    if (b.dataset.act === 'import') return api.importDialog(null);
    const id = row?.dataset.id;
    if (!id) return;
    switch (b.dataset.act) {
      case 'grip': return;
      case 'toggle': return toggle(id);
      case 'note': notesOpen.has(id) ? notesOpen.delete(id) : notesOpen.add(id); saveNotesOpen(); return renderList();
      case 'open': return openDetail(id);
      case 'rename': return startEdit(id);
      case 'add-child': return addChild(id);
      case 'delete': return remove(id);
    }
    return;
  }
  if (!row || e.target.closest('input')) return;
  const id = row.dataset.id;
  // 휴대폰: 이미 선택한 줄을 한 번 더 누르면 외울 것 열기
  if (narrow() && sel === id) return openDetail(id);
  select(id);
}

// ---------- 끌어서 순서 바꾸기 ----------
function scrollParent(n) {
  for (; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}

function onGripDown(e) {
  const g = e.target.closest('[data-act="grip"]');
  if (!g || e.button > 0) return;
  e.preventDefault();
  const list = $('#olist', el);
  const id = g.closest('.orow').dataset.id;
  if (editingId) finishEdit(true);
  const own = new Set(S.descendants(id));
  const sc = scrollParent(list);
  const line = document.createElement('div');
  line.className = 'drop-line';
  line.hidden = true;
  document.body.append(line);
  rowOf(id)?.classList.add('dragging');
  for (const k of own) if (k !== id) rowOf(k)?.classList.add('drag-kid');
  el.classList.add('is-dragging');
  let drop = null, lastY = e.clientY, timer = 0;
  const mark = () => {
    $$('.orow.drop-in', el).forEach((r) => r.classList.remove('drop-in'));
    const rows = $$('.orow', el).filter((r) => !own.has(r.dataset.id));
    drop = null;
    line.hidden = true;
    if (!rows.length) return;
    // 손가락 아래 줄 (위·아래로 벗어나면 맨 처음/끝 줄)
    let t = rows.find((r) => { const b = r.getBoundingClientRect(); return lastY < b.bottom; }) || rows[rows.length - 1];
    const b = t.getBoundingClientRect();
    const f = (lastY - b.top) / b.height;
    const pos = f < 0.3 ? 'before' : f > 0.7 ? 'after' : 'inside';
    drop = { target: t.dataset.id, pos };
    if (pos === 'inside') { t.classList.add('drop-in'); return; }
    const d = +t.style.getPropertyValue('--d') + (pos === 'after' && S.children(drop.target).length && !collapsed.has(drop.target) ? 1 : 0);
    const lb = list.getBoundingClientRect();
    const left = lb.left + d * (narrow() ? 16 : 22) + 30;
    line.hidden = false;
    line.style.left = left + 'px';
    line.style.width = Math.max(40, lb.right - left - 8) + 'px';
    line.style.top = (pos === 'before' ? b.top : b.bottom) - 1.5 + 'px';
  };
  // 위·아래 끝에 가까우면 저절로 스크롤
  const tick = () => {
    const box = sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    const v = lastY < box.top + 60 ? -1 : lastY > box.bottom - 120 ? 1 : 0;
    if (v) { sc.scrollBy(0, v * 12); mark(); }
    timer = requestAnimationFrame(tick);
  };
  const move = (ev) => { lastY = ev.clientY; mark(); };
  const end = (ev) => {
    cancelAnimationFrame(timer);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', end);
    removeEventListener('pointercancel', end);
    line.remove();
    el.classList.remove('is-dragging');
    $$('.orow.dragging,.orow.drag-kid,.orow.drop-in', el).forEach((r) => r.classList.remove('dragging', 'drag-kid', 'drop-in'));
    if (ev.type === 'pointercancel' || !drop || drop.target === id) return;
    const { target, pos } = drop;
    const p = S.parentOf(target);
    const sibs = S.children(p).filter((x) => x !== id);
    sel = id;
    structural(() => {
      if (pos === 'inside') { collapsed.delete(target); saveCollapsed(); return S.moveNode(id, target, S.children(target).filter((x) => x !== id).length); }
      if (pos === 'after' && S.children(target).length && !collapsed.has(target)) return S.moveNode(id, target, 0);
      return S.moveNode(id, p, sibs.indexOf(target) + (pos === 'after' ? 1 : 0));
    }, id);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
  timer = requestAnimationFrame(tick);
  mark();
}

function onKey(e) {
  if (composing(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  // 이름 고치는 중
  if (e.target.matches('.otitle')) {
    const id = editingId;
    if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, { next: !mod }); }
    else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const wasNew = editingNew, empty = !e.target.value.trim();
      finishEdit(true);
      if (wasNew && empty) return;
      if (e.shiftKey) return stepSibling(id, -1);
      return stepSibling(id, 1, { edit: true });
    }
    return;
  }
  // 선택한 줄 조작
  if (!sel || e.target !== $('#olist', el)) return;
  const vis = visibleIds();
  const i = vis.indexOf(sel);
  const go = (j) => { if (j >= 0 && j < vis.length) { e.preventDefault(); select(vis[j]); } };
  switch (e.key) {
    case 'ArrowUp': if (e.altKey) { e.preventDefault(); return structural(() => S.moveBy(sel, -1)); } return go(i - 1);
    case 'ArrowDown': if (e.altKey) { e.preventDefault(); return structural(() => S.moveBy(sel, 1)); } return go(i + 1);
    case 'ArrowLeft':
      e.preventDefault();
      if (e.altKey) return structural(() => S.outdent(sel));
      if (S.children(sel).length && !collapsed.has(sel)) return toggle(sel, false);
      if (S.parentOf(sel)) return select(S.parentOf(sel));
      return;
    case 'ArrowRight':
      e.preventDefault();
      if (e.altKey) return structural(() => { const np = S.indent(sel); if (np) { collapsed.delete(np); saveCollapsed(); } });
      if (S.children(sel).length && collapsed.has(sel)) return toggle(sel, true);
      return go(i + 1);
    case 'F2': case 'Enter':
      e.preventDefault();
      if (mod) return openDetail(sel);
      return startEdit(sel);
    case 'Tab':
      // 같은 레벨 다음 항목 선택, 마지막이면 같은 레벨에 새 항목 (Shift+Tab 은 이전 항목)
      e.preventDefault();
      return stepSibling(sel, e.shiftKey ? -1 : 1);
    case 'Delete': e.preventDefault(); return remove(sel);
    case 'Insert': e.preventDefault(); return addChild(sel);
    case 'Escape': sel = null; renderList(); renderDetail(); return;
  }
}

function tool(name) {
  const id = editingId || sel;
  if (!id) return toast('먼저 항목을 하나 눌러 선택하세요');
  switch (name) {
    case 'outdent': return structural(() => S.outdent(id), id);
    case 'indent': return structural(() => { const np = S.indent(id); if (np) { collapsed.delete(np); saveCollapsed(); } }, id);
    case 'up': return structural(() => S.moveBy(id, -1), id);
    case 'down': return structural(() => S.moveBy(id, 1), id);
    case 'rename': return startEdit(id);
    case 'add': if (editingId) finishEdit(true); return addAfter(id);
    case 'child': if (editingId) finishEdit(true); return addChild(id);
    case 'open': if (editingId) finishEdit(true); return openDetail(id);
    case 'del': return remove(id);
  }
}

// 새 과목: 이름을 묻고 그 과목 탭으로
async function addRoot() {
  const name = await promptDlg('새 과목 이름', '', '예) 내과');
  if (!name) return;
  filter = '';
  $('#treeFilter', el).value = '';
  const nid = S.as('outline', () => S.addNode({ parent: null, title: name }));
  Subject.set(nid);
  select(nid);
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
  // 외울 것을 펼치면 상세 패널을 넓게 (화면이 좁을수록 상세 쪽 비율을 키운다)
  $('.tree-wrap', el).classList.toggle('note-wide', !!n && noteOpen);
  if (!n) {
    det.innerHTML = `<div class="d-empty muted"><p>왼쪽 항목의 <b>●</b>를 누르면<br>외울 것을 읽고 편집할 수 있어요.</p></div>`;
    return;
  }
  if (modeFor !== sel) { modeFor = sel; preview = !!(n.note || '').trim(); }
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
    ${!noteOpen ? noteButton(n) : `<div class="d-field note-main">
      <div class="d-label note-head"><span>외울 것</span>
        <button class="btn ghost small" data-act="note-close" title="외울 것 접기">접기 ▴</button>
        ${preview && (n.note || '').trim() ? Zoom.ctlHtml() : `<span class="save-state" id="saveState">${preview ? '' : '자동 저장돼요'}</span>`}
        <div class="seg tiny"><button class="${preview ? '' : 'on'}" data-act="edit">편집</button><button class="${preview ? 'on' : ''}" data-act="preview">보기</button></div>
        <button class="icon-btn small" data-act="full" title="크게 보기">${$('#detail', el).classList.contains('note-full') ? '✕' : '⤢'}</button>
        ${preview ? '' : '<button class="btn primary small" data-act="save" title="저장 (Ctrl+S)">저장</button>'}</div>
      ${preview
        ? ((n.note || '').trim()
          ? `<div class="note-view pz"><div class="pz-in md big">${renderMd(n.note)}</div></div>`
          : '<div class="md big note-view" data-act="edit"><span class="muted">비어 있어요. 눌러서 외울 것을 적어 보세요 (사진도 넣을 수 있어요)</span></div>')
        : `<div class="d-note-host"></div>`}
    </div>`}
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
  noteEd = host ? Ed.mount(host, n.note || '', (v) => { saveState('dirty'); saveNote(id, v); }, { rows: 16, onSave: () => saveNow(true) }) : null;
}

// 접힌 외울 것: 버튼 한 줄 (내용이 있는지 한눈에)
function noteButton(n) {
  const note = (n.note || '').trim();
  const lines = note ? note.split('\n').filter((l) => l.trim() && !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(l)).length : 0;
  const pics = (note.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
  const info = note ? [lines ? `${lines}줄` : '', pics ? `사진 ${pics}` : ''].filter(Boolean).join(' · ') : '아직 없어요';
  return `<button class="note-toggle ${note ? 'has' : ''}" data-act="note-open" title="외울 것 펼치기">
    <span class="nt-ic">${note ? '📝' : '＋'}</span>
    <span class="nt-main"><b>${note ? '외울 것' : '외울 것 추가'}</b><small>${esc(info)}${note ? ` — ${esc(firstLine(note).slice(0, 40))}` : ''}</small></span>
    <em>펼치기 ▾</em></button>`;
}

const saveNote = debounce((id, v) => { S.as('detail', () => S.updateNode(id, { note: v })); saveState('saved'); }, 600);

// 저장 상태 표시: 바뀌면 '저장 중…', 저장되면 '저장됨 ✓'
function saveState(s) {
  const box = $('#saveState', el);
  if (!box) return;
  box.dataset.s = s;
  box.textContent = s === 'dirty' ? '저장 중…' : s === 'saved' ? '저장됨 ✓' : '';
}

// 저장 버튼 / Ctrl+S: 바로 저장 (버튼은 저장 후 읽기 화면으로)
function saveNow(stay = false) {
  flushDetail();
  saveState('saved');
  toast('저장했어요', { ms: 1200 });
  if (!stay) { preview = true; renderDetail(); }
}
const saveCues = debounce((id, v) => S.as('detail', () => S.updateNode(id, { cues: v.split('\n').map((x) => x.trim()).filter(Boolean) })), 350);
const saveTitle = debounce((id, v) => S.as('detail', () => S.updateNode(id, { title: v })), 300);

function onDetailInput(e) {
  const t = e.target;
  if (!sel) return;
  if (t.matches('.d-cues')) saveCues(sel, t.value);
  else if (t.matches('.d-title')) {
    saveTitle(sel, t.value);
    const ri = rowOf(sel)?.querySelector('.otext');
    if (ri) { ri.textContent = t.value || '제목 없음'; ri.classList.toggle('empty', !t.value); }
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
    case 'edit': if (preview) { flushDetail(); preview = false; renderDetail(); noteEd?.focus(); } return;
    case 'preview': flushDetail(); preview = true; return renderDetail();
    case 'note-open':
      setNoteOpen(true);
      // 비어 있으면 바로 쓰기, 있으면 읽기부터
      preview = !!(n.note || '').trim();
      renderDetail();
      if (!preview) noteEd?.focus();
      return;
    case 'note-close':
      flushDetail();
      setNoteOpen(false);
      $('#detail', el).classList.remove('note-full');
      return renderDetail();
    case 'save': return saveNow();
    case 'full': {
      const det = $('#detail', el);
      det.classList.toggle('note-full');
      b.textContent = det.classList.contains('note-full') ? '✕' : '⤢';
      return;
    }
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