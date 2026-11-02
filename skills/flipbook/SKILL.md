---
name: flipbook
description: >-
  Turn something you already have into a living hand-drawn animation, checked on real pixels and
  delivered in every format. A process becomes a drawn chart that is model-checked while it is drawn, so
  the drawing can expose a real bug (dead ends, unreachable steps, broken rules) and trace the path to it.
  Numbers become a drawn funnel, bars or lines. Any SVG gets drawn by a pen and coloured in. A script or
  lyric gets written word by word. A character gets idle life. Ten materials (pen and coloured pencil,
  crayon, watercolor, charcoal, riso, mokuhanga, cyanotype, gouache, engraving, suminagashi) swap with one
  word. Outputs MP4, WhatsApp-ready MP4, GIF, WebM, PNG, one-file HTML and animated WhatsApp stickers, with
  no build step and no runtime dependencies. Use when the user wants something explained, shown, drawn or
  animated by hand: "dibújame cómo funciona", "explica este flujo", "hazlo a mano", "ilustra estos datos",
  "anima este logo", "sticker animado", "video para WhatsApp", "explainer", "storybook", "hand-drawn",
  "flipbook", "line boil", or when a process, funnel or logo needs to reach non-technical people.
---

# Flipbook

Hand it a process, numbers, an SVG or a script. It hands back a drawing that moves, and proof that it works.

Pick the input first. It decides everything else.

| You have | Recipe | What comes back | The surprise |
|---|---|---|---|
| A process (code, a chat flow, a policy) | `taqueria` | A drawn chart walked by a token | It is checked as it is drawn; a broken rule gets traced in red |
| Numbers | `embudo` | A funnel, bars or lines drawn in pencil | The headline is computed from the data, so new data redraws the story |
| An SVG (logo, icon, map) | `dibujar-svg` | A pen draws it stroke by stroke, then colours it in | Swap one file, any SVG works |
| A script or lyric | `cancion` | Words written on the frame they are said | Reading time is enforced by a check |
| A character or mascot | `ajolote` | A creature that breathes, blinks and shifts its weight | Same scene becomes a WhatsApp sticker with one flag |

Not for: interactive UI components with state machines (`rive-animator`), vector playback from designers
(`lottie-animator`), edited video with footage (`hyperframes`).

If checking a process finds a real bug, that is the headline. Tell the user before anything else, in plain words.

---

## The loop

Never stop at "it renders". A scene can pass every build and still be dead, unreadable or boiling like TV static.

```bash
node scripts/new.mjs taqueria ./mi-flujo            # start from the closest recipe, never from zero
node scripts/model.mjs ./mi-flujo/flow.js --write   # flows only: exit 1 = the process is wrong
node scripts/lint.mjs ./mi-flujo/scene.html         # static: randomness, glow, paper on the boil stream
node scripts/check.mjs ./mi-flujo/scene.html        # real pixels at 16:9, 1:1 and 9:16
node scripts/render.mjs ./mi-flujo/scene.html --format 1:1 --fast --sheet --onion
```

`new.mjs` copies the recipe with its own engine, so the folder is portable; adapt it by editing `TOKENS` and the
input file. Files land in `out/` beside the scene unless you pass `--out`.

Then read the sheet and the onion with the Read tool. `--fast` and `check --format 1:1` while iterating; the full
check takes minutes. Judge by eye what no check can see: is it charming, does the silhouette read at phone size,
does one thing happen at a time.

Deliver:

```bash
node scripts/render.mjs scene.html --format all --whatsapp   # H.264 under 16 MB, 16:9 + 1:1 + 9:16
node scripts/render.mjs scene.html --sticker                 # animated WebP, 512x512, transparent, under 500 KB
node scripts/render.mjs scene.html --html                    # one file, double click, or drop it in a landing
node scripts/render.mjs scene.html --material all --sheet    # the same scene in all ten materials
node scripts/render.mjs scene.html --png                     # the rest frame, one per format: the poster
node scripts/render.mjs scene.html --mp4 --audio pista.mp3   # also --gif --webm --frames a-b --loops n
```

---

## A scene

A scene is one HTML file that runs from `file://`. No modules, no build. Every number lives in `TOKENS`.

```html
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#F5EFE3}canvas{display:block;margin:auto;max-width:100vw;max-height:100vh}</style>
<canvas id="c"></canvas>
<script src="../../engine/flipbook.js"></script>
<script>
const TOKENS = { frames: 48, hop: [[0, 0], [8, 10], [14, -46], [22, 6], [30, 0]] };
const { Animator, drawObject, flow, write } = Flipbook;
const hop = flow(TOKENS.hop);

function render(f) {
  const { ctx, frame, w, h, unit, m } = f;
  f.paper();
  const x = w / 2, y = h / 2 + 120 * unit + hop(frame) * unit;
  f.probe('hop', hop(frame));
  const pot = [[x - 90 * unit, y - 110 * unit], [x + 90 * unit, y - 110 * unit],
               [x + 70 * unit, y], [x - 70 * unit, y]];
  drawObject(f, 'pot', pot, { fill: m.inks[0], shadow: true });
  write(ctx, f.R, 'buenos días', x, y - 200 * unit, 64 * unit, { cen: true });
}
window.anim = new Animator(document.getElementById('c'), render,
  { width: 1080, height: 1080, frames: TOKENS.frames, loop: true });
window.anim.play();
</script>
```

`render(f)` gets:

