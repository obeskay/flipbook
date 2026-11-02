# Taste: composition and drawing craft

A drawing looks hand-made when it leaves things out, puts weight on the ground, and lets edges be a little
uneven. Most of the fixes below are about removing something.

## Composition

- One thing per moment. One subject moves; the rest holds. If two things move, one of them is a loop.
- Generous paper. At rest, the subject sits in the middle third and the margins stay empty.
- One accent. The subject takes m.inks[0]; everything else is ink or a muted tint. drawBars highlights one bar
  with the accent for the same reason.
- Compose 1:1 and 9:16 first, then 16:9. check reports FB110 for 16:9 at default text sizes because a 1920 px
  canvas shown at 390 px scales text by 0.2.
- Text is part of the drawing. Use write(), not fillText and not HTML. Lowercase x-height should reach about 6 px
  when the canvas is shown 390 px wide. Lowercase x-height is about 0.52 of the size, so the size must be about
  0.03 times the canvas width (32 at 1080). The check floor (FB110) is lower, about 0.02 times the width (21.8 at
  1080). Use the higher number.

## Weight and contact

- Standing things get a short contact shadow under them: shadowHatch, or the shadow option of drawObject for the
  pencil material. Other materials get a flat offset tone.
- A thing that lifts loses shadow weight: the shadow gets smaller and lighter as the object rises (the hop in
  alive.md does this).
- Line weight varies. penLine's press and w options give thick-thin; a heavier base line makes the object sit.

## Fills and outlines

- Misregister the fills. pencilFill offsets by 1 to 2 px in a random direction, and drawOn offsets each fill by
  about 1.6 units. Keep the offset. An exact alignment reads as a vector fill.
- Shadows are hatch, never blur. shadowHatch hatches the area outside the shape only.
- Outline the silhouette only. Outline the union of a cluster; inner pieces get fills and no line.

## House rules

- No glows, no neon, no shadowBlur, no lighter or screen compositing, no gradient used as material. The engine
  already draws radial gradients in two materials (cyanotype paper, watercolor blooms); do not add more in a scene.
- No HUD, no frame counter, no progress bar, no title outside the canvas.
- A celebration runs once and stays under 2.5 s: 29 frames or fewer at 12 fps.
- Copy is short, factual and sober. Example: "Llega en veinte minutos."
- Nothing moves without a reason. If a motion has no job, delete it.

## What looks fake, and the fix

| Symptom | Fix |
|---|---|
| Outline on every piece of a cluster; a coil of rings | Outline the union; inner edges get fills only |
| Two fills overlap and the overlap reads as a darker lens | Make the areas share an edge, or keep the overlap on purpose as the darker tone |
| A floating object with no shadow | Hatch a contact shadow under it; shrink it when it lifts |
| Every line has the same weight | Vary press and w; heavier at the base |
| A fill of one flat colour | Keep pencil's two hatch layers, or use a material with tooth |
| Corners meet exactly | Let closed outlines overshoot 1.5 to 2.8 px; penLine does this on its own |
| Motion that is perfectly even | flow for sway; track with 'out' for each landing |
| Words that look printed | write() boils with the ink; keep f.R for lettering |
| Halo or glow around the subject | Remove it. Use an ink border or a hatch shadow |
| Paper that crawls | Draw paper with f.paper(); keep f.R for ink only |
| Label on the accent colour is unreadable | Use the paper colour for the text, or move the label outside the shape |
| Label cut at a frame edge | Wrap, shorten or move it inside (FB108) |
| Joints that look pinned | Start the limb two frames after the body moves: follow with delay 2 |
