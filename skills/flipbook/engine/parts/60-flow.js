// Flow: a state machine as plain data, model-checked by BFS, laid out and drawn as a hand-drawn diagram.

// Stable JSON with sorted object keys: the same state always gives the same key.
const stableKey = v => JSON.stringify(v, (k, x) =>
  x && typeof x === 'object' && !Array.isArray(x)
    ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {})
    : x);

function defineFlow(def) {
  const bad = msg => { throw new TypeError(`defineFlow: ${msg}`); };
  if (!def || typeof def !== 'object') bad('definition must be an object');
  if (def.init === undefined) bad('init is required');
  if (!def.steps || typeof def.steps !== 'object' || Object.keys(def.steps).length === 0) bad('steps must be a non-empty object');
  for (const [id, st] of Object.entries(def.steps)) {
    if (!st || typeof st.when !== 'function') bad(`step ${id} needs a when(state) function`);
    if (typeof st.do !== 'function') bad(`step ${id} needs a do(state) function`);
    if (st.label !== undefined && typeof st.label !== 'string') bad(`step ${id} label must be a string`);
  }
  for (const [id, r] of Object.entries(def.rules ?? {})) {
    if (!r || typeof r.ok !== 'function') bad(`rule ${id} needs an ok(state) function`);
    if (r.expectBroken !== undefined && typeof r.expectBroken !== 'boolean') bad(`rule ${id} expectBroken must be boolean`);
  }
  for (const k of ['final', 'view', 'expectStuck']) if (def[k] !== undefined && typeof def[k] !== 'function') bad(`${k} must be a function`);
  return def;
}

// Shortest path from init to a concrete state, as [{state, view, step}]. step is the one that entered it.
const pathTo = (seen, key) => {
  const out = [];
  for (let k = key; k !== null; k = seen.get(k).parent) {
    const e = seen.get(k);
    out.push({ state: e.state, view: e.view, step: e.step });
  }
  return out.reverse();
};

