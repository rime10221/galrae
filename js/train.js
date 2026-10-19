// 트레이닝: Quizlet식 암기카드
// 레벨(·범위)을 고르면 그 레벨의 갈래가 카드로 나온다.
// 앞면 = 갈래 이름, 뒷면 = 외울 것(있으면) 또는 하위 갈래 목록. 몰라요 / 알아요로 넘긴다.
import * as S from './store.js';
import { $, esc, shuffle, renderMd, lsGet, lsSet, now, confirmDlg, toast } from './util.js';

const SESSION_KEY = 'galrae.v2.session';
const PKEY = (id) => `${id}|card`;

const DEFAULT_OPTS = { scope: [], levels: [], shuffle: true, unknownOnly: false };
let opts = { ...DEFAULT_OPTS, ...(S.settings.cardOpts || {}) };
let session = lsGet(SESSION_KEY, null);
let el = null;
let api = {};
let scopeOpen = new Set(lsGet('galrae.v1.scopeOpen', []));

export const hasSession = () => !!(session && !session.done && session.i < session.cards.length);
export const sessionInfo = () => session;

export function init(root, hooks) {
  el = root;
  api = hooks;
  el.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  bindSwipe();
}

const saveOpts = () => S.saveSettings({ cardOpts: opts });
const persist = () => lsSet(SESSION_KEY, session);

// ---------- 카드 ----------
// 뒷면에 보여줄 게 있는 갈래만 카드가 된다
const hasBack = (id) => !!(S.node(id).note || '').trim() || S.children(id).length > 0;

export function scopeIds(o = opts) {
  const all = S.descendants(null);
  const sc = (o.scope || []).filter((x) => S.node(x));
  if (!sc.length) return all;
  const set = new Set();
  for (const s of sc) for (const x of S.descendants(s)) set.add(x);
  return all.filter((x) => set.has(x));
}

export function buildDeck(o = opts) {
  let ids = scopeIds(o).filter(hasBack);
  if (o.levels?.length) ids = ids.filter((x) => o.levels.includes(S.depth(x)));
  if (o.unknownOnly) ids = ids.filter((x) => { const p = S.prog(PKEY(x)); return !p || p.b <= 1; });
  return o.shuffle ? shuffle(ids) : ids;
}

// 레벨별 카드 수 (범위 안에서)
export function levelCounts(scope) {
  const m = new Map();
  for (const x of scopeIds({ scope })) if (hasBack(x)) m.set(S.depth(x), (m.get(S.depth(x)) || 0) + 1);
  return m;
}

// 홈 등에서 바로 시작
export function start(scope, levels) {
  opts = { ...opts, scope: scope || [], levels: levels || [] };
  saveOpts();
  const cards = buildDeck();
  if (!cards.length) { toast('이 레벨에는 카드로 만들 갈래가 없어요'); return false; }
  begin(cards);
  return true;
}

export function discardSession() { session = null; persist(); }
export function setScope(id) { opts.scope = id ? [id] : []; opts.levels = []; saveOpts(); }

function begin(cards, title) {
  session = { cards, i: 0, flipped: false, known: [], unknown: [], hist: [], opts: { ...opts }, title: title || deckTitle(), started: now(), done: false };
  persist();
  api.go('train');
  render();
}

function deckTitle(o = opts) {
  const sc = (o.scope || []).map((x) => S.node(x)?.title).filter(Boolean).join(', ') || '전체';
  const lv = o.levels?.length ? ' · ' + o.levels.map((d) => S.levelName(d)).join(', ') : '';
  return sc + lv;
}

// ---------- 렌더 ----------
export function render() {
  if (!el) return;
  if (session && !session.done) {
    while (session.i < session.cards.length && !S.node(session.cards[session.i])) session.cards.splice(session.i, 1);
    if (session.i >= session.cards.length) { session.done = session.cards.length > 0; persist(); }
  }
  if (session?.done) renderSummary();
  else if (session && session.i < session.cards.length) renderCard();
  else renderSetup();
}

