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
  TIER2_PRESETS,
  TIER2_LEVEL,
  OVERLAYS,
  readStack,
  readGrid,
  readRange,
  readSequence,
  readBits,
  lowestBit,
  readChain,
  readTreeWire,
  treeLayout,
  readEdge,
  graphComponents,
  readOp,
  readState,
  readDpWrite,
  readCall,
  planStack,
  planMatrix,
  planWindow,
  planBits,
  planGraph,
  planTree,
  planStatecard,
  planLinkedList,
  planDpTable,
  planRecursion,
  pickPreset,
  pickOverlays,
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

t('reports how many tables each preset and each overlay claims across the whole corpus', () => {
  const catalog = JSON.parse(fs.readFileSync('catalog/problems.json', 'utf8'));
  let tables = 0;
  const byPreset = {};
  const byOverlay = {};
  for (const problem of catalog.problems) {
    for (const table of guide(problem.path)) {
      tables++;
      const picked = pickPreset(table);
      if (picked) byPreset[picked.preset] = (byPreset[picked.preset] || 0) + 1;
      for (const overlay of pickOverlays(table)) {
        byOverlay[overlay.overlay] = (byOverlay[overlay.overlay] || 0) + 1;
      }
    }
  }
  eq(tables, 450, 'tables parsed');
  for (const name of ['window', 'matrix', 'stack', 'bits', ...TIER2_PRESETS]) ok(byPreset[name] > 0, `${name} claims at least one`);
  for (const name of OVERLAYS) ok(byOverlay[name] > 0, `${name} claims at least one`);
  console.log(`      presets ${JSON.stringify(byPreset)} of ${tables} tables`);
  console.log(`      overlays ${JSON.stringify(byOverlay)}`);
});

t('every Tier-2 claim is on a canonical-level table, and no Tier-2 claim is off one', () => {
  const catalog = JSON.parse(fs.readFileSync('catalog/problems.json', 'utf8'));
  for (const problem of catalog.problems) {
    for (const table of guide(problem.path)) {
      if (table.level === TIER2_LEVEL) continue;
      eq(pickPreset(table) === null || TIER2_PRESETS.indexOf(pickPreset(table).preset) === -1, true, `${problem.path} L${table.level} stays Tier 1`);
      eq(pickOverlays(table).length, 0, `${problem.path} L${table.level} carries no overlay`);
    }
  }
});

/* ================================================================== *
 * Row 24 — Tier 2: linkedlist, tree, graph, statecard + two overlays
 *
 * Plan §9 decision 2: Tier 1 animates all three levels, TIER 2 ANIMATES
 * THE CANONICAL LEVEL ONLY. So every Tier-2 planner and both overlay
 * planners refuse a table whose level is not 3 — that gate is the first
 * thing tested here, because getting it wrong is a dead UI on two levels
 * or a constraint the reader did not ask for.
 * ================================================================== */

console.log('\nTier 2 — the canonical-level gate (plan §9 decision 2)\n');

t('Tier 2 is four presets; the two overlays are chosen separately', () => {
  eq(TIER2_PRESETS, ['graph', 'tree', 'statecard', 'linkedlist'], 'tier 2 presets');
  eq(OVERLAYS, ['dp-table', 'recursion-tree'], 'overlays');
  eq(TIER2_LEVEL, 3, 'canonical level');
});

t('PRESETS is row 23\'s, unchanged — Tier 2 added a registry, it did not reorder one', () => {
  eq(PRESETS, ['window', 'matrix', 'stack', 'bits', 'array'], 'tier 1 order intact');
});

t('every Tier-2 planner and both overlay planners refuse a non-canonical level', () => {
  // The same table, at L3 and at L1/L2. Only the L3 copy may be claimed.
  const l3 = guide('10-binary-tree-bfs/04-zigzag-level-order.md')[2];
  const l1 = guide('10-binary-tree-bfs/04-zigzag-level-order.md')[0];
  const l2 = guide('10-binary-tree-bfs/04-zigzag-level-order.md')[1];
  // Each Tier-2 preset on the guide whose catalog `codec` names its shape, at L1, L2 and L3.
  const cases = [
    ['tree', planTree, '10-binary-tree-bfs/04-zigzag-level-order.md'],
    ['graph', planGraph, '19-graph-bfs/03-word-ladder.md'],
    ['statecard', planStatecard, '01-array-string/12-insert-delete-getrandom-o1.md'],
    ['linkedlist', planLinkedList, '08-linked-list/05-reverse-linked-list-ii.md'],
    ['dp-table', planDpTable, '17-multi-dp/03-unique-paths-ii.md'],
    ['recursion-tree', planRecursion, '09-binary-tree-general/03-invert-binary-tree.md'],
  ];
  for (const [name, plan, path] of cases) {
    const [l1, l2, l3] = guide(path);
    ok(plan(l3), `${name} claims the L3 table`);
    eq(plan(l1), null, `${name} refuses L1`);
    eq(plan(l2), null, `${name} refuses L2`);
  }
  eq(planDpTable(guide('17-multi-dp/03-unique-paths-ii.md')[1]), null, 'and the overlay planners are gated too');
});

