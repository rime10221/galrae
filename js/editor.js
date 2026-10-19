// 외울 것 편집기 — 보이는 그대로 편집(WYSIWYG). 저장은 마크다운.
// · 버튼: 사진 · 형광펜 · 굵게 · 목록 · 들여/내어쓰기 · 서식 지우기
// · 글자를 드래그하면 위에 작은 메뉴, 오른쪽 클릭해도 같은 메뉴
// · '텍스트로' 를 누르면 예전처럼 마크다운(==, -)으로 직접 편집
import * as Images from './images.js';
import { esc, composing, lsGet, lsSet } from './util.js';

const RAW_KEY = 'galrae.v1.rawEditor';

// ---------- 마크다운 ↔ 편집용 HTML ----------
function inlineToHtml(s) {
  let x = esc(s);
  x = x.replace(/!\[([^\]]*)\]\(img:([A-Za-z0-9]+)\)/g, '<img class="md-img" data-img="$2" alt="$1" contenteditable="false">');
  x = x.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img class="md-img" src="$2" alt="$1" contenteditable="false">');
  x = x.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  x = x.replace(/==(.+?)==/g, '<mark>$1</mark>');
  return x;
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
      out += t.trim() ? `==${t}==` : t;
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

const BAR = `<div class="ed-bar">
  <label class="ed-btn" title="사진 넣기 (붙여넣기·끌어놓기도 돼요)">📷<span> 사진</span><input type="file" accept="image/*" multiple hidden data-ed="file"></label>
  <span class="ed-sep"></span>
  <button type="button" class="ed-btn" data-ed="mark" title="형광펜"><span class="ed-mark">형광펜</span></button>
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
  bubble.innerHTML = `<button data-ed="mark"><span class="ed-mark">형광펜</span></button><button data-ed="bold"><b>굵게</b></button><button data-ed="list">• 목록</button><button data-ed="clear">지우기</button>`;
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
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed || !ed.rich.contains(s.anchorNode)) return hideBubble();
    showBubble(ed, s.getRangeAt(0).getBoundingClientRect());
  });
  document.addEventListener('scroll', hideBubble, true);
  return bubble;
}
function showBubble(ed, rect, at) {
  const b = getBubble();
  b.editor = ed;
  b.hidden = false;
  const w = b.offsetWidth || 240;
  const x = at ? at.x : rect.left + rect.width / 2;
  const y = at ? at.y : rect.top;
  b.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
  b.style.top = Math.max(8, (at ? y + 6 : y - 46)) + 'px';
}
function hideBubble() { if (bubble) bubble.hidden = true; }
let active = null;

// host 안에 편집기를 만든다. onChange(md) 는 내용이 바뀔 때마다 호출
export function mount(host, md, onChange, { rows = 10, onSave = null } = {}) {
  let raw = lsGet(RAW_KEY, false);
  host.innerHTML = `<div class="ed">${BAR}<div class="rich md big" contenteditable="true" data-ph="${esc(PLACEHOLDER)}" style="--rows:${rows}"></div><textarea class="input raw" rows="${rows}" hidden></textarea></div>`;
  const rich = host.querySelector('.rich');
  const ta = host.querySelector('.raw');
  const ed = { rich, ta, host, cmd, value: () => current(), focus: () => (raw ? ta : rich).focus() };
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
  rich.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== rich) { if (active === ed) active = null; hideBubble(); } }, 150); });
  rich.addEventListener('input', () => { normalize(); changed(); });
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

  function wrapSel(tag) {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed || !rich.contains(s.anchorNode)) return;
    const r = s.getRangeAt(0);
    // 이미 같은 서식 안이면 풀기
    const inside = (n) => { while (n && n !== rich) { if (n.tagName === tag) return n; n = n.parentNode; } return null; };
    const a = inside(r.startContainer), b = inside(r.endContainer);
    if (a && a === b) { unwrap(a); return; }
    const frag = r.extractContents();
    frag.querySelectorAll(tag).forEach(unwrap);
    // 여러 줄에 걸치면 줄마다 따로 감싼다
    const wrapEl = (nodes) => { const el = document.createElement(tag.toLowerCase()); nodes.forEach((x) => el.append(x)); return el; };
    if ([...frag.childNodes].some((c) => c.nodeType === 1 && c.tagName === 'DIV')) {
      for (const d of frag.querySelectorAll(':scope > div')) d.replaceChildren(wrapEl([...d.childNodes]));
      r.insertNode(frag);
      mergeAdjacent();
    } else {
      const el = wrapEl([...frag.childNodes]);
      r.insertNode(el);
      s.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(el);
      s.addRange(nr);
    }
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
    if (raw) {
      // 텍스트 모드에서는 기호를 넣어 준다
      const { selectionStart: s, selectionEnd: e2, value: v } = ta;
      const sel = v.slice(s, e2) || '내용';
      const wrapT = (l) => { ta.setRangeText(l + sel + l, s, e2, 'select'); };
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      if (name === 'mark') wrapT('==');
      else if (name === 'bold') wrapT('**');
      else if (name === 'list') ta.setRangeText('- ', ls, ls, 'end');
      else if (name === 'indent') ta.setRangeText('  ', ls, ls, 'end');
      else if (name === 'outdent' && v.startsWith('  ', ls)) ta.setRangeText('', ls, ls + 2, 'end');
      ta.focus();
      return changed();
    }
    rich.focus();
    if (!rich.children.length) { rich.innerHTML = '<div data-lv="0"><br></div>'; placeCaret(rich.firstChild, true); }
    if (name === 'mark') wrapSel('MARK');
    else if (name === 'bold') wrapSel('B');
    else if (name === 'clear') {
      const s = getSelection();
      if (!s.isCollapsed) {
        const r = s.getRangeAt(0);
        const t = r.toString();
        r.deleteContents();
        r.insertNode(document.createTextNode(t));
      }
      for (const b of blocks()) b.querySelectorAll('mark,b,strong').forEach((m) => { if (getSelection().containsNode(m, true)) unwrap(m); });
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