function renderSetup() {
  const counts = levelCounts(opts.scope);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  const n = buildDeck({ ...opts, shuffle: false }).length;
  el.innerHTML = `<div class="page narrow">
    <header class="page-h"><div><h1>카드 학습</h1><p class="sub">레벨을 고르면 그 레벨의 갈래가 카드로 나와요</p></div></header>
    <section class="panel">
      <h3>레벨</h3>
      <div class="level-list">${levels.map((d) => `<button class="level-btn ${opts.levels.includes(d) ? 'on' : ''}" data-level="${d}">
        <span><b>${esc(S.levelName(d))}</b><small>Lv${d}</small></span><em>${counts.get(d)}장</em></button>`).join('') || '<p class="muted">트리에서 갈래를 먼저 만들어 주세요.</p>'}</div>
      <p class="muted small">여러 개 고를 수 있어요. 안 고르면 모든 레벨.</p>
    </section>
    <section class="panel">
      <div class="panel-h"><h3>범위</h3>${opts.scope.length ? '<button class="link" data-act="scope-all">전체로</button>' : '<span class="muted small">전체</span>'}</div>
      <div class="scope-tree">${scopeTree()}</div>
    </section>
    <section class="panel">
      <label class="check"><span>카드 섞기</span><input type="checkbox" data-opt="shuffle" ${opts.shuffle ? 'checked' : ''}></label>
      <label class="check"><span>모르는 카드만</span><input type="checkbox" data-opt="unknownOnly" ${opts.unknownOnly ? 'checked' : ''}></label>
    </section>
    <div class="start-bar">
      <span class="deck-n"><b>${n}</b>장</span>
      <button class="btn primary big" data-act="start" ${n ? '' : 'disabled'}>학습 시작</button>
    </div>
  </div>`;
}

function scopeTree() {
  const sel = new Set(opts.scope);
  const rows = [];
  const walk = (id, d, implied) => {
    const n = S.node(id);
    const kids = S.children(id);
    const on = sel.has(id);
    const open = scopeOpen.has(id);
    rows.push(`<div class="srow" style="--d:${d}">
      ${kids.length ? `<button class="caret ${open ? 'open' : ''}" data-sopen="${id}"></button>` : '<span class="caret leaf"></span>'}
      <label class="${implied ? 'implied' : ''}"><input type="checkbox" data-scope="${id}" ${on || implied ? 'checked' : ''} ${implied ? 'disabled' : ''}>
      <span>${esc(n.title || '(제목 없음)')}</span></label></div>`);
    if (open) for (const k of kids) walk(k, d + 1, implied || on);
  };
  S.roots().forEach((r) => walk(r, 0, false));
  return rows.join('') || '<p class="muted">갈래가 없어요</p>';
}

function backHtml(id) {
  const n = S.node(id);
  const kids = S.children(id);
  const note = (n.note || '').trim();
  const list = kids.length ? `<ol class="kid-list">${kids.map((k) => `<li>${esc(S.node(k).title || '제목 없음')}</li>`).join('')}</ol>` : '';
  if (note) {
    return `<div class="md big">${renderMd(note)}</div>${list ? `<div class="back-sub"><h4>하위 ${kids.length}</h4>${list}</div>` : ''}`;
  }
  return `<h4 class="back-h">하위 갈래 ${kids.length}</h4>${list}`;
}

