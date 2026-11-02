// Letters: stroke-font glyph table (GL), measure, write, writeOnPath, wrap. Spanish glyphs included.

let CURRENT_FRAME = 0; // set by Animator each frame; trace records read it

const GL = {};
const G = (chr, w, ...strokes) => (GL[chr] = { w, s: strokes });

// Lowercase
G('a', 0.62, arcPts(0.27, 0.73, 0.23, 0.26, -0.5, 5.8), [[0.5, 0.48], [0.52, 0.96], [0.6, 1]]);
G('b', 0.6, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.56], [0.34, 0.47], [0.54, 0.62], [0.53, 0.86], [0.3, 1], [0.1, 0.9]]);
G('c', 0.58, arcPts(0.3, 0.74, 0.25, 0.26, 0.6, 5.68));
G('d', 0.62, arcPts(0.28, 0.74, 0.24, 0.26, -0.5, 5.8), [[0.52, 0.05], [0.53, 0.95], [0.6, 1]]);
G('e', 0.56, [[0.08, 0.73], [0.48, 0.7], [0.49, 0.54], [0.3, 0.45], [0.1, 0.56], [0.07, 0.8], [0.26, 1], [0.5, 0.93]]);
G('f', 0.46, [[0.44, 0.12], [0.32, 0.05], [0.22, 0.14], [0.2, 1]], [[0.05, 0.48], [0.42, 0.46]]);
G('g', 0.6, arcPts(0.28, 0.72, 0.23, 0.25, -0.5, 5.8), [[0.5, 0.48], [0.53, 1.12], [0.42, 1.36], [0.16, 1.32]]);
G('h', 0.58, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.62], [0.3, 0.47], [0.48, 0.56], [0.5, 1]]);
G('i', 0.26, [[0.13, 0.5], [0.13, 0.96], [0.18, 1]], [[0.13, 0.285]]);
G('j', 0.34, [[0.22, 0.5], [0.24, 1.15], [0.12, 1.36], [-0.02, 1.28]], [[0.22, 0.285]]);
G('k', 0.52, [[0.1, 0.05], [0.1, 1]], [[0.44, 0.48], [0.12, 0.76]], [[0.2, 0.68], [0.46, 1]]);
G('l', 0.3, [[0.14, 0.05], [0.14, 0.93], [0.22, 1]]);
G('m', 0.68, [[0.07, 1], [0.07, 0.5]], [[0.07, 0.62], [0.2, 0.46], [0.33, 0.56], [0.34, 1]], [[0.34, 0.62], [0.47, 0.46], [0.6, 0.56], [0.61, 1]]);
G('n', 0.56, [[0.09, 1], [0.09, 0.5]], [[0.09, 0.62], [0.28, 0.46], [0.46, 0.56], [0.48, 1]]);
G('o', 0.6, arcPts(0.29, 0.73, 0.24, 0.26, -1.2, -1.2 + TAU * 0.97, 10));
G('p', 0.6, [[0.1, 0.5], [0.1, 1.36]], [[0.1, 0.57], [0.34, 0.47], [0.53, 0.62], [0.52, 0.86], [0.3, 0.98], [0.1, 0.9]]);
G('q', 0.62, arcPts(0.28, 0.72, 0.23, 0.25, -0.5, 5.8), [[0.5, 0.5], [0.52, 1.22], [0.62, 1.34]]);
G('r', 0.44, [[0.1, 1], [0.1, 0.5]], [[0.1, 0.68], [0.22, 0.5], [0.42, 0.46]]);
G('s', 0.52, [[0.46, 0.52], [0.24, 0.45], [0.09, 0.58], [0.22, 0.72], [0.42, 0.8], [0.46, 0.93], [0.24, 1], [0.06, 0.92]]);
G('t', 0.48, [[0.26, 0.12], [0.25, 0.9], [0.36, 1]], [[0.08, 0.44], [0.46, 0.43]]);
G('u', 0.58, [[0.08, 0.5], [0.08, 0.84], [0.22, 1], [0.42, 0.9], [0.45, 0.5]], [[0.45, 0.6], [0.47, 0.96], [0.54, 1]]);
G('v', 0.5, [[0.06, 0.5], [0.26, 1], [0.46, 0.5]]);
G('w', 0.62, [[0.04, 0.5], [0.17, 1], [0.3, 0.62], [0.43, 1], [0.57, 0.5]]);
G('x', 0.52, [[0.08, 0.5], [0.44, 1]], [[0.44, 0.5], [0.08, 1]]);
G('y', 0.56, [[0.08, 0.5], [0.28, 0.94], [0.48, 0.5]], [[0.48, 0.5], [0.3, 1.15], [0.14, 1.36], [-0.02, 1.3]]);
G('z', 0.52, [[0.08, 0.5], [0.44, 0.5], [0.1, 1], [0.46, 1]]);

