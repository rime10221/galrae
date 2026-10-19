// 읽기 화면 확대
// · 외울 것(.pz): 두 손가락 · Ctrl+휠 · 가−/가+ 버튼으로 글자째 크게. 화면 너비 안에서 줄바꿈되어 잘리지 않는다.
//   배율은 기기에 기억되고 모든 외울 것(정리·마인드맵·카드 뒷면)에 같이 적용 (CSS 변수 --read-zoom)
// · 사진 크게 보기(.pz.pz-both): 사진 자체를 확대하고 위아래·좌우로 밀어 본다
// · 앱 전체가 확대되는 건 막는다 (확대된 채로 돌아오지 않는 문제)
// 마크업: <div class="pz"><div class="pz-in">내용</div></div>
import { lsGet, lsSet, debounce } from './util.js';

const KEY = 'galrae.v1.readZoom';
const MIN = 0.8, MAX = 4, PIC_MAX = 6;
const clamp = (s, lo, hi) => Math.min(hi, Math.max(lo, s));
let level = clamp(Number(lsGet(KEY, 1)) || 1, MIN, MAX);
let pinch = null;
let lastPinch = 0;

export const recentlyPinched = () => Date.now() - lastPinch < 450;
const pct = () => `${Math.round(level * 100)}%`;
// 가− 100% 가+ 버튼 (읽기 화면 머리에)
export const ctlHtml = () => `<span class="zoom-ctl"><button data-zoom="-" title="글자 작게">가−</button><button data-zoom="0" class="zoom-pct" title="원래 크기로">${pct()}</button><button data-zoom="+" title="글자 크게 (두 손가락·Ctrl+휠도 돼요)">가+</button></span>`;

function scrollParent(n) {
  for (n = n.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}

const saveLevel = debounce(() => lsSet(KEY, level), 300);

// 글자 배율 바꾸기. (box, y) 를 주면 그 높이에 있던 줄이 제자리에 남도록 스크롤을 맞춘다
function setLevel(s, box = null, x = 0, y = 0) {
  s = clamp(s, MIN, MAX);
  if (Math.abs(s - 1) < 0.03) s = 1;
  let ref = null, top0 = 0;
  if (box) {
    ref = document.elementFromPoint(x, y);
    if (!ref || !box.contains(ref)) ref = null;
    if (ref) top0 = ref.getBoundingClientRect().top;
  }
  level = s;
  document.documentElement.style.setProperty('--read-zoom', String(level));
  document.querySelectorAll('.zoom-pct').forEach((b) => { b.textContent = pct(); });
  if (ref && ref.isConnected) scrollParent(box).scrollBy(0, ref.getBoundingClientRect().top - top0);
  saveLevel();
}

// 사진 크게 보기: 사진 자체를 확대
function picInner(box) { return box.querySelector(':scope > .pz-in'); }
function picZoom(box, s, x, y, anchor) {
  const el = picInner(box);
  s = clamp(s, 1, PIC_MAX);
  if (s < 1.02) s = 1;
  box._pz = s;
  el.style.transformOrigin = '0 0';
  el.style.transform = s === 1 ? '' : `scale(${s})`;
  const r = el.getBoundingClientRect();
  box.scrollLeft += r.left + anchor.cx * s - x;
  box.scrollTop += r.top + anchor.cy * s - y;
}
function picAnchor(box, x, y) {
  const r = picInner(box).getBoundingClientRect(), s = box._pz || 1;
  return { cx: (x - r.left) / s, cy: (y - r.top) / s };
}

const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

export function init() {
  document.documentElement.style.setProperty('--read-zoom', String(level));

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    const a = e.touches[0].target.closest?.('.pz'), b = e.touches[1].target.closest?.('.pz');
    if (!a || a !== b) return;
    e.preventDefault();
    const m = mid(e.touches);
    const pic = a.classList.contains('pz-both');
    pinch = { box: a, pic, d0: dist(e.touches), s0: pic ? (a._pz || 1) : level, anchor: pic ? picAnchor(a, m.x, m.y) : null };
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const m = mid(e.touches);
    const s = pinch.s0 * dist(e.touches) / pinch.d0;
    if (pinch.pic) picZoom(pinch.box, s, m.x, m.y, pinch.anchor);
    else setLevel(s, pinch.box, m.x, m.y);
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
    const k = Math.exp(-e.deltaY * 0.01);
    if (box.classList.contains('pz-both')) picZoom(box, (box._pz || 1) * k, e.clientX, e.clientY, picAnchor(box, e.clientX, e.clientY));
    else setLevel(level * k, box, e.clientX, e.clientY);
  }, { passive: false });
  // 가− / 100% / 가+
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-zoom]');
    if (!b) return;
    e.preventDefault();
    const z = b.dataset.zoom;
    setLevel(z === '0' ? 1 : z === '+' ? level * 1.15 : level / 1.15);
  });
  // iOS 사파리: 앱 전체 확대 막기
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
}