function renderCard() {
  const s = session;
  const id = s.cards[s.i];
  const n = S.node(id);
  const p = S.path(id);
  const crumbs = p.slice(0, -1).map((x) => esc(x.title)).join(' <i>›</i> ');
  el.innerHTML = `<div class="play" style="--scale:${S.settings.cardScale}">
    <div class="play-top">
      <button class="icon-btn" data-act="quit" title="끝내기 (Esc)">✕</button>
      <div class="play-title"><b>${s.i + 1} / ${s.cards.length}</b><small>${esc(s.title)}</small></div>
      <button class="icon-btn" data-act="undo" ${s.hist.length ? '' : 'disabled'} title="되돌리기 (Z)">↶</button>
    </div>
    <div class="bar"><i style="width:${(s.i / s.cards.length) * 100}%"></i></div>
    <div class="tally"><span class="t-no">${s.unknown.length}</span><span class="t-yes">${s.known.length}</span></div>
    <div class="flip ${s.flipped ? 'flipped' : ''}" id="flash">
      <div class="face front">
        ${crumbs ? `<div class="crumbs">${crumbs}</div>` : ''}
        <div class="term">${esc(n.title || '제목 없음')}</div>
        <button class="star ${n.star ? 'on' : ''}" data-act="star" title="별표">★</button>
        <span class="flip-hint">눌러서 뒤집기</span>
      </div>
      <div class="face back">
        <div class="back-title">${esc(n.title)}</div>
        <div class="back-body">${backHtml(id)}</div>
      </div>
    </div>
    <div class="play-actions">
      <button class="judge no" data-judge="0" title="몰라요 (←, 1)">✕<span>몰라요</span></button>
      <button class="judge yes" data-judge="1" title="알아요 (→, 2)">✓<span>알아요</span></button>
    </div>
  </div>`;
}

function renderSummary() {
  const s = session;
  const unknown = s.unknown.filter((x) => S.node(x));
  el.innerHTML = `<div class="page narrow">
    <header class="page-h"><div><h1>${unknown.length ? '잘하고 있어요!' : '모두 알았어요 🎉'}</h1><p class="sub">${esc(s.title)}</p></div></header>
    <section class="panel stats2">
      <div class="st no"><b>${unknown.length}</b><span>몰라요</span></div>
      <div class="st yes"><b>${s.known.length}</b><span>알아요</span></div>
    </section>
    ${unknown.length ? `<section class="panel"><h3>다시 볼 카드</h3><div class="missed">${unknown.map((x) => `<div class="m-row"><b>${esc(S.node(x).title)}</b><span class="crumbs">${S.path(x).slice(0, -1).map((y) => esc(y.title)).join(' <i>›</i> ')}</span></div>`).join('')}</div></section>` : ''}
    <div class="sum-actions">
      ${unknown.length ? `<button class="btn primary big wide" data-act="retry">모르는 ${unknown.length}장 다시 학습</button>` : ''}
      <button class="btn big wide" data-act="restart">처음부터 다시</button>
      <button class="btn ghost wide" data-act="setup">다른 레벨 고르기</button>
    </div>
  </div>`;
}

// ---------- 동작 ----------
function flip() {
  if (!session || session.done) return;
  session.flipped = !session.flipped;
  persist();
  $('#flash', el)?.classList.toggle('flipped', session.flipped);
}

function judge(known) {
  const s = session;
  if (!s || s.done || s.i >= s.cards.length) return;
  const id = s.cards[s.i];
  const prev = S.as('train', () => S.rate(PKEY(id), known ? 3 : 1));
  (known ? s.known : s.unknown).push(id);
  s.hist.push({ id, known, prev });
  s.i++;
  s.flipped = false;
  if (s.i >= s.cards.length) s.done = true;
  persist();
  const f = $('#flash', el);
  if (f && !s.done) {
    // 카드가 옆으로 날아가는 짧은 효과
    f.classList.add(known ? 'out-r' : 'out-l');
    setTimeout(render, 160);
  } else render();
}

function undo() {
  const s = session;
  const h = s?.hist.pop();
  if (!h) return;
  S.as('train', () => S.setProg(PKEY(h.id), h.prev));
  (h.known ? s.known : s.unknown).pop();
  s.i--;
  s.flipped = true;
  s.done = false;
  persist();
  render();
}

async function quit() {
  if (!session) return;
  if (session.hist.length && !(await confirmDlg('학습을 끝낼까요?', { ok: '끝내기' }))) return;
  if (session.hist.length) { session.done = true; persist(); return render(); }
  discardSession();
  render();
}

