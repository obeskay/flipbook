#!/usr/bin/env node
// Runs a scene in Chrome and judges its pixels and trace: determinism, blank frames, paper boil, loop seam,
// render budget, text placement (again at half size, as FB115), beats and probes. One line per finding;
// exit 1 on any error.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from './lib/chrome.mjs';

const PRESETS = { '16:9': [1920, 1080], '1:1': [1080, 1080], '9:16': [1080, 1920] };
const SEVERITY = {
  FB101: 'error', FB102: 'error', FB103: 'error', FB104: 'error', FB105: 'warn', FB106: 'error', FB107: 'warn',
  FB108: 'error', FB109: 'error', FB110: 'warn', FB111: 'error', FB112: 'error', FB113: 'error', FB114: 'warn',
  FB115: 'error', FB116: 'error'
};
const MAX_SAMPLES = 120;
const PHONE_PX = 390; // text is judged as if the canvas is shown this wide
const USAGE = 'usage: check.mjs scene.html [--format all|16:9|1:1|9:16] [--json]';

// Installed before any scene script. Records the trace, stops free-running playback, and wraps the engine
// Animator so its options are readable as anim.options (for camera:true).
const HOOK = `
window.__FLIPBOOK_TRACE__ = [];
window.requestAnimationFrame = () => 0;
(function () {
  let engine;
  Object.defineProperty(window, 'Flipbook', {
    configurable: true,
    get() { return engine; },
    set(v) {
      engine = v;
      if (!v || typeof v.Animator !== 'function') return;
      const Base = v.Animator;
      v.Animator = class extends Base {
        constructor(canvas, render, options) { super(canvas, render, options); this.options = options || {}; }
      };
    }
  });
})();`;

const INFO = `(() => {
  if (!window.anim) throw new Error('scene does not set window.anim');
  const a = window.anim;
  a.pause();
  return {
    total: a.totalFrames, fps: a.fps, rest: a.restFrame, loop: !!a.loop, width: a.width, height: a.height,
    camera: !!(a.options && a.options.camera === true)
  };
})()`;

const call = (fn, ...args) => `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(', ')})`;

// --- page-side functions. Serialised with toString, so they close over nothing. ---

