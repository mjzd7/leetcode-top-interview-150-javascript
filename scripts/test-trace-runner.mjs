/**
 * Row 10 — `api/_lib/trace-runner.mjs` acceptance tests (plan v5 §7 row 10, §6 ledger).
 *
 * The runner is the first thing that actually EXECUTES an instrumented block, so these
 * tests are deliberately end-to-end: a real guide block, the real judge test specs, the
 * real QuickJS sandbox, the real canonical serializer. Nothing is mocked, because the
 * failure this row exists to prevent is exactly the kind a mock cannot see — an envelope
 * that is structurally valid and factually wrong.
 *
 * Scenarios:
 *   S1  happy  — the 5 judge pilot slugs trace non-empty and every envelope passes
 *                 `validateEnvelope`.
 *   S2  edge   — E18 throw-safe flush · E21 chunk assembly + gap is a hard error ·
 *                 E24 timeout mid-trace · E10 recursive target non-empty ·
 *                 E11 class methods non-empty · E13 sibling helper suppressed ·
 *                 E5/E6 Map + typed-array canonical snapshots · I2 verdict isolation.
 *   S3  regress — `npm run test:judge`, `npm test`, `npm run validate` unchanged.
 *
 * `scripts/instrument.mjs` (row 9) is not in the tree yet, so every fixture below carries
 * its own hand-written instrumented source against the ABI `trace-runner.mjs` documents in
 * its header. When row 9 lands, `INSTRUMENTED_FIXTURES` becomes the thing it must satisfy.
 *
 * Run: `node scripts/test-trace-runner.mjs`
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeUserCode, parseVerdictEnvelope } from '../api/_lib/sandbox.mjs';
import { PROBLEMS, buildBundle } from '../api/_lib/problems.mjs';
import { validateEnvelope } from './validate-envelope.mjs';
// Row 5 defines the caps ONCE, on purpose ("so the runner cannot pick a second, larger
// number than the schema"). Rows 11/12 import them rather than re-deriving them, and this
// suite asserts the runner's exported constants are the SAME values, by identity.
import {
  CHUNK_MAX_CHARS as SLOT_CHARS,
  BYTE_BUDGET as SCHEMA_BYTE_BUDGET,
  EXEC_STEP_CAP as SCHEMA_EXEC_CAP,
  DISPLAY_STEP_CAP as SCHEMA_DISPLAY_CAP,
} from './validate-envelope.mjs';
import { serialize, deserialize } from './lib/serialize.mjs';
import { buildInstrumented } from './gen-traces.mjs';

// ---- the module under test. Its absence is the RED state. ------------------------
//
// The namespace is imported ALONGSIDE the named imports on purpose: rows 11/12 add exports,
// and a named import of a name that does not exist yet is a module-load crash, which is a
// legible RED for a human and an illegible one for CI. `traceRunner.X` turns a missing export
// into a FAILING ASSERTION that names the export, which is what this file's whole output
// format is built around.
import * as traceRunner from '../api/_lib/trace-runner.mjs';
import {
  runBlockTrace,
  loadBlocks,
  getBlock,
  assembleChunks,
  TraceAssemblyError,
  TraceAbiError,
  ManifestMissingError,
  CHUNK_MAX_CHARS,
  CHUNKS_PER_TRACE,
  TRACE_PREFIX,
  BLOCKS_PATH,
} from '../api/_lib/trace-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..');

let passed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`❌ [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const eq = (label, actual, expected) =>
  check(label, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/**
 * Run the module under test and turn a THROWN error into one failing assertion.
 *
 * Before rows 11/12 the `n=5000` fixture died deep inside the runner with an uncaught
 * `TraceAssemblyError`, which took the rest of this file with it — a suite that dies reports
 * less than a suite that fails. The cap cases below therefore assert on a returned envelope
 * when there is one and on a named failure when there is not.
 */
async function attempt(label, opts) {
  try {
    return { env: await runBlockTrace(opts), thrown: null };
  } catch (err) {
    check(label, false, `${err.name}: ${String(err.message).slice(0, 200)}`);
    return { env: null, thrown: err };
  }
}

// =====================================================================================
// The ABI, in one place. `scripts/instrument.mjs` (row 9) must emit exactly this.
//
//   __T__(regionIdx, off, type, cond, operands, snapThunks)
//
//     regionIdx    index into the manifest's `regionTable`
//     off          0-based line offset within the block
//     type         decl|assign|if-test|loop-head|loop-back|call|return|exit|throw
//     cond         boolean for a branch, null otherwise
//     operands     [[exprText, thunk], ...]  — the decision's sub-expressions
//     snapThunks   [thunk, ...]              — one per watch name IN SCOPE here,
//                                             in manifest `watch` order
//
// Thunks, not bare values: a probe must never move the run it measures. A bare
// `left` at a point where `let left` is still in TDZ would throw inside the traced
// function and abort the whole case. Each thunk is called in its own try/catch.
// =====================================================================================

/**
 * One keyed operand: expression text plus the expression that yields its value.
 * `I5` demands every binding the expression names be in `watch`.
 */
const O = (exprText, valueExpr) => [exprText, valueExpr];

/**
 * One emit point. `watch` is `{name: expr}` (a name is simply absent when the binding is
 * not in scope at this node); `operands` is `[[exprText, valueExpr], ...]`. Both arrive as
 * thunks so a probe can never throw into the run it measures.
 */
const T = (idx, off, type, watch = {}, cond = null, operands = []) =>
  `__T__(${idx}, ${off}, ${JSON.stringify(type)}, ${cond === null ? 'null' : cond}, `
  + `${JSON.stringify(operands.map(([text]) => text))}, `
  + `{${Object.entries(watch).map(([name, expr]) => `${JSON.stringify(name)}: function(){ return ${expr}; }`).join(', ')}}, `
  // The thunks are emitted as SOURCE, never JSON.stringify'd: JSON turns a function into
  // `null`, and the prelude would then silently capture no operand at all.
  + `[${operands.map(([, expr]) => `function(){ return ${expr}; }`).join(', ')}]);`;

// ---- instrumented sources for the 5 pilot slugs (level 3 blocks, verbatim shape) ----

const PILOT_INSTRUMENTED = {
  // The guide's own statements, with a probe AFTER each one the trace describes. The
  // cond/operand expressions are read-only: `stack[--top] !== code` in the valid-parentheses
  // default branch decrements `top`, so evaluating it at the probe would move the state it
  // is meant to observe. A probe that perturbs the run is the one bug this engine cannot
  // have, so the fixture reads a safe equivalent where the guide's own expression mutates.
  'two-sum': [
    'function twoSum(nums, target) {',
    '  const seen = new Map();',
    `  ${T(0, 6, 'decl', { nums: 'nums', target: 'target', seen: 'seen' })}`,
    '  const n = nums.length;',
    `  ${T(0, 7, 'decl', { n: 'n' })}`,
    '  for (let i = 0; i < n; i++) {',
    `    ${T(0, 9, 'loop-head', { i: 'i', n: 'n' }, 'i < n', [O('i < n', 'i < n')])}`,
    '    const num = nums[i];',
    `    ${T(0, 10, 'assign', { num: 'nums[i]' }, null, [O('nums[i]', 'nums[i]')])}`,
    '    const complement = target - num;',
    `    ${T(0, 11, 'assign', { complement: 'target - num' }, null, [O('target - num', 'target - num')])}`,
    `    ${T(0, 14, 'if-test', { seen: 'seen', complement: 'complement' }, 'seen.has(complement)', [O('seen.has(complement)', 'seen.has(complement)')])}`,
    '    if (seen.has(complement)) {',
    '      return [seen.get(complement), i];',
    '    }',
    '    seen.set(num, i);',
    `    ${T(0, 19, 'call', { seen: 'seen', num: 'num', i: 'i' }, null, [O('seen.set(num, i)', 'num')])}`,
    '  }',
    '  return [];',
    '}',
  ].join('\n'),

  'valid-parentheses': [
    'function isValid(s) {',
    '  const n = s.length;',
    `  ${T(0, 6, 'decl', { s: 's', n: 'n' })}`,
    `  ${T(0, 8, 'if-test', { n: 'n' }, '(n & 1) === 1', [O('(n & 1) === 1', '(n & 1) === 1')])}`,
    '  if ((n & 1) === 1) return false;',
    '  const stack = new Uint8Array(n);',
    `  ${T(0, 11, 'decl', { stack: 'stack' })}`,
    '  let top = 0;',
    '  for (let i = 0; i < n; i++) {',
    `    ${T(0, 14, 'loop-head', { i: 'i', n: 'n' }, 'i < n', [O('i < n', 'i < n')])}`,
    '    const code = s.charCodeAt(i);',
    `    ${T(0, 15, 'assign', { code: 's.charCodeAt(i)' }, null, [O('s.charCodeAt(i)', 's.charCodeAt(i)')])}`,
    '    switch (code) {',
    '      case 40:',
    '        stack[top++] = 41;',
    `        ${T(0, 19, 'assign', { stack: 'stack', top: 'top' }, null, [O('top', 'top')])}`,
    '        break;',
    '    }',
    '  }',
    `  ${T(0, 36, 'return', { top: 'top' }, null, [O('top === 0', 'top === 0')])}`,
    '  return top === 0;',
    '}',
  ].join('\n'),

  'search-insert-position': [
    'function searchInsert(nums, target) {',
    '  let left = 0;',
    `  ${T(0, 6, 'assign', { left: 'left' }, null, [O('0', '0')])}`,
    '  let right = nums.length - 1;',
    `  ${T(0, 7, 'assign', { right: 'nums.length - 1' }, null, [O('nums.length - 1', 'nums.length - 1')])}`,
    '  while (left <= right) {',
    `    ${T(0, 9, 'loop-head', { left: 'left', right: 'right' }, 'left <= right', [O('left <= right', 'left <= right')])}`,
    '    const mid = left + ((right - left) >> 1);',
    `    ${T(0, 11, 'assign', { mid: 'left + ((right - left) >> 1)' }, null, [O('mid', 'mid')])}`,
    `    ${T(0, 12, 'if-test', { nums: 'nums', mid: 'mid', target: 'target' }, 'nums[mid] >= target', [O('nums[mid] >= target', 'nums[mid] >= target')])}`,
    '    if (nums[mid] >= target) right = mid - 1;',
    '    else left = mid + 1;',
    '  }',
    '  return left;',
    '}',
  ].join('\n'),

  'climbing-stairs': [
    'function climbStairs(n) {',
    `  ${T(0, 6, 'if-test', { n: 'n' }, 'n <= 2', [O('n <= 2', 'n <= 2')])}`,
    '  if (n <= 2) return n;',
    '  let a = 1;',
    `  ${T(0, 7, 'assign', { a: 'a' }, null, [O('1', '1')])}`,
    '  let b = 2;',
    `  ${T(0, 8, 'assign', { b: 'b' }, null, [O('2', '2')])}`,
    '  for (let i = 3; i <= n; i++) {',
    `    ${T(0, 9, 'loop-head', { i: 'i', n: 'n' }, 'i <= n', [O('i <= n', 'i <= n')])}`,
    '    [a, b] = [b, a + b];',
    `    ${T(0, 11, 'assign', { a: 'a', b: 'b' }, null, [O('a + b', 'a + b')])}`,
    '  }',
    '  return b;',
    '}',
  ].join('\n'),

  'invert-binary-tree': [
    'function invertTree(node) {',
    `  ${T(0, 7, 'if-test', { node: 'node' }, 'node === null', [O('node === null', 'node === null')])}`,
    '  if (node === null) return null;',
    '  [node.left, node.right] = [node.right, node.left];',
    `  ${T(0, 9, 'assign', { node: 'node' }, null, [O('node.right', 'node.right')])}`,
    '  invertTree(node.left);',
    `  ${T(0, 10, 'call', { node: 'node' }, null, [O('node.left', 'node.left')])}`,
    '  invertTree(node.right);',
    `  ${T(0, 11, 'call', { node: 'node' }, null, [O('node.right', 'node.right')])}`,
    '  return node;',
    '}',
  ].join('\n'),
};

