/**
 * Row 9 self-tests: the runtime instrumenter — plan v5 §7 row 9, decisions K4/K5,
 * ledger E10–E15 + E18 + E19, invariants I1 (offsets), I2 (a trace never moves a verdict).
 *
 * THIS ROW'S ONE LOAD-BEARING RULE: **there is no depth logic.**
 *
 * A runtime depth counter — increment on enter, decrement on exit — suppresses a RECURSIVE
 * target's own body on every recursive call after the first. 102 of the 450 solution blocks
 * are `selfRecursive`, so their traces would come back EMPTY and row 20's V11 non-vacuity
 * assertion would pass VACUOUSLY: a check that cannot fail is worse than no check
 * (plan §1 U3, §6 E10).
 *
 * So region membership is read from `build/blocks.json`'s `regionTable` — computed
 * STATICALLY by row 7 — and baked into each probe as one integer. The runtime compares it
 * (`if (region !== 0) return;`) and does nothing else. There is no call-stack tracking and
 * no runtime region inference anywhere in `scripts/instrument.mjs`.
 *
 * The tests attack that claim from both sides:
 *   - E10 fires on a recursive target's OWN body on EVERY self-call (a counter cannot).
 *   - The emitted source is read back and asserted to CONTAIN the one-integer gate and to
 *     CONTAIN no `depth++` / `depth--` / `callStack`.
 *   - E13/E14 show a depth-1 sibling emitting nothing while still being PROBED.
 *
 * A fixture's manifest entry is derived by ROW 7's own `analyzeBlock` — the same function
 * that writes `build/blocks.json` — so no fixture's regionTable is a hand-written expectation.
 *
 * Run: node scripts/test-instrument.mjs   (exits 1 if any assertion fails)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

import { ROOT_DIR } from './audit-curriculum.mjs';
import { analyzeBlock, blockHashOf, GENERATOR } from './gen-blocks.mjs';
import { validateEnvelope } from './validate-envelope.mjs';
import { stringify } from './lib/serialize.mjs';
import {
  instrumentBlock, loadManifest, blockEntry, readBlockSource, instrumentGuideBlock,
  runRaw, runTraced, buildEnvelope, TRACE_RUNTIME,
} from './instrument.mjs';

const acornParse = (code) => acorn.parse(code, { ecmaVersion: 2022 });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'instrument');

let assertions = 0;
let failures = 0;
const groups = [];

function check(cond, label, detail = '') {
  assertions++;
  if (cond) console.log(`✅ [PASS] ${label}`);
  else {
    failures++;
    console.error(`❌ [FAIL] ${label}${detail ? `\n   ${detail}` : ''}`);
  }
}
function group(name) {
  groups.push(name);
  console.log(`\n--- ${name} ---`);
}

/**
 * A fixture is a real solution block on disk; its manifest entry comes from ROW 7's own
 * `analyzeBlock`, the function that writes `build/blocks.json`. So what is measured here is
 * what the instrumenter does with the production region table.
 */
function loadFixture(name) {
  const source = fs.readFileSync(path.join(FIXTURES, name), 'utf-8').replace(/\n$/, '');
  return { source, entry: analyzeBlock({ code: source, level: 3, startLine: 1 }, '', '') };
}

