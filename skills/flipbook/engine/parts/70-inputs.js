// Inputs: hand-drawn charts (bars, lines, funnel) and SVG strokes drawn on with a pen (svgStrokes, drawOn).
// Layout is a pure function of (rows, box, unit, p). Tremor comes from f.R only; fills use f.still(key).
// Paints only through f.m.fill / f.m.stroke and write(), so every material works.

const IN_GEOM = 'path,circle,ellipse,rect,line,polyline,polygon';
const IN_SKIP = 'defs,clipPath,mask,symbol,pattern,marker';
const IN_K = 5;                                    // hydraulic damping for bar rises
const IN_HN = 1 - (1 + IN_K) * Math.exp(-IN_K);

// Critically damped rise: monotone, no overshoot, exactly 1 at u = 1.
const inHydra = u => { u = clamp(u); return (1 - (1 + IN_K * u) * Math.exp(-IN_K * u)) / IN_HN; };
const inFmt = v => Number(v).toLocaleString('es-MX');
const inPolyLen = pts => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
};
// One draw of R per stream, in fixed order: each element keeps its own tremor while its neighbours grow.
const inStreams = (R, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(stream(Math.floor(R() * 4294967296)));
  return out;
};
// Points cut after arc length d; the cut point is interpolated.
const inCut = (pts, d) => {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (acc + seg >= d) {
      const t = seg ? (d - acc) / seg : 0;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      return out;
    }
    out.push(pts[i]);
    acc += seg;
  }
  return out;
};
// Nice ticks covering [lo, hi] with about `count` intervals.
function inTicks(lo, hi, count) {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw);
  const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
  const n = Math.max(1, Math.round((b - a) / step));
  const ticks = [];
  for (let i = 0; i <= n; i++) ticks.push(+(a + i * step).toFixed(9));
  return { lo: a, hi: b, ticks };
}
// Spread desired centres so neighbours keep `gap`, staying inside [lo, hi] when there is room.
function inNudge(ys, gap, lo, hi) {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = ys.slice();
  let prev = -Infinity;
  for (const i of order) { out[i] = Math.max(out[i], prev + gap, lo); prev = out[i]; }
  if (prev > hi) {
    prev = Infinity;
    for (let k = order.length - 1; k >= 0; k--) { const i = order[k]; out[i] = Math.min(out[i], prev - gap, hi); prev = out[i]; }
  }
  return out;
}
// ---- SVG to pen strokes (browser only: DOMParser and SVG geometry APIs) ----
function inCol(v) {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?/.exec(v || '');
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Strokes in a w x h box, contain-fitted and centred: [{pts, closed, fill, stroke, len}], with out.len the total length.
// Sampling is `step` px in the output box. A gap wider than 4 steps starts a new stroke (subpath jump).
// ponytail: each subpath fills on its own, so a hole inside a path fills solid. Add even-odd compound fill if a glyph needs it.
function svgStrokes(svgText, o = {}) {
  const W = o.w ?? 1080, H = o.h ?? 1080, M = o.margin ?? 0, step = o.step ?? 2;
  if ((o.fit ?? 'contain') !== 'contain') throw new Error('svgStrokes: only fit "contain" is supported');
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('svgStrokes: SVG did not parse');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden';
  const root = document.importNode(doc.documentElement, true);
  holder.appendChild(root);
  document.body.appendChild(holder);
  try {
    const items = [];
    for (const el of root.querySelectorAll(IN_GEOM)) {
      if (el.closest(IN_SKIP)) continue;
      const cs = getComputedStyle(el);
      if (cs.fill === 'none' && cs.stroke === 'none') continue;
      const L = el.getTotalLength();
      if (!(L > 0)) continue;
      const d = el.getAttribute('d') || '';
      items.push({
        el, L, m: el.getCTM() || new DOMMatrix(), fill: inCol(cs.fill), stroke: inCol(cs.stroke),
        closed: el.localName === 'path' ? /z/i.test(d) : /^(rect|circle|ellipse|polygon)$/.test(el.localName)
      });
    }
    const at = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    const local = (el, L, n) => {
      const pts = [];
      for (let i = 0; i <= n; i++) { const q = el.getPointAtLength((L * i) / n); pts.push([q.x, q.y]); }
      return pts;
    };
    // pass 1: bounds in user space give the fit
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      for (const [x, y] of local(it.el, it.L, 200)) {
        const [X, Y] = at(it.m, x, y);
        x0 = Math.min(x0, X); x1 = Math.max(x1, X);
        y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
    }
    const out = [];
    out.len = 0;
    if (!(x1 >= x0)) return out;
    const bw = x1 - x0 || 1, bh = y1 - y0 || 1;
    const aw = W - 2 * M, ah = H - 2 * M;
    const k = Math.min(aw / bw, ah / bh);
    const ox = M + (aw - bw * k) / 2 - x0 * k, oy = M + (ah - bh * k) / 2 - y0 * k;
    // pass 2: sample at `step` px in the output box
    for (const it of items) {
      const sc = Math.sqrt(Math.abs(it.m.a * it.m.d - it.m.b * it.m.c)) || 1;
      const n = Math.min(40000, Math.max(2, Math.ceil((it.L * k * sc) / step)));
      const pts = local(it.el, it.L, n).map(([x, y]) => { const [X, Y] = at(it.m, x, y); return [X * k + ox, Y * k + oy]; });
      const runs = [[pts[0]]];
      for (let i = 1; i < pts.length; i++) {
        const run = runs[runs.length - 1];
        if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > 4 * step) runs.push([pts[i]]);
        else run.push(pts[i]);
      }
      for (const r of runs) {
        const len = inPolyLen(r);
        if (r.length > 1 && len > 0) {
          out.push({ pts: r, closed: it.closed, fill: it.fill, stroke: it.stroke, len });
          out.len += len;
        }
      }
    }
    return out;
  } finally {
    holder.remove();
  }
}