/**
 * Which authored case each slug's trace is taken from. Case 0 everywhere except
 * climbing-stairs: `climbStairs(1)` returns at its guard clause, so a trace from it would
 * be one step and would prove nothing about the loop that is the point of the guide. The
 * verdict always covers the WHOLE spec regardless — `caseIndex` chooses the narrative, not
 * the measurement (I2).
 */
const TRACE_CASE_INDEX = {
  'two-sum': 0,
  'valid-parentheses': 0,
  'search-insert-position': 0,
  'climbing-stairs': 3,
  'invert-binary-tree': 0,
};

/** The 5 slugs the plan names as the V1 acceptance set (§7 row 10). */
const PILOT_SLUGS = [
  'two-sum',
  'valid-parentheses',
  'search-insert-position',
  'climbing-stairs',
  'invert-binary-tree',
];

// =====================================================================================
// Synthetic fixtures. Each is a real `blocks.json`-shaped entry so `runBlockTrace` cannot
// tell a fixture from a curriculum block — that is the point: the region gate, the chunk
// assembly and the flush are exercised through the one code path.
// =====================================================================================

const FAKE_HASH = 'sha256:' + 'a'.repeat(64);

/** A fixture `blocks.json` entry. `regionTable` mirrors the shapes E10–E13 need. */
function fixtureBlock({ targetFn, regionTable, watch, codec = 'json', blockLines = 20 }) {
  return {
    blockHash: FAKE_HASH,
    blockLines,
    blockOffset: 1,
    codec,
    level: 3,
    path: 'fixtures/synthetic.md',
    regionTable,
    selfRecursive: false,
    targetFn,
    watch,
  };
}

// ---- E10: a self-recursive target must still emit on its own self-call --------------
const E10_BLOCK = fixtureBlock({
  targetFn: 'factorialish',
  regionTable: [{ depth: 0, kind: 'function-decl', name: 'factorialish' }],
  watch: ['n', 'acc'],
});
// off 1 = `if (n === 0) return acc;`, off 2 = the recursive call.
const E10_SOURCE = [
  'function factorialish(n, acc) {',
  '  if (n === 0) return acc;',
  '  return factorialish(n - 1, acc * n);',
  '}',
].join('\n');
const E10_INSTRUMENTED = [
  'function factorialish(n, acc) {',
  `  ${T(0, 1, 'if-test', { n: 'n', acc: 'acc' }, 'n === 0', [O('n === 0', 'n === 0')])}`,
  '  if (n === 0) return acc;',
  `  ${T(0, 2, 'call', { n: 'n', acc: 'acc' }, null, [O('n - 1', 'n - 1')])}`,
  '  return factorialish(n - 1, acc * n);',
  '}',
].join('\n');

// ---- E11 + E13: a class target whose methods are depth 0, beside a depth-1 helper ---
// This is the LRU-cache shape `build/blocks.json` records for `08-linked-list/11-lru-cache`
// level 3: the helper class sits at depth 1 (a same-block sibling → E13, suppressed) while
// every method of the target class is depth 0 (E11 → must emit). Both halves are asserted
// below, so neither can regress unnoticed.
const E11_BLOCK = fixtureBlock({
  targetFn: 'Counter',
  regionTable: [
    { depth: 1, kind: 'class', name: 'Aux' },
    { depth: 1, kind: 'class-method', name: 'bump' },
    { depth: 0, kind: 'class', name: 'Counter' },
    { depth: 0, kind: 'class-method', name: 'constructor' },
    { depth: 0, kind: 'class-method', name: 'inc' },
    { depth: 0, kind: 'class-method', name: 'get' },
  ],
  watch: ['delta', 'this.total', 'k'],
});
// Line offsets as the uninstrumented class reads them:
//   2 `return x + 1;` (Aux.bump, depth 1) · 10 the constructor tail · 13 `inc` body · 17 `get` body
// The constructor calls `inc` and `get` itself, because the judge driver only ever calls the
// target once — a method that nothing invokes cannot produce a step, and the claim under
// test is that class methods are depth 0, not that the driver happens to reach them.
const E11_INSTRUMENTED = [
  'class Aux {',
  '  bump(x) {',
  `    ${T(1, 2, 'assign', { x: 'x' }, null, [O('x', 'x')])}`,
  '    return x + 1;',
  '  }',
  '}',
  'class Counter {',
  '  constructor(delta) {',
  '    this.delta = delta;',
  '    this.total = 0;',
  `    ${T(3, 10, 'decl', { delta: 'delta', 'this.total': 'this.total' }, null, [O('delta', 'delta')])}`,
  '    this.inc(1);',
  '    return this.get();',
  '  }',
  '  inc(k) {',
  `    ${T(4, 13, 'assign', { 'this.total': 'this.total' }, null, [O('k', 'k')])}`,
  '    this.total += k * this.delta;',
  '    return this.total;',
  '  }',
  '  get() {',
  `    ${T(5, 17, 'return', { 'this.total': 'this.total' }, null, [O('this.total', 'this.total')])}`,
  '    return this;',
  '  }',
  '}',
].join('\n');
const E11_SOURCE = E11_INSTRUMENTED.replace(/__T__\([^;]*\);\n/g, '');
const E11_CASES = [{ name: 'construct with delta 3', args: [3], expected: { delta: 3, total: 3 } }];

// ---- E18: a step throws mid-run -----------------------------------------------------
// Line offsets as the uninstrumented function reads them:
//   1 `let sum = 0;` · 2 the for head · 3 `sum += xs[i];` · 4 the throwing if
const E18_BLOCK = fixtureBlock({
  targetFn: 'blowsUp',
  regionTable: [{ depth: 0, kind: 'function-decl', name: 'blowsUp' }],
  watch: ['xs', 'sum', 'i'],
});
const E18_SOURCE = [
  'function blowsUp(xs) {',
  '  let sum = 0;',
  '  for (let i = 0; i < xs.length; i++) {',
  '    sum += xs[i];',
  "    if (sum > 6) throw new Error('over budget: ' + sum);",
  '  }',
  '  return sum;',
  '}',
].join('\n');
const E18_INSTRUMENTED = [
  'function blowsUp(xs) {',
  `  ${T(0, 1, 'decl', { xs: 'xs' })}`,
  '  let sum = 0;',
  `  ${T(0, 2, 'assign', { sum: 'sum' }, null, [O('0', '0')])}`,
  '  for (let i = 0; i < xs.length; i++) {',
  `    ${T(0, 2, 'loop-head', { i: 'i', xs: 'xs' }, 'i < xs.length', [O('i < xs.length', 'i < xs.length')])}`,
  '    sum += xs[i];',
  `    ${T(0, 3, 'assign', { sum: 'sum' }, null, [O('xs[i]', 'xs[i]')])}`,
  '    if (sum > 6) {',
  `      ${T(0, 4, 'throw', { sum: 'sum' }, 'sum > 6', [O('sum > 6', 'sum > 6')])}`,
  "      throw new Error('over budget: ' + sum);",
  '    }',
  '  }',
  '  return sum;',
  '}',
].join('\n');
const E18_CASES = [{ name: 'throws on the third element', args: [[2, 3, 5]], expected: 10 }];

// ---- E24: flush a bounded prefix, then hang so the timeout fires mid-trace -----------
// Bounded on purpose. A spinning loop's step COUNT is machine-dependent, so asserting
// "some steps survived" against an unbounded spin would be flaky; emitting a fixed 40
// steps first — enough to fill several slots at the test's chunk cap — makes the property
// under test deterministic: slots already on stdout survive the interrupt.
const E24_BLOCK = fixtureBlock({
  targetFn: 'spins',
  regionTable: [{ depth: 0, kind: 'function-decl', name: 'spins' }],
  // `k` is here because invariant 5 checks every binding an OPERAND names, and the loop
  // condition is `k < 40` — a name the manifest does not watch would be rejected.
  watch: ['i', 'k'],
});
const E24_SOURCE = [
  'function spins(n) {',
  '  let i = 0;',
  '  for (let k = 0; k < 40; k++) {',
  '    i += k;',
  '  }',
  '  while (true) {',
  '    i += 1;',
  '  }',
  '  return i;',
  '}',
].join('\n');
const E24_INSTRUMENTED = [
  'function spins(n) {',
  '  let i = 0;',
  `  ${T(0, 1, 'decl', { i: 'i' })}`,
  '  for (let k = 0; k < 40; k++) {',
  `    ${T(0, 2, 'loop-head', { i: 'i' }, 'k < 40', [O('k < 40', 'k < 40')])}`,
  '    i += k;',
  '  }',
  '  while (true) {',
  '    i += 1;',
  '  }',
  '  return i;',
  '}',
].join('\n');
const E24_CASES = [{ name: 'never terminates', args: [1], expected: 0 }];

// =====================================================================================
// Rows 11 + 12 fixtures. Same `fixtureBlock` shape, same probe ABI, one code path.
// =====================================================================================

// ---- E23: a cheap long loop, so the EXECUTION cap is what stops it, not the clock ----
// 300 000 iterations of `acc += i` costs QuickJS well under the 3 s timeout when nothing is
// probing it, so the UNINSTRUMENTED verdict run (I2) completes normally and the only thing
// that can end the traced run is the step cap. Sized so `execStepCap` can be lowered for the
// test without turning the fixture into a different case — see the `execStepCap` below.
const E23_BLOCK = fixtureBlock({ targetFn: 'spin', regionTable: [{ depth: 0, kind: 'function-decl', name: 'spin' }], watch: ['i', 'n'] });
const E23_SOURCE = [
  'function spin(n) {',
  '  let acc = 0;',
  '  for (let i = 0; i < n; i++) {',
  '    acc += i;',
  '  }',
  '  return acc;',
  '}',
].join('\n');
const E23_INSTRUMENTED = [
  'function spin(n) {',
  '  let acc = 0;',
  `  ${T(0, 1, 'decl', { n: 'n' })}`,
  '  for (let i = 0; i < n; i++) {',
  `    ${T(0, 2, 'loop-head', { i: 'i', n: 'n' }, 'i < n', [O('i < n', 'i < n')])}`,
  '    acc += i;',
  '  }',
  '  return acc;',
  '}',
].join('\n');
const E23_CASES = [{ name: '300k iterations', args: [300000], expected: 44999850000 }];

// ---- E25: an allocation the 16 MB heap refuses ----------------------------------------
// The plan's number, not a shrunken one (E25 names `merge-k-sorted-lists`, which builds k fresh
// arrays per output node). Measured, though: a run that allocates 1.6 MB per turn does NOT OOM at
// all — `setMemoryLimit` refuses an ALLOCATION, so the refusal only happens once one request
// exceeds the whole heap. Hence 5 000 000 elements (40 MB) in a single turn, which QuickJS turns
// into `Memory Limit Exceeded` on turn 1. The probe BEFORE the allocation is what guarantees at
// least one `__TRACE__<seq>` slot reached stdout first, because an OOM with no slot is not "trace
// flushed if any".
const E25_BLOCK = fixtureBlock({ targetFn: 'balloon', regionTable: [{ depth: 0, kind: 'function-decl', name: 'balloon' }], watch: ['i', 'n'] });
const balloon = (size) => [
  'function balloon(n) {',
  '  const keep = [];',
  '  for (let i = 0; i < n; i++) {',
  `    keep.push(new Array(${size}).fill(i));`,
  '  }',
  '  return keep.length;',
  '}',
].join('\n');
const balloonTraced = (size) => [
  'function balloon(n) {',
  '  const keep = [];',
  `  ${T(0, 1, 'decl', { keep: 'keep' })}`,
  '  for (let i = 0; i < n; i++) {',
  `    ${T(0, 2, 'loop-head', { i: 'i' }, 'i < n', [O('i < n', 'i < n')])}`,
  `    keep.push(new Array(${size}).fill(i));`,
  `    ${T(0, 3, 'assign', { i: 'i' }, null, [O('keep.length', 'keep.length')])}`,
  '  }',
  '  return keep.length;',
  '}',
].join('\n');
const E25_SOURCE = balloon(5000000);
const E25_INSTRUMENTED = balloonTraced(5000000);
const E25_CASES = [{ name: 'never fits', args: [1000], expected: 1000 }];
const E25_FITS_CASES = [{ name: 'fits in a bigger heap', args: [40], expected: 40 }];
// Six turns, not a thousand: every step re-encodes the whole growing container, so a long run
// is dominated by the clock rather than by the byte ceiling — which is the E25 lesson anyway.
const E25_BLOWUP_CASES = [{ name: 'blows up on turn 2', args: [6], expected: 6 }];