async function onClick(e) {
  const t = e.target;
  if (t.matches('input[data-scope]')) {
    const id = t.dataset.scope;
    const set = new Set(opts.scope);
    if (t.checked) { for (const x of [...set]) if (S.isAncestor(id, x)) set.delete(x); set.add(id); } else set.delete(id);
    opts.scope = [...set];
    opts.levels = opts.levels.filter((d) => levelCounts(opts.scope).has(d));
    saveOpts();
    return renderSetup();
  }
  if (t.matches('input[data-opt]')) { opts[t.dataset.opt] = t.checked; saveOpts(); return renderSetup(); }
  const b = t.closest('[data-act],[data-level],[data-sopen],[data-judge]');
  if (!b) {
    if (t.closest('#flash') && !t.closest('a,button')) flip();
    return;
  }
  if (b.dataset.level) {
    const d = +b.dataset.level;
    opts.levels = opts.levels.includes(d) ? opts.levels.filter((x) => x !== d) : [...opts.levels, d].sort();
    saveOpts();
    return renderSetup();
  }
  if (b.dataset.sopen) {
    const id = b.dataset.sopen;
    scopeOpen.has(id) ? scopeOpen.delete(id) : scopeOpen.add(id);
    lsSet('galrae.v1.scopeOpen', [...scopeOpen]);
    return renderSetup();
  }
  if (b.dataset.judge) return judge(b.dataset.judge === '1');
  switch (b.dataset.act) {
    case 'scope-all': opts.scope = []; saveOpts(); return renderSetup();
    case 'start': { const c = buildDeck(); return c.length ? begin(c) : toast('카드가 없어요'); }
    case 'undo': return undo();
    case 'quit': return quit();
    case 'star': {
      const id = session.cards[session.i];
      S.as('train', () => S.updateNode(id, { star: !S.node(id).star }));
      b.classList.toggle('on', S.node(id).star);
      return;
    }
    case 'retry': return begin(shuffle(session.unknown.filter((x) => S.node(x))), session.title);
    case 'restart': { opts = { ...opts, ...session.opts }; const c = buildDeck(); return c.length ? begin(c, session.title) : toast('카드가 없어요'); }
    case 'setup': discardSession(); return render();
  }
}

function onKey(e) {
  if (!el || el.hidden || !session || session.done) return;
  if (e.target.closest('input,textarea,[contenteditable],dialog')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ' || k === 'Enter' || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); flip(); }
  else if (k === 'ArrowLeft' || k === '1') judge(false);
  else if (k === 'ArrowRight' || k === '2') judge(true);
  else if (k === 'z' || k === 'Z' || k === 'Backspace') { e.preventDefault(); undo(); }
  else if (k === 'Escape') quit();
}

// 카드를 오른쪽으로 밀면 알아요, 왼쪽은 몰라요 (뒤집기 전후 상관없이)
function bindSwipe() {
  let st = null;
  el.addEventListener('pointerdown', (e) => {
    const f = e.target.closest('#flash');
    if (!f || e.pointerType === 'mouse' || e.target.closest('.back-body') && f.querySelector('.back-body').scrollHeight > f.querySelector('.back-body').clientHeight) return;
    st = { x: e.clientX, y: e.clientY, f };
  });
  el.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dy) > Math.abs(dx) * 1.2) return;
    st.f.style.translate = `${dx}px 0`;
    st.f.style.rotate = `${dx / 30}deg`;
    st.f.dataset.swipe = dx > 60 ? 'yes' : dx < -60 ? 'no' : '';
  });
  const end = (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    st.f.style.translate = ''; st.f.style.rotate = ''; st.f.dataset.swipe = '';
    st = null;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.2) judge(dx > 0);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { if (st) { st.f.style.translate = ''; st.f.style.rotate = ''; st = null; } });
}
