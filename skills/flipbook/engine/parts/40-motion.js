// Motion: keyed curves over frames, easing, follow-through, reading-time beats. Pure: no DOM, no clock.

// Monotone cubic Hermite (Fritsch-Carlson). Tangents are clamped so the curve never overshoots
// its keys; outside the keyed range the end values are held.
function flow(keys) {
  const k = keys.map(([f, v]) => [+f, +v]).sort((a, b) => a[0] - b[0]);
  const n = k.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => k[0][1];
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / (k[i + 1][0] - k[i][0] || 1));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return f => {
    if (f <= k[0][0]) return k[0][1];
    if (f >= k[n - 1][0]) return k[n - 1][1];
    let i = 0;
    while (i < n - 2 && f > k[i + 1][0]) i++;
    const h = k[i + 1][0] - k[i][0], u = (f - k[i][0]) / h;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * k[i][1] + (u3 - 2 * u2 + u) * h * m[i]
      + (-2 * u3 + 3 * u2) * k[i + 1][1] + (u3 - u2) * h * m[i + 1];
  };
}

// Ease in-out into each key and stop there. A third element 'out' makes that arrival ease-out only.
function track(keys) {
  const k = keys.map(([f, v, e]) => [+f, +v, e === 'out']).sort((a, b) => a[0] - b[0]);
  const n = k.length;
  if (n === 0) return () => 0;
  const cosEase = u => 0.5 - Math.cos(Math.PI * u) / 2;
  const outEase = u => Math.sin((Math.PI * u) / 2);
  return f => {
    if (f <= k[0][0]) return k[0][1];
    if (f >= k[n - 1][0]) return k[n - 1][1];
    let i = 0;
    while (i < n - 2 && f > k[i + 1][0]) i++;
    const u = (f - k[i][0]) / (k[i + 1][0] - k[i][0] || 1);
    const e = k[i + 1][2] ? outEase(u) : cosEase(u);
    return k[i][1] + (k[i + 1][1] - k[i][1]) * e;
  };
}

// Periodic -1..1 with a phase offset in turns (phase 0.25 starts at the crest).
const wave = (frame, period, phase = 0) => Math.sin(((frame / period) + phase) * TAU);

// Peaked bump: 0 at the edges, 1 at p = 0.5, for p in [0,1]. Outside the range it is 0.
const bell = p => (p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p) ** 2);

// Smoothstep over a frame range: 0 before a, 1 after b.
const seg = (frame, a, b) => {
  const u = b === a ? (frame >= b ? 1 : 0) : Math.min(1, Math.max(0, (frame - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// Stable pseudo-random 0..1 for an index and salt. Same input, same output, on every frame.
const seeded = (i, salt = 0) => {
  const s = Math.sin((i + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Follow-through: a trailing copy of fn, pulled back by delay frames and scaled by gain.
const follow = (fn, delay, gain) => frame => gain * (fn(frame - delay) - fn(frame));

// Frames needed to read a text at a given fps: a short settle plus a per-word allowance.
const readingFrames = (text, fps) => {
  const words = String(text ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(fps * (0.6 + words / 2.6)));
};

// Lay beats end to end. Each item is {name, frames?, say?}; missing frames come from its text.
function beats(list, fps) {
  const out = [];
  let t = 0;
  list.forEach((b, i) => {
    const frames = b.frames ?? readingFrames(b.say, fps);
    out.push({ i, name: b.name, say: b.say ?? null, start: t, frames });
    t += frames;
  });
  const at = frame => {
    if (out.length === 0) return null;
    const f = Math.min(Math.max(0, Math.floor(frame)), t - 1);
    let lo = 0, hi = out.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (out[mid].start <= f) lo = mid; else hi = mid - 1;
    }
    const b = out[lo];
    return { name: b.name, i: b.i, p: (f - b.start) / b.frames, start: b.start, frames: b.frames, say: b.say };
  };
  return { total: t, list: out, at };
}

// Stepped motion: hold each value for n frames (2s or 3s on a 12 fps clock).
const cutoutHold = (frame, n) => Math.floor(frame / n) * n;

const EXPORTS_MOTION = { flow, track, wave, bell, seg, seeded, follow, beats, readingFrames, cutoutHold };
