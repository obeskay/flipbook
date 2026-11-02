#!/usr/bin/env node
// Static checks on a scene's own scripts (inline and local, never the engine). Comments are blanked before
// matching, and so are string contents unless a rule needs the literal (compositing modes).
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SEVERITY = {
  FB001: 'error', FB002: 'error', FB003: 'error', FB004: 'warn', FB005: 'error', FB006: 'warn',
  FB007: 'error', FB008: 'warn', FB009: 'warn', FB010: 'warn', FB011: 'error', FB012: 'error'
};
const USAGE = 'usage: lint.mjs scene.html [more.html ...] [--json]';

// Same-length copy with comments blanked. With strings=false, string contents are blanked too.
// Newlines survive, so offsets map back to original line numbers.
function blank(src, { strings }) {
  let out = '';
  const n = src.length;
  const keep = ch => (ch === '\n' ? '\n' : ' ');
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') out += keep(src[i++]);
    } else if (c === '/' && d === '*') {
      out += '  ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) out += keep(src[i++]);
      if (i < n) { out += '  '; i += 2; }
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\n' && c !== '`') break; // unterminated quote: stop at the line end
        if (src[i] === '\\' && i + 1 < n) {
          out += strings ? src[i] + src[i + 1] : ' ' + keep(src[i + 1]);
          i += 2;
          continue;
        }
        out += strings ? src[i] : keep(src[i]);
        i++;
      }
      if (i < n && src[i] === c) { out += c; i++; }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const countNl = s => (s.match(/\n/g) || []).length;

function sceneScripts(file, html) {
  const units = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const tagLine = lineOf(html, m.index);
    const module = /\btype\s*=\s*["']?module\b/i.test(attrs);
    // Quoted values may hold spaces; unquoted ones stop at whitespace.
    const srcAttr = attrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    const src = srcAttr ? srcAttr[1] || srcAttr[2] || srcAttr[3] : undefined;
    if (src !== undefined) {
      if (/^(https?:|data:|\/\/)/i.test(src)) continue;
      // Resolved the way the browser resolves it: against the scene's URL, then decoded. Relative paths,
      // bare absolute paths and file: URLs (with %20 escapes) all reach the same file.
      const url = new URL(src, pathToFileURL(file));
      if (url.protocol !== 'file:') continue;
      const path = fileURLToPath(url);
      const exists = existsSync(path);
      units.push({
        kind: 'file', file: path, src, tagLine, module, exists,
        engine: basename(path) === 'flipbook.js',
        text: exists ? readFileSync(path, 'utf8') : '', line0: 1
      });
    } else {
      units.push({
        kind: 'inline', file, tagLine, module, engine: false, exists: true,
        text: m[2], line0: lineOf(html, m.index + m[0].indexOf('>') + 1)
      });
    }
  }
  return units;
}

function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if ('([{'.includes(s[i])) depth++;
    else if (')]}'.includes(s[i])) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Splits on commas that sit at depth 0 of brackets.
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Literal options of the first Animator({...}) call, or null when they are not written inline.
function animatorOptions(masked) {
  const at = masked.search(/\bAnimator\s*\(/);
  if (at < 0) return null;
  const open = masked.indexOf('(', at);
  const close = matchParen(masked, open);
  if (close < 0) return null;
  const obj = splitTop(masked.slice(open + 1, close)).map(s => s.trim()).find(s => s.startsWith('{') && s.endsWith('}'));
  if (!obj) return null;
  const opts = {};
  for (const part of splitTop(obj.slice(1, -1))) {
    const m = part.trim().match(/^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/);
    if (m) opts[m[1]] = m[2].trim();
  }
  return { opts, at };
}

// Literal integer: a number, NaN when the option is an expression, null when absent.
const literal = v => (v === undefined ? null : /^\d+$/.test(v) ? Number(v) : NaN);

const CODE_RULES = [
  ['FB001', /\bMath\.random\b/g, 'Math.random: frames change on every run. Use f.R, or f.still(key) for a seeded number.'],
  ['FB001', /\b(?:Date\.now|new\s+Date|performance\.now)\b/g, 'wall-clock time: frames change on every run. Use f.frame, f.t or f.time.'],
  ['FB001', /\b(?:setTimeout|setInterval|requestAnimationFrame)\b/g, 'timers run outside the frame clock. The Animator calls render(f) for you; use f.frame.'],
  ['FB003', /\b(?:substrate|grain|paintPaper)\s*\(\s*[\w$.]+\s*,\s*(?:[\w$]+\.)*R\b/g, 'paper or grain drawn with the boil stream R: the paper would boil. Use f.paper() and keep R for ink.'],
  ['FB007', /\b(?:shadowBlur|createRadialGradient)\b/g, 'glow effect (shadowBlur or radial gradient). Scenes are flat ink on paper; remove it.'],
  ['FB008', /\bfillText\s*\(/g, 'ctx.fillText draws a typeface, not hand lettering. Use Flipbook.write(ctx, f.R, text, x, y, size).'],
  ['FB009', /\b(?:ctx|g|context)\.stroke\s*\(/g, 'raw ctx.stroke() draws a ruler line. Use f.m.stroke(ctx, f.R, pts, col) so the line has weight and boils.']
];

function lintScript(unit, add) {
  const masked = blank(unit.text, { strings: false });
  const withStrings = blank(unit.text, { strings: true });
  const at = idx => unit.line0 + countNl(unit.text.slice(0, idx));
  for (const [code, re, message] of CODE_RULES) {
    for (const m of masked.matchAll(re)) add(code, at(m.index), message);
  }
  for (const m of withStrings.matchAll(/globalCompositeOperation\s*=\s*["'](lighter|screen)["']/g)) {
    add('FB007', at(m.index), `compositing "${m[1]}" makes a glow. Use the default source-over mode.`);
  }
  for (const m of masked.matchAll(/\b(?:const|let|var)\s+TOKENS\b/g)) unit.tokensAt = unit.tokensAt ?? at(m.index);
}

function lintFile(file) {
  const html = readFileSync(file, 'utf8');
  const findings = [];
  const add = (code, line, message) => findings.push({ code, severity: SEVERITY[code], file, line, message });
  const units = sceneScripts(file, html);

  for (const u of units) {
    if (u.kind === 'file' && !u.exists) {
      add('FB011', u.tagLine, `script src "${u.src}" does not exist. Fix the path; the engine is skills/flipbook/engine/flipbook.js.`);
    }
    if (u.module) add('FB012', u.tagLine, 'ES module script: it will not run from file://. Use a plain <script> with no import or export.');
  }

  const scene = units.filter(u => u.exists && !u.engine);
  for (const u of scene) lintScript(u, add);

  const anim = scene.find(u => /\b(?:window|globalThis)\s*\.\s*anim\s*=(?!=)/.test(blank(u.text, { strings: false })));
  if (!anim) add('FB002', 1, 'no window.anim assigned. Add window.anim = new Flipbook.Animator(canvas, render, {...}); the checks and renderer read it.');

  const withOpts = scene.map(u => ({ u, o: animatorOptions(blank(u.text, { strings: false })) })).find(x => x.o);
  if (withOpts) {
    const { u, o } = withOpts;
    const line = u.line0 + countNl(u.text.slice(0, o.at));
    const fps = o.opts.fps;
    if (fps !== undefined && /^\d+(\.\d+)?$/.test(fps) && Number(fps) > 16) {
      add('FB004', line, `fps ${fps} is above 16: boiling gets busy and the render budget tightens. Use 12 unless the motion needs more.`);
    }
    const frames = literal(o.opts.frames);
    const hold = o.opts.boilHold === undefined ? 2 : literal(o.opts.boilHold);
    const variants = o.opts.boilVariants === undefined ? 3 : literal(o.opts.boilVariants);
    const loop = o.opts.loop === undefined || o.opts.loop === 'true';
    if (loop && Number.isInteger(frames) && Number.isInteger(hold) && Number.isInteger(variants) && hold > 0 && variants > 0) {
      const period = hold * variants;
      if (frames % period !== 0) {
        const fix = Math.ceil(frames / period) * period;
        add('FB005', line, `frames ${frames} is not a multiple of boilHold*boilVariants (${period}): the loop seam jumps. Use ${fix}.`);
      }
    }
  }

  const tokens = scene.find(u => u.tokensAt !== undefined);
  const first = scene[0];
  if (!tokens) {
    add('FB010', first ? first.line0 : 1, 'no TOKENS constant. Declare const TOKENS = { ... } with the scene strings and sizes near the top of the script.');
  } else if (first && tokens.tokensAt - first.line0 >= 40) {
    add('FB010', tokens.tokensAt, 'TOKENS is declared after line 40 of the scene script. Move it to the top.');
  }

  const bodyText = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, s => s.replace(/[^\n]/g, ' '))
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, s => s.replace(/[^\n]/g, ' '))
    .replace(/<canvas\b[\s\S]*?<\/canvas\s*>/gi, s => s.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, s => s.replace(/[^\n]/g, ' '));
  const bodyAt = Math.max(0, bodyText.search(/<body\b/i));
  for (const m of bodyText.slice(bodyAt).matchAll(/<(h1|h2|p)\b/gi)) {
    add('FB006', lineOf(html, bodyAt + m.index), `<${m[1]}> sits outside the canvas: HTML text does not boil. Draw words with Flipbook.write().`);
  }
  return findings;
}

function main(argv) {
  const json = argv.includes('--json');
  const files = argv.filter(a => a !== '--json');
  if (files.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  const all = [];
  for (const f of files) {
    const path = resolve(f);
    if (!existsSync(path)) {
      all.push({ code: 'FB011', severity: 'error', file: f, line: 0, message: 'scene file does not exist' });
      continue;
    }
    all.push(...lintFile(path).map(x => ({ ...x, file: f })));
  }
  all.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  const errors = all.filter(x => x.severity === 'error').length;
  const warnings = all.length - errors;
  if (json) {
    console.log(JSON.stringify({ findings: all, errors, warnings, ok: errors === 0 }, null, 2));
  } else {
    for (const x of all) console.log(`${x.file}:${x.line}  ${x.code}  ${x.severity.padEnd(5)}  ${x.message}`);
    console.log(`lint: ${errors} error(s), ${warnings} warning(s). ${errors ? 'FAIL' : 'PASS'}`);
  }
  process.exitCode = errors ? 1 : 0;
}

main(process.argv.slice(2));
