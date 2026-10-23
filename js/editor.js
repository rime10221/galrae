// 외울 것 편집기 — 보이는 그대로 편집(WYSIWYG). 저장은 마크다운.
// · 버튼: 사진 · 형광펜 · 굵게 · 목록 · 들여/내어쓰기 · 서식 지우기
// · 글자를 드래그하면 위에 작은 메뉴, 오른쪽 클릭해도 같은 메뉴
// · '텍스트로' 를 누르면 예전처럼 마크다운(==, -)으로 직접 편집
// · 사진은 누르면 선택(테두리) → Delete/Backspace 또는 메뉴의 🗑 로 삭제
// · 🎨 색: 형광펜 색(기본 노랑) · 글자색. 형광펜 버튼은 마지막에 고른 색으로 칠한다
import * as Images from './images.js';
import { esc, composing, lsGet, lsSet, toast, colorMd, HL_COLORS, TEXT_COLORS } from './util.js';

const RAW_KEY = 'galrae.v1.rawEditor';
const HL_KEY = 'galrae.v1.hlColor';
const lastHl = () => { const c = lsGet(HL_KEY, ''); return HL_COLORS.some((x) => x[0] === c) ? c : ''; };

// ---------- 마크다운 ↔ 편집용 HTML ----------
function inlineToHtml(s) {
  let x = esc(s);
  x = x.replace(/!\[([^\]]*)\]\(img:([A-Za-z0-9]+)\)/g, '<img class="md-img" data-img="$2" alt="$1" contenteditable="false">');
  x = x.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img class="md-img" src="$2" alt="$1" contenteditable="false">');
  x = x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  return colorMd(x);
}

export function mdToHtml(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  return lines.map((raw) => {
    const line = raw.replace(/\t/g, '  ');
    const lv = Math.floor(line.match(/^ */)[0].length / 2);
    let t = line.trim();
    let li = '';
    const m = t.match(/^([-*+•])\s+(.*)$/);
    if (m) { li = '1'; t = m[2]; }
    const html = inlineToHtml(t) || '<br>';
    return `<div data-lv="${lv}"${li ? ' data-li="1"' : ''}>${html}</div>`;
  }).join('');
}

function inlineToMd(node) {
  let out = '';
  for (const c of node.childNodes) {
    if (c.nodeType === 3) out += c.nodeValue.replace(/ /g, ' ');
    else if (c.nodeType !== 1) continue;
    else if (c.tagName === 'BR') { if (c.nextSibling) out += '\n'; continue; }
    else if (c.tagName === 'IMG') {
      if (c.dataset.img) out += `![${c.alt || ''}](img:${c.dataset.img})`;
      else if (c.src.startsWith('http')) out += `![${c.alt || ''}](${c.src})`;
    } else if (c.tagName === 'B' || c.tagName === 'STRONG' || c.style.fontWeight >= 600) {
      const t = inlineToMd(c);
      out += t.trim() ? `**${t}**` : t;
    } else if (c.tagName === 'MARK') {
      const t = inlineToMd(c);
      out += t.trim() ? `==${c.dataset.c ? `{${c.dataset.c}}` : ''}${t}==` : t;
    } else if (c.tagName === 'SPAN' && c.classList.contains('tc') && c.dataset.c) {
      const t = inlineToMd(c);
      out += t.trim() ? `{${c.dataset.c}}${t}{/}` : t;
    } else if (c.tagName === 'DIV' || c.tagName === 'P') {
      out += (out ? '\n' : '') + inlineToMd(c);
    } else out += inlineToMd(c);
  }
  return out;
}