// Draw strokes from svgStrokes at progress p (0..1). The pen runs over all outlines in order at constant speed
// until colorFrom, then each filled shape fades in, one after another, under the outlines.
// o: ink (default material ink, used where the SVG sets no stroke), colorFrom (0.7), w, x, y (offset),
// colors (object keyed '#rrggbb' or function (rgb, kind) => rgb) to remap the SVG's own colours.
// Outlines are drawn last, every frame, at full opacity: they sit on top of the fills at the end. w defaults to 2.8 px at 1080.
function drawOn(f, strokes, p, o = {}) {
  const { ctx, R, m } = f, U = f.unit ?? 1;
  const S = strokes, n = S.length;
  if (!n) return;
  const P = clamp(p), cf = o.colorFrom ?? 0.7;
  const ox = o.x ?? 0, oy = o.y ?? 0, w = o.w ?? 2.8 * U, ink = o.ink ?? m.ink;
  const shift = pts => pts.map(([x, y]) => [x + ox, y + oy]);
  const colour = (c, kind) => {
    if (!c) return null;
    if (typeof o.colors === 'function') return o.colors(c, kind) ?? c;
    if (o.colors) return o.colors['#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')] ?? c;
    return c;
  };
  // one draw of R per stroke, in fixed order: each stroke keeps its own tremor
  const lineR = S.map(() => stream(Math.floor(R() * 4294967296)));

  // fills: each filled shape gets its share of [cf, 1]; alpha rises, the shape does not move
  const filled = [];
  S.forEach((s, i) => { if (s.fill) filled.push(i); });
  const q = cf >= 1 ? 1 : clamp((P - cf) / (1 - cf));
  filled.forEach((i, k) => {
    const u = seg(q * filled.length, k, k + 1);
    if (u <= 0) return;
    const reg = f.still('reg:' + i);
    const dx = rd(reg, -1.6, 1.6) * U, dy = rd(reg, -1.6, 1.6) * U;   // slight misregistration from the outline
    ctx.save();
    ctx.globalAlpha = u;
    m.fill(ctx, f.still('fill:' + i), shift(S[i].pts).map(([x, y]) => [x + dx, y + dy]), colour(S[i].fill, 'fill'));
    ctx.restore();
  });

  // outlines: pen budget is total length scaled by progress through the outline phase
  const total = S.reduce((a, s) => a + s.len, 0);
  let budget = total * (cf > 0 ? clamp(P / cf) : 1);
  for (let i = 0; i < n && budget > 0; i++) {
    const s = S[i];
    const pts = budget >= s.len ? s.pts : inCut(s.pts, budget);
    budget -= s.len;
    if (pts.length > 1) m.stroke(ctx, lineR[i], shift(pts), colour(s.stroke, 'stroke') ?? ink, { w, a: 1 });
  }
}

