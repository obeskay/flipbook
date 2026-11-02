// Tests for the engine parts that changed: dry media (20), letters (30) and bars (70). Headless Chrome through
// skills/flipbook/scripts/lib/chrome.mjs; every check reads real pixels or the trace that write() records.
// Run: node --test tests/engine.test.mjs (from the repo root, or with its absolute path)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const SKILL = join(TESTS, '..', 'skills', 'flipbook');
const ENGINE = join(SKILL, 'engine', 'flipbook.js');
const { launchChrome } = await import(pathToFileURL(join(SKILL, 'scripts', 'lib', 'chrome.mjs')).href);

const engineSrc = readFileSync(ENGINE, 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'flipbook-engine-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let chrome;
before(async () => { chrome = await launchChrome(); });
after(async () => { if (chrome) await chrome.close(); });

// A blank page with the engine loaded as a plain script. Page-side helpers live on globalThis.TH.
async function freshPage() {
  await chrome.open('about:blank');
  await chrome.evaluate(engineSrc);
  await chrome.evaluate(HELPERS);
}

const HELPERS = `globalThis.TH = (() => {
  const F = Flipbook;
  const seedOf = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; };
  // a fresh frame whose streams depend only on keys, so two calls with the same inputs draw the same marks
  const frameFor = (ctx) => ({ ctx, m: F.material('pencil'), R: F.stream(seedOf('boil')), still: k => F.stream(seedOf(k)), unit: 1, t: 1 });
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const hash = c => { const d = pixels(c); let h = 2166136261; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0; return h; };
  const alpha = (D, W, x, y) => D[(y * W + x) * 4 + 3];
  // number of pixels where a(x+ax, y+ay) differs from b(x+bx, y+by) over a w x h window
  const mismatches = (a, ax, ay, b, bx, by, w, h) => {
    const A = pixels(a), B = pixels(b); let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((ay + y) * a.width + ax + x) * 4, j = ((by + y) * b.width + bx + x) * 4;
      if (A[i] !== B[j] || A[i + 1] !== B[j + 1] || A[i + 2] !== B[j + 2] || A[i + 3] !== B[j + 3]) n++;
    }
    return n;
  };
  return { F, seedOf, frameFor, canvas, pixels, hash, alpha, mismatches };
})();`;

// --- glyphs ---

const NEW_AND_SPANISH = ['%', '$', '+', '=', '/', ':', ';', '(', ')', '"', "'", '#', '@', '&', '*', '-', '_',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Á', 'É', 'Í', 'Ó', 'Ú', 'Ü', 'Ñ', '¿', '?', '¡', '!',
  'á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ', '.', ','];

test('every requested glyph has strokes and a positive measure', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const { GL, measure } = Flipbook; const bad = [];
    for (const c of ${JSON.stringify(NEW_AND_SPANISH)}) {
      const g = GL[c];
      if (!g || !g.s || g.s.length === 0) { bad.push(c + ': no strokes'); continue; }
      for (const st of g.s) for (const p of st) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) bad.push(c + ': non-finite point');
      if (!(measure(c, 40) > 0)) bad.push(c + ': measure ' + measure(c, 40));
    }
    return bad;
  })()`);
  assert.deepEqual(out, []);
});

test('measure equals the box write() records, centred text included', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const { write, measure } = Flipbook, c = document.createElement('canvas'); c.width = 900; c.height = 200;
    const ctx = c.getContext('2d'), R = Flipbook.stream(3), t = 'Ñandú ¿Qué? 50% $1,200 @#*_ "x" +=;()/';
    globalThis.__FLIPBOOK_TRACE__ = [];
    write(ctx, R, t, 450, 120, 40, { cen: true });
    write(ctx, R, 'ab😀c', 10, 180, 24);
    const tr = globalThis.__FLIPBOOK_TRACE__; globalThis.__FLIPBOOK_TRACE__ = undefined;
    const [a, b] = tr;
    return { wide: a.x1 - a.x0, want: measure(t, 40), centreErr: Math.abs((a.x0 + a.x1) / 2 - 450),
             emojiWide: b.x1 - b.x0, emojiWant: measure('ab😀c', 24) };
  })()`);
  assert.ok(Math.abs(out.wide - out.want) < 1e-6, `width ${out.wide} vs measure ${out.want}`);
  assert.ok(out.centreErr < 1e-6, `centre off by ${out.centreErr}`);
  assert.ok(Math.abs(out.emojiWide - out.emojiWant) < 1e-6, `astral width ${out.emojiWide} vs ${out.emojiWant}`);
});

