// Flow: model checking, layout without overlaps, drawing and beats smoke, model.mjs exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const FB = require('../skills/flipbook/engine/flipbook.js');
const here = dirname(fileURLToPath(import.meta.url));
const MODEL = join(here, '..', 'skills', 'flipbook', 'scripts', 'model.mjs');

// A small machine: a-b cycle, a trap at d (no way out), one step that never fires.
const trapFlow = FB.defineFlow({
  name: 'trampa',
  init: { x: 'a' },
  view: s => s.x,
  steps: {
    Avanza: { label: 'avanza', when: s => s.x === 'a', do: () => ({ x: 'b' }) },
    Regresa: { label: 'regresa', when: s => s.x === 'b', do: () => ({ x: 'a' }) },
    Cae: { label: 'cae', when: s => s.x === 'b', do: () => ({ x: 'd' }) },
    Nunca: { label: 'nunca', when: s => s.x === 'zz', do: () => ({ x: 'a' }) }
  },
  rules: { NoCae: { label: 'no se cae', ok: s => s.x !== 'd' } }
});

test('checkFlow finds a planted deadlock with its shortest path and a dead step', () => {
  const r = FB.checkFlow(trapFlow);
  assert.equal(r.deadlocks.length, 1);
  assert.equal(r.deadlocks[0].view, 'd');
  assert.deepEqual(r.deadlocks[0].path.map(p => p.view), ['a', 'b', 'd']);
  assert.equal(r.deadlocks[0].path[2].step, 'Cae');
  assert.deepEqual(r.deadSteps.map(s => s.id), ['Nunca']);
  assert.equal(r.ok, false);
});

test('a broken rule reports the shortest counterexample', () => {
  const r = FB.checkFlow(trapFlow);
  assert.equal(r.broken.length, 1);
  assert.deepEqual(r.broken[0].path.map(p => p.view), ['a', 'b', 'd']);
  assert.equal(r.broken[0].path.length, 3);
});

test('shortest path beats a longer route to the same violation', () => {
  const shortcut = FB.defineFlow({
    name: 'atajo', init: { n: 0 }, view: s => `n${s.n}`,
    steps: {
      Uno: { label: 'uno', when: s => s.n === 0, do: () => ({ n: 1 }) },
      Dos: { label: 'dos', when: s => s.n === 1, do: () => ({ n: 2 }) },
      Tres: { label: 'tres', when: s => s.n === 2, do: () => ({ n: 3 }) },
      Atajo: { label: 'atajo', when: s => s.n === 0, do: () => ({ n: 3 }) }
    },
    rules: { NoTres: { label: 'no llega a tres', ok: s => s.n !== 3 } }
  });
  const r = FB.checkFlow(shortcut);
  assert.equal(r.broken[0].path.length, 2);
  assert.equal(r.broken[0].path[1].step, 'Atajo');
});

const cycle = (rules) => FB.defineFlow({
  name: 'ciclo', init: { x: 'a' }, view: s => s.x,
  steps: {
    Ida: { label: 'ida', when: s => s.x === 'a', do: () => ({ x: 'b' }) },
    Vuelta: { label: 'vuelta', when: s => s.x === 'b', do: () => ({ x: 'a' }) }
  },
  rules
});

test('expectBroken: a breaking rule marked expected keeps ok true', () => {
  const r = FB.checkFlow(cycle({ NoB: { label: 'nunca b', ok: s => s.x !== 'b', expectBroken: true } }));
  assert.equal(r.broken.length, 1);
  assert.equal(r.broken[0].expectBroken, true);
  assert.equal(r.ok, true);
});

test('expectBroken: a rule marked expected that holds makes ok false', () => {
  const r = FB.checkFlow(cycle({ Siempre: { label: 'siempre', ok: () => true, expectBroken: true } }));
  assert.deepEqual(r.broken, []);
  assert.equal(r.ok, false);
});

test('an unexpected breaking rule makes ok false', () => {
  const r = FB.checkFlow(cycle({ Falla: { label: 'falla', ok: s => s.x !== 'b' } }));
  assert.equal(r.ok, false);
});

test('a state cap is reported and makes ok false', () => {
  const counter = FB.defineFlow({
    name: 'contador', init: { n: 0 }, view: s => `n${s.n}`,
    steps: { Inc: { label: 'suma', when: () => true, do: s => ({ n: s.n + 1 }) } },
    rules: {}
  });
  const r = FB.checkFlow(counter, { cap: 50 });
  assert.equal(r.capped, true);
  assert.equal(r.ok, false);
});

