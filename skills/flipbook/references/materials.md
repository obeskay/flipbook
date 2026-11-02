# Materials

A material is a registry entry: a palette, an ink, a list of inks and a paper tooth. Choose one with
`?material=name` on the scene URL, with `--material name` in render.mjs, or with `material` in the Animator options.
`render.mjs --material all --sheet` draws every material in one contact sheet.

Timing is warm median milliseconds per frame, measured in headless Chrome on examples/ajolote/scene.html
(96 frames, 1080 by 1080, three passes after one cold pass). This Mac was shared: the load average was 20 to 28 on
10 cores during the runs. Two runs differed by up to 1.8 times, so each cell gives the lower and upper value.
The frame budget at 12 fps is 83 ms. Phone hardware was not measured.

| Material | Look | Fits | ms (range) | p95 ms (range) | Gotchas |
|---|---|---|---|---|---|
| pencil (default) | coloured pencil hatch on warm paper with fibres, pen outline | most scenes, the default look | 19 to 35 | 24 to 44 | Level with engraving. drawObject caches pencil marks, so a moving shape stays cheap; direct m.fill calls re-hatch each frame unless wrapped in f.cel |
| crayon | waxy scribble on a visible square grid | playful, children's book | 17 to 28 | 24 to 33 | The grid is visible and reads as graph paper |
| watercolor | translucent washes with bloom edges | soft nature, food, warm scenes | 6 to 10 | 10 to 12 | Default fill alpha is 0.26, so a disc reads pale. Blooms are radial gradients |
| charcoal | smudged scribble on linen-textured paper | night, moody, portraits | 41 to 60 | 58 to 83 | Slowest in both runs. Its p95 reached the budget on the loaded run |
| riso | halftone dots; a second offset plate in pink | posters, two-colour pieces | 5 to 8 | 6 to 10 | Every stroke gets a pink offset plate unless a `plate` colour is passed. Visible as a pink fringe |
| mokuhanga | flat shapes with gouge marks on chain-lined paper | woodblock, Japanese print | 0.6 to 1.2 | 1.0 to 1.7 | The gouge texture comes with the fill; check small shapes in a sheet first |
| cyanotype | prussian blue with bleached near-white ink | one-colour pieces | 0.5 to 0.9 | 0.9 to 1.4 | Monochrome: every ink is blue or white. The paper has a lighter centre that reads as a glow |
| gouache | opaque flat paint with a small offset shadow | bold posters, flat shapes | 0.5 to 1.0 | 0.8 to 1.9 | Flat ink with a shadow; little tonal range |
| engraving | copperplate line fill over a plate-mark border | diagrams, old-book, technical | 23 to 35 | 31 to 45 | The plate mark frames the canvas. The fill is the line field |
| suminagashi | ink marbling clipped to the shape, blue water lines on the paper | calm, abstract | 7 to 13 | 10 to 15 | The water lines run across the whole sheet |

Paper is a cached cel in every material, so after the first render it costs one drawImage per frame.

## Gradients inside the engine

Two materials draw radial gradients: watercolor (the bloom spots) and cyanotype (the paper vignette). The lint
only reads scene scripts, so FB007 does not see them. The house rules ban glows and gradients used as material.
Use cyanotype knowingly, or choose another material.

## Checks on each material

`render.mjs examples/ajolote/scene.html --format 1:1 --material all --sheet` drew all ten materials into
`materials.png` (four cells per row, 480 px each). The cells have no labels. The order is printed on the last
line of the run: crayon, watercolor, charcoal, riso, mokuhanga, cyanotype, gouache, engraving, suminagashi,
pencil. The Look column describes that sheet, not the palette values.

## Simple mode and stickers

`?simple=1` sets `f.simple`. Pencil in drawObject then drops the cast shadow, fills with a flat multiply wash, and
lays a paper-coloured band under each outline, so nothing hatches. The other materials do not read the flag.

`render.mjs --sticker` renders 512 px with `simple=1` and `paper=none`, so the background is transparent. It tries
frame steps 1, 2, 3, 4 and 6 (every nth frame) in that order. For each step it tries WebP qualities 0.9, 0.8, 0.7,
0.6, 0.5 and 0.4, and keeps the first file under 500 KB. A step is skipped when it leaves fewer than 12 frames or
under 2 fps. The sticker uses the run's material and seed. The ajolote lands on every 4th frame (24 frames at 3 fps)
at quality 0.5, 496 KB, on 2026-11-01. Every attempt before it, steps 1 to 3 and step 4 at qualities 0.9 to 0.6,
went over 500 KB.

## Adding a material

The registry is a plain object, so a scene can add an entry before the Animator is built (tested):

```js
Flipbook.MATERIALS.sepia = { name: 'Sepia test', palette: 'SUMI_WA', ink: 'sumi', inks: ['indigo', 'kintsugi'], tooth: 'grid' };
```

Steps:

1. Palette. `ink`, every key in `inks`, and `paper` if given must exist in the palette named by `palette`
   (paper defaults to 'substrate'). Add a palette with `PALETTES.NAME = { substrate: [r, g, b], ... }`.
2. Registry entry. `MATERIALS.name = { name, palette, ink, inks, tooth }`. Engine-side entries live in
   engine/parts/10-media.js or in a new part, as the pencil entry does in engine/parts/20-dry.js.
3. Tooth. Known values are grid, chain, linen, grit, plate, water and emulsion. Any other value gives plain
   paper with grain and no ruling.
4. Look. Add a case to the switch in paintFill and paintStroke. Without a case the default branch draws a
   crayon-like diagonal hatch with an outline, which is what the test material showed.
5. Rebuild after an engine change: `node scripts/bundle.mjs`.
6. Check it: `node scripts/render.mjs scene.html --material name --png`.

render.mjs stops with the list of known materials when the name is wrong. A URL such as `?material=sepiaa` falls
back silently to crayon (measured). Check the sheet after any rename.
