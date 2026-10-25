// 카드 학습 (Quizlet식 세트)
// 세트 = 아무 갈래 하나(그 아래 전체) 또는 '내 세트'(여러 범위를 묶어 저장).
// 세트 안에서 레벨을 고르면 그 레벨 갈래가 카드가 된다. 앞면 = 이름, 뒷면 = 외울 것 또는 하위 목록.
import * as S from './store.js';
import * as Subject from './subject.js';
import * as Drive from './drive.js';
import { $, esc, shuffle, renderMd, firstLine, lsGet, lsSet, now, confirmDlg, promptDlg, openDialog, toast } from './util.js';

const SESSION_KEY = 'galrae.v2.session';
const PKEY = (id) => `${id}|card`;

let session = lsGet(SESSION_KEY, null);
let el = null;
let api = {};
let view = null;          // null = 세트 목록, { node } | { preset }
const libSaved = lsGet('galrae.v1.libOpen', null);
let libOpen = new Set(libSaved || []);
let libQuery = '';
const setPrefs = () => S.settings.setPrefs || {};
const cardMode = () => S.settings.cardMode || 'browse';
const browsing = () => session?.mode === 'browse';

export const hasSession = () => !!(session && !session.done && session.i < session.cards.length);
export const sessionInfo = () => session;

export function init(root, hooks) {
  el = root;
  api = hooks;
  el.addEventListener('click', onClick);
  el.addEventListener('input', (e) => { if (e.target.matches('#libSearch')) { libQuery = e.target.value.trim(); renderLibraryList(); } });
  document.addEventListener('keydown', onKey);
  addEventListener('resize', () => drawWhere());
  bindSwipe();
}

const persist = () => lsSet(SESSION_KEY, session);

// ---------- 카드 만들기 ----------
const hasBack = (id) => !!(S.node(id).note || '').trim() || S.children(id).length > 0;

function scopeIds(scope) {
  const sc = (scope || []).filter((x) => S.node(x));
  const all = S.descendants(null);
  if (!sc.length) return all;
  const set = new Set();
  for (const s of sc) for (const x of S.descendants(s)) set.add(x);
  return all.filter((x) => set.has(x));
}

function cardsIn(scope) { return scopeIds(scope).filter(hasBack); }

// 몰라요로 고르고 아직 알아요로 바꾸지 않은 카드
const isUnknown = (id) => S.prog(PKEY(id))?.b === 0;
const SPECIAL = {
  star: { title: '★ 별표한 카드', icon: '★', test: (x) => !!S.node(x).star, empty: '카드나 카드 목록에서 ★를 누르면 여기에 모여요.' },
  unknown: { title: '모르는 카드', icon: '✕', test: isUnknown, empty: '알아요 · 몰라요로 학습하다 「몰라요」를 고른 카드가 여기에 모여요. 알아요로 맞히면 빠져요.' },
};
const specialCards = (k, scope = []) => cardsIn(scope).filter(SPECIAL[k].test);

// 세트에 들어가는 카드 (모아 보기 세트는 별표/모르는 카드만)
function setCards(set) {
  const ids = cardsIn(set.scope);
  return set.special ? ids.filter(SPECIAL[set.special].test) : ids;
}

function levelCounts(ids) {
  const m = new Map();
  for (const x of ids) m.set(S.depth(x), (m.get(S.depth(x)) || 0) + 1);
  return m;
}

// 맨 끝 갈래: 하위가 없는 갈래 (단원마다 중단원·소단원·세부… 깊이가 달라도)
// 하위 갈래가 있어도 그 하위가 모두 빈 갈래(외울 것도, 하위도 없음)면 이 갈래가 맨 끝 카드다
const isLeaf = (id) => !S.children(id).some(hasBack);

function buildDeck(set, cfg) {
  let ids = setCards(set);
  if (cfg.leaf) ids = ids.filter(isLeaf);
  else if (cfg.levels?.length) ids = ids.filter((x) => cfg.levels.includes(S.depth(x)));
  if (cfg.star) ids = ids.filter((x) => S.node(x).star);
  if (cfg.unknownOnly) ids = ids.filter((x) => { const p = S.prog(PKEY(x)); return !p || p.b <= 1; });
  return cfg.shuffle ? shuffle(ids) : ids;
}

// 다시 보기/다시 테스트: 지금 세트의 「카드 섞기」 설정을 따른다 (꺼져 있으면 정리 순서 그대로)
function reorder(ids) {
  const set = currentSet();
  const p = set && prefsFor(set);
  if (p && !p.shuffle) {
    const ordered = buildDeck(set, { ...p, star: false, unknownOnly: false, shuffle: false });
    const keep = new Set(ids);
    const result = ordered.filter((x) => keep.has(x));
    if (result.length === keep.size) return result;
  }
  return shuffle(ids);
}

// 갈래 세트에 같은 과목의 다른 갈래를 더해 함께 학습 (세트마다 기억)
const subjectOf = (id) => S.path(id)[0]?.id;
function extrasFor(n) {
  const sub = subjectOf(n.id);
  return (setPrefs()[n.id]?.extra || []).filter((x) => S.node(x) && x !== n.id && subjectOf(x) === sub && !S.isAncestor(x, n.id) && !S.isAncestor(n.id, x));
}

// 저장된 세트: 함께 학습할 갈래를 골라 둔 갈래 세트 (최근에 고친 순)
function savedSets() {
  return Object.entries(setPrefs())
    .filter(([k, v]) => v?.extra?.length && S.node(k))
    .map(([k, v]) => ({ n: S.node(k), extra: extrasFor(S.node(k)), at: v.at || 0, name: v.name || '' }))
    .filter((x) => x.extra.length)
    .sort((a, b) => b.at - a.at);
}

// 현재 보고 있는 세트의 설정
function currentSet() {
  if (!view) return null;
  if (view.special) {
    const k = view.special;
    const subj = setPrefs()['s:' + k]?.subj;
    return { key: 's:' + k, title: SPECIAL[k].title, scope: subj && S.node(subj) ? [subj] : [], special: k, subj: subj && S.node(subj) ? subj : null };
  }
  if (view.preset) {
    const p = S.preset(view.preset);
    if (!p) return null;
    return { key: 'p:' + p.id, title: p.name, scope: p.opts.scope || [], preset: p };
  }
  const n = S.node(view.node);
  if (!n) return null;
  const extra = extrasFor(n);
  // 함께 학습 세트는 이름을 붙일 수 있다 (없으면 '갈래 외 N')
  const name = extra.length ? setPrefs()[n.id]?.name : '';
  return { key: n.id, title: name || (n.title || '제목 없음') + (extra.length ? ` 외 ${extra.length}` : ''), named: !!name, scope: [n.id, ...extra], node: n, extra };
}

