// 진도표: 과목별 단원을 직접 기록하는 표. 작성(기본 진도) + 내가 정한 행위(복습·문제풀이…)를 열마다 따로 체크
import * as S from './store.js';
import { $, esc, uid, openDialog, confirmDlg, lsGet, lsSet } from './util.js';

let el, api;
const FOLD = 'galrae.v1.planFold';
let fold = new Set(lsGet(FOLD, []));
const STATE = [['○', '안 함'], ['◐', '하는 중'], ['●', '완료']];

export function init(root, hooks) {
  el = root;
  api = hooks;
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('keydown', onKey);
}

export const show = () => render();
export const onStoreChange = (o) => { if (o.src !== 'plan') render(); };

// 열마다 완료 수
function stats(items, cols) {
  return cols.map((c) => {
    const done = items.filter((r) => S.actState(r, c.id) === 2).length;
    return { ...c, done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
  });
}

function statHtml(st) {
  return `<div class="plan-stats">${st.map((c) => `<span class="plan-stat" title="${esc(c.name)} ${c.done}/${c.total}">
    <b>${esc(c.name)}</b><span class="bar"><i style="width:${c.pct}%"></i></span><em>${c.done}/${c.total}</em></span>`).join('')}</div>`;
}

function render() {
  if (!el) return;
  const cols = S.trackCols();
  const subs = S.trackSubjects();
  const all = subs.flatMap((s) => S.trackItems(s.id));
  el.innerHTML = `<div class="page plan" style="--ncol:${cols.length}">
    <header class="page-h"><div><h1>진도표</h1>
      <p class="muted small">○ 누르면 안 함 → ◐ 하는 중 → ● 완료 · 행위(열)마다 따로 체크해요</p></div>
      <div class="btn-row"><button class="btn small" data-act="cols">행위 설정</button><button class="btn small" data-act="paste">목록 붙여넣기</button><button class="btn small primary" data-act="add-subject">＋ 과목</button></div></header>
    ${all.length ? `<section class="panel plan-total"><h3>전체</h3>${statHtml(stats(all, cols))}</section>` : ''}
    ${subs.length ? subs.map((s) => subjectHtml(s, cols)).join('') : `<section class="panel plan-empty"><p>아직 진도표가 비어 있어요.</p><p class="muted small">「＋ 과목」으로 과목을 만들고 단원을 적거나, 「목록 붙여넣기」로 교재 목차를 한 번에 넣을 수 있어요. 「행위 설정」에서 작성 말고 체크할 행위(복습·문제풀이…)를 정해요.</p></section>`}
  </div>`;
}

function subjectHtml(s, cols) {
  const closed = fold.has(s.id);
  const items = S.trackItems(s.id);
  return `<section class="panel plan-subj" data-sid="${s.id}">
    <div class="plan-head">
      <button class="icon-btn" data-act="fold" title="접기/펼치기">${closed ? '▸' : '▾'}</button>
      <input class="input plan-name" data-f="title" value="${esc(s.title)}" aria-label="과목 이름">
      <button class="icon-btn" data-act="up" title="위로">↑</button><button class="icon-btn" data-act="down" title="아래로">↓</button>
      <button class="icon-btn" data-act="del-subject" title="과목 삭제">🗑</button>
    </div>
    ${statHtml(stats(items, cols))}
    ${closed ? '' : `${items.length ? `<div class="plan-row plan-colhead"><span></span>${cols.map((c) => `<span class="plan-colname" title="${esc(c.name)}">${esc(c.name)}</span>`).join('')}<span>날짜</span><span>메모</span><span></span></div>` : ''}
    <div class="plan-rows">${items.map((r) => rowHtml(r, cols)).join('')}</div>
    <div class="plan-add"><input class="input" data-f="new" placeholder="단원 추가 (Enter)"></div>`}
  </section>`;
}

function rowHtml(r, cols) {
  return `<div class="plan-row s${r.state || 0}" data-rid="${r.id}">
    <input class="input plan-title" data-f="title" value="${esc(r.title)}" aria-label="단원">
    ${cols.map((c) => {
      const v = S.actState(r, c.id);
      const [sym, label] = STATE[v] || STATE[0];
      return `<button class="plan-st v${v}" data-act="state" data-col="${c.id}" title="${esc(c.name)}: ${label}" aria-label="${esc(c.name)} ${label}"><i>${sym}</i><small>${esc(c.name)}</small></button>`;
    }).join('')}
    <input class="input plan-date" data-f="date" type="date" value="${esc(r.date || '')}" title="날짜">
    <input class="input plan-memo" data-f="memo" value="${esc(r.memo || '')}" placeholder="메모">
    <span class="plan-ops"><button class="icon-btn" data-act="up" title="위로">↑</button><button class="icon-btn" data-act="down" title="아래로">↓</button><button class="icon-btn" data-act="del" title="삭제">✕</button></span>
  </div>`;
}

const sidOf = (t) => t.closest('[data-sid]')?.dataset.sid;
const ridOf = (t) => t.closest('[data-rid]')?.dataset.rid;

async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const sid = sidOf(b), rid = ridOf(b);
  switch (b.dataset.act) {
    case 'add-subject': {
      const id = S.as('plan', () => S.trackAdd(null, '새 과목'));
      render();
      const inp = $(`[data-sid="${id}"] .plan-name`, el);
      inp?.focus(); inp?.select();
      return;
    }
    case 'paste': return pasteDialog();
    case 'cols': return colsDialog();
    case 'fold':
      if (fold.has(sid)) fold.delete(sid); else fold.add(sid);
      lsSet(FOLD, [...fold]);
      return render();
    case 'state': {
      const r = S.trackRow(rid), col = b.dataset.col;
      const v = (S.actState(r, col) + 1) % 3;
      S.as('plan', () => {
        S.trackSetAct(rid, col, v);
        // 기본 진도(작성)를 끝내면 그날 날짜를 적어 둔다
        if (col === 'base' && v === 2 && !r.date) S.trackUpdate(rid, { date: todayStr() });
      });
      return render();
    }
    case 'up': case 'down':
      S.as('plan', () => S.trackMove(rid || sid, b.dataset.act === 'up' ? -1 : 1));
      return render();
    case 'del':
      S.as('plan', () => S.trackDelete(rid));
      return render();
    case 'del-subject': {
      const n = S.trackItems(sid).length;
      if (await confirmDlg(`'${S.trackRow(sid).title}' 과목을 삭제할까요?`, { ok: '삭제', danger: true, detail: n ? `단원 ${n}개의 기록도 함께 지워져요.` : '' })) {
        S.as('plan', () => S.trackDelete(sid));
        render();
      }
    }
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function onChange(e) {
  const f = e.target.dataset.f;
  if (!f || f === 'new' || !el.contains(e.target)) return;
  const id = ridOf(e.target) || sidOf(e.target);
  if (!id) return;
  const v = f === 'title' ? e.target.value.trim() : e.target.value;
  if (f === 'title' && !v) { e.target.value = S.trackRow(id).title; return; }
  S.as('plan', () => S.trackUpdate(id, { [f]: v }));
}

function onKey(e) {
  if (e.isComposing || e.key !== 'Enter') return;
  const t = e.target;
  if (t.dataset.f === 'new') {
    const v = t.value.trim();
    if (!v) return;
    S.as('plan', () => S.trackAdd(sidOf(t), v));
    render();
    $(`[data-sid="${sidOf(t)}"] [data-f="new"]`, el)?.focus();
  } else if (t.dataset.f) t.blur();
}

// 행위(열) 이름 바꾸기 · 추가 · 삭제 · 순서. 작성(기본 진도)은 지울 수 없다
function colsDialog() {
  let cols = S.trackCols().map((c) => ({ ...c }));
  return openDialog(`<div class="dlg-body">
    <p class="dlg-msg">행위 설정</p>
    <p class="muted small">진도표에서 단원마다 따로 체크할 행위예요. 맨 앞 기본 진도는 지울 수 없어요(이름은 바꿀 수 있어요). 행위를 지우면 그 열의 체크도 진도표에서 사라져요.</p>
    <div class="plan-cols"></div>
    <div class="plan-cols-add"><input class="input" id="colNew" placeholder="새 행위 (예: 2회독, 기출)"><button class="btn small" id="colAdd">추가</button></div>
    <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button><button class="btn primary" id="colSave">저장</button></div></div>`, {
    onMount(d, close) {
      const list = d.querySelector('.plan-cols');
      const draw = () => {
        list.innerHTML = cols.map((c, i) => `<div class="plan-col" data-i="${i}">
          <input class="input" value="${esc(c.name)}" aria-label="행위 이름">
          <button class="icon-btn" data-m="-1" title="앞으로" ${i <= 1 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" data-m="1" title="뒤로" ${!i || i === cols.length - 1 ? 'disabled' : ''}>↓</button>
          ${c.id === 'base' ? '<span class="plan-col-base">기본</span>' : '<button class="icon-btn" data-x title="삭제">✕</button>'}
        </div>`).join('');
      };
      const sync = () => list.querySelectorAll('.plan-col').forEach((row) => { cols[+row.dataset.i].name = row.querySelector('input').value; });
      list.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        sync();
        const i = +b.closest('.plan-col').dataset.i;
        if (b.hasAttribute('data-x')) cols.splice(i, 1);
        else { const j = i + +b.dataset.m; [cols[i], cols[j]] = [cols[j], cols[i]]; }
        draw();
      });
      const inp = d.querySelector('#colNew');
      const add = () => {
        const v = inp.value.trim();
        if (!v) return inp.focus();
        sync();
        cols.push({ id: uid(), name: v });
        inp.value = '';
        draw();
        inp.focus();
      };
      d.querySelector('#colAdd').onclick = add;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
      d.querySelector('#colSave').onclick = () => {
        sync();
        if (inp.value.trim()) cols.push({ id: uid(), name: inp.value.trim() });
        cols = cols.map((c) => ({ ...c, name: c.name.trim() || (c.id === 'base' ? '작성' : '') })).filter((c) => c.name);
        S.as('plan', () => S.trackSetCols(cols));
        close(true);
        render();
      };
      draw();
    },
  });
}

