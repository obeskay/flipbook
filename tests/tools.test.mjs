// Tests for the flipbook tools. Each planted defect must make its code fire, and the good fixture must pass.
// Run: node --test tests/tools.test.mjs (from the repo root, or with its absolute path)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const SKILL = join(TESTS, '..', 'skills', 'flipbook');
const FIX = join(TESTS, 'fixtures');
const fx = name => join(FIX, name);
const tool = name => join(SKILL, 'scripts', name);
const ffBin = name => (existsSync(`/opt/homebrew/bin/${name}`) ? `/opt/homebrew/bin/${name}` : name);

const { launchChrome } = await import(pathToFileURL(join(SKILL, 'scripts', 'lib', 'chrome.mjs')).href);

const root = mkdtempSync(join(tmpdir(), 'flipbook-test-'));
after(() => rmSync(root, { recursive: true, force: true }));

function run(script, args, timeout = 600000) {
  const r = spawnSync(process.execPath, [tool(script), ...args], { encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const lint = file => {
  const r = run('lint.mjs', [file, '--json']);
  return { code: r.code, ...JSON.parse(r.out) };
};

const check = (file, format = 'all') => {
  const r = run('check.mjs', [file, '--format', format, '--json']);
  assert.ok(r.out.startsWith('{'), `check printed no JSON: ${r.err || r.out}`);
  return { code: r.code, ...JSON.parse(r.out) };
};

const errorCodes = findings => [...new Set(findings.filter(f => f.severity === 'error').map(f => f.code))].sort();
const allCodes = findings => [...new Set(findings.map(f => f.code))].sort();

// A variant of good.html with some text replaced, written to the test root with an absolute engine path.
function variant(name, edits, { keepEngine = false } = {}) {
  let html = readFileSync(fx('good.html'), 'utf8');
  for (const [from, to] of edits) {
    assert.ok(html.includes(from), `anchor missing in good.html: ${from}`);
    html = html.replace(from, to);
  }
  if (!keepEngine) html = html.replace('../../skills/flipbook/engine/flipbook.js', join(SKILL, 'engine', 'flipbook.js'));
  const file = join(root, `${name}.html`);
  writeFileSync(file, html);
  return file;
}

const probeJson = file => {
  const r = spawnSync(ffBin('ffprobe'), ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_read_frames,codec_name,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).streams[0];
};

// --- lint -------------------------------------------------------------------

test('lint: good fixture has no findings', () => {
  const r = lint(fx('good.html'));
  assert.equal(r.code, 0);
  assert.deepEqual(r.findings, []);
});

const LINT_BAD = [
  ['bad-fb001.html', 'FB001'], ['bad-fb002.html', 'FB002'], ['bad-fb003.html', 'FB003'],
  ['bad-fb005.html', 'FB005'], ['bad-fb007.html', 'FB007'], ['bad-fb012.html', 'FB012']
];
for (const [file, code] of LINT_BAD) {
  test(`lint: ${file} fires ${code} and nothing else as an error`, () => {
    const r = lint(fx(file));
    assert.equal(r.code, 1);
    assert.deepEqual(errorCodes(r.findings), [code]);
  });
}

// Warnings and the one lint-only error with no dedicated fixture, each from a one-line change to good.html.
const LINT_VARIANTS = [
  ['FB004', 'warn', [['fps: 12', 'fps: 24']]],
  ['FB006', 'warn', [['<canvas id="c"></canvas>', '<canvas id="c"></canvas>\n<p>Texto fuera del lienzo</p>']]],
  ['FB008', 'warn', [['f.paper();', "f.paper();\n  ctx.fillText('texto', 10, 10);"]]],
  ['FB009', 'warn', [['f.paper();', 'f.paper();\n  ctx.stroke();']]],
  ['FB010', 'warn', [["const TOKENS = { label: 'Hola, mañana', size: 56 };", '']]],
  ['FB011', 'error', [['../../skills/flipbook/engine/flipbook.js', '../../skills/flipbook/engine/nope.js']], { keepEngine: true }]
];
for (const [code, severity, edits, opts] of LINT_VARIANTS) {
  test(`lint: ${code} fires as ${severity} on a one-line change`, () => {
    const r = lint(variant(code.toLowerCase(), edits, opts));
    assert.deepEqual(allCodes(r.findings), [code]);
    assert.equal(r.findings[0].severity, severity);
  });
}

// The engine can be named by a file: URL, a bare absolute path, or a path with %20 escapes. The browser loads
// all three; lint must find the file for all three. The directory name has a space to exercise the escapes.
test('lint: file: URL, bare absolute path and %20-escaped path all resolve to the engine', () => {
  const dir = join(root, 'with space');
  mkdirSync(dir, { recursive: true });
  const engine = join(dir, 'flipbook.js');
  copyFileSync(join(SKILL, 'engine', 'flipbook.js'), engine);
  const forms = {
    'file-url': pathToFileURL(engine).href,
    'bare-path': engine,
    'escaped-path': pathToFileURL(engine).pathname
  };
  for (const [name, src] of Object.entries(forms)) {
    const html = readFileSync(fx('good.html'), 'utf8').replace('../../skills/flipbook/engine/flipbook.js', src);
    const file = join(dir, `${name}.html`);
    writeFileSync(file, html);
    const r = lint(file);
    assert.equal(r.code, 0, `${name} (${src}): ${JSON.stringify(r.findings)}`);
  }
});

// --- check ------------------------------------------------------------------

test('check: good fixture passes in all three formats with no warnings', () => {
  const r = check(fx('good.html'));
  assert.equal(r.code, 0, JSON.stringify(r.findings));
  assert.deepEqual(r.findings, []);
  assert.equal(r.formats.length, 3);
});

const CHECK_BAD = [
  ['bad-fb102.html', 'FB102'], ['bad-fb103.html', 'FB103'], ['bad-fb104.html', 'FB104'],
  ['bad-fb106.html', 'FB106'], ['bad-fb108.html', 'FB108'], ['bad-fb109.html', 'FB109'],
  ['bad-fb111.html', 'FB111'], ['bad-fb112.html', 'FB112'], ['bad-fb113.html', 'FB113'],
  ['bad-fb115.html', 'FB115'], ['bad-fb116.html', 'FB116']
];
// These planted layouts use relative positions that also fail at half size, so FB115 repeats the finding there.
const ALSO_AT_HALF = { 'bad-fb108.html': ['FB115'], 'bad-fb109.html': ['FB115'] };
for (const [file, code] of CHECK_BAD) {
  test(`check: ${file} fires ${code} and no other error`, () => {
    const r = check(fx(file), '1:1');
    assert.equal(r.code, 1);
    assert.deepEqual(errorCodes(r.findings), [code, ...(ALSO_AT_HALF[file] ?? [])].sort());
  });
}

test('check: a probe named with "!" is exempt from the teleport rule', () => {
  const r = check(fx('bad-fb112-exempt.html'), '1:1');
  assert.equal(r.code, 0, JSON.stringify(r.findings));
  assert.deepEqual(errorCodes(r.findings), []);
});

test('check: FB115 names the half size it failed at', () => {
  const r = check(fx('bad-fb115.html'), '1:1');
  assert.match(r.findings[0].message, /^at 540x540 \(half of 1080x1080\): /);
});

test('check: the summary line gives elapsed seconds and frames sampled', () => {
  const r = run('check.mjs', [fx('good.html'), '--format', '1:1']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^check: 0 error\(s\), 0 warning\(s\) across 1 format\(s\) in \d+\.\d s, 24 frame\(s\) sampled per format\. PASS$/m);
});

test('check: an uncaught exception is the first finding; the window.anim message that follows it is not printed', () => {
  const r = check(fx('bad-fb101.html'), '1:1');
  assert.equal(r.code, 1);
  assert.match(r.findings[0].message, /^the page reported: uncaught exception: .*layoutFlow: sz 300 does not fit/);
  assert.ok(!r.findings.some(f => /does not set window\.anim/.test(f.message)), JSON.stringify(r.findings));
  assert.deepEqual(errorCodes(r.findings), ['FB101']);
});

// defects.md carries one line with every character the lettering table draws. It is generated from the table here,
// so a glyph added to 30-letters.js must be added to the doc too.
test('defects.md lists exactly the characters the lettering table has', () => {
  const FB = createRequire(import.meta.url)('../skills/flipbook/engine/flipbook.js');
  const want = Object.keys(FB.GL).sort().join('');
  const line = readFileSync(join(SKILL, 'references', 'defects.md'), 'utf8').split('\n').find(l => l.startsWith('Lettering glyphs'));
  assert.ok(line, 'no "Lettering glyphs" line in defects.md');
  assert.equal(line.match(/`([^`]*)`/)[1], want);
});

// --- chrome driver ----------------------------------------------------------

test('chrome: a Chrome that exits at once gives a clear error, fast', async () => {
  const prev = process.env.CHROME;
  process.env.CHROME = '/usr/bin/true';
  try {
    const t0 = Date.now();
    await assert.rejects(launchChrome({ timeoutMs: 5000 }), /exited before DevTools was ready/);
    assert.ok(Date.now() - t0 < 4000);
  } finally {
    if (prev === undefined) delete process.env.CHROME; else process.env.CHROME = prev;
  }
});

test('chrome: close() removes the profile directory', async () => {
  const chrome = await launchChrome();
  const dir = chrome.userDataDir;
  assert.ok(existsSync(dir));
  await chrome.close();
  assert.ok(!existsSync(dir), `profile still there: ${dir}`);
});

test('chrome: SIGINT kills Chrome and removes the profile', async () => {
  const script = join(root, 'hold-chrome.mjs');
  writeFileSync(script, `const { launchChrome } = await import(${JSON.stringify(pathToFileURL(join(SKILL, 'scripts', 'lib', 'chrome.mjs')).href)});
const c = await launchChrome();
console.log('PROFILE ' + c.userDataDir);
setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const dir = await new Promise((res, rej) => {
    let buf = '';
    child.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/PROFILE (.+)/);
      if (m) res(m[1].trim());
    });
    child.on('exit', code => rej(new Error(`child exited early (${code})`)));
    setTimeout(() => rej(new Error('child never reported its profile')), 60000);
  });
  assert.ok(existsSync(dir));
  const code = await new Promise(res => { child.on('exit', res); child.kill('SIGINT'); });
  assert.equal(code, 130);
  assert.ok(!existsSync(dir), `profile survived SIGINT: ${dir}`);
});

