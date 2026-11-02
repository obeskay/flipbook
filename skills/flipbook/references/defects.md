# Defects: what the codes mean and what the checks miss

scripts/lint.mjs reads the scene's own scripts (FB0xx). scripts/check.mjs renders the scene in Chrome and
judges pixels and the draw trace (FB1xx). Lint errors and check errors exit 1; warnings do not fail a run.
Thresholds below are the values in the code.

| Symptom | Code | Cause | Fix |
|---|---|---|---|
| Frames differ between runs | FB001 error | Math.random, Date.now, new Date, performance.now, setTimeout, setInterval or requestAnimationFrame in the scene | Use f.frame, f.t, f.R or f.still(key) |
| Checks cannot find the animation | FB002 error | No assignment to window.anim | window.anim = new Flipbook.Animator(...) |
| Paper crawls | FB003 error | substrate, grain or paintPaper called with the boil stream | f.paper(); keep R for ink |
| Slow, busy boil | FB004 warn | Literal fps above 16 | fps: 12 |
| Loop jumps once per cycle | FB005 error | Literal frames not a multiple of boilHold × boilVariants (6 by default) | Round up; the message gives the number |
| HTML words sit beside the drawing | FB006 warn | h1, h2 or p inside body | Draw the words with write() |
| Glow around shapes | FB007 error | shadowBlur, createRadialGradient, or lighter or screen compositing | Delete it |
| Type looks like a font | FB008 warn | ctx.fillText | Flipbook.write |
| Ruler-straight line | FB009 warn | ctx, g or context .stroke() | f.m.stroke(ctx, f.R, pts, col) |
| No TOKENS constant | FB010 warn | No const TOKENS, or declared after line 40 of the scene script | Move TOKENS to the top |
| Script does not load | FB011 error | src path missing | Relative path, bare absolute path, or file:/// URL |
| Scene will not open by double click | FB012 error | type="module" script | Plain script, no import or export |
| Scene will not run | FB101 error | window.anim missing, a thrown error, a console error, an uncaught exception, or a blocked dialog | Fix the first message printed. After an uncaught exception, a missing window.anim is a consequence and is not printed |
| Image changes with draw order | FB102 error | State outside the frame, or a cel keyed without all its inputs | Keep state in f.frame or f.t; key cels by every input |
| Blank frames | FB103 error | More than 99.7% of pixels are one colour | Draw the scene; paper from f.paper() |
| Paper boils | FB104 error | More than 18% of pixels change by over 10 levels between consecutive frames. A large fill fading in trips it too | f.paper(); R for ink. camera:true only for a moving view |
| Scene is still | FB105 warn | No two sampled frames differ | Animate with f.t or f.frame |
| Loop seam jumps | FB106 error | Frame N-1 to frame 0 changes more than 2.5 times the median step (tested only when the median is above 0.1%) | Periodic motion; a period that divides the frame count |
| Render too slow for 12 fps | FB107 warn | p95 render above 1000 / fps (83 ms) | f.cel for parts that do not change; fewer large fills |
| Text runs off the canvas | FB108 error | A write() box extends more than 0.5 px past the edge | Wrap, shorten or move |
| Two labels overlap | FB109 error | Two write() boxes overlap by over 1 px on both axes in one frame | Move one; give them room |
| Text too small on a phone | FB110 warn | Box height 1.4 × size is under 11 px at 390 px wide | size ≥ canvas width / 49.6 |
| Beat too short to read | FB111 error | Beat frames below readingFrames(say, fps) | Lengthen the beat, or cut words |
| Probe jumps | FB112 error | Numeric probe moves more than 45% of its range between sampled consecutive frames | Ease it. A trailing ! in the name exempts FB112 only |
| Probe does not close the loop | FB113 error | Frame 0 and frame N-1 differ by more than 45% of the range | Make the probe periodic in f.t |
| Rest frame looks blank | FB114 warn | Under 0.3% of pixels differ by over 40 levels in any channel from the most common colour at restFrame | Add a line or fill to the rest pose |
| Layout breaks at half size | FB115 error | FB108 or FB109 fails with the scene at half the format's size (540 × 540 for 1:1). The layout uses fixed pixels such as 760 or 900 on a 1080 canvas | Lay out from w, h and unit; the message gives the size |
| Letter missing from the lettering | FB116 error | write() was given a character with no glyph, so it draws as a blank gap. The text box is in the trace | Reword with a character from the list below, or cut it |

Lettering glyphs (every character write() draws; FB116 flags any other; the first one is the space): ` !"#$%&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz¡¿ÁÉÍÑÓÚÜáéíñóúü`

## model.mjs exit codes

Exit 1 is a finding about the process, not a failure of your work: the flow shows a real dead end, a broken rule or
an unreachable step. Tell the user what it found first. Then either fix the process, or accept the finding with
expectBroken (a rule) or expectStuck (a dead end) and draw it. Exit 0 is never reached by inventing a step or
marking a dead end final to hide it.

| Exit | Meaning |
|---|---|
| 0 | Every rule holds, or breaks only where expectBroken is true. Every deadlock is matched by expectStuck. No dead step, cap not reached |
| 1 | A rule breaks without expectBroken; an expectBroken rule holds; a deadlock that expectStuck does not match; expectStuck matches no deadlock; a dead step; the 20000-state cap was reached |
| 2 | Bad input: usage, missing file, missing bundle, the flow file does not load, defineFlow rejects it, or no window.FLOW |

## Silent traps: no check catches these

- Lettering reaches only the characters in the glyph line above. write() draws a missing one as a blank gap, and
  FB116 reports it only for text passed to write(). Text from fillText, HTML or a raw path is not checked.
  The euro sign, curly quotes, ö and ç are not in the table.
- A typo in ?material= falls back to crayon. render.mjs reports an unknown --material, but the URL does not.
- FB106 is skipped when the median frame step is at or below 0.1%. A thin-line chart with a seam over 15 times its
  median passed. A walk with long holds and a seam over 500 times its median passed. Run the seam by eye on the sheet.
- FB106 compares the seam to the median step. A bad period passes when its seam jump is only one or two ordinary
  steps: in a 48-frame loop, periods 7 and 10 gave seam ratios of 1.15 and 1.37 with no finding. Check periods by
  arithmetic.
- FB112 and FB113 use sampled frames only. Scenes longer than 120 frames are sampled at 120 pairs, so a probe jump
  between unsampled frames passes. The trace checks (FB108 to FB111) also see only draws from sampled frames.
- Text drawn with fillText, HTML or a raw path is not in the trace, so FB108 to FB110 never see it. FB110 measures
  the 1.4 × size box, and lowercase x-height is about 0.52 × size, so lowercase at the floor is small on a phone.
- camera:true only switches FB104 off under check. The engine ignores the option.
- Lint is text matching. FB009 knows the names ctx, g and context; FB003 knows three function names; FB006 knows
  h1, h2 and p. Code that uses other names passes.
- A rule marked expectBroken that does break exits 0. The break is printed but does not fail the run.
- The model checks only states it reaches. A state past the 20000 cap is never examined, but the cap itself exits 1.
- FB107 times this machine after warm-up. It says nothing about a phone.
- In SVG input, a text element and a gradient fill disappear with no message. See inputs.md.
