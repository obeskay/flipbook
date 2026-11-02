// Media: shaders, procedural geometries, and the material registry (paper, ink, fill, stroke).

// --- 4. Drawing & Media Shaders ---

function fillPoly(ctx, pts, col, a = 1) {
  ctx.save();
  polyPath(ctx, pts);
  ctx.fillStyle = rgba(col, a);
  ctx.fill();
  ctx.restore();
}

function grain(ctx, R, pts, col = PALETTE.CREAM) {
  const [bx0, by0, bx1, by1] = bbox(pts);
  ctx.save();
  polyPath(ctx, pts);
  ctx.clip();
  const n = Math.round(((bx1 - bx0) * (by1 - by0)) / 1600);
  for (let i = 0; i < n; i++) {
    const s = 0.8 + R() * 1.2;
    ctx.fillStyle = R() < 0.6 ? 'rgba(45,40,34,0.05)' : 'rgba(255,252,244,0.08)';
    ctx.fillRect(bx0 + R() * (bx1 - bx0), by0 + R() * (by1 - by0), s, s);
  }
  ctx.restore();
}

function sheet(ctx, R, x0, y0, x1, y1, col = PALETTE.CREAM, o = {}) {
  const rough = o.rough ?? 14;
  const sd = ri(R, 0, 9999);
  const P = tornPath(R, x0, y0, x1, y1, rough, sd);
  // Drop shadow
  fillPoly(ctx, P.map(p => [p[0] + 5, p[1] + 7]), [12, 9, 7], 0.25);
  // Paper base (double pass for opacity)
  fillPoly(ctx, P, col, 1);
  fillPoly(ctx, P, col, 1);
  grain(ctx, R, P, col);
  // Deckle edges highlight and shadow contour
  const core = P.concat([P[0]]);
  sk(ctx, R, core, { col: [251, 247, 237], w: 1.8, a: 0.45, amp: 0.4 });
  sk(ctx, R, core.map(p => [p[0] + rd(R, 1, 2), p[1] + rd(R, 1, 2)]), { col: shade(col, 0.22), w: 1, a: 0.25, amp: 0.5 });
  return P;
}

function sk(ctx, R, pts, o = {}) {
  const w = o.w ?? 1.3, a0 = o.a ?? 0.7;
  const rs = resample(pts, Math.max(2.4, w * 1.5));
  const n = rs.length;
  if (n < 2) return;
  const col = (o.col || PALETTE.INK).slice();
  const passes = o.passes ?? 1;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let p = 0; p < passes; p++) {
    const amp = (o.amp ?? (w * 0.38 + 0.55)) * (p ? 1.5 : 1);
    const alpha = a0 * (p ? 0.35 : 1);
    const q = wob(R, rs, amp);
    ctx.beginPath();
    ctx.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
    ctx.strokeStyle = rgba(col, alpha);
    ctx.lineWidth = w;
    ctx.stroke();
  }
  ctx.restore();
}

function hair(ctx, R, pts, col = PALETTE.INK, a = 0.7, o = {}) {
  sk(ctx, R, pts, { col, a, w: o.w ?? 0.9, amp: o.amp ?? 0.35, passes: 1 });
}

function pencilScribble(ctx, R, pts, cols, o = {}) {
  const [x0, y0, x1, y1] = bbox(pts);
  const size = o.size ?? 2.5, sp = o.sp ?? size * 1.2, flow = o.flow ?? 0.4;
  const diag = Math.hypot(x1 - x0, y1 - y0);
  const cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2;
  const passes = o.passes ?? cols.length;

  ctx.save();
  polyPath(ctx, pts);
  ctx.clip();
  for (let p = 0; p < passes; p++) {
    const ang = (o.ang ?? 0.7) + p * 0.8;
    const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    const col = cols[p % cols.length];
    for (let t = -diag / 2; t <= diag / 2; t += sp * rd(R, 0.85, 1.2)) {
      const linePts = [];
      for (let a = -diag / 2; a <= diag / 2; a += 8) {
        linePts.push([cx0 + nx * t + dx * a + rd(R, -0.8, 0.8), cy0 + ny * t + dy * a + rd(R, -0.8, 0.8)]);
      }
      sk(ctx, R, linePts, { col, w: size, a: flow, amp: 0.6 });
    }
  }
  ctx.restore();
}

function scribFill(ctx, R, pts, sp = 4, a = 0.15, o = {}) {
  const [x0, y0, x1, y1] = bbox(pts);
  const col = o.col || PALETTE.INK;
  ctx.save();
  polyPath(ctx, pts);
  ctx.clip();
  let cy = y0;
  ctx.beginPath();
  let dir = 1;
  while (cy <= y1) {
    const xLeft = x0 + rd(R, -2, 4);
    const xRight = x1 + rd(R, -4, 2);
    if (dir > 0) {
      ctx.lineTo(xRight, cy + rd(R, -2, 2));
    } else {
      ctx.lineTo(xLeft, cy + rd(R, -2, 2));
    }
    dir *= -1;
    cy += sp * rd(R, 0.8, 1.3);
  }
  ctx.strokeStyle = rgba(col, a);
  ctx.lineWidth = o.w ?? 0.8;
  ctx.stroke();
  ctx.restore();
}