export function htmlToMd(root) {
  const lines = [];
  for (const c of root.childNodes) {
    if (c.nodeType === 3) { if (c.nodeValue.trim()) lines.push(c.nodeValue.trim()); continue; }
    if (c.nodeType !== 1) continue;
    const lv = +(c.dataset?.lv || 0);
    const li = c.dataset?.li === '1';
    const text = c.tagName === 'DIV' || c.tagName === 'P' ? inlineToMd(c) : inlineToMd({ childNodes: [c] });
    for (const [i, t] of text.split('\n').entries()) {
      lines.push('  '.repeat(lv) + (li && i === 0 ? '- ' : li ? '  ' : '') + t);
    }
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

// ---------- 편집기 ----------
export const PLACEHOLDER = '여기에 외울 것을 적어요. 글자를 드래그하면 형광펜·굵게 메뉴가 떠요. 사진은 붙여넣기(Ctrl+V)·끌어놓기·📷 버튼.';

// 색 고르기 (편집기 버튼의 🎨 · 글자를 드래그하면 뜨는 메뉴)
const PALETTE = `<div class="cp-box">
  <div class="cp-row"><span class="cp-l">형광펜</span>${HL_COLORS.map(([c, n]) => `<button type="button" class="cp hl" data-ed="hl:${c}" data-c="${c}" title="${n} 형광펜${c ? '' : ' (기본)'}"></button>`).join('')}</div>
  <div class="cp-row"><span class="cp-l">글자색</span><button type="button" class="cp tx" data-ed="tc:" title="기본 글자색">가</button>${TEXT_COLORS.map(([c, n]) => `<button type="button" class="cp tx" data-ed="tc:${c}" data-c="${c}" title="${n} 글자">가</button>`).join('')}</div>
</div>`;

const BAR = `<div class="ed-bar">
  <label class="ed-btn" title="사진 넣기 (붙여넣기·끌어놓기도 돼요)">📷<span> 사진</span><input type="file" accept="image/*" multiple hidden data-ed="file"></label>
  <span class="ed-sep"></span>
  <button type="button" class="ed-btn" data-ed="mark" title="형광펜 (Ctrl+H)"><span class="ed-mark">형광펜</span></button>
  <button type="button" class="ed-btn" data-ed="palette" title="형광펜 색 · 글자색">🎨<span> 색</span></button>
  <button type="button" class="ed-btn" data-ed="bold" title="굵게 (Ctrl+B)"><b>굵게</b></button>
  <button type="button" class="ed-btn" data-ed="list" title="글머리 목록">• 목록</button>
  <button type="button" class="ed-btn" data-ed="indent" title="들여쓰기 (Tab)">⇥</button>
  <button type="button" class="ed-btn" data-ed="outdent" title="내어쓰기 (Shift+Tab)">⇤</button>
  <button type="button" class="ed-btn" data-ed="clear" title="서식 지우기">지우기</button>
  <span class="ed-flex"></span>
  <button type="button" class="ed-btn ghost" data-ed="raw" title="==, - 기호로 직접 편집">텍스트로</button>
</div>`;

let bubble = null;
function getBubble() {
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'ed-bubble';
  bubble.hidden = true;
  document.body.append(bubble);
  bubble.addEventListener('mousedown', (e) => e.preventDefault());
  bubble.addEventListener('pointerdown', (e) => e.preventDefault());
  bubble.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]');
    if (b && bubble.editor) bubble.editor.cmd(b.dataset.ed);
    hideBubble();
  });
  document.addEventListener('selectionchange', () => {
    const ed = active;
    if (!ed) return hideBubble();
    const img = ed.syncPick();
    if (img) return showBubble(ed, img.getBoundingClientRect(), null, 'img');
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed || !ed.rich.contains(s.anchorNode)) return hideBubble();
    showBubble(ed, s.getRangeAt(0).getBoundingClientRect());
  });
  document.addEventListener('scroll', hideBubble, true);
  // 색 고르기 창은 바깥을 누르면 닫는다
  document.addEventListener('pointerdown', (e) => {
    for (const p of document.querySelectorAll('.ed-pop:not([hidden])')) if (!p.contains(e.target) && !e.target.closest('[data-ed="palette"]')) p.hidden = true;
  });
  return bubble;
}
const BUBBLE = {
  text: `<div class="bb-row"><button data-ed="mark"><span class="ed-mark">형광펜</span></button><button data-ed="bold"><b>굵게</b></button><button data-ed="list">• 목록</button><button data-ed="clear">지우기</button></div>${PALETTE}`,
  img: `<button data-ed="img-view">🔍 크게 보기</button><button data-ed="img-del" class="del">🗑 사진 삭제</button>`,
};
function showBubble(ed, rect, at, mode = 'text') {
  const b = getBubble();
  b.editor = ed;
  if (b.dataset.mode !== mode) { b.dataset.mode = mode; b.innerHTML = BUBBLE[mode]; }
  showHl(b);
  b.hidden = false;
  const w = b.offsetWidth || 240;
  const x = at ? at.x : rect.left + rect.width / 2;
  const y = at ? at.y : rect.top;
  b.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
  // 메뉴가 위쪽에 들어갈 자리가 없으면 선택한 글자 아래에
  const h = b.offsetHeight || 40;
  let top = at ? y + 6 : y - h - 8;
  if (!at && top < 8 && rect) top = rect.bottom + 8;
  b.style.top = Math.max(8, top) + 'px';
}
function hideBubble() { if (bubble) bubble.hidden = true; }
// 형광펜 버튼에 지금 쓰는 색을 보여 준다
function showHl(root) { for (const m of root.querySelectorAll('.ed-mark')) { if (lastHl()) m.dataset.c = lastHl(); else delete m.dataset.c; } }
let active = null;

