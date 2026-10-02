/**
 * Row 23 self-tests: the Tier-1 presets' pure logic (plan v5 §7 row 23, §3 G4, §9 decision 2).
 *
 * `docs/dryrun/render.js` is a browser module, but everything a preset DECIDES is a pure
 * function of the rows `docs/dryrun/table.js` already parsed: which column holds the stack,
 * what the window's bounds are at step n, which bit is under test. Those are the parts that
 * can be silently wrong — a window that renders as a plain array, a stack that grows
 * downwards, a bit that never highlights — so they are what is tested here. The DOM wiring
 * is covered by `tests/dry-run.spec.mjs` in a real browser.
 *
 * The four presets share one contract with row 22's `array` primitive:
 *
 *   - a plan is `null`, or it has `steps === table.rows.length` — one frame per authored row,
 *     never more, because the player reuses row 22's transport, whose scrubber is built for
 *     exactly that many steps;
 *   - an unreadable cell carries the previous frame forward and is tagged `source: 'carried'`,
 *     rather than inventing a state;
 *   - step 0 highlights nothing, because there is no previous step to have changed from.
 *
 * Cells arrive VERBATIM from the parser (backticks, `$…$`, `\|`), so every reader here peels
 * one authored layer off a cell and refuses anything that is not literally that shape.
 *
 * Run: node scripts/test-dryrun-render.mjs     (exits 1 if any case fails)
 */
import fs from 'node:fs';
import { parseGuide } from '../docs/dryrun/table.js';
import { buildFrames, COL_MIN_PARSE_RATIO, clampStep, stepFrame } from '../docs/dryrun/index.js';
import {
  PRESETS,
  readStack,
  readGrid,
  readRange,
  readSequence,
  readBits,
  lowestBit,
  planStack,
  planMatrix,
  planWindow,
  planBits,
  pickPreset,
  stackOp,
  windowBounds,
} from '../docs/dryrun/render.js';

let failures = 0;
let checks = 0;

