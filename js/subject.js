// 과목 탭: 정리·카드 학습에서 과목(맨 위 갈래)을 한꺼번에 띄우지 않고, 고른 과목 하나만 보여 준다.
// 고른 과목은 기기에 기억되고 두 화면이 같이 쓴다.
import * as S from './store.js';
import { esc, lsGet, lsSet } from './util.js';

const KEY = 'galrae.v1.subject';

export function current() {
  const roots = S.roots();
  const id = lsGet(KEY, null);
  return roots.includes(id) ? id : roots[0] || null;
}

export function set(id) {
  if (id && S.node(id)) lsSet(KEY, S.rootOf(id));
}

// add: 맨 끝에 '+ 과목' 버튼
export function tabsHtml(cur, { add = false } = {}) {
  const roots = S.roots();
  if (!roots.length && !add) return '';
  return `<div class="subj-tabs" role="tablist">${roots.map((r) => {
    const n = S.node(r);
    return `<button class="subj-tab ${r === cur ? 'on' : ''}" role="tab" aria-selected="${r === cur}" data-subject="${r}"><span>${esc(n.title || '제목 없음')}</span><small>${S.descendants(r).length - 1}</small></button>`;
  }).join('')}${add ? '<button class="subj-tab add" data-act="add-root" title="새 과목">＋ 과목</button>' : ''}</div>`;
}
