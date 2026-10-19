// 공용 유틸: DOM, 저장소, 다이얼로그, 토스트, 간단 마크다운
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
export const now = () => Date.now();
export const uid = () => now().toString(36) + Math.random().toString(36).slice(2, 8);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function debounce(fn, ms) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.cancel = () => clearTimeout(t);
  return f;
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function timeAgo(t) {
  if (!t) return '';
  const s = Math.round((now() - t) / 1000);
  if (s < 10) return '방금';
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export function fmtInterval(ms) {
  if (ms < 3600e3) return `${Math.max(1, Math.round(ms / 60e3))}분`;
  if (ms < 86400e3) return `${Math.round(ms / 3600e3)}시간`;
  return `${Math.round(ms / 86400e3)}일`;
}

export function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function lsSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}

// 한글 IME 조합 중인 키 입력은 무시해야 Enter/Backspace가 오작동하지 않는다
export const composing = (e) => e.isComposing || e.keyCode === 229;

export function toast(msg, opt = {}) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (opt.action) {
    const b = document.createElement('button');
    b.textContent = opt.action;
    b.onclick = () => { opt.onAction?.(); el.remove(); };
    el.append(b);
  }
  box.append(el);
  const ms = opt.ms || (opt.action ? 6000 : 2600);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 300);
}

export function openDialog(html, { onMount, cls = '' } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg ' + cls;
    d.innerHTML = html;
    document.body.append(d);
    const close = (v) => { if (!d.open) return; d.close(); d.remove(); resolve(v); };
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    d.addEventListener('click', (e) => {
      if (e.target === d) return close(null);
      const b = e.target.closest('[data-close]');
      if (b) close(b.dataset.close === '' ? null : b.dataset.close);
    });
    d.showModal();
    onMount?.(d, close);
  });
}

export async function confirmDlg(msg, { ok = '확인', danger = false, detail = '' } = {}) {
  const r = await openDialog(`<div class="dlg-body">
    <p class="dlg-msg">${esc(msg)}</p>${detail ? `<p class="muted small">${esc(detail)}</p>` : ''}
    <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button>
    <button class="btn ${danger ? 'danger' : 'primary'}" data-close="ok">${esc(ok)}</button></div></div>`);
  return r === 'ok';
}

export function promptDlg(title, value = '', placeholder = '') {
  return openDialog(`<div class="dlg-body">
    <p class="dlg-msg">${esc(title)}</p>
    <input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}">
    <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button>
    <button class="btn primary" data-ok>확인</button></div></div>`, {
    onMount(d, close) {
      const inp = d.querySelector('input');
      inp.focus(); inp.select();
      const ok = () => close(inp.value.trim());
      d.querySelector('[data-ok]').onclick = ok;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !composing(e)) ok(); });
    },
  });
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

// ---- 간단 마크다운 ----
// - 목록, 1. 번호, # 제목, > 인용, **굵게**, ==강조(빈칸)==, ~~취소~~, `코드`, [[링크]], -> 화살표
export function inlineMd(s, opt = {}) {
  let x = esc(s);
  const codes = [];
  x = x.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  // 사진: ![설명](img:ID) 은 기기/드라이브에 저장된 사진, ![설명](https://...) 은 웹 이미지
  x = x.replace(/!\[([^\]]*)\]\(img:([A-Za-z0-9]+)\)/g, '<img class="md-img" data-img="$2" alt="$1">');
  x = x.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
  x = x.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  x = x.replace(/==(.+?)==/g, opt.cloze ? '<span class="cloze" tabindex="0">$1</span>' : '<mark>$1</mark>');
  x = x.replace(/~~(.+?)~~/g, '<s>$1</s>');
  x = x.replace(/\[\[(.+?)\]\]/g, '<a class="wikilink" data-link="$1">$1</a>');
  x = x.replace(/&lt;-&gt;/g, '↔').replace(/=&gt;/g, '⇒').replace(/-&gt;/g, '→').replace(/&lt;-/g, '←');
  return x.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const BULLETS = ['•', '◦', '▪'];
// "항목: 내용" 형태는 항목 부분을 굵게 해서 한눈에 들어오게
function keyed(text, opt) {
  const m = text.match(/^([^:：/]{1,24}?)\s*[:：]\s+(.+)$/);
  return m ? `<span class="md-k">${inlineMd(m[1], opt)}</span> ${inlineMd(m[2], opt)}` : inlineMd(text, opt);
}

export function renderMd(src, opt = {}) {
  const out = [];
  for (const raw of String(src || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim()) { out.push('<div class="md-gap"></div>'); continue; }
    const lv = Math.floor(line.match(/^ */)[0].length / 2);
    const t = line.trim();
    let m;
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
      out.push(`<div class="md-h md-h${m[1].length}">${inlineMd(m[2], opt)}</div>`);
    } else if ((m = t.match(/^([-*+•]|\d+[.)])\s+(.*)$/))) {
      const num = /\d/.test(m[1]);
      out.push(`<div class="md-li" style="--lv:${lv}" data-lv="${Math.min(lv, 2)}"><span class="md-b">${num ? esc(m[1]) : BULLETS[Math.min(lv, 2)]}</span><span>${keyed(m[2], opt)}</span></div>`);
    } else if ((m = t.match(/^>\s?(.*)$/))) {
      out.push(`<div class="md-q">${inlineMd(m[1], opt)}</div>`);
    } else {
      out.push(`<div class="md-p" style="--lv:${lv}">${keyed(t, opt)}</div>`);
    }
  }
  const gap = '<div class="md-gap"></div>';
  while (out[0] === gap) out.shift();
  while (out[out.length - 1] === gap) out.pop();
  return out.filter((x, i) => !(x === gap && out[i - 1] === gap)).join('');
}

export const hasCloze = (s) => /==.+?==/.test(s || '');
export const firstLine = (s) => String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').split('\n').map((l) => l.trim()).find(Boolean)?.replace(/^([-*+•>#]+|\d+[.)])\s*/, '').replace(/==|\*\*/g, '') || '';
