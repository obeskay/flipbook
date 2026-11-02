# Making a drawing feel alive at 12 fps

The engine draws at 12 frames per second, so one frame is 83 ms. At that rate most of the work is in
what stays still, how each motion starts and stops, and whether the loop closes.

## What boils and what stays still

Boil is the tremor of the ink. With the defaults (boilHold 2, boilVariants 3) a new ink drawing starts
every 2 frames, and the cycle repeats every 6 frames. A 48-frame loop holds eight full cycles.

| Element | Boils? | How to draw it |
|---|---|---|
| Outlines and lettering | yes | f.R, the boil stream |
| Paper | never | f.paper(), a cached cel with its own stream |
| Fills | never | m.fill(ctx, f.still(key), pts, col) |
| Positions, sizes, counts | never | computed from f.frame or f.t only |

Measured in a probe scene: the outline pixels were identical on frames 0 and 1, on 2 and 3, and on 4 and 5,
and frame 6 returned to the frame 0 drawing. A fill drawn with f.still('fill') did not change over 12 frames.
The chart helpers are the exception: drawBars and drawFunnel build fill polygons from f.R, so a bar edge
moves about one pixel per boil drawing. Its colour and position stay still. See inputs.md.

## Rest pose and closing

Choose a rest frame where the subject is in its clean pose. Reduced-motion viewers see that frame. It needs
ink: FB114 warns when under 0.3% of pixels differ strongly from the most common colour.

Every action closes. The value at the last frame equals the value at frame 0 for any motion that loops:
flow keys start and end at the same value, track returns to its start, and wave periods divide the frame count.
The frame count itself must be a multiple of boilHold times boilVariants (FB005).

## One main action and two or three small loops

The main action is the one thing the eye follows: a hop, a turn, a settle. The small loops are breath, blink,
gaze and sway. They stay slow and small, and they use different periods that all divide the loop, so they do
not line up into a visible pattern.

Periods must divide the loop. In a 48-frame loop use 48, 24, 16, 12, 8 or 6. A period of 10 does not: frame 47 is
0.7 of a cycle into the motion while frame 0 is at its start, so the loop jumps. The check may not flag it
(defects.md). Count it by arithmetic.

## Overlap and follow-through

follow(fn, delay, gain) returns a correction, not a value. Add it to the base. The sum equals
(1 - gain) × fn(frame) + gain × fn(frame - delay): a copy that trails by delay frames and carries gain
of the weight. Measured: with delay 2 and gain 0.5 the two forms agree to three decimals.

```js
const hop = Flipbook.flow([[0, 0], [12, 0], [16, 1], [20, 0], [48, 0]]);
const tail = Flipbook.follow(hop, 2, 0.5);
const tailLift = hop(frame) + tail(frame);   // trails the body by two frames
```

follow calls fn with one argument, the frame. Passing wave directly gives NaN, because wave also needs a period.
For overlap, start the next motion two to four frames before the previous one arrives. Keep both on the same
frame clock so the seam still closes.

## Seeded variety

seeded(i, salt) returns a stable 0 to 1 value for each index. Use it for per-element differences: feather
length, leaf angle, flicker phase. Math.random is flagged by FB001, and its output changes on every run.

## flow or track

| Function | Use it when | Behaviour |
|---|---|---|
| flow(keys) | the motion never stops, or passes through poses | monotone cubic: no overshoot, never holds at a key |
| track(keys) | the motion arrives and rests | eases in and out of each key; a third element 'out' gives ease-out on that arrival |

Two keys in flow give a straight ramp. Add a middle key to get a curve. Use track for landings, turns and
settles, and flow for sway, drift and anything that must keep moving.

## Frame counts at 12 fps

Design targets, not measurements of real animals or objects.

| Action | Frames | Seconds | Notes |
|---|---|---|---|
| Blink | 3 closed | 0.25 | bell over 4 frames, repeats every 24 or 48 |
| Hop, takeoff to landing | 8 | 0.67 | add 2 to 4 crouch frames before takeoff |
| Gaze turn, one way | 6 | 0.5 | track; hold 8 to 12 frames, then return in 8 |
| Breath | 48 | 4 | wave, amplitude 1 to 2 percent of body height |
| Settle after a move | 4 to 6 | 0.33 to 0.5 | track whose last key is 'out' |
| Pendulum swing | 24 | 2 | constant amplitude; the bell() helper is a bump, not this |
| Enter | 6 to 8 | 0.5 to 0.67 | track 'out' plus an opacity ramp over the first 3 frames |
| Exit | 6 | 0.5 | mirror of enter, opacity ramp over the last 3 frames |

## Nothing grows from a point

Do not scale a shape up from zero or from a dot. It reads as a pop. Things enter by sliding in, by a stroke
drawing on (svgStrokes with drawOn), or by opacity over a few frames. Opacity is for appearing and leaving
only. Do not fade things as a style, and do not fade a thing that is already on screen to hide a cut.

## Recipes by subject

| Subject | Main action | Small loops | Note |
|---|---|---|---|
| Bird on a wire | hop, 8 frames | blink, breath, tail follow (delay 2, gain 0.5) | feet stay on the wire at rest |
| Person at a counter | nod, or hand moves to a card | blink, breath, gaze | move one limb at a time |
| Hanging sign | slow swing on a 48-frame period | a 1-degree sway | the mounting never moves |
| Plant in a pot | lean toward the light (track) | leaves follow with delay 2, seeded lengths | the pot and shadow stay put |
| Cup with steam | none | wisps rise and leave by opacity | steam period divides the loop |
| Stamp landing on a card | drop, then settle (track 'out') | none | the shadow hatch shifts, not scales |

## Checklist for a sheet and an onion render

Run `node scripts/render.mjs scene.html --format 1:1 --sheet --onion`. The sheet holds 12 evenly spaced frames.
The onion is a running mean over one loop, so a static part stays sharp and a moving part leaves a trail.

- Rest frame shows the subject clearly, not a near-empty sheet.
- Frames 0 and 1 show the same ink. Frame 2 shows a new drawing.
- Paper and fills look identical in every cell.
- Consecutive cells move by similar distances. A gap or a cluster marks a pop or a stall.
- Every action has a stop, and the stop is a settle, not a wall.
- The onion trail is a smooth arc. A ghost far from the path is a teleport.
- Static things (labels, lines of the table, paper) are sharp in the onion.
- The first and last cells look nearly the same.
