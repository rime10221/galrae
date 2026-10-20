// 과목 탭: 정리·카드 학습에서 과목(맨 위 갈래)을 한꺼번에 띄우지 않고, 고른 과목 하나만 보여 준다.
// 갈래에 'tabs' 옵션을 켜면(예: 내과) 그 하위 갈래(순환기·호흡기…)도 한 줄 아래 탭으로 나뉜다. 여러 단계 가능.
// 고른 탭은 기기에 기억되고 두 화면이 같이 쓴다.
import * as S from './store.js';
import { esc, lsGet, lsSet } from './util.js';

const KEY = 'galrae.v1.subject';
const LAST = 'galrae.v1.subjectLast'; // 탭 줄마다 마지막으로 고른 탭 { 부모 id: 고른 id }

const isTabs = (id) => !!S.node(id)?.tabs && S.children(id).length > 0;

// 탭 줄들과, 목록에 보일 범위(scope: 이 갈래의 하위가 목록에 나온다)
export function resolve() {
  const pref = lsGet(KEY, null);
  const last = lsGet(LAST, {});
  const rows = [];
  let parent = null;
  let items = S.roots();
  while (items.length) {
    const on = items.find((x) => x === pref || (pref && S.node(pref) && S.isAncestor(x, pref)))
      || (items.includes(last[parent ?? '']) ? last[parent ?? ''] : items[0]);
    rows.push({ parent, items, on });
    if (!isTabs(on)) break;
    parent = on;
    items = S.children(on);
  }
  return { rows, scope: rows.length ? rows[rows.length - 1].on : null };
}

export const current = () => resolve().scope;

// 이 갈래가 지금 탭에서 고른 경로(과목 › 하위 과목…) 위에 있거나 그 범위 안인지
export function inView(id) {
  const { rows, scope } = resolve();
  return id === scope || S.isAncestor(scope, id) || rows.some((r) => r.on === id);
}

export function set(id) {
  if (!id || !S.node(id)) return;
  lsSet(KEY, id);
  const last = lsGet(LAST, {});
  for (const n of S.path(id)) last[S.parentOf(n.id) ?? ''] = n.id;
  lsSet(LAST, last);
}

// add: 맨 윗줄 끝에 '+ 과목', 아래 줄 끝에는 그 과목 안에 '+' (새 하위 과목)
export function tabsHtml({ add = false } = {}) {
  const { rows } = resolve();
  if (!rows.length && !add) return '';
  if (!rows.length) return '<div class="subj-tabs"><button class="subj-tab add" data-act="add-root" title="새 과목">＋ 과목</button></div>';
  return rows.map((r, i) => `<div class="subj-tabs ${i ? 'sub' : ''}" role="tablist">${i ? '<span class="subj-arrow">›</span>' : ''}${r.items.map((x) => {
    const n = S.node(x);
    return `<button class="subj-tab ${x === r.on ? 'on' : ''}${isTabs(x) ? ' group' : ''}" role="tab" aria-selected="${x === r.on}" data-subject="${x}"><span>${esc(n.title || '제목 없음')}</span><small>${S.descendants(x).length - 1}</small></button>`;
  }).join('')}${add ? (i ? `<button class="subj-tab add" data-act="add-subtab" data-parent="${r.parent}" title="이 안에 새 하위 과목">＋</button>` : '<button class="subj-tab add" data-act="add-root" title="새 과목">＋ 과목</button>') : ''}</div>`).join('');
}