t('a Tier-2 plan is still one frame per authored row — the transport is row 22\'s', () => {
  for (const path of [
    '19-graph-bfs/03-word-ladder.md',
    '10-binary-tree-bfs/04-zigzag-level-order.md',
    '08-linked-list/11-lru-cache.md',
    '08-linked-list/05-reverse-linked-list-ii.md',
    '17-multi-dp/03-unique-paths-ii.md',
    '09-binary-tree-general/03-invert-binary-tree.md',
  ]) {
    const table = guide(path)[2];
    for (const plan of [planGraph, planTree, planStatecard, planLinkedList, planDpTable, planRecursion]) {
      const made = plan(table);
      if (made) eq(made.steps, table.rows.length, `${path} ${made.preset || made.overlay} step count`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * readChain — a `next` chain, terminator included
 * ------------------------------------------------------------------ */

console.log('\nreadChain — the linkedlist preset (catalog: codec "list")\n');

t('reads an arrow chain verbatim', () => {
  eq(readChain('`1 -> 3 -> 2 -> 4 -> 5`'), { values: ['1', '3', '2', '4', '5'], terminated: false, unreachable: [] }, 'chain');
});

t('a `null` mid-chain is a TERMINATOR, not a gap — and the rest is unreachable', () => {
  eq(readChain('`2 -> null`'), { values: ['2'], terminated: true, unreachable: [] }, 'explicit null ends it');
  // The codec's own rule (api/_lib/codecs.mjs:184): a decode stops at the first null cell.
  eq(readChain('`[1, 2, null, 5, 6]`'), { values: ['1', '2'], terminated: true, unreachable: ['5', '6'] }, 'array with a null');
});

t('reads the empty list as zero nodes and says it terminated', () => {
  for (const cell of ['`[]`', '`null`', '`∅`', '—', 'empty']) {
    eq(readChain(cell), { values: [], terminated: true, unreachable: [] }, cell);
  }
});

t('reads a single node', () => {
  eq(readChain('`dummy -> 1a`'), { values: ['dummy', '1a'], terminated: false, unreachable: [] }, 'two nodes');
  eq(readChain('`[H,2,1,T]`'), { values: ['H', '2', '1', 'T'], terminated: false, unreachable: [] }, 'sentinel chain');
});

t('keeps an ellipsis node the guides write (`... -> 1b`)', () => {
  eq(readChain('`... -> 1b`'), { values: ['...', '1b'], terminated: false, unreachable: [] }, 'ellipsis');
});

t('refuses a set literal — a set has no next', () => {
  eq(readChain('`seen = {3,2,0}`'), null, 'set');
});

t('refuses a concatenation of two lists', () => {
  eq(readChain('`[2,0,1] + [0,1]`'), null, 'two groups');
});

t('refuses a scalar', () => {
  eq(readChain('`null`  is fine but `7` is not'), null, 'prose');
  eq(readChain('`7`'), null, 'scalar');
});

t('marks which nodes the step just moved, derived from two consecutive chains', () => {
  const frames = planLinkedList(guide('08-linked-list/05-reverse-linked-list-ii.md')[2]).frames;
  eq(frames.map((f) => f.values), [
    [], ['2'], ['3', '2'], ['4', '3', '2'], ['1', '4', '3', '2', '5'],
  ], 'chains');
  eq(frames.map((f) => f.op), ['carried', 'start', 'push', 'push', 'rewrite'], 'ops');
  eq(frames[3].moved, [0], 'the new head is what moved');
});

t('a row that writes no chain carries the last one forward and says so', () => {
  // reverse-linked-list-ii L3 step 0 is `Setup` — nothing to read. And a synthetic table with a
  // `next = null` row in the middle: the chain is remembered, not re-invented or blanked.
  const frames = planLinkedList(guide('08-linked-list/05-reverse-linked-list-ii.md')[2]).frames;
  eq(frames[0].source, 'carried', 'the setup row');
  eq(frames[0].op, 'carried', 'and the op says why');
  const mid = planLinkedList({
    level: 3,
    columns: ['Chain State'],
    rows: [['`1 -> 2 -> null`'], ['`2.next = 3`'], ['`3 -> 2 -> 1`']],
  }).frames;
  eq(mid.map((f) => [f.values, f.source]), [[['1', '2'], 'cell'], [['1', '2'], 'carried'], [['3', '2', '1'], 'cell']], 'carried mid-table');
});

/* ------------------------------------------------------------------ *
 * readTreeWire + treeLayout — a tree with real edges
 * ------------------------------------------------------------------ */

console.log('\ntreeLayout — the tree preset (catalog: codec "tree")\n');

t('reads levels of a level-order tree', () => {
  eq(readTreeWire('`out = [[3],[20,9],[15,7]]`'), { levels: [['3'], ['20', '9'], ['15', '7']] }, 'levels');
});

t('one level parses — it is step 0 of a growing tree — but a flat array is not levels', () => {
  eq(readTreeWire('`out = [[3]]`'), { levels: [['3']] }, 'one level');
  eq(readTreeWire('`[3, 9, 20, 15, 7]`'), null, 'a flat array has no levels');
});

t('a table of one repeated level is still not a tree', () => {
  eq(planTree({ level: 3, columns: ['State'], rows: [['`out = [[3]]`'], ['`out = [[3]]`']] }), null, 'no row opens a second level');
});

t('a rectangle is not levels of a tree — level widths must GROW', () => {
  eq(readTreeWire('`[[1,3],[6,9]]`'), null, 'equal widths');
  eq(readTreeWire('`[[1,3,5],[6,9]]`'), null, 'shrinking widths');
});

t('lays a level-order wire out with a parent for every non-root node', () => {
  const layout = treeLayout(['3', '20', '9', '15', '7']);
  eq(layout.height, 3, 'height');
  eq(layout.width, 4, 'slots in the widest level');
  eq(layout.nodes.map((n) => [n.i, n.value, n.depth, n.parent]), [
    [0, '3', 0, null],
    [1, '20', 1, 0],
    [2, '9', 1, 0],
    [3, '15', 2, 1],
    [4, '7', 2, 1],
  ], 'nodes with parent and depth — 20 holds both of level 2, 9 holds none');
  eq(layout.edges, [[0, 1], [0, 2], [1, 3], [1, 4]], 'four edges, both ends present');
});

t('an absent child is a hole, and no edge is drawn to it', () => {
  // The guide's own shape: 9 has no children at all, and 20 has only a right child.
  const layout = treeLayout(['3', '9', '20', null, null, '7']);
  eq(layout.nodes.map((n) => n.present), [true, true, true, false, false, true], 'holes marked');
  eq(layout.edges, [[0, 1], [0, 2], [2, 5]], 'no edge from a hole');
});

t('refuses a wire with no nodes at all', () => {
  eq(treeLayout([]), null, 'empty');
});

t('draws one more level per step, in the order the guide authored', () => {
  // 10-binary-tree-bfs/04-zigzag-level-order.md L3: level 1 is [20, 9], NOT [9, 20].
  const frames = planTree(guide('10-binary-tree-bfs/04-zigzag-level-order.md')[2]).frames;
  eq(frames.map((f) => f.layout.height), [1, 2, 3], 'heights');
  eq(frames[1].layout.nodes.map((n) => n.value), ['3', '20', '9'], 'mirrored level, as authored');
  eq(frames.map((f) => f.added), [[0], [1, 2], [3, 4]], 'the nodes each step added');
});

/* ------------------------------------------------------------------ *
 * readEdge + graphComponents — adjacency and disconnection
 * ------------------------------------------------------------------ */

console.log('\ngraphComponents — the graph preset (catalog: codec "graph")\n');

t('reads the edges a row states: the expanded frontier times the neighbours it found', () => {
  eq(readEdge(['expand `{hit}`', '`{hot}` found']), { from: ['hit'], to: ['hot'], terminal: null }, 'one edge');
  eq(readEdge(['expand `{hot}`', '`{dot,lot}`']), { from: ['hot'], to: ['dot', 'lot'], terminal: null }, 'two edges');
});

t('a row that expands but states no neighbour adds no edge — and a bare word is not one', () => {
  eq(readEdge(['expand `{cog}`', 'unwind']), { from: ['cog'], to: [], terminal: null }, 'nothing found');
  eq(readEdge(['expand `{cog}`', '`{dog}` found']), { from: ['cog'], to: ['dog'], terminal: null }, 'a braced set is');
});

t('the frontier is the first expansion on the row, in whichever column it sits', () => {
  // word-ladder L3 step 3 verbatim: the frontier being expanded is in `Pointer R` and the
  // neighbours it found in `Pointer L`, the other way round from every other step.
  eq(readEdge(['3', 'swap (2 > 1)', 'expand `{cog}`', 'expand `{dog,log}`', '`steps = 4`']),
    { from: ['cog'], to: ['dog', 'log'], terminal: null }, 'columns are interchangeable');
});

t('reports the two components the guide\'s own edges form at step 3', () => {
  // hit—hot—{dot,lot} and cog—{dog,log}: nothing joins them, so the graph is disconnected
  // and a graph preset that drew one blob would be lying.
  const frames = planGraph(guide('19-graph-bfs/03-word-ladder.md')[2]).frames;
  eq(frames[2].components, [['cog', 'dog', 'log'], ['dot', 'hit', 'hot', 'lot']], 'two components');
  eq(frames[2].added, [['cog', 'dog'], ['cog', 'log']], 'the step that joined them');
  eq(frames[3].components.length, 2, 'the contact row adds no edge and keeps both');
});

t('components merge as edges arrive, and a node with no edge is its own component', () => {
  eq(graphComponents(['a', 'b', 'c'], [['a', 'b']]), [['a', 'b'], ['c']], 'isolated c');
  eq(graphComponents(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]), [['a', 'b', 'c']], 'merged');
  eq(graphComponents([], []), [], 'no nodes');
});

t('an edge to a node nobody mentioned joins it rather than dropping it', () => {
  eq(graphComponents(['a'], [['a', 'z']]), [['a', 'z']], 'z is discovered');
});

t('marks the node the guide says reached the target', () => {
  const frames = planGraph(guide('19-graph-bfs/03-word-ladder.md')[2]).frames;
  eq(frames.map((f) => f.terminal), [null, null, null, 'dot'], 'endSet contact only on the last step');
});

/* ------------------------------------------------------------------ *
 * statecard — an object's state after each operation, plus its output
 * ------------------------------------------------------------------ */

console.log('\nplanStatecard — the ops case (catalog: codec "ops")\n');

const insertDelete = guide('01-array-string/12-insert-delete-getrandom-o1.md')[2];

t('claims the op column and both state fields', () => {
  const plan = planStatecard(insertDelete);
  ok(plan, 'a plan');
  eq(plan.opColumn, 0, 'Operation');
  eq(plan.fields.map((f) => f.label), ['`list` State', '`map` State'], 'both fields');
  eq(plan.level, 3, 'level');
});

t('reads one frame per authored operation, in order', () => {
  const frames = planStatecard(insertDelete).frames;
  eq(frames.map((f) => f.ops), [['insert(10)'], ['insert(20)'], ['insert(30)'], ['remove(20)'], ['getRandom()']], 'ops');
  eq(frames.map((f) => f.state.map((s) => s.value)), [
    ['[10]', '{ 10 => 0 }'],
    ['[10, 20]', '{ 10 => 0, 20 => 1 }'],
    ['[10, 20, 30]', '{ 10 => 0, 20 => 1, 30 => 2 }'],
    ['[10, 30]', '{ 10 => 0, 30 => 1 }'],
    ['[10, 30]', '{ 10 => 0, 30 => 1 }'],
  ], 'state per operation — the last row writes no map, so the map is carried');
});

t('a field a step did not touch is carried, and says so', () => {
  const frames = planStatecard(insertDelete).frames;
  eq(frames[4].state[1].source, 'carried', 'the map field is prose on the last row');
  eq(frames[4].state[1].value, '{ 10 => 0, 30 => 1 }', 'and carries the value before it');
});

t('the output of the operation is read from the row, not invented', () => {
  const frames = planStatecard(insertDelete).frames;
  eq(frames.map((f) => f.output), [null, null, null, null, 'Yields 10 or 30 with P = 0.5'], 'only getRandom emits');
});

t('a row may state several operations, and they are all named', () => {
  eq(readOp('`put(1,1), put(2,2)`'), ['put(1,1)', 'put(2,2)'], 'two ops in one cell');
  eq(readOp('`addNum(1)`'), ['addNum(1)'], 'one');
  eq(readOp('`push(-2)`'), ['push(-2)'], 'negative argument');
  eq(readOp('`[1, 2, 3]`'), null, 'not a call');
  eq(readOp('`push(-2), pop()`'), ['push(-2)', 'pop()'], 'two ops in one cell');
  eq(readOp('`lo empty -> push low`'), null, 'prose with an arrow is not a call');
});

t('reads a field state written as an array or as a Map literal', () => {
  eq(readState('`[10, 20, 30]`'), '[10, 20, 30]', 'array');
  eq(readState('`{ 10 => 0, 20 => 1 }`'), '{ 10 => 0, 20 => 1 }', 'map');
  eq(readState('`[H,3,1,T]`, `get(2)=-1`'), '[H,3,1,T]', 'state with output beside it');
  eq(readState('`Yields 10 or 30`'), null, 'prose');
});

t('the LRU case renders: an op on every row, a state carried on the rows between writes', () => {
  // 08-linked-list/11-lru-cache.md L3 writes `[H,2,1,T]` on step 1 and `[H,3,1,T]` on step 3,
  // with `Returns 1` and `get(2)=-1` on the rows between. A state column that had to be
  // written on most rows would refuse exactly the table a state card exists for.
  const plan = planStatecard(guide('08-linked-list/11-lru-cache.md')[2]);
  ok(plan, 'a plan');
  eq(plan.steps, 4, 'steps');
  eq(plan.frames.map((f) => f.state[0].source), ['cell', 'carried', 'cell', 'carried'], 'written / carried');
  eq(plan.frames.map((f) => f.output), [null, 'Returns 1', 'get(2)=-1', 'get(1)=-1, get(3)=3, get(4)=4'], 'outputs');
});

/* ------------------------------------------------------------------ *
 * dp-table — the overlay
 * ------------------------------------------------------------------ */

console.log('\nplanDpTable — the DP overlay (catalog: 16-one-dp / 17-multi-dp)\n');

t('reads a whole-row write and a ranged write and a single-cell write', () => {
  eq(readDpWrite('`dp = [1,1,1]`'), { lo: 0, hi: 2, values: ['1', '1', '1'] }, 'from the left edge');
  eq(readDpWrite('`dp[6..10] = [2,2,3,3,2]`'), { lo: 6, hi: 10, values: ['2', '2', '3', '3', '2'] }, 'ranged');
  eq(readDpWrite('`dp[10] = 2`'), { lo: 10, hi: 10, values: ['2'] }, 'single cell');
});

t('refuses a read (`min(dp[10],dp[9],dp[6])`) — a read writes nothing', () => {
  eq(readDpWrite('`min(dp[10],dp[9],dp[6]) + 1`'), null, 'read');
  eq(readDpWrite('`fold 1, 1, 2`'), null, 'prose');
});

t('fills the row cell by cell and marks the cells the step changed', () => {
  // 17-multi-dp/03-unique-paths-ii.md L3: [1,1,1] -> [1,0,1] -> dp[2] = 2.
  const frames = planDpTable(guide('17-multi-dp/03-unique-paths-ii.md')[2]).frames;
  eq(frames.map((f) => f.cells), [['1', '1', '1'], ['1', '0', '1'], ['1', '0', '2']], 'the row as it grows');
  eq(frames.map((f) => f.changed), [[], [1], [2]], 'the wall at index 1, then the target at 2');
  eq(frames.map((f) => f.cursor), [0, 1, 2], 'the current cell each step marked');
  eq(frames[0].changed, [], 'step 0 highlights nothing — there is no previous step');
});

t('claims a one-dp table too, and the cursor is the last index it wrote', () => {
  // 16-one-dp/04-coin-change.md L3: dp[0..5] then dp[6..10], so the row grows across steps.
  const plan = planDpTable(guide('16-one-dp/04-coin-change.md')[2]);
  ok(plan, 'a plan');
  eq(plan.width, 11, 'eleven cells');
  eq(plan.frames[0].cells.length, 6, 'first step wrote six');
  eq(plan.frames[1].cells.length, 11, 'second step wrote five more');
  eq(plan.frames[1].cursor, 6, 'cursor on the first cell that step changed');
});

/* ------------------------------------------------------------------ *
 * recursion-tree — the overlay
 * ------------------------------------------------------------------ */

console.log('\nplanRecursion — the recursion overlay\n');

t('reads a call and refuses prose', () => {
  eq(readCall('`invert(4)`'), { name: 'invert', args: ['4'] }, 'call');
  eq(readCall('`dfs(hit, 1)`'), { name: 'dfs', args: ['hit', '1'] }, 'two args');
  eq(readCall('`f(3,3)`'), { name: 'f', args: ['3', '3'] }, 'spaced');
  eq(readCall('`return root`'), null, 'not a call');
  eq(readCall('`[4,7,2,9,6,3,1]`'), null, 'array');
});

t('unfolds the call spine: depth grows on a descent and unwinds on a return', () => {
  // 09-binary-tree-general/03-invert-binary-tree.md L3: invert(4) -> invert(7) [leaf] ->
  // invert(2) [returned to the parent] -> return root.
  const frames = planRecursion(guide('09-binary-tree-general/03-invert-binary-tree.md')[2]).frames;
  eq(frames.map((f) => f.call), ['invert(4)', 'invert(7)', 'invert(2)', null], 'calls');
  eq(frames.map((f) => f.depth), [0, 1, 1, 0], 'depths');
  eq(frames.map((f) => f.base), [false, true, false, true], 'the leaf is where a base case is hit');
});

t('the deepest frame is the current one and the readout names the depth', () => {
  const plan = planRecursion(guide('09-binary-tree-general/03-invert-binary-tree.md')[2]);
  eq(plan.frames[1].spine, ['invert(4)', 'invert(7)'], 'spine at step 2');
  eq(plan.height, 2, 'widest spine the guide walks');
});

/* ------------------------------------------------------------------ *
 * Choosing — Tier 2 claims, overlays attach, Tier 1 does not regress
 * ------------------------------------------------------------------ */

console.log('\npickPreset / pickOverlays — who owns a table\n');

const wordLadder = guide('19-graph-bfs/03-word-ladder.md')[2];
const zigzag = guide('10-binary-tree-bfs/04-zigzag-level-order.md')[2];

t('a node-and-neighbour row goes to the graph preset', () => {
  eq(pickPreset(wordLadder).preset, 'graph', 'graph');
});

t('levels of a level-order go to the tree preset', () => {
  eq(pickPreset(zigzag).preset, 'tree', 'tree');
});

t('an op column with state fields goes to the state card, not to the chain', () => {
  const picked = pickPreset(insertDelete);
  eq(picked.preset, 'statecard', 'statecard wins the list-shaped `list` State column');
});

t('a `next` chain goes to the linked-list preset', () => {
  eq(pickPreset(guide('08-linked-list/05-reverse-linked-list-ii.md')[2]).preset, 'linkedlist', 'linkedlist');
});

t('overlays are a separate pass, so they never compete with a preset for the table', () => {
  eq(pickOverlays(zigzag).map((o) => o.overlay), [], 'a BFS table is neither');
  eq(pickOverlays(guide('17-multi-dp/03-unique-paths-ii.md')[2]).map((o) => o.overlay), ['dp-table'], 'a DP table is dp-table');
  eq(pickOverlays(guide('09-binary-tree-general/03-invert-binary-tree.md')[2]).map((o) => o.overlay), ['recursion-tree'], 'a recursive table is recursion-tree');
});

t('an overlay-only table still gets a player, because overlays need a transport', () => {
  // unique-paths-ii L3 has no graph/tree/statecard column, so `pickPreset` is null while
  // `pickOverlays` is not. The mount must still build row 22's chrome or the overlay would
  // have no scrubber.
  eq(pickPreset(guide('17-multi-dp/03-unique-paths-ii.md')[2]), null, 'no preset');
  eq(pickOverlays(guide('17-multi-dp/03-unique-paths-ii.md')[2]).length, 1, 'one overlay');
});

t('Tier 1 claims exactly what it claimed before — no table moved to Tier 2', () => {
  // Measured over all 450 tables: run Tier 1 alone, then with Tier 2 in front of it, and
  // require every Tier-1 claim to survive. This is the row-23-regression check.
  const catalog = JSON.parse(fs.readFileSync('catalog/problems.json', 'utf8'));
  const tier1 = { window: planWindow, matrix: planMatrix, stack: planStack, bits: planBits };
  let claimed = 0;
  let moved = [];
  for (const problem of catalog.problems) {
    for (const table of guide(problem.path)) {
      const was = Object.keys(tier1).find((name) => tier1[name](table));
      if (!was) continue;
      claimed++;
      const now = pickPreset(table);
      if (!now || now.preset !== was) moved.push(`${problem.path} L${table.level}: ${was} -> ${now ? now.preset : 'none'}`);
    }
  }
  ok(claimed > 0, 'Tier 1 claims something to protect');
  eq(moved, [], 'nothing Tier 1 owned moved to Tier 2');
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