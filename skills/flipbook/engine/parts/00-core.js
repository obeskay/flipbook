// Core primitives: PRNG, noise, math, colour, geometry, palettes. Pure: no DOM access.

const TAU = Math.PI * 2;

// --- 1. PRNG & Noise Primitives ---

function mul32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stream(seed) {
  const f = mul32((seed * 2654435761) >>> 0);
  for (let i = 0; i < 9; i++) f();
  return f;
}

const rd = (R, a, b) => a + R() * (b - a);
const ri = (R, a, b) => Math.floor(rd(R, a, b + 1));
const ch = (R, p) => R() < p;
const pk = (R, arr) => arr[(R() * arr.length) | 0];
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function h2(x, y, s) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function vn(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (
    h2(xi, yi, s) * (1 - u) * (1 - v) +
    h2(xi + 1, yi, s) * u * (1 - v) +
    h2(xi, yi + 1, s) * (1 - u) * v +
    h2(xi + 1, yi + 1, s) * u * v
  );
}

function fbm(x, y, s, o = 3) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let i = 0; i < o; i++) {
    t += vn(x * f, y * f, s + i * 17) * a;
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return t / n;
}

// --- 2. Color Palette & Utilities ---

const PALETTE = {
  CREAM: [246, 241, 228],
  PAPER_WHITE: [252, 249, 242],
  INK: [42, 37, 31],
  MARK: [30, 27, 30],
  GRAPH: [96, 92, 88],
  GREEN: [0, 112, 74],
  KRAFT: [198, 164, 114],
  GRAPHITE: [58, 55, 56],
  COBALT: [45, 90, 160],
  NAVY: [24, 38, 70],
  GOLD: [220, 175, 65],
  GOLDD: [186, 138, 48],
  VOID: [26, 24, 28],
  CORAL: [236, 110, 100],
  SAGE: [140, 170, 92],
  CARAMEL: [198, 158, 114],
  UMBER: [92, 56, 34],
  IVORY: [250, 244, 230],
  EMERALD: [16, 132, 84]
};