// Bar labels and numbers never go below 31 px at 1080 (11 px on a 390 px phone). A label wraps to two lines at most,
// and no word is split. When the columns cannot hold that, the bars turn horizontal with labels at the left.
// Nothing is truncated or rotated.
const IN_TXT_MIN = 31;

// Greedy word wrap at sz into at most two lines, no word split. null when it does not fit.
function inWrapTwo(t, sz, maxW) {
  const words = String(t).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  if (words.some(w => measure(w, sz) > maxW)) return null;
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(next, sz) > maxW) { lines.push(line); line = w; } else line = next;
  }
  lines.push(line);
  return lines.length <= 2 ? lines : null;
}
// Bar labels: the largest size from 34 px down to the floor where every label fits on one line; else two lines at the floor.
function inBarLabels(texts, maxW, U) {
  for (let sz = 34 * U; sz >= IN_TXT_MIN * U - 1e-6; sz -= U) {
    if (texts.every(t => measure(t, sz) <= maxW)) return { sz, lines: texts.map(t => [t]) };
  }
  const sz = IN_TXT_MIN * U, lines = texts.map(t => inWrapTwo(t, sz, maxW));
  return lines.every(Boolean) ? { sz, lines } : null;
}

// Hand-drawn bars. rows [{label, value}]; box {x,y,w,h}; o: p, accent, muted, highlight (index), format(value), frames (48).
// Each bar rises from a hand-drawn baseline, 2 frames after the previous one, with no overshoot.
// Layout depends only on rows, box and unit: columns when every label fits in two lines at 31 px and every number
// fits its column; otherwise horizontal rows. Throws when a label cannot fit in two lines even then.
function drawBars(f, rows, box, o = {}) {
  const { ctx, R, m } = f, U = f.unit ?? 1, N = rows.length;
  if (!N) return;
  const P = clamp(o.p ?? f.t), fmt = o.format ?? inFmt, ink = m.ink;
  const accent = o.accent ?? m.inks[0];
  const muted = o.muted ?? mix(m.inks[m.inks.length - 1], m.paper, 0.45);
  const hi = o.highlight ?? -1;
  const stag = N > 1 ? Math.min(2 / (o.frames ?? 48), 0.7 / (N - 1)) : 0;
  const span = 1 - stag * (N - 1);   // the last bar lands exactly at p = 1
  const S = inStreams(R, 3 * N + 1);  // bars [0,N), numbers [N,2N), labels [2N,3N), baseline 3N

  const vals = rows.map(r => Math.max(0, Number(r.value) || 0));
  const vMax = Math.max(1e-9, ...vals);
  const texts = vals.map(fmt);
  const labels = rows.map(r => String(r.label));
  const numFit = (sz, room) => !texts.some(t => measure(t, sz) > room);

  const x0 = box.x + 10 * U, x1 = box.x + box.w - 10 * U, slot = (x1 - x0) / N, pad = 4 * U;
  let numSz = 44 * U;
  while (numSz > IN_TXT_MIN * U && !numFit(numSz, slot - pad)) numSz -= U;
  const lab = inBarLabels(labels, slot * 0.9, U);   // 10% of a slot stays empty between neighbours

  if (lab && numFit(numSz, slot - pad)) {
    const lh = lab.sz * 1.42;
    const maxLines = Math.max(...lab.lines.map(l => l.length));
    const labH = (maxLines - 1) * lh + 1.36 * lab.sz;
    const labTop = box.y + box.h - 6 * U - labH;
    const baseY = labTop - 0.5 * lab.sz;
    const topY = box.y + 1.4 * numSz + 4 * U;
    const maxH = Math.max(0, baseY - topY);
    const bw = Math.min(slot * 0.56, 150 * U);
    for (let i = 0; i < N; i++) {
      const cx = x0 + slot * (i + 0.5);
      const g = inHydra((P - i * stag) / span);
      const hh = maxH * (vals[i] / vMax) * g;
      const top = baseY - hh;
      if (hh > 0.5 * U) {
        const r = S[i];
        const L = cx - bw / 2, Rt = cx + bw / 2;
        const jit = () => rd(r, -1.2, 1.2) * U;
        const pts = [[L, baseY], [L, top], [Rt, top], [Rt, baseY]].map(([x, y]) => [x + jit(), y + jit()]);
        m.fill(ctx, f.still('bar:' + i), pts, hi < 0 || i === hi ? accent : muted);
        m.stroke(ctx, r, [...pts, pts[0]], ink, { w: 2 * U });
      }
      const a = seg(g, 0.55, 1);
      if (a > 0.01) write(ctx, S[N + i], texts[i], cx, top - 0.3 * numSz, numSz, { cen: true, col: ink, a: 0.9 * a });
      lab.lines[i].forEach((line, j) => write(ctx, S[2 * N + i], line, cx, labTop + lab.sz + j * lh, lab.sz, { cen: true, col: ink, a: 0.85 }));
    }
    const b = S[3 * N];
    m.stroke(ctx, b, [
      [x0 - 4 * U, baseY + rd(b, -1, 1) * U],
      [(x0 + x1) / 2, baseY + rd(b, -0.6, 0.6) * U],
      [x1 + 4 * U, baseY + rd(b, -1, 1) * U]
    ], ink, { w: 2.4 * U });
    return;
  }

  // Horizontal: labels in a left column of at most two lines, bars to the right, each number at its bar's end.
  let colW = 0, lab2 = null;
  for (const frac of [0.36, 0.44, 0.52, 0.6, 0.66]) {
    colW = frac * box.w;
    lab2 = inBarLabels(labels, colW - 12 * U, U);
    if (lab2) break;
  }
  if (!lab2) throw new Error(`drawBars: a label does not fit in two lines at ${IN_TXT_MIN} px; shorten it`);
  let hNum = 44 * U;
  while (hNum > IN_TXT_MIN * U && !numFit(hNum, 0.2 * box.w)) hNum -= U;
  const valW = Math.max(...texts.map(t => measure(t, hNum)));
  const barX = box.x + colW + 10 * U;
  const barMax = Math.max(4 * U, box.x + box.w - barX - valW - 16 * U);
  const rowH = box.h / N, bh = Math.min(0.5 * rowH, 64 * U), lh2 = lab2.sz * 1.42;
  for (let i = 0; i < N; i++) {
    const mid = box.y + (i + 0.5) * rowH, r = S[i], g = inHydra((P - i * stag) / span);
    const L = barMax * (vals[i] / vMax) * g;
    if (L > 0.5 * U) {
      const jit = () => rd(r, -1.2, 1.2) * U;
      const pts = [[barX, mid - bh / 2], [barX + L, mid - bh / 2], [barX + L, mid + bh / 2], [barX, mid + bh / 2]]
        .map(([x, y]) => [x + jit(), y + jit()]);
      m.fill(ctx, f.still('bar:' + i), pts, hi < 0 || i === hi ? accent : muted);
      m.stroke(ctx, r, [...pts, pts[0]], ink, { w: 2 * U });
    }
    const a = seg(g, 0.55, 1);
    if (a > 0.01) write(ctx, S[N + i], texts[i], barX + L + 10 * U, mid + 0.5 * hNum, hNum, { col: ink, a: 0.9 * a });
    const n = lab2.lines[i].length, top = mid - ((n - 1) * lh2 + lab2.sz) / 2;
    lab2.lines[i].forEach((line, j) => write(ctx, S[2 * N + i], line, box.x, top + lab2.sz + j * lh2, lab2.sz, { col: ink, a: 0.85 }));
  }
  const b = S[3 * N];
  m.stroke(ctx, b, [
    [barX - 4 * U, box.y + rd(b, -1, 1) * U],
    [barX - 4 * U, box.y + box.h / 2],
    [barX - 4 * U, box.y + box.h + rd(b, -1, 1) * U]
  ], ink, { w: 2.4 * U });
}

