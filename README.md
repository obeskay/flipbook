# flipbook

**Hand-drawn animation from a process, numbers, an SVG or a script, checked on the rendered pixels before it ships.**

An agent skill. It writes one HTML scene, renders it in Chrome, and reads the frames back: a beat too short to read, labels off the frame or on top of each other, a loop that jumps at the seam, paper that boils. A process is model-checked while it is drawn, so a broken rule shows up as a red path, not a bug report.

![The taquería flow drawing itself; the token walks every path and stops on the broken rule](assets/taqueria.webp)

The example plants a bug on purpose: paying never checks whether the trompo still has meat. `model.mjs` searches every reachable state and reports the shortest path to the broken rule (order, the pastor runs out, pay, no tacos), and the drawing traces that path in red. The loop above is that scene, rendered by `render.mjs` from a fresh `new.mjs taqueria`.

## Quick start

In Claude Code:

```bash
/plugin install flipbook --marketplace obeskay/flipbook
```

Then ask for *"draw our refund flow and show me where it breaks"*.

The loop also runs on its own. It needs Node 22 or later, Google Chrome (or `CHROME` set to its path) and ffmpeg; there is nothing to install:

```bash
git clone https://github.com/obeskay/flipbook && cd flipbook/skills/flipbook
node scripts/new.mjs taqueria ./mi-flujo                    # a copy of the closest recipe
node scripts/model.mjs ./mi-flujo/flow.js                   # the planted bug, its shortest path (declared expected: exit 0)
node scripts/lint.mjs ./mi-flujo/scene.html                 # PASS, or the defect code and its fix
node scripts/check.mjs ./mi-flujo/scene.html --format 1:1   # real pixels, PASS in about 20 s
node scripts/render.mjs ./mi-flujo/scene.html --format 1:1 --fast --sheet --onion
```

In a few seconds `mi-flujo/out/scene/` holds a contact sheet and an onion skin, every frame stacked so the spacing shows the easing. Drop `--fast` and add `--mp4`, `--gif` or `--sticker` for the deliverable.

## What it makes

| Input | Recipe | What comes back |
|---|---|---|
| A process (code, a chat flow, a policy) | `taqueria` | A chart walked by a token. Broken rules are traced in red. |
| Numbers | `embudo` | A funnel in pencil. The biggest drop is circled, and its loss is computed from the data. |
| An SVG (logo, icon, map) | `dibujar-svg` | A pen draws it stroke by stroke, then colours it in ([sheet](assets/dibujar.png)). |
| A script or lyric | `cancion` | Words written on the frame they are said. A check enforces the reading time. |
| A character or mascot | `ajolote` | Breathes, blinks, sways its gills, hops once. The same scene becomes a sticker with one flag. |

Outputs: MP4, WhatsApp-ready MP4, GIF, WebM, PNG, one-file HTML and animated WebP stickers. A scene is one HTML file that opens from `file://`, with no build step and no runtime dependencies.

![Ajolote, one 8-second loop](assets/ajolote.gif)

![The ajolote in ten materials](assets/materiales.png)

The sheet runs left to right, top to bottom: crayon, watercolor, charcoal, riso, mokuhanga, cyanotype, gouache, engraving, suminagashi, pencil.

## What it does not do

It does not draw from a text prompt alone: a scene is meant to start from the closest of the five recipes and be edited from there. It is not a vector editor or a 3D tool, it draws on a 12 frames per second clock, the hand-drawn cadence, and it adds a soundtrack you supply rather than making one. Rendering needs a local Chrome and ffmpeg.

## Install

### As a Claude Code plugin

```bash
/plugin install flipbook --marketplace obeskay/flipbook
```

That needs Claude Code 2.1.275 or later. On older versions: `/plugin marketplace add obeskay/flipbook`, then `/plugin install flipbook@flipbook`.

### As a plain skill

From the repo root, symlink `skills/flipbook` into your agent's skills folder. For Claude Code that is `~/.claude/skills`:

```bash
ln -s "$PWD/skills/flipbook" ~/.claude/skills/flipbook
```

## The loop

Run these from `skills/flipbook`:

```bash
node scripts/new.mjs taqueria ./mi-flujo            # start from the closest recipe, never from zero
node scripts/model.mjs ./mi-flujo/flow.js --write   # flows only: exit 1 = the process is wrong
node scripts/lint.mjs ./mi-flujo/scene.html         # static: randomness, glow, paper on the boil stream
node scripts/check.mjs ./mi-flujo/scene.html        # real pixels at 16:9, 1:1 and 9:16
node scripts/render.mjs ./mi-flujo/scene.html --format 1:1 --fast --sheet --onion
```

Then read the sheet and the onion. `SKILL.md` has the delivery commands, and `references/defects.md` lists every code.

## Test

```bash
npm test
```

## License

MIT. See [LICENSE](LICENSE).