// --- Expanded Designer Palettes (Original Aesthetics & Themes) ---
const PALETTES = {
  // Wabi-Sabi Japanese Sumi & Kintsugi
  SUMI_WA: {
    substrate: [248, 243, 230], // Warm Kozo Washi paper
    sumi: [28, 26, 28],         // Deep Sumi ink
    vermilion: [212, 54, 44],   // Hanko stamp red
    kintsugi: [214, 168, 62],   // Burnished gold leaf
    indigo: [36, 58, 92],       // Aizome indigo wash
    moss: [92, 114, 82],        // Garden moss green
    bone: [238, 232, 218]       // Muted bleached bone
  },
  // Nordic Organic Minimalist & Lichen
  NORDIC_SLATE: {
    substrate: [236, 230, 220], // Oatmeal woven linen
    slate: [38, 42, 48],        // Deep basalt slate
    lichen: [134, 156, 132],    // Lichen sage green
    terracotta: [196, 110, 88], // Fired Nordic clay
    chalk: [248, 248, 244],     // White mineral chalk
    birch: [186, 172, 154],     // Birch bark gray
    amber: [216, 152, 64]       // Baltic amber
  },
  // Tokyo Risograph Printmaking
  TOKYO_RISO: {
    substrate: [246, 242, 234], // Unbleached newsprint
    fluo_pink: [255, 72, 140],  // Neon fluorescent pink soy ink
    cornflower: [48, 112, 230], // Vibrant Riso blue
    sunflower: [255, 212, 34],  // Bright sunflower yellow
    mint_soy: [56, 210, 162],   // Fresh mint soy ink
    black_drum: [34, 30, 36],   // Risograph black ink drum
    paper_grit: [210, 204, 194] // Paper dither speckle
  },
  // Botanical Herbarium & Naturalist Study
  BOTANICAL: {
    substrate: [244, 238, 222], // Aged naturalist parchment
    celadon: [148, 176, 152],   // Celadon leaf wash
    dried_rose: [184, 122, 130],// Pressed rose petal
    sepia_ink: [72, 54, 42],    // Vintage sepia iron gall ink
    chamomile: [228, 188, 96],  // Dried chamomile yellow
    fern: [68, 98, 72],         // Deep woodland fern
    parchment_shadow: [40, 30, 24] // Specimen box shadow
  },
  // Obsidian dark space, minimal
  OBSIDIAN_CRAFT: {
    substrate: [22, 20, 26],    // OKLCH deep obsidian void
    phosphor: [80, 230, 160],   // Electric mint phosphor line
    cyan_glow: [60, 200, 240],  // Cyan vector luminescence
    copper_ember: [240, 120, 70],// Warm copper tactile accent
    muted_slate: [88, 82, 96],  // Secondary structure line
    pure_light: [250, 250, 255] // Optical high contrast point
  },
  // Japanese Mokuhanga Woodblock Printmaking (Edo/Ukiyo-e)
  MOKUHANGA: {
    substrate: [247, 242, 230], // Echizen mulberry washi paper
    prussian: [24, 66, 102],    // Aizuri-e deep Prussian indigo woodblock ink
    persimmon: [218, 90, 52],   // Kakishibu fermented persimmon vermilion
    bokashi_sky: [142, 186, 214],// Diluted bokashi gradient cerulean
    sumi: [22, 20, 24],         // Carbon black keyblock ink
    baren_gold: [212, 170, 72]  // Bamboo leaf baren rub sheen
  },
  // Prussian blue solar cyanotype, photochemical print
  CYANOTYPE: {
    substrate: [248, 246, 240], // Heavyweight cotton rag paper
    prussian_deep: [12, 36, 72], // Ferric ferrocyanide deep solar shadow
    cerulean_mid: [36, 92, 152], // Mid-tone photochemical cyan
    cyan_wash: [96, 168, 220],   // Translucent solar rinse wash
    sun_bleach: [238, 244, 250], // Bleached white botanical contact reserve
    tannic_shadow: [76, 60, 52]  // Tea-toned botanical shadow accent
  },
  // Mid-century opaque matte gouache, paper cutouts
  GOUACHE: {
    substrate: [238, 232, 220], // Buff-toned French cardstock
    ultramarine: [32, 58, 166], // Opaque chalky French ultramarine
    burnt_ochre: [204, 86, 44], // Warm volcanic earth ochre
    olive_leaf: [84, 114, 66],  // Matte sage olive pigment
    cadmium_lemon: [246, 206, 46], // Pure opaque mineral lemon
    chalk_white: [250, 248, 244],// China white body gouache
    raw_umber: [56, 44, 36]     // Deep walnut earth shadow
  },
  // 18th-Century Intaglio Copperplate Engraving & Naturalist Atlas
  INTAGLIO: {
    substrate: [248, 245, 236], // Ivory vellum rag paper
    iron_gall: [24, 22, 26],    // Antique iron gall etching ink
    sepia_shadow: [64, 48, 38], // Deep plate tone & shadow
    verdigris: [48, 114, 98],   // Oxidized copperplate mineral green
    plate_tone: [224, 214, 198] // Uncleaned copper wiped plate sheen
  },
  // Heian Dynasty Japanese Suminagashi (Floating Ink Marbling)
  SUMINAGASHI: {
    substrate: [250, 248, 242], // Torinoko floating water washi
    sumi: [20, 18, 22],         // Pure pine soot sumi ink
    indigo_wash: [30, 52, 86],  // Aizome indigo ribbon
    bengara: [186, 58, 50],     // Bengara iron oxide vermilion
    water_surface: [232, 240, 246] // Clear mountain water meniscus
  }
};