// Hand-drawn line chart. series [{name, points:[[x,y],...]}]; box {x,y,w,h}; o: p, format, palette, accent, yMin, yMax.
// Axes and gridlines are hand drawn, ticks are nice numbers, lines draw on with p, and each end label sits by its
// last point. Labels that would collide are nudged apart.
function drawLines(f, series, box, o = {}) {
  const { ctx, R, m } = f, U = f.unit ?? 1, S = series.length;
  if (!S) return;
  const P = clamp(o.p ?? f.t), fmt = o.format ?? inFmt, ink = m.ink;
  const palette = o.palette ?? [o.accent ?? m.inks[0], m.inks[2] ?? ink, m.inks[3] ?? ink, m.inks[1] ?? ink];
  const pts = series.map(s => s.points.slice().sort((a, b) => a[0] - b[0]));
  const all = pts.flat();
  const X = inTicks(Math.min(...all.map(p => p[0])), Math.max(...all.map(p => p[0])), 5);
  const minY = Math.min(...all.map(p => p[1]));
  const Y = inTicks(o.yMin ?? (minY >= 0 ? 0 : minY), o.yMax ?? Math.max(...all.map(p => p[1])), 5);
  const T = Math.max(X.ticks.length, Y.ticks.length);
  // streams: series [0,S), end labels [S,2S), axes 2S and 2S+1, then per tick: grid/mark, y label, x label
  const st = inStreams(R, 2 * S + 2 + 3 * T);
  const tickSz = 26 * U, endBase = 30 * U, endFloor = 22 * U;
  const names = series.map(s => String(s.name ?? ''));
  const nameW = sz => Math.max(0, ...names.map(t => measure(t, sz)));
  let endSz = endBase;
  while (endSz > endFloor && nameW(endSz) > 0.3 * box.w) endSz -= U;
  const endW = nameW(endSz) + 14 * U;
  const yLabW = Math.max(...Y.ticks.map(v => measure(fmt(v), tickSz)));
  const px0 = box.x + yLabW + 18 * U, px1 = box.x + box.w - endW - 12 * U;
  const py0 = box.y + 16 * U, py1 = box.y + box.h - 1.6 * tickSz - 14 * U;
  const xOf = v => px0 + ((v - X.lo) / (X.hi - X.lo)) * (px1 - px0);
  const yOf = v => py1 - ((v - Y.lo) / (Y.hi - Y.lo)) * (py1 - py0);
  const gi = k => 2 * S + 2 + k, yli = k => 2 * S + 2 + T + k, xli = k => 2 * S + 2 + 2 * T + k;

  Y.ticks.forEach((v, k) => {
    const yy = yOf(v), t = fmt(v);
    if (k) m.stroke(ctx, st[gi(k)], [[px0, yy], [px1, yy]], ink, { w: 1.4 * U, a: 0.2 });
    m.stroke(ctx, st[gi(k)], [[px0 - 6 * U, yy], [px0, yy]], ink, { w: 1.8 * U });
    write(ctx, st[yli(k)], t, px0 - 12 * U - measure(t, tickSz), yy + 0.5 * tickSz, tickSz, { col: ink, a: 0.75 });
  });
  m.stroke(ctx, st[2 * S], [[px0, py0 - 6 * U], [px0 + 0.6 * U, (py0 + py1) / 2], [px0, py1]], ink, { w: 2.4 * U });
  m.stroke(ctx, st[2 * S + 1], [[px0 - 6 * U, py1], [(px0 + px1) / 2, py1 + 0.5 * U], [px1 + 6 * U, py1]], ink, { w: 2.4 * U });
  const xW = Math.max(...X.ticks.map(v => measure(fmt(v), tickSz)));
  const every = Math.max(1, Math.ceil((xW + 18 * U) / ((px1 - px0) / Math.max(1, X.ticks.length - 1))));
  X.ticks.forEach((v, k) => {
    if (k % every) return;
    const xx = xOf(v);
    m.stroke(ctx, st[gi(k)], [[xx, py1], [xx, py1 + 6 * U]], ink, { w: 1.8 * U });
    write(ctx, st[xli(k)], fmt(v), xx, py1 + 8 * U + tickSz, tickSz, { cen: true, col: ink, a: 0.75 });
  });

  pts.forEach((p, i) => {
    const pp = p.map(([x, y]) => [xOf(x), yOf(y)]);
    if (pp.length < 2) return;
    const part = inCut(pp, P * inPolyLen(pp));
    if (part.length > 1) m.stroke(ctx, st[i], part, palette[i % palette.length], { w: 3.4 * U });
  });

  const ends = pts.map(p => { const q = p[p.length - 1]; return [xOf(q[0]), yOf(q[1])]; });
  const ny = inNudge(ends.map(e => e[1]), endSz * 1.45, box.y + 0.6 * endSz, box.y + box.h - 1.6 * tickSz - 0.6 * endSz);
  const na = seg(P, 0.55, 0.95);
  if (na > 0.01) {
    names.forEach((t, i) => {
      if (!t) return;
      const lx = ends[i][0] + 12 * U;
      // leader from a nudged label back to its line end
      if (Math.abs(ny[i] - ends[i][1]) > 4 * U) m.stroke(ctx, st[S + i], [[ends[i][0] + 5 * U, ends[i][1]], [lx - 5 * U, ny[i]]], ink, { w: 1.4 * U, a: 0.5 * na });
      write(ctx, st[S + i], t, lx, ny[i] + 0.5 * endSz, endSz, { col: ink, a: 0.9 * na });
    });
  }
}