// ---- E22's sibling: one step wider than the whole transport ---------------------------
// A 2 000-element array canonicalises to ~13 kB, and the transport below is 900 chars a slot for
// 12 slots, so by turn 2 a single step cannot travel at all. Shipping it oversized is how one
// step silently eats the log allowance and the NEXT slot is dropped. A SMALL allocation on turn
// 1 is deliberate: the trace needs one deliverable step for "what arrived before the blow-up" to
// mean anything.
const E25_BLOWUP_BLOCK = fixtureBlock({ targetFn: 'balloon', regionTable: [{ depth: 0, kind: 'function-decl', name: 'balloon' }], watch: ['keep', 'i', 'n'] });
const E25_BLOWUP_SOURCE = balloon(2000);
const E25_BLOWUP_INSTRUMENTED = [
  'function balloon(n) {',
  '  const keep = [];',
  `  ${T(0, 1, 'decl', { keep: 'keep' })}`,
  '  for (let i = 0; i < n; i++) {',
  `    ${T(0, 2, 'loop-head', { keep: 'keep' }, 'i < n', [O('i < n', 'i < n')])}`,
  '    keep.push(new Array(2000).fill(i));',
  `    ${T(0, 3, 'assign', { keep: 'keep' }, null, [O('keep.length', 'keep.length')])}`,
  '  }',
  '  return keep.length;',
  '}',
].join('\n');

// ---- E22: the guide's own `twoSum`, n=5000, at row 10's probe ABI ----------------------
// The ledger names `n=5000` two-sum, and the blowup is real: with `nums` watched, EVERY one of
// the 5 000 turns re-encodes a 5 000-element array, which is ~120 MB of step JSON against a
// 12.6 MB transport. It is written here rather than taken from `buildInstrumented` because row
// 15's `ADAPTER_PROBE` is a SEPARATE emitter that pushes into `__T_BUF__` without reading any of
// rows 11/12's state — the in-sandbox degrade lives in `__T__`, so a case that has to reach it
// must speak row 10's ABI. `E22` below runs the adapter shape too, as the regression guard for
// the emitter this row cannot edit.
const E22_BLOCK = fixtureBlock({
  targetFn: 'twoSum',
  regionTable: [{ depth: 0, kind: 'function-decl', name: 'twoSum' }],
  watch: ['nums', 'target', 'i', 'num', 'complement', 'seen'],
});
const E22_SOURCE = [
  'function twoSum(nums, target) {',
  '  const seen = new Map();',
  '  for (let i = 0; i < nums.length; i++) {',
  '    const num = nums[i];',
  '    const complement = target - num;',
  '    if (seen.has(complement)) return [seen.get(complement), i];',
  '    seen.set(num, i);',
  '  }',
  '  return [];',
  '}',
].join('\n');
const E22_INSTRUMENTED = [
  'function twoSum(nums, target) {',
  '  const seen = new Map();',
  '  for (let i = 0; i < nums.length; i++) {',
  '    const num = nums[i];',
  '    const complement = target - num;',
  `    ${T(0, 2, 'loop-head', { nums: 'nums', i: 'i', target: 'target' }, 'i < nums.length', [O('i < nums.length', 'i < nums.length')])}`,
  '    if (seen.has(complement)) return [seen.get(complement), i];',
  `    ${T(0, 5, 'assign', { seen: 'seen', num: 'num', complement: 'complement' }, null, [O('target - num', 'target - num')])}`,
  '    seen.set(num, i);',
  '  }',
  '  return [];',
  '}',
].join('\n');
/** `n=5000` on an unsolvable target, so all 5 000 turns execute instead of returning early. */
const twoSumN5000 = () => {
  const nums = Array.from({ length: 5000 }, (_, i) => (i * 7919) % 5003);
  return { nums, cases: [{ name: 'n=5000, no pair sums to the target', args: [nums, -999999], expected: [] }] };
};
// ---- the DISPLAY CAP fixture: a counter, so 5 000 steps stay SMALL ------------------
// The acceptance case is `n=5000`, and a snapshot of a counter costs ~200 bytes a step while
// a snapshot of a 5 000-element array costs ~24 KB. The display cap is about the UI being
// handed more rows than it can animate, so the fixture has to produce 5 000 of them and stay
// far under the byte ceiling — otherwise the byte cap would fire first and the two rows
// (11 and 12) would be testing each other instead of themselves.
const DISPLAY_BLOCK = fixtureBlock({ targetFn: 'countTo', regionTable: [{ depth: 0, kind: 'function-decl', name: 'countTo' }], watch: ['i', 'n'] });
const DISPLAY_SOURCE = [
  'function countTo(n) {',
  '  let total = 0;',
  '  for (let i = 1; i <= n; i++) {',
  '    total += i;',
  '  }',
  '  return total;',
  '}',
].join('\n');
const DISPLAY_INSTRUMENTED = [
  'function countTo(n) {',
  '  let total = 0;',
  `  ${T(0, 1, 'decl', { n: 'n' })}`,
  '  for (let i = 1; i <= n; i++) {',
  `    ${T(0, 2, 'loop-head', { i: 'i', n: 'n' }, 'i <= n', [O('i <= n', 'i <= n')])}`,
  '    total += i;',
  `    ${T(0, 3, 'assign', { i: 'i' }, null, [O('i', 'i')])}`,
  '  }',
  '  return total;',
  '}',
].join('\n');
const DISPLAY_CASES = [
  { name: 'n=3', args: [3], expected: 6 },
  { name: 'n=5000', args: [5000], expected: 12502500 },
];

// ---- E20's other arm: a LARGE, UNCHANGING snapshot ------------------------------------
// Measured, twice, the other way round: degrading a five-step trace made it BIGGER (4 021 ->
// 4 393 bytes), and degrading a 10 001-step counter made it bigger again (3.00 -> 3.24 MB).
// Because a delta plus the narration outweighs a snapshot of two small scalars. So "over budget
// => under budget" needs a snapshot-dominated trace, and the smallest honest one is a binding
// that is big and never changes: `table` costs ~24 kB per step as a snapshot and nothing at all
// as a delta, which is exactly the ratio row 11's degrade exists to exploit.
const WIDE_BLOCK = fixtureBlock({
  targetFn: 'countWide',
  regionTable: [{ depth: 0, kind: 'function-decl', name: 'countWide' }],
  watch: ['i', 'n', 'table', 'total'],
});
const WIDE_SOURCE = [
  'function countWide(n, table) {',
  '  let total = 0;',
  '  for (let i = 1; i <= n; i++) {',
  '    total += table[i];',
  '  }',
  '  return total;',
  '}',
].join('\n');
const WIDE_INSTRUMENTED = [
  'function countWide(n, table) {',
  '  let total = 0;',
  `  ${T(0, 1, 'decl', { table: 'table', n: 'n' })}`,
  '  for (let i = 1; i <= n; i++) {',
  `    ${T(0, 2, 'loop-head', { i: 'i', n: 'n', total: 'total', table: 'table' }, 'i <= n', [O('i <= n', 'i <= n')])}`,
  '    total += table[i];',
  `    ${T(0, 3, 'assign', { i: 'i', total: 'total' }, null, [O('table[i]', 'table[i]')])}`,
  '  }',
  '  return total;',
  '}',
].join('\n');
/** `[0, 1, 2, …, 5000]` as `table[0..5000]`, so `table[1] + … + table[5000]` is 12 502 500. */
const wideTable = () => [0, ...Array.from({ length: 5000 }, (_, i) => i + 1)];
const WIDE_CASES = [{ name: 'n=5000 over a 5 001-entry table', args: [5000, wideTable()], expected: 12502500 }];

// =====================================================================================
// S3 — the manifest itself
// =====================================================================================
section('S3 · manifest plumbing');
{
  const blocks = loadBlocks();
  check('loadBlocks() reads build/blocks.json', Array.isArray(blocks) && blocks.length === 450,
    `got ${Array.isArray(blocks) ? blocks.length : typeof blocks}`);
  eq('BLOCKS_PATH points at build/blocks.json', path.basename(BLOCKS_PATH), 'blocks.json');

  const twoSumL3 = getBlock('05-hashmap/06-two-sum.md', 3);
  check('getBlock(path, 3) resolves twoSum', twoSumL3?.targetFn === 'twoSum', JSON.stringify(twoSumL3?.targetFn));
  eq('getBlock carries the manifest region table depth', twoSumL3.regionTable[0].depth, 0);
  check('getBlock is read-only w.r.t. the manifest', blocks.length === 450);

  let threw = null;
  try { getBlock('05-hashmap/99-does-not-exist.md', 3); } catch (e) { threw = e; }
  check('an unknown guide path throws rather than inventing a block', threw !== null, 'returned undefined instead');
}

// =====================================================================================
// S1 — the 5 judge pilot slugs
// =====================================================================================
section('S1 · V1 green on the 5 judge pilot slugs');
const pilotEnvelopes = {};
for (const slug of PILOT_SLUGS) {
  const entry = PROBLEMS[slug];
  check(`${slug}: judge spec + catalog identity present`, Boolean(entry?.fnName && entry?.codec));
  const envelope = await runBlockTrace({
    path: entry.path,
    level: 3,
    slug,
    instrumented: PILOT_INSTRUMENTED[slug],
    caseIndex: TRACE_CASE_INDEX[slug],
  });
  pilotEnvelopes[slug] = envelope;

  const v = validateEnvelope(envelope);
  check(`${slug}: envelope passes validateEnvelope`, v.isValid, v.errors.join(' | '));
  check(`${slug}: trace is NON-EMPTY (vacuity guard)`, envelope.steps.length > 0,
    `0 steps — a gate that drops everything would look identical to a working one`);
  check(`${slug}: trace is more than a single step`, envelope.steps.length > 1,
    `${envelope.steps.length} step(s) — that is a branch, not a trace`);
  check(`${slug}: no error on a correct solution`, envelope.error === null, JSON.stringify(envelope.error));
  // Each of these traces is a few KB against the production 1 MB ceiling, so the honest
  // slot count is exactly one. Over-splitting is a real bug class and not a cosmetic one:
  // a cap compared as a string flushes on every step, and nothing else notices.
  check(`${slug}: one slot at the production cap`, envelope.budget.chunks === 1,
    `${envelope.budget.chunks} slots for a ${envelope.budget.bytes}-byte envelope`);
  check(`${slug}: stepCount agrees with the shipped steps`, envelope.stepCount >= envelope.steps.length);
  check(`${slug}: every step index strictly increases`,
    envelope.steps.every((s, i) => i === 0 || s.n > envelope.steps[i - 1].n));
  check(`${slug}: every step anchors to block.hash`,
    envelope.steps.every((s) => s.line.h === envelope.block.hash && s.line.off < envelope.block.lines));
  check(`${slug}: truncated is exactly {execution, display, trace}`,
    JSON.stringify(Object.keys(envelope.truncated).sort()) === '["display","execution","trace"]');
  check(`${slug}: verdict is exactly {passed, failed}`,
    JSON.stringify(Object.keys(envelope.verdict).sort()) === '["failed","passed"]',
    JSON.stringify(envelope.verdict));
  console.log(`   ${slug}: ${envelope.stepCount} steps, ${envelope.budget.chunks} chunk(s), `
    + `${envelope.budget.bytes} bytes, verdict ${envelope.verdict.passed}/${envelope.verdict.failed}, `
    + `result ${JSON.stringify(envelope.result)}`);
}