// Renders frames in the given order. Each frame becomes a half-size FNV hash of its raw pixels.
// With stats: mode colour share and ink for the rest frame, the change between consecutive frames
// (ascending pairs), and the change between the first and last frame (the loop seam).
function pageSnap(order, o) {
  const anim = window.anim, src = anim.canvas, N = anim.totalFrames;
  const hw = Math.max(1, src.width >> 1), hh = Math.max(1, src.height >> 1);
  const scratch = document.createElement('canvas');
  scratch.width = hw;
  scratch.height = hh;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  const grab = () => {
    g.clearRect(0, 0, hw, hh);
    g.drawImage(src, 0, 0, hw, hh);
    return g.getImageData(0, 0, hw, hh).data;
  };
  const fnv = px => {
    const u = new Uint32Array(px.buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
    return h >>> 0;
  };
  const changed = (a, b) => {
    let n = 0;
    for (let p = 0; p < a.length; p += 4) {
      if (Math.abs(a[p] - b[p]) > 10 || Math.abs(a[p + 1] - b[p + 1]) > 10 ||
          Math.abs(a[p + 2] - b[p + 2]) > 10 || Math.abs(a[p + 3] - b[p + 3]) > 10) n++;
    }
    return n / (a.length / 4);
  };
  const mode = px => {
    const u = new Uint32Array(px.buffer), counts = new Map();
    for (let i = 0; i < u.length; i += 16) counts.set(u[i], (counts.get(u[i]) || 0) + 1);
    let best = u[0], top = -1;
    for (const [k, v] of counts) if (v > top) { best = k; top = v; }
    let same = 0;
    for (let i = 0; i < u.length; i++) if (u[i] === best) same++;
    const at = u.indexOf(best) * 4;
    return { frac: same / u.length, base: [px[at], px[at + 1], px[at + 2], px[at + 3]] };
  };
  const ink = (px, base) => {
    let n = 0;
    for (let p = 0; p < px.length; p += 4) {
      if (Math.abs(px[p] - base[0]) > 40 || Math.abs(px[p + 1] - base[1]) > 40 ||
          Math.abs(px[p + 2] - base[2]) > 40 || Math.abs(px[p + 3] - base[3]) > 40) n++;
    }
    return n / (px.length / 4);
  };
  const out = { hashes: [], modes: [], pairs: [], ink: null, seam: null };
  let prev = null, prevI = -2, first = null, last = null;
  for (const i of order) {
    if (o.clear && anim._cels) anim._cels.clear();
    anim.renderFrame(i);
    const px = grab();
    out.hashes.push(fnv(px));
    if (o.stats) {
      const m = mode(px);
      out.modes.push(m.frac);
      if (i === o.rest) out.ink = ink(px, m.base);
      if (prev && i === prevI + 1) out.pairs.push({ a: prevI, changed: changed(prev, px) });
    }
    if (i === 0) first = px;
    if (i === N - 1) last = px;
    prev = px;
    prevI = i;
  }
  if (o.seam && first && last && N > 1) out.seam = changed(first, last);
  return out;
}

function pageTime(order) {
  const anim = window.anim;
  return order.map(i => {
    const t0 = performance.now();
    anim.renderFrame(i);
    return performance.now() - t0;
  });
}

// Beat reading time: the engine's readingFrames when present, else the same formula.
function pageReading(texts, fps) {
  const rf = window.Flipbook && window.Flipbook.readingFrames;
  return texts.map(t => (rf ? rf(t, fps) : Math.ceil(fps * (0.6 + t.trim().split(/\s+/).filter(Boolean).length / 2.6))));
}

// --- analysis helpers ---------------------------------------------------------

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const sortNum = xs => [...xs].sort((a, b) => a - b);
const percentile = (xs, p) => { const s = sortNum(xs); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };

// Every frame when the scene has at most 120; otherwise 120 evenly spaced consecutive pairs, plus the rest frame.
function sampleFrames(total, rest) {
  if (total <= MAX_SAMPLES) return Array.from({ length: total }, (_, i) => i);
  const set = new Set([0, total - 1, rest]);
  for (let k = 0; k < MAX_SAMPLES; k++) {
    const a = Math.floor((k * total) / MAX_SAMPLES);
    set.add(a);
    if (a + 1 < total) set.add(a + 1);
  }
  return [...set].sort((a, b) => a - b);
}

// Deterministic shuffle so a failure reproduces.
function shuffled(xs, seed) {
  const a = xs.slice();
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Trace entries are recorded once per draw, so the same record can appear more than once.
function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter(x => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Text boxes from a trace, one per distinct draw.
const textsOf = trace => uniqueBy(trace.filter(e => e.kind === 'text'), e => `${e.frame}|${e.text}|${e.x0}|${e.y0}|${e.x1}|${e.y1}`);

// FB108 and FB109: where the text sits on a W x H canvas. Run at full size, and again at half size as FB115.
function placementChecks(texts, W, H, add) {
  const box = e => `x ${e.x0.toFixed(0)} to ${e.x1.toFixed(0)}, y ${e.y0.toFixed(0)} to ${e.y1.toFixed(0)}`;

  const offCanvas = uniqueBy(texts.filter(e => e.x0 < -0.5 || e.y0 < -0.5 || e.x1 > W + 0.5 || e.y1 > H + 0.5), e => e.text);
  for (const e of offCanvas) {
    add('FB108', `"${e.text}" runs off the canvas (frame ${e.frame}, ${box(e)}, canvas ${W}x${H}). Wrap it, shorten it, or move it inside.`);
  }

  const byFrame = new Map();
  for (const e of texts) byFrame.set(e.frame, [...(byFrame.get(e.frame) ?? []), e]);
  const reported = new Set();
  for (const [frame, list] of byFrame) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.text === b.text && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1) continue;
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const key = [a.text, b.text].sort().join('|');
        if (ox > 1 && oy > 1 && !reported.has(key)) {
          reported.add(key);
          add('FB109', `"${a.text}" and "${b.text}" overlap (frame ${frame}). Move one of them, or give them room.`);
        }
      }
    }
  }
}

