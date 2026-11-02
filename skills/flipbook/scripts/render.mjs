#!/usr/bin/env node
// Renders a flipbook scene. Frames stream from Chrome into ffmpeg one PNG at a time, with backpressure.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from './lib/chrome.mjs';

const PRESETS = { '16:9': [1920, 1080], '1:1': [1080, 1080], '9:16': [1080, 1920] };
const OUTPUTS = ['mp4', 'webm', 'gif', 'png', 'html', 'sheet', 'onion', 'whatsapp', 'sticker'];
const WHATSAPP_MAX = 16_000_000; // bytes
const STICKER_MAX = 500_000; // bytes
const STICKER_PX = 512;
const STICKER_MIN_FRAMES = 12, STICKER_MIN_FPS = 2; // below these a sticker stops reading as motion
const SHEET = { count: 12, cols: 4, tile: 480 };
const EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p';
// Frames come only from renderFrame: a free-running rAF loop would advance the scene behind our back.
const HOOK = 'window.requestAnimationFrame = () => 0;';
const USAGE = `usage: render.mjs scene.html [--out dir] [--format 16:9|1:1|9:16|all|WxH] [--material name|all]
                 [--seed n] [--fast] [--frames a-b] [--loops n] [--audio file]
                 [--mp4] [--webm] [--gif] [--png] [--html] [--sheet] [--onion] [--whatsapp] [--sticker]
default outputs when none is given: --mp4 --sheet`;

const procs = new Set();
process.on('exit', () => { for (const p of procs) p.kill('SIGKILL'); });

const fmtBytes = n => (n > 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} KB`);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const ffBin = () => (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
const FF_BASE = ['-hide_banner', '-loglevel', 'error', '-y'];

// Expression helper: serialises a self-contained page function with JSON arguments.
const call = (fn, ...args) => `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(', ')})`;

function parseArgs(argv) {
  const o = { scene: null, out: null, format: null, material: null, seed: null, audio: null, loops: 1, frames: null, fast: false, outputs: new Set(), help: false };
  const takes = { '--out': 'out', '--format': 'format', '--material': 'material', '--seed': 'seed', '--audio': 'audio', '--loops': 'loops', '--frames': 'frames' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--fast') o.fast = true;
    else if (takes[a]) {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      o[takes[a]] = argv[++i];
    } else if (a.startsWith('--') && OUTPUTS.includes(a.slice(2))) o.outputs.add(a.slice(2));
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}\n${USAGE}`);
    else if (o.scene === null) o.scene = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (o.help) return o;
  if (!o.scene) throw new Error(`missing scene.html\n${USAGE}`);
  if (o.outputs.size === 0) { o.outputs.add('mp4'); o.outputs.add('sheet'); }
  if (o.format && o.format !== 'all' && !PRESETS[o.format] && !/^\d+x\d+$/.test(o.format)) throw new Error(`bad --format ${o.format}`);
  o.loops = Number(o.loops);
  if (!Number.isInteger(o.loops) || o.loops < 1) throw new Error('--loops must be a whole number, 1 or more');
  if (o.seed !== null && !/^-?\d+$/.test(o.seed)) throw new Error('--seed must be a whole number');
  if (o.frames !== null) {
    const m = o.frames.match(/^(\d+)-(\d+)$/);
    if (!m || Number(m[1]) > Number(m[2])) throw new Error('--frames must look like 0-11');
    o.frames = [Number(m[1]), Number(m[2])];
  }
  return o;
}

function paramsFor(values) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p;
}

async function openScene(chrome, url, params) {
  const q = params.toString();
  await chrome.open(q ? `${url}?${q}` : url, { viewport: { width: 1280, height: 900 }, beforeLoad: HOOK });
  const info = await chrome.evaluate(`(() => {
    if (!window.anim) throw new Error('scene does not set window.anim');
    anim.pause();
    return {
      width: anim.width, height: anim.height, fps: anim.fps, total: anim.totalFrames, rest: anim.restFrame,
      loop: anim.loop, materials: Object.keys((window.Flipbook && Flipbook.MATERIALS) || {})
    };
  })()`);
  if (chrome.errors.length) throw new Error(`scene reported errors:\n  ${chrome.errors.join('\n  ')}`);
  return info;
}

