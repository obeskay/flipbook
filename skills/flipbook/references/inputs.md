# Inputs: where the drawing comes from

A drawing starts from one of four inputs. Each is a plain script beside scene.html that sets one window global,
so the scene opens by double click.

| Input | Global | Comes from |
|---|---|---|
| flow | window.FLOW | a process in code, a config, a state table or a chat flow export |
| data | window.DATA | numbers from a query, a CSV, a dashboard export |
| svg | window.ART | an SVG file or markup you already have |
| story | a beats list in the scene | a script, caption or lyric |

The snippets below ran against the bundled engine in headless Chrome. The probe under "Probing without a browser"
runs in Node.

## flow

### Reading a process out of real code

1. List the state fields that change a decision (order status, payment, stock).
2. Each branch that changes state is a step: when(s) is the guard copied from the code, do(s) the next state.
3. Each outcome that must never happen is a rule: ok(s) is true on every reachable state.
4. Mark end states with final(s), or the model reports them as stuck.
5. view(s) gives a short label; concrete states with one view become one node.

The snippet below passes the model. The buggy variant is the same file with Cook not requiring payment (its `when` becomes `s.order === 'placed'`).

```js
window.FLOW = Flipbook.defineFlow({
  name: 'Pedido',
  init: { order: 'none', pay: 'none' },
  final: s => s.order === 'delivered' || s.order === 'cancelled',
  steps: {
    Order:   { label: 'haces el pedido', when: s => s.order === 'none', do: s => ({ ...s, order: 'placed' }) },
    Pay:     { label: 'pagas', when: s => s.order === 'placed' && s.pay === 'none', do: s => ({ ...s, pay: 'paid' }) },
    Cook:    { label: 'cocinan', when: s => s.order === 'placed' && s.pay === 'paid', do: s => ({ ...s, order: 'cooked' }) },
    Deliver: { label: 'entregan', when: s => s.order === 'cooked', do: s => ({ ...s, order: 'delivered' }) },
    Cancel:  { label: 'cancelas', when: s => s.order === 'placed' && s.pay === 'none', do: s => ({ ...s, order: 'cancelled' }) }
  },
  rules: {
    NeverDeliverUnpaid: { label: 'nunca entregas sin cobro', ok: s => !(s.order === 'delivered' && s.pay !== 'paid') }
  },
  view: s => `${s.order} / ${s.pay}`
});
```

### Rules worth writing

- Never deliver without payment. Every path ends (final states plus the deadlock check). No step is unreachable.
- A bug you have chosen to leave gets expectBroken: true. The model then passes and prints the break.
- A dead end the process really has, such as waiting for a manager who is not a step, gets
  `expectStuck: s => bool` on the flow. It matches the stuck states, and those no longer fail the run. An
  expectStuck that matches no deadlock fails the run, the same as an expectBroken rule that holds. Exit 1 from a
  real dead end is a finding to report to the user before anything else (defects.md).

### Running the model

    node scripts/model.mjs path/to/flow.js     # --write also writes report.md and chart.mmd

Each broken rule prints its shortest path, then deadlocks, dead steps and a result line. With Cook running unpaid the
counterexample is `none / none`, `haces el pedido`, `cocinan`, `entregan`, ending at `delivered / none`. Exit codes are in defects.md.

### Sizing the chart

`layoutFlow(check, { w, h, dir, sz, fit })`. dir is `'TB'` (top to bottom, the default) or `'LR'` (left to right);
any other value throws. The rank count sets how far the chart spreads along dir. In TB each rank is a row, so
height usually binds; in LR, width binds.

- Without fit, a sz that does not fit throws, and the message gives the rank count, the axis that binds with the px
  it needs, and the largest integer sz that fits. Lower sz, give the frame more room, or shorten labels.
- With `fit: true`, sz and smaller sizes are tried down to 22, and the size used is returned as `layout.sz`. The
  taqueria recipe uses it so one scene serves 16:9, 1:1 and 9:16.

### Probing without a browser

Save this as `probe.mjs` in the folder that holds `skills/`, then run `node probe.mjs`. It loads the bundle through
Node and prints the model result and the size a layout ends up at, with no Chrome:

```js
import { createRequire } from 'node:module';
const Flipbook = createRequire(import.meta.url)('./skills/flipbook/engine/flipbook.js');
const flow = Flipbook.defineFlow({ init: { x: 'a' }, view: s => s.x, final: s => s.x === 'c', steps: { Ida: { label: 'ida', when: s => s.x === 'a', do: () => ({ x: 'b' }) }, Fin: { label: 'fin', when: s => s.x === 'b', do: () => ({ x: 'c' }) } } });
const check = Flipbook.checkFlow(flow);
console.log(check.ok, Flipbook.layoutFlow(check, { w: 1080, h: 1080, dir: 'TB', sz: 40, fit: true }).sz);
```

### Turning a counterexample into beats

check.broken[i].path ({state, view, step} per entry) becomes beats: 8 travel frames per edge, holds sized by readingFrames.

```js
const CHECK = Flipbook.checkFlow(window.FLOW);
const BAD = CHECK.broken[0].path;
let L = Flipbook.layoutFlow(CHECK, { w: 1080, h: 1080, dir: 'TB' });
const WALK = Flipbook.flowBeats(BAD, 12, { layout: L });
// Animator option: frames: WALK.total
// in render(f):
//   if (L.w !== f.w || L.h !== f.h) L = Flipbook.layoutFlow(CHECK, { w: f.w, h: f.h, dir: 'TB' });
//   const s = WALK.flowAt(f.frame);
//   Flipbook.drawFlow(f, L, { active: s.active, visited: s.visited, trace: s.trace, token: s.token });
```

