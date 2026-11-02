// Dry and pen media for the pencil material. The paper tooth is read in object-local coordinates, so a shape that
// only translates makes the same marks, and drawObject caches those marks as bitmaps. Pixel work runs on one scratch
// canvas: grown, never shrunk, cleared to the exact region before each use, and every stroke is clipped inside the
// region, so the canvas size never changes a pixel. Browser only: nothing touches `document` at load time.

PALETTES.PENCIL = {
  substrate: [245, 239, 227], // #F5EFE3 warm paper
  ink: [42, 38, 34],          // #2A2622
  brick: [184, 57, 43],       // #B8392B
  ochre: [217, 164, 65],      // #D9A441
  moss: [127, 156, 107],      // #7F9C6B
  sky: [111, 147, 184],       // #6F93B8
  rose: [229, 143, 155],      // #E58F9B
  kraft: [201, 162, 122],     // #C9A27A
  slate: [138, 143, 153]      // #8A8F99
};

MATERIALS.pencil = {
  name: 'Pencil', palette: 'PENCIL', ink: 'ink',
  inks: ['brick', 'ochre', 'moss', 'sky', 'rose', 'kraft', 'slate'], tooth: 'paper'
};

// --- Paper tooth ---

const DRY_N = 512;
let DRY_TOOTH = null;

/** 512x512 periodic height field in 0..1 (mean 0.5). Built once from a fixed seed. */
function paperTooth() {
  if (DRY_TOOTH) return DRY_TOOTH;
  const N = DRY_N, M = N - 1, R = stream(7319);
  const T = new Float32Array(N * N), U = new Float32Array(N * N);
  const standard = a => {
    let m = 0, v = 0;
    for (let i = 0; i < a.length; i++) m += a[i];
    m /= a.length;
    for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
    const s = Math.sqrt(v / a.length) || 1;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - m) / s;
  };
  // fine grain: white noise, two periodic box blurs
  for (let i = 0; i < N * N; i++) T[i] = R();
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      U[y * N + x] = (T[y * N + ((x - 1) & M)] + T[y * N + x] + T[y * N + ((x + 1) & M)]) / 3;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
      T[y * N + x] = (U[((y - 1) & M) * N + x] + U[y * N + x] + U[((y + 1) & M) * N + x]) / 3;
  }
  standard(T);
  // pulp: periodic value noise at two cell sizes
  const pulp = (cell, amp) => {
    const g = N / cell, L = new Float32Array(g * g);
    for (let i = 0; i < L.length; i++) L[i] = R() * 2 - 1;
    for (let y = 0; y < N; y++) {
      const fy = y / cell, y0 = Math.floor(fy), tv = fy - y0, v = tv * tv * (3 - 2 * tv);
      const ra = (y0 % g) * g, rb = ((y0 + 1) % g) * g;
      for (let x = 0; x < N; x++) {
        const fx = x / cell, x0 = Math.floor(fx), tu = fx - x0, u = tu * tu * (3 - 2 * tu);
        const a = x0 % g, b = (x0 + 1) % g;
        T[y * N + x] += amp * ((L[ra + a] * (1 - u) + L[ra + b] * u) * (1 - v) + (L[rb + a] * (1 - u) + L[rb + b] * u) * v);
      }
    }
  };
  pulp(8, 0.35);
  pulp(32, 0.2);
  // fibres: short curved splats, raised or sunk, bilinear
  for (let k = 0; k < 1400; k++) {
    let x = R() * N, y = R() * N, a = R() * TAU;
    const len = 6 + R() * 14, amp = (R() < 0.62 ? 1 : -0.8) * (0.35 + 0.5 * R()), da = (R() - 0.5) * 0.1;
    for (let s = 0; s < len; s++) {
      const e = Math.sin(Math.PI * (s + 0.5) / len) * amp * 0.6;
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const r0 = (iy & M) * N, r1 = ((iy + 1) & M) * N, c0 = ix & M, c1 = (ix + 1) & M;
      T[r0 + c0] += e * (1 - fx) * (1 - fy); T[r0 + c1] += e * fx * (1 - fy);
      T[r1 + c0] += e * (1 - fx) * fy;       T[r1 + c1] += e * fx * fy;
      x += Math.cos(a); y += Math.sin(a); a += da;
    }
  }
  standard(T);
  for (let i = 0; i < T.length; i++) T[i] = clamp(0.5 + T[i] * 0.2);
  DRY_TOOTH = T;
  return T;
}

