// 트레이닝: 범위·레벨 설정 → 무작위 낱말카드 → 결과
import * as S from './store.js';
import { $, $$, esc, shuffle, pick, renderMd, hasCloze, firstLine, lsGet, lsSet, now, fmtInterval, promptDlg, confirmDlg, toast } from './util.js';

const SESSION_KEY = 'galrae.v1.session';

export const MODES = {
  full: { name: '종합', desc: '단서/제목 → 분류 경로 · 같은 층의 경우의 수 · 외울 것까지 한 번에 (내 공부법 그대로)' },
  expand: { name: '하위 펼치기', desc: '이 갈래 안에 어떤 경우의 수가 있는지 모두 떠올리기' },
  locate: { name: '위치 찾기', desc: '이 항목이 어느 분류 경로에 속하는지 떠올리기' },
  recall: { name: '내용 회상', desc: '이 갈래의 외울 것 · 주요 내용 떠올리기 (==강조==는 빈칸)' },
  cue: { name: '문제 → 분류', desc: '문제 단서를 보고 어느 갈래인지 판단하기' },
  mix: { name: '섞기', desc: '위 모드를 카드마다 무작위로 섞어서' },
};

const DEFAULT_OPTS = { mode: 'full', scope: [], levels: [], filter: 'all', order: 'random', count: 20, star: false };
let opts = { ...DEFAULT_OPTS, ...(S.settings.lastTrain || {}) };
let session = lsGet(SESSION_KEY, null);
let el = null;
let scopeOpen = new Set(lsGet('galrae.v1.scopeOpen', []));
let api = {};

export const hasSession = () => !!(session && !session.done && session.i < session.cards.length);
export const sessionInfo = () => session;

export function init(root, hooks) {
  el = root;
  api = hooks;
  el.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  bindSwipe();
}

// ---------- 카드 만들기 ----------
const keyOf = (c) => `${c.n}|${c.m}`;

function eligible(id, mode) {
  const n = S.node(id);
  switch (mode) {
    case 'expand': return S.children(id).length > 0;
    case 'locate': case 'full': return S.depth(id) >= 2;
    case 'recall': return !!(n.note && n.note.trim());
    case 'cue': return (n.cues || []).some((c) => c.trim());
  }
  return false;
}

const cueIdx = (id) => {
  const cs = (S.node(id).cues || []).map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
  return cs.length ? pick(cs) : null;
};

export function scopeIds(o = opts) {
  const all = S.descendants(null);
  const sc = (o.scope || []).filter((x) => S.node(x));
  if (!sc.length) return all;
  const set = new Set();
  for (const s of sc) for (const x of S.descendants(s)) set.add(x);
  return all.filter((x) => set.has(x));
}

export function buildDeck(o = opts) {
  let ids = scopeIds(o);
  if (o.levels?.length) ids = ids.filter((x) => o.levels.includes(S.depth(x)));
  if (o.star) ids = ids.filter((x) => S.node(x).star);
  let cards = [];
  const modes = o.mode === 'mix' ? ['full', 'expand', 'locate', 'recall', 'cue'] : [o.mode];
  for (const id of ids) {
    const ok = modes.filter((m) => eligible(id, m));
    if (!ok.length) continue;
    if (o.mode === 'cue') {
      S.node(id).cues.forEach((c, i) => c.trim() && cards.push({ n: id, m: 'cue', c: i }));
      continue;
    }
    const m = o.mode === 'mix' ? pick(ok) : ok[0];
    const card = { n: id, m };
    if (m === 'cue') card.c = cueIdx(id);
    // 종합 모드는 단서가 있으면 절반은 단서로 출제
    if (m === 'full' && (S.node(id).cues || []).some((c) => c.trim()) && Math.random() < 0.6) card.c = cueIdx(id);
    cards.push(card);
  }
  const t = now();
  const p = (c) => S.prog(keyOf(c));
  if (o.filter === 'weak') cards = cards.filter((c) => !p(c) || p(c).b <= 2);
  else if (o.filter === 'due') cards = cards.filter((c) => !p(c) || p(c).d <= t);
  else if (o.filter === 'new') cards = cards.filter((c) => !p(c));
  if (o.order === 'random') shuffle(cards);
  else if (o.order === 'weak') {
    shuffle(cards);
    const sc = (c) => (p(c) ? p(c).b + (p(c).d > t ? 0.5 : 0) : -1);
    cards.sort((a, b) => sc(a) - sc(b));
  }
  if (o.count > 0) cards = cards.slice(0, o.count);
  return cards;
}