function pasteDialog() {
  const subs = S.trackSubjects();
  return openDialog(`<div class="dlg-body">
    <p class="dlg-msg">목록 붙여넣기</p>
    <p class="muted small">한 줄에 단원 하나. <code># 과목 이름</code> 줄을 쓰면 그 과목(없으면 새로 만들어요) 아래로 들어가고, 쓰지 않으면 아래에서 고른 과목에 들어가요. 이미 있는 같은 이름 단원은 건너뛰어요.</p>
    <label class="field">넣을 과목 <select class="input" id="plSub"><option value="">(# 줄로 정하기)</option>${subs.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select></label>
    <textarea class="input mono" id="plText" rows="13" placeholder="# 내과\n1. 순환기\n2. 호흡기\n# 외과\n1. 외상"></textarea>
    <div class="dlg-actions"><button class="btn ghost" data-close="">취소</button><button class="btn primary" id="plGo">추가</button></div></div>`, {
    cls: 'wide',
    onMount(d, close) {
      const ta = d.querySelector('#plText');
      d.querySelector('#plGo').onclick = () => {
        if (!ta.value.trim()) return ta.focus();
        const n = S.as('plan', () => S.trackImport(ta.value, d.querySelector('#plSub').value || null));
        close(true);
        api.toast(`단원 ${n}개를 추가했어요`);
        render();
      };
      ta.focus();
    },
  });
}