/** Row 5's I5 rule, re-implemented for the assertions that inspect operands directly. */
const LITERALS = 'true false null undefined NaN Infinity this'.split(' ');
function bindingsOf(expr) {
  const names = [];
  let afterDot = false;
  for (const m of String(expr).matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)|(\.)/g)) {
    if (m[2]) { afterDot = true; continue; }
    if (afterDot) { afterDot = false; continue; }
    if (!LITERALS.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/**
 * Drives are STRINGIFIED into the vm context, so they must be self-contained. They also run
 * where the block's own top-level declarations are in scope, which is how E13 proves the
 * suppressed helper actually executed.
 */
const DRIVES = {
  'e10-recursive.js': (t, rec) => { rec.result = t({ value: 1, left: { value: 2, left: null, right: null }, right: null }); },
  'e11-class.js': (t, rec) => { const c = new t(2); c.put(1, 1); c.put(2, 2); c.put(3, 3); rec.result = [c.get(1), c.get(3), c.get(2), c.get(9)]; },
  'e12-callbacks.js': (t, rec) => { rec.result = t([3, 1, 2], (a, b) => a - b); },
  'e13-helper.js': (t, rec) => { rec.result = t([1, 2, 3], 6, arrayToTree([1, 2, 3])); },
  'e14-target.js': (t, rec) => { rec.result = t([1, 2, 3], 6); },
  'e14-other-block.js': (t, rec) => { rec.result = t([1, 2, 3]); },
  'e15-iife.js': (t, rec) => { rec.result = t([1, 2, 3]); },
  'e15-arrow-field.js': (t, rec) => { const c = new t(0); c.bump(1); c.bump(2); rec.result = c.read(); },
  'e15-object-method.js': (t, rec) => { rec.result = t([1, 2, 3]); },
  'e15-getter.js': (t, rec) => { rec.result = new t(7).read(); },
  'e18-throw.js': (t, rec) => { rec.result = t([-1, -2], -1); },
  'i2-single-eval.js': (t, rec) => { rec.result = t(4); },
};
const FIXTURE_NAMES = Object.keys(DRIVES);

/** Every step must carry the block hash and an offset INSIDE the block (I1), never a guide line (K5). */
function assertOffsets(envelope, label) {
  const h = envelope.block.hash;
  check(envelope.steps.every((s) => s.line.h === h), `${label}: I1 every line.h === block.hash`,
    JSON.stringify(envelope.steps.filter((s) => s.line.h !== h).slice(0, 2)));
  check(envelope.steps.every((s) => Number.isInteger(s.line.off) && s.line.off >= 0 && s.line.off < envelope.block.lines),
    `${label}: I1 every line.off < block.lines (${envelope.block.lines})`,
    JSON.stringify(envelope.steps.filter((s) => !(s.line.off >= 0 && s.line.off < envelope.block.lines)).slice(0, 2)));
}

// ===========================================================================
group('K4/K5: one region integer in the emitted source, and NO depth logic anywhere');
// ===========================================================================

const e10 = loadFixture('e10-recursive.js');
const inst10 = instrumentBlock(e10.source, e10.entry);

check(typeof inst10.code === 'string' && inst10.code.length > 0, 'instrumentBlock returns instrumented source');
check(inst10.code.includes('__T('), 'the emitted source calls the trace probe __T(...)');
check(/if \(region !== 0\) return;/.test(TRACE_RUNTIME),
  'TRACE_RUNTIME gates on ONE integer: `if (region !== 0) return;`',
  'that one comparison IS the whole of K4 — no counter, no stack');
const depthLogic = /\bdepth\s*(\+\+|--)|\bcallStack\b|\bstackDepth\b|\b__depth\b/.exec(`${TRACE_RUNTIME}\n${inst10.code}`);
check(depthLogic === null, 'neither the runtime nor the emitted source contains a depth counter or call-stack tracking',
  `found: ${depthLogic && depthLogic[0]}`);
check(inst10.probes.every((p) => p.region === e10.entry.regionTable[p.regionIndex]?.depth),
  'every probe carries the depth the regionTable gave it — READ, never derived',
  JSON.stringify(inst10.probes.map((p) => [p.regionIndex, p.region])));
check(inst10.regionGate.d0.length > 0 && inst10.regionGate.d0.every((n) => n.region === 0),
  'regionGate.d0 lists the region members, all region === 0', JSON.stringify(inst10.regionGate.d0));
check(inst10.probes.length > 0 && inst10.probes.every((p) => p.off >= 0 && p.off < e10.entry.blockLines),
  `every probe offset is inside its own block (${inst10.probes.length} probes)`);

// ===========================================================================
group('E10: a recursive target emits on its OWN body, on every self-call');
// ===========================================================================

check(e10.entry.selfRecursive === true, 'E10 the fixture is marked selfRecursive by row 7');
check(e10.entry.regionTable.some((r) => r.name === e10.entry.targetFn && r.depth === 0),
  'E10 the target itself is depth 0 in the regionTable', JSON.stringify(e10.entry.regionTable));

const selfCallProbe = inst10.probes.find((p) => p.text.includes('depthBelow('));
check(selfCallProbe !== undefined, 'E10 the recursive self-call carries a probe',
  JSON.stringify(inst10.probes.map((p) => p.text)));
check(selfCallProbe !== undefined && selfCallProbe.region === 0,
  'E10 and that probe is depth 0 — a runtime counter would have suppressed it',
  selfCallProbe ? `region ${selfCallProbe.region}` : 'no probe found');

const env10 = runTraced(inst10, e10.entry, DRIVES['e10-recursive.js']);
const selfCalls = env10.steps.filter((s) => s.text.includes('depthBelow('));
check(env10.steps.length > 0, `E10 the trace is NOT empty (${env10.steps.length} steps) — V11 would pass vacuously otherwise`);
check(selfCalls.length >= 2, `E10 steps on EVERY self-call (${selfCalls.length}) — a counter would leave 1`);
check(selfCalls.every((s) => s.line.h === env10.block.hash), 'E10 every recursive step still carries block.hash');
assertOffsets(env10, 'E10');

// ===========================================================================
group('E11: class methods lexically inside the target are depth 0 and emit');
// ===========================================================================

const e11 = loadFixture('e11-class.js');
const inst11 = instrumentBlock(e11.source, e11.entry);
check(e11.entry.targetFn === 'LRUCache', 'E11 the CLASS is the derived target', JSON.stringify(e11.entry.regionTable));
// `constructor` is NOT in this list: two methods in this fixture share that name, so a probe
// cannot be attributed to one of them by name alone. The depth-0/depth-1 split between the
// two constructors is asserted explicitly below, and again against a real guide further down.
for (const method of ['_detach', '_attachFront', 'get', 'put']) {
  check(e11.entry.regionTable.some((r) => r.name === method && r.depth === 0),
    `E11 method ${method} is depth 0 (lexically inside the target)`);
  const probes = inst11.probes.filter((p) => p.enclosing === method);
  check(probes.length > 0 && probes.every((p) => p.region === 0),
    `E11 ${method} has ${probes.length} probe(s), all region 0`,
    JSON.stringify(probes.map((p) => p.region)));
}
check(e11.entry.regionTable.some((r) => r.name === 'DLinkedNode' && r.depth === 1),
  'E11 the sibling class DLinkedNode is depth 1', JSON.stringify(e11.entry.regionTable));
{
  // Both constructors get probes; the ONLY difference between them is the baked integer.
  const ctors = inst11.probes.filter((p) => p.enclosing === 'constructor');
  check(ctors.length > 0 && ctors.some((p) => p.region === 0) && ctors.some((p) => p.region === 1),
    `E11 BOTH constructors are probed (${ctors.length}) — one region 1, one region 0; the integer is the only difference`,
    JSON.stringify(ctors.map((p) => [p.regionIndex, p.region])));
  check(/__T\(0,/.test(inst11.code) && /__T\(1,/.test(inst11.code),
    'E11 the emitted source literally contains BOTH __T(0,…) and __T(1,…)');
}

const env11 = runTraced(inst11, e11.entry, DRIVES['e11-class.js']);
check(env11.steps.length > 0, `E11 the trace is NOT empty (${env11.steps.length} steps)`);
check(env11.steps.some((s) => s.text.includes('this.head.next')), 'E11 steps come from inside a class method body',
  JSON.stringify([...new Set(env11.steps.map((s) => s.text))].slice(0, 5)));
check(env11.steps.every((s) => s.line.h === env11.block.hash), 'E11 every step carries block.hash');
const unwatched = [...new Set(env11.steps.flatMap((s) => Object.keys(s.operands ?? {})))]
  .filter((k) => bindingsOf(k).some((n) => !e11.entry.watch.includes(n)));
check(unwatched.length === 0, 'E11 I5 every binding any operand names is in `watch` or a literal',
  `unwatched operand keys: ${JSON.stringify(unwatched.slice(0, 4))}`);
assertOffsets(env11, 'E11');

// ===========================================================================
group('E12: a map/forEach/sort comparator inside the target is depth 0 and emits');
// ===========================================================================

const e12 = loadFixture('e12-callbacks.js');
const inst12 = instrumentBlock(e12.source, e12.entry);
const callbackProbes = inst12.probes.filter((p) => p.regionKind === 'arrow-fn');
check(callbackProbes.length >= 2, `E12 the walk finds the callbacks (${callbackProbes.length} arrow nodes)`);
check(callbackProbes.every((p) => p.region === 0), 'E12 every comparator is depth 0 — lexically inside the target');
check(e12.entry.regionTable.filter((r) => r.kind === 'arrow-fn').length >= 2,
  'E12 the regionTable itself marks the comparators depth 0', JSON.stringify(e12.entry.regionTable));
const env12 = runTraced(inst12, e12.entry, DRIVES['e12-callbacks.js']);
const cbSteps = env12.steps.filter((s) => s.text.includes('v * 2') || s.text.includes('v + i'));
check(cbSteps.length > 0, `E12 steps come from INSIDE the comparator bodies (${cbSteps.length})`);
assertOffsets(env12, 'E12');

// ===========================================================================
group('E13: a same-block helper OUTSIDE the target is depth 1 and suppressed');
// ===========================================================================

const e13 = loadFixture('e13-helper.js');
const inst13 = instrumentBlock(e13.source, e13.entry);
check(e13.entry.targetFn === 'twoSum', 'E13 the target is the solution, not the helper', JSON.stringify(e13.entry.regionTable));
check(e13.entry.regionTable.some((r) => r.name === 'arrayToTree' && r.depth === 1),
  'E13 the helper is depth 1 in the regionTable', JSON.stringify(e13.entry.regionTable));
const helperProbes = inst13.probes.filter((p) => p.enclosing === 'arrayToTree');
check(helperProbes.length > 0, `E13 the helper DOES get probes — baked region 1 (${helperProbes.length})`);
check(helperProbes.every((p) => p.region === 1), 'E13 every helper probe carries region 1');
check(inst13.probes.filter((p) => p.enclosing === 'twoSum').every((p) => p.region === 0),
  'E13 every twoSum probe carries region 0');

const env13 = runTraced(inst13, e13.entry, DRIVES['e13-helper.js']);
const leaked = env13.steps.filter((s) => s.text.includes('treeNode') || s.text.includes('arrayToTree'));
check(leaked.length === 0, `E13 ZERO steps came from the depth-1 helper (${leaked.length} leaked) — the S5 histogram`);
check(env13.steps.length > 0, `E13 the target itself still emits (${env13.steps.length} steps)`);
assertOffsets(env13, 'E13');

// ===========================================================================
group('E14: a helper in ANOTHER block is suppressed — the lexical test is per-block');
// ===========================================================================

const e14t = loadFixture('e14-target.js');
const e14h = loadFixture('e14-other-block.js');
const inst14 = instrumentBlock(e14t.source, e14t.entry);
// Asserted on the DERIVED region nodes, not on raw text: a comment in the fixture names the
// helper, and grepping the source for its name would be testing the prose.
check(!inst14.regionGate.d0.some((r) => r.name === 'buildTree'),
  'E14 the target block\'s depth-0 region names do not include the other block helper',
  JSON.stringify(inst14.regionGate.d0.map((r) => r.name)));
check(inst14.probes.every((p) => p.enclosing !== 'buildTree'), 'E14 no probe is attributed to buildTree');
const env14 = runTraced(inst14, e14t.entry, DRIVES['e14-target.js']);
check(env14.steps.length > 0, `E14 the target block emits (${env14.steps.length} steps)`);
check(!env14.steps.some((s) => /buildTree|root\.left/.test(s.text)), 'E14 no step is attributed to the other block');
// The gate is per-BLOCK: instrumented on its own, the helper block traces its own body.
const inst14b = instrumentBlock(e14h.source, e14h.entry);
const env14b = runTraced(inst14b, e14h.entry, DRIVES['e14-other-block.js']);
check(env14b.steps.length > 0,
  `E14 instrumented on its own the helper block DOES emit (${env14b.steps.length}) — the gate is per-block, not global`);
assertOffsets(env14, 'E14');
assertOffsets(env14b, 'E14b');

// ===========================================================================
group('E15: IIFE, arrow field, object-literal method and getter are all classified');
// ===========================================================================

for (const [file, expectedKind, expectedTarget] of [
  ['e15-iife.js', 'iife', 'compute'],
  ['e15-arrow-field.js', 'class-arrow-field', 'Counter'],
  ['e15-object-method.js', 'object-method', 'compute'],
  ['e15-getter.js', 'class-getter', 'Box'],
]) {
  const fx = loadFixture(file);
  const kinds = fx.entry.regionTable.map((r) => r.kind);
  check(kinds.includes(expectedKind), `E15 ${file}: classified as \`${expectedKind}\``, JSON.stringify(fx.entry.regionTable));
  check(fx.entry.targetFn === expectedTarget, `E15 ${file}: target derived as \`${expectedTarget}\``, `got ${fx.entry.targetFn}`);
  const ins = instrumentBlock(fx.source, fx.entry);
  check(ins.probes.length > 0, `E15 ${file}: the instrumenter emits probes (${ins.probes.length})`);
  check(ins.probes.every((p) => p.region === 0), `E15 ${file}: every probe is depth 0`);
  const env = runTraced(ins, fx.entry, DRIVES[file]);
  check(env.steps.length > 0, `E15 ${file}: the trace is NOT empty (${env.steps.length} steps)`);
  assertOffsets(env, `E15 ${file}`);
}

// ===========================================================================
group('E18: a thrown step still flushes the trace with `error` set (G3)');
// ===========================================================================

const e18 = loadFixture('e18-throw.js');
const inst18 = instrumentBlock(e18.source, e18.entry);
const env18 = runTraced(inst18, e18.entry, DRIVES['e18-throw.js']);
const raw18 = runRaw(e18.source, e18.entry, DRIVES['e18-throw.js']);
check(env18.error !== null, 'E18 the envelope carries a non-null `error`', `error: ${env18.error}`);
check(env18.steps.length > 0, `E18 the PARTIAL trace flushed anyway (${env18.steps.length} steps)`,
  'G3: one throw in N steps must not silently truncate a trace');
check(env18.steps.some((s) => s.type === 'throw'), 'E18 the throwing step is itself recorded, typed `throw`',
  JSON.stringify(env18.steps.map((s) => s.type).join(',')));
check(env18.steps.every((s, i, all) => i === 0 || s.n > all[i - 1].n),
  'E18 step numbering stays strictly increasing across the flush');
check(env18.result === null, 'E18 `result` is null when the run threw — §5 says so explicitly');
check(env18.error === raw18.error, 'I2/E18 the traced and the UNINSTRUMENTED run threw the SAME error',
  `traced ${env18.error} vs raw ${raw18.error}`);
check(env18.verdict.passed + env18.verdict.failed > 0, 'I2/E18 the verdict came from the raw run and is non-zero-sum',
  JSON.stringify(env18.verdict));
assertOffsets(env18, 'E18');

// ===========================================================================
group('E19: a stale blockHash is a NAMED failure, not a silent drift');
// ===========================================================================

let staleErr = null;
try {
  instrumentBlock(e10.source, { ...e10.entry, blockHash: `sha256:${'0'.repeat(64)}` });
} catch (err) { staleErr = err; }
check(staleErr !== null, 'E19 instrumenting against a stale blockHash throws');
check(staleErr !== null && /blockHash is stale/.test(staleErr.message), 'E19 and it NAMES blockHash', staleErr && staleErr.message);
check(staleErr !== null && staleErr.message.includes(GENERATOR), `E19 and it tells you to run \`node ${GENERATOR}\``, staleErr && staleErr.message);

let linesErr = null;
try {
  instrumentBlock(e10.source, { ...e10.entry, blockLines: e10.entry.blockLines + 3 });
} catch (err) { linesErr = err; }
check(linesErr !== null && /blockLines is stale/.test(linesErr.message), 'E19 blockLines drift is caught by name too',
  linesErr && linesErr.message);

// ===========================================================================
group('I2: instrumentation never moves the verdict — identical result, traced vs raw');
// ===========================================================================

for (const file of FIXTURE_NAMES) {
  const fx = loadFixture(file);
  const env = runTraced(instrumentBlock(fx.source, fx.entry), fx.entry, DRIVES[file]);
  const raw = runRaw(fx.source, fx.entry, DRIVES[file]);
  // §5 pins `result: null` for a run that threw, so the comparison only holds when it did not.
  check(env.error !== null || stringify(env.result) === stringify(raw.result),
    `I2 ${file}: instrumented result === uninstrumented result`,
    `traced ${stringify(env.result)} vs raw ${stringify(raw.result)}`);
  check(env.error === raw.error, `I2 ${file}: same throw (or same absence of one)`,
    `traced ${env.error} vs raw ${raw.error}`);
  check((env.error !== null) === (raw.error !== null),
    `I2 ${file}: it threw, or it did not, in BOTH runs`);
  check(stringify(env.verdict) === stringify(raw.verdict),
    `I2 ${file}: the verdict is byte-identical, and it came from the RAW run`);
}

// ===========================================================================
group('S1: every instrumented run validates against scripts/validate-envelope.mjs');
// ===========================================================================

for (const file of FIXTURE_NAMES) {
  const fx = loadFixture(file);
  const env = runTraced(instrumentBlock(fx.source, fx.entry), fx.entry, DRIVES[file]);
  const res = validateEnvelope(env);
  check(res.isValid, `S1 ${file}: validateEnvelope accepts the envelope`, JSON.stringify(res.errors.slice(0, 2)));
  assertOffsets(env, `S1 ${file}`);
}

// buildEnvelope refuses to hand row 10 something row 5 rejects — the defect is HERE, not row 12.
{
  const fx = loadFixture('e11-class.js');
  const good = runTraced(instrumentBlock(fx.source, fx.entry), fx.entry, DRIVES['e11-class.js']);
  let threw = null;
  try {
    buildEnvelope({
      path: 'x.md', level: 3, entry: { ...fx.entry, blockLines: 1 },
      traced: { steps: good.steps, stepCount: good.stepCount }, result: null,
      verdict: { passed: 1, failed: 0 },
    });
  } catch (err) { threw = err; }
  check(threw !== null && /rejects/.test(threw.message),
    'buildEnvelope throws when row 5 would reject the envelope (never hands a bad one downstream)', threw && threw.message);
}

// ===========================================================================
group('S1: the two REAL guides from build/blocks.json');
// ===========================================================================

const manifest = loadManifest();
check(manifest.blockCount === 450, 'loadManifest read 450 blocks', `got ${manifest.blockCount}`);

const REAL = [
  {
    guide: '09-binary-tree-general/01-maximum-depth.md', level: 3, fnName: 'maxDepth', selfRecursive: true,
    drive: (t, rec) => { rec.result = t({ value: 1, left: { value: 2, left: { value: 3, left: null, right: null }, right: { value: 4, left: null, right: null } }, right: { value: 5, left: null, right: null } }); },
  },
  {
    guide: '08-linked-list/11-lru-cache.md', level: 3, fnName: 'LRUCache', selfRecursive: false,
    drive: (t, rec) => { const c = new t(2); c.put(1, 1); c.put(2, 2); c.put(3, 3); rec.result = [c.get(1), c.get(3), c.get(2), c.get(9)]; },
  },
];

for (const { guide, level, fnName, selfRecursive, drive } of REAL) {
  const entry = blockEntry(manifest, guide, level);
  check(entry !== null, `${guide} L${level}: found in the manifest`);
  check(entry.targetFn === fnName, `${guide} L${level}: targetFn is ${fnName}`, `got ${entry.targetFn}`);
  check(entry.selfRecursive === selfRecursive, `${guide} L${level}: selfRecursive === ${selfRecursive}`);

  const guided = instrumentGuideBlock(guide, level);
  check(guided.entry.blockHash === blockHashOf(guided.source), `${guide} L${level}: the re-read source re-derives blockHash (K5)`);

  const env = runTraced(guided.instrumented, guided.entry, drive);
  const raw = runRaw(guided.source, guided.entry, drive);
  check(env.steps.length > 0, `${guide} L${level}: trace NOT empty — ${env.steps.length} steps (V11 would pass vacuously if it were)`);
  check(env.steps.every((s) => s.line.h === env.block.hash), `${guide} L${level}: I1 every line.h is the blockHash, never a line number`);
  check(env.steps.every((s) => s.line.off < env.block.lines), `${guide} L${level}: I1 every line.off is BLOCK-relative (< ${env.block.lines})`);
  const res = validateEnvelope(env);
  check(res.isValid, `${guide} L${level}: validateEnvelope accepts it`, JSON.stringify(res.errors.slice(0, 3)));
  check(stringify(env.result) === stringify(raw.result), `${guide} L${level}: I2 result identical traced vs raw`,
    `${stringify(env.result).slice(0, 90)} vs ${stringify(raw.result).slice(0, 90)}`);
  check(guided.instrumented.probes.every((p) => p.region === entry.regionTable[p.regionIndex]?.depth),
    `${guide} L${level}: every probe carries the depth the TABLE gave it`);

  if (guide.includes('maximum-depth')) {
    const frames = env.steps.filter((s) => s.text.includes('return 1 + Math.max'));
    check(frames.length >= 3, `${guide}: ${frames.length} recursive self-call steps — a runtime depth counter would emit 1`);
    check(frames.every((s) => s.line.h === env.block.hash), `${guide}: recursive steps carry the hash`);
  } else {
    const dNode = entry.regionTable.filter((r) => r.name === 'DLinkedNode');
    check(dNode.length > 0 && dNode.every((r) => r.depth === 1), `${guide}: the table marks DLinkedNode depth 1`,
      JSON.stringify(entry.regionTable));
    const ctorProbes = guided.instrumented.probes.filter((p) => p.enclosing === 'constructor');
    check(ctorProbes.some((p) => p.region === 1) && ctorProbes.some((p) => p.region === 0),
      `${guide}: BOTH constructors are probed — one region 1 (DLinkedNode), one region 0 (LRUCache); the integer is the only difference`);
    const attach = guided.instrumented.probes.filter((p) => p.enclosing === '_attachFront');
    check(attach.length > 0 && attach.every((p) => p.region === 0), `${guide}: _attachFront is baked region 0 (${attach.length} probes)`);
    check(!env.steps.some((s) => s.text.includes('this.prev = null') || s.text.includes('this.next = null')),
      `${guide}: ZERO steps from DLinkedNode's depth-1 body (only its constructor writes those fields)`,
      JSON.stringify(env.steps.filter((s) => s.text.includes('this.prev')).slice(0, 2)));
    const gated = env.steps.filter((s) => s.text.includes('this.head.next') || s.text.includes('node.prev.next'));
    check(gated.length > 0, `${guide}: ${gated.length} steps came through the depth-0 LRUCache methods`);
    check(/__T\(1,/.test(guided.instrumented.code) && /__T\(0,/.test(guided.instrumented.code),
      `${guide}: the emitted source literally contains BOTH __T(1,…) and __T(0,…)`);
  }
  console.log(`    ↳ ${guide} L${level}: ${env.steps.length} steps · region table ${entry.regionTable.map((r) => `${r.name}@${r.depth}`).join(' ')}`);
  const shown = env.steps.filter((s) => s.text.includes('node.prev.next') || s.text.includes('this.head.next') || s.text.includes('return 1 + Math.max')).slice(0, 3);
  if (shown.length) {
    console.log(`    ↳   depth-0 steps: ${JSON.stringify(shown.map((s) => ({ n: s.n, off: s.line.off, type: s.type, text: s.text })))}`);
  }
}

// ===========================================================================
group('S3: all 450 blocks instrument to valid JavaScript with resolvable offsets');
// ===========================================================================

{
  let instrumented = 0, skippedBlocks = 0, outOfRange = 0, noTarget = 0;
  const bad = [];
  for (const entry of manifest.blocks) {
    if (!entry.targetFn) { noTarget++; continue; }
    let out;
    try {
      out = instrumentBlock(readBlockSource(entry.path, entry.level), entry);
    } catch (err) {
      bad.push(`${entry.path} L${entry.level}: ${err.message}`);
      continue;
    }
    instrumented++;
    if (out.regionGate.skipped.length) skippedBlocks++;
    if (out.probes.some((p) => !(p.off >= 0 && p.off < entry.blockLines))) outOfRange++;
    try {
      // eslint-disable-next-line no-new-func
      new Function(out.code); // I2: the instrumented block must still BE JavaScript
    } catch (err) {
      bad.push(`${entry.path} L${entry.level}: emitted code is not valid JS — ${err.message}`);
    }
  }
  check(bad.length === 0, `S3 all ${instrumented} blocks instrument to valid JavaScript`, bad.slice(0, 4).join(' | '));
  check(outOfRange === 0, `S3 every probe offset is inside its own block (${outOfRange} blocks out of range)`);
  check(skippedBlocks === 1,
    `S3 exactly ONE block needed a skipped region-table row — the known \`object-method: Map\` row-7 regex artifact (${skippedBlocks})`,
    'a second one means row 7 and this walk have started to disagree');
  check(noTarget === 0, `S3 every block has a derived targetFn (${noTarget} null)`);
}

// ===========================================================================
group('I2: a condition is evaluated EXACTLY ONCE — proved behaviourally, not by syntax');
// ===========================================================================

{
  const fx = loadFixture('i2-single-eval.js');
  const ins = instrumentBlock(fx.source, fx.entry);
  check(fx.entry.targetFn === 'countUp', 'I2 the fixture derives `countUp` as the target', JSON.stringify(fx.entry.regionTable));

  // 1. the SHAPE: every condition probe replaces its condition with a single-evaluation hoist.
  const condProbes = ins.probes.filter((p) => p.type === 'if-test' || p.type === 'loop-head');
  check(condProbes.length > 0, `I2 the fixture has ${condProbes.length} condition probe(s)`);
  const hoists = (ins.code.match(/\(__c\d+ = \(/g) || []).length;
  check(hoists === condProbes.length,
    'I2 the emitted code hoists each condition into a temp — one hoist per condition probe',
    `hoists: ${hoists}, condition probes: ${condProbes.length}`);
  // Exactly ONE executable copy. The probe's `text` field is the guide's own line, so the string
  // legitimately mentions the condition too — those copies are stripped before counting, because
  // a `text` that quoted the source is the point (it is what the renderer highlights).
  const condText = 'alwaysTrue() && n < limit';
  const asCode = ins.code.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  check(asCode.split(condText).length - 1 === 1,
    `I2 the condition is executable ONCE — the probe REPLACED it (${asCode.split(condText).length - 1} executable copies, ${ins.code.split(condText).length - 1} including the quoted \`text\` fields)`);

  // 2. the BEHAVIOUR, which is the part that matters: `calls` counts every execution of the
  //    condition, so a second evaluation shows up in the RESULT the two runs disagree about.
  const env = runTraced(ins, fx.entry, DRIVES['i2-single-eval.js']);
  const raw = runRaw(fx.source, fx.entry, DRIVES['i2-single-eval.js']);
  check(stringify(raw.result) === '[4,5]', 'I2 the raw run executed the condition 5 times (4 iterations + the failing test)',
    `raw result: ${stringify(raw.result)}`);
  check(stringify(env.result) === stringify(raw.result),
    'I2 the TRACED run executed it the same number of times — the probe did not re-evaluate it',
    `traced ${stringify(env.result)} vs raw ${stringify(raw.result)}`);
  check(env.steps.filter((s) => s.type === 'loop-head').length === 5,
    `I2 every loop-head step recorded the condition, including the failing one (${env.steps.filter((s) => s.type === 'loop-head').length})`);
  check(
    env.steps.filter((s) => s.type === 'loop-head').map((s) => s.cond).join() === 'true,true,true,true,false',
    'I2 each loop-head recorded the value the loop ACTUALLY branched on — four true, then the false that exits',
    env.steps.filter((s) => s.type === 'loop-head').map((s) => s.cond).join());
  check(env.steps.some((s) => s.type === 'loop-back'), 'I2 loop-back fires per iteration');
  assertOffsets(env, 'I2');
}

// ===========================================================================
group('missing build/blocks.json fails by NAME, not with a bare ENOENT');
// ===========================================================================

{
  // The scripts are COPIED, not symlinked, so `audit-curriculum.mjs`'s `ROOT_DIR`
  // (`resolve(__dirname, '..')`) resolves into an empty tree with no `build/blocks.json` —
  // which is exactly a fresh clone. A symlink would resolve back to the real repo and find it.
  const root = path.join(os.tmpdir(), `ulw-no-blocks-${process.pid}`);
  const sandbox = path.join(root, 'scripts');
  fs.mkdirSync(sandbox, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x","type":"module"}');
  fs.cpSync(path.join(__dirname, 'lib'), path.join(sandbox, 'lib'), { recursive: true });
  // acorn + acorn-walk are devDependencies, so the copied tree needs them resolvable.
  fs.symlinkSync(path.join(ROOT_DIR, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  for (const rel of ['instrument.mjs', 'audit-curriculum.mjs', 'gen-blocks.mjs', 'validate-envelope.mjs']) {
    fs.copyFileSync(path.join(__dirname, rel), path.join(sandbox, rel));
  }
  const r = spawnSync(process.execPath, ['-e', `
    const m = await import('./scripts/instrument.mjs');
    try { m.loadManifest(); console.log('NO ERROR'); }
    catch (e) { console.log('THREW::' + e.message); }
  `], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  check(r.status === 0, 'a missing manifest exits cleanly (the named error, not a crash)', out);
  check(out.includes('THREW::'), 'a missing manifest THROWS a named error', out);
  check(!/ENOENT/.test(out), 'and it is NOT a bare ENOENT', out);
  check(out.includes(GENERATOR), `the message names \`node ${GENERATOR}\``, out);
  check(/gitignored/.test(out), 'and it says the file is generated, so the fix is obvious', out);
  fs.rmSync(root, { recursive: true, force: true });
}

// ===========================================================================
group('step shape: all ten §5 fields, present and typed, on every step');
// ===========================================================================

{
  const fx = loadFixture('e11-class.js');
  const env = runTraced(instrumentBlock(fx.source, fx.entry), fx.entry, DRIVES['e11-class.js']);
  const FIELDS = ['n', 'line', 'type', 'text', 'operands', 'cond', 'snap', 'delta', 'out', 'override'];
  check(env.steps.every((s) => FIELDS.every((f) => f in s)), 'every step carries all ten §5 fields',
    JSON.stringify(FIELDS.filter((f) => !(f in env.steps[0]))));
  check(env.steps.every((s) => typeof s.n === 'number' && s.n >= 1), 'n is a positive integer on every step');
  check(env.steps.every((s) => typeof s.text === 'string' && s.text.length > 0), 'text is a non-empty string on every step');
  check(env.steps.every((s) => s.cond === null || typeof s.cond === 'boolean'), 'cond is boolean or null on every step');
  check(env.steps.every((s) => typeof s.out === 'string' && s.out.length > 0), 'out is a non-empty narration on every step');
  check(env.steps.every((s) => s.override === null), 'override is null (row 27 owns the D12 override map)');
  check(env.steps.every((s) => s.delta.every((d) => 'path' in d && 'from' in d && 'to' in d)), 'every delta is {path, from, to}');
  const types = [...new Set(env.steps.map((s) => s.type))].sort();
  check(types.length >= 4, `several step types are exercised (${types.join(', ')})`);
  const withDelta = env.steps.find((s) => s.delta.length > 0 && s.n > 1);
  check(withDelta !== undefined, 'at least one delta is non-empty — D2 requires the changed-fields list to be real');
  if (withDelta) {
    const prev = env.steps[withDelta.n - 2];
    check(withDelta.delta.every((d) => stringify(prev.snap?.[d.path]) !== stringify(withDelta.snap?.[d.path])),
      'D2 every delta path really differs from the previous step');
    const unchanged = Object.keys(withDelta.snap ?? {}).filter((k) => stringify(prev.snap?.[k]) === stringify(withDelta.snap?.[k]));
    check(unchanged.every((k) => !withDelta.delta.some((d) => d.path === k)),
      `D2 unchanged fields are simply absent from the delta (${unchanged.length} such field(s))`);
  }
  check(env.steps.every((s) => s.snap === null || stringify(JSON.parse(JSON.stringify(s.snap))) === stringify(s.snap)),
    'I6 every snap is already in canonical serializer form (no live values)');
  const snapKeys = [...new Set(env.steps.flatMap((s) => Object.keys(s.snap ?? {})))];
  check(snapKeys.length > 0 && snapKeys.every((k) => e11.entry.watch.includes(k)),
    'I5/A1 every snap key is one of the manifest `watch` names',
    JSON.stringify(snapKeys.filter((k) => !e11.entry.watch.includes(k))));
}

// ===========================================================================
console.log('\n========================================');
console.log(`Groups: ${groups.length} — ${groups.join(' · ')}`);
console.log(`Fixtures: ${FIXTURE_NAMES.length} (E10 · E11 · E12 · E13 · E14×2 · E15×4 · E18) · real guides: 2 · corpus sweep: 450 blocks`);
console.log(`Assertions: ${assertions} | Failures: ${failures}`);
console.log('========================================\n');

if (failures > 0) process.exit(1);