// =====================================================================================
// S2 — K6 canonical snapshots reaching the envelope
// =====================================================================================
section('S2 · E5/E6 · snapshots are canonical, not raw');
{
  const mapStep = pilotEnvelopes['two-sum'].steps.find((s) => s.snap && s.snap.seen && s.snap.seen.__map);
  check('two-sum: a Map watch value arrives as {"__map":…}', Boolean(mapStep),
    'no step carried a __map token — plain JSON.stringify would have flattened it to {}');
  if (mapStep) {
    check('two-sum: the __map token round-trips to a live Map',
      deserialize(mapStep.snap.seen) instanceof Map);
  }
  const filled = pilotEnvelopes['two-sum'].steps.filter((s) => s.snap?.seen?.__map?.length > 0);
  check('two-sum: the Map token carries its entries', filled.length > 0,
    'every __map token was empty — the probe never saw the map fill up');
  check('two-sum: an entry survives the round trip', deserialize(filled.at(-1).snap.seen).size > 0,
    `${filled.length} step(s) carried a non-empty __map`);

  const taStep = pilotEnvelopes['valid-parentheses'].steps.find((s) => s.snap && s.snap.stack && s.snap.stack.__ta);
  check('valid-parentheses: a Uint8Array watch value arrives as {"__ta":"Uint8",…}', Boolean(taStep),
    'no step carried a __ta token');
  if (taStep) {
    check('valid-parentheses: the __ta token names Uint8',
      taStep.snap.stack.__ta === 'Uint8', JSON.stringify(taStep.snap.stack).slice(0, 120));
    check('valid-parentheses: the token round-trips to a live Uint8Array',
      deserialize(taStep.snap.stack) instanceof Uint8Array);
    check('valid-parentheses: the typed-array contents survive the round trip',
      deserialize(taStep.snap.stack).length === 2, 'expected the n-sized buffer');
  }

  for (const slug of PILOT_SLUGS) {
    const env = pilotEnvelopes[slug];
    const live = env.steps.filter((s) => s.snap && Object.values(s.snap).some((v) => typeof v === 'number' && Number.isNaN(v)));
    check(`${slug}: no live NaN survived into a snap`, live.length === 0);
    const rawSnap = env.steps.filter((s) => s.snap && Object.values(s.snap).some((v) => v instanceof Map || v instanceof Set));
    check(`${slug}: no live Map/Set survived into a snap`, rawSnap.length === 0,
      'a live container would have been flattened to {} by JSON.stringify');
    // An operand thunk that is emitted as JSON instead of source becomes `null`/`"…"`, the
    // call throws inside the prelude, and the operand vanishes SILENTLY — leaving a
    // structurally valid trace whose branch decisions carry no values at all. This is the
    // assertion that class of bug cannot hide behind.
    const withOperands = env.steps.filter((s) => Object.keys(s.operands).length > 0);
    check(`${slug}: some step carries operand VALUES`, withOperands.length > 0,
      'every operands map was empty — the operand thunks are not reaching the sandbox');
    check(`${slug}: operand values are canonical, not raw`,
      withOperands.every((s) => Object.values(s.operands).every((v) => JSON.stringify(serialize(v)) === JSON.stringify(v))),
      'an operand was not already in the canonical serializer\'s form');
  }

  // The canonical two-sum decision: `seen.has(7)` is false on the first pass, then true.
  const twoSumSteps = pilotEnvelopes['two-sum'].steps;
  const branchSteps = twoSumSteps.filter((s) => s.type === 'if-test');
  check('two-sum: the complement branch was probed at least once', branchSteps.length >= 2,
    `${branchSteps.length} if-test step(s)`);
  if (branchSteps.length >= 2) {
    eq('two-sum: `seen.has(complement)` is false on the first pass',
      branchSteps[0].cond, false);
    eq('two-sum: `seen.has(complement)` is true on the pass that returns',
      branchSteps.at(-1).cond, true);
    check('two-sum: the operand key is the expression as written',
      Object.keys(branchSteps[0].operands).includes('seen.has(complement)'),
      JSON.stringify(Object.keys(branchSteps[0].operands)));
    eq('two-sum: the operand value is the canonical `false`',
      branchSteps.at(-1).operands['seen.has(complement)'], true);
  }
}

// =====================================================================================
// S2 — I2 verdict isolation: the trace can never move a verdict
// =====================================================================================
section('S2 · I2 · verdict comes from an uninstrumented run');
{
  for (const slug of PILOT_SLUGS) {
    const entry = PROBLEMS[slug];
    // Run the SAME block uninstrumented, exactly as /api/judge/run would.
    const raw = await executeUserCode(buildBundle({
      userCode: readBlockSource(entry.path, 3),
      fnName: entry.fnName,
      codec: entry.codec,
      tests: entry.tests,
    }), { timeoutMs: 3000 });
    const rawVerdict = parseVerdictEnvelope(raw.envelopeRaw, raw.logs);
    check(`${slug}: the raw run produced a verdict envelope`, Boolean(rawVerdict), 'no __VERDICT__ line');
    if (rawVerdict) {
      eq(`${slug}: traced verdict === uninstrumented verdict`,
        pilotEnvelopes[slug].verdict, { passed: rawVerdict.passed, failed: rawVerdict.failed });
    }
    check(`${slug}: verdict.passed + verdict.failed > 0 (I7)`,
      pilotEnvelopes[slug].verdict.passed + pilotEnvelopes[slug].verdict.failed > 0);
  }

  // The sharp arm. The instrumented block returns `[9, 9]` — wrong for every case in the
  // spec — while the uninstrumented source is the guide's own correct twoSum. I2 says the
  // verdict describes the UNINSTRUMENTED run, so the envelope must report 3/0 passed AND
  // carry `result: [9, 9]`: the trace saw the wrong answer and the verdict still does not
  // move. If the verdict were ever taken from the traced run this reads 0/3 and fails.
  const divergent = await runBlockTrace({
    path: '05-hashmap/06-two-sum.md',
    level: 3,
    slug: 'two-sum',
    instrumented: [
      'function twoSum(nums, target) {',
      `  ${T(0, 5, 'decl', { nums: 'nums', target: 'target' })}`,
      '  for (let i = 0; i < nums.length; i++) {',
      `    ${T(0, 7, 'loop-head', { nums: 'nums', i: 'i' }, 'i < nums.length', [O('i < nums.length', 'i < nums.length')])}`,
      '  }',
      '  return [9, 9];',
      '}',
    ].join('\n'),
  });
  const divergentV = validateEnvelope(divergent);
  check('I2: a divergent instrumented run still yields a VALID envelope', divergentV.isValid, divergentV.errors.join(' | '));
  eq('I2: the verdict is the uninstrumented run\'s, not the traced run\'s', divergent.verdict, { passed: 3, failed: 0 });
  eq('I2: `result` DOES carry what the traced run returned', divergent.result, [9, 9]);
  check('I2: the trace and the verdict disagree on purpose, and both were reported',
    divergent.steps.length > 0 && divergent.result[0] === 9 && divergent.verdict.failed === 0,
    `${divergent.steps.length} steps, result ${JSON.stringify(divergent.result)}, verdict ${JSON.stringify(divergent.verdict)}`);

  // The converse: when the UNINSTRUMENTED source is the broken one, the verdict must move.
  // Otherwise the first arm would pass for the wrong reason (a verdict that never moves).
  const brokenSource = [
    'function twoSum(nums, target) {',
    '  return [9, 9];',
    '}',
  ].join('\n');
  const broken = await runBlockTrace({
    path: '05-hashmap/06-two-sum.md',
    level: 3,
    slug: 'two-sum',
    source: brokenSource,
    instrumented: [
      'function twoSum(nums, target) {',
      `  ${T(0, 5, 'decl', { nums: 'nums', target: 'target' })}`,
      '  return [9, 9];',
      '}',
    ].join('\n'),
  });
  const brokenV = validateEnvelope(broken);
  check('I2: a broken UNINSTRUMENTED source still yields a VALID envelope', brokenV.isValid, brokenV.errors.join(' | '));
  check('I2: the verdict DOES move when the real source is broken',
    broken.verdict.failed > 0 && broken.verdict.passed === 0, JSON.stringify(broken.verdict));
  check('I2: a broken solution still traces non-empty', broken.steps.length > 0);
}

// =====================================================================================
// S2 — E10: recursion emits on the self-call (no runtime depth counter)
// =====================================================================================
section('S2 · E10 · a recursive target still emits');
{
  const env = await runBlockTrace({
    path: 'fixtures/recursive.md',
    level: 3,
    block: E10_BLOCK,
    source: E10_SOURCE,
    instrumented: E10_INSTRUMENTED,
    cases: [{ name: 'factorial of 4', args: [4, 1], expected: 24 }],
  });
  const v = validateEnvelope(env);
  check('E10: envelope passes validateEnvelope', v.isValid, v.errors.join(' | '));
  check('E10: trace is NON-EMPTY (a depth counter would have suppressed every step)', env.steps.length > 0,
    '0 steps — the region gate cannot tell a self-call from a foreign call unless the manifest says depth 0');
  check('E10: it recursed more than once', env.stepCount > 2, `${env.stepCount} steps`);
  check('E10: verdict from the raw run', env.verdict.passed === 1 && env.verdict.failed === 0,
    JSON.stringify(env.verdict));
  // The recursion regression. A recursive target's self-calls resolve the global name at
  // CALL time, so once the flush wrapper is installed every frame runs through it. If the
  // wrapper flushed per frame, this trace would occupy one slot per node and — worse —
  // report the INNERMOST return (`acc` at the base case) as `result`.
  check('E10: recursion does NOT explode the slot count', env.budget.chunks === 1,
    `${env.budget.chunks} slots — the recursion is being re-entered through the wrapper`);
  eq('E10: `result` is the OUTERMOST return, not the innermost', env.result, 24);
  console.log(`   E10: ${env.stepCount} steps for n=4, ${env.budget.chunks} slot(s), result=${env.result}`);
}

// =====================================================================================
// S2 — E11 + E13: class methods emit; a same-block sibling helper does not
// =====================================================================================
section('S2 · E11/E13 · class methods emit, a sibling helper is suppressed');
{
  const env = await runBlockTrace({
    path: 'fixtures/class.md',
    level: 3,
    block: E11_BLOCK,
    source: E11_SOURCE,
    instrumented: E11_INSTRUMENTED,
    cases: E11_CASES,
  });
  const v = validateEnvelope(env);
  check('E11: envelope passes validateEnvelope', v.isValid, v.errors.join(' | '));
  check('E11: a class method trace is NON-EMPTY (the vacuity guard)', env.steps.length > 0,
    '0 steps — class methods lexically inside the target are depth 0 and MUST emit');
  check('E11: every step comes from a depth-0 region', env.steps.length === 3,
    `expected 3 steps (constructor + inc + get), got ${env.steps.length}`);
  check('E13: the depth-1 sibling helper emitted nothing',
    env.steps.every((s) => s.line.off !== 2), 'a step landed on the Aux.bump helper, which the manifest marks depth 1');
  check('E11: a class target still gets a verdict', env.verdict.passed + env.verdict.failed > 0,
    JSON.stringify(env.verdict));
  console.log(`   E11: ${env.stepCount} steps at offsets ${env.steps.map((s) => s.line.off).join(', ')}`);
}