// 복습 기한이 된 카드로 바로 시작
export function startDue() {
  const cards = shuffle(S.dueKeys().map((k) => {
    const [n, m] = k.split('|');
    const c = { n, m };
    if ((m === 'cue' || m === 'full') && S.node(n).cues?.some((x) => x.trim())) c.c = m === 'cue' || Math.random() < 0.6 ? cueIdx(n) : undefined;
    return c;
  }).filter((c) => S.node(c.n) && (c.m !== 'cue' || c.c != null)));
  if (!cards.length) { toast('지금 복습할 카드가 없어요'); return false; }
  begin(cards.slice(0, 100), { ...opts, title: '오늘 복습' });
  return true;
}

export function startQuick(scope = []) {
  const o = { ...DEFAULT_OPTS, mode: 'mix', scope, count: 20, order: 'weak' };
  const cards = buildDeck(o);
  if (!cards.length) { toast('카드를 만들 갈래가 없어요. 트리에서 먼저 갈래를 추가해 주세요.'); return false; }
  begin(cards, { ...o, title: '빠른 트레이닝' });
  return true;
}

export function discardSession() {
  session = null;
  persist();
}

export function setScope(id) {
  opts.scope = id ? [id] : [];
  opts.levels = [];
  saveOpts();
}

function begin(cards, o) {
  session = { cards, i: 0, revealed: false, hist: [], stats: { 1: 0, 2: 0, 3: 0 }, missed: [], opts: o, started: now(), done: false };
  persist();
  api.go('train');
  render();
}

const persist = () => lsSet(SESSION_KEY, session);
const saveOpts = () => S.saveSettings({ lastTrain: opts });

// ---------- 렌더 ----------
export function render() {
  if (!el) return;
  if (session && !session.done && session.i < session.cards.length) {
    // 삭제된 갈래의 카드는 건너뛴다
    while (session.i < session.cards.length && !S.node(session.cards[session.i].n)) session.cards.splice(session.i, 1);
  }
  if (session && session.done) renderSummary();
  else if (session && session.i < session.cards.length) renderCard();
  else if (session && session.cards.length && session.i >= session.cards.length) { session.done = true; persist(); renderSummary(); }
  else renderSetup();
}