// --- render -----------------------------------------------------------------

test('render: mp4 has the expected frame count, size and codec', () => {
  const out = join(root, 'render-mp4');
  const r = run('render.mjs', [fx('good.html'), '--format', '1:1', '--mp4', '--out', out]);
  assert.equal(r.code, 0, r.err);
  const file = join(out, 'good-1x1.mp4');
  assert.ok(existsSync(file));
  const s = probeJson(file);
  assert.equal(s.codec_name, 'h264');
  assert.equal(s.pix_fmt, 'yuv420p');
  assert.equal(Number(s.nb_read_frames), 24);
  assert.equal(s.width, 1080);
  assert.equal(s.height, 1080);
});

test('render: --html is one file that reopens by file URL with window.anim', async () => {
  const out = join(root, 'render-html');
  const r = run('render.mjs', [fx('good.html'), '--html', '--out', out]);
  assert.equal(r.code, 0, r.err);
  const file = join(out, 'good.html');
  const html = readFileSync(file, 'utf8');
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'a local script was left as a src tag');
  const chrome = await launchChrome();
  try {
    await chrome.open(pathToFileURL(file).href);
    assert.equal(await chrome.evaluate('typeof window.anim'), 'object');
    assert.deepEqual(chrome.errors, []);
  } finally {
    await chrome.close();
  }
});