test('defineFlow rejects a bad shape', () => {
  assert.throws(() => FB.defineFlow({ steps: { A: { when: () => true, do: s => s } } }), TypeError);
  assert.throws(() => FB.defineFlow({ init: 1, steps: {} }), TypeError);
  assert.throws(() => FB.defineFlow({ init: 1, steps: { A: { when: () => true, do: s => s } }, expectStuck: 'x' }), TypeError);
});

// expectStuck: a dead end the process really has. Accepted deadlocks keep ok true; a declared expectStuck that
// matches no deadlock makes ok false, the same way an expectBroken rule that holds does.
const stuckFlow = expectStuck => FB.defineFlow({
  name: 'espera', init: { x: 'a' }, view: s => s.x,
  steps: { Ida: { label: 'ida', when: s => s.x === 'a', do: () => ({ x: 'espera' }) } },
  rules: {}, expectStuck
});

test('expectStuck: a deadlock it matches is accepted, with its path', () => {
  const r = FB.checkFlow(stuckFlow(s => s.x === 'espera'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.deadlocks, []);
  assert.deepEqual(r.expectedStuck.map(d => d.view), ['espera']);
  assert.deepEqual(r.expectedStuck[0].path.map(p => p.view), ['a', 'espera']);
  assert.equal(r.stuckUnmatched, false);
});

test('expectStuck: a deadlock it does not match still makes ok false', () => {
  const r = FB.checkFlow(stuckFlow(s => s.x === 'otro'));
  assert.equal(r.ok, false);
  assert.equal(r.deadlocks.length, 1);
  assert.equal(r.stuckUnmatched, true);
});

test('expectStuck: declared on a flow with no deadlock, it never matches, so ok is false', () => {
  const r = FB.checkFlow({ ...cycle({}), expectStuck: () => true });
  assert.equal(r.deadlocks.length, 0);
  assert.equal(r.stuckUnmatched, true);
  assert.equal(r.ok, false);
});

test('model.mjs: an accepted dead end exits 0 and says so; an expectStuck that matches nothing exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-stuck-'));
  const flowSrc = cond => `window.FLOW = Flipbook.defineFlow({
    name: 'espera', init: { x: 'a' }, view: s => s.x,
    steps: { Ida: { label: 'ida', when: s => s.x === 'a', do: () => ({ x: 'espera' }) } },
    expectStuck: s => ${cond} });`;
  const acc = join(dir, 'acc.js'), stale = join(dir, 'stale.js');
  writeFileSync(acc, flowSrc("s.x === 'espera'"));
  writeFileSync(stale, flowSrc("s.x === 'otro'"));
  const run = f => spawnSync(process.execPath, [MODEL, f], { encoding: 'utf8' });

  const a = run(acc);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /stuck, expected \(expectStuck\): espera/);
  assert.match(a.stdout, /result: OK/);

  const s = run(stale);
  assert.equal(s.status, 1, s.stdout + s.stderr);
  assert.match(s.stdout, /stuck at: espera/);
  assert.match(s.stdout, /expectStuck matches no deadlock/);
});

test('layoutFlow: dir must be TB or LR; TB is the default', () => {
  const check = FB.checkFlow(tenFlow);
  assert.throws(() => FB.layoutFlow(check, { w: 1080, h: 1080, dir: 'XX' }), /dir must be 'TB' \(top to bottom\) or 'LR' \(left to right\), got "XX"/);
  assert.equal(FB.layoutFlow(check, { w: 1080, h: 1080 }).dir, 'TB');
});