async function traceChecks(chrome, info, S, trace, add) {
  const N = info.total, W = info.width, H = info.height;
  const texts = textsOf(trace);
  placementChecks(texts, W, H, add);

  for (const e of uniqueBy(texts.filter(e => e.missing && e.missing.length), e => e.text)) {
    add('FB116', `"${e.text}" has no lettering for ${e.missing.map(c => `"${c}"`).join(', ')}, so those letters draw as blank. Reword with characters from the list in defects.md.`);
  }

  const scale = PHONE_PX / W;
  const small = uniqueBy(texts.filter(e => (e.y1 - e.y0) * scale < 11), e => e.text);
  for (const e of small) {
    add('FB110', `"${e.text}" is ${((e.y1 - e.y0) * scale).toFixed(1)} px tall when the canvas is shown ${PHONE_PX} px wide (minimum 11). Raise its size.`);
  }

  const beats = trace.filter(e => e.kind === 'beat' && e.say);
  if (beats.length) {
    const need = await chrome.evaluate(call(pageReading, beats.map(b => b.say), info.fps));
    beats.forEach((b, k) => {
      if (b.frames < need[k]) {
        add('FB111', `beat "${b.name}" holds ${b.frames} frames (${(b.frames / info.fps).toFixed(1)} s) but its text needs ${need[k]} frames to read. Lengthen the beat or cut the text.`);
      }
    });
  }

  const probes = uniqueBy(trace.filter(e => e.kind === 'probe' && typeof e.value === 'number'), e => `${e.name}|${e.frame}`);
  const byName = new Map();
  for (const p of probes) {
    if (!byName.has(p.name)) byName.set(p.name, new Map());
    byName.get(p.name).set(p.frame, p.value);
  }
  for (const [name, vals] of byName) {
    const all = [...vals.values()];
    const range = Math.max(...all) - Math.min(...all);
    if (!(range > 0)) continue;
    if (!name.endsWith('!')) {
      for (const a of S) {
        const x = vals.get(a), y = vals.get(a + 1);
        if (x === undefined || y === undefined) continue;
        if (Math.abs(y - x) > 0.45 * range) {
          add('FB112', `probe "${name}" jumps from ${x.toFixed(2)} to ${y.toFixed(2)} between frames ${a} and ${a + 1} (limit 45% of its range ${range.toFixed(2)}). Ease it over several frames, or name it "${name}!" if the cut is on purpose.`);
          break;
        }
      }
    }
    if (info.loop && N > 1 && vals.has(0) && vals.has(N - 1)) {
      const v0 = vals.get(0), v1 = vals.get(N - 1);
      if (Math.abs(v0 - v1) > 0.45 * range) {
        add('FB113', `probe "${name}" does not close the loop: frame ${N - 1} is ${v1.toFixed(2)} and frame 0 is ${v0.toFixed(2)}. Make it periodic in f.t (sin, wave) so the last frame leads into the first.`);
      }
    }
  }
}