test('render: --sticker is an animated 512px WebP under 500 KB that Chrome decodes frame by frame', async () => {
  const out = join(root, 'render-sticker');
  const r = run('render.mjs', [fx('good.html'), '--sticker', '--out', out]);
  assert.equal(r.code, 0, r.err);
  const file = join(out, 'good-sticker.webp');
  assert.ok(existsSync(file));
  const size = statSync(file).size;
  assert.ok(size <= 500000, `sticker is ${size} bytes`);
  const page = join(root, 'decode.html');
  writeFileSync(page, '<!doctype html><title>decode</title>');
  const b64 = readFileSync(file).toString('base64');
  const chrome = await launchChrome();
  try {
    await chrome.open(pathToFileURL(page).href);
    const d = await chrome.evaluate(`(async () => {
      const bytes = Uint8Array.from(atob('${b64}'), c => c.charCodeAt(0));
      const dec = new ImageDecoder({ data: bytes, type: 'image/webp' });
      await dec.tracks.ready;
      const track = dec.tracks.selectedTrack;
      const first = await dec.decode({ frameIndex: 0 });
      const w = first.image.displayWidth, h = first.image.displayHeight;
      const cv = new OffscreenCanvas(512, 512);
      const g = cv.getContext('2d');
      g.drawImage(first.image, 0, 0);
      const corner = g.getImageData(0, 0, 1, 1).data[3];
      first.image.close();
      for (let i = 1; i < track.frameCount; i++) {
        const fr = await dec.decode({ frameIndex: i });
        fr.image.close();
      }
      return { frames: track.frameCount, animated: track.animated, w, h, corner };
    })()`);
    assert.equal(d.frames, 24);
    assert.equal(d.animated, true);
    assert.deepEqual([d.w, d.h], [512, 512]);
    assert.equal(d.corner, 0, 'the sticker corner should be transparent');
  } finally {
    await chrome.close();
  }
});