test('layoutFlow: fit shrinks sz until it fits; without fit the error names the ranks, the binding axis and the largest sz', () => {
  const check = FB.checkFlow(tenFlow);
  const frame = { w: 1080, h: 600, dir: 'TB' };
  assert.throws(() => FB.layoutFlow(check, { ...frame, sz: 40 }), e => {
    assert.match(e.message, /sz 40 does not fit 1080 x 600 \(TB\): \d+ ranks, height binds \(needs at least [\d.]+ px, has 600\)\. Largest sz that fits: \d+\./);
    const largest = Number(e.message.match(/Largest sz that fits: (\d+)\./)[1]);
    assert.doesNotThrow(() => FB.layoutFlow(check, { ...frame, sz: largest }));
    if (largest + 1 < 40) assert.throws(() => FB.layoutFlow(check, { ...frame, sz: largest + 1 }));
    return true;
  });

  const L = FB.layoutFlow(check, { ...frame, sz: 40, fit: true });
  assert.ok(L.sz < 40 && L.sz >= 22, `fit gave sz ${L.sz}`);
  assert.equal(L.boxes.length, 10);
  assert.equal(FB.layoutFlow(check, { w: 1080, h: 1080, sz: 40, fit: true }).sz, 40, 'a size that fits is kept');
  assert.throws(() => FB.layoutFlow(check, { w: 200, h: 120, dir: 'TB', sz: 40, fit: true }), /no sz from 40 down to 22 fits 200 x 120 \(TB\)/);
});

// Ten states paso 0..9. Forward steps, a skip, and a back edge from paso 7 to paso 3.
const tenFlow = FB.defineFlow({
  name: 'diez', init: { n: 0 }, view: s => `paso ${s.n}`,
  steps: {
    Avanza: { label: 'avanza', when: s => s.n < 9, do: s => ({ n: s.n + 1 }) },
    Salta: { label: 'salta', when: s => s.n <= 6 && s.n % 2 === 0, do: s => ({ n: s.n + 2 }) },
    Vuelve: { label: 'vuelve a empezar', when: s => s.n === 7, do: () => ({ n: 3 }) }
  },
  final: s => s.n === 9,
  rules: {}
});

const rectOf = (cx, cy, w, h) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
const overlaps = (p, q) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;

for (const dir of ['TB', 'LR']) {
  test(`layout ${dir}: ten boxes, labels and back edge with no overlaps`, () => {
    const check = FB.checkFlow(tenFlow);
    assert.equal(check.nodes.length, 10);
    const L = FB.layoutFlow(check, { w: 1080, h: 1080, dir });
    assert.equal(L.boxes.length, 10);
    assert.ok(L.edges.some(e => e.back), 'the flow has a back edge');

    const boxRects = L.boxes.map(b => rectOf(b.x, b.y, b.w, b.h));
    boxRects.forEach((r, i) => {
      assert.ok(r.x0 >= 0 && r.y0 >= 0 && r.x1 <= L.w && r.y1 <= L.h, `box ${i} inside the canvas`);
      boxRects.forEach((q, j) => { if (j > i) assert.equal(overlaps(r, q), false, `boxes ${i} and ${j} overlap`); });
    });

    const labelRects = L.edges.filter(e => e.lw > 0).map(e => ({ e, r: rectOf(e.lx, e.ly, e.lw, e.lh) }));
    assert.equal(labelRects.length, L.edges.length, 'every edge has a placed label');
    for (const { e, r } of labelRects) {
      assert.equal(e.clash, false, `label ${e.label} found a clear spot`);
      assert.ok(r.x0 >= 0 && r.y0 >= 0 && r.x1 <= L.w && r.y1 <= L.h, `label ${e.label} inside the canvas`);
      boxRects.forEach((b, i) => assert.equal(overlaps(r, b), false, `label ${e.label} overlaps box ${i}`));
      labelRects.forEach(({ r: q }) => { if (q !== r) assert.equal(overlaps(r, q), false, `label ${e.label} overlaps another label`); });
    }
  });
}

// Stub frame for drawFlow: records material calls, uses a no-op context for the write() strokes.
const stubFrame = () => {
  const calls = { fill: 0, stroke: 0 };
  return {
    calls,
    f: {
      ctx: new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => {}) }),
      R: FB.stream(7), unit: 1,
      still: key => FB.stream(String(key).length * 131 + 7),
      m: {
        ink: [30, 27, 30], paper: [252, 249, 242], inks: [[200, 40, 40]],
        fill() { calls.fill++; }, stroke() { calls.stroke++; }
      }
    }
  };
};

test('drawFlow draws every card, edge and token without throwing', () => {
  const L = FB.layoutFlow(FB.checkFlow(tenFlow), { w: 1080, h: 1080, dir: 'TB' });
  const { calls, f } = stubFrame();
  FB.drawFlow(f, L, { active: 'paso 4', visited: ['paso 0', 'paso 2', 'paso 4'], trace: [0], token: { edge: 0, p: 0.5 }, accent: [200, 40, 40] });
  const B = L.boxes.length, E = L.edges.length;
  assert.equal(calls.fill, B + 1, 'one fill per card plus the token');
  assert.equal(calls.stroke, 2 * E + B, 'edge plus arrowhead per edge, outline per card');
});