// BFS over concrete states (cap on count). Nodes and edges are the view-level collapse.
// Rules report the BFS-first violation, which is a shortest counterexample.
function checkFlow(flow, o = {}) {
  const f = defineFlow(flow);
  const cap = o.cap ?? 20000;
  const viewOf = f.view ?? (s => stableKey(s));
  const sids = Object.keys(f.steps);
  const isFinal = f.final ?? (() => false);
  const k0 = stableKey(f.init);
  const seen = new Map([[k0, { state: f.init, parent: null, step: null, view: String(viewOf(f.init)) }]]);
  const order = [k0];
  const fired = new Map(sids.map(id => [id, 0]));
  const trans = new Set();
  const vEdges = new Map();
  const deadlockKeys = [];
  let capped = false;

  for (let head = 0; head < order.length; head++) {
    const k = order[head], cur = seen.get(k);
    let enabled = 0;
    for (const sid of sids) {
      const st = f.steps[sid];
      if (!st.when(cur.state)) continue;
      enabled++;
      fired.set(sid, fired.get(sid) + 1);
      const next = st.do(cur.state);
      const nk = stableKey(next);
      const nv = String(viewOf(next));
      trans.add(`${k}\u0001${sid}\u0001${nk}`);
      const ek = `${cur.view}\u0001${sid}\u0001${nv}`;
      if (!vEdges.has(ek)) vEdges.set(ek, { from: cur.view, to: nv, step: sid, label: st.label ?? sid });
      if (!seen.has(nk)) {
        if (seen.size >= cap) { capped = true; continue; }
        seen.set(nk, { state: next, parent: k, step: sid, view: nv });
        order.push(nk);
      }
    }
    if (enabled === 0 && !isFinal(cur.state)) deadlockKeys.push(k);
  }

  const nodes = [];
  const nodeSeen = new Set();
  for (const k of order) {
    const v = seen.get(k).view;
    if (!nodeSeen.has(v)) { nodeSeen.add(v); nodes.push({ id: v, label: v }); }
  }

  // expectStuck(state) accepts a dead end the process really has (for example, waiting on someone outside the flow).
  // Accepted deadlocks do not fail the run; a declared expectStuck that matches no deadlock does.
  const hasExpectStuck = typeof f.expectStuck === 'function';
  const accepted = new Set(hasExpectStuck ? deadlockKeys.filter(k => f.expectStuck(seen.get(k).state)) : []);
  const byView = keys => {
    const vs = new Set(), out = [];
    for (const k of keys) {
      const e = seen.get(k);
      if (vs.has(e.view)) continue;
      vs.add(e.view);
      out.push({ view: e.view, path: pathTo(seen, k) });
    }
    return out;
  };
  const deadlocks = byView(deadlockKeys.filter(k => !accepted.has(k)));
  const expectedStuck = byView(deadlockKeys.filter(k => accepted.has(k)));
  const stuckUnmatched = hasExpectStuck && accepted.size === 0;

  const deadSteps = sids.filter(id => fired.get(id) === 0).map(id => ({ id, label: f.steps[id].label ?? id }));

  const rules = Object.entries(f.rules ?? {}).map(([id, r]) => {
    let hit = null;
    for (const k of order) if (!r.ok(seen.get(k).state)) { hit = k; break; }
    return {
      id, label: r.label ?? id, expectBroken: r.expectBroken === true,
      holds: hit === null, path: hit === null ? null : pathTo(seen, hit)
    };
  });
  const broken = rules.filter(r => !r.holds).map(({ id, label, expectBroken, path }) => ({ rule: id, label, expectBroken, path }));
  const held = rules.filter(r => r.holds).map(r => r.id);
  const rulesAsExpected = rules.every(r => r.holds !== r.expectBroken);

  return {
    name: f.name ?? 'flow',
    states: seen.size,
    transitions: trans.size,
    nodes,
    edges: [...vEdges.values()],
    init: seen.get(k0).view,
    capped, cap,
    deadlocks, expectedStuck, stuckUnmatched, deadSteps, rules, broken, held,
    ok: rulesAsExpected && deadlocks.length === 0 && deadSteps.length === 0 && !capped && !stuckUnmatched
  };
}

// Layout: rank = BFS distance from init; barycenter sweeps order each rank. Forward edges run through
// the gap band between ranks. Back edges drop into the band, run along a lane outside the diagram and
// come back up into the target's band, so no horizontal run crosses a box. Boxes keep their size.
// Ranks and the boxes within a rank spread per axis to fill w x h, up to a cap; a little tighter than
// natural is allowed (SPREAD_MIN), never more.
// An explicit o.sz is never shrunk. A label with no clear spot raises the spread cap (more room between
// boxes) and, if no cap clears it, layoutFlow throws. Without o.sz, sz starts at min(w, h) / 22 and
// shrinks until the diagram fits. Lay out at the frame's own px so sizes scale with the frame.
const BOX_PX = 0.5, BOX_PY = 0.35; // box padding in sz units; text is 1.4 sz tall
const SPREAD_CAPS = [2.4, 3, 4];   // per-axis spread limits, tried in turn while a label clashes
const SPREAD_MIN = 0.85;           // gaps may tighten to this share of their natural size, no less
const FIT_FLOOR = 22;              // fit: true never shrinks sz below this (in px at the frame's own scale)
const boxSize = (label, s) => ({ w: (label ? measure(label, s) : 0) + 2 * BOX_PX * s, h: 1.4 * s + 2 * BOX_PY * s });
const ovl = (p, q) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
const rectOf = (cx, cy, w, h) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });

// Point at fraction f of arc length, with the unit normal of its local segment.
function sampleAt(pts, f) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push(L);
    total += L;
  }
  if (total === 0) return { x: pts[0][0], y: pts[0][1], nx: 0, ny: 1 };
  let d = f * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const u = segs[i] ? Math.min(1, d / segs[i]) : 0;
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const L = segs[i] || 1;
      return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, nx: -(y1 - y0) / L, ny: (x1 - x0) / L };
    }
    d -= segs[i];
  }
}

