// 브라우저 스모크 테스트: npm test   ·   스크린샷까지: npm run shots (→ .shots/)
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = process.argv.includes('--shots');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '.shots');

const server = await serve(PORT);
const browser = await launch();
let failed = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failed++;
};

async function freshPage(viewport = { width: 1280, height: 820 }, theme) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('pretendard')) errors.push(m.text()); });
  await page.evaluateOnNewDocument((t) => {
    if (!sessionStorage.getItem('init')) {
      localStorage.clear();
      if (t) localStorage.setItem('galrae.v1.settings', JSON.stringify({ theme: t }));
      sessionStorage.setItem('init', '1');
    }
  }, theme);
  await page.goto(BASE + '#tree', { waitUntil: 'networkidle0' });
  return { page, errors, ctx };
}

// 페이지 안에서 실행할 도우미
const H = `
  window.$ = (s) => document.querySelector(s);
  window.$$ = (s) => [...document.querySelectorAll(s)];
  window.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.click = (el) => { if (!el) throw new Error('no element'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
  window.key = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  window.go = async (h) => { location.hash = h; await sleep(120); };
`;

// ---------- 기능 테스트 ----------
{
  const { page, errors, ctx } = await freshPage();
  await page.evaluate(H);
  const r = await page.evaluate(async () => {
    const S = await import('./js/store.js');
    const out = {};
    out.seed = S.count();
    await go('#tree');
    const inp = $$('.orow')[1].querySelector('.otitle');
    inp.focus(); key(inp, 'Enter'); await sleep(30);
    out.enterAdds = $$('.orow').length === out.seed + 1 && document.activeElement.value === '';
    const ni = document.activeElement;
    ni.value = '테스트'; ni.dispatchEvent(new Event('input', { bubbles: true }));
    const nid = ni.closest('.orow').dataset.id;
    key(ni, 'ArrowDown', { altKey: true }); await sleep(30);
    out.altMove = S.children(S.parentOf(nid)).indexOf(nid) === 1;
    key(document.activeElement, 'Tab'); await sleep(30);
    out.tabIndent = S.depth(nid) === 4;
    key(document.activeElement, 'Tab', { shiftKey: true }); await sleep(30);
    out.shiftTab = S.depth(nid) === 3;
    document.activeElement.value = ''; key(document.activeElement, 'Backspace'); await sleep(30);
    out.backspaceDel = !S.node(nid);
    const gdm = S.findByTitle('임신과 당뇨병');
    const endOf = (el) => { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    await go('#tree/' + gdm);
    if (!$('.d-note-host .rich')) { click($('.detail [data-act="edit"]')); await sleep(20); }
    // 보이는 대로 편집기: 원래 마크다운이 그대로 되살아나는지
    const rich = $('.d-note-host .rich');
    out.richRoundtrip = rich.querySelectorAll('mark').length >= 5 && rich.querySelectorAll('[data-li="1"]').length === 6;
    endOf(rich.lastElementChild);
    document.execCommand('insertParagraph'); document.execCommand('insertText', false, '메모 형광펜');
    await sleep(800);
    out.noteSaved = S.node(gdm).note.includes('메모 형광펜');
    // 드래그(선택) 후 형광펜 버튼 → ==..== 로 저장, 기호를 직접 칠 필요 없음
    const last = rich.lastElementChild;
    const tn = [...last.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.includes('형광펜'));
    const rg = document.createRange(); rg.setStart(tn, tn.nodeValue.indexOf('형광펜')); rg.setEnd(tn, tn.nodeValue.indexOf('형광펜') + 3);
    getSelection().removeAllRanges(); getSelection().addRange(rg);
    click($('.d-note-host .ed-bar [data-ed="mark"]')); await sleep(800);
    out.markBtn = S.node(gdm).note.includes('==형광펜==');
    const wasList = /\n- 메모 ==형광펜==/.test(S.node(gdm).note);
    click($('.d-note-host .ed-bar [data-ed="list"]')); await sleep(800);
    out.listBtn = /\n- 메모 ==형광펜==/.test(S.node(gdm).note) !== wasList;
    endOf($('.d-note-host .rich').lastElementChild); document.execCommand('insertText', false, ' 즉시');
    click($('.detail [data-act="save"]')); await sleep(50);
    out.saveBtn = S.node(gdm).note.includes('즉시') && !!$('.detail .note-view');
    click($('.detail [data-act="edit"]')); await sleep(30);
    const im = S.importOutline('# 내과\n## 순환기\n- 심부전\n\t> - BNP\n\t? 호흡곤란\n- 부정맥', null);
    const im2 = S.importOutline('# 내과\n## 순환기\n- 심부전\n- 판막', null);
    out.import = im.added === 4 && im2.added === 1 && im2.merged === 3;
    await go('#tree');
    const closedFirst = $$('.onote').length === 0;
    click($('[data-act="notes"]')); await sleep(30);
    const allOpen = $$('.onote').length >= 3;
    click($(`.orow[data-id="${gdm}"] [data-act="note"]`)); await sleep(30);
    out.inlineNotes = closedFirst && allOpen && !$(`.onote[data-note="${gdm}"]`);
    // 사진 붙여넣기 → IndexedDB 저장 + 메모에 참조 + 미리보기에서 표시
    await go('#tree/' + gdm);
    if (!$('.d-note-host .rich')) { click($('.detail [data-act="edit"]')); await sleep(20); }
    const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30;
    cv.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'a.png', { type: 'image/png' }));
    const r2 = $('.d-note-host .rich');
    endOf(r2.lastElementChild);
    r2.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(800);
    out.imgSaved = /!\[\]\(img:i[a-z0-9]+\)/.test(S.node(gdm).note) && S.imageList().length === 1;
    click($('.detail [data-act="preview"]')); await sleep(300);
    out.imgShown = $('.note-view img.md-img')?.dataset.state === 'ok';
    // 카드 학습: 세트(갈래) 고르기 → 레벨 → 앞면/뒷면 → 몰라요/알아요
    const ob = S.roots()[0];
    await go('#train');
    out.library = !!$(`#view-train [data-node="${ob}"]`);
    click($(`#view-train .set-main[data-node="${ob}"]`)); await sleep(150);
    const cardIds = (d) => S.descendants(ob).filter((x) => S.depth(x) === d && ((S.node(x).note || '').trim() || S.children(x).length));
    out.defaultLevel = $$('#view-train .level-btn.on').map((x) => +x.dataset.level).join() === '2' && $$('.term-row').length === cardIds(2).length;
    click($('#view-train [data-level="2"]')); await sleep(20);
    click($('#view-train [data-level="3"]')); await sleep(20);
    const expected = cardIds(3).length;
    out.deckCount = $$('.term-row').length === expected;
    // 넘기며 외우기: 기록 없이 앞뒤로
    click($('#view-train [data-seg="cardMode"] [data-v="browse"]')); await sleep(20);
    const progBefore = JSON.stringify(S.getData().progress);
    click($('#view-train [data-act="start"]')); await sleep(40);
    const ss = () => JSON.parse(localStorage.getItem('galrae.v2.session'));
    const noJudge = !$('[data-judge]') && !!$('[data-act="next"]');
    key(document.body, 'ArrowRight'); await sleep(200);
    const i1 = ss().i;
    key(document.body, 'ArrowLeft'); await sleep(200);
    const i0 = ss().i;
    for (let k = 0; k < expected + 1; k++) { key(document.body, 'ArrowRight'); await sleep(170); }
    out.browse = noJudge && i1 === 1 && i0 === 0 && !!$('#view-train [data-act="to-test"]') && JSON.stringify(S.getData().progress) === progBefore;
    click($('#view-train [data-act="to-set"]')); await sleep(40);
    click($('#view-train [data-seg="cardMode"] [data-v="test"]')); await sleep(20);
    click($('#view-train [data-act="start"]')); await sleep(40);
    let steps = 0, backOk = true, flipOk = true;
    while ($('#flash') && steps < 30) {
      const id = JSON.parse(localStorage.getItem('galrae.v2.session')).cards[steps];
      key(document.body, ' '); await sleep(5);
      if (!$('#flash').classList.contains('flipped')) flipOk = false;
      const hasNote = !!(S.node(id).note || '').trim();
      if (hasNote && !$('.back .md')) backOk = false;
      if (!hasNote && !$('.back .kid-list')) backOk = false;
      key(document.body, steps % 2 ? 'ArrowRight' : 'ArrowLeft'); await sleep(200);
      steps++;
    }
    out.card = { steps: steps === expected, flipOk, backOk, summary: !!$('#view-train [data-act="retry"]') };
    click($('#view-train [data-act="retry"]')); await sleep(40);
    out.retry = JSON.parse(localStorage.getItem('galrae.v2.session')).cards.length === Math.ceil(expected / 2);
    key(document.body, 'ArrowRight'); await sleep(200);
    const before = JSON.parse(localStorage.getItem('galrae.v2.session')).i;
    key(document.body, 'z'); await sleep(20);
    out.undo = before === 1 && JSON.parse(localStorage.getItem('galrae.v2.session')).i === 0;
    // 내 세트: 여러 범위 묶기
    const pid = S.savePreset('테스트 세트', { scope: [S.findByTitle('임신과 당뇨병'), S.findByTitle('임신과 감염질환')], levels: [] });
    await go('#train/set:' + pid);
    out.preset = $('.set-h h1')?.textContent === '테스트 세트' && $$('.term-row').length === 3;
    // 마인드맵 노트 카드: 외울 것이 크게, 바로 편집
    await go('#graph/' + gdm);
    await sleep(300);
    out.noteCard = !!$('#gInfo .gi-note .md') && $('#gInfo .gi-title').textContent.includes('임신과 당뇨병');
    click($('#gInfo [data-act="edit"]')); await sleep(30);
    const gr = $('#gInfo .gi-note-host .rich');
    endOf(gr.lastElementChild); document.execCommand('insertParagraph'); document.execCommand('insertText', false, '그래프에서 편집');
    click($('#gInfo [data-act="done"]')); await sleep(60);
    out.graphEdit = S.node(gdm).note.includes('그래프에서 편집') && !!$('#gInfo .gi-note .md');    await go('#graph');
    await sleep(900);
    const GV = await import('./js/graphview.js');
    const g = GV.graph();
    let colsOk = true, rowsOk = true;
    for (const n of g.nodes) {
      const p = g.map.get(n.parent);
      if (p && !(n.tx > p.tx)) colsOk = false;
    }
    for (const id of [null, ...S.descendants(null)]) {
      const ks = S.children(id).map((k) => g.map.get(k)).filter(Boolean);
      for (let i = 1; i < ks.length; i++) if (!(ks[i].ty > ks[i - 1].ty)) rowsOk = false;
    }
    const sameDepthSameX = g.nodes.every((n) => g.nodes.every((m) => m.depth !== n.depth || Math.abs(m.tx - n.tx) < 0.01));
    out.graph = { colsOk, rowsOk, sameDepthSameX, settled: g.nodes.every((n) => Math.hypot(n.x - n.tx, n.y - n.ty) < 2) };
    // 마인드맵: 누르면 바로 아래 레벨이 펼쳐지고, 다시 누르면 접힌다
    const inf = S.findByTitle('임신과 감염질환'), gbs = S.findByTitle('B군 연쇄상구균(GBS)');
    const hiddenBefore = !g.map.has(gbs);
    g.select(inf, true); await sleep(100);
    const shown = g.map.has(gbs);
    g.select(inf, true); await sleep(100);
    out.mapToggle = hiddenBefore && shown && !g.map.has(gbs);    click($('#gLayout [data-v="force"]')); await sleep(200);
    click($('#gLayout [data-v="tree"]')); await sleep(200);
    key(document.body, 'k', { ctrlKey: true }); await sleep(30);
    const pin = $('dialog.palette input');
    pin.value = '당뇨'; pin.dispatchEvent(new Event('input')); await sleep(20);
    out.palette = $$('.pal-row').length >= 1;
    key(pin, 'Escape');
    const remote = JSON.parse(JSON.stringify(S.exportable()));
    const id0 = Object.keys(remote.nodes)[0];
    remote.nodes[id0].title = 'R'; remote.nodes[id0].updated = Date.now() + 1e4;
    out.merge = S.merge(S.getData(), remote).nodes[id0].title === 'R';
    return out;
  });
  ok('시드 데이터', r.seed === 16, r.seed);
  ok('트리: Enter 새 항목', r.enterAdds);
  ok('트리: Alt+↓ 이동', r.altMove);
  ok('트리: Tab 들여쓰기', r.tabIndent);
  ok('트리: Shift+Tab 내어쓰기', r.shiftTab);
  ok('트리: 빈 항목 Backspace 삭제', r.backspaceDel);
  ok('편집기: 기존 내용이 보이는 대로(형광펜·목록)', r.richRoundtrip);
  ok('편집기: 입력 저장', r.noteSaved);
  ok('편집기: 선택 후 형광펜 버튼', r.markBtn);
  ok('편집기: 목록 버튼', r.listBtn);
  ok('편집기: 저장 버튼(즉시 저장 후 읽기 화면)', r.saveBtn);
  ok('텍스트 가져오기 + 합치기', r.import);
  ok('정리: 외울 것 토글(기본 접힘·모두 펼치기·하나 접기)', r.inlineNotes);
  ok('사진: 붙여넣기 저장', r.imgSaved);
  ok('사진: 외울 것에 표시', r.imgShown);
  ok('카드: 세트 목록', r.library);
  ok('카드: 세트 기본 레벨(바로 아래) + 카드 목록', r.defaultLevel);
  ok('카드: 레벨별 장수', r.deckCount);
  ok('카드: 넘기며 외우기(기록 없음, 앞뒤 이동)', r.browse);
  ok('카드: 끝까지 진행', r.card.steps);
  ok('카드: 뒤집기', r.card.flipOk);
  ok('카드: 뒷면 = 외울 것 또는 하위 목록', r.card.backOk);
  ok('카드: 결과 화면', r.card.summary);
  ok('카드: 모르는 것만 다시', r.retry);
  ok('카드: 되돌리기', r.undo);
  ok('내 세트: 여러 범위 묶기', r.preset);
  ok('마인드맵: 노트 카드', r.noteCard);
  ok('마인드맵: 노트 카드에서 편집', r.graphEdit);
  ok('마인드맵: 누르면 하위 펼치기/다시 누르면 접기', r.mapToggle);
  ok('마인드맵: 하위 갈래는 항상 오른쪽 열', r.graph.colsOk);
  ok('마인드맵: 같은 깊이는 같은 열', r.graph.sameDepthSameX);
  ok('마인드맵: 형제는 순서대로 위→아래', r.graph.rowsOk);
  ok('마인드맵: 노드가 제자리에 정착', r.graph.settled);
  ok('빠른 찾기', r.palette);
  ok('동기화 병합(최신 우선)', r.merge);
  ok('JS 오류 없음', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---------- 스크린샷 ----------
if (SHOTS) {
  await mkdir(OUT, { recursive: true });
  const scenes = {
    library: async () => go('#train/list'),
    set: async (S) => go('#train/' + S.findByTitle('임신의 내외과적 질환')),
    tree: async (S) => go('#tree/' + S.findByTitle('임신과 당뇨병')),
    treeEdit: async (S) => {
      await go('#tree/' + S.findByTitle('임신과 당뇨병'));
      const e = $('.detail [data-act="edit"]'); if (e && !$('.d-note-host')) click(e);
      await sleep(100);
      const r = $('.d-note-host .rich'); const t = r.children[1].firstChild.nextSibling || r.children[1].lastChild;
      r.focus(); const rg = document.createRange(); rg.selectNodeContents(r.children[0]); getSelection().removeAllRanges(); getSelection().addRange(rg);
      await sleep(100);
    },
    graph: async () => go('#graph'),
    graphSel: async (S) => go('#graph/' + S.findByTitle('임신과 당뇨병')),
    card: async (S) => {
      await go('#train/' + S.findByTitle('임신의 내외과적 질환'));
      const sh = $('#view-train [data-pref="shuffle"]'); if (sh.checked) click(sh);
      await sleep(30);
      click($('#view-train [data-act="start"]')); await sleep(60);
    },    cardBack: async () => { key(document.body, ' '); await sleep(600); },    settings: async () => go('#settings'),
  };
  const sizes = [['desk', { width: 1280, height: 820 }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]];
  for (const [sname, vp] of sizes) {
    for (const theme of [undefined, 'dark']) {
      const { page, ctx } = await freshPage(vp, theme);
      await page.evaluate(H);
      for (const [name, fn] of Object.entries(scenes)) {
        await page.evaluate(`(async () => {
          const S = await import('./js/store.js');
          for (const id of S.descendants(null).slice(0, 9)) if (!S.prog(id + '|full')) S.rate(id + '|full', 1 + (id.length % 3));
          const dlg = document.querySelector('dialog'); if (dlg) dlg.close();
          await (${fn.toString()})(S);
        })()`);
        await new Promise((r) => setTimeout(r, name.startsWith('graph') ? 1200 : 400));
        await page.screenshot({ path: join(OUT, `${sname}-${theme || 'light'}-${name}.png`) });
      }
      await ctx.close();
    }
  }
  console.log('스크린샷 →', OUT);
}

await browser.close();
server.close();
if (failed) { console.log(`\n${failed}개 실패`); process.exit(1); }
console.log('\n모두 통과');