test('a question mark reads as one at every size: hook, gap, dot', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const { write, stream } = Flipbook, T = globalThis.TH, res = {};
    for (const sz of [10, 14, 18, 24, 40, 74]) {
      const c = T.canvas(300, 300), ctx = c.getContext('2d'), x = 40, y = 250;
      write(ctx, stream(11), '?', x, y, sz, { col: [0, 0, 0], a: 1 });
      const D = T.pixels(c), W = c.width;
      const cx = Math.round(x + 0.25 * sz), dy = Math.round(y - 0.06 * sz);
      let dot = 0, hook = 0, gap = 0;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) dot = Math.max(dot, T.alpha(D, W, cx + i, dy + j));
      for (let yy = Math.round(y - 0.9 * sz); yy <= Math.round(y - 0.5 * sz); yy++)
        for (let xx = x; xx <= x + 0.5 * sz; xx++) hook += T.alpha(D, W, Math.round(xx), yy);
      const gy = Math.round(y - 0.2 * sz);
      for (let i = -1; i <= 1; i++) gap = Math.max(gap, T.alpha(D, W, cx, gy + i));
      res[sz] = { dot, hook, gap };
    }
    return res;
  })()`);
  for (const [sz, r] of Object.entries(out)) {
    assert.ok(r.dot >= 100, `size ${sz}: dot missing (max alpha ${r.dot})`);
    assert.ok(r.hook > 0, `size ${sz}: hook missing`);
    if (Number(sz) >= 18) assert.ok(r.gap < 40, `size ${sz}: dot merged with hook (gap alpha ${r.gap})`);
  }
});

test('full stops and exclamation dots show at phone and poster sizes', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const { write, stream } = Flipbook, T = globalThis.TH, res = {};
    for (const ch of ['.', '!', ':', 'i', '¡']) for (const sz of [10, 24, 74]) {
      const c = T.canvas(200, 200), ctx = c.getContext('2d'), x = 40, y = 170;
      write(ctx, stream(5), ch, x, y, sz, { col: [0, 0, 0], a: 1 });
      let best = 0;
      const D = T.pixels(c);
      for (let k = 3; k < D.length; k += 4) if (D[k] > best) best = D[k];
      res[ch + sz] = best;
    }
    return res;
  })()`);
  for (const [k, v] of Object.entries(out)) assert.ok(v >= 100, `${k}: no ink (max alpha ${v})`);
});

// --- dry media: cache, translation, cold start ---

test('fill cache: a hit returns the pixels a fresh computation gives', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const T = globalThis.TH, F = Flipbook, pts = F.rrect(120, 120, 300, 260, 14), P = F.PALETTES.PENCIL;
    const opt = { fill: P.sky, shadow: [6, 7], angle: 0.7, pressure: 0.7, w: 2.6 };
    const draw = () => { const c = T.canvas(400, 400); F.drawObject(T.frameFor(c.getContext('2d')), 'card', pts, opt); return c; };
    F.clearDryCache();
    const miss = draw(), afterMiss = F.dryCacheSize();
    const hit = draw(), afterHit = F.dryCacheSize();
    F.clearDryCache();
    const fresh = draw();
    return { same: T.hash(miss) === T.hash(hit), freshSame: T.hash(miss) === T.hash(fresh), afterMiss, afterHit, drawn: T.mismatches(miss, 0, 0, hit, 0, 0, 400, 400) };
  })()`);
  assert.ok(out.afterMiss >= 2, `expected a fill and a shadow in the cache, got ${out.afterMiss}`);
  assert.equal(out.afterHit, out.afterMiss, 'second draw added entries, so it was not a hit');
  assert.equal(out.drawn, 0, `${out.drawn} pixels differ between miss and hit`);
  assert.equal(out.freshSame, true, 'cache hit differs from a fresh computation');
});

test('translation reuse: a shape drawn at x+37, y+23 is the same look shifted', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const T = globalThis.TH, F = Flipbook, P = F.PALETTES.PENCIL;
    const base = F.rrect(120, 120, 300, 260, 14), moved = base.map(([x, y]) => [x + 37, y + 23]);
    const opt = { fill: P.moss, shadow: [6, 7], angle: 0.4, pressure: 0.66, w: 2.6 };
    F.clearDryCache();
    const a = T.canvas(400, 400), b = T.canvas(400, 400);
    F.drawObject(T.frameFor(a.getContext('2d')), 'leaf', base, opt);
    const size = F.dryCacheSize();
    F.drawObject(T.frameFor(b.getContext('2d')), 'leaf', moved, opt);
    // the moved draw must come from the cache, and the whole window must match shifted by (37, 23)
    return { reused: F.dryCacheSize() === size, n: T.mismatches(a, 90, 90, b, 127, 113, 230, 200), mass: T.hash(a) !== T.hash(T.canvas(400, 400)) };
  })()`);
  assert.equal(out.reused, true, 'moved shape did not reuse the cached marks');
  assert.equal(out.mass, true, 'test drew nothing');
  assert.equal(out.n, 0, `${out.n} pixels differ after the shift`);
});