function wash(ctx, R, pts, col, size = 18, a = 0.25) {
  const rs = resample(pts, 6);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let pass = 0; pass < 3; pass++) {
    const q = wob(R, rs, size * 0.15);
    ctx.beginPath();
    ctx.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
    ctx.strokeStyle = rgba(col, a * (pass === 0 ? 0.5 : 0.25));
    ctx.lineWidth = size * (1 + pass * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Wax Crayon & Oil Pastel Shader.
 * Thick, textured, waxy resistance with stochastic crumb scatter.
 */
function crayonStroke(ctx, R, pts, o = {}) {
  const w = o.w ?? 3.5;
  const col = o.col || PALETTE.MARK;
  const a0 = o.a ?? 0.85;
  const rs = resample(pts, Math.max(1.8, w * 0.8));
  if (rs.length < 2) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Multi-fiber wax pass
  const fibers = o.fibers ?? 4;
  for (let f = 0; f < fibers; f++) {
    const thread = [];
    for (let i = 0; i < rs.length; i++) {
      const [nx, ny] = normalAt(rs, i);
      const jitter = (rd(R, -0.5, 0.5) * w * 0.45);
      const along = rd(R, -0.4, 0.4);
      thread.push([rs[i][0] + nx * jitter + along, rs[i][1] + ny * jitter + along]);
    }
    const q = wob(R, thread, 0.8);
    ctx.beginPath();
    ctx.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
    ctx.strokeStyle = rgba(col, a0 * rd(R, 0.45, 0.85));
    ctx.lineWidth = Math.max(0.8, w * rd(R, 0.3, 0.6));
    ctx.stroke();
  }

  // 2. Pigment crumb granules in paper tooth
  const crumbCount = Math.round(rs.length * 0.35);
  for (let c = 0; c < crumbCount; c++) {
    const idx = ri(R, 0, rs.length - 1);
    const [nx, ny] = normalAt(rs, idx);
    const dist = (rd(R, -1, 1) * w * 0.65);
    const cx = rs[idx][0] + nx * dist + rd(R, -1, 1);
    const cy = rs[idx][1] + ny * dist + rd(R, -1, 1);
    const sz = rd(R, 0.8, 1.8);
    ctx.fillStyle = rgba(shade(col, rd(R, 0.05, 0.2)), a0 * rd(R, 0.6, 0.95));
    ctx.fillRect(cx, cy, sz, sz);
  }

  ctx.restore();
}

/**
 * Watercolor & Sumi-e Wash Shader.
 * Wet-on-wet capillary diffusion, coffee-ring edge pooling, translucent glazes.
 */
function watercolorWash(ctx, R, pts, o = {}) {
  const col = o.col || PALETTE.COBALT;
  const a = o.a ?? 0.22;
  const passes = o.passes ?? 3;
  const rs = chaikin(resample(pts, 4), true, 2);
  if (rs.length < 3) return;

  ctx.save();

  // 1. Translucent blooming glazes with FBM turbulence
  for (let p = 0; p < passes; p++) {
    const perturbed = [];
    const seedP = ri(R, 0, 9999);
    for (let i = 0; i < rs.length; i++) {
      const [x, y] = rs[i];
      const turb = (fbm(x * 0.02, y * 0.02, seedP, 2) - 0.5) * (12 + p * 6);
      perturbed.push([x + turb, y + turb]);
    }
    const smooth = chaikin(perturbed, true, 2);
    ctx.beginPath();
    ctx.moveTo(smooth[0][0], smooth[0][1]);
    for (let i = 1; i < smooth.length; i++) ctx.lineTo(smooth[i][0], smooth[i][1]);
    ctx.closePath();
    ctx.fillStyle = rgba(col, a * (0.35 + p * 0.25));
    ctx.fill();
  }

  // 2. Capillary fringing: darker dried edge pooling (coffee-ring effect)
  const edgePts = wob(R, rs, 1.2);
  ctx.beginPath();
  ctx.moveTo(edgePts[0][0], edgePts[0][1]);
  for (let i = 1; i < edgePts.length; i++) ctx.lineTo(edgePts[i][0], edgePts[i][1]);
  ctx.closePath();
  ctx.strokeStyle = rgba(shade(col, 0.25), a * 1.8);
  ctx.lineWidth = o.rimWidth ?? 2.2;
  ctx.stroke();

  // 3. Bleed granulation blooms
  if (o.blooms ?? true) {
    const [bx0, by0, bx1, by1] = bbox(rs);
    const bloomCount = Math.max(1, Math.round(((bx1 - bx0) * (by1 - by0)) / 12000));
    for (let b = 0; b < bloomCount; b++) {
      const gX = rd(R, bx0, bx1), gY = rd(R, by0, by1);
      const rad = rd(R, 8, 22);
      const grad = ctx.createRadialGradient(gX, gY, 1, gX, gY, rad);
      grad.addColorStop(0, rgba(tint(col, 0.2), a * 0.5));
      grad.addColorStop(0.7, rgba(col, a * 0.2));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(gX, gY, rad, 0, TAU);
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * Charcoal & Dry Graphite Shader.
 * Soft smudged carbon core with stippled tooth particles and cross-hatch gradients.
 */
function charcoalShade(ctx, R, pts, o = {}) {
  const col = o.col || PALETTE.VOID;
  const w = o.w ?? 5.0;
  const a0 = o.a ?? 0.65;
  const rs = resample(pts, 3.0);
  if (rs.length < 2) return;

  ctx.save();

  // 1. Soft smudge core (feathered wash)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const smudgePts = wob(R, rs, 1.8);
  ctx.beginPath();
  ctx.moveTo(smudgePts[0][0], smudgePts[0][1]);
  for (let i = 1; i < smudgePts.length; i++) ctx.lineTo(smudgePts[i][0], smudgePts[i][1]);
  ctx.strokeStyle = rgba(col, a0 * 0.25);
  ctx.lineWidth = w * 1.8;
  ctx.stroke();

  // 2. High-friction carbon tooth scatter
  const density = o.density ?? 1.2;
  for (let i = 0; i < rs.length; i++) {
    const [nx, ny] = normalAt(rs, i);
    const count = Math.round(w * density);
    for (let k = 0; k < count; k++) {
      const spread = (rd(R, -1, 1) + rd(R, -1, 1)) * 0.5 * w;
      const px = rs[i][0] + nx * spread + rd(R, -0.6, 0.6);
      const py = rs[i][1] + ny * spread + rd(R, -0.6, 0.6);
      const alpha = a0 * (1 - Math.abs(spread) / (w * 1.2)) * rd(R, 0.4, 0.9);
      if (alpha > 0.05) {
        ctx.fillStyle = rgba(col, alpha);
        ctx.fillRect(px, py, 1.1, 1.1);
      }
    }
  }

  ctx.restore();
}

/**
 * Risograph Soy-Ink Halftone Shader.
 * One plain screen, rotated by o.angle, with the same dot radius everywhere in the fill (one tone, no pattern).
 * The plate slips: the clip shifts by a misregistration offset and each dot jitters by a fraction of a pixel.
 */
function risoHalftone(ctx, R, pts, col, o = {}) {
  const dotSpacing = o.spacing ?? 5.0;
  const r = (o.maxRadius ?? 2.2) * (o.tone ?? 1);
  const misreg = o.misregistration ?? [rd(R, -2, 2), rd(R, -2, 2)];
  const [bx0, by0, bx1, by1] = bbox(pts);
  const ang = o.angle ?? 0.785, cos = Math.cos(ang), sin = Math.sin(ang);
  const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
  const reach = Math.hypot(bx1 - bx0, by1 - by0) / 2 + 2 * dotSpacing;

  ctx.save();
  polyPath(ctx, pts.map(p => [p[0] + misreg[0], p[1] + misreg[1]]));
  ctx.clip();
  ctx.fillStyle = rgba(col, o.a ?? 0.85);
  ctx.beginPath();
  for (let v = -reach; v <= reach; v += dotSpacing) {
    for (let u = -reach; u <= reach; u += dotSpacing) {
      const x = mx + u * cos - v * sin + rd(R, -0.3, 0.3);
      const y = my + u * sin + v * cos + rd(R, -0.3, 0.3);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
  }
  ctx.fill();
  ctx.restore();
}

/**
 * Japanese Mokuhanga & Linocut Relief Print Shader.
 * Ink roller striations, wood grain transfer, chisel/gouge chatter, and bokashi fade.
 */
function linocutRelief(ctx, R, pts, col, o = {}) {
  const [bx0, by0, bx1, by1] = bbox(pts);
  const a0 = o.a ?? 0.92;
  const bokashi = o.bokashi ?? null;

  ctx.save();
  polyPath(ctx, pts);
  ctx.clip();

  // 1. Base relief ink plate (with optional bokashi water fade)
  if (bokashi) {
    const grad = ctx.createLinearGradient(0, bokashi.startY ?? by0, 0, bokashi.endY ?? by1);
    grad.addColorStop(0, rgba(bokashi.startCol || col, a0));
    grad.addColorStop(1, rgba(bokashi.endCol || [255, 255, 255], bokashi.endA ?? 0.15));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = rgba(col, a0);
  }
  ctx.fill();

  // 2. Brayer ink roller striations (horizontal wood/roller grain)
  const rollerSpacing = o.rollerSpacing ?? 3.5;
  ctx.lineWidth = 0.8;
  for (let y = by0; y <= by1; y += rollerSpacing) {
    const jitterY = y + rd(R, -0.6, 0.6);
    ctx.beginPath();
    ctx.moveTo(bx0, jitterY);
    ctx.lineTo(bx1, jitterY);
    ctx.strokeStyle = rgba(shade(col, 0.15), rd(R, 0.08, 0.22));
    ctx.stroke();
  }

  // 3. Woodgrain fiber pore dither
  const poreCount = Math.round(((bx1 - bx0) * (by1 - by0)) / 1400);
  for (let i = 0; i < poreCount; i++) {
    const px = rd(R, bx0, bx1);
    const py = rd(R, by0, by1);
    const pw = rd(R, 1.5, 4.5);
    ctx.fillStyle = rgba(shade(col, 0.2), rd(R, 0.12, 0.35));
    ctx.fillRect(px, py, pw, 0.9);
  }

  // 4. Negative gouge chatter cuts (curved chisel gouge scoops)
  if (o.gouges ?? true) {
    const gougeCount = o.gougeCount ?? Math.min(18, Math.round((by1 - by0) / 18));
    ctx.strokeStyle = rgba(o.substrateCol || [247, 242, 230], rd(R, 0.75, 0.95));
    ctx.lineWidth = o.gougeWidth ?? 2.2;
    ctx.lineCap = 'round';
    for (let g = 0; g < gougeCount; g++) {
      const gx = rd(R, bx0 + 10, bx1 - 10);
      const gy = rd(R, by0 + 10, by1 - 10);
      const glen = rd(R, 12, 32);
      const gang = rd(R, -0.6, 0.6);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + Math.cos(gang) * glen * 0.5 + rd(R, -3, 3), gy + Math.sin(gang) * glen * 0.5 + rd(R, -3, 3), gx + Math.cos(gang) * glen, gy + Math.sin(gang) * glen);
      ctx.stroke();
    }
  }

  ctx.restore();

  // 5. Edge chisel border: slight ink bleed / pressure ridge along carved edge
  const carvedEdge = wob(R, pts, 0.8);
  ctx.beginPath();
  ctx.moveTo(carvedEdge[0][0], carvedEdge[0][1]);
  for (let i = 1; i < carvedEdge.length; i++) ctx.lineTo(carvedEdge[i][0], carvedEdge[i][1]);
  ctx.closePath();
  ctx.strokeStyle = rgba(shade(col, 0.3), a0 * 0.8);
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/**
 * Prussian Blue Solar Cyanotype Shader.
 * Ferric photochemical contact print: a hard-edged sun-bleached reserve, crystal speckle and leaf venation.
 * No halo or blur: the edge is the exposure edge.
 */
function cyanotypeWash(ctx, R, pts, o = {}) {
  const [bx0, by0, bx1, by1] = bbox(pts);
  const prussian = o.prussian || [12, 36, 72];
  const bleached = o.bleached || [238, 244, 250];
  const cerulean = o.cerulean || [36, 92, 152];
  const a0 = o.a ?? 0.88;

  ctx.save();

  // 1. Interior bleached reserve (where plant blocked ultraviolet rays): one flat tone with a hard edge, no halo
  polyPath(ctx, pts);
  ctx.fillStyle = rgba(bleached, a0);
  ctx.fill();
  polyPath(ctx, pts);
  ctx.clip();

  // 2. Emulsion crystallization speckle in contact zones
  const crystalCount = Math.round(((bx1 - bx0) * (by1 - by0)) / 1600);
  for (let i = 0; i < crystalCount; i++) {
    const cx = rd(R, bx0, bx1);
    const cy = rd(R, by0, by1);
    const sz = rd(R, 0.8, 1.8);
    ctx.fillStyle = rgba(prussian, rd(R, 0.1, 0.3));
    ctx.fillRect(cx, cy, sz, sz);
  }

  // 3. Internal vascular venation / translucent skeletal lines
  if (o.veins && o.veins.length > 0) {
    ctx.lineCap = 'round';
    for (const vein of o.veins) {
      const vPts = wob(R, vein, 0.6);
      ctx.beginPath();
      ctx.moveTo(vPts[0][0], vPts[0][1]);
      for (let i = 1; i < vPts.length; i++) ctx.lineTo(vPts[i][0], vPts[i][1]);
      ctx.strokeStyle = rgba(cerulean, rd(R, 0.55, 0.85));
      ctx.lineWidth = o.veinWidth ?? 1.2;
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Mid-Century Matte Gouache & Paper Cutout Shader.
 * Thick opaque mineral pigment with micro-cast paper shadow and razor blade contours.
 */
function gouacheCutout(ctx, R, pts, col, o = {}) {
  const a0 = o.a ?? 0.98;
  const shadowDist = o.shadow ?? 6;

  ctx.save();

  // 1. Subtle tactile paper cast shadow (gives authentic collage depth)
  if (shadowDist > 0) {
    const shadowPts = pts.map(p => [p[0] + shadowDist * 0.6, p[1] + shadowDist]);
    polyPath(ctx, shadowPts);
    ctx.fillStyle = 'rgba(28, 22, 18, 0.16)';
    ctx.fill();
  }

  // 2. Razor-cut opaque paper body
  polyPath(ctx, pts);
  ctx.fillStyle = rgba(col, a0);
  ctx.fill();

  // 3. Chalky mineral drying texture (dry brush grain in gouache)
  ctx.clip();
  const [bx0, by0, bx1, by1] = bbox(pts);
  const grainCount = Math.round(((bx1 - bx0) * (by1 - by0)) / 1100);
  for (let i = 0; i < grainCount; i++) {
    const gx = rd(R, bx0, bx1);
    const gy = rd(R, by0, by1);
    const sz = rd(R, 0.8, 2.2);
    ctx.fillStyle = R() > 0.5 ? rgba(tint(col, 0.15), rd(R, 0.12, 0.3)) : rgba(shade(col, 0.15), rd(R, 0.08, 0.22));
    ctx.fillRect(gx, gy, sz, sz);
  }

  ctx.restore();

  // 4. Razor paper edge with slight hand-cut irregularity
  const edgePts = wob(R, pts, 0.5);
  ctx.beginPath();
  ctx.moveTo(edgePts[0][0], edgePts[0][1]);
  for (let i = 1; i < edgePts.length; i++) ctx.lineTo(edgePts[i][0], edgePts[i][1]);
  ctx.closePath();
  ctx.strokeStyle = rgba(shade(col, 0.15), a0 * 0.45);
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/**
 * 18th-Century Intaglio Copperplate Engraving Shader.
 * Etched burin hatchings along flow field streamlines with iron gall ink,
 * variable line weight swelling in shadow zones, and plate tone wiped surface.
 */
function copperplateEngraving(ctx, R, streamlines, o = {}) {
  const col = o.col || [24, 22, 26];
  const maxW = o.maxW ?? 2.4;
  const minW = o.minW ?? 0.6;
  const a0 = o.a ?? 0.90;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const line of streamlines) {
    if (line.length < 2) continue;
    const n = line.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = line[i], p1 = line[i + 1];
      const t = i / (n - 1);
      // Bell-shaped swell in the center, tapering at the tips (classic burin cut)
      const swell = Math.sin(t * Math.PI);
      const w = minW + swell * (maxW - minW);

      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.strokeStyle = rgba(col, a0 * (0.65 + swell * 0.35));
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }

  // Burin stipples (microscopic dot clusters in deep plate tone)
  if (o.stipples ?? true) {
    const count = o.stippleCount ?? 60;
    for (let s = 0; s < count; s++) {
      const line = pk(R, streamlines);
      if (!line || line.length === 0) continue;
      const pt = pk(R, line);
      const sx = pt[0] + rd(R, -6, 6);
      const sy = pt[1] + rd(R, -6, 6);
      ctx.fillStyle = rgba(col, rd(R, 0.4, 0.85));
      ctx.fillRect(sx, sy, rd(R, 0.8, 1.4), rd(R, 0.8, 1.4));
    }
  }

  ctx.restore();
}

/**
 * Heian Japanese Suminagashi Floating Ink Marbling Shader.
 * Fluid capillary concentric rings deformed by natural water curl turbulence.
 */
function suminagashiMarbling(ctx, R, cx, cy, o = {}) {
  const numRings = o.numRings ?? 18;
  const ringSpacing = o.ringSpacing ?? 10;
  const cols = o.cols || [[22, 20, 24], [30, 52, 86], [186, 58, 50]];
  const seed = o.seed ?? 33;
  const curlFreq = o.curlFreq ?? 0.005;
  const curlAmp = o.curlAmp ?? 28;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let r = 1; r <= numRings; r++) {
    const radius = r * ringSpacing;
    const col = cols[(r - 1) % cols.length];
    const steps = Math.max(36, Math.round(radius * 0.9));
    const pts = [];

    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU;
      const baseX = cx + Math.cos(a) * radius;
      const baseY = cy + Math.sin(a) * (radius * 0.72);
      // Fluid curl vector field displacement
      const curl = (fbm(baseX * curlFreq, baseY * curlFreq, seed, 3) - 0.5) * curlAmp;
      pts.push([baseX + Math.cos(a + 1.2) * curl, baseY + Math.sin(a + 1.2) * curl]);
    }

    const smoothRing = chaikin(pts, true, 2);
    ctx.beginPath();
    ctx.moveTo(smoothRing[0][0], smoothRing[0][1]);
    for (let i = 1; i < smoothRing.length; i++) ctx.lineTo(smoothRing[i][0], smoothRing[i][1]);
    ctx.closePath();
    ctx.strokeStyle = rgba(col, o.a ?? 0.82);
    ctx.lineWidth = o.w ?? (1.2 + (r % 3) * 0.6);
    ctx.stroke();
  }

  ctx.restore();
}

// --- Parametric Geometries (Botanical, Celestial, Wave, Polyhedra, Ginkgo, Fern, Cutout) ---

/**
 * Japanese Ginkgo Biloba Leaf geometry with central cleft and radiating fluted ridges.
 */
function ginkgoLeaf(cx, cy, radius, angle, spread = 1.35) {
  const pts = [];
  const flutes = [];
  const baseStem = [cx - Math.cos(angle) * (radius * 0.6), cy - Math.sin(angle) * (radius * 0.6)];
  const petiole = [cx, cy];

  const steps = 32;
  const startAng = angle - spread;
  const endAng = angle + spread;
  const cleftIdx = Math.floor(steps / 2);

  pts.push(petiole);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = startAng + t * (endAng - startAng);
    // Indent at central cleft
    const cleftDist = 1.0 - Math.exp(-Math.pow((i - cleftIdx) / 3.2, 2)) * 0.28;
    const r = radius * cleftDist * (0.92 + Math.sin(t * Math.PI * 8) * 0.03);
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    pts.push([px, py]);

    if (i % 3 === 0) {
      flutes.push([petiole, [px, py]]);
    }
  }

  return { outline: pts, stem: [baseStem, petiole], flutes };
}

/**
 * Botanical Fern Frond with tapered bilateral leaflets (pinnae).
 */
function fernFrond(startX, startY, length, angle, numPinnae = 12) {
  const rachis = [];
  const pinnaeLeft = [];
  const pinnaeRight = [];
  const closedPts = [];

  const curveAng = angle + 0.18;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const curA = angle + Math.sin(t * Math.PI * 0.5) * 0.25;
    const dist = t * length;
    rachis.push([startX + Math.cos(curA) * dist, startY + Math.sin(curA) * dist]);
  }

  for (let p = 1; p <= numPinnae; p++) {
    const t = p / (numPinnae + 1);
    const rIdx = Math.round(t * (rachis.length - 1));
    const rPt = rachis[rIdx];
    const pinnaLen = Math.sin(t * Math.PI) * (length * 0.26);

    const normalL = angle - Math.PI * 0.5 + 0.2;
    const normalR = angle + Math.PI * 0.5 - 0.2;

    const tipL = [rPt[0] + Math.cos(normalL) * pinnaLen, rPt[1] + Math.sin(normalL) * pinnaLen];
    const tipR = [rPt[0] + Math.cos(normalR) * pinnaLen, rPt[1] + Math.sin(normalR) * pinnaLen];

    pinnaeLeft.push([rPt, tipL]);
    pinnaeRight.push([rPt, tipR]);
  }

  return { rachis, pinnaeLeft, pinnaeRight };
}

/**
 * Organic flora cutout with undulating rounded lobes.
 */
function cutoutFlora(cx, cy, radius, lobes = 6) {
  const pts = [];
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const r = radius * (0.65 + Math.cos(a * lobes) * 0.35);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return chaikin(pts, true, 2);
}

function botanicalTree(R, startX, startY, length, angle, depth = 0, maxDepth = 4) {
  const branches = [];
  const endX = startX + Math.cos(angle) * length;
  const endY = startY + Math.sin(angle) * length;
  branches.push({ start: [startX, startY], end: [endX, endY], depth });

  if (depth < maxDepth) {
    const numSub = ri(R, 2, 3);
    for (let i = 0; i < numSub; i++) {
      const spread = rd(R, -0.45, 0.45);
      const lenRatio = rd(R, 0.65, 0.82);
      const subBranches = botanicalTree(R, endX, endY, length * lenRatio, angle + spread, depth + 1, maxDepth);
      branches.push(...subBranches);
    }
  }
  return branches;
}

function celestialOrrery(cx, cy, radii, angles) {
  const orbits = [];
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i];
    const pts = arcPts(cx, cy, r, r * 0.65, 0, TAU, 36);
    const planetAng = angles[i % angles.length];
    const px = cx + Math.cos(planetAng) * r;
    const py = cy + Math.sin(planetAng) * r * 0.65;
    orbits.push({ ring: pts, planet: [px, py], radius: r });
  }
  return orbits;
}

function waveCurl(cx, cy, maxR, progress) {
  const pts = [];
  const steps = 42;
  const turns = 1.4;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = t * TAU * turns + progress;
    const r = maxR * Math.pow(t, 1.2);
    pts.push([cx + Math.cos(theta) * r, cy + Math.sin(theta) * r]);
  }
  return pts;
}

function projectedPolyhedron(cx, cy, radius, rotX, rotY) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1,  phi, 0], [ 1,  phi, 0], [-1, -phi, 0], [ 1, -phi, 0],
    [0, -1,  phi], [0,  1,  phi], [0, -1, -phi], [0,  1, -phi],
    [ phi, 0, -1], [ phi, 0,  1], [-phi, 0, -1], [-phi, 0,  1]
  ];
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);

  return verts.map(([x, y, z]) => {
    let x1 = x * cosY + z * sinY;
    let z1 = -x * sinY + z * cosY;
    let y2 = y * cosX - z1 * sinX;
    return [cx + x1 * (radius / 2.2), cy + y2 * (radius / 2.2)];
  });
}
// --- Material registry: palette + paper + ink + substrate/fill/stroke dispatch over the shaders ---
// Any geometry renders in any material: const M = material('riso'); M.fill(ctx, R, pts, M.inks[0]);