/** Warm paper with low mottling, a faint tooth and sparse fibres. Cached by the Animator through a cel. */
function paintPaper(ctx, R, w, h, o = {}) {
  const T = paperTooth(), cv = ctx.canvas, cw = cv.width, ch = cv.height;
  const sx = cw / w, sy = ch / h, G = 6, gw = Math.ceil(cw / G) + 1, gh = Math.ceil(ch / G) + 1;
  const seed = Math.floor(R() * 9000), mk = o.mottle ?? 1, mot = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const ux = i * G / sx, uy = j * G / sy;
    mot[j * gw + i] = (0.6 * vn(ux / 150, uy / 150, seed) + 0.4 * vn(ux / 47, uy / 47, seed + 5) - 0.5) * mk;
  }
  const img = ctx.createImageData(cw, ch), d = img.data;
  let k = 0;
  for (let y = 0; y < ch; y++) {
    const trow = (Math.floor((y + 0.5) / sy) & 511) << 9, gj = ((y / G) | 0) * gw;
    for (let x = 0; x < cw; x++, k += 4) {
      const t = T[trow + (Math.floor((x + 0.5) / sx) & 511)] - 0.5;
      const l = t * 6 + mot[gj + ((x / G) | 0)] * 14;
      d[k] = 245 + l; d[k + 1] = 239 + l * 0.96; d[k + 2] = 227 + l * 0.88; d[k + 3] = 255;
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.lineCap = 'round';
  const nf = Math.round(w * h / 3200);
  for (let i = 0; i < nf; i++) {
    const x = R() * w, y = R() * h, a = R() * TAU, len = 5 + R() * 9, bow = (R() - 0.5) * 4;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    ctx.strokeStyle = R() < 0.5 ? rgba([150, 120, 90], 0.08 + R() * 0.1) : rgba([255, 253, 248], 0.5);
    ctx.lineWidth = 0.6 + R() * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + ex) / 2 - Math.sin(a) * bow, (y + ey) / 2 + Math.cos(a) * bow, ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

// --- Regions and scratch raster ---

let DRY_CV = null, DRY_CX = null;
const DRY_PAD = 8; // the scratch always has this much room past a region
const dryKey = (...parts) => JSON.stringify(parts);
// A seed drawn from a stream. Drawn whether or not a cache hit follows, so every stream advances the same way.
const dryDraw = R => Math.floor(R() * 4294967296);

// Local geometry snaps to 1/64 px. Float noise from a translation then never changes a mark or its cache key.
const dySnap = v => Math.round(v * 64) / 64;
/** Polygon in region-local px: pts minus the integer origin (x0, y0), snapped. */
const dryLocal = (pts, x0, y0) => pts.map(q => [dySnap(q[0] - x0), dySnap(q[1] - y0)]);

/** Integer origin (x0, y0) of a polygon's region with `pad` px around its bbox, size w x h, and the polygon relative to it. */
function dryRegion(pts, pad) {
  const [bx0, by0] = bbox(pts);
  const x0 = Math.floor(dySnap(bx0)) - pad, y0 = Math.floor(dySnap(by0)) - pad;
  const rel = dryLocal(pts, x0, y0);
  let mx = 0, my = 0;
  for (const q of rel) { if (q[0] > mx) mx = q[0]; if (q[1] > my) my = q[1]; }
  return { x0, y0, w: Math.ceil(mx) + pad, h: Math.ceil(my) + pad, rel };
}

/** The shared scratch canvas, cleared over exactly w x h with identity transform. First use builds the tooth too. */
function dryScratch(w, h) {
  if (!DRY_CV) {
    paperTooth();
    DRY_CV = document.createElement('canvas');
    DRY_CX = DRY_CV.getContext('2d', { willReadFrequently: true });
  }
  if (DRY_CV.width < w + DRY_PAD || DRY_CV.height < h + DRY_PAD) {
    DRY_CV.width = Math.max(w + DRY_PAD, DRY_CV.width);
    DRY_CV.height = Math.max(h + DRY_PAD, DRY_CV.height);
  }
  DRY_CX.setTransform(1, 0, 0, 1, 0, 0);
  DRY_CX.globalCompositeOperation = 'source-over';
  DRY_CX.globalAlpha = 1;
  DRY_CX.clearRect(0, 0, w, h);
  return DRY_CX;
}

// Chord of the line {p : n.(p - c) = off} through poly, as a range [lo, hi] along d = (dx, dy) from c; null when it misses.
function dryChord(poly, cx, cy, dx, dy, off) {
  const nx = -dy, ny = dx;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * (a[0] - cx) + ny * (a[1] - cy) - off, db = nx * (b[0] - cx) + ny * (b[1] - cy) - off;
    if ((da > 0) === (db > 0)) continue;
    const t = da / (da - db), qx = a[0] + (b[0] - a[0]) * t - cx, qy = a[1] + (b[1] - a[1]) * t - cy;
    const s = qx * dx + qy * dy;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return hi >= lo ? [lo, hi] : null;
}

/**
 * Straight hatch clipped to the w x h region, with a gentle bow, per-line drift and spacing varied by +-30%.
 * With poly (region-local), each line stops 0..3 px short of the polygon at each end, so gaps show near the outline.
 */
function dryHatch(g, R, w, h, ang, pitch, lw, poly = null) {
  const cx = w / 2, cy = h / 2, half = Math.hypot(w, h) / 2 + 2, dx = Math.cos(ang), dy = Math.sin(ang);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.strokeStyle = '#000';
  g.lineWidth = lw;
  g.lineCap = 'round';
  for (let t = -half; t <= half; t += pitch * rd(R, 0.7, 1.3)) {
    const bow = rd(R, -1, 1) * 1.2, drift = rd(R, -0.25, 0.25), off0 = t + drift;
    let s0 = -half, s1 = half;
    if (poly) {
      const span = dryChord(poly, cx, cy, dx, dy, off0);
      if (!span) continue;
      s0 = span[0] + Math.max(0, rd(R, -1, 3));
      s1 = span[1] - Math.max(0, rd(R, -1, 3));
      if (s1 - s0 < 2) continue;
    }
    g.beginPath();
    const n = Math.max(1, Math.ceil((s1 - s0) / 8));
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n, off = off0 + bow * (1 - (s / half) * (s / half));
      const x = cx + dx * s - dy * off, y = cy + dy * s + dx * off;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }
  g.restore();
}

/**
 * One graphite pass. cov holds stroke alpha already masked to the shape. (phX, phY) is the tooth phase of this mark.
 * Pressure sets how deep into the tooth the point reaches. Graphite already down lifts pits, so later passes fill them.
 */
function dryTake(cov, phX, phY, w, h, p, load, acc) {
  const T = paperTooth(), thr = 0.78 - 0.85 * p, sf = 0.12, film = 0.3 + 0.25 * p;
  for (let y = 0; y < h; y++) {
    const row = ((phY + y) & 511) << 9;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, c = cov[4 * i + 3] / 255;
      if (c < 0.01) continue;
      const t = T[row + ((phX + x) & 511)];
      const hh = t + (1 - t) * Math.min(0.84, load[i] * 0.84);
      let s = (hh - thr + sf) / (2 * sf);
      s = s < 0 ? 0 : s > 1 ? 1 : s * s * (3 - 2 * s);
      const dep = c * Math.min(1, film * (0.4 + 0.6 * hh) + 0.85 * s);
      acc[i] = 1 - (1 - acc[i]) * (1 - dep * 0.9);
      load[i] = Math.min(1, load[i] + dep * 0.45);
    }
  }
}

/** A w x h bitmap of colour col with the accumulated pigment alpha, scaled by k. */
function dryPaint(acc, col, w, h, k) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    d[j] = col[0]; d[j + 1] = col[1]; d[j + 2] = col[2]; d[j + 3] = acc[i] * k * 255;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Multiplies a mark bitmap onto ctx with its top-left at (x0, y0). */
function dryPlace(ctx, cv, x0, y0) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(cv, x0, y0);
  ctx.restore();
}