const SCENE = (engineUrl) => `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0"><canvas id="c"></canvas>
<script src="${engineUrl}"></script>
<script>
  const P = Flipbook.PALETTES.PENCIL;
  const scene = f => {
    const { ctx, R } = f;
    f.paper();
    Flipbook.drawObject(f, 'table', [[70, 880], [1010, 880], [1010, 912], [70, 912]], { fill: P.kraft, pressure: 0.62, w: 2 });
    const pot = [[200, 712], [400, 712], [384, 842], [366, 880], [234, 880], [216, 842]];
    Flipbook.drawObject(f, 'pot', pot, { fill: P.kraft, shadow: [7, 8], angle: 0.5, pressure: 0.7 });
    Flipbook.pencilFill(ctx, f.still('pot|s0'), [[286, 716], [396, 716], [382, 842], [364, 878], [290, 878]], Flipbook.shade(P.kraft, 0.12), { angle: 1.1, pressure: 0.34, layers: 1 });
    Flipbook.drawObject(f, 'card', Flipbook.rrect(560, 200, 940, 440, 14), { fill: P.rose, shadow: [8, 9], angle: 0.45, pressure: 0.62 });
    Flipbook.penLine(ctx, R, [[300, 680], [296, 640], [306, 580], [300, 520]], P.moss, { w: 4.2, press: 0.8 });
    Flipbook.write(ctx, R, 'mañana ¿cómo estás?', 600, 330, 52, { col: P.ink, a: 0.9 });
    Flipbook.drawBars(f, [{ label: 'Enero', value: 120 }, { label: 'Febrero', value: 80 }, { label: 'Marzo', value: 150 }], { x: 80, y: 40, w: 600, h: 300 }, { p: 1 });
  };
  window.anim = new Flipbook.Animator(document.getElementById('c'), scene, { width: 1080, height: 1080, frames: 48 });
</script></body></html>`;

const FRAME_HASH = `(() => { const c = document.getElementById('c'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619) >>> 0; return h; })()`;

test('cold start: frame 5 rendered first equals frame 5 after frames 0..4', async () => {
  const file = join(scratch, 'scene.html');
  writeFileSync(file, SCENE(pathToFileURL(ENGINE).href));
  // Cold: the Animator's constructor renders ?frame=5 as its very first draw.
  await chrome.open(pathToFileURL(file).href + '?frame=5');
  const cold = await chrome.evaluate(FRAME_HASH);
  for (let i = 0; i <= 5; i++) await chrome.evaluate(`window.anim.renderFrame(${i})`);
  const coldAfter = await chrome.evaluate(FRAME_HASH);
  // Warm: frame 0 first, then 1..5; the last render is frame 5 again.
  await chrome.open(pathToFileURL(file).href);
  for (let i = 1; i <= 5; i++) await chrome.evaluate(`window.anim.renderFrame(${i})`);
  const warm = await chrome.evaluate(FRAME_HASH);
  assert.equal(cold, coldAfter, 'frame 5 changed after rendering 0..5 on a cold page');
  assert.equal(cold, warm, 'frame 5 rendered first differs from frame 5 after 0..4');
});

// --- bars: label floor, two lines, no truncation, horizontal fallback ---

test('bars: labels stay at 31 px or more, wrap to two lines, nothing is cut, long labels go horizontal', async () => {
  await freshPage();
  const run = async (rows, box) => chrome.evaluate(`(() => {
    const F = Flipbook, c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
    const f = globalThis.TH.frameFor(c.getContext('2d'));
    globalThis.__FLIPBOOK_TRACE__ = [];
    F.drawBars(f, ${JSON.stringify(rows)}, ${JSON.stringify(box)}, { p: 1 });
    const tr = globalThis.__FLIPBOOK_TRACE__; globalThis.__FLIPBOOK_TRACE__ = undefined;
    return tr.filter(e => e.kind === 'text').map(e => ({ text: e.text, sz: e.sz, x0: e.x0, y0: e.y0 }));
  })()`);
  const isNumber = t => /^[\d.,]+$/.test(t);
  const check = (rows, texts) => {
    const pieces = texts.filter(e => !isNumber(e.text));
    let p = 0;
    for (const r of rows) {
      const lines = [];
      while (lines.join(' ') !== r.label && p < pieces.length) lines.push(pieces[p++].text);
      assert.equal(lines.join(' '), r.label, `label "${r.label}" was cut or reordered`);
      assert.ok(lines.length <= 2, `label "${r.label}" wraps to ${lines.length} lines`);
    }
    for (const e of texts) assert.ok(e.sz >= 31, `text "${e.text}" at ${e.sz} px is below 31 px`);
    return pieces;
  };

  const shortRows = [{ label: 'Enero', value: 1200 }, { label: 'Febrero', value: 900 }, { label: 'Marzo mayo', value: 1500 }, { label: 'Abril', value: 700 }];
  const tv = await run(shortRows, { x: 0, y: 0, w: 1080, h: 600 });
  check(shortRows, tv);
  const colX = new Set(tv.filter(e => !isNumber(e.text)).map(e => e.x0));
  assert.ok(colX.size > 1, 'short labels should sit in columns');

  const longRows = [
    { label: 'Ingresos por venta de suscripciones anuales en tiendas físicas', value: 900 },
    { label: 'Gastos operativos generales del trimestre', value: 400 },
    { label: 'Utilidad', value: 500 }];
  const th = await run(longRows, { x: 0, y: 0, w: 1080, h: 600 });
  check(longRows, th);
  const rowX = new Set(th.filter(e => !isNumber(e.text)).map(e => e.x0));
  assert.equal(rowX.size, 1, 'long labels should switch to a horizontal layout with a left column');

  // a word that cannot fit in any column is an error, not a silent overlap or a cut label
  const impossible = await chrome.evaluate(`(() => {
    const F = Flipbook, c = document.createElement('canvas'); c.width = 1080; c.height = 600;
    try { F.drawBars(globalThis.TH.frameFor(c.getContext('2d')), [{ label: 'x'.repeat(200), value: 1 }, { label: 'b', value: 2 }], { x: 0, y: 0, w: 1080, h: 600 }); return 'no error'; }
    catch (e) { return String(e.message); }
  })()`);
  assert.match(impossible, /does not fit in two lines/);
});