// Points about `step` apart along a polyline, including both ends.
function edgeDots(pts, step) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const n = Math.max(1, Math.ceil(total / step));
  return Array.from({ length: n + 1 }, (_, k) => { const p = sampleAt(pts, k / n); return [p.x, p.y]; });
}

function layoutFlow(check, o = {}) {
  const W = o.w, H = o.h;
  if (!(W > 0 && H > 0)) throw new TypeError('layoutFlow: w and h must be positive');
  if (o.dir !== undefined && o.dir !== 'TB' && o.dir !== 'LR') throw new TypeError(`layoutFlow: dir must be 'TB' (top to bottom) or 'LR' (left to right), got ${JSON.stringify(o.dir)}`);
  const TB = o.dir !== 'LR';
  const margin = Math.min(W, H) * 0.04;
  const nodes = check.nodes, edges = check.edges;

  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) adj.get(e.from).push(e.to);
  const rank = new Map([[check.init, 0]]);
  const bfs = [check.init];
  for (let q = 0; q < bfs.length; q++) {
    for (const t of adj.get(bfs[q])) if (!rank.has(t)) { rank.set(t, rank.get(bfs[q]) + 1); bfs.push(t); }
  }
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);
  const isBack = e => rank.get(e.to) <= rank.get(e.from);
  const R = Math.max(...rank.values()) + 1;
  const layers = Array.from({ length: R }, () => []);
  for (const n of nodes) layers[rank.get(n.id)].push(n.id);

  // Barycenter ordering: 4 sweeps alternating down (predecessors) and up (successors).
  const preds = new Map(nodes.map(n => [n.id, []])), succs = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) if (!isBack(e)) { preds.get(e.to).push(e.from); succs.get(e.from).push(e.to); }
  const posOf = new Map();
  const indexLayers = () => layers.forEach(L => L.forEach((id, i) => posOf.set(id, i)));
  indexLayers();
  const sweep = (r, nb) => {
    const L = layers[r];
    const bary = new Map(L.map(id => {
      const ns = nb.get(id);
      return [id, ns.length ? ns.reduce((a, x) => a + posOf.get(x), 0) / ns.length : posOf.get(id)];
    }));
    L.sort((a, b) => bary.get(a) - bary.get(b));
    indexLayers();
  };
  for (let pass = 0; pass < 4; pass++) {
    if (pass % 2 === 0) for (let r = 1; r < R; r++) sweep(r, preds);
    else for (let r = R - 2; r >= 0; r--) sweep(r, succs);
  }

  // Natural coordinates for one size of sz, spread per axis up to cap. The two axes scale independently,
  // so a tall frame spreads the ranks without pushing the boxes of a rank apart.
  const place = (sz, cap) => {
    const size = new Map(nodes.map(n => [n.id, boxSize(n.label, sz)]));
    const mainSz = b => (TB ? b.h : b.w), crossSz = b => (TB ? b.w : b.h);
    const gapMain = sz * 2.4, gapCross = sz * 1.6;
    const thick = [], mainAt = [];
    let cur = 0;
    for (let r = 0; r < R; r++) {
      thick[r] = Math.max(...layers[r].map(id => mainSz(size.get(id))));
      mainAt[r] = cur + thick[r] / 2;
      cur += thick[r] + gapMain;
    }
    const layerCross = layers.map(L => L.reduce((a, id) => a + crossSz(size.get(id)), 0) + gapCross * (L.length - 1));
    const maxLC = Math.max(...layerCross);
    const crossAt = new Map();
    layers.forEach((L, r) => {
      let c = (maxLC - layerCross[r]) / 2;
      for (const id of L) { const cs = crossSz(size.get(id)); crossAt.set(id, c + cs / 2); c += cs + gapCross; }
    });
    const cen = new Map(nodes.map(n => [n.id, { m: mainAt[rank.get(n.id)], c: crossAt.get(n.id) }]));
    const ms = [...cen.values()].map(p => p.m), cs = [...cen.values()].map(p => p.c);
    const minM = Math.min(...ms), minC = Math.min(...cs);
    const spanM = Math.max(...ms) - minM, spanC = Math.max(...cs) - minC;
    const maxM = Math.max(...[...size.values()].map(mainSz));
    const maxC = Math.max(...[...size.values()].map(crossSz));
    const nBack = edges.filter(isBack).length;
    const reserveM = nBack ? gapMain : 0, reserveC = nBack ? sz * (1.5 + 0.8 * nBack) : 0;
    const availM = (TB ? H : W) - 2 * margin - reserveM;
    const availC = (TB ? W : H) - 2 * margin - reserveC;
    // The scale stretches centre-to-centre distances only; the half widths at the two outermost boxes stay put.
    const edgesC = nodes.map(n => { const p = cen.get(n.id).c, h = crossSz(size.get(n.id)) / 2; return [p - h, p + h]; });
    const extC = Math.max(...edgesC.map(q => q[1])) - Math.min(...edgesC.map(q => q[0]));
    const sM = spanM > 0 ? (availM - maxM) / spanM : Infinity;
    const sC = spanC > 0 ? (availC - (extC - spanC)) / spanC : Infinity;
    const sMain = Math.min(sM, cap), sCross = Math.min(sC, cap);
    // needM, needC: the least total extent (margins and back-edge lane included) this size can fit in on each axis.
    return {
      sz, size, thick, mainAt, cen, minM, minC, spanM, spanC, maxM, maxC, availM, availC, sMain, sCross,
      needM: 2 * margin + reserveM + maxM + SPREAD_MIN * spanM,
      needC: 2 * margin + reserveC + (extC - spanC) + SPREAD_MIN * spanC,
      ok: availM >= maxM && availC >= maxC && sMain >= SPREAD_MIN && sCross >= SPREAD_MIN
    };
  };

  // Boxes, edge routes and edge labels for one placement. clash: some label found no clear spot.
  const build = P => {
    const sz = P.sz, gapMain = sz * 2.4;
    const mOff = margin + (P.availM - (P.spanM * P.sMain + P.maxM)) / 2 + P.maxM / 2;
    const cOff = margin + (P.availC - (P.spanC * P.sCross + P.maxC)) / 2 + P.maxC / 2;
    const mapM = m => mOff + (m - P.minM) * P.sMain;
    const mapC = c => cOff + (c - P.minC) * P.sCross;
    const pos = id => {
      const p = P.cen.get(id);
      return TB ? [mapC(p.c), mapM(p.m)] : [mapM(p.m), mapC(p.c)];
    };
    const boxes = nodes.map(n => {
      const [x, y] = pos(n.id), b = P.size.get(n.id);
      return { id: n.id, label: n.label, x, y, w: b.w, h: b.h, rank: rank.get(n.id) };
    });
    // Centre the drawing by its real cross extents: a wide box beside a narrow one is not centred by the middle.
    const lo = Math.min(...boxes.map(b => (TB ? b.x - b.w / 2 : b.y - b.h / 2)));
    const hi = Math.max(...boxes.map(b => (TB ? b.x + b.w / 2 : b.y + b.h / 2)));
    const shiftC = margin + (P.availC - (hi - lo)) / 2 - lo;
    for (const b of boxes) { if (TB) b.x += shiftC; else b.y += shiftC; }
    const at = new Map(boxes.map(b => [b.id, b]));
    const bandHi = r => mapM(P.mainAt[r]) + P.thick[r] / 2;   // main coordinate where rank r's band ends
    const gapAt = r => bandHi(r) + gapMain / 2;               // middle of the gap just after rank r
    const crossEdge = Math.max(...boxes.map(b => (TB ? b.x + b.w / 2 : b.y + b.h / 2)));
    const laneBase = crossEdge + sz * 0.9;

    let lane = 0;
    const routed = edges.map(e => {
      const a = at.get(e.from), b = at.get(e.to);
      const back = isBack(e);
      let pts;
      if (!back) {
        const p0 = TB ? [a.x, a.y + a.h / 2] : [a.x + a.w / 2, a.y];
        const p1 = TB ? [b.x, b.y - b.h / 2] : [b.x - b.w / 2, b.y];
        const straight = TB ? Math.abs(p0[0] - p1[0]) < 1 : Math.abs(p0[1] - p1[1]) < 1;
        const mid = TB ? (p0[1] + p1[1]) / 2 : (p0[0] + p1[0]) / 2;
        pts = straight ? [p0, p1] : TB ? [p0, [p0[0], mid], [p1[0], mid], p1] : [p0, [mid, p0[1]], [mid, p1[1]], p1];
      } else if (e.from === e.to) {
        const L = sz * 0.9;
        if (TB) {
          const x = a.x + a.w / 2, y0 = a.y - a.h / 4, y1 = a.y + a.h / 4;
          pts = [[x, y0], [x + L, y0], [x + L, y1], [x, y1]];
        } else {
          const y = a.y + a.h / 2, x0 = a.x - a.w / 4, x1 = a.x + a.w / 4;
          pts = [[x0, y], [x0, y + L], [x1, y + L], [x1, y]];
        }
      } else {
        const Lc = laneBase + sz * 0.8 * lane++;
        const pt = (m, c) => (TB ? [c, m] : [m, c]);
        const aC = TB ? a.x : a.y, bC = TB ? b.x : b.y;
        const aM = TB ? a.y + a.h / 2 : a.x + a.w / 2, bM = TB ? b.y + b.h / 2 : b.x + b.w / 2;
        const mA = gapAt(rank.get(e.from)), mB = gapAt(rank.get(e.to));
        pts = [pt(aM, aC), pt(mA, aC), pt(mA, Lc), pt(mB, Lc), pt(mB, bC), pt(bM, bC)];
      }
      return { from: e.from, to: e.to, step: e.step, label: e.label ?? '', pts, back };
    });

    // Edge labels: search along each edge, then sideways, for a spot that clears boxes and other labels.
    const lsz = sz * 0.8;
    const clear = 0.1 * sz;
    const boxRects = boxes.map(b => rectOf(b.x, b.y, b.w + 2 * clear, b.h + 2 * clear));
    const placed = [];
    // Fractions nearest the middle first; offsets nearest the edge first, in half-label steps.
    // 2.5% steps: a short run between two close boxes often has its only clear spot near an elbow.
    const fracs = Array.from({ length: 41 }, (_, i) => i / 40).sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5));
    // Never centred on the edge: a label on its own line reads as struck through. Offsets start beside it.
    const offs = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8];
    // A label must not sit on another edge (its own edge is the one it names).
    const dots = routed.map(r => edgeDots(r.pts, sz * 0.15)), pad = 0.15 * sz;
    const out = routed.map((r, idx) => {
      const lb = r.label ? { w: measure(r.label, lsz) + 0.5 * lsz, h: 1.8 * lsz } : { w: 0, h: 0 };
      if (!r.label) {
        const p = sampleAt(r.pts, 0.5);
        return { ...r, lx: p.x, ly: p.y, lw: 0, lh: 0, clash: false };
      }
      // Two passes: first a spot clear of other edges too; if none, any spot clear of boxes and labels.
      let spot = null;
      for (const avoidEdges of [true, false]) {
        if (spot) break;
        search: for (const k of offs) for (const f of fracs) {
          const p = sampleAt(r.pts, f);
          // Distance along the normal that puts the label's near edge just clear of the line, whatever its angle.
          const reach = Math.abs(p.nx) * lb.w / 2 + Math.abs(p.ny) * lb.h / 2 + 0.12 * sz;
          const cx = p.x + p.nx * k * reach, cy = p.y + p.ny * k * reach;
          const rc = rectOf(cx, cy, lb.w, lb.h);
          const inside = rc.x0 >= 0 && rc.y0 >= 0 && rc.x1 <= W && rc.y1 <= H;
          // Its own line may pass the anchor just outside the label, but not run through the text.
          const onEdge = avoidEdges && dots.some((ds, j) => { const m = j === idx ? 0 : pad; return ds.some(q =>
            q[0] > rc.x0 - m && q[0] < rc.x1 + m && q[1] > rc.y0 - m && q[1] < rc.y1 + m); });
          if (!inside || boxRects.some(br => ovl(br, rc)) || placed.some(q => ovl(q, rc)) || onEdge) continue;
          spot = { cx, cy, rc };
          break search;
        }
      }
      if (!spot) {
        const p = sampleAt(r.pts, 0.5);
        return { ...r, lx: p.x, ly: p.y, lw: lb.w, lh: lb.h, clash: true };
      }
      placed.push(spot.rc);
      return { ...r, lx: spot.cx, ly: spot.cy, lw: lb.w, lh: lb.h, clash: false };
    });
    return { boxes, edges: out, clash: out.some(e => e.clash) };
  };

  // Spread, never shrink: each cap is tried until no label clashes. null when the boxes do not fit at all.
  const solve = sz => {
    let res = null;
    for (const cap of SPREAD_CAPS) {
      const P = place(sz, cap);
      if (!P.ok) return null;
      res = build(P);
      if (!res.clash) break;
    }
    return res.clash ? null : res;
  };

  // The lever for a size that does not fit: rank count, and the axis whose need is the largest share of the frame.
  const lever = sz => {
    const P = place(sz, SPREAD_CAPS[SPREAD_CAPS.length - 1]);
    const tot = { main: TB ? H : W, cross: TB ? W : H }, name = { main: TB ? 'height' : 'width', cross: TB ? 'width' : 'height' };
    const need = { main: P.needM, cross: P.needC };
    const ax = need.main / tot.main >= need.cross / tot.cross ? 'main' : 'cross';
    const body = need[ax] > tot[ax]
      ? `${name[ax]} binds (needs at least ${round(need[ax])} px, has ${round(tot[ax])})`
      : 'the edge labels find no clear spot';
    return `${R} ranks, ${body}`;
  };
  const largest = from => { for (let s = Math.ceil(from) - 1; s >= 1; s--) if (solve(s)) return s; return 'none'; };
  const round = v => Math.round(v * 10) / 10;

  // Auto size (no o.sz) shrinks 7% a step, unfloored. fit shrinks the same way but stops at FIT_FLOOR, tried last.
  // An explicit o.sz without fit is never shrunk.
  const start = o.sz ?? Math.min(W, H) / 22;
  let sz = start, res = solve(sz);
  for (let t = 0; !res && t < 80 && (o.fit ? sz > FIT_FLOOR : o.sz === undefined); t++) {
    sz = o.fit ? Math.max(FIT_FLOOR, sz * 0.93) : sz * 0.93;
    res = solve(sz);
  }
  if (!res) {
    const dir = TB ? 'TB' : 'LR';
    throw new Error(o.fit
      ? `layoutFlow: no sz from ${round(start)} down to ${FIT_FLOOR} fits ${W} x ${H} (${dir}): ${lever(FIT_FLOOR)}. Give the region more room, fewer ranks or shorter labels.`
      : o.sz === undefined
        ? `layoutFlow: diagram does not fit ${W} x ${H} (${dir}): ${lever(start)}.`
        : `layoutFlow: sz ${o.sz} does not fit ${W} x ${H} (${dir}): ${lever(o.sz)}. Largest sz that fits: ${largest(o.sz)}. Pass fit: true to shrink to it automatically, or give the region more room.`);
  }
  return { w: W, h: H, dir: TB ? 'TB' : 'LR', sz, boxes: res.boxes, edges: res.edges };
}

