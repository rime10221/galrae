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
  await page.goto(BASE + '#home', { waitUntil: 'networkidle0' });
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
    await go('#tree/' + gdm);
    const ta = $('.d-note');
    ta.value += '\n- 메모 [[임신과 감염질환]]'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(450);
    out.noteSaved = S.node(gdm).note.includes('메모');
    const im = S.importOutline('# 내과\n## 순환기\n- 심부전\n\t> - BNP\n\t? 호흡곤란\n- 부정맥', null);
    const im2 = S.importOutline('# 내과\n## 순환기\n- 심부전\n- 판막', null);
    out.import = im.added === 4 && im2.added === 1 && im2.merged === 3;
    out.modes = {};
    for (const mode of ['full', 'expand', 'locate', 'recall', 'cue', 'mix']) {
      await go('#train');
      const setup = $('#view-train [data-act="setup"]'); if (setup) click(setup);
      await sleep(20);
      click($(`#view-train [data-mode="${mode}"]`)); await sleep(10);
      click($('#view-train [data-seg="count"] [data-v="10"]')); await sleep(10);
      click($('#view-train [data-act="start"]')); await sleep(40);
      let steps = 0, good = true;
      while ($('#flash') && steps < 40) {
        if (!$('.front').textContent.trim()) good = false;
        key(document.body, ' '); await sleep(5);
        if (!$('.answer')) { good = false; break; }
        key(document.body, String(1 + (steps % 3))); await sleep(5);
        steps++;
      }
      out.modes[mode] = good && steps > 0 && !!$('#view-train [data-act="again-same"]');
    }
    click($('#view-train [data-act="again-same"]')); await sleep(30);
    key(document.body, ' '); await sleep(5); key(document.body, '3'); await sleep(5);
    const before = $('.count').textContent;
    key(document.body, 'z'); await sleep(10);
    out.undo = before !== $('.count').textContent && !!$('.answer');
    // 그래프: 마인드맵 정렬 확인
    await go('#graph');
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
    click($('#gLayout [data-v="force"]')); await sleep(200);
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
  ok('상세: 외울 것 저장', r.noteSaved);
  ok('텍스트 가져오기 + 합치기', r.import);
  for (const [m, v] of Object.entries(r.modes)) ok(`트레이닝: ${m}`, v);
  ok('되돌리기', r.undo);
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
    home: async () => go('#home'),
    tree: async (S) => go('#tree/' + S.findByTitle('임신과 당뇨병')),
    graph: async () => go('#graph'),
    graphSel: async (S) => go('#graph/' + S.findByTitle('임신의 내외과적 질환')),
    setup: async () => go('#train'),
    card: async (S) => {
      await go('#train');
      click($('#view-train [data-mode="locate"]')); await sleep(20);
      click($('#view-train [data-seg="order"] [data-v="tree"]')); await sleep(20);
      click($('#view-train [data-act="start"]')); await sleep(40);
      const gdm = S.findByTitle('임신과 당뇨병');
      for (let i = 0; i < 20; i++) {
        const ss = JSON.parse(localStorage.getItem('galrae.v1.session'));
        if (ss.cards[ss.i].n === gdm) break;
        key(document.body, ' '); await sleep(5); key(document.body, '3'); await sleep(5);
      }
      key(document.body, ' ');
    },
    settings: async () => go('#settings'),
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
