// Animator: boil-stepped frame loop over one canvas. Browser calls are guarded so require() works in Node.

// FNV-1a over the key's string form, seeded. Stable 32-bit seed per (seed, key).
const hashKey = (seed, key) => {
  let h = (2166136261 ^ seed) >>> 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

class Animator {
  constructor(canvas, render, options = {}) {
    const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.render = render;
    this.fps = options.fps ?? 12;
    this.frameInterval = 1000 / this.fps;
    this.totalFrames = options.frames ?? options.beats?.total ?? 36;
    this.boilHold = options.boilHold ?? 2;
    this.boilVariants = options.boilVariants ?? 3;
    this.loop = options.loop ?? true;
    this.restFrame = options.restFrame ?? 0;
    this.beats = options.beats ?? null;
    this.dpr = options.dpr ?? 1;
    this.seed = Number(q.get('seed') ?? options.seed ?? 42);
    this.noPaper = q.get('paper') === 'none';
    this.simple = q.get('simple') === '1'; // flat washes instead of hatch (sticker size)
    this.reduced = reduced;
    this.isPlaying = false;
    this.lastTime = 0;
    this.frameIndex = 0;
    this._want = false;
    this._raf = null;
    this._outOfView = false;
    this._cels = new Map();
    this._tracedBeats = new Set();
    this._traceArr = null;
    this.setMaterial(q.get('material') || options.material || 'pencil');
    if (typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver(([e]) => {
        this._outOfView = !e.isIntersecting;
        this._gate();
      });
      this._io.observe(canvas);
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this._gate());
    const w = Number(q.get('w') ?? options.width ?? 1080);
    const h = Number(q.get('h') ?? options.height ?? 1080);
    this.frameIndex = Number(q.get('frame') ?? (reduced ? this.restFrame : 0));
    this.resize(w, h);
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this._cels.clear();
    this.renderFrame(this.frameIndex);
  }

  setMaterial(name) {
    this.materialName = MATERIALS[name] ? name : 'crayon';
    this.m = material(this.materialName);
    this._cels.clear();
  }

  setSeed(seed) {
    this.seed = seed;
    this._cels.clear();
  }

  still(key) {
    return stream(hashKey(this.seed, key));
  }

  _boilIndex() {
    return Math.floor(this.frameIndex / this.boilHold) % this.boilVariants;
  }

  renderFrame(i) {
    const n = this.totalFrames;
    this.frameIndex = ((i % n) + n) % n;
    CURRENT_FRAME = this.frameIndex;
    const { ctx, width: w, height: h } = this;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.render(this._fields(ctx, this.still(`boil:${this._boilIndex()}`), w, h));
    ctx.restore();
  }

  // Fields for render() and for cel() draw callbacks. ctx and R differ per target.
  _fields(ctx, R, w, h) {
    const f = this.frameIndex;
    const cel = (key, draw, o = {}) => this._cel(ctx, key, draw, o, w, h);
    return {
      ctx, R, w, h, frame: f, t: f / this.totalFrames, time: f / this.fps, unit: Math.min(w, h) / 1080,
      beat: this._beatAt(f), m: this.m, still: key => this.still(key), cel, simple: this.simple,
      probe: (name, value) => this._probe(name, value),
      paper: () => { if (!this.noPaper) cel('paper', g => g.m.substrate(g.ctx, g.R, g.w, g.h)); }
    };
  }

  _cel(ctx, key, draw, o, W, H) {
    const { boil = false, x = 0, y = 0 } = o;
    const w = o.w ?? W, h = o.h ?? H;
    const v = boil ? this._boilIndex() : -1;
    const id = `${key}|${w}x${h}|${v}`;
    let e = this._cels.get(id);
    if (!e) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * this.dpr);
      canvas.height = Math.round(h * this.dpr);
      e = { canvas, ctx: canvas.getContext('2d') };
      e.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      draw(this._fields(e.ctx, this.still(boil ? `boil:${v}` : key), w, h));
      this._cels.set(id, e);
    }
    ctx.drawImage(e.canvas, x, y, w, h);
  }

  _probe(name, value) {
    const trace = globalThis.__FLIPBOOK_TRACE__;
    if (Array.isArray(trace)) trace.push({ kind: 'probe', name, value, frame: this.frameIndex });
  }

  // Current beat for frame f. Each beat is traced once per trace array.
  _beatAt(f) {
    const b = this.beats?.at(f) ?? null;
    const trace = globalThis.__FLIPBOOK_TRACE__;
    if (b && Array.isArray(trace)) {
      if (trace !== this._traceArr) {
        this._traceArr = trace;
        this._tracedBeats.clear();
      }
      if (!this._tracedBeats.has(b.i)) {
        this._tracedBeats.add(b.i);
        trace.push({ kind: 'beat', name: b.name, start: b.start, frames: b.frames, say: b.say });
      }
    }
    return b;
  }

  play() {
    if (this.reduced) return;
    this._want = true;
    this._gate();
  }

  pause() {
    this._want = false;
    this._halt();
  }

  toggle() {
    this.isPlaying ? this.pause() : this.play();
  }

  step(n = 1) {
    this.pause();
    this.renderFrame(this.frameIndex + n);
  }

  _gate() {
    const hidden = this._outOfView || (typeof document !== 'undefined' && document.hidden);
    if (this._want && !hidden) this._run();
    else this._halt();
  }

  _run() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.lastTime = performance.now();
    const tick = now => {
      if (!this.isPlaying) return;
      const elapsed = now - this.lastTime;
      if (elapsed >= this.frameInterval) {
        this.lastTime = now - (elapsed % this.frameInterval);
        if (!this.loop && this.frameIndex + 1 >= this.totalFrames) return this.pause();
        this.renderFrame(this.frameIndex + 1);
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _halt() {
    this.isPlaying = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /** Record one loop of the canvas to a video Blob (WebM where supported, MP4 on Safari). */
  recordLoop(durationMs, onComplete) {
    return new Promise((resolve, reject) => {
      if (typeof MediaRecorder === 'undefined' || !this.canvas.captureStream) {
        return reject(new Error('MediaRecorder unavailable'));
      }
      this.pause();
      this.renderFrame(0);
      const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
      const mime = types.find(m => MediaRecorder.isTypeSupported(m)) || '';
      const opts = mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined;
      const rec = new MediaRecorder(this.canvas.captureStream(this.fps), opts);
      const chunks = [];
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onerror = e => reject(e.error || e);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || mime });
        if (onComplete) onComplete(blob);
        resolve(blob);
      };
      rec.start();
      this.play();
      const ms = (durationMs || (this.totalFrames / this.fps) * 1000) + this.frameInterval;
      setTimeout(() => { this.pause(); rec.stop(); }, ms);
    });
  }

  /** Deterministic frame dump: every frame of the loop as a data URL. */
  captureFrames(type = 'image/png') {
    this.pause();
    const out = [];
    for (let i = 0; i < this.totalFrames; i++) {
      this.renderFrame(i);
      out.push(this.canvas.toDataURL(type));
    }
    return out;
  }
}

const EXPORTS_ANIM = { Animator };
