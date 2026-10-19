// 옵시디언 스타일 그래프: 캔버스 + 마인드맵 정렬(왼→오) / 자유 배치(물리)
const LABEL_PX = 13;
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
const shortLabel = (s) => (s.length > 24 ? s.slice(0, 23) + '…' : s);

export class Graph {
  constructor(canvas, { onSelect, onOpen } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect || (() => {});
    this.onOpen = onOpen || (() => {});
    this.nodes = [];
    this.map = new Map();
    this.edges = [];
    this.adj = new Map();
    this.view = { x: 0, y: 0, k: 1 };
    this.alpha = 0;
    this.layout = 'tree';
    this.sel = null;
    this.hover = null;
    this.highlight = null; // 경로 강조용 id 집합
    this.ptrs = new Map();
    this.raf = 0;
    this.tween = null;
    this.colors = {};
    this.bind();
    new ResizeObserver(() => { this.resize(); this.kick(0); }).observe(canvas);
    this.resize();
  }

  readColors() {
    const cs = getComputedStyle(this.c);
    const v = (n) => cs.getPropertyValue(n).trim();
    this.colors = { edge: v('--g-edge'), link: v('--g-link'), text: v('--g-text'), ring: v('--accent'), bg: v('--bg') };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.c;
    if (!w || !h) return;
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.W = w; this.H = h; this.dpr = dpr;
  }

  // list: [{id, parent, label, depth, color, r}], links: [[a,b]]
  setData(list, links = []) {
    const old = this.map;
    this.nodes = list.map((d) => {
      const o = old.get(d.id);
      return Object.assign(o || { x: 0, y: 0, vx: 0, vy: 0, fresh: true }, d);
    });
    this.map = new Map(this.nodes.map((n) => [n.id, n]));
    this.edges = [];
    this.adj = new Map(this.nodes.map((n) => [n.id, new Set()]));
    for (const n of this.nodes) {
      if (n.parent && this.map.has(n.parent)) this.addEdge(n.parent, n.id, 'tree');
    }
    for (const [a, b] of links) if (this.map.has(a) && this.map.has(b) && a !== b) this.addEdge(a, b, 'link');
    this.computeTree();
    for (const n of this.nodes) {
      if (!n.fresh) continue;
      const p = this.map.get(n.parent);
      const bx = p && !p.fresh ? p.x : n.tx, by = p && !p.fresh ? p.y : n.ty;
      n.x = bx + (Math.random() - 0.5) * 20;
      n.y = by + (Math.random() - 0.5) * 20;
      n.fresh = false;
    }
    if (this.sel && !this.map.has(this.sel)) this.sel = null;
    this.kick(0.8);
  }

  addEdge(s, t, kind) {
    this.edges.push({ s: this.map.get(s), t: this.map.get(t), kind });
    this.adj.get(s).add(t);
    this.adj.get(t).add(s);
  }

  // 마인드맵 정렬: 큰 갈래는 왼쪽, 하위로 갈수록 오른쪽 열. 잎은 위에서 아래로 차례대로 쌓고
  // 부모는 자식들의 가운데 높이에 둔다.
  computeTree() {
    const kids = new Map();
    for (const n of this.nodes) {
      const p = this.map.has(n.parent) ? n.parent : null;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    }
    // 깊이(열)별 가장 긴 라벨 너비 → 열 간격
    this.ctx.font = `600 ${LABEL_PX}px ${FONT}`;
    const colW = new Map();
    for (const n of this.nodes) {
      n.lw = this.ctx.measureText(shortLabel(n.label)).width;
      colW.set(n.depth, Math.max(colW.get(n.depth) || 0, n.lw + n.r * 2));
    }
    const depths = [...colW.keys()].sort((a, b) => a - b);
    const colX = new Map();
    let x = 0;
    for (const d of depths) { colX.set(d, x); x += colW.get(d) + 70; }
    const ROW = 30;
    let y = 0;
    const place = (n) => {
      const ks = kids.get(n.id) || [];
      n.tx = colX.get(n.depth) ?? 0;
      if (!ks.length) { n.ty = y; y += ROW; return; }
      for (const k of ks) place(k);
      n.ty = (ks[0].ty + ks[ks.length - 1].ty) / 2;
    };
    for (const r of kids.get(null) || []) { place(r); y += ROW * 0.8; }
    // 가운데 정렬
    const midY = (y - ROW) / 2, midX = x / 2 - 60;
    for (const n of this.nodes) { n.tx -= midX; n.ty -= midY; }
  }