// --- Pencil ---

/**
 * Coloured-pencil fill as a w x h bitmap from the region-local polygon rel. Pure in (R state, rel, col, o): the
 * second hatch layer turns by ~0.35 rad, the mark is shifted 1-2 px (misregistration) and pulled in by `inset`.
 * o: angle, pressure 0..1, layers, spacing (px), inset (px), lw (px), misregister [dx, dy] (px).
 */
function pencilMark(R, rel, w, h, col, o = {}) {
  const ang = o.angle ?? 0.6, p = clamp(o.pressure ?? 0.66), layers = o.layers ?? 2;
  const pitch = o.spacing ?? 2.5, inset = o.inset ?? 0.8, lw = o.lw ?? 1.5;
  const phX = (R() * DRY_N) | 0, phY = (R() * DRY_N) | 0; // this mark's place on the tooth
  const mis = o.misregister ?? (() => { const a = rd(R, 0, TAU), m = rd(R, 1, 2); return [Math.cos(a) * m, Math.sin(a) * m]; })();
  let cx = 0, cy = 0;
  for (const q of rel) { cx += q[0]; cy += q[1]; }
  cx /= rel.length; cy /= rel.length;
  const poly = rel.map(q => {
    const vx = cx - q[0], vy = cy - q[1], l = Math.hypot(vx, vy) || 1, k = Math.min(inset, l) / l;
    return [q[0] + vx * k + mis[0], q[1] + vy * k + mis[1]];
  });
  const acc = new Float32Array(w * h), load = new Float32Array(w * h);
  for (let k = 0; k < layers; k++) {
    const g = dryScratch(w, h);
    dryHatch(g, R, w, h, ang + k * 0.35 + rd(R, -0.03, 0.03), pitch, lw, poly);
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = '#000';
    polyPath(g, poly);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    dryTake(g.getImageData(0, 0, w, h).data, phX, phY, w, h, p * (k ? 1.1 : 1), load, acc);
  }
  return dryPaint(acc, col, w, h, 0.92);
}