// Funnel. Strips stack top to bottom on one axis; each is as wide as its value, with a floor (FUN_MIN_W) so a thin step
// still reads and its number carries the true value. A label is 34 px, or 31 px when that is what fits. It wraps inside
// its row pitch (strip plus the gap under it), so it may run into the gap but never into the next label. When no size
// fits that way, every label moves above its own strip, centred, and the gap holds the step percent and that label.
const FUN_LAB = 34, FUN_VAL = 34, FUN_PCT = 36, FUN_MIN_W = 30, FUN_GAP_K = 0.42, FUN_GAP_MIN = 46;

// Balanced wrap (30-letters: wrap) into any number of lines. null when one word is wider than maxW: no word is split.
function inWrapAny(t, sz, maxW) {
  if (String(t).split(/\s+/).some(w => w && measure(w, sz) > maxW)) return null;
  const lines = wrap(t, maxW, sz);
  return lines.length ? lines : [''];
}
// Height of n lines at size sz, from the first ascender to the last descender.
const inBlockH = (n, sz) => (n - 1) * sz * 1.42 + 1.36 * sz;

/**
 * Funnel geometry, pure in (rows, box, U). Returns { cx, drop (index of the biggest step-to-step drop, -1 if none),
 * valSz, pctSz, mode ('side' or 'above'), strip[i] {top, bot, w}, pctY[i] (centre of the percent between strips i and
 * i+1), lab[i] {x, cen, top, sz, lh, lines} }. Scenes draw on it (the ring, a note). Throws when nothing fits the box.
 */