const MATERIALS = {
  crayon: {
    name: 'Wax Crayon', palette: 'SUMI_WA', ink: 'sumi',
    inks: ['vermilion', 'kintsugi', 'indigo', 'moss'], tooth: 'grid'
  },
  watercolor: {
    name: 'Watercolor', palette: 'BOTANICAL', ink: 'sepia_ink',
    inks: ['celadon', 'dried_rose', 'chamomile', 'fern'], tooth: 'grid'
  },
  charcoal: {
    name: 'Charcoal', palette: 'NORDIC_SLATE', ink: 'slate',
    inks: ['lichen', 'terracotta', 'amber', 'birch'], tooth: 'linen'
  },
  riso: {
    name: 'Risograph', palette: 'TOKYO_RISO', ink: 'black_drum',
    inks: ['fluo_pink', 'cornflower', 'sunflower', 'mint_soy'], tooth: 'grit'
  },
  mokuhanga: {
    name: 'Mokuhanga', palette: 'MOKUHANGA', ink: 'sumi',
    inks: ['prussian', 'persimmon', 'baren_gold', 'bokashi_sky'], tooth: 'chain'
  },
  cyanotype: {
    name: 'Cyanotype', palette: 'CYANOTYPE', ink: 'sun_bleach',
    inks: ['sun_bleach', 'cyan_wash', 'cerulean_mid'], tooth: 'emulsion', paper: 'prussian_deep'
  },
  gouache: {
    name: 'Gouache', palette: 'GOUACHE', ink: 'raw_umber',
    inks: ['ultramarine', 'burnt_ochre', 'olive_leaf', 'cadmium_lemon'], tooth: 'grit'
  },
  engraving: {
    name: 'Copperplate', palette: 'INTAGLIO', ink: 'iron_gall',
    inks: ['iron_gall', 'sepia_shadow', 'verdigris'], tooth: 'plate'
  },
  suminagashi: {
    name: 'Suminagashi', palette: 'SUMINAGASHI', ink: 'sumi',
    inks: ['indigo_wash', 'bengara', 'sumi'], tooth: 'water'
  }
};