/** Coloured-pencil fill over a polygon, drawn now. See pencilMark. */
function pencilFill(ctx, R, pts, col, o = {}) {
  if (!pts || pts.length < 3) return;
  const r = dryRegion(pts, 4);
  dryPlace(ctx, pencilMark(R, r.rel, r.w, r.h, col || PALETTES.PENCIL.brick, o), r.x0, r.y0);
}

/** Hatched shadow bitmap: marks inside `rel`, outside `cut` (both region-local). o: angle, spacing, pressure, lw, a. */
function shadowMark(R, rel, cut, w, h, col, o = {}) {
  const ang = o.angle ?? 0.85, pitch = o.spacing ?? 2.0, p = clamp(o.pressure ?? 0.62);
  const phX = (R() * DRY_N) | 0, phY = (R() * DRY_N) | 0;
  const g = dryScratch(w, h);
  dryHatch(g, R, w, h, ang, pitch, o.lw ?? 1.2);
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = '#000';
  polyPath(g, rel);
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  polyPath(g, cut);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  const acc = new Float32Array(w * h), load = new Float32Array(w * h);
  dryTake(g.getImageData(0, 0, w, h).data, phX, phY, w, h, p, load, acc);
  return dryPaint(acc, col, w, h, o.a ?? 0.85);
}

/**
 * Hatched cast shadow: marks inside the polygon moved by (dx, dy), outside the polygon itself.
 * Goes through the same tooth as the fill, so the shadow is grainy too.
 */
function shadowHatch(ctx, R, pts, col, o = {}) {
  if (!pts || pts.length < 3) return;
  const sh = dryRegion(pts.map(q => [q[0] + (o.dx ?? 6), q[1] + (o.dy ?? 7)]), 3);
  const cut = dryLocal(pts, sh.x0, sh.y0);
  dryPlace(ctx, shadowMark(R, sh.rel, cut, sh.w, sh.h, col, o), sh.x0, sh.y0);
}