function prefsFor(set) {
  const saved = setPrefs()[set.key];
  const counts = levelCounts(setCards(set));
  const avail = [...counts.keys()].sort((a, b) => a - b);
  let levels = saved?.levels?.filter((d) => counts.has(d));
  if (!levels) {
    // 처음 열면: 노드 세트는 바로 아래 레벨, 내 세트는 저장된 레벨, 모아 보기는 전부
    if (set.special) levels = [];
    else if (set.preset) levels = (set.preset.opts.levels || []).filter((d) => counts.has(d));
    // 함께 학습하는 갈래도 각자 바로 아래 레벨을
    else levels = [...new Set([set.node.id, ...(set.extra || [])].map((x) => S.depth(x) + 1))].filter((d) => counts.has(d)).sort((a, b) => a - b);
  }
  // 기본은 맨 끝 갈래만 (모아 보기는 별표·모르는 카드 전부). 맨 끝 갈래 카드가 없으면 레벨로
  const leafCount = setCards(set).filter(isLeaf).length;
  const leaf = !!leafCount && (saved?.leaf ?? (set.preset?.opts.leaf ?? !set.special));
  return { leaf, leafCount, levels, shuffle: saved?.shuffle ?? true, star: saved?.star ?? false, unknownOnly: saved?.unknownOnly ?? false, avail, counts };
}

function savePrefs(set, p) {
  const all = { ...setPrefs(), [set.key]: { ...setPrefs()[set.key], leaf: p.leaf, levels: p.levels, shuffle: p.shuffle, star: p.star, unknownOnly: p.unknownOnly } };
  S.saveSettings({ setPrefs: all });
  if (set.preset) S.savePreset(set.preset.name, { ...set.preset.opts, leaf: p.leaf, levels: p.levels }, set.preset.id);
}

// 세트별 기억(함께 학습할 갈래, 모아 보기의 과목 등)만 바꾼다
function patchPrefs(key, patch) {
  S.saveSettings({ setPrefs: { ...setPrefs(), [key]: { ...setPrefs()[key], ...patch } } });
}

// ---------- 화면 전환 ----------
// param: undefined → 목록(진행 중 학습이 있으면 카드), 'list' → 목록, 노드 id, 'set:<프리셋 id>', 'star' · 'unknown' → 모아 보기
export function show(param) {
  if (param === 'list') view = null;
  else if (Object.hasOwn(SPECIAL, param || '')) view = { special: param };
  else if (param?.startsWith('set:')) view = { preset: param.slice(4) };
  else if (param && S.node(param)) view = { node: param };
  else if (!hasSession()) view = view && currentSet() ? view : null;
  // 세트/목록을 직접 열면 진행 중인 학습은 잠시 접어두고, 그냥 '카드 학습' 탭을 누르면 이어서
  if (session?.done && param) { session = null; persist(); }
  if (session) session.paused = !!param;
  render();
}

// mode: 'browse' = 넘기며 외우기(기록 없음), 'test' = 알아요/몰라요(진도 반영)
function begin(cards, title, from, mode = cardMode()) {
  session = { cards, i: 0, flipped: false, known: [], unknown: [], hist: [], title, from, mode, started: now(), done: false };
  persist();
  if (location.hash !== '#train') history.replaceState(null, '', '#train');
  render();
}

export function render() {
  if (!el) return;
  if (session && !session.done) {
    while (session.i < session.cards.length && !S.node(session.cards[session.i])) session.cards.splice(session.i, 1);
    if (session.i >= session.cards.length) { session.done = session.cards.length > 0; persist(); }
  }
  if (session && !session.paused && session.done) return renderSummary();
  if (session && !session.paused && session.i < session.cards.length) return renderCard();
  driveOff();
  if (view && currentSet()) return renderSet();
  view = null;
  renderLibrary();
}

// ---------- 세트 목록 ----------
function renderLibrary() {
  const presets = S.presets();
  const saved = savedSets();
  el.innerHTML = `<div class="page narrow">
    <header class="page-h"><div><h1>카드 학습</h1><p class="sub">세트를 고르고, 그 안에서 레벨을 정해 외워요</p></div></header>
    ${hasSession() ? `<section class="panel resume" data-act="resume"><div><b>이어서 학습</b><span class="muted">${esc(session.title)} · ${session.i} / ${session.cards.length}</span></div><button class="btn primary">계속</button></section>` : ''}
    ${saved.length ? `<section class="lib-sec">
      <div class="panel-h"><h3>저장된 세트</h3><span class="muted small">함께 학습할 갈래를 고른 세트</span></div>
      <div class="set-list">${saved.map(({ n, extra, name }) => `<div class="set-row saved">
        <button class="set-open" data-node="${n.id}"><span class="set-ic">⧉</span><span class="set-main"><b>${name ? esc(name) : `${esc(n.title || '제목 없음')} <small class="muted">외 ${extra.length}</small>`}</b><small>${esc([n, ...extra.map((x) => S.node(x))].map((x) => x.title || '제목 없음').join(' · '))}</small></span></button>
        <em>${cardsIn([n.id, ...extra]).length}장</em><button class="icon-btn small" data-unsave="${n.id}" title="저장된 세트에서 빼기" aria-label="빼기">✕</button></div>`).join('')}</div>
    </section>` : ''}
    <section class="lib-sec">
      <div class="panel-h"><h3>내 세트</h3><button class="link" data-act="new-preset">+ 새 세트</button></div>
      ${presets.length ? `<div class="set-list">${presets.map((p) => {
        const n = cardsIn(p.opts.scope).length;
        const names = (p.opts.scope || []).map((x) => S.node(x)?.title).filter(Boolean);
        return `<button class="set-row" data-preset="${p.id}"><span class="set-ic">★</span><span class="set-main"><b>${esc(p.name)}</b><small>${esc(names.join(' · ') || '전체')}</small></span><em>${n}장</em></button>`;
      }).join('')}</div>` : '<p class="muted small lib-empty">여러 범위를 묶어 나만의 세트를 만들 수 있어요. 예) 산과 내과질환 + 감염 파트</p>'}
    </section>
    <section class="lib-sec">
      <div class="panel-h"><h3>모아 보기</h3></div>
      <div class="set-list">${Object.entries(SPECIAL).map(([k, x]) => `<button class="set-row" data-special="${k}"><span class="set-ic ${k}">${x.icon}</span><span class="set-main"><b>${x.title}</b><small>모든 과목 · 세트 안에서 과목을 고를 수 있어요</small></span><em>${specialCards(k).length}장</em></button>`).join('')}</div>
    </section>
    <section class="lib-sec">
      <div class="panel-h"><h3>갈래 세트</h3></div>
      <div id="libTabs"></div>
      <input class="input search" id="libSearch" placeholder="세트 찾기 (모든 과목)" type="search" value="${esc(libQuery)}">
      <div class="set-list tree" id="libList"></div>
    </section>
  </div>`;
  renderLibraryList();
}