// seenErrors collects the page errors of each page this format opens (open() clears them).
async function checkFormat(chrome, url, format, seenErrors) {
  const [w, h] = PRESETS[format];
  const out = [];
  const add = (code, message) => out.push({ code, severity: SEVERITY[code], format, message });
  await chrome.open(`${url}?w=${w}&h=${h}`, { viewport: { width: 1280, height: 900 }, beforeLoad: HOOK });
  const info = await chrome.evaluate(INFO);
  const N = info.total, S = sampleFrames(N, info.rest);

  // Only the forward pass records the trace, so each draw appears once per frame.
  await chrome.evaluate('window.__FLIPBOOK_TRACE__ = []');
  const fwd = await chrome.evaluate(call(pageSnap, S, { stats: true, clear: true, seam: info.loop && N > 1, rest: info.rest }), { timeoutMs: 900000 });
  const trace = await chrome.evaluate('window.__FLIPBOOK_TRACE__ || []', { timeoutMs: 120000 });
  const revOrder = [...S].reverse(), shufOrder = shuffled(S, 11);
  const rev = await chrome.evaluate(call(pageSnap, revOrder, {}), { timeoutMs: 900000 });
  const shuf = await chrome.evaluate(call(pageSnap, shufOrder, {}), { timeoutMs: 900000 });
  const times = await chrome.evaluate(call(pageTime, S), { timeoutMs: 900000 });

  const byFrame = (order, hashes) => new Map(order.map((f, k) => [f, hashes[k]]));
  const F = byFrame(S, fwd.hashes), R = byFrame(revOrder, rev.hashes), X = byFrame(shufOrder, shuf.hashes);
  const diverged = S.filter(f => F.get(f) !== R.get(f) || F.get(f) !== X.get(f));
  if (diverged.length) {
    add('FB102', `${diverged.length} frame(s) look different depending on draw order (first: frame ${diverged[0]}). Keep state inside the frame (f.frame, f.t), and key every cel by all it depends on.`);
  }

  const blank = S.filter((f, k) => fwd.modes[k] > 0.997);
  if (blank.length) {
    add('FB103', `${blank.length} of ${S.length} sampled frames are blank (first: frame ${blank[0]}, one colour). Check that render() draws, and that paper comes from f.paper().`);
  }

  if (!info.camera) {
    const worst = fwd.pairs.reduce((a, p) => (p.changed > a.changed ? p : a), { changed: 0, a: -1 });
    if (worst.changed > 0.18) {
      add('FB104', `paper boils: ${pct(worst.changed)} of pixels change between frames ${worst.a} and ${worst.a + 1} (limit 18%). Draw paper with f.paper(), keep f.R for ink only, or set camera:true in the options if the view moves.`);
    }
  }

  if (S.length > 1 && new Set(fwd.hashes).size === 1) {
    add('FB105', 'no two sampled frames differ: the scene is still. Animate something with f.t or f.frame.');
  }

  const steps = sortNum(fwd.pairs.map(p => p.changed));
  const median = steps.length ? steps[Math.floor(steps.length / 2)] : 0;
  if (info.loop && N > 1 && fwd.seam !== null && median > 0.001 && fwd.seam > 2.5 * median) {
    add('FB106', `loop seam: frame ${N - 1} to frame 0 changes ${pct(fwd.seam)} of pixels, ${(fwd.seam / median).toFixed(1)}x the median step (${pct(median)}). Make the motion periodic in f.t, and use a frame count that is a whole number of boil cycles.`);
  }

  const budget = 1000 / info.fps, p95 = percentile(times, 0.95);
  if (p95 > budget) {
    add('FB107', `p95 render ${p95.toFixed(0)} ms is over the ${budget.toFixed(0)} ms budget at ${info.fps} fps. Cache static layers with f.cel, or drop shading.`);
  }

  await traceChecks(chrome, info, S, trace, add);

  // A layout in fixed pixels can pass at full size and break at half. Half size runs the placement checks only.
  const hw = w / 2, hh = h / 2;
  seenErrors.push(...chrome.errors);
  await chrome.open(`${url}?w=${hw}&h=${hh}`, { viewport: { width: 1280, height: 900 }, beforeLoad: HOOK });
  await chrome.evaluate('window.__FLIPBOOK_TRACE__ = []');
  await chrome.evaluate(call(pageSnap, S, { clear: true }), { timeoutMs: 900000 });
  const halfTrace = await chrome.evaluate('window.__FLIPBOOK_TRACE__ || []', { timeoutMs: 120000 });
  placementChecks(textsOf(halfTrace), hw, hh, (code, message) =>
    add('FB115', `at ${hw}x${hh} (half of ${w}x${h}): ${message} Lay out from w, h and unit, not fixed pixels.`));

  if (fwd.ink !== null && fwd.ink < 0.003) {
    add('FB114', `rest frame ${info.rest} has ${pct(fwd.ink, 2)} ink (under 0.3%): as a still it looks blank. Add a line or fill to the rest pose.`);
  }
  const metrics = {
    format, frames: N, sampled: S.length, uniqueHashes: new Set(fwd.hashes).size,
    medianStep: median, seam: fwd.seam, seamRatio: median ? fwd.seam / median : null,
    worstStep: fwd.pairs.reduce((a, p) => Math.max(a, p.changed), 0),
    p95Ms: p95, budgetMs: budget, restInk: fwd.ink,
    steps: fwd.pairs.map(p => +p.changed.toFixed(4))
  };
  return { findings: out, metrics };
}