The walk ends on the broken state, so set `loop: false`; with loop true the end jumps back, unreported (defects.md).

## data

| Helper | Second argument | Notes |
|---|---|---|
| drawBars(f, rows, box, o) | rows: [{label, value}] | bars rise from one baseline |
| drawFunnel(f, rows, box, o) | rows: [{label, value}], top first | strips narrow; step ratios sit in the gaps |
| drawLines(f, series, box, o) | series: [{name, points: [[x, y], ...]}] | axes and nice ticks computed |

box is {x, y, w, h} in canvas pixels. o.p runs 0 to 1 (default f.t); o.highlight, o.accent, o.format, and for
drawLines o.yMin and o.yMax. Numbers print with `toLocaleString('es-MX')` unless o.format is given.

A reveal driven by p runs once. Under `loop: true` the bars snippet below fails FB106 at the seam (2.5 to 2.6 times the
median step in a test scene); use `loop: false`, or the pattern under Charts that loop.

drawFunnel stacks strips top to bottom. Each strip is as wide as its value, floored at 30 px × unit so a thin step still
shows, and its value sits at the right edge. Labels sit in a left column at 34 px, down to a 31 px floor, wrapped to fit
the row pitch. When no size fits beside the strip, every label moves above its own strip. The percent of each step sits
in the gap below the strip. The biggest drop is drawn in the accent (o.highlight picks another gap, -1 for none); the
accent defaults to the first ink. Strips are the second ink mixed 20 percent toward paper.
`funnelLayout(rows, box, U)` returns the geometry without drawing, and throws when the rows do not fit the box. The
embudo example draws its ring and note on that geometry.

The headline comes from the data, never from a typed string:

```js
const best = DATA.rows.reduce((a, b) => (b.value > a.value ? b : a));
const headline = `${best.label}: ${Number(best.value).toLocaleString('es-MX')}`;
Flipbook.drawBars(f, DATA.rows, { x: w * 0.08, y: h * 0.2, w: w * 0.84, h: h * 0.7 }, { p: t, highlight: 0 });
```

Do not declare a top-level const top: the page already has window.top, and the script fails (FB101).

### Charts that loop

p runs from 0 to 1 and resets, so a looping reveal jumps at the seam. Reveal, hold, then fade out so frame N-1 is
nearly blank, like frame 0. Tested for drawLines (without the fade, a thin-line chart had a seam over 15 times its median
step and no finding, defects.md):

```js
// inside render(f): const { ctx, w, h, frame } = f;
const p = Flipbook.seg(frame, 0, 30), a = 1 - Flipbook.seg(frame, 40, 47);
ctx.save();
ctx.globalAlpha = a;
Flipbook.drawLines(f, DATA.months, { x: w * 0.08, y: h * 0.2, w: w * 0.84, h: h * 0.7 }, { p, yMin: 0 });
ctx.restore();
```

## svg

svgStrokes turns geometry into pen strokes once; drawOn runs the pen over them. svgStrokes takes w, h (1080 by default),
margin (0) and step (2 px between samples); fit must be "contain".
```js
const STROKES = Flipbook.svgStrokes(window.ART, { w: 1080, h: 1080, margin: 120 });
// in render(f):
Flipbook.drawOn(f, STROKES, Flipbook.seg(f.frame, 0, 30), { colorFrom: 0.7 });
```

Limits seen in a test SVG:

- Only path, circle, ellipse, rect, line, polyline and polygon are read. `<text>` is skipped silently; use write().
- A url(#gradient) fill is dropped, so the shape is outlined only.
- Each subpath fills on its own: a hole inside a path fills solid and reads as a darker disc.
- Content in defs, clipPath, mask, symbol, pattern or marker is skipped. fit must stay "contain". It needs a browser.
- A large fill fading in trips FB104 with no boil at all; an unlooped fade also trips FB106.

## story

beats(list, fps) lays beats end to end. Each item is {name, say} or {name, frames}. readingFrames(text, fps) gives
the reading time, ceil(fps × (0.6 + words / 2.6)): a seven-word sentence is 40 frames at 12 fps.

```js
const LINES = [
  { name: 'salida', say: 'Tu pedido ya salió de la cocina.' },
  { name: 'llegada', say: 'Llega en veinte minutos.' },
  { name: 'cierre', frames: 18 }
];
const WORD_STEP = 3;                        // frames between word reveals (our own timing)
const BT = Flipbook.beats(LINES, 12);
// Animator option: frames: BT.total
// in render(f):
//   const b = BT.at(f.frame);
//   const shown = Math.floor((f.frame - b.start) / WORD_STEP) + 1;   // words to draw
```

Word timing is not an engine feature; the scene draws the first `shown` words, after
`Flipbook.wrap(text, maxWidth, sz)`. wrap returns one string per line and breaks on newlines. It is balanced: the fewest
lines the width allows, with the widest line as narrow as possible, so a short last word is not left alone. At 520 px and
size 40, `Tu pedido ya salió de la cocina y llega en veinte minutos a tu mesa` gives `Tu pedido ya` / `salió de la cocina` /
`y llega en veinte` / `minutos a tu mesa`; a greedy wrap ends with `mesa` alone. A beat shorter than its reading time fails
FB111, so take its length from readingFrames.