function renderLibraryList() {
  const box = $('#libList', el);
  if (!box) return;
  if (!libSaved && !libOpen.size) S.roots().forEach((r) => libOpen.add(r)); // 처음엔 과목을 펼쳐서
  // 과목은 탭으로 나누고 고른 과목만 (검색은 모든 과목에서)
  const subj = Subject.current();
  const tabs = $('#libTabs', el);
  if (tabs) tabs.innerHTML = libQuery ? '' : Subject.tabsHtml();
  const rows = [];
  const q = libQuery.toLowerCase();
  const row = (id, d) => {
    const n = S.node(id);
    const kids = S.children(id).filter((k) => cardsIn([k]).length);
    const cnt = cardsIn([id]).length;
    const open = libOpen.has(id);
    rows.push(`<div class="set-row tr" style="--d:${d}">
      ${kids.length && !q ? `<button class="caret ${open ? 'open' : ''}" data-libopen="${id}"></button>` : '<span class="caret leaf"></span>'}
      <button class="set-main" data-node="${id}"><b>${esc(n.title || '제목 없음')}</b><small>${q ? S.path(id).slice(0, -1).map((x) => esc(x.title)).join(' › ') : esc(S.levelName(d + 1))}</small></button>
      <em>${cnt}장</em><button class="set-go" data-node="${id}" aria-label="열기">›</button></div>`);
    if (!q && open) for (const k of kids) row(k, d + 1);
  };
  if (q) {
    for (const id of S.search(libQuery, 60)) if (cardsIn([id]).length) row(id, 0);
  } else if (subj) { libOpen.add(subj); row(subj, 0); }
  box.innerHTML = rows.join('') || `<p class="muted small lib-empty">${q ? '찾는 세트가 없어요' : '정리 탭에서 갈래와 외울 것을 먼저 만들어 주세요.'}</p>`;
}