const closeRing = pts => (pts.length > 1 && pts[0] !== pts[pts.length - 1]) ? pts.concat([pts[0]]) : pts;
const strokePath = (ctx, q) => { ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.stroke(); };

/** Paper + tooth for a material. Call first on every frame. */
function paintSubstrate(ctx, R, name, w, h) {
  if (name === 'pencil') return paintPaper(ctx, R, w, h);
  const s = MATERIALS[name] || MATERIALS.crayon, pal = PALETTES[s.palette];
  const paper = pal[s.paper || 'substrate'];
  const m = Math.min(w, h);
  ctx.save();
  if (s.tooth === 'emulsion') {
    const g = ctx.createRadialGradient(w / 2, h / 2, m * 0.1, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, rgba(mix(paper, pal.cerulean_mid, 0.45), 1));
    g.addColorStop(0.6, rgba(paper, 1));
    g.addColorStop(1, rgba(shade(paper, 0.4), 1));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const e = m * 0.03;
    sk(ctx, R, [[e, e], [w - e, e], [w - e, h - e], [e, h - e], [e, e]], { col: pal.cyan_wash, w: e * 0.9, a: 0.22, amp: 2 });
  } else {
    ctx.fillStyle = rgba(paper, 1); ctx.fillRect(0, 0, w, h);
  }
  grain(ctx, R, [[0, 0], [w, 0], [w, h], [0, h]], paper);
  ctx.lineWidth = 1;
  if (s.tooth === 'grid' || s.tooth === 'chain') {
    ctx.strokeStyle = rgba(shade(paper, 0.35), 0.10);
    const st = Math.round(m / (s.tooth === 'grid' ? 22 : 30));
    for (let y = st; y < h; y += st) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    if (s.tooth === 'grid') for (let x = st; x < w; x += st) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  } else if (s.tooth === 'linen') {
    ctx.strokeStyle = rgba(shade(paper, 0.4), 0.06);
    for (let y = 0; y < h; y += 3) { ctx.beginPath(); ctx.moveTo(0, y + rd(R, -0.3, 0.3)); ctx.lineTo(w, y + rd(R, -0.3, 0.3)); ctx.stroke(); }
    for (let x = 0; x < w; x += 3) { ctx.beginPath(); ctx.moveTo(x + rd(R, -0.3, 0.3), 0); ctx.lineTo(x + rd(R, -0.3, 0.3), h); ctx.stroke(); }
  } else if (s.tooth === 'grit') {
    const n = Math.round(w * h / 900);
    for (let i = 0; i < n; i++) { ctx.fillStyle = rgba(shade(paper, 0.5), rd(R, 0.05, 0.18)); ctx.fillRect(rd(R, 0, w), rd(R, 0, h), rd(R, 0.6, 1.6), rd(R, 0.6, 1.6)); }
  } else if (s.tooth === 'plate') {
    const e = m * 0.04;
    ctx.strokeStyle = rgba(pal.plate_tone, 0.9); ctx.lineWidth = e; ctx.strokeRect(e / 2, e / 2, w - e, h - e);
    ctx.strokeStyle = rgba(pal.sepia_shadow, 0.35); ctx.lineWidth = 1; ctx.strokeRect(e, e, w - 2 * e, h - 2 * e);
  } else if (s.tooth === 'water') {
    ctx.strokeStyle = rgba(pal.water_surface, 0.9);
    for (let i = 0; i < 6; i++) { const y = rd(R, 0, h); ctx.lineWidth = rd(R, 6, 18); strokePath(ctx, wob(R, resample([[0, y], [w, y]], 8), 3)); }
  }
  ctx.restore();
}