// Uppercase
G('A', 0.64, [[0.08, 1], [0.32, 0.05], [0.56, 1]], [[0.16, 0.65], [0.48, 0.65]]);
G('B', 0.62, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.05], [0.4, 0.05], [0.52, 0.25], [0.38, 0.5], [0.1, 0.5]], [[0.1, 0.5], [0.42, 0.5], [0.56, 0.75], [0.4, 1], [0.1, 1]]);
G('C', 0.62, arcPts(0.34, 0.52, 0.28, 0.46, 0.6, 5.68));
G('D', 0.64, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.05], [0.36, 0.05], [0.56, 0.35], [0.56, 0.7], [0.36, 1], [0.1, 1]]);
G('E', 0.56, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.05], [0.48, 0.05]], [[0.1, 0.52], [0.38, 0.52]], [[0.1, 1], [0.5, 1]]);
G('F', 0.56, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.05], [0.48, 0.05]], [[0.1, 0.52], [0.38, 0.52]]);
G('G', 0.64, arcPts(0.34, 0.52, 0.28, 0.46, 0.6, 6.2), [[0.38, 0.6], [0.56, 0.6], [0.56, 1]]);
G('H', 0.62, [[0.1, 0.05], [0.1, 1]], [[0.52, 0.05], [0.52, 1]], [[0.1, 0.52], [0.52, 0.52]]);
G('I', 0.32, [[0.16, 0.05], [0.16, 1]], [[0.06, 0.05], [0.26, 0.05]], [[0.06, 1], [0.26, 1]]);
G('J', 0.48, [[0.36, 0.05], [0.36, 0.8], [0.24, 1], [0.1, 0.9], [0.06, 0.72]], [[0.2, 0.05], [0.5, 0.05]]);
G('K', 0.6, [[0.1, 0.05], [0.1, 1]], [[0.52, 0.08], [0.14, 0.55]], [[0.24, 0.45], [0.54, 1]]);
G('L', 0.52, [[0.12, 0.05], [0.12, 1], [0.48, 1]]);
G('M', 0.72, [[0.1, 1], [0.1, 0.05], [0.36, 0.68], [0.62, 0.05], [0.62, 1]]);
G('N', 0.64, [[0.1, 1], [0.1, 0.05], [0.54, 1], [0.54, 0.05]]);
G('O', 0.64, arcPts(0.32, 0.52, 0.26, 0.46, -Math.PI / 2, (3 * Math.PI) / 2, 12));
G('P', 0.60, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.05], [0.38, 0.05], [0.54, 0.26], [0.38, 0.52], [0.1, 0.52]]);
G('Q', 0.64, arcPts(0.32, 0.52, 0.26, 0.46, -Math.PI / 2, (3 * Math.PI) / 2, 12), [[0.36, 0.76], [0.56, 1.08]]);
G('R', 0.62, [[0.1, 0.05], [0.1, 1]], [[0.1, 0.05], [0.38, 0.05], [0.54, 0.26], [0.38, 0.52], [0.1, 0.52]], [[0.28, 0.52], [0.54, 1]]);
G('S', 0.56, [[0.48, 0.16], [0.3, 0.06], [0.12, 0.22], [0.26, 0.48], [0.46, 0.62], [0.48, 0.84], [0.28, 0.98], [0.08, 0.88]]);
G('T', 0.56, [[0.06, 0.05], [0.5, 0.05]], [[0.28, 0.05], [0.28, 1]]);
G('U', 0.62, [[0.1, 0.05], [0.1, 0.8], [0.32, 1], [0.52, 0.8], [0.52, 0.05]]);
G('V', 0.6, [[0.08, 0.05], [0.3, 1], [0.52, 0.05]]);
G('W', 0.76, [[0.06, 0.05], [0.22, 1], [0.38, 0.28], [0.54, 1], [0.7, 0.05]]);
G('X', 0.62, [[0.08, 0.05], [0.54, 1]], [[0.54, 0.05], [0.08, 1]]);
G('Y', 0.58, [[0.08, 0.05], [0.29, 0.52]], [[0.5, 0.05], [0.29, 0.52], [0.29, 1]]);
G('Z', 0.58, [[0.08, 0.05], [0.52, 0.05], [0.1, 1], [0.54, 1]]);