  setLayout(l) { this.layout = l; this.kick(1); }

  kick(a = 0.5) {
    this.alpha = Math.max(this.alpha, a);
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  frame() {
    this.raf = 0;
    if (this.alpha > 0.003) this.tick();
    if (this.tween) {
      const t = Math.min(1, (performance.now() - this.tween.t0) / this.tween.ms);
      const e = 1 - Math.pow(1 - t, 3);
      const { from, to } = this.tween;
      this.view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      if (t >= 1) this.tween = null;
    }
    this.draw();
    if (this.alpha > 0.003 || this.tween) this.raf = requestAnimationFrame(() => this.frame());
  }

  tick() {
    const N = this.nodes, a = this.alpha, radial = this.layout === 'tree';
    // 마인드맵은 계산된 자리로만 끌어당긴다(위치가 고정돼 기억하기 쉬움). 자유 배치만 물리 적용
    const rep = 900;
    for (let i = 0; !radial && i < N.length; i++) {
      const p = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const q = N[j];
        let dx = q.x - p.x, dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 160000) continue;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        const f = (rep * a) / d2;
        p.vx -= dx * f; p.vy -= dy * f;
        q.vx += dx * f; q.vy += dy * f;
      }
    }
    for (const e of radial ? [] : this.edges) {
      const { s, t } = e;
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = e.kind === 'tree' ? 50 + (s.r + t.r) * 2 : 160;
      const k = e.kind === 'tree' ? 0.12 : 0.02;
      const f = ((d - rest) / d) * k * a;
      t.vx -= dx * f; t.vy -= dy * f;
      s.vx += dx * f; s.vy += dy * f;
    }
    for (const n of N) {
      if (radial) { n.vx += (n.tx - n.x) * 0.25; n.vy += (n.ty - n.y) * 0.25; }
      else { n.vx -= n.x * 0.004 * a; n.vy -= n.y * 0.004 * a; }
      if (n === this.drag) { n.vx = n.vy = 0; continue; }
      n.vx *= 0.6; n.vy *= 0.6;
      n.x += n.vx; n.y += n.vy;
    }
    this.alpha *= 0.975;
  }

  // 너무 축소하면 깊은 갈래의 라벨은 숨긴다(선은 노드에서 바로 출발)
  labelShown(n, fs) {
    return this.view.k * LABEL_PX >= 5 || n.depth <= 1 || (fs && fs.has(n.id));
  }

  focusSet() {
    const f = this.hover || this.sel;
    if (!f) return this.highlight;
    const s = new Set([f, ...(this.adj.get(f) || [])]);
    if (this.highlight) for (const x of this.highlight) s.add(x);
    return s;
  }

  draw() {
    const { ctx, view, W, H } = this;
    if (!W) return;
    if (!this.colors.text) this.readColors();
    const C = this.colors;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.k, view.k);
    const k = view.k;
    const fs = this.focusSet();
    const dim = (id) => fs && !fs.has(id);
    const tree = this.layout === 'tree';

    ctx.lineWidth = 1.2 / k;
    for (const e of this.edges) {
      const on = fs && fs.has(e.s.id) && fs.has(e.t.id);
      ctx.globalAlpha = fs ? (on ? 0.95 : 0.07) : 0.55;
      ctx.strokeStyle = e.kind === 'link' ? C.link : on ? C.ring : C.edge;
      if (e.kind === 'link') ctx.setLineDash([4 / k, 4 / k]);
      ctx.beginPath();
      if (tree && e.kind === 'tree') {
        // 마인드맵: 부모 라벨 끝에서 출발하는 부드러운 가로 S자 곡선, 자식 갈래 색
        const sx = e.s.x + e.s.r + (this.labelShown(e.s, fs) ? 12 + (e.s.lw || 0) : 0);
        const mx = (sx + e.t.x) / 2;
        ctx.moveTo(sx, e.s.y);
        ctx.bezierCurveTo(mx, e.s.y, mx, e.t.y, e.t.x - e.t.r, e.t.y);
        ctx.strokeStyle = on ? C.ring : e.t.color;
        ctx.lineWidth = (e.t.depth <= 2 ? 2.4 : 1.6) / Math.max(k, 0.6);
      } else {
        ctx.moveTo(e.s.x, e.s.y);
        ctx.lineTo(e.t.x, e.t.y);
      }
      ctx.stroke();
      ctx.lineWidth = 1.2 / k;
      if (e.kind === 'link') ctx.setLineDash([]);
    }

    for (const n of this.nodes) {
      ctx.globalAlpha = dim(n.id) ? 0.15 : 1;
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (n.id === this.sel || n.id === this.hover) {
        ctx.strokeStyle = C.ring;
        ctx.lineWidth = 2.5 / k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (tree) {
      // 노드 오른쪽에 라벨. 글자 크기는 배치 계산과 같은 월드 단위라 확대해도 겹치지 않는다
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const n of this.nodes) {
        if (!this.labelShown(n, fs)) continue;
        const bold = n.depth <= 2 || n.id === this.sel;
        ctx.font = `${bold ? 600 : 400} ${LABEL_PX}px ${FONT}`;
        ctx.globalAlpha = dim(n.id) ? 0.28 : 1;
        ctx.fillStyle = C.text;
        ctx.fillText(shortLabel(n.label), n.x + n.r + 6, n.y);
      }
      ctx.globalAlpha = 1;
      return;
    }
    const labelDepth = k < 0.35 ? 1 : k < 0.6 ? 2 : k < 1 ? 3 : 99;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of this.nodes) {
      const focus = fs && fs.has(n.id);
      if (!focus && (n.depth > labelDepth || dim(n.id))) continue;
      // 화면상 글자 크기를 일정하게 (많이 확대하면 조금씩 커짐)
      const size = (n.depth <= 1 ? 14 : n.depth === 2 ? 12.5 : 11.5) / Math.min(k, 1.6);
      ctx.font = `${n.depth <= 2 || n.id === this.sel ? 600 : 400} ${size}px ${FONT}`;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = C.bg;
      const label = shortLabel(n.label);
      ctx.strokeText(label, n.x, n.y + n.r + 3 / k);
      ctx.fillStyle = C.text;
      ctx.fillText(label, n.x, n.y + n.r + 3 / k);
    }
    ctx.globalAlpha = 1;
  }

  toWorld(sx, sy) {
    return { x: (sx - this.W / 2 - this.view.x) / this.view.k, y: (sy - this.H / 2 - this.view.y) / this.view.k };
  }

  hit(sx, sy) {
    const p = this.toWorld(sx, sy);
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      const lim = n.r + 6 / this.view.k;
      if (d < lim && d < bd) { best = n; bd = d; }
      // 마인드맵에서는 라벨을 눌러도 선택
      else if (this.layout === 'tree' && !best && p.x > n.x && p.x < n.x + n.r + 8 + (n.lw || 0) && Math.abs(p.y - n.y) < LABEL_PX * 0.75) best = n;
    }
    return best;
  }

  zoomAt(sx, sy, k2) {
    k2 = Math.min(6, Math.max(0.08, k2));
    const w = this.toWorld(sx, sy);
    this.view.k = k2;
    this.view.x = sx - this.W / 2 - w.x * k2;
    this.view.y = sy - this.H / 2 - w.y * k2;
    this.tween = null;
    this.kick(0);
  }

  bind() {
    const c = this.c;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = pos(e);
      this.ptrs.set(e.pointerId, p);
      if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.view.k };
        this.drag = null; this.pan = null;
        return;
      }
      this.down = { ...p, t: performance.now(), moved: false };
      const n = this.hit(p.x, p.y);
      if (n) { this.drag = n; } else { this.pan = { x: p.x - this.view.x, y: p.y - this.view.y }; }
      this.tween = null;
    });
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, p);
      if (this.pinch && this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, this.pinch.k * (d / this.pinch.d));
        return;
      }
      if (this.down) {
        if (Math.hypot(p.x - this.down.x, p.y - this.down.y) > 5) this.down.moved = true;
        if (!this.down.moved) return;
        if (this.drag) {
          const w = this.toWorld(p.x, p.y);
          this.drag.x = w.x; this.drag.y = w.y;
          this.kick(0.25);
        } else if (this.pan) {
          this.view.x = p.x - this.pan.x;
          this.view.y = p.y - this.pan.y;
          this.kick(0);
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        const n = this.hit(p.x, p.y);
        const id = n ? n.id : null;
        if (id !== this.hover) { this.hover = id; c.style.cursor = n ? 'pointer' : 'grab'; this.kick(0); }
      }
    });
    const up = (e) => {
      this.ptrs.delete(e.pointerId);
      if (this.pinch) { if (this.ptrs.size < 2) this.pinch = null; this.down = null; return; }
      const d = this.down;
      if (d && !d.moved && performance.now() - d.t < 500) {
        const n = this.hit(d.x, d.y);
        const now = performance.now();
        if (n && this.lastTap && this.lastTap.id === n.id && now - this.lastTap.t < 350) this.onOpen(n.id);
        this.lastTap = n ? { id: n.id, t: now } : null;
        this.select(n ? n.id : null, true);
      }
      this.down = null; this.drag = null; this.pan = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && this.hover) { this.hover = null; this.kick(0); } });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this.zoomAt(p.x, p.y, this.view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
  }

  select(id, fromUser = false) {
    this.sel = id;
    this.kick(0);
    if (fromUser) this.onSelect(id);
  }

  animateTo(to, ms = 450) {
    this.tween = { from: { ...this.view }, to, t0: performance.now(), ms };
    this.kick(0);
  }

  // off: 정보 패널에 가리지 않도록 화면 중심을 옮기는 양(px)
  centerOn(id, k, off = { x: 0, y: 0 }) {
    const n = this.map.get(id);
    if (!n) return;
    const kk = k || Math.max(this.view.k, 1.1);
    // 시뮬레이션이 진행 중이면 목표 위치 기준으로
    const x = this.layout === 'tree' ? n.tx : n.x, y = this.layout === 'tree' ? n.ty : n.y;
    this.animateTo({ x: -x * kk + off.x, y: -y * kk + off.y, k: kk });
  }

  fit(ms = 450) {
    if (!this.nodes.length || !this.W) return;
    const useT = this.layout === 'tree';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.nodes) {
      const x = useT ? n.tx : n.x, y = useT ? n.ty : n.y;
      // 마인드맵은 노드 오른쪽 라벨까지 화면에 들어오게
      const right = useT ? x + n.r + 8 + (n.lw || 0) : x;
      x0 = Math.min(x0, x - n.r); y0 = Math.min(y0, y); x1 = Math.max(x1, right); y1 = Math.max(y1, y);
    }
    let k = Math.min(2, (this.W - 60) / (x1 - x0 + 120), (this.H - 60) / (y1 - y0 + 120));
    let to = { x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k, k };
    // 좁은 화면(휴대폰): 글자가 읽히는 크기는 지키고, 가장 큰 갈래(왼쪽)부터 보이게
    if (useT && k < 0.7) {
      k = 0.7;
      to = { x: -this.W / 2 + 24 - x0 * k, y: -((y0 + y1) / 2) * k, k };
    }
    if (ms) this.animateTo(to, ms); else { this.view = to; this.kick(0); }
  }
}