function funnelLayout(rows, box, U = 1) {
  const N = rows.length, vals = rows.map(r => Math.max(0, Number(r.value) || 0));
  const vMax = Math.max(1e-9, ...vals), labels = rows.map(r => String(r.label));
  const labW = 0.3 * box.w, valW = 0.2 * box.w;
  const sx0 = box.x + labW + 14 * U, sx1 = box.x + box.w - valW - 14 * U;
  const cx = (sx0 + sx1) / 2, stripMax = sx1 - sx0;
  let drop = -1, dropBy = 0;
  for (let i = 0; i + 1 < N; i++) if (vals[i] - vals[i + 1] > dropBy) { dropBy = vals[i] - vals[i + 1]; drop = i; }
  const valSz = FUN_VAL * U;   // values share the label floor; fixed, so the strip rows keep one size
  const widths = vals.map(v => Math.max(FUN_MIN_W * U, stripMax * v / vMax));
  const gS = Math.max(FUN_GAP_K * box.h / (N + FUN_GAP_K * (N - 1)), FUN_GAP_MIN * U);
  const pctSz = Math.min(FUN_PCT * U, 0.7 * gS);
  const out = { cx, drop, valSz, pctSz, mode: 'side', strip: [], pctY: [], lab: [] };

  // Side: labels in the left column, each centred on its strip, inside the pitch.
  const hS = (box.h - (N - 1) * gS) / N, pitch = hS + gS;
  for (let sz = FUN_LAB * U; sz >= IN_TXT_MIN * U - 1e-6; sz -= U) {
    const lines = labels.map(t => inWrapAny(t, sz, labW - 10 * U));
    if (!lines.every(Boolean) || lines.some(l => inBlockH(l.length, sz) > pitch - 6 * U)) continue;
    for (let i = 0; i < N; i++) {
      const top = box.y + i * pitch, mid = top + hS / 2;
      out.strip.push({ top, bot: top + hS, w: widths[i] });
      out.lab.push({ x: box.x, cen: false, top: mid - ((lines[i].length - 1) * sz * 1.42 + sz) / 2, sz, lh: sz * 1.42, lines: lines[i] });
      if (i < N - 1) out.pctY.push(top + hS + gS / 2);
    }
    return out;
  }

  // Above: each label centred over its strip. The gap holds the percent, then the label, with spacing so neither touches.
  for (let sz = FUN_LAB * U; sz >= IN_TXT_MIN * U - 1e-6; sz -= U) {
    const lines = labels.map(t => inWrapAny(t, sz, box.w));
    if (!lines.every(Boolean)) break;
    const blk = lines.map(l => inBlockH(l.length, sz));
    let fixed = blk[0] + 6 * U;
    for (let i = 1; i < N; i++) fixed += blk[i] + pctSz + 28 * U;
    const hA = (box.h - fixed) / N;
    if (hA < 24 * U) continue;
    out.mode = 'above';
    let y = box.y;
    for (let i = 0; i < N; i++) {
      if (i) { out.pctY.push(y + 6 * U + pctSz / 2); y += 6 * U + pctSz + 16 * U; }
      out.lab.push({ x: cx, cen: true, top: y, sz, lh: sz * 1.42, lines: lines[i] });
      y += blk[i] + 6 * U;
      out.strip.push({ top: y, bot: y + hA, w: widths[i] });
      y += hA;
    }
    return out;
  }
  throw new Error(`funnelLayout: the rows do not fit ${Math.round(box.w)}x${Math.round(box.h)}; shorten a label or enlarge the box`);
}

