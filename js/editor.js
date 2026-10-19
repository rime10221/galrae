// 외울 것 편집기: 서식 버튼, 사진 넣기(붙여넣기·끌어놓기·파일), 목록 자동 이어쓰기
import * as Images from './images.js';
import { composing } from './util.js';

export const toolbarHtml = () => `<div class="ed-bar">
  <label class="ed-btn" title="사진 넣기 (붙여넣기·끌어놓기도 돼요)">📷 사진<input type="file" accept="image/*" multiple hidden data-ed="file"></label>
  <button type="button" class="ed-btn" data-ed="bold" title="굵게"><b>B</b></button>
  <button type="button" class="ed-btn" data-ed="mark" title="형광펜 (==강조==)"><span class="ed-mark">형광펜</span></button>
  <button type="button" class="ed-btn" data-ed="list" title="목록">• 목록</button>
  <button type="button" class="ed-btn" data-ed="key" title="항목: 내용">항목:</button>
</div>`;

export const PLACEHOLDER = "- 목록은 '- '로 시작 (Tab 들여쓰기)\n항목: 내용 → 항목이 굵게\n==강조== 형광펜, **굵게**, -> 화살표\n사진은 붙여넣기(Ctrl+V)·끌어놓기·📷 버튼";

const fire = (ta) => ta.dispatchEvent(new Event('input', { bubbles: true }));

function wrap(ta, l, r = l) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e) || '내용';
  ta.setRangeText(l + sel + r, s, e, 'select');
  ta.selectionStart = s + l.length;
  ta.selectionEnd = s + l.length + sel.length;
  ta.focus();
  fire(ta);
}

function linePrefix(ta, p) {
  const { selectionStart: s, value: v } = ta;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  ta.setRangeText(p, ls, ls, 'end');
  ta.focus();
  fire(ta);
}

// container 안의 .ed-bar 와 textarea 를 연결
export function bind(container, ta) {
  if (!ta || ta.dataset.ed) return;
  ta.dataset.ed = '1';
  container.querySelector('.ed-bar')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]');
    if (!b || b.dataset.ed === 'file') return;
    e.preventDefault();
    if (b.dataset.ed === 'bold') wrap(ta, '**');
    else if (b.dataset.ed === 'mark') wrap(ta, '==');
    else if (b.dataset.ed === 'list') linePrefix(ta, '- ');
    else if (b.dataset.ed === 'key') linePrefix(ta, '- 항목: ');
  });
  container.querySelector('[data-ed="file"]')?.addEventListener('change', async (e) => {
    await Images.insertInto(ta, e.target.files);
    e.target.value = '';
  });
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); Images.insertInto(ta, files); }
  });
  ta.addEventListener('dragover', (e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) { e.preventDefault(); ta.classList.add('drop'); } });
  ta.addEventListener('dragleave', () => ta.classList.remove('drop'));
  ta.addEventListener('drop', (e) => {
    ta.classList.remove('drop');
    const files = [...e.dataTransfer.files];
    if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); Images.insertInto(ta, files); }
  });
  ta.addEventListener('keydown', (e) => {
    if (composing(e)) return;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const line = v.slice(ls, s);
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (v.startsWith('  ', ls)) { ta.setRangeText('', ls, ls + 2, 'preserve'); ta.selectionStart = ta.selectionEnd = Math.max(ls, s - 2); }
      } else { ta.setRangeText('  ', ls, ls, 'preserve'); ta.selectionStart = ta.selectionEnd = s + 2; }
      fire(ta);
    } else if (e.key === 'Enter' && !e.shiftKey && s === en) {
      const m = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
      if (!m) return;
      e.preventDefault();
      if (!m[3].trim()) ta.setRangeText('', ls, s, 'end');
      else {
        const bullet = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}${m[2].slice(-1)}` : m[2];
        ta.setRangeText(`\n${m[1]}${bullet} `, s, s, 'end');
      }
      fire(ta);
    }
  });
}