// ---------- 세트 화면 ----------
function renderSet() {
  const set = currentSet();
  const p = prefsFor(set);
  const deck = buildDeck(set, { ...p, shuffle: false });
  const crumbs = set.node ? S.path(set.node.id).slice(0, -1).map((x) => esc(x.title)).join(' <i>›</i> ') : set.special ? '모아 보기' : '내 세트';
  const sub = set.node && S.parentOf(set.node.id) ? S.node(subjectOf(set.node.id)) : null;
  // 갈래마다 지금 레벨에서 실제로 카드에 들어가는 장수 (0장이면 표시)
  const inDeck = (id) => deck.filter((x) => x === id || S.isAncestor(id, x)).length;
  const missing = set.extra?.filter((x) => !inDeck(x) && cardsIn([x]).length) || [];
  const chip = (id, rm) => `<span class="chip ${rm ? '' : 'fixed'} ${missing.includes(id) ? 'warn' : ''}"><span>${esc(S.node(id).title || '제목 없음')}</span><small>${inDeck(id)}장</small>${rm ? `<button data-rmextra="${id}" title="빼기" aria-label="빼기">✕</button>` : ''}</span>`;
  el.innerHTML = `<div class="page narrow">
    <button class="back-link" data-act="list">‹ 세트 목록</button>
    <header class="set-h">
      <div class="crumbs">${crumbs}</div>
      <h1>${esc(set.title)}</h1>
      ${set.preset ? `<p class="sub">${esc((set.scope || []).map((x) => S.node(x)?.title).filter(Boolean).join(' · ') || '전체')}</p>` : ''}
    </header>
    ${sub ? `<section class="panel together">
      <div class="panel-h"><h3>함께 학습</h3><span>${set.extra.length ? `<button class="link" data-act="name-set">${set.named ? '이름 바꾸기' : '이름 붙이기'}</button> ` : ''}<button class="link" data-act="add-ranges">+ 갈래 더하기</button></span></div>
      <div class="chips">${chip(set.node.id, false)}${set.extra.map((x) => chip(x, true)).join('')}</div>
      ${missing.length ? `<p class="small warn-msg">지금 고른 레벨에는 「${missing.map((x) => esc(S.node(x).title || '제목 없음')).join('」·「')}」 카드가 없어요. 「맨 끝 갈래」를 고르거나 레벨을 더 골라 주세요.</p>` : ''}
      ${set.extra.length ? '<p class="muted small">세트 목록의 「저장된 세트」에서 바로 다시 열 수 있어요.</p>' : `<p class="muted small">「${esc(sub.title)}」 안의 다른 대단원·중단원… 갈래를 여러 개 골라 이 세트와 한꺼번에 외울 수 있어요.</p>`}
    </section>` : ''}
    ${set.special ? `<section class="panel">
      <div class="panel-h"><h3>과목</h3></div>
      <div class="chips">${[null, ...S.roots()].map((r) => ({ r, n: specialCards(set.special, r ? [r] : []).length })).filter((x) => !x.r || x.n || x.r === set.subj)
        .map(({ r, n }) => `<button class="chip pick ${(set.subj || null) === r ? 'on' : ''}" data-subjf="${r || ''}"><span>${r ? esc(S.node(r).title || '제목 없음') : '전체'}</span><small>${n}</small></button>`).join('')}</div>
    </section>` : ''}
    <section class="panel">
      <div class="panel-h"><h3>레벨</h3><span class="muted small">맨 끝 갈래, 또는 레벨 여러 개 · 안 고르면 전부</span></div>
      <div class="level-list">${p.leafCount ? `<button class="level-btn leaf ${p.leaf ? 'on' : ''}" data-act="leaf">
        <span><b>맨 끝 갈래</b><small>단원마다 깊이가 달라도 가장 마지막 갈래만</small></span><em>${p.leafCount}장</em></button>` : ''}${p.avail.map((d) => `<button class="level-btn ${!p.leaf && p.levels.includes(d) ? 'on' : ''}" data-level="${d}">
        <span><b>${esc(S.levelName(d))}</b><small>${set.node && d === S.depth(set.node.id) ? '이 갈래 자체' : `Lv${d}`}</small></span><em>${p.counts.get(d)}장</em></button>`).join('')}</div>
      <div class="kv mode-pick"><span>학습 방식</span><div class="seg" data-seg="cardMode"><button class="${cardMode() === 'browse' ? 'on' : ''}" data-v="browse">넘기며 외우기</button><button class="${cardMode() === 'test' ? 'on' : ''}" data-v="test">알아요 · 몰라요</button></div></div>
      <p class="muted small mode-desc">${cardMode() === 'browse' ? '좌우로 넘기기만 해요. 진도(숙련도)에는 기록되지 않아요.' : '카드마다 알아요/몰라요를 골라요. 진도에 기록되고, 끝나면 모르는 카드만 다시 볼 수 있어요.'}</p>
      <div class="drive-pick"><label class="check"><span>🚗 운전 모드 <small class="muted">앞면을 소리로 읽고, 차 핸들 ⏮ ⏭ 로 넘기기</small></span><input type="checkbox" data-act="drive" ${Drive.enabled() ? 'checked' : ''}></label><button class="link" data-act="drive-cfg">음성 설정</button></div>
      <label class="check"><span>카드 섞기</span><input type="checkbox" data-pref="shuffle" ${p.shuffle ? 'checked' : ''}></label>
      ${set.special === 'star' ? '' : `<label class="check"><span>★ 별표한 카드만</span><input type="checkbox" data-pref="star" ${p.star ? 'checked' : ''}></label>`}
      ${set.special === 'unknown' ? '' : `<label class="check"><span>모르는 카드만</span><input type="checkbox" data-pref="unknownOnly" ${p.unknownOnly ? 'checked' : ''}></label>`}
    </section>
    <div class="start-bar">
      ${set.preset
        ? '<button class="btn ghost small" data-act="edit-preset">범위 편집</button><button class="btn ghost small" data-act="rename-preset">이름</button><button class="btn ghost small danger" data-act="del-preset">삭제</button>'
        : set.special ? '' : '<button class="btn ghost small" data-act="save-preset">☆<span class="lbl"> 내 세트로</span></button>'}
      <button class="btn primary big" data-act="start" ${deck.length ? '' : 'disabled'}>${deck.length}장 ${cardMode() === 'browse' ? '외우기' : '테스트'}</button>
    </div>
    <section class="lib-sec">
      <h3>카드 ${deck.length}장</h3>
      <div class="term-list">${deck.map((id) => {
        const n = S.node(id);
        const back = (n.note || '').trim() ? firstLine(n.note) : S.children(id).map((k) => S.node(k).title).join(' · ');
        const pr = S.prog(PKEY(id));
        return `<div class="term-row" data-open="${id}">
          <div class="term-l"><b>${esc(n.title || '제목 없음')}</b>${set.scope.length !== 1 || S.parentOf(id) !== set.scope[0] ? `<small>${esc(S.path(id).slice(0, -1).map((x) => x.title).slice(-2).join(' › '))}</small>` : ''}</div>
          <div class="term-r">${(n.note || '').trim() ? '' : '<span class="tag">하위</span>'}${esc(back)}</div>
          <span class="term-st ${pr ? (pr.b >= 2 ? 'ok' : 'ng') : ''}"></span>
          <button class="star ${n.star ? 'on' : ''}" data-star="${id}" title="별표">★</button>
        </div>`;
      }).join('') || `<p class="muted small">${set.special && !setCards(set).length ? SPECIAL[set.special].empty : '이 조건에 맞는 카드가 없어요'}</p>`}</div>
    </section>
  </div>`;
}

// 여러 범위 고르기 (내 세트)
// opt.roots: 이 갈래들 아래에서만 고르기, opt.fixed: 늘 들어가는 갈래(바꿀 수 없음), opt.named: 세트 이름 칸
function pickRanges(initial = [], name = '', { roots = S.roots(), fixed = null, named = true, title } = {}) {
  const sel = new Set(initial);
  const open = new Set([...initial, ...(fixed ? [fixed] : [])].flatMap((x) => S.path(x).slice(0, -1).map((n) => n.id)));
  if (fixed) roots.forEach((r) => open.add(r));
  const tree = () => {
    const rows = [];
    const walk = (id, d, implied) => {
      const kids = S.children(id).filter((k) => cardsIn([k]).length);
      const on = sel.has(id) || id === fixed;
      const lock = implied || id === fixed;
      rows.push(`<div class="srow" style="--d:${d}">
        ${kids.length ? `<button class="caret ${open.has(id) ? 'open' : ''}" data-o="${id}"></button>` : '<span class="caret leaf"></span>'}
        <label class="${lock ? 'implied' : ''}"><input type="checkbox" data-s="${id}" ${on || implied ? 'checked' : ''} ${lock ? 'disabled' : ''}><span>${esc(S.node(id).title || '제목 없음')}${id === fixed ? ' <small class="muted">(이 세트)</small>' : ''}</span></label>
        <small class="muted">${cardsIn([id]).length}장</small></div>`);
      if (open.has(id)) for (const k of kids) walk(k, d + 1, implied || on);
    };
    roots.forEach((r) => walk(r, 0, false));
    return rows.join('');
  };
  return openDialog(`<div class="dlg-body">
    <p class="dlg-msg">${esc(title || (name ? '세트 범위 편집' : '새 세트'))}</p>
    ${named ? `<input class="input" id="psName" placeholder="세트 이름 (예: 산과 내과질환)" value="${esc(name)}">` : ''}
    <p class="muted small">${named ? '묶을 갈래를 고르세요.' : '함께 외울 갈래를 여러 개 고르세요.'} 고른 갈래 아래 전체가 세트에 들어가요.</p>
    <div class="scope-tree tall" id="psTree">${tree()}</div>
    <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button><button class="btn primary" id="psOk">저장</button></div></div>`, {
    onMount(d, close) {
      const box = d.querySelector('#psTree');
      box.addEventListener('click', (e) => {
        const o = e.target.closest('[data-o]');
        if (o) { open.has(o.dataset.o) ? open.delete(o.dataset.o) : open.add(o.dataset.o); box.innerHTML = tree(); return; }
        const c = e.target.closest('input[data-s]');
        if (c) {
          const id = c.dataset.s;
          // 이 세트를 감싸는 갈래는 고를 수 없다 (그 갈래 세트를 열면 된다)
          if (fixed && c.checked && S.isAncestor(id, fixed)) { toast('이 세트를 포함하는 갈래는 그 갈래 세트를 열어 학습해 주세요'); box.innerHTML = tree(); return; }
          if (c.checked) { for (const x of [...sel]) if (S.isAncestor(id, x)) sel.delete(x); sel.add(id); } else sel.delete(id);
          box.innerHTML = tree();
        }
      });
      d.querySelector('#psOk').onclick = () => {
        const nm = named ? d.querySelector('#psName').value.trim() : '';
        if (named && !nm) return d.querySelector('#psName').focus();
        if (named && !sel.size) return toast('범위를 하나 이상 골라 주세요');
        close({ name: nm, scope: [...sel] });
      };
      if (named && !name) d.querySelector('#psName').focus();
    },
  });
}