// Stacked paper strips, one warm colour, narrowing by value. rows [{label, value}] top to bottom; o: p, accent (the
// biggest drop's percent, default the material's first ink), highlight (gap index to accent, default the biggest drop,
// -1 for none), format(value), frames (48). Strips reveal top to bottom; each label and value reveals with its strip,
// and the step percent with the strip below it.
function drawFunnel(f, rows, box, o = {}) {
  const { ctx, R, m } = f, U = f.unit ?? 1, N = rows.length;
  if (!N) return;
  const P = clamp(o.p ?? f.t), fmt = o.format ?? inFmt, ink = m.ink;
  const accent = o.accent ?? m.inks[0], warm = mix(m.inks[1] ?? accent, m.paper, 0.2);
  const L = funnelLayout(rows, box, U), hi = o.highlight ?? L.drop;
  const vals = rows.map(r => Math.max(0, Number(r.value) || 0));
  const stag = N > 1 ? Math.min(2 / (o.frames ?? 48), 0.7 / (N - 1)) : 0;
  const span = 1 - stag * (N - 1);
  // streams: strips [0,N), labels [N,2N), values [2N,3N), step percent [3N,4N)
  const S = inStreams(R, 4 * N);

  for (let i = 0; i < N; i++) {
    const s = L.strip[i], start = i * stag, u = seg(P, start, start + span);
    if (u > 0) {
      const r = S[i], l = L.cx - s.w / 2, rt = L.cx + s.w / 2;
      const jit = () => rd(r, -1.4, 1.4) * U;
      const pts = [[l, s.top], [L.cx, s.top], [rt, s.top], [rt, s.bot], [L.cx, s.bot], [l, s.bot]].map(([x, y]) => [x + jit(), y + jit()]);
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, s.top - 6 * U, box.w, (s.bot - s.top + 12 * U) * u);
      ctx.clip();
      m.fill(ctx, f.still('strip:' + i), pts, warm);
      m.stroke(ctx, r, [...pts, pts[0]], ink, { w: 2.2 * U });
      ctx.restore();
    }
    if (u > 0.01) {
      const lab = L.lab[i], mid = (s.top + s.bot) / 2, text = fmt(vals[i]);
      lab.lines.forEach((line, j) => write(ctx, S[N + i], line, lab.x, lab.top + lab.sz + j * lab.lh, lab.sz, { cen: lab.cen, col: ink, a: 0.9 * u }));
      write(ctx, S[2 * N + i], text, box.x + box.w - measure(text, L.valSz), mid + 0.45 * L.valSz, L.valSz, { col: ink, a: 0.9 * u });
    }
    if (i < N - 1) {
      const pa = seg(P, (i + 1) * stag, (i + 1) * stag + span);
      if (pa > 0.01) {
        const ratio = vals[i] > 0 ? vals[i + 1] / vals[i] : 0;
        write(ctx, S[3 * N + i], `${Math.round(ratio * 100)}%`, L.cx, L.pctY[i] + 0.5 * L.pctSz, L.pctSz,
          { cen: true, col: i === hi ? accent : ink, a: 0.9 * pa });
      }
    }
  }
}

const EXPORTS_INPUTS = { svgStrokes, drawOn, drawBars, drawLines, drawFunnel, funnelLayout };