// host 안에 편집기를 만든다. onChange(md) 는 내용이 바뀔 때마다 호출
export function mount(host, md, onChange, { rows = 10, onSave = null } = {}) {
  let raw = lsGet(RAW_KEY, false);
  host.innerHTML = `<div class="ed">${BAR}<div class="ed-pop" hidden>${PALETTE}</div><div class="rich md big" contenteditable="true" data-ph="${esc(PLACEHOLDER)}" style="--rows:${rows}"></div><textarea class="input raw" rows="${rows}" hidden></textarea></div>`;
  const rich = host.querySelector('.rich');
  const ta = host.querySelector('.raw');
  const pop = host.querySelector('.ed-pop');
  showHl(host);
  const ed = { rich, ta, host, cmd, syncPick, value: () => current(), focus };
  // end: 커서를 글 맨 끝으로
  function focus(end = false) {
    (raw ? ta : rich).focus();
    if (!end) return;
    // 커서를 끝에 두고, 화면도 그 줄이 보이게 내린다 (긴 글이면 위에 머물러 있지 않게)
    if (raw) { ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollTop = ta.scrollHeight; ta.scrollIntoView({ block: 'nearest' }); }
    else if (rich.lastElementChild) { placeCaret(rich.lastElementChild, true); rich.scrollTop = rich.scrollHeight; rich.lastElementChild.scrollIntoView({ block: 'nearest' }); }
  }
  let picked = null; // 선택한 사진
  let last = md || '';
  const setRaw = (v) => {
    raw = v;
    lsSet(RAW_KEY, v);
    rich.hidden = v; ta.hidden = !v;
    host.querySelector('[data-ed="raw"]').textContent = v ? '보이는 대로' : '텍스트로';
    host.querySelector('.ed-bar').classList.toggle('raw-mode', v);
  };
  const current = () => (raw ? ta.value : htmlToMd(rich));
  const changed = () => {
    const v = current();
    rich.classList.toggle('is-empty', !v.trim() && !rich.querySelector('img'));
    if (v !== last) { last = v; onChange(v); }
  };
  rich.innerHTML = mdToHtml(last);
  ta.value = last;
  setRaw(raw);
  rich.classList.toggle('is-empty', !last.trim());
  getBubble();

  rich.addEventListener('focus', () => { active = ed; });
  rich.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== rich) { if (active === ed) active = null; unpick(); hideBubble(); } }, 150); });
  rich.addEventListener('input', () => { if (picked && !picked.isConnected) picked = null; normalize(); changed(); });

  // 사진을 누르면 선택 (커서가 엉뚱한 데로 가지 않게 mousedown 은 막는다), 더블클릭은 크게 보기
  rich.addEventListener('mousedown', (e) => { if (e.target.closest('.md-img')) e.preventDefault(); });
  rich.addEventListener('click', (e) => { const img = e.target.closest('.md-img'); if (img) { e.preventDefault(); pick(img); } });
  rich.addEventListener('dblclick', (e) => { if (e.target.closest('.md-img')) { e.preventDefault(); cmd('img-view'); } });
  ta.addEventListener('input', changed);

  // 오른쪽 클릭 = 서식 메뉴 (글자를 선택했을 때)
  rich.addEventListener('contextmenu', (e) => {
    const s = getSelection();
    if (s.isCollapsed) return;
    e.preventDefault();
    active = ed;
    showBubble(ed, null, { x: e.clientX, y: e.clientY });
  });

  host.querySelector('.ed-bar').addEventListener('mousedown', (e) => { if (e.target.closest('button[data-ed]')) e.preventDefault(); });
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  pop.addEventListener('click', (e) => { const b = e.target.closest('button[data-ed]'); if (b) { pop.hidden = true; cmd(b.dataset.ed); } });
  host.querySelector('.ed-bar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ed]');
    if (!b) return;
    if (b.dataset.ed === 'raw') {
      if (raw) { rich.innerHTML = mdToHtml(ta.value); } else { ta.value = htmlToMd(rich); }
      setRaw(!raw);
      ed.focus();
      return;
    }
    cmd(b.dataset.ed);
  });
  host.querySelector('[data-ed="file"]').addEventListener('change', async (e) => {
    await insertImages(e.target.files);
    e.target.value = '';
  });

  rich.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); insertImages(files); return; }
    // 다른 곳 서식은 버리고 글자만 (줄바꿈 유지)
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  });
  rich.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) { e.preventDefault(); rich.classList.add('drop'); } });
  rich.addEventListener('dragleave', () => rich.classList.remove('drop'));
  rich.addEventListener('drop', (e) => {
    rich.classList.remove('drop');
    const files = [...e.dataTransfer.files];
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); insertImages(files); }
  });

  rich.addEventListener('keydown', (e) => {
    if (composing(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); onSave?.(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); cmd('bold'); return; }
    if (mod && e.key.toLowerCase() === 'h') { e.preventDefault(); cmd('mark'); return; }
    if (e.key === 'Tab') { e.preventDefault(); cmd(e.shiftKey ? 'outdent' : 'indent'); return; }
    // 선택한 사진: Delete/Backspace 삭제 · Enter 아래에 새 줄 · 방향키/Esc 선택 해제
    if (syncPick()) {
      const img = picked;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return removeImg(img); }
      if (e.key === 'Enter') { e.preventDefault(); return lineAfter(img, true); }
      if (['Escape', 'ArrowDown', 'ArrowRight'].includes(e.key)) { e.preventDefault(); return lineAfter(img, false); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); unpick(); return caretAt((r) => r.setStartBefore(img)); }
      if (mod || e.key.length > 1) return;
      // 글자를 치면 사진은 두고 아래 줄에 쓴다
      return lineAfter(img, false);
    }
    // 사진 바로 뒤에서 Backspace / 바로 앞에서 Delete → 먼저 사진을 선택 (한 번 더 누르면 삭제)
    if ((e.key === 'Backspace' || e.key === 'Delete') && getSelection().isCollapsed) {
      const img = imgBeside(e.key === 'Backspace' ? -1 : 1);
      if (img) {
        e.preventDefault();
        const cur = block();
        if (cur && cur !== blockOf(img) && !cur.textContent.trim() && !cur.querySelector('img')) { cur.remove(); changed(); }
        return pick(img);
      }
    }
    const blk = block();
    if (!blk) return;
    // 빈 목록 줄에서 Enter → 목록 끝내기, 줄 맨 앞 Backspace → 글머리 먼저 지우기
    if (e.key === 'Enter' && !e.shiftKey && blk.dataset.li === '1' && !blk.textContent.trim() && !blk.querySelector('img')) {
      e.preventDefault();
      if (+blk.dataset.lv > 0) blk.dataset.lv = +blk.dataset.lv - 1; else delete blk.dataset.li;
      changed();
    } else if (e.key === 'Backspace' && atStart(blk) && (blk.dataset.li === '1' || +blk.dataset.lv > 0)) {
      e.preventDefault();
      if (blk.dataset.li === '1') delete blk.dataset.li; else blk.dataset.lv = +blk.dataset.lv - 1;
      changed();
    }
  });

  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); onSave?.(); return; }
    if (composing(e) || e.key !== 'Tab') return;
    e.preventDefault();
    const { selectionStart: s, value: v } = ta;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    if (e.shiftKey) { if (v.startsWith('  ', ls)) { ta.setRangeText('', ls, ls + 2, 'end'); } }
    else ta.setRangeText('  ', ls, ls, 'end');
    changed();
  });

  function normalize() {
    // 맨 위에 맨글자가 생기면 줄(div)로 감싼다
    for (const c of [...rich.childNodes]) {
      if (c.nodeType === 3 && c.nodeValue.trim()) {
        const d = document.createElement('div');
        d.dataset.lv = '0';
        c.replaceWith(d);
        d.append(c);
        placeCaret(d, true);
      } else if (c.nodeType === 1 && c.tagName === 'BR' && rich.childNodes.length === 1) c.remove();
    }
    for (const d of rich.querySelectorAll(':scope > div')) if (!d.dataset.lv) d.dataset.lv = '0';
  }

  // ---------- 사진 선택 ----------
  function pick(img) {
    if (!rich.contains(img)) return;
    if (document.activeElement !== rich) rich.focus({ preventScroll: true });
    active = ed;
    if (picked && picked !== img) picked.classList.remove('picked');
    picked = img;
    img.classList.add('picked');
    const r = document.createRange();
    r.selectNode(img);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    showBubble(ed, img.getBoundingClientRect(), null, 'img');
  }
  function unpick() {
    if (!picked) return;
    picked.classList.remove('picked');
    picked = null;
  }
  // 선택 영역이 아직 그 사진만 감싸고 있는지 (다른 곳을 누르면 선택 해제)
  function syncPick() {
    if (!picked) return null;
    const s = getSelection();
    const r = s.rangeCount ? s.getRangeAt(0) : null;
    let still = picked.isConnected && r && !r.collapsed && r.intersectsNode(picked);
    if (still) { const f = r.cloneContents(); still = f.querySelectorAll('img').length === 1 && !f.textContent.trim(); }
    if (!still) unpick();
    return picked;
  }
  function blockOf(n) {
    while (n && n.parentNode !== rich) n = n.parentNode;
    return n;
  }
  function caretAt(fn) {
    const r = document.createRange();
    fn(r);
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  // 커서 바로 앞(-1)/뒤(1)에 사진이 있으면 그 사진 (같은 줄, 또는 빈 자리 너머 앞/뒤 줄)
  function imgBeside(dir) {
    const s = getSelection();
    if (!s.rangeCount || !rich.contains(s.anchorNode)) return null;
    const r = s.getRangeAt(0);
    const blk = blockOf(r.startContainer);
    if (!blk || blk.nodeType !== 1) return null;
    // 커서와 줄 끝 사이 (dir 쪽)
    const side = document.createRange();
    side.selectNodeContents(blk);
    if (dir < 0) side.setEnd(r.startContainer, r.startOffset); else side.setStart(r.startContainer, r.startOffset);
    const edgeImg = (range) => {
      const f = range.cloneContents();
      const imgs = f.querySelectorAll('img');
      if (!imgs.length) return undefined; // 사진 없음
      // 사진과 커서 사이에 글자가 있으면 해당 없음
      const last = imgs[dir < 0 ? imgs.length - 1 : 0];
      const between = document.createRange();
      between.selectNodeContents(f);
      if (dir < 0) between.setStartAfter(last); else between.setEndBefore(last);
      return between.toString().trim() ? null : imgs.length;
    };
    const here = edgeImg(side);
    if (here === null) return null;
    if (here) {
      const all = [...blk.querySelectorAll('.md-img')].filter((im) => side.intersectsNode(im));
      return all[dir < 0 ? all.length - 1 : 0] || null;
    }
    if (side.toString().trim()) return null;
    // 줄 맨 앞/끝 → 앞/뒤 줄 끝/처음의 사진
    const nb = dir < 0 ? blk.previousElementSibling : blk.nextElementSibling;
    if (!nb) return null;
    const whole = document.createRange();
    whole.selectNodeContents(nb);
    if (!edgeImg(whole)) return null;
    const imgs = nb.querySelectorAll('.md-img');
    return imgs[dir < 0 ? imgs.length - 1 : 0] || null;
  }
  // 사진 아래 줄로 커서 (아래 줄이 없거나 fresh 면 빈 줄을 만든다)
  function lineAfter(img, fresh) {
    unpick();
    hideBubble();
    const b = blockOf(img);
    let next = b.nextElementSibling;
    if (fresh || !next) {
      next = document.createElement('div');
      next.dataset.lv = b.dataset?.lv || '0';
      next.innerHTML = '<br>';
      b.after(next);
      changed();
    }
    placeCaret(next, false);
  }
  function removeImg(img) {
    const b = blockOf(img);
    // 사진만 있는 줄이면 줄째로 지운다
    const alone = b && b !== img && !b.textContent.trim() && b.querySelectorAll('img').length === 1;
    const target = alone ? b : img;
    const parent = target.parentNode, anchor = target.nextSibling;
    const next = alone ? b.nextElementSibling : null, prev = alone ? b.previousElementSibling : null;
    const spot = document.createRange();
    spot.setStartBefore(target);
    spot.collapse(true);
    unpick();
    hideBubble();
    target.remove();
    if (!rich.children.length) rich.innerHTML = '<div data-lv="0"><br></div>';
    if (!alone) caretAt((r) => r.setStart(spot.startContainer, spot.startOffset));
    else if (next) placeCaret(next, false);
    else placeCaret(prev || rich.firstElementChild, true);
    changed();
    toast('사진을 지웠어요', { action: '되돌리기', onAction: () => {
      if (!parent.isConnected) return toast('편집기를 닫아서 되돌릴 수 없어요');
      parent.insertBefore(target, anchor?.parentNode === parent ? anchor : null);
      changed();
    } });
  }

  function block() {
    const s = getSelection();
    if (!s.rangeCount) return null;
    let n = s.getRangeAt(0).startContainer;
    while (n && n.parentNode !== rich) n = n.parentNode;
    return n && n.nodeType === 1 ? n : null;
  }
  function blocks() {
    const s = getSelection();
    if (!s.rangeCount) return [];
    const r = s.getRangeAt(0);
    const all = [...rich.children];
    const out = all.filter((d) => r.intersectsNode(d));
    return out.length ? out : [block()].filter(Boolean);
  }
  function atStart(blk) {
    const s = getSelection();
    if (!s.isCollapsed) return false;
    const r = document.createRange();
    r.selectNodeContents(blk);
    r.setEnd(s.anchorNode, s.anchorOffset);
    return r.toString().length === 0 && !r.cloneContents().querySelector?.('img');
  }

  // 서식 종류: 형광펜(색) · 글자색 · 굵게
  const FMT = {
    mark: { sel: 'mark', make: (c) => { const m = document.createElement('mark'); if (c) m.dataset.c = c; return m; } },
    tc: { sel: 'span.tc', make: (c) => { const t = document.createElement('span'); t.className = 'tc'; t.dataset.c = c; return t; } },
    bold: { sel: 'b,strong', make: () => document.createElement('b') },
  };
  // color: 형광펜/글자색의 색 ('' = 기본 형광펜), null = 그 서식 지우기
  function wrapSel(kind, color = '') {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed || !rich.contains(s.anchorNode)) return;
    const f = FMT[kind];
    const r = s.getRangeAt(0);
    const off = color === null;
    const inside = (n) => { while (n && n !== rich) { if (n.nodeType === 1 && n.matches(f.sel)) return n; n = n.parentNode; } return null; };
    const a = inside(r.startContainer), b = inside(r.endContainer);
    if (a && a === b) {
      // 이미 같은 서식 안: 같은 색이면 고른 부분만 풀고, 다른 색이면 고른 부분만 바꾼다
      const was = a.dataset.c || '';
      const nodes = liftOut(a, r);
      if (kind !== 'bold' && !off && was !== color) wrapNodes(nodes, f.make(color));
      else selectNodes(nodes);
      return;
    }
    const frag = r.extractContents();
    frag.querySelectorAll(f.sel).forEach(unwrap);
    // 여러 줄에 걸치면 줄마다 따로 감싼다
    const wrapEl = (nodes) => { const el = f.make(color); nodes.forEach((x) => el.append(x)); return el; };
    if ([...frag.childNodes].some((c) => c.nodeType === 1 && c.tagName === 'DIV')) {
      if (!off) for (const d of frag.querySelectorAll(':scope > div')) d.replaceChildren(wrapEl([...d.childNodes]));
      r.insertNode(frag);
      mergeAdjacent();
    } else if (off) {
      const nodes = [...frag.childNodes];
      r.insertNode(frag);
      selectNodes(nodes);
    } else {
      const el = wrapEl([...frag.childNodes]);
      r.insertNode(el);
      selectNodes([el]);
    }
  }
  // 서식 a 안의 범위 r 만 a 밖으로 꺼낸다 (a 는 앞뒤 둘로 나뉜다). 꺼낸 노드들을 돌려준다
  function liftOut(a, r) {
    const anc = r.commonAncestorContainer;
    let out = r.extractContents();
    // a 와 범위 사이의 다른 서식(예: 굵게)은 꺼낸 쪽에도 남긴다
    for (let n = anc; n && n !== a; n = n.parentNode) if (n.nodeType === 1) { const c = n.cloneNode(false); c.append(out); out = c; }
    const tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    tail.setEnd(a, a.childNodes.length);
    const a2 = a.cloneNode(false);
    a2.append(tail.extractContents());
    a.after(a2);
    const nodes = out.nodeType === 11 ? [...out.childNodes] : [out];
    a2.before(...nodes);
    for (const x of [a, a2]) if (!x.textContent && !x.querySelector('img')) x.remove();
    return nodes;
  }
  function wrapNodes(nodes, el) {
    nodes[0].before(el);
    el.append(...nodes);
    selectNodes([el]);
  }
  function selectNodes(nodes) {
    if (!nodes.length) return;
    const nr = document.createRange();
    nr.setStartBefore(nodes[0]);
    nr.setEndAfter(nodes[nodes.length - 1]);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(nr);
  }
  function unwrap(el) { el.replaceWith(...el.childNodes); }
  function mergeAdjacent() {
    // 범위를 잘라 넣으면서 쪼개진 줄을 다시 붙인다
    for (const d of [...rich.querySelectorAll(':scope > div')]) {
      d.querySelectorAll(':scope > div').forEach((inner) => { inner.replaceWith(...inner.childNodes); });
      if (!d.childNodes.length) d.innerHTML = '<br>';
    }
  }
  function placeCaret(el, end) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!end);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function cmd(name) {
    if (name === 'img-del') { if (picked) removeImg(picked); return; }
    if (name === 'img-view') {
      if (picked?.src) Images.openLightbox(picked.src);
      return;
    }
    if (raw) {
      // 텍스트 모드에서는 기호를 넣어 준다
      const { selectionStart: s, selectionEnd: e2, value: v } = ta;
      const sel = v.slice(s, e2) || '내용';
      const wrapT = (l, rt = l) => { ta.setRangeText(l + sel + rt, s, e2, 'select'); };
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (name === 'palette') { pop.hidden = !pop.hidden; return; }
      if (name.startsWith('hl:')) { lsSet(HL_KEY, name.slice(3)); showHl(host); }
      const hl = name === 'mark' ? lastHl() : name.startsWith('hl:') ? name.slice(3) : null;
      if (hl != null) wrapT(hl ? `=={${hl}}` : '==', '==');
      else if (name.startsWith('tc:')) { if (name.slice(3)) wrapT(`{${name.slice(3)}}`, '{/}'); }
      else if (name === 'bold') wrapT('**');
      else if (name === 'list') ta.setRangeText('- ', ls, ls, 'end');
      else if (name === 'indent') ta.setRangeText('  ', ls, ls, 'end');
      else if (name === 'outdent' && v.startsWith('  ', ls)) ta.setRangeText('', ls, ls + 2, 'end');
      ta.focus();
      return changed();
    }
    rich.focus();
    if (!rich.children.length) { rich.innerHTML = '<div data-lv="0"><br></div>'; placeCaret(rich.firstChild, true); }
    if (name === 'palette') { pop.hidden = !pop.hidden; return; }
    if (name === 'mark') wrapSel('mark', lastHl());
    else if (name.startsWith('hl:')) { lsSet(HL_KEY, name.slice(3)); showHl(host); wrapSel('mark', name.slice(3)); }
    else if (name.startsWith('tc:')) wrapSel('tc', name.slice(3) || null);
    else if (name === 'bold') wrapSel('bold');
    else if (name === 'clear') {
      const s = getSelection();
      if (!s.isCollapsed) {
        const r = s.getRangeAt(0);
        const t = r.toString();
        r.deleteContents();
        r.insertNode(document.createTextNode(t));
      }
      for (const b of blocks()) b.querySelectorAll('mark,b,strong,span.tc').forEach((m) => { if (getSelection().containsNode(m, true)) unwrap(m); });
    } else if (name === 'list') {
      const bs = blocks();
      const on = bs.every((b) => b.dataset.li === '1');
      bs.forEach((b) => { if (on) delete b.dataset.li; else b.dataset.li = '1'; });
    } else if (name === 'indent') blocks().forEach((b) => { b.dataset.lv = Math.min(4, +(b.dataset.lv || 0) + 1); if (!b.dataset.li) b.dataset.li = '1'; });
    else if (name === 'outdent') blocks().forEach((b) => { b.dataset.lv = Math.max(0, +(b.dataset.lv || 0) - 1); });
    changed();
  }

  async function insertImages(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    if (raw) { await Images.insertInto(ta, list); return changed(); }
    rich.focus();
    let blk = block();
    for (const f of list) {
      const id = await Images.addImage(f);
      const d = document.createElement('div');
      d.dataset.lv = '0';
      d.innerHTML = `<img class="md-img" data-img="${id}" alt="" contenteditable="false">`;
      if (blk) blk.after(d); else rich.append(d);
      blk = d;
    }
    const after = document.createElement('div');
    after.dataset.lv = '0';
    after.innerHTML = '<br>';
    blk.after(after);
    placeCaret(after, true);
    changed();
  }

  return ed;
}