/** Fill a closed polygon in a material. `col` defaults to the material's first ink. */
function paintFill(ctx, R, name, pts, col, o = {}) {
  const s = MATERIALS[name] || MATERIALS.crayon, pal = PALETTES[s.palette];
  const paper = pal[s.paper || 'substrate'];
  col = col || pal[s.inks[0]];
  switch (name) {
    case 'pencil': return pencilFill(ctx, R, pts, col, o);
    case 'watercolor': return watercolorWash(ctx, R, pts, { col, a: o.a ?? 0.26, passes: 3, rimWidth: 2.4, blooms: true });
    case 'charcoal': {
      // Carbon follows the paper's tooth: dense where the tooth rises, a faint smudge under it. No stripes.
      const T = paperTooth(), b = bbox(pts), a = o.a ?? 0.8;
      ctx.save();
      polyPath(ctx, pts);
      ctx.clip();
      polyPath(ctx, pts);
      ctx.fillStyle = rgba(col, 0.2 * a);
      ctx.fill();
      for (let y = Math.floor(b[1]); y < b[3]; y += 2) {
        for (let x = Math.floor(b[0]); x < b[2]; x += 2) {
          const px = x + rd(R, 0, 2), py = y + rd(R, 0, 2);
          const t = T[((Math.floor(py) & 511) << 9) + (Math.floor(px) & 511)];
          if (R() > clamp(0.3 + (t - 0.5) * 3.5)) continue;
          ctx.fillStyle = rgba(shade(col, rd(R, 0, 0.3)), a * rd(R, 0.6, 1));
          ctx.fillRect(px, py, 1.5, 1.5);
        }
      }
      ctx.restore();
      return charcoalShade(ctx, R, closeRing(pts), { col, w: 5, a: 0.7 });
    }
    case 'riso': return risoHalftone(ctx, R, pts, col, { spacing: o.spacing ?? 4.5, maxRadius: 2.1, a: o.a ?? 0.85 });
    case 'mokuhanga': return linocutRelief(ctx, R, pts, col, { a: o.a ?? 0.92, substrateCol: paper, gougeCount: o.gougeCount });
    case 'cyanotype': return cyanotypeWash(ctx, R, pts, { prussian: pal.prussian_deep, bleached: pal.sun_bleach, cerulean: pal.cerulean_mid, veins: o.veins, a: o.a ?? 0.88 });
    case 'gouache': return gouacheCutout(ctx, R, pts, col, { shadow: o.shadow ?? 6, a: o.a ?? 0.98 });
    case 'engraving': {
      const b = bbox(pts), area = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
      ctx.save(); polyPath(ctx, pts); ctx.clip();
      // Static field anchored to the shape; only a hair of tremor per frame (line-boil law)
      const lines = flowFieldStreamlines(stream(Math.round(b[0] * 3 + b[1]) >>> 0), b, { numLines: Math.min(240, Math.round(area / 1300)), stepSize: 3.2, maxSteps: 34, scale: 0.006, seed: Math.round(b[0] + b[1]) });
      copperplateEngraving(ctx, R, lines.map(l => wob(R, l, 0.35)), { col, maxW: 1.7, minW: 0.4, stippleCount: 40 });
      ctx.restore(); return;
    }
    case 'suminagashi': {
      const b = bbox(pts), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, rad = Math.hypot(b[2] - b[0], b[3] - b[1]) * 0.6;
      ctx.save(); polyPath(ctx, pts); ctx.clip();
      suminagashiMarbling(ctx, R, cx, cy, { numRings: Math.max(6, Math.round(rad / 9)), ringSpacing: 9, cols: [col, pal.indigo_wash, pal.bengara], seed: Math.round(cx * 3 + cy), curlAmp: 22 + rd(R, -1.5, 1.5) });
      ctx.restore(); return;
    }
    default:
      pencilScribble(ctx, R, pts, [col, shade(col, 0.15)], { size: 3, sp: 4.2, flow: o.a ?? 0.55 });
      return crayonStroke(ctx, R, closeRing(pts), { col: shade(col, 0.25), w: 3 });
  }
}