// Drawing. Cards keep their shape from f.still('card'+id) so they do not boil; only ink tremor uses f.R.
// Layout px are used as drawn: lay out at the frame's own w and h. f.unit scales strokes and the token.
const smoothEdge = (e, sz) => chaikin(resample(e.pts, Math.max(2, sz * 0.2)), false, 2);

// The part of a polyline up to fraction p of its arc length: where the pen is while a stroke is still drawing.
function headOf(pts, p) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = Math.min(1, Math.max(0, p)) * total;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (left >= L) { out.push(pts[i]); left -= L; continue; }
    const u = L ? left / L : 0;
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * u, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u]);
    break;
  }
  return out.length > 1 ? out : [pts[0], pts[0]];
}

// Screen point of a token: an explicit xy, or a fraction along a laid-out edge (the curve drawFlow draws).
function flowPoint(layout, token) {
  if (token.xy) return token.xy;
  const p = sampleAt(smoothEdge(layout.edges[token.edge], layout.sz), Math.min(1, Math.max(0, token.p)));
  return [p.x, p.y];
}

// o.reveal = { edges: {index: p}, boxes: {id: p} } with p in 0..1 draws a part of each edge or card as the pen
// goes; a missing key is fully drawn, and a part-drawn card has no fill or label yet.
// o.trace: edge indices on the current walk, drawn in the accent. Other edges and their labels stay quiet ink.
// o.visited: card ids on the walk; they take a pencil tint of the accent. o.emphasis: the card that gets the
// strongest tint. o.active: the card the token is on, outlined in the accent. o.token: the dot, f.unit sized.
function drawFlow(f, layout, o = {}) {
  const ctx = f.ctx, u = f.unit ?? 1, sz = layout.sz;
  const ink = f.m.ink ?? PALETTE.INK, paper = f.m.paper ?? PALETTE.PAPER_WHITE;
  const accent = o.accent ?? f.m.inks?.[0] ?? ink;
  const quiet = mix(ink, paper, 0.5), quietText = mix(ink, paper, 0.3);
  const visited = new Set(o.visited ?? []), trace = new Set(o.trace ?? []);
  const lsz = sz * 0.8;
  const rv = o.reveal ?? {}, pen = (map, k) => map?.[k] ?? 1;

  layout.edges.forEach((e, i) => {
    const hot = trace.has(i), col = hot ? accent : quiet, w = (hot ? 4 : 1.8) * u, a = hot ? 0.95 : 0.85;
    const pts = smoothEdge(e, sz), p = pen(rv.edges, i);
    if (p <= 0) return;
    if (p < 1) { f.m.stroke(ctx, f.R, headOf(pts, p), col, { w, a }); return; }
    f.m.stroke(ctx, f.R, pts, col, { w, a });
    const n = pts.length, [ex, ey] = pts[n - 1], [px, py] = pts[Math.max(0, n - 2)];
    const ang = Math.atan2(ey - py, ex - px), L = sz * 0.42;
    const head = [ang + Math.PI - 0.42, ang + Math.PI + 0.42].map(a => [ex + Math.cos(a) * L, ey + Math.sin(a) * L]);
    f.m.stroke(ctx, f.R, [head[0], [ex, ey], head[1]], col, { w, a });
    if (e.label) write(ctx, f.R, e.label, e.lx, e.ly + 0.3 * lsz, lsz, { cen: true, col: hot ? accent : quietText, a: hot ? 1 : 0.9 });
  });

  for (const b of layout.boxes) {
    const sr = f.still('card' + b.id);
    const sd = 10 + Math.floor(sr() * 90);
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, y0 = b.y - b.h / 2, y1 = b.y + b.h / 2;
    const shape = tornPath(sr, x0, y0, x1, y1, Math.max(0.8, sz * 0.12), sd);
    const p = pen(rv.boxes, b.id);
    if (p <= 0) continue;
    if (p < 1) { f.m.stroke(ctx, f.R, headOf([...shape, shape[0]], p), ink, { w: 3 * u, a: 0.95 }); continue; }
    const active = o.active === b.id;
    const tint = visited.has(b.id) ? mix(paper, accent, b.id === o.emphasis ? 0.45 : 0.18) : paper;
    f.m.fill(ctx, f.still('card' + b.id), shape, tint, { a: 1 });
    f.m.stroke(ctx, f.R, [...shape, shape[0]], active ? accent : ink, { w: (active ? 3.6 : 3) * u, a: 0.95 });
    write(ctx, f.R, b.label, b.x, b.y + 0.3 * sz, sz, { cen: true, col: ink, a: 0.95 });
  }

  if (o.token) {
    const [tx, ty] = flowPoint(layout, o.token);
    const r = 9 * u, dots = [];
    for (let i = 0; i < 14; i++) { const a = (TAU * i) / 14; dots.push([tx + Math.cos(a) * r, ty + Math.sin(a) * r]); }
    // Dense hatch at a fine pitch reads as a solid dot at this size.
    f.m.fill(ctx, f.still('token'), dots, ink, { a: 0.95, spacing: 1.4, lw: 2.2, layers: 3, pressure: 0.9 });
  }
}