// ---------- 카드 ----------
function backHtml(id) {
  const n = S.node(id);
  const kids = S.children(id);
  const note = (n.note || '').trim();
  const list = kids.length ? `<ol class="kid-list">${kids.map((k) => `<li>${esc(S.node(k).title || '제목 없음')}</li>`).join('')}</ol>` : '';
  if (note) return `<div class="md big">${renderMd(note)}</div>${list ? `<div class="back-sub"><h4>하위 ${kids.length}</h4>${list}</div>` : ''}`;
  return `<h4 class="back-h">하위 갈래 ${kids.length}</h4>${list}`;
}

// 📍 어디에 속하는지: 위 갈래 경로 + 바로 위 갈래에서 갈라지는 같은 층 갈래들 (누를 때만 보여 줌)
let whereFor = null;
// 마인드맵처럼 왼쪽 → 오른쪽: 위 갈래들이 한 줄로 이어지고, 바로 위 갈래에서 같은 층 갈래들이 갈라진다
const BRANCH = ['#007aff', '#ff9500', '#34c759', '#af52de', '#ff2d55', '#5ac8fa', '#5856d6', '#ff3b30', '#e0b000', '#00c7be'];
function whereHtml(id) {
  const par = S.parentOf(id);
  const path = S.path(id).slice(0, -1);
  const sibs = par ? S.children(par) : S.roots();
  return `<div class="where-top"><b>어디에 속할까 <small>${par ? `「${esc(S.node(par).title || '제목 없음')}」에서 갈라지는 ${sibs.length}갈래` : `과목 ${sibs.length}`}</small></b><button class="icon-btn small" data-act="where" title="닫기 (I)">✕</button></div>
    ${path.length > 1 ? `<div class="wm-crumbs">${path.slice(0, -1).map((x) => `<span>${esc(x.title || '제목 없음')}</span>`).join('<i>›</i>')}<i>›</i></div>` : ''}
    <div class="wm-scroll"><div class="wm" id="wm"><svg class="wm-lines" aria-hidden="true"></svg>
      ${path.map((x, i) => `<div class="wm-col ${i < path.length - 1 ? 'wm-up' : ''}"><span class="wm-node wm-anc">${esc(x.title || '제목 없음')}</span></div>`).join('')}
      <div class="wm-col wm-sibs">${sibs.map((k, i) => `<span class="wm-node wm-sib ${k === id ? 'me' : ''}" style="--c:${BRANCH[i % BRANCH.length]}">${esc(S.node(k).title || '제목 없음')}</span>`).join('')}</div>
    </div></div>
    <p class="wm-more muted small">‹ 옆으로 밀면 위 갈래</p>`;
}

// 갈래 사이 곡선은 글자 자리가 정해진 뒤 그린다 (보일 때만)
function drawWhere() {
  const wm = $('#wm', el);
  const box = $('#where', el);
  if (!wm || !box || box.hidden) return;
  // 다 안 들어가면(휴대폰) 위 갈래들은 지도 위에 경로로 접고, 바로 위 갈래 → 같은 층 갈래만 그린다
  const sc = wm.parentElement;
  box.classList.remove('compact');
  if (sc.scrollWidth > sc.clientWidth + 1 && wm.querySelector('.wm-up')) box.classList.add('compact');
  const base = wm.getBoundingClientRect();
  const pt = (n, right) => { const r = n.getBoundingClientRect(); return { x: (right ? r.right : r.left) - base.left, y: r.top + r.height / 2 - base.top }; };
  const curve = (p, q, color, w) => {
    const mx = (p.x + q.x) / 2;
    return `<path d="M${p.x + 4} ${p.y} C${mx} ${p.y} ${mx} ${q.y} ${q.x - 2} ${q.y}" style="stroke:${color};stroke-width:${w}" />`;
  };
  const anc = [...wm.querySelectorAll('.wm-anc')].filter((n) => n.offsetParent);
  const out = [];
  for (let i = 0; i + 1 < anc.length; i++) out.push(curve(pt(anc[i], true), pt(anc[i + 1], false), 'var(--g-edge)', 2.4));
  const last = anc[anc.length - 1];
  if (last) for (const sb of wm.querySelectorAll('.wm-sib')) out.push(curve(pt(last, true), pt(sb, false), sb.style.getPropertyValue('--c'), sb.classList.contains('me') ? 3 : 1.8));
  const svg = wm.querySelector('svg');
  svg.setAttribute('width', wm.scrollWidth);
  svg.setAttribute('height', wm.scrollHeight);
  svg.innerHTML = out.join('');
  // 좁은 화면이면 같은 층 갈래 쪽이 보이게 (위 갈래는 옆으로 밀어서)
  sc.scrollLeft = sc.scrollWidth;
  box.classList.toggle('more', sc.scrollWidth > sc.clientWidth + 1);
}