// --- ffmpeg -----------------------------------------------------------------

function ffmpegRun(args, label) {
  return new Promise((res, rej) => {
    const p = spawn(ffBin(), [...FF_BASE, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    procs.add(p);
    let err = '';
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('close', code => { procs.delete(p); code === 0 ? res() : rej(new Error(`${label}: ffmpeg exited ${code}: ${err.trim()}`)); });
  });
}

// Writes PNG frames to a running ffmpeg. write() waits for drain, so memory holds one frame in flight.
function pipeSink(args, label) {
  const p = spawn(ffBin(), [...FF_BASE, ...args], { stdio: ['pipe', 'ignore', 'pipe'] });
  procs.add(p);
  let err = '';
  p.stderr.on('data', d => { err = (err + d).slice(-2000); });
  p.stdin.on('error', () => {}); // the close handler below reports the real reason
  const done = new Promise((res, rej) => p.on('close', code => {
    procs.delete(p);
    code === 0 ? res() : rej(new Error(`${label}: ffmpeg exited ${code}: ${err.trim()}`));
  }));
  done.catch(() => {});
  return {
    async write(buf) {
      if (p.stdin.write(buf)) return;
      await Promise.race([once(p.stdin, 'drain'), done]).catch(async e => { await done; throw e; });
    },
    async end() { p.stdin.end(); await done; }
  };
}

// Writes numbered PNGs to a directory: the source for two-pass GIF and for WhatsApp retries.
function dirSink(dir) {
  let k = 0;
  return { write: buf => writeFile(join(dir, `${String(k++).padStart(6, '0')}.png`), buf), end: async () => {} };
}

const pipeIn = fps => ['-f', 'image2pipe', '-c:v', 'png', '-framerate', String(fps), '-i', '-'];
const seqIn = (dir, fps) => ['-framerate', String(fps), '-start_number', '0', '-i', join(dir, '%06d.png')];
const audioIn = audio => (audio ? ['-i', audio] : []);
const mapArgs = audio => (audio ? ['-map', '0:v:0', '-map', '1:a:0', '-shortest'] : ['-map', '0:v:0']);
const audioOut = (audio, codec) => (audio ? ['-c:a', codec, '-b:a', '160k'] : []);

const mp4Args = (fps, out, audio) => [
  ...pipeIn(fps), ...audioIn(audio), ...mapArgs(audio), '-vf', EVEN, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps), ...audioOut(audio, 'aac'), out
];
const webmArgs = (fps, out, audio) => [
  ...pipeIn(fps), ...audioIn(audio), ...mapArgs(audio), '-vf', EVEN, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34',
  '-cpu-used', '4', '-pix_fmt', 'yuv420p', '-r', String(fps), ...audioOut(audio, 'libopus'), out
];

async function makeGif(dir, fps, out) {
  const pal = join(dir, 'palette.png');
  await ffmpegRun([...seqIn(dir, fps), '-vf', 'palettegen=stats_mode=full', pal], 'gif palette');
  await ffmpegRun([...seqIn(dir, fps), '-i', pal, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=5', '-r', String(fps), out], 'gif');
  return out;
}

async function makeWhatsapp(dir, fps, audio, out) {
  let crf = 0, size = 0;
  for (crf of [20, 24, 28, 32, 36]) {
    await ffmpegRun([
      ...seqIn(dir, fps), ...audioIn(audio), ...mapArgs(audio), '-vf', EVEN, '-c:v', 'libx264', '-preset', 'slow',
      '-crf', String(crf), '-profile:v', 'high', '-movflags', '+faststart', '-r', String(fps), ...audioOut(audio, 'aac'), out
    ], 'whatsapp');
    size = statSync(out).size;
    if (size <= WHATSAPP_MAX) break;
  }
  if (size > WHATSAPP_MAX) throw new Error(`whatsapp: still ${fmtBytes(size)} at crf 36. Shorten the loop or render with --fast.`);
  console.log(`whatsapp: crf ${crf}, ${fmtBytes(size)} (limit 16 MB)`);
  return out;
}

// --- animated WebP for stickers ----------------------------------------------

function chunk(id, data) {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat(data.length % 2 ? [head, data, Buffer.alloc(1)] : [head, data]);
}
const u24 = n => { const b = Buffer.alloc(3); b.writeUIntLE(n, 0, 3); return b; };

// ALPH and VP8/VP8L payload chunks of one still WebP, in order. VP8X and RIFF headers are dropped.
function imageChunks(webp) {
  const parts = [];
  let p = 12;
  while (p + 8 <= webp.length) {
    const id = webp.toString('latin1', p, p + 4), size = webp.readUInt32LE(p + 4), end = p + 8 + size + (size % 2);
    if (['ALPH', 'VP8 ', 'VP8L'].includes(id)) parts.push(webp.subarray(p, end));
    p = end;
  }
  return Buffer.concat(parts);
}

// frames: [{ webp: Buffer (still WebP from Chrome), ms }]. VP8X flags 0x12 = alpha + animation.
// ANMF flags 0x02 = do not blend, so each frame replaces the canvas instead of compositing over it.
function muxWebp(frames, w, h) {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x12;
  u24(w - 1).copy(vp8x, 4);
  u24(h - 1).copy(vp8x, 7);
  const anmf = frames.map(f => chunk('ANMF', Buffer.concat([
    u24(0), u24(0), u24(w - 1), u24(h - 1), u24(f.ms), Buffer.from([0x02]), imageChunks(f.webp)
  ])));
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', vp8x), chunk('ANIM', Buffer.alloc(6)), ...anmf]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// --- page-side functions (serialised with toString; no closures over Node scope) ---

function pageSheet(cells, tile, cols) {
  const anim = window.anim, src = anim.canvas;
  const th = Math.round(tile * src.height / src.width), rows = Math.ceil(cells.length / cols);
  const out = document.createElement('canvas');
  out.width = cols * tile;
  out.height = rows * th;
  const g = out.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, out.width, out.height);
  cells.forEach((c, k) => {
    if (c.material) anim.setMaterial(c.material);
    anim.renderFrame(c.frame);
    g.drawImage(src, (k % cols) * tile, Math.floor(k / cols) * th, tile, th);
  });
  return out.toDataURL('image/png');
}

// Running mean of one loop: frame k is blended in at alpha 1/(k+1).
function pageOnion(total) {
  const anim = window.anim, src = anim.canvas;
  const acc = document.createElement('canvas');
  acc.width = src.width;
  acc.height = src.height;
  const g = acc.getContext('2d');
  for (let k = 0; k < total; k++) {
    anim.renderFrame(k);
    g.globalAlpha = 1 / (k + 1);
    g.drawImage(src, 0, 0);
  }
  return acc.toDataURL('image/png');
}

function pageWebp(frames, q) {
  const anim = window.anim;
  return frames.map(f => {
    anim.renderFrame(f);
    return anim.canvas.toDataURL('image/webp', q).split(',')[1];
  });
}

// --- output helpers -----------------------------------------------------------

function writeDataUrl(file, dataUrl) {
  writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  return file;
}

function sheetFrames(total) {
  const n = Math.min(SHEET.count, total);
  return Array.from({ length: n }, (_, k) => Math.floor((k * total) / n));
}

function frameList(total, range, loops) {
  const [a, b] = range ?? [0, total - 1];
  if (b >= total) throw new Error(`--frames ${a}-${b} is past the last frame ${total - 1}`);
  const one = [];
  for (let i = a; i <= b; i++) one.push(i);
  return Array.from({ length: loops }, () => one).flat();
}

function sizeOf(format) {
  return PRESETS[format] ?? format.split('x').map(Number);
}

// Inlines every local <script src> (the engine included) so the file runs by double click.
function inlineScripts(html, sceneDir) {
  return html.replace(/<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script\s*>/gi, (all, pre, _q, src, post) => {
    if (/^(https?:|data:|\/\/)/i.test(src)) return all;
    const code = readFileSync(resolve(sceneDir, src.split(/[?#]/)[0]), 'utf8')
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<\\!--');
    const attrs = `${pre} ${post}`.trim();
    return `<script${attrs ? ` ${attrs}` : ''}>\n${code}\n</script>`;
  });
}

async function writeHtml(chrome, scene, base, outDir) {
  const out = join(outDir, `${base}.html`);
  writeFileSync(out, inlineScripts(readFileSync(scene, 'utf8'), dirname(scene)));
  await chrome.open(pathToFileURL(out).href, { viewport: { width: 1280, height: 900 }, beforeLoad: HOOK });
  const kind = await chrome.evaluate('typeof window.anim');
  if (kind !== 'object') throw new Error(`${out}: window.anim is ${kind} after opening the file`);
  if (chrome.errors.length) throw new Error(`${out} reported errors:\n  ${chrome.errors.join('\n  ')}`);
  console.log(`html: opened ${out} by file URL, window.anim is an object`);
  return out;
}

// --- passes -------------------------------------------------------------------

async function streamFrames(chrome, info, o, outDir, stem) {
  const fps = info.fps, list = frameList(info.total, o.frames, o.loops);
  const audio = o.audio ? resolve(o.audio) : null;
  const dir = o.outputs.has('gif') || o.outputs.has('whatsapp') ? mkdtempSync(join(tmpdir(), 'flipbook-seq-')) : null;
  const sinks = [], files = [];
  try {
    if (o.outputs.has('mp4')) {
      const f = join(outDir, `${stem}.mp4`);
      sinks.push(pipeSink(mp4Args(fps, f, audio), 'mp4'));
      files.push(f);
    }
    if (o.outputs.has('webm')) {
      const f = join(outDir, `${stem}.webm`);
      sinks.push(pipeSink(webmArgs(fps, f, audio), 'webm'));
      files.push(f);
    }
    if (dir) sinks.push(dirSink(dir));
    const times = [];
    for (const i of list) {
      const r = await chrome.evaluate(`(() => {
        const t0 = performance.now();
        anim.renderFrame(${i});
        const ms = performance.now() - t0;
        return { ms, png: anim.canvas.toDataURL('image/png') };
      })()`);
      times.push(r.ms);
      const buf = Buffer.from(r.png.slice(r.png.indexOf(',') + 1), 'base64');
      for (const s of sinks) await s.write(buf);
    }
    for (const s of sinks) await s.end();
    if (o.outputs.has('gif')) files.push(await makeGif(dir, fps, join(outDir, `${stem}.gif`)));
    if (o.outputs.has('whatsapp')) files.push(await makeWhatsapp(dir, fps, audio, join(outDir, `${stem}-whatsapp.mp4`)));
    console.log(`frames ${list.length}: render median ${pct(times, 0.5).toFixed(1)} ms, p95 ${pct(times, 0.95).toFixed(1)} ms`);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  return files;
}

async function renderPass(chrome, url, o, base, outDir, m, f, base0) {
  const size = f ? sizeOf(f) : null;
  const sized = o.fast ? (size ?? [base0.width, base0.height]).map(v => Math.round(v / 2)) : size;
  const stem = [base, m, f && f.replace(':', 'x'), o.fast && 'fast'].filter(Boolean).join('-');
  const info = await openScene(chrome, url, paramsFor({ w: sized?.[0], h: sized?.[1], material: m, seed: o.seed }));
  const files = [];
  if ([...o.outputs].some(k => ['mp4', 'webm', 'gif', 'whatsapp'].includes(k))) files.push(...await streamFrames(chrome, info, o, outDir, stem));
  if (o.outputs.has('png')) {
    const data = await chrome.evaluate(`(() => { anim.renderFrame(${info.rest}); return anim.canvas.toDataURL('image/png'); })()`);
    files.push(writeDataUrl(join(outDir, `${stem}.png`), data));
  }
  if (o.outputs.has('sheet')) {
    const cells = sheetFrames(info.total).map(frame => ({ frame, material: null }));
    files.push(writeDataUrl(join(outDir, `${stem}-sheet.png`), await chrome.evaluate(call(pageSheet, cells, SHEET.tile, SHEET.cols), { timeoutMs: 300000 })));
  }
  if (o.outputs.has('onion')) {
    files.push(writeDataUrl(join(outDir, `${stem}-onion.png`), await chrome.evaluate(call(pageOnion, info.total), { timeoutMs: 300000 })));
  }
  return files;
}

async function stickerPass(chrome, url, o, base, outDir, m) {
  const info = await openScene(chrome, url, paramsFor({ paper: 'none', simple: 1, w: STICKER_PX, h: STICKER_PX, material: m, seed: o.seed }));
  const out = join(outDir, `${[base, m].filter(Boolean).join('-')}-sticker.webp`);
  let last = null;
  for (const step of [1, 2, 3, 4, 6]) {
    const frames = Math.ceil(info.total / step), fps = info.fps / step;
    if (frames < STICKER_MIN_FRAMES || fps < STICKER_MIN_FPS) continue;
    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      const idx = [];
      for (let i = 0; i < info.total; i += step) idx.push(i);
      const b64 = await chrome.evaluate(call(pageWebp, idx, q), { timeoutMs: 600000 });
      const ms = Math.round(1000 / info.fps) * step;
      const bytes = muxWebp(b64.map(s => ({ webp: Buffer.from(s, 'base64'), ms })), STICKER_PX, STICKER_PX);
      last = { q, step, frames: idx.length, size: bytes.length };
      if (bytes.length <= STICKER_MAX) {
        writeFileSync(out, bytes);
        console.log(`sticker: quality ${q}, every ${step} frame(s), ${idx.length} frames at ${fps.toFixed(1)} fps, ${fmtBytes(bytes.length)}`);
        return out;
      }
    }
  }
  if (!last) throw new Error(`sticker: ${info.total} frames at ${info.fps} fps leave no step with at least ${STICKER_MIN_FRAMES} frames and ${STICKER_MIN_FPS} fps.`);
  throw new Error(`sticker: smallest attempt ${fmtBytes(last.size)} (quality ${last.q}, step ${last.step}) is over 500 KB. Simplify the scene.`);
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help) return console.log(USAGE);
  const scene = resolve(o.scene);
  if (!existsSync(scene)) throw new Error(`no such scene: ${o.scene}`);
  if (o.audio && !existsSync(o.audio)) throw new Error(`no such audio file: ${o.audio}`);
  const base = basename(scene).replace(/\.html?$/i, '');
  const outDir = o.out ? resolve(o.out) : join(dirname(scene), 'out', base);
  mkdirSync(outDir, { recursive: true });
  const url = pathToFileURL(scene).href;
  const written = [];
  const chrome = await launchChrome();
  try {
    const base0 = await openScene(chrome, url, paramsFor({ seed: o.seed }));
    const names = base0.materials;
    const materials = o.material === null ? [null] : o.material === 'all' ? names : [o.material];
    if (o.material && o.material !== 'all' && !names.includes(o.material)) {
      throw new Error(`unknown material "${o.material}". Known: ${names.join(', ')}`);
    }
    const formats = o.format === 'all' ? Object.keys(PRESETS) : [o.format];
    if (o.outputs.has('html')) written.push(await writeHtml(chrome, scene, base, outDir));
    const needsPass = ['mp4', 'webm', 'gif', 'whatsapp', 'png', 'sheet', 'onion'].some(k => o.outputs.has(k));
    for (const m of materials) {
      for (const f of needsPass ? formats : []) written.push(...await renderPass(chrome, url, o, base, outDir, m, f, base0));
    }
    if (o.outputs.has('sticker')) for (const m of materials) written.push(await stickerPass(chrome, url, o, base, outDir, m));
    if (o.material === 'all' && o.outputs.has('sheet')) {
      const size = formats[0] ? sizeOf(formats[0]) : null;
      const info = await openScene(chrome, url, paramsFor({ w: size?.[0], h: size?.[1], seed: o.seed }));
      const cells = names.map(material => ({ frame: info.rest, material }));
      written.push(writeDataUrl(join(outDir, 'materials.png'), await chrome.evaluate(call(pageSheet, cells, SHEET.tile, SHEET.cols), { timeoutMs: 300000 })));
      console.log(`materials.png order (left to right, top to bottom): ${names.join(', ')}`);
    }
  } finally {
    await chrome.close();
  }
  for (const f of written) console.log(`${f}  ${fmtBytes(statSync(f).size)}`);
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  e => { console.error(`render: ${e.message}`); process.exit(1); }
);