// Digits (Handcrafted for full procedural completion)
G('0', 0.58, arcPts(0.29, 0.52, 0.22, 0.46, -Math.PI / 2, (3 * Math.PI) / 2, 10));
G('1', 0.36, [[0.08, 0.24], [0.2, 0.05], [0.2, 1]], [[0.08, 1], [0.32, 1]]);
G('2', 0.54, [...arcPts(0.27, 0.3, 0.2, 0.22, Math.PI, 2 * Math.PI + 0.6, 14), [0.08, 1], [0.5, 1]]);
G('3', 0.52, [[0.08, 0.1], [0.46, 0.1], [0.26, 0.48]], [[0.26, 0.48], [0.46, 0.64], [0.42, 0.92], [0.24, 1], [0.08, 0.9]]);
G('4', 0.56, [[0.4, 1], [0.4, 0.05]], [[0.4, 0.05], [0.08, 0.68], [0.52, 0.68]]);
G('5', 0.52, [[0.44, 0.08], [0.12, 0.08], [0.1, 0.44], [0.32, 0.4], [0.46, 0.58], [0.42, 0.9], [0.24, 1], [0.08, 0.92]]);
G('6', 0.56, arcPts(0.28, 0.72, 0.22, 0.26, 0, TAU, 8), [[0.44, 0.16], [0.26, 0.06], [0.08, 0.4], [0.08, 0.8]]);
G('7', 0.52, [[0.08, 0.06], [0.46, 0.06], [0.22, 1]]);
G('8', 0.54, arcPts(0.27, 0.28, 0.19, 0.22, 0, TAU, 8), arcPts(0.27, 0.72, 0.22, 0.26, 0, TAU, 8));
G('9', 0.56, arcPts(0.28, 0.32, 0.22, 0.26, 0, TAU, 8), [[0.48, 0.24], [0.48, 0.68], [0.34, 0.96], [0.14, 0.92]]);

// Punctuation & Symbols
G('.', 0.24, [[0.125, 0.95]]);
G(',', 0.26, [[0.14, 0.9], [0.12, 1.1], [0.06, 1.18]]);
G('-', 0.38, [[0.06, 0.62], [0.32, 0.62]]);
G(':', 0.26, [[0.13, 0.54]], [[0.13, 0.94]]);
G('!', 0.26, [[0.13, 0.08], [0.13, 0.7]], [[0.13, 0.94]]);
G('?', 0.5, [[0.08, 0.24], [0.24, 0.06], [0.42, 0.18], [0.4, 0.38], [0.25, 0.52], [0.25, 0.68]], [[0.25, 0.94]]);
G('/', 0.44, [[0.08, 1], [0.36, 0.05]]);
G('&', 0.58, [[0.48, 0.95], [0.2, 0.52], [0.26, 0.15], [0.36, 0.22], [0.12, 0.72], [0.24, 0.96], [0.52, 0.62], [0.55, 0.98]]);
G('(', 0.32, arcPts(0.26, 0.52, 0.18, 0.48, Math.PI * 0.6, Math.PI * 1.4, 6));
G(')', 0.32, arcPts(0.06, 0.52, 0.18, 0.48, -Math.PI * 0.4, Math.PI * 0.4, 6));
G(' ', 0.35);

