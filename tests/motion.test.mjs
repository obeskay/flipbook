// Motion semantics: flow never overshoots, passes its keys, beats and reading time add up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FB = require('../skills/flipbook/engine/flipbook.js');

// Deterministic PRNG from the engine itself: no Math.random in tests either.
const rng = FB.stream(12345);

test('flow never overshoots across random monotone keys', () => {
  for (let trial = 0; trial < 200; trial++) {
    const n = 3 + Math.floor(rng() * 6);
    const keys = [];
    let f = 0, v = rng() * 10 - 5;
    for (let i = 0; i < n; i++) {
      keys.push([f, v]);
      f += 1 + Math.floor(rng() * 8);
      v += (rng() - 0.3) * 6; // mixed up and down steps
    }
    const curve = FB.flow(keys);
    for (let i = 0; i < n - 1; i++) {
      const lo = Math.min(keys[i][1], keys[i + 1][1]);
      const hi = Math.max(keys[i][1], keys[i + 1][1]);
      const a = keys[i][0], b = keys[i + 1][0];
      for (let s = 0; s <= 40; s++) {
        const y = curve(a + ((b - a) * s) / 40);
        assert.ok(y >= lo - 1e-9 && y <= hi + 1e-9, `trial ${trial} seg ${i} overshoot ${y} not in [${lo},${hi}]`);
      }
    }
  }
});

test('flow passes through its keys and holds the end values outside the range', () => {
  const keys = [[0, 1], [4, -2], [9, 3], [12, 3]];
  const curve = FB.flow(keys);
  for (const [f, v] of keys) assert.ok(Math.abs(curve(f) - v) < 1e-9, `key ${f} gave ${curve(f)}`);
  assert.equal(curve(-50), 1);
  assert.equal(curve(500), 3);
});

test('flow on a flat stretch stays flat (no fake wobble)', () => {
  const curve = FB.flow([[0, 5], [3, 5], [6, 9]]);
  for (let f = 0; f <= 3; f += 0.25) assert.ok(Math.abs(curve(f) - 5) < 1e-9);
});

test('track eases into each key and stops there', () => {
  const t = FB.track([[0, 0], [10, 1], [20, 1]]);
  assert.equal(t(0), 0);
  assert.equal(t(10), 1);
  assert.equal(t(15), 1);
  assert.ok(t(5) > 0 && t(5) < 1);
  assert.ok(Math.abs(t(5) - 0.5) < 1e-9); // symmetric cosine ease reaches the midpoint at 5
});

test('readingFrames follows ceil(fps*(0.6 + words/2.6))', () => {
  assert.equal(FB.readingFrames('hola mundo', 12), Math.ceil(12 * (0.6 + 2 / 2.6)));
  assert.equal(FB.readingFrames('', 12), 8); // empty text still gets one reading beat of at least 1 frame
  assert.equal(FB.readingFrames('uno dos tres cuatro cinco seis siete ocho nueve diez', 12), Math.ceil(12 * (0.6 + 10 / 2.6)));
});

test('beats totals add up and at() maps frames to beats', () => {
  const b = FB.beats([
    { name: 'a', frames: 5 },
    { name: 'b', say: 'uno dos tres' },
    { name: 'c', frames: 3 }
  ], 12);
  const second = FB.readingFrames('uno dos tres', 12);
  assert.equal(b.total, 5 + second + 3);
  assert.equal(b.at(0).name, 'a');
  assert.equal(b.at(4).name, 'a');
  assert.equal(b.at(5).name, 'b');
  assert.equal(b.at(5).p, 0);
  assert.equal(b.at(5 + second).name, 'c');
  assert.equal(b.at(b.total + 100).name, 'c'); // clamps to the last frame
  const mid = b.at(5 + Math.floor(second / 2));
  assert.ok(mid.p > 0 && mid.p < 1);
});

test('cutoutHold steps on n-frame boundaries', () => {
  assert.equal(FB.cutoutHold(7, 2), 6);
  assert.equal(FB.cutoutHold(8, 3), 6);
  assert.equal(FB.cutoutHold(5, 3), 3);
  assert.equal(FB.cutoutHold(0, 2), 0);
});

test('seg, bell and seeded stay in range and are stable', () => {
  assert.equal(FB.seg(0, 2, 6), 0);
  assert.equal(FB.seg(9, 2, 6), 1);
  assert.ok(Math.abs(FB.seg(4, 2, 6) - 0.5) < 1e-9);
  assert.equal(FB.bell(0), 0);
  assert.equal(FB.bell(1), 0);
  assert.ok(Math.abs(FB.bell(0.5) - 1) < 1e-9);
  for (let i = 0; i < 50; i++) {
    const s = FB.seeded(i, 3);
    assert.ok(s >= 0 && s < 1);
    assert.equal(s, FB.seeded(i, 3));
  }
});

test('follow returns the lagged, pulled-back copy of a curve', () => {
  const base = f => f * 2;
  const tail = FB.follow(base, 3, 0.5);
  // gain * (base(f-3) - base(f)) = 0.5 * (-6)
  assert.equal(tail(10), -3);
});