const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp(a)})`;
const shade = (c, k) => [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)];
const tint = (c, k) => [c[0] + (255 - c[0]) * k, c[1] + (255 - c[1]) * k, c[2] + (255 - c[2]) * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = str => { const n = parseInt(str.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// --- 3. Geometry & Splines ---

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function polyPath(ctx, pts) {
  if (!pts || pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function resample(pts, step = 4) {
  if (pts.length < 2) return pts.slice();
  const out = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d === 0) continue;
    let dist = step - carry;
    while (dist <= d) {
      const t = dist / d;
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      dist += step;
    }
    carry = d - (dist - step);
  }
  if (out.length < 2 || Math.hypot(out[out.length - 1][0] - pts[pts.length - 1][0], out[out.length - 1][1] - pts[pts.length - 1][1]) > step * 0.4) {
    out.push(pts[pts.length - 1].slice());
  }
  return out;
}

function chaikin(pts, closed = false, iterations = 2) {
  let curr = pts.map(p => p.slice());
  for (let it = 0; it < iterations; it++) {
    const next = [];
    const len = curr.length;
    if (len < 3) return curr;
    if (!closed) next.push(curr[0].slice());
    const count = closed ? len : len - 1;
    for (let i = 0; i < count; i++) {
      const p0 = curr[i], p1 = curr[(i + 1) % len];
      next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
      next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
    }
    if (!closed) next.push(curr[len - 1].slice());
    curr = next;
  }
  return curr;
}

function normalAt(pts, i) {
  const n = pts.length;
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
  let nx = -(b[1] - a[1]), ny = b[0] - a[0];
  const d = Math.hypot(nx, ny) || 1;
  return [nx / d, ny / d];
}

/**
 * Harmonic multi-frequency perpendicular wobble.
 * Mimics organic hand tremor and pen pressure variations.
 */
function wob(R, rs, amp = 1.0) {
  const n = rs.length, q = [];
  const P1 = rd(R, 0, 7), P2 = rd(R, 0, 7), P3 = rd(R, 0, 7);
  const F1 = rd(R, 1.6, 3.2), F2 = rd(R, 5, 9);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const [nx, ny] = normalAt(rs, i);
    const off = amp * (0.62 * Math.sin(t * F1 * 2 + P1) + 0.28 * Math.sin(t * F2 + P2) + 0.10 * Math.sin(t * 17 + P3));
    q.push([rs[i][0] + nx * off + rd(R, -0.3, 0.3), rs[i][1] + ny * off + rd(R, -0.3, 0.3)]);
  }
  return q;
}

/**
 * Recursive polygon midpoint displacement.
 * Splits every segment at midpoint, perturbing along normal with bell-shaped jitter.
 * Creates fractal pigment bleed contours for true generative watercolor & capillary edges.
 */
function recursiveDeform(R, pts, iterations = 3, variance = 12) {
  let curr = pts.map(p => p.slice());
  for (let it = 0; it < iterations; it++) {
    const next = [];
    const len = curr.length;
    for (let i = 0; i < len; i++) {
      const p0 = curr[i], p1 = curr[(i + 1) % len];
      next.push(p0.slice());
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const nx = -(p1[1] - p0[1]) / (segLen || 1);
      const ny = (p1[0] - p0[0]) / (segLen || 1);
      // bell-shaped noise: sum of three uniforms
      const gauss = (R() + R() + R() - 1.5) * (variance / Math.pow(1.6, it));
      next.push([mid[0] + nx * gauss, mid[1] + ny * gauss]);
    }
    curr = next;
  }
  return curr;
}

/**
 * Flow field streamline tracer over fbm noise.
 * Generates organic flowing paths tracing a vector field for woodcut relief lines,
 * copperplate hatching, and water currents.
 */
function flowFieldStreamlines(R, bounds, o = {}) {
  const [x0, y0, x1, y1] = bounds;
  const numLines = o.numLines ?? 60;
  const stepSize = o.stepSize ?? 4.0;
  const maxSteps = o.maxSteps ?? 45;
  const scale = o.scale ?? 0.0035;
  const seed = o.seed ?? 42;
  const streamlines = [];

  for (let l = 0; l < numLines; l++) {
    let px = rd(R, x0, x1);
    let py = rd(R, y0, y1);
    const line = [[px, py]];

    for (let s = 0; s < maxSteps; s++) {
      const ang = fbm(px * scale, py * scale, seed, 3) * TAU * 1.5;
      px += Math.cos(ang) * stepSize;
      py += Math.sin(ang) * stepSize;
      if (px < x0 - 20 || px > x1 + 20 || py < y0 - 20 || py > y1 + 20) break;
      line.push([px, py]);
    }

    if (line.length > 3) {
      streamlines.push(chaikin(line, false, 2));
    }
  }
  return streamlines;
}

const arcPts = (cx, cy, rx, ry, a0, a1, n = 9) => {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    p.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return p;
};

function rrect(x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  return [].concat(
    arcPts(x1 - r, y0 + r, r, r, -Math.PI / 2, 0, 4),
    arcPts(x1 - r, y1 - r, r, r, 0, Math.PI / 2, 4),
    arcPts(x0 + r, y1 - r, r, r, Math.PI / 2, Math.PI, 4),
    arcPts(x0 + r, y0 + r, r, r, Math.PI, (Math.PI * 3) / 2, 4)
  );
}

function tornPath(R, x0, y0, x1, y1, rough = 14, sd = 42) {
  const pts = [];
  const side = (ax, ay, bx, by, nx, ny, id) => {
    const L = Math.hypot(bx - ax, by - ay), steps = Math.max(4, Math.round(L / 22));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      let off = (fbm(t * 3.1 + id * 7, id * 3.3, sd, 3) - 0.5) * 2 * rough;
      if (h2(i * 1.7, id * 9.1, sd) > 0.92) off += rd(R, 8, 20) * (h2(i, id, sd + 3) > 0.5 ? 1 : -1);
      pts.push([ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off]);
    }
  };
  side(x0, y0, x1, y0, 0, 1, 0);
  side(x1, y0, x1, y1, -1, 0, 1);
  side(x1, y1, x0, y1, 0, -1, 2);
  side(x0, y1, x0, y0, 1, 0, 3);
  return pts;
}

const EXPORTS_CORE = {
  TAU, mul32, stream, rd, ri, ch, pk, clamp, lerp, h2, vn, fbm, PALETTE, PALETTES,
  rgba, shade, tint, mix, hex, bbox, polyPath, resample, chaikin, normalAt, wob, recursiveDeform,
  flowFieldStreamlines, arcPts, rrect, tornPath
};