async function main(argv) {
  const t0 = Date.now();
  const json = argv.includes('--json');
  const rest = argv.filter(a => a !== '--json');
  const fi = rest.indexOf('--format');
  const format = fi >= 0 ? rest[fi + 1] : 'all';
  const files = rest.filter((a, i) => a !== '--format' && (fi < 0 || i !== fi + 1));
  if (files.length !== 1) throw new Error(USAGE);
  if (format !== 'all' && !PRESETS[format]) throw new Error(`--format must be all, 16:9, 1:1 or 9:16 (got ${format})`);
  const scene = resolve(files[0]);
  if (!existsSync(scene)) throw new Error(`no such scene: ${files[0]}`);
  const url = pathToFileURL(scene).href;
  const formats = format === 'all' ? Object.keys(PRESETS) : [format];

  const chrome = await launchChrome();
  const findings = [], metrics = [];
  try {
    for (const f of formats) {
      const seenErrors = [];
      let failure = null;
      try {
        const r = await checkFormat(chrome, url, f, seenErrors);
        findings.push(...r.findings);
        metrics.push(r.metrics);
      } catch (e) {
        failure = e;
      }
      seenErrors.push(...chrome.errors);
      const pageErrors = [...new Set(seenErrors)];
      // The page's own errors come first: they are the cause.
      for (const msg of pageErrors) {
        findings.push({ code: 'FB101', severity: 'error', format: f, message: `the page reported: ${msg}. Fix this first.` });
      }
      // A scene that throws before it sets window.anim fails that way too. The missing window.anim follows from the
      // exception, so after an uncaught exception that message is not printed.
      const cascade = pageErrors.some(m => m.startsWith('uncaught exception')) && /does not set window\.anim/.test(failure?.message ?? '');
      if (failure && !cascade) {
        findings.push({ code: 'FB101', severity: 'error', format: f, message: `the scene could not be run: ${failure.message}` });
      }
    }
  } finally {
    await chrome.close();
  }

  const errors = findings.filter(x => x.severity === 'error').length;
  const warnings = findings.length - errors;
  if (json) {
    console.log(JSON.stringify({ scene: files[0], formats, findings, metrics, errors, warnings, ok: errors === 0 }, null, 2));
  } else {
    for (const x of findings) console.log(`${x.code}  ${x.severity.padEnd(5)}  [${x.format}]  ${x.message}`);
    const sampled = [...new Set(metrics.map(m => m.sampled))].join(', ') || '0';
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`check: ${errors} error(s), ${warnings} warning(s) across ${formats.length} format(s) in ${secs} s, ${sampled} frame(s) sampled per format. ${errors ? 'FAIL' : 'PASS'}`);
  }
  process.exitCode = errors ? 1 : 0;
}

main(process.argv.slice(2)).then(
  () => process.exit(process.exitCode ?? 0),
  e => { console.error(`check: ${e.message}`); process.exit(1); }
);
