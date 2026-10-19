// 손가락 확대: 읽기 화면의 외울 것(.pz)을 한 덩어리로 두 손가락 확대/축소 (PC는 Ctrl+휠·트랙패드)
// 마크업: <div class="pz"><div class="pz-in">내용</div></div>
// · 확대하면 아래로 늘어나서 화면 스크롤로 읽고, 옆으로 넘친 부분은 한 손가락으로 밀어 본다
// · .pz-both 는 상자 안에서 위아래·좌우 모두 스크롤 (사진 크게 보기)
// · 앱 전체가 확대되는 건 막는다 (확대된 채로 돌아오지 않는 문제)
const MAX = 5;
const zoomed = new Set();
let pinch = null;
let lastPinch = 0;
let pill = null;

export const recentlyPinched = () => Date.now() - lastPinch < 450;

function scrollParent(n) {
  for (n = n.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}

function inner(box) { return box.querySelector(':scope > .pz-in'); }

function apply(box, s) {
  const el = inner(box);
  if (!el) return;
  s = Math.min(MAX, Math.max(1, s));
  if (s < 1.02) s = 1;
  box._pz = s;
  el.style.transformOrigin = '0 0';
  el.style.transform = s === 1 ? '' : `scale(${s})`;
  // 확대한 만큼 아래로 자리를 만들어 화면 스크롤로 읽게 한다
  el.style.marginBottom = s === 1 ? '' : `${(s - 1) * el.offsetHeight}px`;
  box.classList.toggle('pz-on', s > 1);
  if (s > 1) zoomed.add(box); else zoomed.delete(box);
  syncPill();
}

// (x, y) 화면 좌표 아래의 내용이 그대로 그 자리에 있도록 확대
function zoomAt(box, s, x, y, from = box._pz || 1, anchor = null) {
  const el = inner(box);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const a = anchor || { cx: (x - r.left) / from, cy: (y - r.top) / from };
  apply(box, s);
  const r2 = el.getBoundingClientRect();
  const dx = r2.left + a.cx * box._pz - x;
  const dy = r2.top + a.cy * box._pz - y;
  box.scrollLeft += dx;
  if (box.classList.contains('pz-both')) box.scrollTop += dy;
  else scrollParent(box).scrollBy(0, dy);
}

export function reset(box) {
  apply(box, 1);
  box.scrollLeft = 0;
}

function syncPill() {
  for (const b of zoomed) if (!b.isConnected) zoomed.delete(b);
  if (!pill) return;
  pill.hidden = ![...zoomed].some((b) => !b.classList.contains('pz-both'));
}

const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

export function init() {
  pill = document.createElement('button');
  pill.className = 'pz-reset';
  pill.hidden = true;
  pill.textContent = '↺ 원래 크기';
  pill.addEventListener('click', () => { [...zoomed].forEach(reset); syncPill(); });
  document.body.append(pill);

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    const a = e.touches[0].target.closest?.('.pz'), b = e.touches[1].target.closest?.('.pz');
    if (!a || a !== b) return;
    e.preventDefault();
    const m = mid(e.touches);
    const el = inner(a);
    const r = el.getBoundingClientRect();
    const s0 = a._pz || 1;
    pinch = { box: a, d0: dist(e.touches), s0, anchor: { cx: (m.x - r.left) / s0, cy: (m.y - r.top) / s0 } };
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const m = mid(e.touches);
    zoomAt(pinch.box, pinch.s0 * dist(e.touches) / pinch.d0, m.x, m.y, pinch.s0, pinch.anchor);
  }, { passive: false });
  const end = (e) => {
    if (!pinch || e.touches.length >= 2) return;
    pinch = null;
    lastPinch = Date.now();
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
  // PC: Ctrl+휠 / 트랙패드 오므리기
  document.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    const box = e.target.closest?.('.pz');
    if (!box) return;
    e.preventDefault();
    const s = box._pz || 1;
    zoomAt(box, s * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY, s);
  }, { passive: false });
  // iOS 사파리: 앱 전체 확대 막기 (외울 것은 위에서 따로 확대)
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  // 다시 그려져서 사라진 확대 상자는 정리
  new MutationObserver(() => { if (zoomed.size) syncPill(); }).observe(document.body, { childList: true, subtree: true });
}