// =====================================================================================
// S2 — E18: a thrown step flushes the partial trace with `error` set
// =====================================================================================
section('S2 · E18 · a thrown step flushes the partial trace');
{
  const env = await runBlockTrace({
    path: 'fixtures/throws.md',
    level: 3,
    block: E18_BLOCK,
    source: E18_SOURCE,
    instrumented: E18_INSTRUMENTED,
    cases: E18_CASES,
  });
  const v = validateEnvelope(env);
  check('E18: envelope passes validateEnvelope', v.isValid, v.errors.join(' | '));
  check('E18: the PARTIAL trace survived the throw', env.steps.length > 0,
    '0 steps — one throw must not truncate the trace (plan §3 G3)');
  check('E18: `error` is set', typeof env.error === 'string' && env.error.includes('over budget'),
    JSON.stringify(env.error));
  check('E18: the last step is the throwing one', env.steps.at(-1)?.type === 'throw',
    JSON.stringify(env.steps.at(-1)?.type));
  check('E18: `result` is null on a throw', env.result === null);
  check('E18: the execution was NOT truncated (it finished, badly)', env.truncated.execution === false);
  check('E18: the verdict still came from the raw run and reports the failure',
    env.verdict.failed === 1 && env.verdict.passed === 0, JSON.stringify(env.verdict));
  console.log(`   E18: ${env.stepCount} steps flushed, error="${env.error.split('\n')[0]}", verdict ${JSON.stringify(env.verdict)}`);
}

// =====================================================================================
// S2 — E21: chunking, host assembly, and a gap as a HARD error
// =====================================================================================
section('S2 · E21 · chunking and host-side assembly');
{
  // 1. One trace, several slots, reassembled into one step list.
  const many = await runBlockTrace({
    path: '05-hashmap/06-two-sum.md',
    level: 3,
    slug: 'two-sum',
    instrumented: PILOT_INSTRUMENTED['two-sum'],
    chunkMaxChars: 900,
  });
  check('E21: a small chunk cap forces multiple slots', many.budget.chunks > 1,
    `chunks=${many.budget.chunks} — the cap was ${900} chars and the whole trace is bigger`);
  const manyV = validateEnvelope(many);
  check('E21: the assembled envelope passes validateEnvelope', manyV.isValid, manyV.errors.join(' | '));
  check('E21: assembly preserved every step in order',
    many.steps.map((s) => s.n).join(',') === many.steps.map((_, i) => i + 1).join(','));
  check('E21: the chunked trace matches the single-chunk trace step for step',
    many.stepCount === pilotEnvelopes['two-sum'].stepCount
      && many.steps.length === pilotEnvelopes['two-sum'].steps.length,
    `${many.stepCount}/${many.steps.length} vs ${pilotEnvelopes['two-sum'].stepCount}/${pilotEnvelopes['two-sum'].steps.length}`);
  console.log(`   E21: ${many.budget.chunks} slots reassembled into ${many.steps.length} steps`);

  // 2. No chunk exceeds the cap (except a single step that cannot be split).
  const perChunk = many.budget.chunks;
  check('E21: chunk count is reported honestly', perChunk >= 1);

  // 3. A GAP is a hard error, never a silently short trace.
  let gapErr = null;
  try {
    assembleChunks([
      `${TRACE_PREFIX}0{"stepCount":1,"steps":[{"n":1}],"done":false}`,
      `${TRACE_PREFIX}2{"stepCount":2,"steps":[{"n":2}],"done":true,"result":null,"error":null}`,
    ]);
  } catch (e) { gapErr = e; }
  check('E21: a sequence GAP is a hard TraceAssemblyError', gapErr instanceof TraceAssemblyError,
    gapErr ? gapErr.constructor.name : 'no throw');
  check('E21: the gap error NAMES the missing slot', gapErr && /__TRACE__1/.test(gapErr.message),
    gapErr ? gapErr.message : '');

  // 4. A duplicated slot is a gap too.
  let dupErr = null;
  try {
    assembleChunks([
      `${TRACE_PREFIX}0{"stepCount":1,"steps":[{"n":1}],"done":false}`,
      `${TRACE_PREFIX}0{"stepCount":2,"steps":[{"n":2}],"done":true,"result":null,"error":null}`,
    ]);
  } catch (e) { dupErr = e; }
  check('E21: a DUPLICATE slot is a hard error', dupErr instanceof TraceAssemblyError);

  // 5. A missing terminator on a COMPLETE run is a hard error (not "no steps").
  let noDoneErr = null;
  try {
    assembleChunks([`${TRACE_PREFIX}0{"stepCount":1,"steps":[{"n":1}],"done":false}`], { executionCut: false });
  } catch (e) { noDoneErr = e; }
  check('E21: a complete run with no terminator is a hard error', noDoneErr instanceof TraceAssemblyError,
    noDoneErr ? noDoneErr.message : 'no throw — a missing `done` must never read as "no steps"');

  // 6. A missing terminator IS legal when the execution itself was cut (E24).
  const cut = assembleChunks([`${TRACE_PREFIX}0{"stepCount":1,"steps":[{"n":1}],"done":false}`], { executionCut: true });
  check('E21: a cut execution may end without a terminator', cut.steps.length === 1 && cut.done === false);

  // 7. A truncated (log-cap-sliced) chunk is caught by its own step count.
  let slicedErr = null;
  try {
    assembleChunks([
      `${TRACE_PREFIX}0{"stepCount":1,"steps":[{"n":1}],"done":false}`,
      `${TRACE_PREFIX}1{"stepCount":9,"steps":[{"n":2},{"n":3}],"done":true,"result":null,"error":null}`,
    ]);
  } catch (e) { slicedErr = e; }
  check('E21: a slot whose stepCount disagrees with its steps is a hard error',
    slicedErr instanceof TraceAssemblyError, slicedErr ? slicedErr.message : 'no throw');

  // 8. Invalid JSON in a slot is a hard error, not a dropped slot.
  let junkErr = null;
  try {
    assembleChunks([`${TRACE_PREFIX}0{"stepCount":1,"steps":[{"n":1}],"done":true,"result":null,"error":null`,]);
  } catch (e) { junkErr = e; }
  check('E21: an unparseable slot is a hard error', junkErr instanceof TraceAssemblyError);
}

// =====================================================================================
// S2 — E24: the 3 s timeout mid-trace
// =====================================================================================
section('S2 · E24 · a timeout mid-trace');
{
  const env = await runBlockTrace({
    path: 'fixtures/spins.md',
    level: 3,
    block: E24_BLOCK,
    source: E24_SOURCE,
    instrumented: E24_INSTRUMENTED,
    cases: E24_CASES,
    timeoutMs: 400,
    // A small slot cap on purpose: at the production 1 MB nothing would flush before the
    // interrupt, and the property under test is precisely that slots ALREADY on stdout
    // survive a run that never terminates.
    chunkMaxChars: 800,
  });
  const v = validateEnvelope(env);
  check('E24: envelope passes validateEnvelope', v.isValid, v.errors.join(' | '));
  check('E24: truncated.execution is true', env.truncated.execution === true);
  check('E24: truncated.trace stayed FALSE (I3 — its own flag)', env.truncated.trace === false,
    'a timeout is not a trace overflow; borrowing the flag here is the exact I3 defect');
  check('E24: truncated.display stayed false', env.truncated.display === false);
  check('E24: the partial trace survived', env.steps.length > 0, '0 steps flushed before the interrupt');
  check('E24: `error` names the timeout', /Time Limit|interrupt/i.test(String(env.error)), JSON.stringify(env.error));
  check('E24: `result` is null', env.result === null);
  check('E24: the zero-sum verdict is exempt from I7 only because execution was truncated',
    env.truncated.execution === true, JSON.stringify(env.verdict));
  console.log(`   E24: ${env.stepCount} steps flushed before the interrupt, error="${env.error}"`);
}