// Figures and symbols for Spanish copy and tables. A one-point stroke is a dot (see inkDot).
G('%', 0.72, arcPts(0.17, 0.22, 0.14, 0.14, 0, TAU, 10), arcPts(0.47, 0.78, 0.14, 0.14, 0, TAU, 10), [[0.62, 0.02], [0.02, 0.98]]);
G('$', 0.56, [[0.46, 0.16], [0.3, 0.06], [0.12, 0.22], [0.26, 0.48], [0.46, 0.62], [0.48, 0.84], [0.28, 0.98], [0.08, 0.88]], [[0.28, -0.1], [0.28, 1.1]]);
G('+', 0.56, [[0.08, 0.55], [0.48, 0.55]], [[0.28, 0.34], [0.28, 0.76]]);
G('=', 0.56, [[0.08, 0.42], [0.48, 0.42]], [[0.08, 0.68], [0.48, 0.68]]);
G(';', 0.26, [[0.13, 0.54]], [[0.14, 0.9], [0.12, 1.1], [0.06, 1.18]]);
G('"', 0.4, [[0.13, 0.05], [0.11, 0.3]], [[0.29, 0.05], [0.27, 0.3]]);
G("'", 0.22, [[0.12, 0.05], [0.1, 0.3]]);
G('#', 0.6, [[0.2, 0.1], [0.14, 1]], [[0.44, 0.1], [0.38, 1]], [[0.06, 0.4], [0.52, 0.4]], [[0.02, 0.7], [0.48, 0.7]]);
G('@', 0.8, arcPts(0.4, 0.5, 0.36, 0.48, 0, TAU, 16), arcPts(0.4, 0.52, 0.17, 0.2, 0, TAU, 12), [[0.57, 0.32], [0.57, 0.62], [0.68, 0.7], [0.76, 0.56]]);
G('*', 0.5, [[0.25, 0.12], [0.25, 0.5]], [[0.06, 0.22], [0.44, 0.4]], [[0.44, 0.22], [0.06, 0.4]]);
G('_', 0.56, [[0.02, 1.08], [0.54, 1.08]]);

// Spanish marks: acute, diaeresis and tilde laid over base glyphs. Capitals lift the mark.
const MARK = {
  acute: [[[-0.07, 0.3], [0.07, 0.1]]],
  tilde: [[[-0.1, 0.34], [-0.03, 0.28], [0.04, 0.36], [0.11, 0.3]]],
  diaer: [[[-0.085, 0.3]], [[0.085, 0.3]]]
};
const accent = (chr, base, mark, up = false) => {
  const { w, s } = GL[base], cx = w / 2, dy = up ? -0.42 : 0;
  GL[chr] = { w, s: [...s, ...mark.map(st => st.map(([x, y]) => [x + cx, y + dy]))] };
};
accent('á', 'a', MARK.acute); accent('é', 'e', MARK.acute); accent('í', 'i', MARK.acute);
accent('ó', 'o', MARK.acute); accent('ú', 'u', MARK.acute); accent('ü', 'u', MARK.diaer);
accent('ñ', 'n', MARK.tilde);
accent('Á', 'A', MARK.acute, true); accent('É', 'E', MARK.acute, true); accent('Í', 'I', MARK.acute, true);
accent('Ó', 'O', MARK.acute, true); accent('Ú', 'U', MARK.acute, true); accent('Ü', 'U', MARK.diaer, true);
accent('Ñ', 'N', MARK.tilde, true);