/** Stroke a polyline in a material. `col` defaults to the material's ink. */
function paintStroke(ctx, R, name, pts, col, o = {}) {
  const s = MATERIALS[name] || MATERIALS.crayon, pal = PALETTES[s.palette];
  col = col || pal[s.ink];
  const w = o.w ?? 2.4, a = o.a ?? 0.85;
  switch (name) {
    case 'pencil': return penLine(ctx, R, pts, col, o);
    case 'watercolor': wash(ctx, R, pts, col, w * 3.2, 0.16); return sk(ctx, R, pts, { col, w: w * 0.8, a });
    case 'charcoal': return charcoalShade(ctx, R, pts, { col, w: w * 1.8, a });
    case 'riso': { const dx = rd(R, -2, 2), dy = rd(R, -2, 2); sk(ctx, R, pts.map(p => [p[0] + dx, p[1] + dy]), { col: o.plate || pal.fluo_pink, w: w * 1.1, a: 0.55 }); return sk(ctx, R, pts, { col, w, a: 0.9 }); }
    case 'mokuhanga': return sk(ctx, R, pts, { col, w: w * 1.7, a: 0.95, amp: 0.5 });
    case 'cyanotype': return sk(ctx, R, pts, { col: pal.sun_bleach, w, a: 0.85 });
    case 'gouache': return sk(ctx, R, pts, { col, w: w * 1.4, a: 0.95, amp: 0.4 });
    case 'engraving': return copperplateEngraving(ctx, R, [wob(R, chaikin(resample(pts, 3), false, 1), 0.3)], { col, maxW: w, minW: w * 0.25, stipples: false });
    case 'suminagashi': return sk(ctx, R, pts, { col, w: w * 0.8, a: 0.8, passes: 2 });
    default: return crayonStroke(ctx, R, pts, { col, w: w * 1.3, a });
  }
}