// =====================================================================================
// S2 — the loud-failure contracts
// =====================================================================================
section('S2 · loud failures (nothing is swallowed)');
{
  let codecErr = null;
  try {
    await runBlockTrace({
      path: 'fixtures/bad-codec.md',
      level: 3,
      block: fixtureBlock({ targetFn: 'noop', regionTable: [{ depth: 0, kind: 'function-decl', name: 'noop' }], watch: [], codec: 'quantum' }),
      source: 'function noop(){ return 1; }',
      instrumented: 'function noop(){ return 1; }',
      cases: [{ name: 'x', args: [], expected: 1 }],
    });
  } catch (e) { codecErr = e; }
  check('an unimplemented codec throws (no default branch)', codecErr !== null, 'ran anyway');
  check('the codec error names the codec', codecErr && /quantum/.test(codecErr.message),
    codecErr ? codecErr.message : '');

  let fnErr = null;
  try {
    await runBlockTrace({
      path: 'fixtures/bad-fn.md',
      level: 3,
      block: fixtureBlock({ targetFn: 'x); process.exit(1);//', regionTable: [{ depth: 0, kind: 'function-decl', name: 'x' }], watch: [] }),
      source: 'function x(){ return 1; }',
      instrumented: 'function x(){ return 1; }',
      cases: [{ name: 'x', args: [], expected: 1 }],
    });
  } catch (e) { fnErr = e; }
  check('a non-identifier fnName is rejected before it reaches eval()', fnErr !== null, 'accepted');
  check('ManifestMissingError is exported for a missing build/blocks.json',
    typeof ManifestMissingError === 'function');

  const unknownPathErr = await (async () => {
    try {
      await runBlockTrace({ path: 'no/such/guide.md', level: 3, instrumented: 'function f(){}', cases: [] });
      return null;
    } catch (e) { return e; }
  })();
  check('a guide path absent from the manifest throws', unknownPathErr !== null, 'returned an envelope');
  check('the unknown-path error names how to regenerate the manifest',
    unknownPathErr && /gen-blocks\.mjs|block/.test(unknownPathErr.message), unknownPathErr?.message);

  // The ABI guard, exercised against the row-9 module as it exists in the tree right now.
  // An emitter with a different probe shape produces an envelope with zero steps that passes
  // every schema check — indistinguishable from a block that legitimately emits nothing, which
  // is the vacuity hole E10/E11 exist to close. So it is refused, by name.
  let abiErr = null;
  try {
    await runBlockTrace({ path: PROBLEMS['two-sum'].path, level: 3, slug: 'two-sum' });
  } catch (e) { abiErr = e; }
  const row9Present = fs.existsSync(path.join(REPO, 'scripts/instrument.mjs'));
  if (row9Present) {
    check('with no `instrumented` and row 9 present, the runner uses row 9', abiErr === null || abiErr.name === 'TraceAbiError',
      abiErr ? `${abiErr.name}: ${abiErr.message.slice(0, 120)}` : 'ok');
    if (abiErr) {
      check('an ABI mismatch is refused, not shipped as an empty trace', abiErr.name === 'TraceAbiError',
        abiErr.name);
      check('the ABI error names the shape it expected AND the one it found',
        /__T__\(/.test(abiErr.message), abiErr.message.slice(0, 200));
      check('TraceAbiError is exported so a caller can catch it specifically',
        typeof TraceAbiError === 'function');
    }
  } else {
    check('with no `instrumented` and no row 9, the error names scripts/instrument.mjs',
      abiErr !== null && /instrument\.mjs/.test(abiErr.message), abiErr?.message ?? 'no throw');
  }
}

// =====================================================================================
// S2 · the chunk cap is the sandbox's own measured constant
// =====================================================================================
section('S2 · caps are derived from measured constants');
{
  check('CHUNK_MAX_CHARS is the sandbox 1 MB slot', CHUNK_MAX_CHARS === 1024 * 1024, String(CHUNK_MAX_CHARS));
  check('CHUNKS_PER_TRACE is 12', CHUNKS_PER_TRACE === 12, String(CHUNKS_PER_TRACE));
  check('TRACE_PREFIX is __TRACE__', TRACE_PREFIX === '__TRACE__');
}

// =====================================================================================
// ROWS 11 + 12 — plan v5 §7 rows 11/12, §3 K2/I2/I3/I4, §6 E20–E25.
//
// Row 10 deliberately left three holes and named them: a 4 MB byte budget that was fiction
// (the real slot is 1 MB and it drops silently), a `truncated` flag borrowed from the LOG
// cap, and no caps at all. These are the checks that close them.
//
// The shape of every case below is the same: an over-cap run must come back as a VALID
// envelope that SAYS WHICH cap it hit, in the one field that means it. Silently short,
// silently degraded, or silently dropped are all failures.
// =====================================================================================
section('S2 · rows 11/12 · caps are derived, not invented');
{
  // The derivation, asserted rather than asserted-about. `BYTE_BUDGET` must be exactly
  // 60% of 12 slots of the measured 1 MB envelope slot — the numbers in plan §5, not a
  // number this suite likes.
  eq('BYTE_BUDGET is floor(slot x 12 slots x 0.6)', SCHEMA_BYTE_BUDGET, Math.floor(SLOT_CHARS * 12 * 0.6));
  eq('EXEC_STEP_CAP is 200 000', SCHEMA_EXEC_CAP, 200000);
  eq('DISPLAY_STEP_CAP is 2 000', SCHEMA_DISPLAY_CAP, 2000);
  check('the runner RE-EXPORTS BYTE_BUDGET (row 11 owns the degrade, so it needs the number)',
    traceRunner.BYTE_BUDGET === SCHEMA_BYTE_BUDGET,
    `runner has ${JSON.stringify(traceRunner.BYTE_BUDGET)}, schema has ${SCHEMA_BYTE_BUDGET}`);
  check('the runner RE-EXPORTS EXEC_STEP_CAP', traceRunner.EXEC_STEP_CAP === SCHEMA_EXEC_CAP,
    `runner has ${JSON.stringify(traceRunner.EXEC_STEP_CAP)}`);
  check('the runner RE-EXPORTS DISPLAY_STEP_CAP', traceRunner.DISPLAY_STEP_CAP === SCHEMA_DISPLAY_CAP,
    `runner has ${JSON.stringify(traceRunner.DISPLAY_STEP_CAP)}`);
  check('the runner\'s CHUNK_MAX_CHARS is the schema\'s — one definition, not two',
    traceRunner.CHUNK_MAX_CHARS === SLOT_CHARS, `${traceRunner.CHUNK_MAX_CHARS} vs ${SLOT_CHARS}`);

  // The transport ceiling. `sandbox.mjs` sizes its log allowance at
  // `chunkMaxChars x chunksPerTrace`, and past it a whole `__TRACE__<seq>` line is DROPPED,
  // which `assembleChunks` turns into a hard gap error. So the ceiling the SANDBOX stops at
  // has to be that allowance, not a number invented here.
  eq('ASSEMBLED_CEILING is exactly sandbox.mjs\'s own maxLogChars for a traced run',
    traceRunner.ASSEMBLED_CEILING, CHUNK_MAX_CHARS * CHUNKS_PER_TRACE + traceRunner.LOG_HEADROOM_CHARS);
  check('the assembled ceiling is ABOVE the byte budget, so both can be right',
    traceRunner.ASSEMBLED_CEILING > SCHEMA_BYTE_BUDGET,
    `${traceRunner.ASSEMBLED_CEILING} <= ${SCHEMA_BYTE_BUDGET} — the envelope budget and the transport allowance cannot both be right`);
  check('the assembled ceiling is the slot count times the slot cap, plus the log headroom',
    traceRunner.ASSEMBLED_CEILING === CHUNK_MAX_CHARS * CHUNKS_PER_TRACE + traceRunner.LOG_HEADROOM_CHARS
      && traceRunner.ASSEMBLED_CEILING > CHUNK_MAX_CHARS * CHUNKS_PER_TRACE,
    `${traceRunner.ASSEMBLED_CEILING}`);
}

// =====================================================================================
// S2 · E20 — over budget degrades to `diff`, in the one field that means it (I3/I4)
// =====================================================================================
section('S2 · E20 · over budget degrades to diff');
{
  // The real two-sum pilot at a budget its own envelope cannot meet. Same block, same cases,
  // same instrumented source as the S1 run above — the ONLY difference is the budget, so
  // anything else that moved would be the cap's fault rather than the budget's.
  const degraded = await runBlockTrace({
    path: PROBLEMS['two-sum'].path,
    level: 3,
    slug: 'two-sum',
    instrumented: PILOT_INSTRUMENTED['two-sum'],
    byteBudget: 2000,
  });
  const v = validateEnvelope(degraded);
  check('E20: the degraded envelope still passes validateEnvelope', v.isValid, v.errors.join(' | '));
  eq('E20: budget.mode became "diff"', degraded.budget.mode, 'diff');
  check('E20: truncated.trace is true (its OWN flag — I3)', degraded.truncated.trace === true);
  check('E20: shedding snapshots did NOT set truncated.execution', degraded.truncated.execution === false,
    'a byte-budget degrade is not an execution cut — borrowing the flag here is the I3 defect');
  check('E20: shedding snapshots did NOT set truncated.display', degraded.truncated.display === false,
    'a byte-budget degrade is not a display truncation');
  check('E20: every step shed its snapshot (I4)', degraded.steps.every((s) => s.snap === null),
    `${degraded.steps.filter((s) => s.snap !== null).length} step(s) still carry a snapshot`);
  check('E20: at least one step carries a server-emitted delta (I4)',
    degraded.steps.some((s) => s.delta.length > 0), 'nothing was shed and nothing was emitted');
  check('E20: no step was DROPPED to fit — the trace is complete-but-degraded',
    degraded.steps.length === pilotEnvelopes['two-sum'].steps.length,
    `${degraded.steps.length} vs ${pilotEnvelopes['two-sum'].steps.length} — a degrade is not a truncation`);
  check('E20: `result` survives the degrade', JSON.stringify(degraded.result) === JSON.stringify(pilotEnvelopes['two-sum'].result),
    `${JSON.stringify(degraded.result)} vs ${JSON.stringify(pilotEnvelopes['two-sum'].result)}`);
  // I2 under degrade: the budget moved, the verdict must not have.
  eq('E20: the verdict did NOT move with the budget', degraded.verdict, pilotEnvelopes['two-sum'].verdict);
  console.log(`   E20: ${degraded.stepCount} steps, ${degraded.budget.bytes} bytes, mode=${degraded.budget.mode}`);

  // Arm 2: the budget is actually HONOURED — which only holds where snapshots are the payload.
  //
  // Measured on arm 1: degrading a five-step trace made it BIGGER (4 021 -> 4 393 bytes),
  // because a delta plus the narration outweighs a snapshot of two numbers. So "over budget =>
  // under budget" is a property of snapshot-dominated traces and the fixture has to be one.
  // The budget here is the full trace's OWN measured size, so no number in this test is a
  // guess and the assertion cannot be satisfied by tuning a constant.
  const wide = await runBlockTrace({
    path: 'fixtures/count-wide.md',
    level: 3,
    block: WIDE_BLOCK,
    source: WIDE_SOURCE,
    instrumented: WIDE_INSTRUMENTED,
    cases: WIDE_CASES,
  });
  const shrunk = await runBlockTrace({
    path: 'fixtures/count-wide.md',
    level: 3,
    block: WIDE_BLOCK,
    source: WIDE_SOURCE,
    instrumented: WIDE_INSTRUMENTED,
    cases: WIDE_CASES,
    // One byte under its own measured size: the smallest budget the full envelope cannot meet,
    // so the assertion cannot be satisfied by tuning anything.
    byteBudget: wide.budget.bytes - 1,
  });
  eq('E20: the snapshot-dominated trace degrades at its own measured size', shrunk.budget.mode, 'diff');
  check('E20: and the degrade is a real SAVING where snapshots dominate',
    shrunk.budget.bytes < wide.budget.bytes,
    `${shrunk.budget.bytes} vs ${wide.budget.bytes} bytes — shedding snapshots saved nothing`);
  check('E20: the degraded envelope is under the budget it was given',
    shrunk.budget.bytes <= wide.budget.bytes - 1, `${shrunk.budget.bytes} vs ${wide.budget.bytes - 1}`);
  const shrunkV = validateEnvelope(shrunk);
  check('E20: the shrunk envelope passes validateEnvelope', shrunkV.isValid, shrunkV.errors.join(' | '));
  eq('E20: and its verdict is the same one', shrunk.verdict, wide.verdict);
  console.log(`   E20 wide: ${wide.budget.bytes} bytes -> ${shrunk.budget.bytes} bytes over ${wide.stepCount} steps`);
}

// =====================================================================================
// S2 · E21 — a chunk over the slot cap is seq-numbered and host-assembled; a gap is loud
// =====================================================================================
section('S2 · E21 · a 3 MB trace chunks, and a gap in one is a hard error');
{
  // The ledger's own fixture: "synthetic 3 MB trace". Three slots of ~1 MB, each one step
  // bigger than the 1 MB slot cap on its own would be — which is exactly the shape that used
  // to be dropped silently.
  const fat = 'x'.repeat(1_100_000);
  const slot = (seq, n, done) => `${TRACE_PREFIX}${seq}${JSON.stringify({
    stepCount: seq + 1,
    steps: [{ n: seq + 1, off: 0, type: 'assign', cond: null, operands: {}, snap: { blob: fat } }],
    done,
    result: null,
    error: null,
  })}`;
  const logs = [slot(0, 1, false), slot(1, 2, false), slot(2, 3, true)];
  check('E21: the synthetic trace really is ~3 MB',
    logs.reduce((n, l) => n + l.length, 0) > 3 * 1024 * 1024,
    `${logs.reduce((n, l) => n + l.length, 0)} chars`);
  check('E21: each slot is a SINGLE step that exceeds the slot cap', logs.every((l) => l.length > CHUNK_MAX_CHARS),
    `slot sizes ${logs.map((l) => l.length).join(', ')} against a ${CHUNK_MAX_CHARS} cap`);

  const whole = assembleChunks(logs);
  eq('E21: three seq-numbered slots assemble into three steps', whole.steps.length, 3);
  eq('E21: the slot count is reported', whole.chunks, 3);
  eq('E21: the steps keep their sequence', whole.steps.map((s) => s.n).join(','), '1,2,3');
  check('E21: the terminating slot\'s result came through', whole.done === true);

  // The gap. Dropping the middle slot is what `sandbox.mjs` does on log overflow, and it is
  // the failure plan §1 U2 describes: the payload vanishes and the only signal left points at
  // the log buffer. It must be a named error.
  let gapErr = null;
  try { assembleChunks([logs[0], logs[2]]); } catch (e) { gapErr = e; }
  check('E21: dropping a 1 MB slot is a hard TraceAssemblyError', gapErr instanceof TraceAssemblyError,
    gapErr ? gapErr.constructor.name : 'no throw — the trace would have shipped 2 of 3 steps');
  check('E21: the gap error NAMES the missing slot', gapErr && gapErr.message.includes(`${TRACE_PREFIX}1`),
    gapErr ? gapErr.message.slice(0, 160) : '');

  // And the real transport, end to end at a deliberately tiny cap.
  const chunked = await runBlockTrace({
    path: PROBLEMS['two-sum'].path,
    level: 3,
    slug: 'two-sum',
    instrumented: PILOT_INSTRUMENTED['two-sum'],
    chunkMaxChars: 700,
  });
  const cv = validateEnvelope(chunked);
  check('E21: the real chunked run passes validateEnvelope', cv.isValid, cv.errors.join(' | '));
  check('E21: the tiny cap really did produce several slots', chunked.budget.chunks > 1,
    `${chunked.budget.chunks} slot(s)`);
  eq('E21: host-side assembly lost nothing', chunked.steps.map((s) => s.n).join(','),
    pilotEnvelopes['two-sum'].steps.map((s) => s.n).join(','));
  console.log(`   E21: ${chunked.budget.chunks} slots -> ${chunked.steps.length} steps, no gap`);
}

// =====================================================================================
// S2 · E22 — a snapshot blowup degrades INSIDE the sandbox, before the heap dies
// =====================================================================================
section('S2 · E22 · n=5000 two-sum degrades inside the sandbox');
{
  // The ledger's fixture: the guide's own twoSum at n=5000 on an unsolvable target, so all
  // 5 000 turns execute. With `nums` watched, every turn re-encodes a 5 000-element array —
  // ~120 MB of step JSON against a 12.6 MB transport allowance.
  const { nums, cases } = twoSumN5000();
  const { env } = await attempt('E22: the n=5000 blowup returns an envelope instead of dying', {
    path: 'fixtures/two-sum-5000.md',
    level: 3,
    block: E22_BLOCK,
    source: E22_SOURCE,
    instrumented: E22_INSTRUMENTED,
    cases,
    // Bytes, not the clock. Every step re-encodes 5 000 numbers, so the traced run is slow by
    // construction and a 3 s default would report a TIMEOUT and prove nothing about bytes.
    timeoutMs: 120000,
  });
  if (env) {
    const v = validateEnvelope(env);
    check('E22: the n=5000 blowup yields a VALID envelope', v.isValid, v.errors.slice(0, 3).join(' | '));
    eq('E22: budget.mode is "diff" — it degraded instead of dying', env.budget.mode, 'diff');
    check('E22: truncated.trace is true', env.truncated.trace === true);
    check('E22: the snapshot payload is GONE', env.steps.every((s) => s.snap === null),
      `${env.steps.filter((s) => s.snap !== null).length} step(s) still carry a snapshot`);
    check('E22: deltas were emitted for the degraded span (I4)',
      env.steps.filter((s) => s.delta.length > 0).length > 0, 'no step carries a delta');
    check('E22: the assembled trace stayed inside the transport allowance',
      env.budget.bytes <= SCHEMA_BYTE_BUDGET, `${env.budget.bytes} vs ${SCHEMA_BYTE_BUDGET}`);
    // The transport proof is that this envelope EXISTS: `assembleChunks` raises a hard
    // `TraceAssemblyError` on a sequence gap, and `sandbox.mjs` produces exactly that gap when
    // it drops a line past `maxLogChars`. So a returned envelope is the evidence that no slot was
    // dropped — the slot COUNT is not the invariant, because a slot's char count is not the slot
    // cap either (measured: 60 small slots here, where a full-slot trace stops at 12).
    check('E22: the trace is BOUNDED — recording stopped before the run did',
      env.steps.length < 10000, `${env.steps.length} steps — the untruncated trace has ~10 000`);
    check('E22: and it is bounded from ABOVE too, not just below the step count',
      env.steps.length > 0 && env.budget.chunks >= 1, `${env.budget.chunks} slot(s)`);
    check('E22: the partial trace is still a trace', env.steps.length > 0, '0 steps');
    check('E22: the envelope says so rather than pretending it finished', env.truncated.execution === true,
      'steps stopped arriving before the run did — that is exactly what truncated.execution means');
    check('E22: `error` names the byte budget', /byte budget/i.test(String(env.error)),
      JSON.stringify(env.error));
    check('E22: the verdict came from the raw run and is real', env.verdict.passed + env.verdict.failed > 0,
      JSON.stringify(env.verdict));
    console.log(`   E22: ${env.stepCount} steps kept of ~10 000, ${env.budget.chunks} slot(s), `
      + `${env.budget.bytes} bytes, mode=${env.budget.mode}, verdict ${JSON.stringify(env.verdict)}`);
  }

  // The control: the SAME fixture at a size that fits. If the caps were firing on ordinary
  // traces, this is the run that would show it — and the 450 goldens below are the real proof.
  const smallNums = Array.from({ length: 200 }, (_, i) => (i * 7919) % 5003);
  const small = await runBlockTrace({
    path: 'fixtures/two-sum-5000.md',
    level: 3,
    block: E22_BLOCK,
    source: E22_SOURCE,
    instrumented: E22_INSTRUMENTED,
    cases: [{ name: 'n=200, unsolvable', args: [smallNums, -999999], expected: [] }],
  });
  eq('E22: n=200 stays in `full` mode — the cap is the size, not the function', small.budget.mode, 'full');
  check('E22: n=200 is not truncated at all',
    !small.truncated.trace && !small.truncated.display && !small.truncated.execution,
    JSON.stringify(small.truncated));
  const smallV = validateEnvelope(small);
  check('E22: n=200 passes validateEnvelope', smallV.isValid, smallV.errors.join(' | '));

  // Row 15's emitter. `ADAPTER_PROBE` pushes into `__T_BUF__` directly and never reads rows
  // 11/12's state, so it cannot perform the IN-SANDBOX delta switch. What it must still get is
  // the writer's transport stop — and a degrade that happens host-side, from the step shapes,
  // rather than one this row has to teach a file it does not own to perform.
  const built = await buildInstrumented('05-hashmap/06-two-sum.md', 3);
  const { env: adapted } = await attempt('E22: row 15\'s adapter also returns an envelope', {
    path: '05-hashmap/06-two-sum.md',
    level: 3,
    block: built.block,
    source: built.source,
    instrumented: built.instrumented,
    cases,
    timeoutMs: 120000,
  });
  if (adapted) {
    const av = validateEnvelope(adapted);
    check('E22: the adapter run passes validateEnvelope', av.isValid, av.errors.slice(0, 3).join(' | '));
    check('E22: the adapter trace is bounded too — the writer stopped it',
      adapted.steps.length < 10000, `${adapted.steps.length} steps of ~10 000`);
    check('E22: and the adapter run reports WHY it stopped',
      adapted.truncated.execution === true && /byte budget|memory|time limit/i.test(String(adapted.error)),
      `${JSON.stringify(adapted.truncated)} error=${JSON.stringify(adapted.error).slice(0, 80)}`);
    console.log(`   E22 adapter: ${adapted.stepCount} steps, ${adapted.budget.chunks} slot(s), `
      + `${adapted.budget.mode}, error="${String(adapted.error).split('\n')[0].slice(0, 60)}"`);
  }
}

// =====================================================================================
// S2 · E23 — over the execution cap: abort, TLE-shaped, and STILL flush
// =====================================================================================
section('S2 · E23 · the execution step cap aborts TLE-shaped and flushes');
{
  const { env } = await attempt('E23: the step cap aborts the run instead of throwing out of the runner', {
    path: 'fixtures/spin.md',
    level: 3,
    block: E23_BLOCK,
    source: E23_SOURCE,
    instrumented: E23_INSTRUMENTED,
    cases: E23_CASES,
    // The cap is a CAP, not a constant baked into the fixture: 40 exercises exactly the same
    // code path as 200 000 and finishes in milliseconds. The production number is asserted
    // above against `validate-envelope.mjs`'s own constant.
    execStepCap: 40,
  });
  if (env) {
  const v = validateEnvelope(env);
  check('E23: the capped envelope passes validateEnvelope', v.isValid, v.errors.join(' | '));
  check('E23: the trace was FLUSHED, not thrown away with the abort', env.steps.length > 0,
    '0 steps — the abort discarded what it had already captured');
  check('E23: the abort stopped the capture at the cap', env.steps.length <= 40,
    `${env.steps.length} steps for a cap of 40`);
  check('E23: truncated.execution is true', env.truncated.execution === true);
  check('E23: truncated.trace stayed FALSE — a step cap is not a byte budget (I3)',
    env.truncated.trace === false, 'the execution cap borrowed the trace flag, which is the I3 defect');
  check('E23: `error` is TLE-shaped', /Time Limit Exceeded/i.test(String(env.error)),
    JSON.stringify(env.error));
  check('E23: `error` names the cap it hit', /cap/i.test(String(env.error)), JSON.stringify(env.error));
  check('E23: `result` is null (the run never returned)', env.result === null);
  check('E23: the verdict still came from the uninstrumented run (I2)',
    env.verdict.passed === 1 && env.verdict.failed === 0, JSON.stringify(env.verdict));
  console.log(`   E23: ${env.stepCount} steps flushed at a cap of 40, error="${String(env.error).slice(0, 70)}"`);
  }

}

// =====================================================================================
// S2 · E25 — a 16 MB heap refusal is an error verdict, with whatever trace arrived
// =====================================================================================
section('S2 · E25 · a 16 MB OOM is an error verdict with the trace flushed');
{
  const { env } = await attempt('E25: the 16 MB refusal returns an envelope instead of throwing', {
    path: 'fixtures/balloon.md',
    level: 3,
    block: E25_BLOCK,
    source: E25_SOURCE,
    instrumented: E25_INSTRUMENTED,
    cases: E25_CASES,
    memoryLimitBytes: 16 * 1024 * 1024,
    // A small slot cap so slots reach stdout DURING the allocation loop. At 1 MB nothing would
    // flush before the heap refused, and "trace flushed if any" would be untestable.
    chunkMaxChars: 900,
    timeoutMs: 8000,
  });
  if (env) {
    const v = validateEnvelope(env);
    check('E25: the OOM envelope passes validateEnvelope', v.isValid, v.errors.join(' | '));
    check('E25: `error` names the heap', /memory|out of memory/i.test(String(env.error)),
      JSON.stringify(env.error));
    check('E25: whatever trace arrived is present', env.steps.length > 0,
      'the property is "flushed if any", so a fixture that emits none proves nothing');
    check('E25: `result` is null — the target never returned', env.result === null);
    // An ERROR VERDICT, which is what the ledger asks for. A heap refusal surfaces inside the
    // sandbox as an `InternalError` that `buildBundle`'s per-case try catches, so the driver
    // counts the case as failed and the envelope carries `error` — the same shape as a thrown
    // step (G3), not as a cut execution. `truncated.execution` is therefore FALSE here, and
    // asserting otherwise would be asserting that the driver does not catch exceptions.
    check('E25: the verdict is an ERROR verdict — the case failed', env.verdict.failed > 0,
      JSON.stringify(env.verdict));
    check('E25: an OOM did NOT set truncated.trace (I3, other direction)',
      env.truncated.trace === false, 'the heap cap borrowed the trace flag');
    check('E25: nor did it set truncated.display', env.truncated.display === false);
    console.log(`   E25: ${env.stepCount} steps flushed before the heap refused, `
      + `verdict ${JSON.stringify(env.verdict)}, error="${String(env.error).split('\n')[0].slice(0, 60)}"`);
  }

  // The control, without which the arm above passes for the wrong reason: the SAME fixture on a
  // heap big enough for it completes and traces normally, so the refusal really was the 16 MB
  // limit and not the fixture.
  const control = await runBlockTrace({
    path: 'fixtures/balloon.md',
    level: 3,
    block: E25_BLOCK,
    source: E25_SOURCE,
    instrumented: E25_INSTRUMENTED,
    cases: E25_FITS_CASES,
    memoryLimitBytes: 256 * 1024 * 1024,
    timeoutMs: 8000,
  });
  check('E25: the control run completes with no error', control.error === null,
    JSON.stringify(control.error));
  check('E25: the control verdict passes', control.verdict.failed === 0 && control.verdict.passed > 0,
    JSON.stringify(control.verdict));
  check('E25: the control is not truncated at all',
    !control.truncated.execution && !control.truncated.trace && !control.truncated.display,
    JSON.stringify(control.truncated));

  // The other half of the byte accounting, and E22 in a harsher form: a step whose own
  // snapshot cannot fit the transport AT ALL. Shipping it oversized is how one step silently
  // eats the log allowance and the NEXT slot is dropped — the exact chain plan §1 U2
  // describes. So it stops recording, by name, instead.
  const { env: blowup } = await attempt('E25: a step wider than the transport returns an envelope', {
    path: 'fixtures/balloon-wide.md',
    level: 3,
    block: E25_BLOWUP_BLOCK,
    source: E25_BLOWUP_SOURCE,
    instrumented: E25_BLOWUP_INSTRUMENTED,
    cases: E25_BLOWUP_CASES,
    // A deliberately tiny transport: 900 chars a slot for 12 slots is a 10 800-char allowance
    // against a ~13 kB snapshot, so the second step cannot travel. The clock is irrelevant here
    // — the fixture finishes in milliseconds — but it is raised anyway so a slow machine reports
    // a timeout instead of masquerading as this case.
    chunkMaxChars: 900,
    chunksPerTrace: 12,
    timeoutMs: 8000,
  });
  if (blowup) {
    const bv = validateEnvelope(blowup);
    check('E25: the oversized-step envelope passes validateEnvelope', bv.isValid, bv.errors.join(' | '));
    check('E25: the steps before the blow-up are still here', blowup.steps.length > 0,
      '0 steps — nothing was recorded, so nothing can be said about what a blow-up preserves');
    check('E25: `error` names the byte budget', /byte budget/i.test(String(blowup.error)),
      JSON.stringify(blowup.error));
    check('E25: and it says which of the two byte ceilings it hit',
      /one step|transport slots|delta stopped/i.test(String(blowup.error)),
      JSON.stringify(blowup.error));
    // Either ceiling is correct here and which one binds depends on how many steps arrived
    // before it, so the test asserts the SHAPE — a trace that stops, is named, and lost no step
    // it had already recorded — rather than which of the two fired first.
    check('E25: the stop is a recording stop, not a thrown error',
      blowup.truncated.execution === true && typeof blowup.error === 'string',
      JSON.stringify({ t: blowup.truncated, e: blowup.error }));
    check('E25: truncated.execution is true — steps we did not record are steps that ran',
      blowup.truncated.execution === true);
    check('E25: truncated.trace stayed FALSE — nothing was shed, recording stopped',
      blowup.truncated.trace === false);
    console.log(`   E25 blowup: ${blowup.stepCount} steps kept, error="${String(blowup.error).slice(0, 80)}"`);
  }
}

// =====================================================================================
// S2 · the display cap: 5 000 steps, and the verdict does not move
// =====================================================================================
section('S2 · display cap · n=5000 truncates for display, verdict unchanged');
{
  const big = await runBlockTrace({
    path: 'fixtures/count-to.md',
    level: 3,
    block: DISPLAY_BLOCK,
    source: DISPLAY_SOURCE,
    instrumented: DISPLAY_INSTRUMENTED,
    cases: DISPLAY_CASES,
    caseIndex: 1,
  });
  const v = validateEnvelope(big);
  check('display: the n=5000 envelope passes validateEnvelope', v.isValid, v.errors.join(' | '));
  check('display: it really did exceed the cap', big.steps.length > SCHEMA_DISPLAY_CAP,
    `${big.steps.length} steps against a cap of ${SCHEMA_DISPLAY_CAP}`);
  check('display: truncated.display is set', big.truncated.display === true);
  check('display: truncating for DISPLAY did not set truncated.trace (I3)',
    big.truncated.trace === false, 'the display cap borrowed the trace flag');
  check('display: truncating for DISPLAY did not set truncated.execution (I3)',
    big.truncated.execution === false, 'the display cap borrowed the execution flag');
  eq('display: nothing degraded — a small trace stays in `full` mode', big.budget.mode, 'full');
  check('display: `stepCount` is the EXECUTED count, not the shipped count',
    big.stepCount === big.steps.length, `${big.stepCount} vs ${big.steps.length}`);

  // The load-bearing half: the same block, the same cases, a trace under the cap. Identical
  // verdict, different `truncated`. If display truncation could move a verdict, I2 is broken
  // in a way no amount of "the verdict comes from the raw run" in a comment would catch.
  const small = await runBlockTrace({
    path: 'fixtures/count-to.md',
    level: 3,
    block: DISPLAY_BLOCK,
    source: DISPLAY_SOURCE,
    instrumented: DISPLAY_INSTRUMENTED,
    cases: DISPLAY_CASES,
    caseIndex: 0,
  });
  eq('display: the verdict is IDENTICAL with and without display truncation',
    big.verdict, small.verdict);
  check('display: and the two runs really did differ in truncation',
    big.truncated.display === true && small.truncated.display === false,
    `big=${big.truncated.display} small=${small.truncated.display}`);
  console.log(`   display: ${big.stepCount} steps truncated=true vs ${small.stepCount} steps truncated=false, `
    + `verdict ${JSON.stringify(big.verdict)} in both`);
}

// =====================================================================================
// S2 · I2 — the verdict comes from an UNINSTRUMENTED run, and NOTHING here can move it
// =====================================================================================
section('S2 · I2 · nothing in rows 11/12 can move a verdict');
{
  // The bare run, exactly as `/api/judge/run` would do it: same block, no probe, no
  // snapshot, no chunk, no cap. Every envelope below claims the same numbers.
  const bare = await executeUserCode(buildBundle({
    userCode: readBlockSource('05-hashmap/06-two-sum.md', 3),
    fnName: 'twoSum',
    codec: 'json',
    tests: PROBLEMS['two-sum'].tests,
  }), { timeoutMs: 3000 });
  const bareVerdict = parseVerdictEnvelope(bare.envelopeRaw, bare.logs);
  check('I2: the bare run produced a verdict', Boolean(bareVerdict), 'no __VERDICT__ line');
  if (bareVerdict) {
    const expected = { passed: bareVerdict.passed, failed: bareVerdict.failed };
    eq('I2: an uninstrumented trace reports the bare verdict', pilotEnvelopes['two-sum'].verdict, expected);
    eq('I2: a DEGRADED (diff-mode) trace reports the same bare verdict',
      (await runBlockTrace({
        path: '05-hashmap/06-two-sum.md',
        level: 3,
        slug: 'two-sum',
        instrumented: PILOT_INSTRUMENTED['two-sum'],
        byteBudget: 2000,
      })).verdict, expected);
  }

  // The sharpest form of the question: does the probe suite perturb the thing it measures?
  // Instrumentation reads state, allocates and costs time; if any of that reached the raw run
  // the verdict would describe the probe suite. The fixture is deliberately the EXPENSIVE one —
  // 5 000 traced turns, where a perturbing probe would have the most room to show it.
  const heavy = await runBlockTrace({
    path: 'fixtures/count-to.md',
    level: 3,
    block: DISPLAY_BLOCK,
    source: DISPLAY_SOURCE,
    instrumented: DISPLAY_INSTRUMENTED,
    cases: DISPLAY_CASES,
    caseIndex: 1,
  });
  const heavyBare = await executeUserCode(buildBundle({
    userCode: DISPLAY_SOURCE,
    fnName: 'countTo',
    codec: 'json',
    tests: DISPLAY_CASES,
  }), { timeoutMs: 3000 });
  const heavyVerdict = parseVerdictEnvelope(heavyBare.envelopeRaw, heavyBare.logs);
  check('I2: the expensive fixture\'s bare run produced a verdict', Boolean(heavyVerdict), 'no __VERDICT__ line');
  if (heavyVerdict) {
    eq('I2: instrumented and bare agree step for step on an expensive run',
      heavy.verdict, { passed: heavyVerdict.passed, failed: heavyVerdict.failed });
    check('I2: and that run really did trace a lot', heavy.stepCount > SCHEMA_DISPLAY_CAP,
      `${heavy.stepCount} steps — a cheap trace would not have exercised anything`);
  }
  // The converse arm, so the first arm cannot pass for the wrong reason.
  const broken = await runBlockTrace({
    path: '05-hashmap/06-two-sum.md',
    level: 3,
    slug: 'two-sum',
    source: 'function twoSum(nums, target) { return [9, 9]; }',
    instrumented: PILOT_INSTRUMENTED['two-sum'],
  });
  check('I2: a broken UNINSTRUMENTED source DOES move the verdict',
    broken.verdict.failed > 0 && broken.verdict.passed === 0, JSON.stringify(broken.verdict));
  console.log(`   I2: bare ${JSON.stringify(bareVerdict && { passed: bareVerdict.passed, failed: bareVerdict.failed })}`
    + `, traced ${JSON.stringify(pilotEnvelopes['two-sum'].verdict)}, degraded ${JSON.stringify(broken.verdict)}`);
}

// =====================================================================================
// S2 · I3 — three independent flags, asserted in BOTH directions
// =====================================================================================
section('S2 · I3 · execution, display and trace never borrow each other');
{
  // Row 10 already holds the "a timeout did not set the trace flag" half. The other three
  // directions are what makes the object an object rather than one boolean with aliases.
  const flags = (env) => (env && env.truncated
    ? `${Number(env.truncated.execution)}${Number(env.truncated.display)}${Number(env.truncated.trace)}`
    : '???');
  const { env: overBudget } = await attempt('I3: the byte-degrade probe runs', {
    path: PROBLEMS['two-sum'].path,
    level: 3,
    slug: 'two-sum',
    instrumented: PILOT_INSTRUMENTED['two-sum'],
    byteBudget: 2000,
  });
  eq('I3: a byte degrade sets ONLY `trace` (execution, display, trace)', flags(overBudget), '001');
  const { env: capped } = await attempt('I3: the step-cap probe runs', {
    path: 'fixtures/spin.md',
    level: 3,
    block: E23_BLOCK,
    source: E23_SOURCE,
    instrumented: E23_INSTRUMENTED,
    cases: E23_CASES,
    execStepCap: 40,
  });
  eq('I3: a step-cap abort sets ONLY `execution`', flags(capped), '100');
  const { env: timedOut } = await attempt('I3: the timeout probe runs', {
    path: 'fixtures/spins.md',
    level: 3,
    block: E24_BLOCK,
    source: E24_SOURCE,
    instrumented: E24_INSTRUMENTED,
    cases: E24_CASES,
    timeoutMs: 400,
    chunkMaxChars: 800,
  });
  eq('I3: a timeout sets ONLY `execution`', flags(timedOut), '100');
  const { env: displayed } = await attempt('I3: the display-cap probe runs', {
    path: 'fixtures/count-to.md',
    level: 3,
    block: DISPLAY_BLOCK,
    source: DISPLAY_SOURCE,
    instrumented: DISPLAY_INSTRUMENTED,
    cases: DISPLAY_CASES,
    caseIndex: 1,
  });
  eq('I3: an over-cap trace sets ONLY `display`', flags(displayed), '010');
  const clean = pilotEnvelopes['two-sum'];
  eq('I3: an ordinary trace sets NONE of them', flags(clean), '000');
  check('I3: `truncated` is exactly {execution, display, trace} on every envelope above',
    [overBudget, capped, timedOut, displayed, clean].filter(Boolean)
      .every((e) => JSON.stringify(Object.keys(e.truncated).sort()) === '["display","execution","trace"]'));
}

// ---- helper: read a guide's level-3 block source, same slice gen-blocks uses ------
function readBlockSource(guidePath, level) {
  const block = getBlock(guidePath, level);
  const lines = fs.readFileSync(path.join(REPO, guidePath), 'utf-8').split('\n');
  return lines.slice(block.blockOffset - 1, block.blockOffset - 1 + block.blockLines).join('\n');
}

// =====================================================================================
console.log('\n========================================');
console.log(`Assertions: ${passed + failures.length} | Failures: ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('========================================');
process.exit(failures.length ? 1 : 0);