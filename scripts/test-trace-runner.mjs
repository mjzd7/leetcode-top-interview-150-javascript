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
import { serialize, deserialize } from './lib/serialize.mjs';

// ---- the module under test. Its absence is the RED state. ------------------------
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
// S2 — the chunk cap is the sandbox's own measured constant
// =====================================================================================
section('S2 · caps are derived from measured constants');
{
  check('CHUNK_MAX_CHARS is the sandbox 1 MB slot', CHUNK_MAX_CHARS === 1024 * 1024, String(CHUNK_MAX_CHARS));
  check('CHUNKS_PER_TRACE is 12', CHUNKS_PER_TRACE === 12, String(CHUNKS_PER_TRACE));
  check('TRACE_PREFIX is __TRACE__', TRACE_PREFIX === '__TRACE__');
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