// Marks from drawObject, keyed by everything that shapes the bitmap. A translated shape reuses its mark.
// Capped by entries and by total pixels (about 32 MB of bitmaps), least recently used first out.
const DRY_CACHE = new Map(), DRY_CACHE_MAX = 256, DRY_CACHE_PX = 8e6;
let dryCachePx = 0;

function dryCached(key, make) {
  let e = DRY_CACHE.get(key);
  if (e) { DRY_CACHE.delete(key); DRY_CACHE.set(key, e); return e.cv; }
  const cv = make();
  e = { cv, px: cv.width * cv.height };
  DRY_CACHE.set(key, e);
  dryCachePx += e.px;
  while (DRY_CACHE.size > 1 && (DRY_CACHE.size > DRY_CACHE_MAX || dryCachePx > DRY_CACHE_PX)) {
    const old = DRY_CACHE.keys().next().value, oe = DRY_CACHE.get(old);
    DRY_CACHE.delete(old);
    dryCachePx -= oe.px;
  }
  return cv;
}

/** Empties the mark cache. Nothing in the engine calls it: the animator seed and the material are part of every key. */
function clearDryCache() {
  DRY_CACHE.clear();
  dryCachePx = 0;
}

// --- Pen ---

/**
 * Pen line as a filled ribbon. Points are smoothed (ends stay put), resampled every 2 px, then given
 * pressure-driven thick-thin, tapered ends and a low-frequency drift from R. A closed outline overshoots its start.
 * Pressure swells slowly along the stroke (about 0.55..1.35) and is 10% heavier on a downward stroke than an upward one.
 * o: w (px), press 0..1, closed, a (alpha), nib (angle, for calligraphic letters).
 */
function penLine(ctx, R, pts, col, o = {}) {
  if (!pts || pts.length < 2) return;
  const w = o.w ?? 2.2, press = clamp(o.press ?? 0.6), ov = rd(R, 1.5, 2.8);
  const a1 = rd(R, 0, TAU), a2 = rd(R, 0, TAU), a3 = rd(R, 0, TAU);
  const P = pts.map(q => [q[0], q[1]]);
  const f0 = P[0], f1 = P[P.length - 1];
  const gap = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]);
  const closed = o.closed ?? (P.length > 2 && gap < 0.5);
  if (closed && gap > 1e-6) P.push([f0[0], f0[1]]);
  let S = resample(P, 2);
  if (S.length < 2) return;
  if (S.length > 4) { // light moving average: ends stay put, corners stay nearly sharp
    const src = S, last = src.length - 1;
    S = src.map((q, i) => {
      if (i === 0 || i === last) return q;
      let sx = 0, sy = 0, c = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(last, i + 3); j++) { sx += src[j][0]; sy += src[j][1]; c++; }
      return [sx / c, sy / c];
    });
  }
  if (closed) {
    const s0 = S[0], s1 = S[1], e0 = S[S.length - 1], e1 = S[S.length - 2];
    const ax = s0[0] - s1[0], ay = s0[1] - s1[1], al = Math.hypot(ax, ay) || 1;
    const bx = e0[0] - e1[0], by = e0[1] - e1[1], bl = Math.hypot(bx, by) || 1;
    S = [[s0[0] + ax / al * ov, s0[1] + ay / al * ov], ...S, [e0[0] + bx / bl * ov, e0[1] + by / bl * ov]];
  }
  const n = S.length, cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
  const L = cum[n - 1] || 1, left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty, ny = tx, s = cum[i], u = s / L;
    const env = Math.pow(Math.sin(Math.PI * clamp(u)), 0.35);
    const off = env * (0.32 * Math.sin(s * 0.031 + a1) + 0.18 * Math.sin(s * 0.089 + a2) + 0.07 * Math.sin(s * 0.7 + a3));
    const taper = Math.min(1, u / 0.07, (1 - u) / 0.12), tp = 0.14 + 0.86 * Math.sqrt(Math.max(0, taper));
    const swell = 0.5 + 0.5 * (0.6 * Math.sin(s * 0.021 + a2) + 0.4 * Math.sin(s * 0.047 + a3 + 1.1));
    const pf = (0.55 + 0.8 * swell) * (1 + 0.1 * ty);
    const speed = 0.5 + 0.5 * Math.sin(Math.PI * clamp(u));
    // o.nib: a broad nib at that angle is thick across it and thin along it (calligraphic letters)
    const nibF = o.nib === undefined ? 1 : 0.15 + 0.85 * Math.abs(Math.sin(Math.atan2(ty, tx) - o.nib));
    const hw = 0.5 * w * (0.3 + 0.75 * press) * pf * (1.1 - 0.3 * speed) * tp * nibF;
    const cx = S[i][0] + nx * off, cy = S[i][1] + ny * off;
    left.push([cx + nx * hw, cy + ny * hw]);
    right.push([cx - nx * hw, cy - ny * hw]);
  }
  ctx.save();
  ctx.fillStyle = rgba(col, o.a ?? 0.94);
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * One object in paint order: cast shadow, fill, outline. Shadow and fill read f.still(key) and do not boil;
 * the outline reads f.R, so it does. fillBoil=true moves the fill onto f.R too.
 * o: fill (colour), ink, shadow (true or [dx, dy]), w (outline px), angle, pressure, layers, fillBoil, outline=false,
 * cut=false (simple mode only: no paper die-cut under a part that sits inside another one).
 * Pencil shadows and fills come from the mark cache. Each seed is drawn whether or not the cache hits, so f.R
 * advances identically on a hit and on a miss. Other materials get m.fill / m.stroke; their shadow is a flat tone.
 */