test('render: sheet, onion, png, gif and whatsapp outputs exist; whatsapp is even, under 16 MB, faststart', () => {
  const out = join(root, 'render-many');
  const r = run('render.mjs', [fx('good.html'), '--format', '1:1', '--fast', '--sheet', '--onion', '--png', '--gif', '--whatsapp', '--out', out]);
  assert.equal(r.code, 0, r.err);
  for (const f of ['good-1x1-fast-sheet.png', 'good-1x1-fast-onion.png', 'good-1x1-fast.png', 'good-1x1-fast.gif', 'good-1x1-fast-whatsapp.mp4']) {
    assert.ok(existsSync(join(out, f)), `missing ${f}`);
  }
  const wa = join(out, 'good-1x1-fast-whatsapp.mp4');
  assert.ok(statSync(wa).size < 16_000_000);
  const s = probeJson(wa);
  assert.equal(s.width % 2, 0);
  assert.equal(s.height % 2, 0);
  assert.equal(s.pix_fmt, 'yuv420p');
  const head = readFileSync(wa).subarray(0, 4096).toString('latin1');
  assert.ok(head.indexOf('moov') >= 0 && head.indexOf('moov') < head.indexOf('mdat'), 'moov atom should precede mdat (faststart)');
});

test('render: --material all --sheet writes materials.png and prints the order', () => {
  const out = join(root, 'render-materials');
  const r = run('render.mjs', [fx('good.html'), '--material', 'all', '--sheet', '--format', '1:1', '--fast', '--out', out]);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(out, 'materials.png')));
  assert.match(r.out, /materials\.png order .*: crayon, watercolor, .*pencil/);
});

// --- new --------------------------------------------------------------------

test('new: lists recipes, copies the engine beside the scene, skips generated reports, refuses to overwrite', () => {
  const examples = join(root, 'examples');
  mkdirSync(join(examples, 'demo'), { recursive: true });
  writeFileSync(join(examples, 'demo', 'scene.html'), readFileSync(fx('good.html'), 'utf8'));
  writeFileSync(join(examples, 'demo', 'report.md'), '# old process');
  writeFileSync(join(examples, 'demo', 'chart.mmd'), 'stateDiagram-v2');
  const env = { ...process.env, FLIPBOOK_EXAMPLES: examples };
  const list = spawnSync(process.execPath, [tool('new.mjs')], { encoding: 'utf8', env });
  assert.match(list.stdout, /recipes:\n {2}demo/);

  const dest = join(root, 'my-scene');
  const made = spawnSync(process.execPath, [tool('new.mjs'), 'demo', dest], { encoding: 'utf8', env });
  assert.equal(made.status, 0, made.stderr);
  assert.deepEqual(readdirSync(dest).sort(), ['flipbook.js', 'scene.html']);
  assert.ok(readFileSync(join(dest, 'flipbook.js')).equals(readFileSync(join(SKILL, 'engine', 'flipbook.js'))), 'engine copy differs');
  const html = readFileSync(join(dest, 'scene.html'), 'utf8');
  assert.match(html, /<script src="flipbook\.js">/);
  assert.ok(!html.includes(SKILL), 'scene still points into the skill folder');
  assert.match(made.stdout, /TOKENS in scene\.html: label, size/);

  const again = spawnSync(process.execPath, [tool('new.mjs'), 'demo', dest], { encoding: 'utf8', env });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /refusing to overwrite/);
});

test('new: ajolote lints and checks at 1:1, and still does after its folder is moved', () => {
  const dest = join(root, 'ajolote-copy');
  const made = spawnSync(process.execPath, [tool('new.mjs'), 'ajolote', dest], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /TOKENS in scene\.html: period, ground/);
  const passes = scene => {
    const l = lint(scene);
    assert.equal(l.code, 0, JSON.stringify(l.findings));
    const c = check(scene, '1:1');
    assert.equal(c.code, 0, JSON.stringify(c.findings.filter(f => f.severity === 'error')));
  };
  passes(join(dest, 'scene.html'));

  const moved = join(root, 'elsewhere', 'moved-ajolote');
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dest, moved);
  passes(join(moved, 'scene.html'));
});

// --- examples ---------------------------------------------------------------

// Every recipe with a scene.html must lint clean and check with no errors. The test name carries the recipe.
const EXAMPLES = join(SKILL, 'examples');
const recipes = existsSync(EXAMPLES)
  ? readdirSync(EXAMPLES, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(EXAMPLES, d.name, 'scene.html')))
    .map(d => d.name).sort()
  : [];

test('examples: at least one recipe exists', () => {
  assert.ok(recipes.length > 0, `no examples/<recipe>/scene.html under ${EXAMPLES}`);
});

for (const name of recipes) {
  test(`examples: ${name} lints clean and checks with no errors`, () => {
    const file = join(EXAMPLES, name, 'scene.html');
    const l = lint(file);
    assert.equal(l.code, 0, `${name} lint: ${JSON.stringify(l.findings)}`);
    const c = check(file);
    assert.deepEqual(errorCodes(c.findings), [], `${name} check: ${JSON.stringify(c.findings.filter(f => f.severity === 'error'))}`);
  });
}
