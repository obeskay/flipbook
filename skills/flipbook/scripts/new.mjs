#!/usr/bin/env node
// Copies examples/<recipe> into a new folder with its own engine (flipbook.js beside scene.html), so the folder
// opens and checks the same wherever it is moved. report.md and chart.mmd are not copied: they describe the recipe's
// process, not the new one.
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// FLIPBOOK_EXAMPLES points the recipe list elsewhere; the tests use it.
const examples = process.env.FLIPBOOK_EXAMPLES || join(skill, 'examples');
const engine = join(skill, 'engine', 'flipbook.js');
const usage = 'usage: new.mjs <recipe> <dir>   (no arguments: list recipes)';
const GENERATED = new Set(['report.md', 'chart.mmd']);
const INPUTS = ['flow.js', 'data.js', 'art.js'];

function recipes() {
  if (!existsSync(examples)) return [];
  return readdirSync(examples, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(examples, d.name, 'scene.html')))
    .map(d => d.name)
    .sort();
}

// Top-level keys of `const TOKENS = {...}` in a scene: the names an adapter edits. Strings and comments are skipped.
function tokenKeys(html) {
  const at = html.search(/const\s+TOKENS\s*=\s*\{/);
  if (at < 0) return [];
  let depth = 0, top = '', quote = null;
  for (let i = html.indexOf('{', at); i < html.length; i++) {
    const c = html[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && html[i + 1] === '/') { while (i < html.length && html[i] !== '\n') i++; continue; }
    if (c === '/' && html[i + 1] === '*') { i = html.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    if (c === '}' || c === ']' || c === ')') depth--;
    if (depth === 0) break;
    top += depth === 1 ? c : ' ';
  }
  return [...new Set([...top.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(m => m[1]))];
}

const [recipe, dest] = process.argv.slice(2);

if (!recipe) {
  const list = recipes();
  console.log(list.length ? `recipes:\n${list.map(r => `  ${r}`).join('\n')}` : 'no recipes yet: examples/ has no scene.html folders');
  console.log(usage);
  process.exit(0);
}
if (!dest) {
  console.error(usage);
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9_-]*$/.test(recipe)) {
  console.error(`recipe names are lowercase letters, digits, - and _: got "${recipe}"`);
  process.exit(2);
}

const src = join(examples, recipe);
if (!existsSync(join(src, 'scene.html'))) {
  console.error(`no recipe "${recipe}". Available: ${recipes().join(', ') || 'none yet'}`);
  process.exit(1);
}

const out = resolve(dest);
if (existsSync(out) && readdirSync(out).length > 0) {
  console.error(`refusing to overwrite: ${out} exists and is not empty`);
  process.exit(1);
}
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true, errorOnExist: true, force: false, filter: p => !GENERATED.has(basename(p)) });
copyFileSync(engine, join(out, 'flipbook.js'));

let rewired = 0;
for (const name of readdirSync(out).filter(f => f.endsWith('.html'))) {
  const file = join(out, name);
  const html = readFileSync(file, 'utf8');
  const next = html.replace(/(<script\b[^>]*\bsrc\s*=\s*["'])([^"']*flipbook\.js)(["'])/gi, (_, a, _old, c) => {
    rewired++;
    return `${a}flipbook.js${c}`;
  });
  if (next !== html) writeFileSync(file, next);
}
if (rewired === 0) console.warn('warning: no flipbook.js script tag found in the recipe; its engine src was not rewritten');

const files = readdirSync(out);
const inputs = files.filter(f => INPUTS.includes(f));
const tokens = tokenKeys(readFileSync(join(out, 'scene.html'), 'utf8'));
console.log(`created ${out} from ${recipe}: ${files.join(', ')}`);
console.log('open scene.html by double click; the engine is flipbook.js beside it, so the folder can move.');
console.log('to adapt it:');
console.log(inputs.length
  ? `  1. input: ${inputs.join(', ')} (the process, numbers or SVG this recipe reads)`
  : '  1. input: no input file beside scene.html; the recipe\'s input lives in TOKENS');
console.log(`  2. TOKENS in scene.html: ${tokens.join(', ') || 'none found'}`);
console.log(`  3. check: node ${join(skill, 'scripts', 'check.mjs')} ${join(out, 'scene.html')} --format 1:1`);