// Inverted ¿ and ¡ are ? and ! turned 180 degrees.
const turn = (chr, as) => {
  const { w, s } = GL[chr];
  GL[as] = { w, s: s.map(st => st.map(([x, y]) => [w - x, 1 - y])) };
};
turn('?', '¿');
turn('!', '¡');

// Advance per code point, the same walk write() makes. The trailing gap is not counted.
function measure(t, sz) {
  let x = 0, n = 0;
  for (const c of String(t)) {
    const g = GL[c] || GL[' '];
    x += (g.w + 0.1) * sz;
    n++;
  }
  return n ? x - 0.1 * sz : 0;
}

// A one-point stroke is a dot: a small filled blob with a few percent of wobble, so it shows at every size.
// The old two-point dots were ribbons under 2 px long and vanished on the page.
function inkDot(ctx, R, x, y, r, col, a) {
  ctx.save();
  ctx.fillStyle = rgba(col, a);
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const t = (k / 10) * TAU, q = r * (1 + rd(R, -0.08, 0.08));
    const px = x + Math.cos(t) * q, py = y + Math.sin(t) * q;
    if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Hand lettering. sz >= 18: thick-thin pen ribbons (penLine). 12 <= sz < 18: wobbled strokes.
 * sz < 12: plain polylines, no R draws, so tiny labels stay cheap. Every glyph sits on one baseline.
 */
function write(ctx, R, t, x, y, sz, o = {}) {
  t = String(t);
  const a = o.a ?? 0.7, col = o.col || PALETTE.INK, tilt = o.tilt ?? 0;
  let px = o.cen ? x - measure(t, sz) / 2 : x;
  const trace = globalThis.__FLIPBOOK_TRACE__;
  if (Array.isArray(trace)) {
    const box = { x0: px, y0: y - sz, x1: px + measure(t, sz), y1: y + 0.4 * sz };
    // Characters with no glyph draw as a blank gap; check.mjs reports them as FB116.
    const missing = [...new Set([...t].filter(c => !Object.hasOwn(GL, c)))];
    trace.push({ kind: 'text', text: t, ...box, sz, frame: CURRENT_FRAME, missing });
  }
  const big = sz >= 18, small = sz < 12;
  const wd = o.w ?? (big ? sz * 0.115 : Math.max(0.85, sz * 0.075));
  for (const c of t) {
    const g = GL[c] || GL[' '];
    const yb = y + (px - x) * tilt; // whole-line slant only; no per-glyph bounce
    for (const st of g.s || []) {
      if (st.length === 1) {
        inkDot(ctx, R, px + st[0][0] * sz, yb + (st[0][1] - 1) * sz, Math.max(0.9, wd * 0.55), col, a);
        continue;
      }
      const pts = st.map(p => [px + p[0] * sz, yb + (p[1] - 1) * sz]);
      if (small) {
        ctx.save();
        ctx.strokeStyle = rgba(col, a);
        ctx.lineWidth = wd;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.stroke();
        ctx.restore();
      } else if (big) {
        penLine(ctx, R, pts, col, { w: wd, press: 0.8, a, nib: 0.3 });
      } else {
        const jit = pts.map(q => [q[0] + rd(R, -0.02, 0.02) * sz, q[1] + rd(R, -0.02, 0.02) * sz]);
        sk(ctx, R, jit, { col, w: wd, a, amp: Math.min(0.5, sz * 0.028) });
      }
    }
    px += (g.w + 0.1) * sz;
  }
}
/**
 * Renders text curving along a 2D spline / path.
 */
function writeOnPath(ctx, R, t, pathPts, sz, o = {}) {
  const rs = resample(pathPts, 3);
  const totalL = rs.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - rs[i - 1][0], p[1] - rs[i - 1][1]) : 0), 0);
  const textW = measure(t, sz);
  let dist = o.cen ? (totalL - textW) / 2 : (o.offset ?? 10);
  const a = o.a ?? 0.75, col = o.col || PALETTE.INK;

  let pathIdx = 0, walk = 0;
  const getPointAt = targetD => {
    while (pathIdx < rs.length - 1) {
      const seg = Math.hypot(rs[pathIdx + 1][0] - rs[pathIdx][0], rs[pathIdx + 1][1] - rs[pathIdx][1]);
      if (walk + seg >= targetD) {
        const localT = (targetD - walk) / (seg || 1);
        const pt = [lerp(rs[pathIdx][0], rs[pathIdx + 1][0], localT), lerp(rs[pathIdx][1], rs[pathIdx + 1][1], localT)];
        const ang = Math.atan2(rs[pathIdx + 1][1] - rs[pathIdx][1], rs[pathIdx + 1][0] - rs[pathIdx][0]);
        return { pt, ang };
      }
      walk += seg;
      pathIdx++;
    }
    return null;
  };

  for (const c of String(t)) {
    const g = GL[c] || GL[' '];
    const charW = (g.w + 0.1) * sz;
    const midD = dist + charW * 0.5;
    const res = getPointAt(midD);
    if (!res) break;
    const { pt, ang } = res;
    const [nx, ny] = [-Math.sin(ang), Math.cos(ang)];
    const [tx, ty] = [Math.cos(ang), Math.sin(ang)];

    for (const st of g.s || []) {
      if (st.length === 1) {
        const lx = (st[0][0] - g.w * 0.5) * sz, ly = (st[0][1] - 1) * sz;
        inkDot(ctx, R, pt[0] + tx * lx + nx * ly, pt[1] + ty * lx + ny * ly, Math.max(0.9, Math.max(0.85, sz * 0.08) * 0.55), col, a);
        continue;
      }
      const pts = st.map(p => {
        const lx = (p[0] - g.w * 0.5) * sz;
        const ly = (p[1] - 1) * sz;
        return [
          pt[0] + tx * lx + nx * ly + rd(R, -0.4, 0.4),
          pt[1] + ty * lx + ny * ly + rd(R, -0.4, 0.4)
        ];
      });
      sk(ctx, R, pts, { col, w: o.w ?? Math.max(0.85, sz * 0.08), a, amp: 0.35 });
    }
    dist += charW;
  }
}