| Field | What it is | Rule |
|---|---|---|
| `f.R` | Boil stream: same numbers for 2 frames, 3 drawings, then repeats | Ink tremor only. Never paper, never placement |
| `f.still(key)` | Stream that never changes between frames | Hatch, scatter, props, anything that must not boil |
| `f.paper()` | The material's paper, cached | Call it first. `?paper=none` makes it transparent |
| `f.cel(key, draw, opts)` | Paint once, reuse. `{boil:true}` paints one per drawing | Backgrounds and busy props, to stay under 83 ms |
| `f.m` | Current material: `paper ink inks fill stroke substrate` | Ask it for colours and marks, so the material can swap |
| `f.unit` | `min(w,h)/1080` | Multiply every size, so every format works |
| `frame t time beat` | Where you are | The only source of time |
| `f.probe(name, v)` | Records a channel | The checker fails it on a teleport or an open loop. End the name with `!` to allow a real cut |
| `f.simple` | True for stickers (`?simple=1`) | Flat fills, fewer details, so it fits in 500 KB |

Any scene takes `?material=riso&seed=7&w=1080&h=1920&frame=12&paper=none` with no code. Reduced motion shows
`restFrame`. Off screen and hidden tabs pause on their own. Build every drawn thing with `drawObject`, every
word with `write`, every move with `flow` or `track`.

---

## What makes it read as drawn

1. **Only ink boils.** Paper, fills and placement stay still; the outline redraws on 2s through 3 drawings. A page
   where everything shimmers reads as a broken TV. The check fails past 18 percent of pixels changing.
2. **Time comes from `frame`, always.** No `Math.random`, `Date` or timers: same seed, same pixels, in any
   order. That is what makes renders and checks possible.
3. **The paper is real.** Pencil fills catch on a paper tooth, sit slightly off the outline and leave slivers.
   Shadows are hatch marks outside the shape. Never a flat fill.
4. **Nothing teleports, nothing stops dead.** `flow` for acting through poses, `track` for one move, `follow` for
   parts that arrive late. Rest, anticipate, act, settle, rest again. Every action closes.
5. **One main action, two or three small loops.** Periods divide the loop length or it pops at the seam.
6. **One thing at a time.** One accent per scene, generous paper, words big enough at 390 px wide.
7. **Rest frame is a finished drawing**: it is what reduced motion, a poster and a paused tab show.

Full craft: [references/alive.md](references/alive.md), [references/taste.md](references/taste.md).

---

## Modelling a process

Read the real process first (the code, the exported flow, the policy) and cite where each step came from.

```js
window.FLOW = Flipbook.defineFlow({ name: 'pedido', init: { order: 'fila', stock: true },
  final: s => s.order === 'entregado',
  steps: {
    Pagar:   { label: 'pagas', when: s => s.order === 'fila', do: s => ({ ...s, order: 'pagado' }) },
    Servir:  { label: 'te sirven', when: s => s.order === 'pagado' && s.stock, do: s => ({ ...s, order: 'entregado' }) },
    Acabar:  { label: 'se acaba', when: s => s.stock, do: s => ({ ...s, stock: false }) },
  },
  rules: { NuncaSinTacos: { label: 'nunca te cobran sin tacos', ok: s => s.order !== 'pagado' || s.stock } },
  view: s => s.order });
```

This one is wrong on purpose: you can pay, then the stock runs out, and you are stuck having paid. `model.mjs`
searches every reachable state and reports the shortest path to each broken rule, every dead end and every
step that can never happen, and exits 1. Keep a rule that should break visible with `expectBroken: true`, and the
scene can draw that path with `flowBeats`. Picking rules and reading the report:
[references/inputs.md](references/inputs.md).

---

## When it goes wrong

| You see | Code | Fix |
|---|---|---|
| The whole page shimmers | `FB003`, `FB104` | Paper or fill on `f.R`. Use `f.paper()` and `f.still(key)` |
| Renders differ between runs | `FB001`, `FB102` | Randomness, clock or state that leaks across frames |
| A pop once per loop | `FB005`, `FB106`, `FB113` | `frames` must be a multiple of 6 by default; periods must divide it; close every channel |
| A jump mid scene | `FB112` | Use `flow` or `track`. A real cut gets a name ending in `!` |
| Fine at 1:1, broken at 9:16 or `--fast` | `FB108`, `FB109`, `FB115` | Lay out from `w` and `h`; sizes from `f.unit`, never fixed pixels |
| Too fast to read | `FB111` | Leave `frames` out of the beat so `readingFrames` sets it |
| Text too small | `FB110` | Under 11 px with the canvas 390 px wide. Write bigger or write less; 16:9 rarely passes, so send phones 1:1 or 9:16 |
| A letter is missing | `FB116` | The lettering has no glyph for it. Reword |
| The chart does not fit | `layoutFlow` error | Pass `fit: true`, shorten labels, or give it more height |
| Stutters | `FB107` | Move static things into `f.cel`; lower the fill count |
| A glow, a typed label, a ruler line | `FB007`, `FB008`, `FB009` | Remove the glow; use `write`; use `f.m.stroke` |

Every code and threshold, plus what no check can catch: [references/defects.md](references/defects.md).
Inputs and materials in depth: [references/inputs.md](references/inputs.md), [references/materials.md](references/materials.md).

---

## Done means

1. `model.mjs` ran for flows. Exit 1 is a finding about the process, not a failure of your work: tell the user
   first, never invent a step to hide it. Once they know, mark it `expectBroken` or `expectStuck` and draw it.
2. `lint.mjs` and `check.mjs` report no errors at all three formats (16:9 may keep `FB110` warnings).
3. You read a sheet of the final render, and the rest frame works as a poster.
4. Copy is in the user's language with its accents.
5. You report what you rendered and checked, and what you did not (real phone, real sound, a real WhatsApp send).