/** One named case. `fn` throws on failure; the message is what the reader sees. */
function t(name, fn) {
  checks++;
  try {
    fn();
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${err && err.message ? err.message : err}`);
    return;
  }
  console.log(`  ✓ ${name}`);
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function ok(value, what) {
  if (!value) throw new Error(`${what}: expected truthy, got ${JSON.stringify(value)}`);
}

/** A real guide, for the cases that must hold against the corpus and not just a fixture. */
const guide = (p) => parseGuide(fs.readFileSync(p, 'utf8'));

/* ------------------------------------------------------------------ *
 * readStack — a LIFO column, not a list
 * ------------------------------------------------------------------ */

console.log('\nreadStack — one stack, one cell\n');

t('reads an empty stack as zero entries, not as a refusal', () => {
  eq(readStack('`[]`'), [], 'parsed');
});

t('reads number entries verbatim', () => {
  eq(readStack('`[41, 0]`'), ['41', '0'], 'parsed');
});

t('reads a quoted character — the shape valid-parentheses pushes', () => {
  eq(readStack("`[')']`"), ["')'"], 'parsed');
});

t('reads quoted multi-character path segments', () => {
  eq(readStack('`["a", "b"]`'), ['"a"', '"b"'], 'parsed');
});

t('reads a bare identifier entry', () => {
  eq(readStack('[top, sentinel]'), ['top', 'sentinel'], 'parsed');
});

t('refuses a nested array — that is a matrix, and the matrix preset owns it', () => {
  eq(readStack('`[[1], [2]]`'), null, 'nested');
});

t('refuses a map literal', () => {
  eq(readStack('`{ 2 => 1 }`'), null, 'hash rocket');
});

t('refuses a scalar', () => {
  eq(readStack('`2`'), null, 'no bracket');
});

t('refuses a stack cell that carries an expression, not a state', () => {
  eq(readStack('`["a", "b"]` + "/" + stack'), null, 'trailing prose');
});

/* ------------------------------------------------------------------ *
 * readGrid — a 2-D shape
 * ------------------------------------------------------------------ */

console.log('\nreadGrid — one rectangle, one cell\n');

t('reads a 3x3 nested grid', () => {
  eq(readGrid('`[[1, 4, 3], [2, 5, 6], [7, 8, 9]]`'),
    [['1', '4', '3'], ['2', '5', '6'], ['7', '8', '9']], 'parsed');
});

t('reads a flat array as a one-row grid — the array preset is the only other reader', () => {
  eq(readGrid('`[7, 4, 1]`'), [['7', '4', '1']], 'parsed');
});

t('reads a row-joined grid (a 2x3 written as `[a, b, c], [d, e, f]`)', () => {
  eq(readGrid('`[7, 2, 1], [4, 5, 6], [9, 8, 3]`'),
    [['7', '2', '1'], ['4', '5', '6'], ['9', '8', '3']], 'parsed');
});

t('refuses a ragged grid — rows of different widths are a list of lists', () => {
  eq(readGrid('`[[1, 2], [3]]`'), null, 'ragged');
});

t('refuses a grid cell with trailing prose (`… (Correct!)`)', () => {
  eq(readGrid('`[[1, 0, 1], [0, 0, 0], [1, 0, 1]]` (Correct!)'), null, 'trailing prose');
});

t('refuses an empty array — no width means no grid', () => {
  eq(readGrid('`[]`'), null, 'no width');
});

t('refuses a scalar', () => {
  eq(readGrid('5'), null, 'no bracket');
});

/* ------------------------------------------------------------------ *
 * readRange + readSequence — a window is a bound plus what fills it
 * ------------------------------------------------------------------ */

console.log('\nreadRange / readSequence — the two halves of a window\n');

t('reads `$a \\to b$`', () => {
  eq(readRange('$0 \\to 3$'), [0, 3], 'parsed');
});

t('reads `s[0 ... 5]` — an address inside a longer expression', () => {
  eq(readRange('`s[0 ... 5]`'), [0, 5], 'parsed');
});

t('reads a bare `[1 ... 4]`', () => {
  eq(readRange('`[1 ... 4]`'), [1, 4], 'parsed');
});

t('reads `0..2`', () => {
  eq(readRange('$0..2$'), [0, 2], 'parsed');
});

t('refuses a descending range — a window never ends before it starts', () => {
  eq(readRange('$5 \\to 0$'), null, 'descending');
});

t('refuses arithmetic that is not a range (`$4 - 0 + 1 = 4$`)', () => {
  eq(readRange('$4 - 0 + 1 = 4$'), null, 'arithmetic');
});

t('refuses prose ("Row 0")', () => {
  eq(readRange('Row 0'), null, 'prose');
});

t('reads a sequence from an array literal', () => {
  eq(readSequence('`[2, 3, 1, 2]`'), ['2', '3', '1', '2'], 'parsed');
});

t('reads a sequence from a quoted string, one character per cell', () => {
  eq(readSequence('`"ADOBEC"`'), ['A', 'D', 'O', 'B', 'E', 'C'], 'parsed');
});

t('refuses a frequency list — that fills no contiguous range', () => {
  eq(readSequence('`A:1, B:1, C:1`'), null, 'not a sequence');
});

/* ------------------------------------------------------------------ *
 * readBits — only a PROVEN bit field, so `100` a decimal cannot pose as one
 * ------------------------------------------------------------------ */

console.log('\nreadBits — a number as its digits, or nothing\n');

t('reads a parenthesised field that proves itself binary', () => {
  eq(readBits('`n = 6 (110)`'), { value: '110', result: null }, '6 -> 110');
});

t('reads a padded field a decimal reading cannot explain (`11` vs `1011`)', () => {
  eq(readBits('`n = 11` (`1011`)'), { value: '1011', result: null }, 'proven');
});

t('refuses `n = 1011 (1011)` — 1011 decimal is not 1011 binary, so neither is claimed', () => {
  eq(readBits('`n = 1011 (1011)`'), { value: null, result: null }, 'ambiguous');
});

t('reads the left operand and the stated result of an equation', () => {
  eq(readBits('`101 & 110 = 100`'), { value: '101', result: '100' }, 'parsed');
});

t('keeps only the result when there is no left operand (`& 1001 = 1000`)', () => {
  eq(readBits('`& 1001 = 1000`'), { value: null, result: '1000' }, 'result only');
});

t('reads a 32-bit field written as a quoted string', () => {
  eq(readBits('`"00000010100101000001111010011100"`'),
    { value: '00000010100101000001111010011100', result: null }, 'field');
});

t('refuses a plain decimal that happens to be all zeroes and ones, until a neighbour proves the column', () => {
  eq(readBits('`101`'), null, 'strict');
  eq(readBits('`101`', { lax: true }), { value: '101', result: null }, 'lax');
});

t('refuses a scalar with no field at all', () => {
  eq(readBits('`count = 3`'), { value: null, result: null }, 'decimal result');
});

t('refuses prose', () => {
  eq(readBits('exhausted'), null, 'prose');
});

/* ------------------------------------------------------------------ *
 * lowestBit — where the step under test actually landed
 * ------------------------------------------------------------------ */

console.log('\nlowestBit — index counted from the right, -1 when nothing differs\n');

t('finds the cleared low bit of 1011 vs 1010', () => {
  eq(lowestBit('1011', '1010'), 0, 'bit');
});

t('finds the cleared bit of 1010 vs 1000', () => {
  eq(lowestBit('1010', '1000'), 1, 'bit');
});

t('finds the last bit cleared, 1000 vs 0000', () => {
  eq(lowestBit('1000', '0000'), 3, 'bit');
});

t('is -1 when the two are equal — the step changed nothing', () => {
  eq(lowestBit('100', '100'), -1, 'no difference');
});

t('pads the shorter side rather than refusing', () => {
  eq(lowestBit('1000', '0'), 3, 'padded');
});

/* ------------------------------------------------------------------ *
 * stackOp — what the stack did, derived by comparing two frames
 * ------------------------------------------------------------------ */

console.log('\nstackOp — push, pop, or neither\n');

t('a longer stack is a push of exactly the new entries', () => {
  eq(stackOp([], ['a']), { op: 'push', moved: [0] }, 'push');
  eq(stackOp(['a'], ['a', 'b']), { op: 'push', moved: [1] }, 'push 1');
});

t('a shorter stack is a pop of exactly the entries that left', () => {
  eq(stackOp(['a', 'b'], ['a']), { op: 'pop', moved: [1] }, 'pop');
  eq(stackOp(['a'], []), { op: 'pop', moved: [0] }, 'pop to empty');
});

t('an identical stack is not a move', () => {
  eq(stackOp(['a'], ['a']), { op: 'same', moved: [] }, 'same');
});

t('the first frame has nothing to compare against', () => {
  eq(stackOp(null, ['a']), { op: 'start', moved: [] }, 'start');
});

t('entries sharing a prefix but differing in place is not a push — the stack changed, so it says so', () => {
  eq(stackOp(['a'], ['b']), { op: 'swap', moved: [0] }, 'swap');
});

/* ------------------------------------------------------------------ *
 * windowBounds — the sliding arithmetic, isolated
 * ------------------------------------------------------------------ */

console.log('\nwindowBounds — size, entered, departed\n');

t('a window growing on the right admits exactly one index', () => {
  eq(windowBounds([0, 3], null), { size: 4, entered: [0, 1, 2, 3], departed: [] }, 'open');
});

t('sliding right by one admits one and retires one', () => {
  eq(windowBounds([1, 4], [0, 3]), { size: 4, entered: [4], departed: [0] }, 'slide');
});

t('the left edge jumping two retires two', () => {
  eq(windowBounds([4, 5], [2, 4]), { size: 2, entered: [5], departed: [2, 3] }, 'jump');
});

t('an empty window is zero-length, never negative', () => {
  eq(windowBounds(null, [0, 3]), { size: 0, entered: [], departed: [0, 1, 2, 3] }, 'closed');
});

/* ------------------------------------------------------------------ *
 * planStack — against the real guide
 * ------------------------------------------------------------------ */

console.log('\nplanStack — 07-stack/02-simplify-path.md (catalog: patterns ["Stack"])\n');

const simplify = guide('07-stack/02-simplify-path.md');

t('claims the L2 table on its post-step column, not the pre-step one', () => {
  const plan = planStack(simplify[1]);
  ok(plan, 'a plan');
  eq(plan.column, 3, 'Stack After');
  eq(plan.label, 'Stack After', 'label');
  eq(plan.level, 2, 'level');
});

t('one frame per authored row, and every frame has a stack', () => {
  const plan = planStack(simplify[1]);
  eq(plan.steps, simplify[1].rows.length, 'steps');
  for (const frame of plan.frames) ok(frame.items, 'a stack at every step');
});

t('reads the pushes and the pops the guide recorded', () => {
  const frames = planStack(simplify[1]).frames;
  eq(frames.map((f) => f.op),
    ['start', 'push', 'same', 'push', 'pop', 'pop', 'push', 'same', 'same'], 'ops');
  eq(frames[3].items, ['"a"', '"b"'], 'stack after pushing b');
  eq(frames[5].items, [], 'stack emptied by the second pop');
});

t('the last row is prose (`**"/c"**`), so it carries the last stack and says so', () => {
  const frames = planStack(simplify[1]).frames;
  eq(frames[8].items, ['"c"'], 'carried');
  eq(frames[8].source, 'carried', 'tagged');
});

t('L3 claims `Stack After` too, and refuses nothing about the levels', () => {
  const plan = planStack(simplify[2]);
  ok(plan, 'a plan');
  eq(plan.steps, simplify[2].rows.length, 'steps');
});

t('an array table is not a stack table', () => {
  eq(planStack(guide('01-array-string/01-merge-sorted-array.md')[1]), null, 'nums1 is not a stack');
});

t('a scalar-only table is not a stack table', () => {
  eq(planStack(guide('05-hashmap/06-two-sum.md')[1]), null, 'no stack column');
});

/* ------------------------------------------------------------------ *
 * planMatrix — against the real guide
 * ------------------------------------------------------------------ */

console.log('\nplanMatrix — 04-matrix/02-spiral-matrix.md (catalog: patterns ["Matrix", "Boundary Shrinking"])\n');

const spiral = guide('04-matrix/02-spiral-matrix.md');

t('claims the L2 table on its grid column', () => {
  const plan = planMatrix(spiral[1]);
  ok(plan, 'a plan');
  eq(plan.column, 3, 'Mutated Grid');
  eq(plan.label, 'Mutated Grid', 'label');
});

t('every frame is the same rectangle, and step 0 is not marked as changed', () => {
  const frames = planMatrix(spiral[1]).frames;
  eq(planMatrix(spiral[1]).steps, spiral[1].rows.length, 'steps');
  for (const frame of frames) eq(frame.rows.length, 2, 'height');
  eq(frames[0].changed, [], 'step 0 highlights nothing');
});

t('marks exactly the cells the guide mutated', () => {
  const frames = planMatrix(spiral[1]).frames;
  eq(frames[1].changed, [[0, 1]], 'second step wrote (0,1)');
  eq(frames[2].changed, [[1, 1]], 'third step wrote (1,1)');
  eq(frames[3].changed, [[1, 0]], 'fourth step wrote (1,0)');
});

t('carries the `(r, c)` the step is addressing, which is what makes the arithmetic legible', () => {
  const frames = planMatrix(spiral[1]).frames;
  eq(frames.map((f) => f.at), [[0, 0], [0, 1], [1, 1], [1, 0]], 'addressed cells');
});

t('handles a grid whose SHAPE changes between frames', () => {
  // 04-matrix/03-rotate-image.md L3: 3x3 -> 3x3 -> 3x3 -> 1x3 -> 1x3 -> 1x3.
  const frames = planMatrix(guide('04-matrix/03-rotate-image.md')[2]).frames;
  eq(frames.map((f) => [f.rows.length, f.rows[0].length]),
    [[3, 3], [3, 3], [3, 3], [1, 3], [1, 3], [1, 3]], 'shapes');
});

t('a list of intervals is not a matrix — no grid column names one', () => {
  eq(planMatrix(guide('06-intervals/02-merge-intervals.md')[0]), null, 'Active List is a list');
});

/* ------------------------------------------------------------------ *
 * planWindow — the reconstruction is the whole point
 * ------------------------------------------------------------------ */

console.log('\nplanWindow — 03-sliding-window/01-minimum-size-subarray-sum.md (catalog: patterns ["Sliding Window"])\n');

const minSum = guide('03-sliding-window/01-minimum-size-subarray-sum.md');

t('claims L1 on the range column plus the column that fills it', () => {
  const plan = planWindow(minSum[0]);
  ok(plan, 'a plan');
  eq([plan.rangeColumn, plan.sequenceColumn], [1, 2], '`j` Range + Subarray');
});

t('reconstructs the guide\'s own input array out of the windows', () => {
  // The guide states `nums = [2, 3, 1, 2, 4, 3]` above its table. Four windows of widths
  // 4, 4, 3 and 2 at offsets 0, 1, 2 and 4 must reassemble exactly that — which is the
  // only proof that the window is a window over something and not a list of fragments.
  const plan = planWindow(minSum[0]);
  eq(plan.base, ['2', '3', '1', '2', '4', '3'], 'reconstructed nums');
  eq(plan.conflicts.length, 0, 'no index claimed twice with different values');
});

t('reports each step\'s bounds, size and what entered and left', () => {
  const frames = planWindow(minSum[0]).frames;
  eq(frames.map((f) => [f.lo, f.hi, f.size]), [[0, 3, 4], [1, 4, 4], [2, 4, 3], [4, 5, 2]], 'bounds');
  eq(frames.map((f) => f.entered), [[0, 1, 2, 3], [4], [], [5]], 'entered');
  eq(frames.map((f) => f.departed), [[], [0], [1], [2, 3]], 'departed');
});

t('a window stated as a string works the same way, and rebuilds the guide\'s `s`', () => {
  // 03-sliding-window/04-minimum-window-substring.md L2 gives three windows as `s` ranges plus
  // their contents: s[0 ... 5] = "ADOBEC", s[3 ... 10] = "BECODEBA", s[9 ... 12] = "BANC".
  // Those overlap, so they must agree on every shared index — and they do, which is the
  // check that the reconstruction is reading offsets rather than concatenating fragments.
  const plan = planWindow(guide('03-sliding-window/04-minimum-window-substring.md')[1]);
  ok(plan, 'a plan');
  eq(plan.frames[0].size, 6, 'ADOBEC');
  eq(plan.frames[2].items, ['B', 'A', 'N', 'C'], 'BANC');
  eq(plan.base.join(''), 'ADOBECODEBANC', 'reconstructed s');
  eq(plan.conflicts.length, 0, 'the overlapping windows agree');
});

t('an index two rows state two ways is listed, not silently resolved', () => {
  // A synthetic table, because no guide in the corpus contradicts itself — the three window
  // guides all reconstruct cleanly. Index 1 is 'x' in one window and 'y' in the other.
  const plan = planWindow({
    columns: ['Range', 'Window'],
    rows: [['$0 \\to 2$', '`[a, b, c]`'], ['$1 \\to 3$', '`[x, c, e]`'], ['$1 \\to 3$', '`[y, c, e]`']],
  });
  ok(plan, 'a plan');
  eq(plan.conflicts, [1], 'the disagreement is named');
  eq(plan.base, ['a', 'b', 'c', 'e'], 'first writer kept, disagreement reported');
});

t('a range column nothing fills is not a window', () => {
  // 04-matrix/01-valid-sudoku.md L1 "Cells Checked": a range with no contents beside it.
  eq(planWindow(guide('04-matrix/01-valid-sudoku.md')[0]), null, 'nothing fills it');
});

/* ------------------------------------------------------------------ *
 * planBits — against the real guide
 * ------------------------------------------------------------------ */

console.log('\nplanBits — 22-bit-manipulation/03-number-of-1-bits.md (catalog: patterns ["Bit Manipulation"])\n');

const ones = guide('22-bit-manipulation/03-number-of-1-bits.md');

t('claims L3 on the value column the table proves is binary', () => {
  const plan = planBits(ones[2]);
  ok(plan, 'a plan');
  eq(plan.label, 'Pointer $L$', 'label');
  eq(plan.steps, ones[2].rows.length, 'steps');
});

t('reads the running value as its digits', () => {
  eq(planBits(ones[2]).frames.map((f) => f.value), ['1011', '1010', '1000'], 'values');
});

t('pads every frame to one width, so the digits never move under the reader', () => {
  eq(planBits(ones[2]).width, 4, 'width');
});

t('highlights the bit the step cleared, read off the row\'s own operator', () => {
  eq(planBits(ones[2]).frames.map((f) => f.tested), [0, 1, 3], 'tested bits');
});

t('counts the set bits, because that is the answer this guide is walking to', () => {
  eq(planBits(ones[2]).frames.map((f) => f.ones), [3, 2, 1], 'popcount');
});

t('a step whose two values are equal highlights nothing', () => {
  // 22-bit-manipulation/06-bitwise-and-range.md L1: `100 & 111 = 100` changed nothing.
  const frames = planBits(guide('22-bit-manipulation/06-bitwise-and-range.md')[0]).frames;
  eq(frames[2].tested, -1, 'no change, no highlight');
});

t('an array table is not a bit table', () => {
  eq(planBits(guide('01-array-string/01-merge-sorted-array.md')[1]), null, 'nums1 is not a word');
});

/* ------------------------------------------------------------------ *
 * pickPreset — one table, one preset, and `array` still wins the rest
 * ------------------------------------------------------------------ */

console.log('\npickPreset — precedence, and row 22 is left in charge of everything else\n');

t('the four presets, in the order they outrank each other', () => {
  eq(PRESETS, ['window', 'matrix', 'stack', 'bits', 'array'], 'order');
});

t('a sliding-window table goes to the window preset', () => {
  eq(pickPreset(minSum[0]).preset, 'window', 'window');
});

t('a grid table goes to the matrix preset', () => {
  eq(pickPreset(spiral[1]).preset, 'matrix', 'matrix');
});

t('a stack table goes to the stack preset, even where an array column also parses', () => {
  // simplify-path L3: `[..., "a"]` is a plain array literal, so the array preset would
  // also claim it. A stack that renders as a row of cells has thrown away the LIFO.
  eq(pickPreset(simplify[2]).preset, 'stack', 'stack beats array');
});

t('a bit table goes to the bits preset', () => {
  eq(pickPreset(ones[2]).preset, 'bits', 'bits');
});

t('an ordinary array table is left to row 22 — the caller gets null and does nothing', () => {
  eq(pickPreset(guide('01-array-string/01-merge-sorted-array.md')[1]), null, 'not ours');
});

t('a scalar-only table is left alone too', () => {
  eq(pickPreset(guide('05-hashmap/06-two-sum.md')[1]), null, 'nothing to claim');
});

t('a two-row table is rendered, not refused — the thin-table floor is row 29\'s repair threshold, and row 22 does not apply it either', () => {
  // 23 guides carry 27 tables under THIN_ROW_LIMIT. Row 22 plays those when they hold an
  // array column, so a preset that refused them would disagree with the primitive it sits
  // beside for no gain.
  const thin = { columns: ['`stack` State'], rows: [['`[1]`'], ['`[]`']] };
  const picked = pickPreset(thin);
  eq(picked.preset, 'stack', 'rendered');
  eq(picked.plan.steps, 2, 'steps');
  eq(buildFrames(thin).playable, false, 'and row 22 would have skipped it — so this is the own-chrome path');
});

t('an empty table yields null, not a crash', () => {
  eq(pickPreset({ columns: [], rows: [] }), null, 'empty');
  eq(pickPreset(null), null, 'null');
});

t('every preset it does claim is playable by the array primitive, or claims its own transport', () => {
  // The transport row 22 built is sized `steps` long. A preset that returned a different
  // step count would leave the scrubber pointing past the end of the run.
  for (const table of [minSum[0], spiral[1], simplify[1], simplify[2], ones[2]]) {
    const picked = pickPreset(table);
    const plan = { window: planWindow, matrix: planMatrix, stack: planStack, bits: planBits }[picked.preset](table);
    eq(plan.steps, table.rows.length, `${picked.preset} step count`);
  }
});

t('clamping is row 22\'s, shared — so the presets cannot drift from the transport', () => {
  eq(clampStep(-4, 4), 0, 'floor');
  eq(clampStep(99, 4), 3, 'ceiling');
  eq(clampStep(1, 0), 0, 'no steps');
  eq(stepFrame({ frames: [1, 2, 3] }, 2, 1), 2, 'stops at the end');
});

t('the parse-ratio floor is row 22\'s constant, not a second number', () => {
  ok(COL_MIN_PARSE_RATIO >= 0.5, 'shared floor');
});

t('every preset plan carries the reason-free contract the mount needs', () => {
  const plan = pickPreset(minSum[0]);
  eq(plan.plan.preset, 'window', 'plan names its preset');
  eq(plan.plan.base.length, 6, 'plan carries its reconstruction');
});

/* ------------------------------------------------------------------ *
 * Coverage — the numbers this row claims, measured rather than asserted
 * ------------------------------------------------------------------ */

console.log('\ncorpus coverage — every dry-run table in the 150 guides\n');

t('reports how many tables each preset claims across the whole corpus', () => {
  const catalog = JSON.parse(fs.readFileSync('catalog/problems.json', 'utf8'));
  let tables = 0;
  const byPreset = {};
  for (const problem of catalog.problems) {
    for (const table of guide(problem.path)) {
      tables++;
      const picked = pickPreset(table);
      if (!picked) continue;
      byPreset[picked.preset] = (byPreset[picked.preset] || 0) + 1;
    }
  }
  eq(tables, 450, 'tables parsed');
  for (const name of ['window', 'matrix', 'stack', 'bits']) ok(byPreset[name] > 0, `${name} claims at least one`);
  console.log(`      ${JSON.stringify(byPreset)} of ${tables} tables`);
});

/* ------------------------------------------------------------------ *
 * Row 22 must not have been touched
 * ------------------------------------------------------------------ */

console.log('\nrow 22 still owns the array primitive\n');

t('buildFrames is unchanged: the array preset still finds its column', () => {
  const merge = guide('01-array-string/01-merge-sorted-array.md')[1];
  const plan = buildFrames(merge);
  ok(plan.playable, 'playable');
  eq(plan.steps, merge.rows.length, 'steps');
  eq(plan.frames[1].cells, ['1', '2', '0', '0'], 'the write row 22 asserts in its spec');
});

console.log(
  failures === 0
    ? `\n${checks} checks, 0 failures\n`
    : `\n${checks} checks, ${failures} FAILURES\n`,
);
process.exit(failures === 0 ? 0 : 1);