function drawObject(f, key, pts, o = {}) {
  const m = f.m, ctx = f.ctx, pencil = m.key === 'pencil', ink = o.ink ?? m.ink;
  const shR = f.still(`${key}|shadow`), fillR = o.fillBoil ? f.R : f.still(key);
  const off = Array.isArray(o.shadow) ? o.shadow : [6, 7];
  if (pencil) {
    // Simple mode (?simple=1): no cast shadow, a flat hand-edged wash, and a thin paper die-cut under the outline.
    if (o.shadow && !f.simple) {
      const sSeed = dryDraw(shR), sh = dryRegion(pts.map(q => [q[0] + off[0], q[1] + off[1]]), 3);
      const cut = dryLocal(pts, sh.x0, sh.y0);
      const cv = dryCached(dryKey('shadow', m.key, sSeed, key, ink, sh.rel, cut),
        () => shadowMark(stream(sSeed), sh.rel, cut, sh.w, sh.h, ink));
      dryPlace(ctx, cv, sh.x0, sh.y0);
    }
    if (f.simple && o.fill && o.outline !== false && o.cut !== false) {
      penLine(ctx, f.still(`${key}|cut`), pts, [252, 250, 245], { w: (o.w ?? 2.6) * 4.5, press: 1, closed: true, a: 1 });
    }
    if (f.simple && o.fill) {
      const rs = resample(pts.concat([pts[0]]), 6), q = wob(fillR, rs, 1.0);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = rgba(o.fill, 0.92);
      polyPath(ctx, q);
      ctx.fill();
      ctx.restore();
    } else if (o.fill) {
      const fSeed = dryDraw(fillR), r = dryRegion(pts, 4);
      const opt = { angle: o.angle, pressure: o.pressure, layers: o.layers };
      const cv = dryCached(dryKey('fill', m.key, fSeed, key, o.fill, opt, r.rel),
        () => pencilMark(stream(fSeed), r.rel, r.w, r.h, o.fill, opt));
      dryPlace(ctx, cv, r.x0, r.y0);
    }
  } else {
    if (o.shadow) m.fill(ctx, shR, pts.map(q => [q[0] + off[0], q[1] + off[1]]), shade(m.paper, 0.5), {});
    if (o.fill) m.fill(ctx, fillR, pts, o.fill, {});
  }
  if (o.outline !== false) {
    if (pencil) penLine(ctx, f.R, pts, ink, { w: o.w ?? 2.6, press: 0.7, closed: true });
    else m.stroke(ctx, f.R, pts.concat([pts[0]]), ink, { w: o.w ?? 2 });
  }
}

const EXPORTS_DRY = { paperTooth, paintPaper, pencilFill, penLine, shadowHatch, drawObject, clearDryCache, dryCacheSize: () => DRY_CACHE.size };