function toggleWhere() {
  if (!session || session.done || session.paused) return;
  const id = session.cards[session.i];
  whereFor = whereFor === id ? null : id;
  const box = $('#where', el);
  if (box) box.hidden = whereFor !== id;
  $('[data-act="where"].where-btn', el)?.classList.toggle('on', whereFor === id);
  drawWhere();
}

function renderCard() {
  const s = session;
  const id = s.cards[s.i];
  const n = S.node(id);
  if (whereFor !== id) whereFor = null;
  el.innerHTML = `<div class="play" style="--scale:${S.settings.cardScale}">
    <div class="play-top">
      <button class="icon-btn" data-act="quit" title="끝내기 (Esc)">✕</button>
      <div class="play-title"><b>${s.i + 1} / ${s.cards.length}</b><small>${esc(s.title)}</small></div>
      <button class="icon-btn drive-btn ${Drive.enabled() ? 'on' : ''}" data-act="drive" title="운전 모드 (앞면 읽기 · 핸들 버튼)">🚗</button>
      <button class="icon-btn where-btn ${whereFor === id ? 'on' : ''}" data-act="where" title="어디에 속하는지 (I)">📍</button>
      ${browsing() ? '<button class="icon-btn" data-act="shuffle-now" title="섞기">⇄</button>' : `<button class="icon-btn" data-act="undo" ${s.hist.length ? '' : 'disabled'} title="되돌리기 (Z)">↶</button>`}
    </div>
    <div class="bar"><i style="width:${((s.i + (browsing() ? 1 : 0)) / s.cards.length) * 100}%"></i></div>
    ${browsing() ? '<div class="tally browse"><span class="t-mode">넘기며 외우기 · 기록 안 됨</span></div>' : `<div class="tally"><span class="t-no">${s.unknown.length}</span><span class="t-yes">${s.known.length}</span></div>`}
    ${Drive.enabled() ? '<div class="drive-bar"><span>🚗 핸들 ⏭ 다음 · ⏮ 이전 · ⏯ 뒤집기</span><button class="link" data-act="say">🔊 다시 듣기</button></div>' : ''}
    <div class="where" id="where" ${whereFor === id ? '' : 'hidden'}>${whereHtml(id)}</div>
    <div class="flip ${s.flipped ? 'flipped' : ''}" id="flash">
      <div class="face front">
        <div class="term">${esc(n.title || '제목 없음')}</div>
        <button class="star ${n.star ? 'on' : ''}" data-act="star" title="별표">★</button>
        <span class="flip-hint">${browsing() ? '눌러서 뒤집기 · 옆으로 밀어서 넘기기' : '눌러서 뒤집기'}</span>
      </div>
      <div class="face back">
        <div class="back-title">${esc(n.title)}</div>
        <div class="back-body">${backHtml(id)}</div>
      </div>
    </div>
    <div class="play-actions">${browsing()
      ? `<button class="judge nav" data-act="prev" ${s.i ? '' : 'disabled'} title="이전 (←)">‹<span>이전</span></button>
         <button class="judge nav flipbtn" data-act="flip" title="뒤집기 (Space)">↻<span>뒤집기</span></button>
         <button class="judge nav" data-act="next" title="다음 (→)">${s.i + 1 >= s.cards.length ? '✓<span>끝</span>' : '›<span>다음</span>'}</button>`
      : `<button class="judge no" data-judge="0" title="몰라요 (←, 1)">✕<span>몰라요</span></button>
         <button class="judge yes" data-judge="1" title="알아요 (→, 2)">✓<span>알아요</span></button>`}
    </div>
  </div>`;
  if (whereFor === id) requestAnimationFrame(drawWhere);
  driveCard();
}