/** Resolve a material into a bound object: { key, name, pal, paper, ink, inks, substrate(), fill(), stroke() } */
function material(name) {
  const key = MATERIALS[name] ? name : 'crayon';
  const s = MATERIALS[key], pal = PALETTES[s.palette];
  return {
    key, name: s.name, pal,
    paper: pal[s.paper || 'substrate'],
    ink: pal[s.ink],
    inks: s.inks.map(k => pal[k]),
    substrate: (ctx, R, w, h) => paintSubstrate(ctx, R, key, w, h),
    fill: (ctx, R, pts, col, o) => paintFill(ctx, R, key, pts, col, o),
    stroke: (ctx, R, pts, col, o) => paintStroke(ctx, R, key, pts, col, o)
  };
}

const EXPORTS_MEDIA = {
  fillPoly, grain, sheet, sk, hair, pencilScribble, scribFill, wash, crayonStroke, watercolorWash,
  charcoalShade, risoHalftone, linocutRelief, cyanotypeWash, gouacheCutout, copperplateEngraving,
  suminagashiMarbling, ginkgoLeaf, fernFrond, cutoutFlora, botanicalTree, celestialOrrery, waveCurl,
  projectedPolyhedron, MATERIALS, material, paintSubstrate, paintFill, paintStroke
};