function renderSetup() {
  const md = S.maxDepth();
  const ids = scopeIds();
  const depthCount = new Map();
  for (const x of ids) { const d = S.depth(x); depthCount.set(d, (depthCount.get(d) || 0) + 1); }
  const deckN = buildDeck({ ...opts, order: 'tree' }).length;
  const levelChips = Array.from({ length: md }, (_, i) => i + 1).map((d) =>
    `<button class="chip ${opts.levels.includes(d) ? 'on' : ''}" data-level="${d}">Lv${d} ${esc(S.levelName(d))}<small>${depthCount.get(d) || 0}</small></button>`).join('');
  const seg = (name, items, cur) => `<div class="seg" data-seg="${name}">${items.map(([v, l]) =>
    `<button class="${String(cur) === String(v) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const presets = S.presets();
  el.innerHTML = `<div class="page narrow">
    <header class="page-h"><div><h1>트레이닝</h1><p class="sub">범위와 레벨을 정하면 그 안에서 카드가 무작위로 나와요</p></div></header>
    ${presets.length ? `<div class="presets">${presets.map((p) => `<span class="preset"><button class="chip" data-preset="${p.id}">▶ ${esc(p.name)}</button><button class="x" data-delpreset="${p.id}" title="삭제">×</button></span>`).join('')}</div>` : ''}
    <section class="panel">
      <h3>모드</h3>
      <div class="mode-grid">${Object.entries(MODES).map(([k, m]) => `<button class="mode ${opts.mode === k ? 'on' : ''}" data-mode="${k}"><b>${m.name}</b><span>${esc(m.desc.replace(/==/g, ''))}</span></button>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="panel-h"><h3>범위</h3><button class="link" data-act="scope-all">${opts.scope.length ? '전체로 되돌리기' : '전체 선택됨'}</button></div>
      <div class="scope-tree">${scopeTree()}</div>
    </section>
    <section class="panel">
      <div class="panel-h"><h3>레벨</h3><span class="muted small">선택 안 하면 모든 레벨</span></div>
      <div class="chips">${levelChips || '<span class="muted">갈래가 없어요</span>'}</div>
    </section>
    <section class="panel grid2">
      <div><h3>대상</h3>${seg('filter', [['all', '전체'], ['weak', '약한 것'], ['due', '복습 기한'], ['new', '새 카드']], opts.filter)}
        <label class="check"><input type="checkbox" data-act="star" ${opts.star ? 'checked' : ''}> ★ 별표만</label></div>
      <div><h3>순서</h3>${seg('order', [['random', '무작위'], ['weak', '약한 것 먼저'], ['tree', '트리 순서']], opts.order)}</div>
      <div><h3>장수</h3>${seg('count', [[10, '10'], [20, '20'], [50, '50'], [0, '전부']], opts.count)}</div>
    </section>
    <div class="start-bar">
      <button class="btn ghost" data-act="save-preset" title="현재 설정을 프리셋으로 저장">☆<span class="lbl"> 프리셋 저장</span></button>
      <span class="deck-n"><b>${opts.count > 0 ? Math.min(opts.count, deckN) : deckN}</b>장 <small class="muted">/ 해당 ${deckN}</small></span>
      <button class="btn primary big" data-act="start" ${deckN ? '' : 'disabled'}>시작 ▶</button>
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
      <span>${esc(n.title || '(제목 없음)')}</span></label><small class="muted">${S.levelName(d + 1)}${kids.length ? ` · ${kids.length}` : ''}</small></div>`);
    if (open) for (const k of kids) walk(k, d + 1, implied || on);
  };
  S.roots().forEach((r) => walk(r, 0, false));
  return rows.join('') || '<p class="muted">트리 탭에서 갈래를 먼저 만들어 주세요.</p>';
}

function frontHtml(c) {
  const n = S.node(c.n);
  const p = S.path(c.n);
  const crumbs = (list) => `<div class="crumbs">${list.map((x) => `<span>${esc(x.title)}</span>`).join('<i>›</i>')}</div>`;
  const kids = S.children(c.n);
  const cue = c.c != null ? (n.cues || [])[c.c] : null;
  const lv = `<span class="lv">Lv${p.length} · ${esc(S.levelName(p.length))}</span>`;
  switch (c.m) {
    case 'expand':
      return `${crumbs(p.slice(0, -1))}<div class="q-title">${esc(n.title)}</div>
        <p class="q-prompt">하위 갈래 ${S.settings.showCount ? `<b>${kids.length}</b>가지를` : '를 모두'} 떠올려 보세요</p>
        ${S.settings.showCount ? `<div class="blanks">${kids.map((k, i) => `<button class="blank" data-blank><em>${i + 1}</em><span>${esc(S.node(k).title)}</span></button>`).join('')}</div><p class="hint">빈칸을 눌러 하나씩 확인할 수 있어요</p>` : ''}`;
    case 'locate':
      return `${lv}<div class="q-title">${esc(n.title)}</div><p class="q-prompt">어느 갈래에 속할까요? 위로 올라가는 경로와 같은 층의 경우의 수를 떠올려 보세요</p>`;
    case 'recall':
      return `${crumbs(p.slice(0, -1))}<div class="q-title">${esc(n.title)}</div><p class="q-prompt">외울 것 · 주요 내용은?</p>
        ${hasCloze(n.note) ? `<div class="md cloze-box">${renderMd(n.note, { cloze: true })}</div><p class="hint">빈칸을 눌러 확인</p>` : ''}`;
    case 'cue':
      return `<div class="q-cue">${esc(cue)}</div><p class="q-prompt">이 문제는 어느 갈래에 속하나요?</p>`;
    default:
      return `${cue ? `<div class="q-cue">${esc(cue)}</div>` : `${lv}<div class="q-title">${esc(n.title)}</div>`}
        <ol class="q-steps"><li>어떤 과목 › 단원 › 파트에 속하나?</li><li>같은 층에는 어떤 경우의 수가 있나?</li><li>그 안에서 외울 것 · 주요 내용은?</li></ol>`;
  }
}

function ladderHtml(id) {
  const p = S.path(id);
  const rungs = p.map((n, k) => {
    const sibs = S.children(k ? p[k - 1].id : null);
    const chips = sibs.map((s) => `<span class="chip ${s === n.id ? 'on' : ''}">${esc(S.node(s).title)}</span>`).join('');
    return `<div class="rung"><div class="rung-lv">${esc(S.levelName(k + 1))}<small>${sibs.length}가지</small></div><div class="rung-chips">${chips}</div></div>`;
  });
  const kids = S.children(id);
  if (kids.length) {
    rungs.push(`<div class="rung sub"><div class="rung-lv">하위<small>${kids.length}가지</small></div><div class="rung-chips">${kids.map((k) => `<span class="chip">${esc(S.node(k).title)}</span>`).join('')}</div></div>`);
  }
  return `<div class="ladder">${rungs.join('')}</div>`;
}

function backHtml(c) {
  const n = S.node(c.n);
  const note = n.note && n.note.trim() ? `<div class="sec"><h4>외울 것 · 주요 내용</h4><div class="md">${renderMd(n.note)}</div></div>` : '';
  const kidsList = () => {
    const kids = S.children(c.n);
    return `<div class="sec"><h4>하위 갈래 ${kids.length}가지</h4><div class="kid-list">${kids.map((k, i) => {
      const kn = S.node(k);
      const fl = firstLine(kn.note);
      return `<div class="kid"><em>${i + 1}</em><b>${esc(kn.title)}</b>${fl ? `<span>${esc(fl)}</span>` : ''}</div>`;
    }).join('')}</div></div>`;
  };
  let body;
  switch (c.m) {
    case 'expand': body = kidsList() + note; break;
    case 'recall': body = note || '<p class="muted">내용이 비어 있어요</p>'; break;
    case 'locate': case 'cue': body = `<div class="sec"><h4>분류 경로</h4>${ladderHtml(c.n)}</div>${note}`; break;
    default: body = `<div class="sec"><h4>분류 경로 · 경우의 수</h4>${ladderHtml(c.n)}</div>${note}`;
  }
  const head = (c.m === 'cue' || (c.m === 'full' && c.c != null)) ? `<div class="ans-title">${esc(n.title)}</div>` : '';
  return `${head}${body}<div class="ans-links"><button class="link" data-act="goto-graph">그래프에서 보기</button><button class="link" data-act="goto-tree">편집</button></div>`;
}

function renderCard() {
  const s = session;
  const c = s.cards[s.i];
  const p = S.prog(keyOf(c));
  const hint = (g) => fmtInterval(S.nextDue(p, g).ms);
  const pct = Math.round((s.i / s.cards.length) * 100);
  el.innerHTML = `<div class="play" style="--scale:${S.settings.cardScale}">
    <div class="play-top">
      <button class="icon-btn" data-act="quit" title="그만하기 (Esc)">✕</button>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <span class="count">${s.i + 1} / ${s.cards.length}</span>
      <button class="icon-btn" data-act="undo" ${s.hist.length ? '' : 'disabled'} title="되돌리기 (Z)">↶</button>
    </div>
    <div class="flash ${s.revealed ? 'revealed' : ''}" id="flash">
      <div class="flash-meta"><span class="mode-tag">${MODES[c.m].name}</span>${c.again ? '<span class="again-tag">다시</span>' : ''}${p ? `<span class="box-tag" title="숙련도">${'●'.repeat(p.b)}${'○'.repeat(5 - p.b)}</span>` : '<span class="new-tag">NEW</span>'}
        <button class="star ${S.node(c.n).star ? 'on' : ''}" data-act="star-card" title="별표">★</button></div>
      <div class="front">${frontHtml(c)}</div>
      ${s.revealed ? `<div class="answer">${backHtml(c)}</div>` : ''}
    </div>
    <div class="play-actions">
      ${s.revealed
        ? `<button class="rate r1" data-rate="1"><b>다시</b><small>${hint(1)} · 1</small></button>
           <button class="rate r2" data-rate="2"><b>애매</b><small>${hint(2)} · 2</small></button>
           <button class="rate r3" data-rate="3"><b>알았음</b><small>${hint(3)} · 3</small></button>`
        : `<button class="btn primary big wide" data-act="reveal">정답 보기 <small>Space</small></button>`}
    </div>
  </div>`;
  if (s.revealed) $('.answer', el)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderSummary() {
  const s = session;
  const total = s.stats[1] + s.stats[2] + s.stats[3];
  const missed = s.missed.filter((c) => S.node(c.n));
  const mins = Math.max(1, Math.round((now() - s.started) / 60000));
  el.innerHTML = `<div class="page narrow">
    <header class="page-h"><div><h1>세션 완료 🎉</h1><p class="sub">${esc(s.opts.title || MODES[s.opts.mode]?.name || '')} · ${total}장 · 약 ${mins}분</p></div></header>
    <section class="panel stats3">
      <div class="st r1"><b>${s.stats[1]}</b><span>다시</span></div>
      <div class="st r2"><b>${s.stats[2]}</b><span>애매</span></div>
      <div class="st r3"><b>${s.stats[3]}</b><span>알았음</span></div>
    </section>
    ${missed.length ? `<section class="panel"><h3>다시 볼 갈래 ${missed.length}</h3><div class="missed">${missed.map((c) =>
      `<div class="m-row"><span class="mode-tag">${MODES[c.m].name}</span><span class="crumbs">${S.path(c.n).map((x) => esc(x.title)).join(' <i>›</i> ')}</span></div>`).join('')}</div></section>` : ''}
    <div class="start-bar">
      ${missed.length ? '<button class="btn" data-act="retry-missed">틀린 것만 다시</button>' : ''}
      <button class="btn" data-act="setup">설정으로</button>
      <button class="btn primary" data-act="again-same">같은 설정으로 새로</button>
    </div>
  </div>`;
}

// ---------- 동작 ----------
function reveal() {
  if (!session || session.revealed) return;
  session.revealed = true;
  persist();
  renderCard();
}

function rate(g) {
  const s = session;
  if (!s || !s.revealed) return;
  const c = s.cards[s.i];
  const prev = S.as('train', () => S.rate(keyOf(c), g));
  const h = { i: s.i, key: keyOf(c), prev, g, ins: -1, addedMissed: false };
  s.stats[g]++;
  if (g === 1) {
    if (!s.missed.some((x) => x.n === c.n && x.m === c.m)) { s.missed.push({ n: c.n, m: c.m, c: c.c }); h.addedMissed = true; }
    if (S.settings.requeueAgain) {
      h.ins = Math.min(s.i + 5, s.cards.length);
      s.cards.splice(h.ins, 0, { ...c, again: true });
    }
  }
  s.hist.push(h);
  if (s.hist.length > 200) s.hist.shift();
  s.i++;
  s.revealed = false;
  if (s.i >= s.cards.length) s.done = true;
  persist();
  render();
}

function undo() {
  const s = session;
  const h = s?.hist.pop();
  if (!h) return;
  S.as('train', () => S.setProg(h.key, h.prev));
  s.stats[h.g]--;
  if (h.ins >= 0) s.cards.splice(h.ins, 1);
  if (h.addedMissed) s.missed.pop();
  s.i = h.i;
  s.revealed = true;
  s.done = false;
  persist();
  render();
}

async function onClick(e) {
  const t = e.target;
  const b = t.closest('[data-act],[data-mode],[data-level],[data-seg] button,[data-rate],[data-preset],[data-delpreset],[data-sopen],.blank,.cloze');
  if (t.matches('input[data-scope]')) {
    const id = t.dataset.scope;
    const set = new Set(opts.scope);
    if (t.checked) {
      for (const x of [...set]) if (S.isAncestor(id, x)) set.delete(x);
      set.add(id);
    } else set.delete(id);
    opts.scope = [...set];
    saveOpts();
    renderSetup();
    return;
  }
  if (!b) {
    // 카드 아무 곳이나 누르면 정답 보기
    if (session && !session.done && t.closest('#flash') && !session.revealed && !t.closest('a,button')) reveal();
    return;
  }
  if (b.matches('.blank')) { b.classList.add('shown'); return; }
  if (b.matches('.cloze')) { b.classList.add('shown'); return; }
  if (b.dataset.mode) { opts.mode = b.dataset.mode; saveOpts(); return renderSetup(); }
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
  if (b.closest('[data-seg]')) {
    const name = b.closest('[data-seg]').dataset.seg;
    opts[name] = name === 'count' ? +b.dataset.v : b.dataset.v;
    saveOpts();
    return renderSetup();
  }
  if (b.dataset.rate) return rate(+b.dataset.rate);
  if (b.dataset.preset) {
    const p = S.presets().find((x) => x.id === b.dataset.preset);
    if (!p) return;
    opts = { ...DEFAULT_OPTS, ...p.opts };
    saveOpts();
    const cards = buildDeck();
    if (!cards.length) return toast('이 프리셋에 해당하는 카드가 없어요');
    return begin(cards, { ...opts, title: p.name });
  }
  if (b.dataset.delpreset) {
    if (await confirmDlg('이 프리셋을 삭제할까요?', { ok: '삭제', danger: true })) S.deletePreset(b.dataset.delpreset);
    return renderSetup();
  }
  const card = session && session.cards[session.i];
  switch (b.dataset.act) {
    case 'scope-all': opts.scope = []; saveOpts(); return renderSetup();
    case 'star': opts.star = t.checked; saveOpts(); return renderSetup();
    case 'start': {
      const cards = buildDeck();
      if (!cards.length) return toast('조건에 맞는 카드가 없어요');
      return begin(cards, { ...opts });
    }
    case 'save-preset': {
      const name = await promptDlg('프리셋 이름', defaultPresetName(), '예) 산과 내과질환 Lv3');
      if (name) { S.savePreset(name, { ...opts }); toast('프리셋을 저장했어요'); renderSetup(); }
      return;
    }
    case 'reveal': return reveal();
    case 'undo': return undo();
    case 'quit': return quit();
    case 'star-card': {
      const n = S.node(card.n);
      S.as('train', () => S.updateNode(card.n, { star: !n.star }));
      b.classList.toggle('on', S.node(card.n).star);
      return;
    }
    case 'goto-graph': return api.go('graph', card.n);
    case 'goto-tree': return api.go('tree', card.n);
    case 'retry-missed': {
      const cards = shuffle(session.missed.filter((c) => S.node(c.n)).map((c) => ({ ...c })));
      return begin(cards, { ...session.opts, title: '틀린 것 다시' });
    }
    case 'again-same': {
      const o = session.opts.title === '오늘 복습' ? null : session.opts;
      if (!o) { if (!startDue()) { session = null; persist(); render(); } return; }
      const cards = buildDeck(o);
      if (!cards.length) return toast('조건에 맞는 카드가 없어요');
      return begin(cards, o);
    }
    case 'setup': session = null; persist(); return render();
  }
}

function defaultPresetName() {
  const sc = opts.scope.map((x) => S.node(x)?.title).filter(Boolean).join(', ') || '전체';
  const lv = opts.levels.length ? ' Lv' + opts.levels.join(',') : '';
  return `${MODES[opts.mode].name} · ${sc}${lv}`;
}

async function quit() {
  if (!session) return;
  const done = session.stats[1] + session.stats[2] + session.stats[3];
  if (done && !(await confirmDlg('세션을 끝내고 결과를 볼까요?', { ok: '끝내기' }))) return;
  if (done) { session.done = true; persist(); return render(); }
  session = null;
  persist();
  render();
}

function onKey(e) {
  if (!el || el.hidden || !session || session.done) return;
  if (e.target.closest('input,textarea,[contenteditable],dialog')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ' || k === 'Enter') { e.preventDefault(); reveal(); }
  else if (session.revealed && ['1', '2', '3'].includes(k)) rate(+k);
  else if (session.revealed && ['j', 'k', 'l'].includes(k.toLowerCase())) rate({ j: 1, k: 2, l: 3 }[k.toLowerCase()]);
  else if (k === 'z' || k === 'Z' || k === 'Backspace') { e.preventDefault(); undo(); }
  else if (k === 'Escape') quit();
}

// 정답을 본 뒤 카드를 오른쪽으로 밀면 알았음, 왼쪽은 다시
function bindSwipe() {
  let st = null;
  el.addEventListener('pointerdown', (e) => {
    const f = e.target.closest('#flash');
    if (!f || !session?.revealed || e.pointerType === 'mouse') return;
    st = { x: e.clientX, y: e.clientY, f };
  });
  el.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (Math.abs(dy) > Math.abs(dx) * 1.2) { st.f.style.transform = ''; return; }
    st.f.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    st.f.dataset.swipe = dx > 60 ? 'good' : dx < -60 ? 'again' : '';
  });
  const end = (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    st.f.style.transform = '';
    st.f.dataset.swipe = '';
    st = null;
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.2) rate(dx > 0 ? 3 : 1);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { if (st) { st.f.style.transform = ''; st = null; } });
}