/**
 * Word wrap at maxWidth px for text at size sz. Newlines always break. Balanced: the fewest lines the width allows,
 * split where the widest line is narrowest, so a short last word is not left alone on a line.
 */
function wrap(t, maxWidth, sz) {
  const out = [];
  for (const para of String(t).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const greedy = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, sz) > maxWidth) { greedy.push(line); line = word; } else line = next;
    }
    greedy.push(line);
    const n = greedy.length, m = words.length;
    const W = (i, j) => measure(words.slice(i, j).join(' '), sz);
    // cost[k][j]: least widest line over the first j words in k lines; from[k][j]: where the k-th line starts
    const cost = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
    const from = Array.from({ length: n + 1 }, () => Array(m + 1).fill(-1));
    cost[0][0] = 0;
    for (let k = 1; k <= n; k++) {
      for (let j = k; j <= m; j++) {
        for (let i = k - 1; i < j; i++) {
          const w = W(i, j);
          if (w > maxWidth || cost[k - 1][i] === Infinity) continue;
          const c = Math.max(cost[k - 1][i], w);
          if (c < cost[k][j]) { cost[k][j] = c; from[k][j] = i; }
        }
      }
    }
    if (n < 2 || cost[n][m] === Infinity) { out.push(...greedy); continue; }
    const lines = [];
    for (let k = n, j = m; k >= 1; k--) {
      const i = from[k][j];
      lines.unshift(words.slice(i, j).join(' '));
      j = i;
    }
    out.push(...lines);
  }
  return out;
}

const EXPORTS_LETTERS = { GL, G, measure, write, writeOnPath, wrap };
