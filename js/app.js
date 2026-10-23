// 갈래 — 경우의 수 트레이너
import * as S from './store.js';
import * as Sync from './sync.js';
import * as Train from './train.js';
import * as Tree from './outline.js';
import * as GV from './graphview.js';
import * as Images from './images.js';
import * as Zoom from './zoom.js';
import { $, $$, esc, toast, openDialog, confirmDlg, download, copyText, timeAgo, todayKey, composing, debounce } from './util.js';

const VIEWS = ['tree', 'graph', 'train', 'settings'];
let current = 'tree';
const dirty = new Set();

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/>',
  train: '<rect x="3.5" y="5" width="13" height="15" rx="2"/><path d="M8 3h10.5a2 2 0 0 1 2 2v12.5"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="m8.2 7.2 7.6.6M7 8.3l1.4 7.4M16.3 9.9l-5.6 6.3"/>',
  tree: '<path d="M4 5h6M8 12h6M8 19h6M6 5v14h2M6 12h2"/><circle cx="18" cy="12" r="1.2"/><circle cx="18" cy="19" r="1.2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6l2.1 2.1M17.7 15.9l2.1 2.1M2.5 12h3M18.5 12h3M4.2 18l2.1-2.1M17.7 8.1 19.8 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  bolt: '<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${ICONS[n]}</svg>`;
const LABELS = { tree: '정리', graph: '마인드맵', train: '카드 학습', settings: '설정' };

// ---------- 시작 ----------
if (!Sync.handleAuthReturn()) boot();

function boot() {
  S.load();
  applyTheme();
  Images.init();
  Zoom.init();
  $('#nav').innerHTML = `<div class="brand"><img src="icons/icon.svg" alt=""><div><b>갈래</b><small>경우의 수 트레이너</small></div></div>
    ${VIEWS.map((v) => `<a href="#${v}" data-view="${v}">${icon(v)}<span>${LABELS[v]}</span></a>`).join('')}
    <button class="nav-search" data-act="palette" title="찾기 (Ctrl+K)">${icon('search')}<span>찾기</span><kbd>Ctrl K</kbd></button>
    <button class="sync-chip" id="syncChip" data-act="sync-chip"></button>`;
  const hooks = { go, train: trainScope, toast, importDialog, exportDialog };
  Train.init($('#view-train'), hooks);
  Tree.init($('#view-tree'), hooks);
  GV.init($('#view-graph'), hooks);
  $('#view-settings').addEventListener('click', onSettingsClick);
  $('#view-settings').addEventListener('change', onSettingsChange);
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="palette"],[data-act="sync-chip"]');
    if (!b) return;
    if (b.dataset.act === 'palette') palette();
    else if (Sync.info().status === 'login') Sync.login();
    else if (Sync.info().enabled) Sync.runSync({ manual: true });
    else go('settings');
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
    // '/' 빠른 찾기: 글을 쓰는 곳(입력칸·외울 것 편집기)에서는 그냥 '/' 입력
    else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input,textarea,select,dialog,[contenteditable]') && !e.target.isContentEditable && current !== 'train') { e.preventDefault(); palette(); }
  });
  S.onChange(onStoreChange);
  Sync.onStatus(renderSyncChip);
  Sync.init();
  renderSyncChip(Sync.info());
  window.addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  route();
  setTimeout(showInstallBar, 1500);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // 새 버전이 설치되어 화면을 넘겨받으면 한 번 새로고침 (처음 설치 때는 제외)
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
}

function applyTheme() {
  const t = S.settings.theme;
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.dark = dark ? '1' : '0';
  $('meta[name="theme-color"]').content = dark ? '#000000' : '#f2f2f7';
  GV.themeChanged?.();
}

// ---------- 앱으로 설치 (PWA) ----------
let installEvt = null;
const MOBILE = /android/i.test(navigator.userAgent);
const installed = () => matchMedia('(display-mode: standalone)').matches;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; showInstallBar(); if (current === 'settings') renderSettings(); });
window.addEventListener('appinstalled', () => { installEvt = null; $('#installBar')?.remove(); toast('앱으로 설치했어요. 홈 화면에서 열어 보세요'); });

function showInstallBar() {
  if (installed() || $('#installBar') || S.settings.installHidden) return;
  if (!MOBILE && !installEvt) return;
  const bar = document.createElement('div');
  bar.id = 'installBar';
  bar.className = 'install-bar';
  bar.innerHTML = `<img src="icons/icon-192.png" alt=""><div><b>갈래를 앱으로 설치</b><small>홈 화면에서 바로 열고, 오프라인에서도 써요</small></div>
    <button class="btn primary small" data-act="install">설치</button><button class="x" data-act="install-x" aria-label="닫기">✕</button>`;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'install') installApp();
    else { S.saveSettings({ installHidden: true }); bar.remove(); }
  });
  document.body.append(bar);
}

async function installApp() {
  if (installed()) return toast('이미 앱으로 실행 중이에요');
  if (installEvt) {
    installEvt.prompt();
    const r = await installEvt.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') $('#installBar')?.remove();
    installEvt = null;
    return;
  }
  // 안드로이드 (갤럭시 폰·태블릿): 크롬 / 삼성 인터넷
  const samsung = /SamsungBrowser/i.test(navigator.userAgent);
  const steps = samsung
    ? `<li>주소창 오른쪽의 <b>⬇ 설치 아이콘</b>을 누르거나</li><li>아래 <b>≡ 메뉴 → 현재 페이지 추가 → 홈 화면</b></li><li><b>추가</b>를 누르면 홈 화면에 갈래 아이콘이 생겨요</li>`
    : `<li>Chrome 오른쪽 위 <b>⋮ 메뉴</b>를 누르세요</li><li><b>앱 설치</b> (또는 <b>홈 화면에 추가 → 설치</b>)를 누르세요</li><li>홈 화면·앱 서랍에 갈래 아이콘이 생겨요</li>`;  openDialog(`<div class="dlg-body">
    <p class="dlg-msg">홈 화면에 앱으로 설치</p>
    <ol class="install-steps">${steps}</ol>
    <p class="muted small">설치하면 주소창 없이 앱처럼 열리고, 인터넷이 없어도 마지막으로 열었던 내용을 볼 수 있어요. 데이터는 Google 로그인으로 PC와 동기화돼요.</p>
    <div class="dlg-actions"><button class="btn primary" data-close="">확인</button></div></div>`);
}
// ---------- 라우팅 ----------
export function go(view, id) {
  const h = '#' + view + (id ? '/' + id : '');
  if (location.hash === h) route(); else location.hash = h;
}

function trainScope(id) {
  go('train', id);
}

function route() {
  const [v, id] = location.hash.slice(1).split('/');
  const view = VIEWS.includes(v) ? v : 'tree';
  current = view;
  for (const x of VIEWS) $('#view-' + x).hidden = x !== view;
  for (const a of $$('#nav a')) a.classList.toggle('on', a.dataset.view === view);
  document.body.dataset.view = view;
  if (view !== 'train') Train.leave();
  if (view === 'train') Train.show(id);
  else if (view === 'graph') GV.show(id);
  else if (view === 'tree') Tree.show(id);
  else if (view === 'settings') renderSettings();
  dirty.delete(view);
}

function onStoreChange(o) {
  for (const v of VIEWS) if (v !== current) dirty.add(v);
  GV.markDirty();
  if (current === 'tree') Tree.onStoreChange(o);
  else if (current === 'graph') GV.update();
  else if (current === 'settings' && o.src !== 'settings') renderSettings();
  else if (current === 'train' && o.src !== 'train') Train.render();
  // 다른 화면은 다시 들어갈 때 새로 그린다
  if (current !== 'tree') dirty.add('tree');
}

// ---------- 동기화 표시 ----------
function renderSyncChip(i) {
  const chip = $('#syncChip');
  if (!chip) return;
  const map = {
    off: ['off', '동기화 꺼짐'],
    idle: ['idle', '동기화 대기'],
    syncing: ['busy', '동기화 중…'],
    ok: ['ok', `동기화됨 · ${timeAgo(i.lastSync)}`],
    login: ['warn', '다시 로그인 필요'],
    error: ['err', '동기화 오류'],
  };
  const [cls, label] = map[i.status] || map.idle;
  chip.className = 'sync-chip ' + cls;
  chip.innerHTML = `<i></i><span>${esc(label)}</span>`;
  chip.title = i.error || (i.email ? `${i.email} · 눌러서 지금 동기화` : '설정에서 Google Drive 연결');
  if (current === 'settings') renderSettings();
}
setInterval(() => { if (Sync.info().status === 'ok') renderSyncChip(Sync.info()); }, 60e3);

// ---------- 설정 ----------
function renderSettings() {
  const el = $('#view-settings');
  const i = Sync.info();
  const st = S.settings;
  const statusText = { off: '꺼짐', idle: '대기', syncing: '동기화 중…', ok: `완료 · ${timeAgo(i.lastSync)}`, login: '로그인 필요', error: '오류' }[i.status];
  const active = document.activeElement;
  if (active && el.contains(active) && active.matches('input[type=text],textarea')) return;
  el.innerHTML = `<div class="page narrow">
    <header class="page-h"><div><h1>설정</h1></div></header>
    ${installed() ? '' : `<section class="panel install-panel"><img src="icons/icon-192.png" alt=""><div><b>앱으로 설치</b><span class="muted small">홈 화면에 앱으로 추가 (갤럭시 폰·태블릿, PC Chrome)</span></div><button class="btn primary" data-act="install">설치</button></section>`}
    <section class="panel">
      <h3>Google Drive 동기화</h3>
      <p class="muted small">PC·모바일 어디서든 같은 데이터를 써요. 내 드라이브의 <code>Galrae/galrae-data.json</code> 파일 하나만 사용하며(drive.file 권한), 다른 파일은 읽지 않아요.</p>
      <div class="kv"><span>상태</span><b class="sync-state ${i.status}">${esc(statusText)}</b></div>
      ${i.email ? `<div class="kv"><span>계정</span><b>${esc(i.email)}</b></div>` : ''}
      ${i.error ? `<p class="err small">${esc(i.error)}</p>` : ''}
      <div class="btn-row">
        ${!i.enabled || i.status === 'login' ? '<button class="btn primary" data-act="login">Google로 로그인</button>' : '<button class="btn primary" data-act="sync-now">지금 동기화</button><button class="btn ghost" data-act="logout">연결 해제</button>'}
      </div>
      <label class="check"><input type="checkbox" data-set="auto" ${i.auto ? 'checked' : ''}> 변경하면 자동으로 동기화</label>
      <details class="adv"><summary>고급: OAuth 클라이언트 ID</summary>
        <p class="muted small">Google Cloud Console의 OAuth 웹 클라이언트에 이 주소를 <b>승인된 JavaScript 원본</b>과 <b>승인된 리디렉션 URI</b>로 등록해야 해요.</p>
        <div class="kv"><span>원본</span><code class="sel">${esc(location.origin)}</code></div>
        <div class="kv"><span>리디렉션</span><code class="sel">${esc(Sync.redirectUri())}</code></div>
        <input class="input" type="text" data-set="clientId" placeholder="${esc(Sync.DEFAULT_CLIENT_ID)}" value="${esc(i.clientId)}">
      </details>
    </section>
    <section class="panel">
      <h3>학습</h3>
      <div class="kv"><span>카드 글자 크기</span><div class="seg" data-seg="cardScale">${[[0.9, '작게'], [1, '보통'], [1.15, '크게'], [1.3, '아주 크게']].map(([v, l]) => `<button class="${st.cardScale == v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="btn-row"><button class="btn ghost danger" data-act="reset-progress">학습 기록 초기화</button></div>
    </section>
    <section class="panel">
      <h3>레벨 이름</h3>
      <p class="muted small">트리 깊이마다 부를 이름이에요. 쉼표로 구분.</p>
      <input class="input" type="text" data-set="levelNames" value="${esc(st.levelNames.join(', '))}">
    </section>
    <section class="panel">
      <h3>화면</h3>
      <div class="kv"><span>테마</span><div class="seg" data-seg="theme">${[['system', '시스템'], ['light', '밝게'], ['dark', '어둡게']].map(([v, l]) => `<button class="${st.theme === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
    </section>
    <section class="panel">
      <h3>데이터</h3>
      <div class="btn-row">
        <button class="btn" data-act="import">텍스트 가져오기</button>
        <button class="btn" data-act="export">텍스트 내보내기</button>
        <button class="btn" data-act="backup">JSON 백업</button>
        <button class="btn" data-act="restore">JSON 복원</button>
        <button class="btn" data-act="sample">예시 데이터 추가</button>
        <button class="btn ghost danger" data-act="wipe">모든 갈래 삭제</button>
      </div>
      <p class="muted small">브라우저에 저장된 데이터는 동기화 없이도 유지돼요. 큰 작업 전엔 JSON 백업을 받아두면 안전해요.</p>
    </section>
    <section class="panel">
      <h3>단축키</h3>
      <div class="keys">
        <div><kbd>Ctrl</kbd><kbd>K</kbd> 또는 <kbd>/</kbd><span>갈래 찾기</span></div>
        <div><kbd>Space</kbd><span>카드 뒤집기</span></div>
        <div><kbd>←</kbd><kbd>→</kbd><span>몰라요 · 알아요</span></div>
        <div><kbd>Z</kbd><span>되돌리기</span></div>
        <div><kbd>Esc</kbd><span>학습 끝내기</span></div>
        <div><kbd>Enter</kbd><span>트리: 새 항목</span></div>
        <div><kbd>Tab</kbd><kbd>⇧Tab</kbd><span>트리: 들여/내어쓰기</span></div>
        <div><kbd>Alt</kbd><kbd>↑↓</kbd><span>트리: 순서 이동</span></div>
        <div><kbd>Ctrl</kbd><kbd>Enter</kbd><span>트리: 상세 열기</span></div>
      </div>
      <p class="muted small">모바일: 카드를 눌러 뒤집고, 오른쪽으로 밀면 알아요 · 왼쪽은 몰라요.</p>
    </section>
    <p class="muted small center">갈래 v2 · 데이터 ${S.count()}개 갈래</p>
  </div>`;
}

async function onSettingsClick(e) {
  const seg = e.target.closest('[data-seg] button');
  if (seg) {
    const name = seg.closest('[data-seg]').dataset.seg;
    const v = name === 'cardScale' ? +seg.dataset.v : seg.dataset.v;
    S.saveSettings({ [name]: v });
    if (name === 'theme') applyTheme();
    return renderSettings();
  }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  switch (b.dataset.act) {
    case 'install': return installApp();
    case 'login': return Sync.login();
    case 'logout': if (await confirmDlg('Google Drive 연결을 해제할까요?', { detail: '이 기기의 데이터는 그대로 남아요.' })) Sync.logout(); return;
    case 'sync-now': return Sync.runSync({ manual: true });
    case 'reset-progress':
      if (await confirmDlg('모든 학습 기록(숙련도)을 지울까요?', { ok: '초기화', danger: true, detail: '갈래와 내용은 남아요.' })) { S.resetProgress(); toast('학습 기록을 초기화했어요'); }
      return;
    case 'import': return importDialog(null);
    case 'export': return exportDialog(null);
    case 'backup': return download(`galrae-backup-${todayKey()}.json`, JSON.stringify(S.exportable(), null, 1), 'application/json');
    case 'restore': return restoreDialog();
    case 'sample': {
      const r = S.importOutline(SAMPLE_EXTRA, null);
      toast(`예시 ${r.added}개를 추가했어요`);
      return;
    }
    case 'wipe':
      if (await confirmDlg('모든 갈래를 삭제할까요?', { ok: '모두 삭제', danger: true, detail: '동기화 중이면 다른 기기에서도 삭제돼요. 먼저 JSON 백업을 권해요.' })) {
        S.wipeAll();
        toast('모두 삭제했어요');
      }
  }
}

function onSettingsChange(e) {
  const t = e.target;
  const k = t.dataset.set;
  if (!k) return;
  if (k === 'auto') Sync.setOptions({ auto: t.checked });
  else if (k === 'clientId') Sync.setOptions({ clientId: t.value.trim() });
  else if (k === 'levelNames') S.saveSettings({ levelNames: t.value.split(',').map((x) => x.trim()).filter(Boolean) });
  else S.saveSettings({ [k]: t.checked });
  toast('저장했어요', { ms: 1200 });
}

// ---------- 가져오기 / 내보내기 ----------
const IMPORT_EXAMPLE = `# 산부인과
## 임신의 내외과적 질환
- 임신과 당뇨병
	> - 선별: 24~28주 ==50g GCT==
	? 임신 26주 산모, 50g GCT 1시간 혈당 165
- 임신과 감염질환
	- B군 연쇄상구균
- 임신과 소화·신장·비뇨기 질환`;

function targetOptions(selId) {
  const opts = ['<option value="">최상위 (새 과목으로)</option>'];
  if (selId && S.node(selId)) opts.push(`<option value="${selId}" selected>${esc(S.path(selId).map((n) => n.title).join(' › '))} 의 하위로</option>`);
  return opts.join('');
}

export function importDialog(selId) {
  return openDialog(`<div class="dlg-body">
    <p class="dlg-msg">텍스트로 갈래 가져오기</p>
    <p class="muted small">교재 목차나 정리 노트를 붙여넣으세요. <b>들여쓰기</b>(Tab·스페이스) 또는 <code>#</code> 제목, <code>-</code> 목록으로 계층을 만들어요.
    <code>&gt; </code>로 시작하는 줄은 바로 위 항목의 <b>외울 것</b>, <code>? </code>는 <b>문제 단서</b>. 이미 있는 같은 이름 항목은 합쳐져요.</p>
    <label class="field">넣을 위치 <select class="input" id="impTarget">${targetOptions(selId)}</select></label>
    <textarea class="input mono" id="impText" rows="13" placeholder="${esc(IMPORT_EXAMPLE)}"></textarea>
    <div class="imp-foot"><label class="btn small">파일 열기 (.txt .md)<input type="file" accept=".txt,.md,.markdown,text/plain" hidden id="impFile"></label><span class="muted small" id="impInfo"></span></div>
    <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button><button class="btn primary" id="impGo">가져오기</button></div></div>`, {
    cls: 'wide',
    onMount(d, close) {
      const ta = d.querySelector('#impText');
      const info = () => {
        const items = S.parseOutline(ta.value);
        const maxLv = items.reduce((m, x) => Math.max(m, x.level + 1), 0);
        d.querySelector('#impInfo').textContent = items.length ? `${items.length}개 항목 · ${maxLv}단계 · 외울 것 ${items.filter((x) => x.note.length).length} · 단서 ${items.reduce((s, x) => s + x.cues.length, 0)}` : '';
      };
      ta.addEventListener('input', debounce(info, 200));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !composing(e)) { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); info(); }
      });
      d.querySelector('#impFile').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (f) { ta.value = await f.text(); info(); }
      });
      d.querySelector('#impGo').onclick = () => {
        if (!ta.value.trim()) return ta.focus();
        const target = d.querySelector('#impTarget').value || null;
        const r = S.importOutline(ta.value, target);
        close(true);
        toast(`${r.added}개 추가${r.merged ? ` · ${r.merged}개 합침` : ''}`);
        go('tree', target || undefined);
      };
      ta.focus();
    },
  });
}

export function exportDialog(selId) {
  return openDialog(`<div class="dlg-body">
    <p class="dlg-msg">텍스트로 내보내기</p>
    <label class="field">범위 <select class="input" id="expTarget"><option value="">전체</option>${selId && S.node(selId) ? `<option value="${selId}" selected>${esc(S.node(selId).title)} 이하</option>` : ''}</select></label>
    <textarea class="input mono" id="expText" rows="14" readonly></textarea>
    <p class="muted small">이 형식 그대로 다른 기기나 '텍스트 가져오기'에 붙여넣을 수 있어요. 옵시디언 등 마크다운 노트에도 그대로 쓸 수 있어요.</p>
    <div class="dlg-actions"><button class="btn ghost" data-close="">닫기</button><button class="btn" id="expDl">.md 저장</button><button class="btn primary" id="expCopy">복사</button></div></div>`, {
    cls: 'wide',
    onMount(d) {
      const ta = d.querySelector('#expText');
      const sel = d.querySelector('#expTarget');
      const fill = () => { ta.value = S.exportOutline(sel.value || null); };
      sel.addEventListener('change', fill);
      fill();
      d.querySelector('#expCopy').onclick = async () => toast((await copyText(ta.value)) ? '복사했어요' : '복사하지 못했어요');
      d.querySelector('#expDl').onclick = () => download(`galrae-${sel.value ? S.node(sel.value).title : '전체'}-${todayKey()}.md`, ta.value, 'text/markdown');
    },
  });
}

function restoreDialog() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch { return toast('JSON 파일을 읽지 못했어요'); }
    const mode = await openDialog(`<div class="dlg-body"><p class="dlg-msg">백업을 어떻게 불러올까요?</p>
      <p class="muted small">합치기: 지금 데이터와 항목별로 최신 것을 남겨요. 덮어쓰기: 지금 데이터를 백업 내용으로 바꿔요.</p>
      <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button><button class="btn danger" data-close="replace">덮어쓰기</button><button class="btn primary" data-close="merge">합치기</button></div></div>`);
    if (!mode) return;
    try { S.importJSON(obj, mode); toast('불러왔어요'); } catch (e) { toast(e.message); }
  };
  inp.click();
}

// ---------- 빠른 찾기 ----------
function palette() {
  if (document.querySelector('dialog.palette')) return;
  openDialog(`<div class="dlg-body">
    <input class="input big" placeholder="갈래 · 외울 것 · 단서 검색" type="search" autocomplete="off">
    <div class="pal-list"></div>
    <p class="muted small">Enter 트리에서 열기 · Shift+Enter 그래프 · Ctrl+Enter 학습</p></div>`, {
    cls: 'palette',
    onMount(d, close) {
      const inp = d.querySelector('input');
      const list = d.querySelector('.pal-list');
      let ids = [], k = 0;
      const draw = () => {
        ids = inp.value.trim() ? S.search(inp.value, 30) : S.descendants(null).filter((x) => S.depth(x) <= 2).slice(0, 30);
        k = Math.min(k, Math.max(0, ids.length - 1));
        list.innerHTML = ids.map((id, i) => {
          const p = S.path(id);
          return `<div class="pal-row ${i === k ? 'on' : ''}" data-i="${i}"><div><b>${esc(p[p.length - 1].title || '제목 없음')}</b><small>${p.slice(0, -1).map((x) => esc(x.title)).join(' › ')}</small></div>
            <span><button class="btn tiny" data-go="tree">편집</button><button class="btn tiny" data-go="graph">그래프</button><button class="btn tiny" data-go="train">학습</button></span></div>`;
        }).join('') || '<p class="muted center">결과 없음</p>';
      };
      const open = (i, where) => {
        const id = ids[i];
        if (!id) return;
        close(true);
        if (where === 'train') trainScope(id); else go(where, id);
      };
      inp.addEventListener('input', () => { k = 0; draw(); });
      inp.addEventListener('keydown', (e) => {
        if (composing(e)) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); k = Math.min(ids.length - 1, k + 1); draw(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); k = Math.max(0, k - 1); draw(); }
        else if (e.key === 'Enter') { e.preventDefault(); open(k, e.ctrlKey || e.metaKey ? 'train' : e.shiftKey ? 'graph' : 'tree'); }
      });
      list.addEventListener('click', (e) => {
        const row = e.target.closest('.pal-row');
        if (!row) return;
        open(+row.dataset.i, e.target.closest('[data-go]')?.dataset.go || 'tree');
      });
      draw();
      inp.focus();
    },
  });
}

const SAMPLE_EXTRA = `# 예시: 내과
## 순환기
- 허혈성 심질환
	- 안정형 협심증
	- 급성 관동맥 증후군
- 심부전
- 부정맥
## 호흡기
- 폐쇄성 폐질환
- 감염성 폐질환`;