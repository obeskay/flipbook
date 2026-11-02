// Drives system Chrome over the DevTools protocol. No dependencies: Node 22 global WebSocket.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium'
];

export function findChrome() {
  const env = process.env.CHROME;
  if (env) {
    if (!existsSync(env)) throw new Error(`CHROME=${env} does not exist.`);
    return env;
  }
  const found = CANDIDATES.find(p => existsSync(p));
  if (!found) throw new Error('No Chrome found. Install Google Chrome or set CHROME=/path/to/chrome.');
  return found;
}

const live = new Set();
let hooked = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const trimErr = s => String(s ?? '').slice(0, 600);

function removeDir(dir) {
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* best effort */ }
}

// A session never outlives the process: exit and SIGINT both kill Chrome and drop the profile.
function hookSignals() {
  if (hooked) return;
  hooked = true;
  process.on('exit', () => { for (const s of live) s.killNow(); });
  process.once('SIGINT', () => { for (const s of live) s.killNow(); process.exit(130); });
}

function exited(child, ms) {
  return new Promise(res => {
    if (child.exitCode !== null || child.signalCode !== null) return res(true);
    const t = setTimeout(() => res(false), ms);
    child.once('exit', () => { clearTimeout(t); res(true); });
  });
}

class Chrome {
  constructor(child, dir) {
    this.child = child;
    this.userDataDir = dir;
    this.errors = [];
    this.stderr = '';
    this.exit = null;
    this.ws = null;
    this.sessionId = null;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
    this.scriptId = null;
    this.closed = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    child.on('exit', (code, signal) => { this.exit = { code, signal }; });
    child.on('error', e => { this.exit = { code: null, signal: e.message }; });
  }

  killNow() {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    removeDir(this.userDataDir);
  }

  send(method, params = {}, { timeoutMs = 60000 } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome did not answer ${method} within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      });
      const msg = { id, method, params };
      if (this.sessionId) msg.sessionId = this.sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }

  // Resolves with the params of the next event named `method`; rejects after timeoutMs.
  next(method, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${message}. Page errors so far: ${this.errors.join(' | ') || 'none'}`)), timeoutMs);
      const list = this.waiters.get(method) ?? [];
      list.push(p => { clearTimeout(timer); resolve(p); });
      this.waiters.set(method, list);
    });
  }

  onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    const { method, params } = msg;
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails;
      const where = d.url ? ` (${d.url}:${d.lineNumber + 1})` : '';
      this.errors.push(`uncaught exception: ${trimErr(d.exception?.description || d.text)}${where}`);
    } else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
      this.errors.push(`console.${params.type}: ${params.args.map(a => a.value ?? a.description ?? a.type).join(' ')}`);
    } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      const e = params.entry;
      this.errors.push(`${e.source}: ${trimErr(e.text)}${e.url ? ` (${e.url})` : ''}`);
    } else if (method === 'Page.javascriptDialogOpening') {
      this.errors.push(`dialog blocked: ${trimErr(params.message)}`);
      this.send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
    }
    const list = this.waiters.get(method);
    if (list) {
      this.waiters.set(method, []);
      for (const w of list) w(params);
    }
  }

  // Navigates the one page. Scripts in beforeLoad run before any page script.
  async open(url, { viewport = {}, beforeLoad = null, timeoutMs = 30000 } = {}) {
    if (this.closed) throw new Error('Chrome session is closed');
    const { width = 1280, height = 900, dpr = 1 } = viewport;
    this.errors.length = 0;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    if (this.scriptId) {
      await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.scriptId });
      this.scriptId = null;
    }
    if (beforeLoad) this.scriptId = (await this.send('Page.addScriptToEvaluateOnNewDocument', { source: beforeLoad })).identifier;
    const loaded = this.next('Page.loadEventFired', timeoutMs, `${url} did not finish loading within ${timeoutMs / 1000}s`);
    loaded.catch(() => {});
    const nav = await this.send('Page.navigate', { url });
    if (nav.errorText) throw new Error(`could not open ${url}: ${nav.errorText}`);
    await loaded;
  }

  // Runs an expression in the page. Promises are awaited; a thrown error becomes a rejected Error.
  async evaluate(expression, { timeoutMs = 120000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, { timeoutMs });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`page threw: ${trimErr(d.exception?.description || d.text)}`);
    }
    return r.result?.value;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    live.delete(this);
    try { this.ws?.close(); } catch { /* socket already gone */ }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      if (!(await exited(this.child, 1500))) this.child.kill('SIGKILL');
      await exited(this.child, 3000);
    }
    removeDir(this.userDataDir);
  }
}

async function waitForDevTools(chrome, exe, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const m = chrome.stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) return m[1];
    if (chrome.exit) {
      throw new Error(`Chrome exited before DevTools was ready (code ${chrome.exit.code}, signal ${chrome.exit.signal}). stderr: ${chrome.stderr.trim().slice(-800)}`);
    }
    if (Date.now() - t0 > timeoutMs) {
      await chrome.close();
      throw new Error(`Chrome did not open DevTools within ${timeoutMs / 1000}s (${exe}). stderr: ${chrome.stderr.trim().slice(-800)}`);
    }
    await sleep(25);
  }
}

// Starts a headless Chrome with a fresh profile and one page attached over CDP.
export async function launchChrome({ timeoutMs = 20000 } = {}) {
  const exe = findChrome();
  const dir = mkdtempSync(join(tmpdir(), 'flipbook-chrome-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    'about:blank'
  ];
  const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const chrome = new Chrome(child, dir);
  live.add(chrome);
  hookSignals();
  try {
    const url = await waitForDevTools(chrome, exe, timeoutMs);
    await new Promise((resolve, reject) => {
      chrome.ws = new WebSocket(url);
      chrome.ws.addEventListener('open', resolve, { once: true });
      chrome.ws.addEventListener('error', () => reject(new Error(`could not open DevTools socket ${url}`)), { once: true });
    });
    chrome.ws.addEventListener('message', ev => chrome.onMessage(ev.data));
    chrome.ws.addEventListener('close', () => {
      for (const p of chrome.pending.values()) p.reject(new Error('Chrome closed the DevTools connection'));
      chrome.pending.clear();
    });
    const { targetId } = await chrome.send('Target.createTarget', { url: 'about:blank' });
    chrome.sessionId = (await chrome.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
    for (const d of ['Page', 'Runtime', 'Log']) await chrome.send(`${d}.enable`);
    return chrome;
  } catch (e) {
    await chrome.close();
    throw e;
  }
}