// Beats for a walk through the flow: hold on each state (reading time for its label), travel 8 frames along
// the edge. The token glides across a card during the first frames of a hold, so no beat teleports it.
function flowBeats(path, fps, o = {}) {
  if (!Array.isArray(path) || path.length === 0) throw new TypeError('flowBeats: path must be a non-empty array of {view, step}');
  const layout = o.layout;
  if (path.length > 1 && !layout) throw new TypeError('flowBeats: o.layout is required when the path has travel');
  const enter = path.map((st, i) => {
    if (i === 0) return null;
    const a = String(path[i - 1].view), b = String(st.view);
    const k = layout.edges.findIndex(e => e.from === a && e.to === b && e.step === st.step);
    if (k < 0) throw new Error(`flowBeats: no laid-out edge ${a} -> ${b} via ${st.step}`);
    return k;
  });
  const TRAVEL = o.travel ?? 8, GLIDE = o.glide ?? 8;
  const list = [], meta = [];
  path.forEach((st, i) => {
    if (i > 0) { list.push({ name: `go${i}`, frames: TRAVEL }); meta.push({ kind: 'travel', state: i, edge: enter[i] }); }
    list.push({ name: `hold${i}`, say: String(st.view) });
    meta.push({ kind: 'hold', state: i });
  });
  const bt = beats(list, fps);
  const ends = k => {
    const pts = smoothEdge(layout.edges[k], layout.sz);
    return { start: pts[0], end: pts[pts.length - 1] };
  };
  const visitedTo = i => path.slice(0, i + 1).map(s => String(s.view));

  const flowAt = frame => {
    const b = bt.at(frame), m = meta[b.i], i = m.state;
    if (m.kind === 'travel') {
      const p = track([[b.start, 0], [b.start + b.frames, 1]])(frame);
      return { active: null, visited: visitedTo(i - 1), trace: [m.edge], token: { edge: m.edge, p }, beat: b.name };
    }
    const inE = enter[i], outE = i + 1 < path.length ? enter[i + 1] : null;
    let token = null;
    if (inE !== null && outE !== null) {
      const from = ends(inE).end, to = ends(outE).start;
      const u = track([[b.start, 0], [b.start + Math.min(GLIDE, b.frames), 1]])(frame);
      token = { xy: [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u] };
    } else if (outE !== null) token = { edge: outE, p: 0 };
    else if (inE !== null) token = { edge: inE, p: 1 };
    return { active: String(path[i].view), visited: visitedTo(i), trace: [], token, beat: b.name };
  };
  return { ...bt, flowAt };
}

const EXPORTS_FLOW = { defineFlow, checkFlow, layoutFlow, drawFlow, flowBeats, flowPoint };