function renderSummary() {
  const s = session;
  driveSummary();
  if (s.mode === 'browse') {
    el.innerHTML = `<div class="page narrow">
      <header class="page-h"><div><h1>다 봤어요 👏</h1><p class="sub">${esc(s.title)} · ${s.cards.length}장</p></div></header>
      <div class="sum-actions">
        <button class="btn primary big wide" data-act="restart">처음부터 다시 보기</button>
        <button class="btn big wide" data-act="to-test">알아요 · 몰라요로 확인하기</button>
        <button class="btn ghost wide" data-act="to-set">세트로 돌아가기</button>
      </div></div>`;
    return;
  }
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
      <button class="btn ghost wide" data-act="to-set">세트로 돌아가기</button>
    </div>
  </div>`;
}

// ---------- 운전 모드 ----------
// 카드가 바뀔 때마다 앞면을 읽는다 (같은 카드를 다시 그릴 때는 다시 읽지 않음)
let driveKey = null;
function sideText(id, back) {
  const n = S.node(id);
  if (!back) return n.title || '제목 없음';
  const kids = S.children(id).map((k) => S.node(k).title).filter(Boolean);
  return Drive.plain(n.note) || (kids.length ? `하위 ${kids.length}갈래. ${kids.join(', ')}` : '');
}
const driveHandlers = () => ({
  next: () => (session?.done ? driveAgain() : browsing() ? move(1) : judge(true)),
  prev: () => (session?.done ? null : browsing() ? move(-1) : judge(false)),
  toggle: () => {
    if (!session || session.done || session.paused) return;
    flip();
    Drive.speak(sideText(session.cards[session.i], session.flipped));
  },
});

async function driveCard() {
  if (!Drive.enabled()) return driveOff();
  Drive.activate(driveHandlers());
  const s = session;
  const id = s.cards[s.i];
  const key = `${s.started}|${s.i}|${id}`;
  if (driveKey === key) return;
  driveKey = key;
  Drive.nowPlaying(S.node(id).title || '제목 없음', `${s.i + 1} / ${s.cards.length} · ${s.title}`);
  const done = await Drive.speak(sideText(id, s.flipped));
  // 뒷면도 읽기: 떠올릴 시간을 조금 두고
  if (!done || !S.settings.ttsBack || s.flipped) return;
  await new Promise((r) => setTimeout(r, 2500));
  if (driveKey !== key || session !== s || s.flipped || s.paused || s.done) return;
  flip();
  Drive.speak(sideText(id, true));
}

function driveSummary() {
  if (!Drive.enabled()) return driveOff();
  Drive.activate(driveHandlers());
  const s = session;
  const key = `${s.started}|done`;
  if (driveKey === key) return;
  driveKey = key;
  const unknown = s.unknown.filter((x) => S.node(x)).length;
  Drive.nowPlaying('다 봤어요', s.title);
  Drive.speak(s.mode === 'test' && unknown ? `끝났어요. 모르는 카드 ${unknown}장. 다음 버튼을 누르면 모르는 카드만 다시 봐요.` : '다 봤어요. 다음 버튼을 누르면 처음부터 다시 봐요.');
}

// 결과 화면에서 핸들 ⏭: 모르는 카드(없으면 처음부터) 다시
function driveAgain() {
  const s = session;
  const unknown = s.unknown.filter((x) => S.node(x));
  if (s.mode === 'test' && unknown.length) return begin(reorder(unknown), s.title, s.from, 'test');
  begin(reorder(s.cards.filter((x, i, a) => a.indexOf(x) === i && S.node(x))), s.title, s.from, s.mode);
}

function driveOff() { driveKey = null; Drive.deactivate(); }
// 다른 화면으로 가면 읽기와 핸들 버튼 연결을 끈다
export const leave = () => driveOff();

// ---------- 동작 ----------
function flip() {
  if (!session || session.done || session.paused) return;
  session.flipped = !session.flipped;
  persist();
  $('#flash', el)?.classList.toggle('flipped', session.flipped);
}

// 넘기며 외우기: 앞뒤로만 이동 (진도 기록 없음)
function move(d) {
  const s = session;
  if (!s || s.done || s.paused) return;
  if (d < 0 && s.i === 0) return;
  s.i += d;
  s.flipped = false;
  if (s.i >= s.cards.length) { s.i = s.cards.length - 1; s.done = true; }
  persist();
  const f = $('#flash', el);
  if (f && !s.done) { f.classList.add(d > 0 ? 'out-l' : 'out-r'); setTimeout(render, 140); } else render();
}

function judge(known) {
  if (browsing()) return move(known ? 1 : -1);
  const s = session;
  if (!s || s.done || s.paused || s.i >= s.cards.length) return;
  const id = s.cards[s.i];
  const prev = S.as('train', () => S.rate(PKEY(id), known ? 3 : 1));
  (known ? s.known : s.unknown).push(id);
  s.hist.push({ id, known, prev });
  s.i++;
  s.flipped = false;
  if (s.i >= s.cards.length) s.done = true;
  persist();
  const f = $('#flash', el);
  if (f && !s.done) { f.classList.add(known ? 'out-r' : 'out-l'); setTimeout(render, 160); } else render();
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
  if (browsing()) return backToSet();
  if (session.hist.length && !(await confirmDlg('학습을 끝낼까요?', { ok: '끝내기' }))) return;
  if (session.hist.length) { session.done = true; persist(); return render(); }
  backToSet();
}

function backToSet() {
  const from = session?.from;
  session = null;
  persist();
  view = from || view;
  render();
}

async function startFromSet() {
  const set = currentSet();
  const p = prefsFor(set);
  const cards = buildDeck(set, p);
  if (!cards.length) return toast('카드가 없어요');
  if (hasSession() && !browsing() && session.hist.length && !(await confirmDlg('진행 중인 학습을 닫고 새로 시작할까요?', { ok: '새로 시작' }))) return;
  const lv = p.leaf ? ' · 맨 끝 갈래' : p.levels.length ? ' · ' + p.levels.map((d) => S.levelName(d)).join(', ') : '';
  begin(cards, set.title + lv, { ...view });
}

function updatePref(fn) {
  const set = currentSet();
  const p = prefsFor(set);
  fn(p);
  savePrefs(set, p);
  renderSet();
}

async function onClick(e) {
  const t = e.target;
  const seg = t.closest('[data-seg] button');
  if (seg) { S.saveSettings({ [seg.closest('[data-seg]').dataset.seg]: seg.dataset.v }); return renderSet(); }
  if (t.matches('input[data-pref]')) return updatePref((p) => { p[t.dataset.pref] = t.checked; });
  const tab = t.closest('[data-subject]');
  if (tab) { Subject.set(tab.dataset.subject); return renderLibraryList(); }
  const b = t.closest('[data-act],[data-level],[data-judge],[data-node],[data-preset],[data-special],[data-subjf],[data-rmextra],[data-libopen],[data-star],[data-open],[data-unsave]');
  if (!b) {
    if (t.closest('#flash') && !t.closest('a,button')) flip();
    return;
  }
  if (b.dataset.level) {
    const d = +b.dataset.level;
    // 맨 끝 갈래에서 레벨을 누르면 그 레벨 하나로 시작
    return updatePref((p) => {
      if (p.leaf) { p.leaf = false; p.levels = [d]; return; }
      p.levels = p.levels.includes(d) ? p.levels.filter((x) => x !== d) : [...p.levels, d].sort((a, b) => a - b);
    });
  }
  if (b.dataset.judge) return judge(b.dataset.judge === '1');
  if (b.dataset.libopen) {
    const id = b.dataset.libopen;
    libOpen.has(id) ? libOpen.delete(id) : libOpen.add(id);
    lsSet('galrae.v1.libOpen', [...libOpen]);
    return renderLibraryList();
  }
  if (b.dataset.node) return api.go('train', b.dataset.node);
  if (b.dataset.preset) return api.go('train', 'set:' + b.dataset.preset);
  if (b.dataset.special) return api.go('train', b.dataset.special);
  if ('subjf' in b.dataset) { patchPrefs(currentSet().key, { subj: b.dataset.subjf || null }); return renderSet(); }
  if (b.dataset.rmextra) { const set = currentSet(); patchPrefs(set.key, { extra: set.extra.filter((x) => x !== b.dataset.rmextra), at: now() }); return renderSet(); }
  if (b.dataset.unsave) {
    const id = b.dataset.unsave;
    if (!(await confirmDlg(`'${S.node(id).title || '제목 없음'}'에서 함께 학습할 갈래를 뺄까요?`, { ok: '빼기', detail: '저장된 세트에서 빠지고, 갈래와 카드는 그대로예요.' }))) return;
    patchPrefs(id, { extra: [] });
    return renderLibrary();
  }
  if (b.dataset.star) {
    const id = b.dataset.star;
    S.as('train', () => S.updateNode(id, { star: !S.node(id).star }));
    return b.classList.toggle('on', S.node(id).star);
  }
  if (b.dataset.open) return api.go('tree', b.dataset.open);
  switch (b.dataset.act) {
    case 'resume': session.paused = false; return render();
    case 'list': return api.go('train', 'list');
    case 'start': return startFromSet();
    case 'leaf': return updatePref((p) => { p.leaf = !p.leaf; });
    case 'undo': return undo();
    case 'quit': return quit();
    case 'star': {
      const id = session.cards[session.i];
      S.as('train', () => S.updateNode(id, { star: !S.node(id).star }));
      return b.classList.toggle('on', S.node(id).star);
    }
    case 'retry': return begin(reorder(session.unknown.filter((x) => S.node(x))), session.title, session.from, 'test');
    case 'prev': return move(-1);
    case 'next': return move(1);
    case 'flip': return flip();
    case 'where': return toggleWhere();
    case 'drive': {
      S.saveSettings({ driveMode: !Drive.enabled() });
      if (Drive.enabled()) toast('운전 모드: 카드 앞면을 읽어 줘요. 차와 블루투스로 연결하면 핸들 ⏮ ⏭ 로 넘겨요', { ms: 3500 });
      if (session && !session.paused) { driveKey = null; return render(); }
      return renderSet();
    }
    case 'drive-cfg': return Drive.settingsDialog();
    case 'say': driveKey = null; return driveCard();
    case 'shuffle-now': { const s = session; const rest = shuffle(s.cards.slice(s.i)); s.cards.splice(s.i, rest.length, ...rest); s.flipped = false; persist(); toast('남은 카드를 섞었어요', { ms: 1200 }); return render(); }
    case 'to-test': return begin(reorder(session.cards.filter((x, i, a) => a.indexOf(x) === i && S.node(x))), session.title, session.from, 'test');
    case 'restart': return begin(reorder(session.cards.filter((x, i, a) => a.indexOf(x) === i && S.node(x))), session.title, session.from, session.mode);
    case 'to-set': return backToSet();
    case 'new-preset': {
      const r = await pickRanges();
      if (!r) return;
      const id = S.savePreset(r.name, { scope: r.scope, levels: [] });
      return api.go('train', 'set:' + id);
    }
    case 'add-ranges': {
      const set = currentSet();
      const sub = subjectOf(set.node.id);
      const r = await pickRanges(set.extra, '', { roots: [sub], fixed: set.node.id, named: false, title: `「${S.node(sub).title}」 안에서 함께 학습할 갈래` });
      if (!r) return;
      const extra = r.scope.filter((x) => x !== set.node.id && !S.isAncestor(set.node.id, x));
      patchPrefs(set.key, { extra, at: now() });
      // 레벨로 고르고 있었다면, 더한 갈래에서도 같은 단계(이 세트 기준으로 몇 단계 아래인지)를 함께 고른다
      const p = prefsFor(currentSet());
      if (!p.leaf && p.levels.length) {
        const base = S.depth(set.node.id);
        const add = extra.flatMap((x) => p.levels.map((d) => d - base + S.depth(x)));
        p.levels = [...new Set([...p.levels, ...add])].filter((d) => p.counts.has(d)).sort((a, b) => a - b);
        savePrefs(currentSet(), p);
      }
      return renderSet();
    }
    case 'name-set': {
      const set = currentSet();
      const name = await promptDlg('세트 이름 (비우면 기본 이름)', set.named ? set.title : '', `${set.node.title || '제목 없음'} 외 ${set.extra.length}`);
      if (name === null) return;
      patchPrefs(set.key, { name });
      return renderSet();
    }
    case 'save-preset': {
      const set = currentSet();
      const name = await promptDlg('내 세트 이름', set.title);
      if (!name) return;
      const id = S.savePreset(name, { scope: set.scope, leaf: prefsFor(set).leaf, levels: prefsFor(set).levels });
      toast('내 세트에 저장했어요');
      return api.go('train', 'set:' + id);
    }
    case 'edit-preset': {
      const set = currentSet();
      const r = await pickRanges(set.scope, set.title);
      if (!r) return;
      S.savePreset(r.name, { ...set.preset.opts, scope: r.scope }, set.preset.id);
      return renderSet();
    }
    case 'rename-preset': {
      const set = currentSet();
      const name = await promptDlg('세트 이름', set.title);
      if (name) { S.savePreset(name, set.preset.opts, set.preset.id); renderSet(); }
      return;
    }
    case 'del-preset': {
      const set = currentSet();
      if (!(await confirmDlg(`'${set.title}' 세트를 삭제할까요?`, { ok: '삭제', danger: true, detail: '갈래와 외울 것은 그대로 남아요.' }))) return;
      S.deletePreset(set.preset.id);
      return api.go('train', 'list');
    }
  }
}

function onKey(e) {
  if (!el || el.hidden || !session || session.paused) return;
  if (e.target.closest('input,textarea,[contenteditable],dialog')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  // 결과 화면에서도 마지막 카드는 되돌릴 수 있게
  if (session.done) { if (k === 'z' || k === 'Z') undo(); return; }
  if (k === 'i' || k === 'I' || k === 'ㅑ') return toggleWhere();
  if (k === 'Escape' && whereFor) return toggleWhere();
  if (k === ' ' || k === 'Enter' || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); flip(); }
  else if (browsing() && k === 'ArrowLeft') move(-1);
  else if (browsing() && k === 'ArrowRight') move(1);
  else if (browsing()) return;
  else if (k === 'ArrowLeft' || k === '1') judge(false);
  else if (k === 'ArrowRight' || k === '2') judge(true);
  else if (k === 'z' || k === 'Z' || k === 'Backspace') { e.preventDefault(); undo(); }
  else if (k === 'Escape') quit();
}

// 카드를 오른쪽으로 밀면 알아요, 왼쪽은 몰라요
function bindSwipe() {
  let st = null;
  el.addEventListener('pointerdown', (e) => {
    const f = e.target.closest('#flash');
    if (!f || e.pointerType === 'mouse') return;
    const body = f.querySelector('.back-body');
    if (e.target.closest('.back-body') && body.scrollHeight > body.clientHeight) return;
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
    if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.2) { if (browsing()) move(dx < 0 ? 1 : -1); else judge(dx > 0); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { if (st) { st.f.style.translate = ''; st.f.style.rotate = ''; st = null; } });
}