test('flowBeats alternates holds and 8-frame travels and keeps the token continuous', () => {
  const cyc = cycle({});
  const check = FB.checkFlow(cyc);
  const L = FB.layoutFlow(check, { w: 800, h: 800, dir: 'TB' });
  const path = [{ view: 'a' }, { view: 'b', step: 'Ida' }, { view: 'a', step: 'Vuelta' }];
  const bt = FB.flowBeats(path, 12, { layout: L });
  assert.equal(bt.list.length, 5);
  assert.equal(bt.total, 12 + 8 + 12 + 8 + 12);
  const ida = L.edges.findIndex(e => e.step === 'Ida');
  const vuelta = L.edges.findIndex(e => e.step === 'Vuelta');

  // Hold on b: the token glides from the end of Ida to the start of Vuelta, then rests there.
  const holdB = bt.list[2].start;
  const endIda = L.edges[ida].pts[L.edges[ida].pts.length - 1];
  const startVuelta = L.edges[vuelta].pts[0];
  const first = bt.flowAt(holdB).token;
  assert.ok(first.xy, 'token glides during the hold');
  assert.ok(Math.abs(first.xy[0] - endIda[0]) < 1e-6 && Math.abs(first.xy[1] - endIda[1]) < 1e-6);
  const rest = bt.flowAt(holdB + 11).token;
  assert.ok(rest.xy && Math.abs(rest.xy[0] - startVuelta[0]) < 1e-6 && Math.abs(rest.xy[1] - startVuelta[1]) < 1e-6);

  // Travel along Vuelta starts at p = 0, which is where the hold left the token.
  const travelStart = bt.flowAt(bt.list[3].start);
  assert.deepEqual(travelStart.trace, [vuelta]);
  assert.equal(travelStart.token.edge, vuelta);
  assert.equal(travelStart.token.p, 0);
});

// model.mjs: exit 0 ok, 1 not ok, 2 bad input. Three small flows in a temp dir.
test('model.mjs exit codes: ok flow 0, broken flow 1 with report files, bad input 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flow-model-'));
  const okPath = join(dir, 'ok.js');
  const brokenPath = join(dir, 'broken.js');
  const badPath = join(dir, 'bad.js');
  writeFileSync(okPath, `window.FLOW = Flipbook.defineFlow({
    name: 'ok', init: { x: 'a' }, view: s => s.x,
    steps: {
      Ida: { label: 'ida', when: s => s.x === 'a', do: () => ({ x: 'b' }) },
      Vuelta: { label: 'vuelta', when: s => s.x === 'b', do: () => ({ x: 'a' }) }
    },
    rules: { Valido: { label: 'solo a o b', ok: s => s.x === 'a' || s.x === 'b' } }
  });`);
  writeFileSync(brokenPath, `window.FLOW = Flipbook.defineFlow({
    name: 'roto', init: { x: 'a' }, view: s => s.x,
    steps: {
      Ida: { label: 'ida', when: s => s.x === 'a', do: () => ({ x: 'b' }) },
      Cae: { label: 'cae', when: s => s.x === 'b', do: () => ({ x: 'd' }) }
    },
    rules: { NoCae: { label: 'no se cae', ok: s => s.x !== 'd' } }
  });`);
  writeFileSync(badPath, 'window.FLOW = Flipbook.defineFlow({ name: "sin init", steps: {} });');

  const run = (...args) => spawnSync(process.execPath, [MODEL, ...args], { encoding: 'utf8' });

  const ok = run(okPath);
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(ok.stdout, /result: OK/);

  const broken = run(brokenPath, '--write');
  assert.equal(broken.status, 1, broken.stderr + broken.stdout);
  assert.match(broken.stdout, /no se cae/);
  assert.match(broken.stdout, /2\. ida -> b/); // counterexample path in the flow's own labels
  assert.match(broken.stdout, /3\. cae -> d/);
  assert.ok(existsSync(join(dir, 'report.md')));
  assert.match(readFileSync(join(dir, 'chart.mmd'), 'utf8'), /^stateDiagram-v2/);

  const bad = run(badPath);
  assert.equal(bad.status, 2, bad.stderr + bad.stdout);
  const missing = run(join(dir, 'nope.js'));
  assert.equal(missing.status, 2);
});