test('bars: same inputs, same pixels; funnel writes its step percent through write()', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const F = Flipbook, T = globalThis.TH, rows = [{ label: 'Visitas', value: 1000 }, { label: 'Carrito', value: 500 }, { label: 'Pagos', value: 120 }];
    const draw = () => { const c = T.canvas(1080, 600), f = T.frameFor(c.getContext('2d')); F.drawBars(f, rows, { x: 0, y: 0, w: 1080, h: 600 }, { p: 0.8 }); return c; };
    const a = draw(), b = draw();
    globalThis.__FLIPBOOK_TRACE__ = [];
    const c = T.canvas(1080, 600), f = T.frameFor(c.getContext('2d'));
    F.drawFunnel(f, rows, { x: 0, y: 0, w: 1080, h: 600 }, { p: 1 });
    const texts = globalThis.__FLIPBOOK_TRACE__.filter(e => e.kind === 'text').map(e => e.text);
    globalThis.__FLIPBOOK_TRACE__ = undefined;
    return { same: T.mismatches(a, 0, 0, b, 0, 0, 1080, 600), texts };
  })()`);
  assert.equal(out.same, 0, 'drawBars is not deterministic');
  assert.ok(out.texts.includes('50%') && out.texts.includes('24%'), `funnel percents: ${out.texts.join(' | ')}`);
});

// --- pen: thick-thin and direction ---

test('pen: pressure swells about 2.3:1 along a stroke, and a downward stroke runs heavier than an upward one', async () => {
  await freshPage();
  const out = await chrome.evaluate(`(() => {
    const F = Flipbook, c = document.createElement('canvas'); c.width = 1080; c.height = 1080;
    const ctx = c.getContext('2d'), ink = () => ctx.getImageData(0, 0, 1080, 1080).data;
    ctx.clearRect(0, 0, 1080, 1080);
    const pts = []; for (let x = 60; x <= 1020; x += 6) pts.push([x, 300]);
    F.penLine(ctx, F.stream(9), pts, [0, 0, 0], { w: 2.6, press: 0.7, a: 1 });
    const img = ink(), th = [];
    for (let x = 120; x <= 960; x += 2) { let s = 0; for (let y = 250; y < 350; y++) s += img[(y * 1080 + x) * 4 + 3] / 255; th.push(s); }
    const vert = dir => {
      ctx.clearRect(0, 0, 1080, 1080);
      const v = []; for (let y = 200; y <= 900; y += 5) v.push([540, dir > 0 ? y : 1100 - y]);
      F.penLine(ctx, F.stream(9), v, [0, 0, 0], { w: 2.6, press: 0.7, a: 1 });
      const im = ink(); let sum = 0, n = 0;
      for (let y = 300; y < 800; y += 2) { let s = 0; for (let x = 480; x < 600; x++) s += im[(y * 1080 + x) * 4 + 3] / 255; sum += s; n++; }
      return sum / n;
    };
    return { ratio: Math.max(...th) / Math.min(...th), downUp: vert(1) / vert(-1) };
  })()`);
  assert.ok(out.ratio >= 2.3, `thick-thin ratio ${out.ratio.toFixed(2)} is below 2.3:1`);
  assert.ok(out.downUp >= 1.1, `downward/upward weight ${out.downUp.toFixed(3)} is below 1.1`);
});
