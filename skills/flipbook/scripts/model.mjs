// Model-check a flow script: node scripts/model.mjs path/flow.js [--write]
// Exit 0 when ok, 1 when a rule, deadlock, dead step, cap or expectStuck fails, 2 on bad input.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, '..', 'engine', 'flipbook.js');
const usage = 'usage: node scripts/model.mjs path/flow.js [--write]';
const bad = msg => { console.error(`model: ${msg}`); process.exit(2); };

const args = process.argv.slice(2);
const writeFiles = args.includes('--write');
const positional = args.filter(a => a !== '--write');
if (positional.length !== 1 || positional[0].startsWith('--')) bad(usage);
const flowPath = resolve(positional[0]);
if (!existsSync(flowPath)) bad(`no such file: ${positional[0]}`);
if (!existsSync(bundlePath)) bad(`bundle missing, run node ${join(here, 'bundle.mjs')}`);

// The bundle and the flow share one sandbox; window is the sandbox's own global.
const sandbox = { console };
sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
try {
  vm.runInContext(readFileSync(bundlePath, 'utf8'), ctx, { filename: bundlePath });
  vm.runInContext(readFileSync(flowPath, 'utf8'), ctx, { filename: flowPath });
} catch (err) {
  bad(`cannot load flow: ${err.message}`);
}
const FLOW = sandbox.window.FLOW;
if (!FLOW) bad('the flow script did not set window.FLOW');

let r;
try {
  r = sandbox.Flipbook.checkFlow(FLOW);
} catch (err) {
  bad(`flow is invalid: ${err.message}`);
}

const stepLabel = id => FLOW.steps[id]?.label ?? id;
const pathLines = (path, indent) => path
  .map((p, i) => (i === 0 ? `${indent}${i + 1}. ${p.view}` : `${indent}${i + 1}. ${stepLabel(p.step)} -> ${p.view}`))
  .join('\n');

const reasons = [];
const holds = r.rules.filter(x => x.holds).map(x => x.label);
const lines = [];
lines.push(`flow: ${r.name}`);
lines.push(`states ${r.states}, steps ${r.transitions}, nodes ${r.nodes.length}, edges ${r.edges.length}${r.capped ? ` (CAPPED at ${r.cap})` : ''}`);
lines.push(`rules that hold: ${holds.length ? holds.join(', ') : 'none'}`);
for (const b of r.broken) {
  const tag = b.expectBroken ? 'expected' : 'UNEXPECTED';
  lines.push(`rule breaks (${tag}): ${b.label}`);
  lines.push(pathLines(b.path, '  '));
  if (!b.expectBroken) reasons.push(`rule breaks: ${b.label}`);
}
for (const x of r.rules.filter(x => x.holds && x.expectBroken)) {
  reasons.push(`rule expected to break but holds: ${x.label}`);
  lines.push(`rule expected to break but holds: ${x.label}`);
}
if (r.deadlocks.length) {
  lines.push('deadlocks:');
  for (const d of r.deadlocks) { lines.push(`  stuck at: ${d.view}`); lines.push(pathLines(d.path, '    ')); }
  reasons.push(`${r.deadlocks.length} deadlock(s)`);
} else lines.push('deadlocks: none');
for (const d of r.expectedStuck) {
  lines.push(`stuck, expected (expectStuck): ${d.view}`);
  lines.push(pathLines(d.path, '  '));
}
if (r.stuckUnmatched) {
  lines.push('expectStuck matches no deadlock');
  reasons.push('expectStuck matches no deadlock');
}
if (r.deadSteps.length) {
  lines.push(`dead steps: ${r.deadSteps.map(s => s.label).join(', ')}`);
  reasons.push(`${r.deadSteps.length} dead step(s)`);
} else lines.push('dead steps: none');
if (r.capped) reasons.push(`state cap ${r.cap} reached, check incomplete`);
lines.push(`result: ${r.ok ? 'OK' : 'NOT OK'}${reasons.length ? ` (${reasons.join('; ')})` : ''}`);
console.log(lines.join('\n'));

if (writeFiles) {
  const dir = dirname(flowPath);
  const ids = new Map(r.nodes.map((n, i) => [n.id, `s${i}`]));
  const clean = s => String(s).replace(/["\n\r]/g, ' ').replace(/:/g, ' -');
  const brokenViews = new Set(r.broken.map(b => b.path[b.path.length - 1].view));
  const mmd = [
    'stateDiagram-v2',
    ...r.nodes.map(n => `  state "${clean(n.label)}" as ${ids.get(n.id)}`),
    `  [*] --> ${ids.get(r.init)}`,
    ...r.edges.map(e => `  ${ids.get(e.from)} --> ${ids.get(e.to)} : ${clean(e.label)}`),
    ...[...brokenViews].map(v => `  class ${ids.get(v)} broken`),
    '  classDef broken stroke:#b03a2e,stroke-width:2px',
    ''
  ].join('\n');
  const md = [
    `# ${r.name}: model check`,
    '',
    `- states: ${r.states}`,
    `- steps: ${r.transitions}`,
    `- nodes (view): ${r.nodes.length}`,
    `- edges (view): ${r.edges.length}`,
    `- result: ${r.ok ? 'OK' : 'NOT OK'}`,
    '',
    '## Rules that hold',
    '',
    ...(holds.length ? holds.map(h => `- ${h}`) : ['- none']),
    '',
    '## Rules that break',
    '',
    ...(r.broken.length
      ? r.broken.flatMap(b => [`### ${b.label} (${b.expectBroken ? 'expected' : 'unexpected'})`, '', pathLines(b.path, ''), ''])
      : ['none', '']),
    '## Deadlocks',
    '',
    ...(r.deadlocks.length
      ? r.deadlocks.flatMap(d => [`### stuck at ${d.view}`, '', pathLines(d.path, ''), ''])
      : ['none', '']),
    '## Stuck, expected by expectStuck',
    '',
    ...(r.expectedStuck.length
      ? r.expectedStuck.flatMap(d => [`### stuck at ${d.view}`, '', pathLines(d.path, ''), ''])
      : ['none', '']),
    ...(r.stuckUnmatched ? ['expectStuck matches no deadlock', ''] : []),
    '## Dead steps',
    '',
    ...(r.deadSteps.length ? r.deadSteps.map(s => `- ${s.label}`) : ['none']),
    ''
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), md);
  writeFileSync(join(dir, 'chart.mmd'), mmd);
}

process.exitCode = r.ok ? 0 : 1;
