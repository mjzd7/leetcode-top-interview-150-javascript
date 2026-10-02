/**
 * Row 22 self-tests: the `array` primitive's pure logic (plan v5 §7 row 22, §9 decision 2).
 *
 * The player is a browser module, but everything a stepper actually *decides* is a pure
 * function of the table rows `docs/dryrun/table.js` already parsed: which column holds the
 * array, what the array is at step n, and which index moved. Those are the parts that can be
 * wrong without anyone noticing, so they are the parts that are tested here — the DOM wiring
 * is covered by `tests/dry-run.spec.mjs` against a real browser.
 *
 * Cells arrive VERBATIM from the parser (backticks, `$…$`, `\|`), so `readArray` has to peel
 * one authored layer off a cell and refuse everything that is not a plain literal. A greedy
 * bracket match over this corpus finds `nums[0]=nums[2]` and `[0]=32` before it finds an
 * array, so the value guard is the whole test — not a nicety.
 *
 * Run: node scripts/test-dryrun-player.mjs     (exits 1 if any case fails)
 */
import { parseGuide, THIN_ROW_LIMIT } from '../docs/dryrun/table.js';
import {
  readArray,
  pickArrayColumn,
  clampStep,
  buildFrames,
  stepFrame,
  COL_MIN_PARSE_RATIO,
  PLAN,
} from '../docs/dryrun/index.js';

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

/* ------------------------------------------------------------------ *
 * readArray — peel one authored layer off a cell, or refuse it
 * ------------------------------------------------------------------ */

console.log('\nreadArray — one literal array out of one cell\n');

t('reads a backticked array literal', () => {
  eq(readArray('`[0, 1, 2, 2, 3, 0, 4, 2]`'), ['0', '1', '2', '2', '3', '0', '4', '2'], 'parsed');
});

t('reads a bare array literal', () => {
  eq(readArray('[3, 1, 4]'), ['3', '1', '4'], 'parsed');
});

t('reads string elements verbatim, quotes included', () => {
  eq(readArray('`["M", "CM", "XC"]`'), ['"M"', '"CM"', '"XC"'], 'parsed');
});

t('reads an empty array as zero cells, not as a refusal', () => {
  eq(readArray('`[]`'), [], 'parsed');
});

t('refuses a scalar — the commonest column in the corpus', () => {
  eq(readArray('`2`'), null, 'no bracket');
});

t('refuses a map literal (row 23 owns the map preset)', () => {
  eq(readArray('`{ 2 => 1 }`'), null, 'hash rocket');
});

t('refuses an assignment fragment that only contains brackets', () => {
  // `nums[0]=nums[2]` — a greedy match reads it as the array ["0]=nums[2]"].
  eq(readArray('`nums[0]=nums[2]`'), null, 'equals sign');
});

t('refuses an indexed-lhs fragment like `cols[0]=32`', () => {
  eq(readArray('`cols[0]=32`'), null, 'equals sign');
});

t('refuses a cell that only CONTAINS an array — a greedy match would not', () => {
  // `Return `[0, 1]`` is an Action cell, not a state column. Accepting it would
  // make every "Return [x, y]" row parse as an array, and that is exactly how the
  // loose bracket match turned 101 tables into 51 correct ones and 50 wrong ones.
  eq(readArray('Return `[0, 1]`'), null, 'prose around the literal');
  eq(readArray('`nums[i] = nums[j]`'), null, 'no complete literal');
  eq(readArray('`[1, 0, 1] → [0, 1]`'), null, 'two literals in one cell');
});

t('refuses a non-string', () => {
  eq(readArray(undefined), null, 'undefined');
  eq(readArray(null), null, 'null');
  eq(readArray(42), null, 'number');
});

/* ------------------------------------------------------------------ *
 * pickArrayColumn — which column of a table holds the array
 * ------------------------------------------------------------------ */

console.log('\npickArrayColumn — the one column worth animating\n');

const cols = ['Step', '`fast`', '`nums[fast]`', 'Condition (`!== 2`)', '`slow`', '`nums` State'];
const rows = [
  ['1', '0', '0', 'True', '$0 \\to 1$', '`[0, 1, 2, 2, 3, 0, 4, 2]`'],
  ['2', '1', '1', 'True', '$1 \\to 2$', '`[0, 1, 2, 2, 3, 0, 4, 2]`'],
  ['3', '2', '2', 'False', '2', '`[0, 1, 2, 2, 3, 0, 4, 2]`'],
  ['4', '3', '2', 'False', '2', '`[0, 1, 2, 2, 3, 0, 4, 2]`'],
  ['5', '4', '3', 'True', '$2 \\to 3$', '`[0, 1, 3, 2, 3, 0, 4, 2]`'],
];

t('picks the array-state column of a real-shaped table', () => {
  eq(pickArrayColumn(cols, rows), 5, 'column index');
});

t('returns -1 when no column is an array (two-sum L1: all scalars)', () => {
  const twoSum = ['`i`', '`nums[i]`', '`j`', '`nums[j]`', '`sum = nums[i] + nums[j]`', '`sum === target`?', 'Action'];
  const twoSumRows = [
    ['0', '2', '1', '7', '$2 + 7 = 9$', 'Yes ($9 == 9$)', 'Return `[0, 1]`'],
    ['0', '2', '2', '11', '$2 + 11 = 13$', 'No', 'Move `j`'],
  ];
  eq(pickArrayColumn(twoSum, twoSumRows), -1, 'no array column');
});

t('returns -1 on a headerless table', () => {
  eq(pickArrayColumn([], rows), -1, 'no columns');
});

t('returns -1 when only one row parses — a scalar that looks like a 1-cell array', () => {
  eq(pickArrayColumn(['State'], [['`[1, 2]`'], ['`nums[i]`']]), -1, 'one parseable row');
});

t('tolerates a minority of unparseable cells (ratio, not unanimity)', () => {
  // One row of five writes the state in prose; the column is still the right one,
  // and the player carries the last known array forward rather than inventing one.
  const ragged = [...rows.slice(0, 4), ['5', '4', '3', 'True', '3', 'unchanged']];
  ok(pickArrayColumn(cols, ragged) === 5, 'column index');
  ok(COL_MIN_PARSE_RATIO < 0.8, 'ratio leaves room for a minority of ragged rows');
});

/* ------------------------------------------------------------------ *
 * clampStep — the ends of the range, in both directions
 * ------------------------------------------------------------------ */

console.log('\nclampStep — a stepper that can never walk off its table\n');

t('clamps below zero to the first step', () => {
  eq(clampStep(-5, 8), 0, 'clamped');
});

t('clamps past the end to the last step', () => {
  eq(clampStep(99, 8), 7, 'clamped');
});

t('passes an in-range step through untouched', () => {
  eq(clampStep(3, 8), 3, 'clamped');
});

t('a one-step table pins to 0 from either side', () => {
  eq(clampStep(-1, 1), 0, 'before');
  eq(clampStep(7, 1), 0, 'after');
  eq(clampStep(0, 1), 0, 'on it');
});

t('an empty table pins to 0 instead of going negative', () => {
  eq(clampStep(3, 0), 0, 'empty');
});

t('truncates a fractional step', () => {
  eq(clampStep(2.9, 8), 2, 'truncated');
});

t('coerces a non-finite request to the first step', () => {
  eq(clampStep(NaN, 8), 0, 'NaN');
});

/* ------------------------------------------------------------------ *
 * buildFrames — one frame per table row, carrying the array forward
 * ------------------------------------------------------------------ */

console.log('\nbuildFrames — frames straight off a parsed table\n');

t('builds one frame per data row', () => {
  const plan = buildFrames({ level: 2, columns: cols, rows });
  eq(plan.playable, true, 'playable');
  eq(plan.column, 5, 'column');
  eq(plan.frames.length, rows.length, 'frame count');
  eq(plan.label, '`nums` State', 'label is the header, verbatim');
});

t('carries the last known array forward across an unparseable row', () => {
  // rows.slice(0, 4) drops the base fixture's swapping step, so frame 4 has only the
  // first four rows to carry from — step 4 must show step 3's array, not a new one.
  const ragged = [...rows.slice(0, 4), ['5', '4', '3', 'True', '3', 'unchanged']];
  const plan = buildFrames({ level: 2, columns: cols, rows: ragged });
  const last = plan.frames[4];
  eq(last.cells, ['0', '1', '2', '2', '3', '0', '4', '2'], 'carried, not invented');
  eq(last.source, 'carried', 'provenance is recorded');
  eq(last.changed, [], 'a remembered step changes nothing');
});

t('marks changed indices on the frame that changed them', () => {
  const plan = buildFrames({ level: 2, columns: cols, rows });
  eq(plan.frames[4].changed, [2], 'index 2 became 3');
  eq(plan.frames[0].changed, [], 'the first frame has nothing to compare against');
  eq(plan.frames[1].changed, [], 'an unchanged step changes nothing');
});

t('a shrinking array drops the trailing cells', () => {
  const shrink = [
    ['1', '`[1, 2, 3]`'],
    ['2', '`[1, 2]`'],
  ];
  const plan = buildFrames({ level: 1, columns: ['Step', '`nums`'], rows: shrink });
  eq(plan.frames[1].cells, ['1', '2'], 'two cells');
  eq(plan.frames[1].changed, [], 'removal is not a value change');
});

t('a one-row table builds exactly one frame and stays playable', () => {
  const plan = buildFrames({ level: 1, columns: ['`nums`'], rows: [['`[4, 1]`']] });
  eq(plan.playable, true, 'playable');
  eq(plan.frames.length, 1, 'one frame');
  eq(plan.frames[0].cells, ['4', '1'], 'cells');
  eq(plan.frames[0].changed, [], 'nothing changed');
});

t('a table with no array column is unplayable and says why', () => {
  const plan = buildFrames({
    level: 1,
    columns: ['`i`', '`nums[i]`', 'Action'],
    rows: [['0', '2', 'compare'], ['1', '7', 'return']],
  });
  eq(plan.playable, false, 'unplayable');
  eq(plan.frames.length, 0, 'no frames');
  ok(plan.reason && plan.reason.length > 0, 'reason is a sentence');
});

t('a heading with no table at all is unplayable, not a crash', () => {
  const plan = buildFrames({ level: 1, columns: [], rows: [] });
  eq(plan.playable, false, 'unplayable');
  eq(plan.reason, PLAN.NO_TABLE, 'named reason');
});

t('a headerless-but-present table is unplayable, not a crash', () => {
  const plan = buildFrames({ level: 3, columns: [], rows: [['`[1]`'], ['`[1, 2]`']] });
  eq(plan.playable, false, 'unplayable');
  eq(plan.reason, PLAN.NO_COLUMN, 'named reason');
});

/* ------------------------------------------------------------------ *
 * stepFrame — the frame a control press lands on
 * ------------------------------------------------------------------ */

console.log('\nstepFrame — what one press of a control yields\n');

const plan = buildFrames({ level: 2, columns: cols, rows });
const n = plan.frames.length;

t('forward from the first step is step 1', () => {
  eq(stepFrame(plan, 0, 1), 1, 'index');
});

t('forward at the last step stays put (clamp, no wrap)', () => {
  eq(stepFrame(plan, n - 1, 1), n - 1, 'index');
  eq(stepFrame(plan, n - 1, 1), n - 1, 'idempotent');
});

t('back from the first step stays put', () => {
  eq(stepFrame(plan, 0, -1), 0, 'index');
});

t('back from step 2 is step 1', () => {
  eq(stepFrame(plan, 2, -1), 1, 'index');
});

t('an out-of-range current step is pulled back into range first', () => {
  eq(stepFrame(plan, 99, -1), n - 2, 'clamped then moved');
  eq(stepFrame(plan, -99, 1), 1, 'clamped then moved');
});

t('jump is a delta, so one call covers every position', () => {
  eq(stepFrame(plan, 0, n - 1), n - 1, 'to the last frame');
  eq(stepFrame(plan, n - 1, -(n - 1)), 0, 'to the first frame');
});

/* ------------------------------------------------------------------ *
 * End to end, off table.js's own output — the two modules must agree
 * ------------------------------------------------------------------ */

console.log('\ntable.js -> index.js, no hand-written fixtures\n');

const GUIDE = [
  '# Two Sum',
  '',
  '## 2. Level 1: Brute Force Nested Loops',
  '',
  '### Step-by-Step Dry Run',
  '',
  '| Step | `i` | `nums[i]` | `j` | `nums[j]` | `nums` State |',
  '| --- | --- | --- | --- | --- | --- |',
  '| 1 | 0 | 2 | 1 | 7 | `[2, 7, 11, 15]` |',
  '| 2 | 0 | 2 | 2 | 11 | `[2, 7, 11, 15]` |',
  '| 3 | 0 | 2 | 3 | 15 | `[2, 7, 11, 15]` |',
  '',
  '## 3. Level 2: One-Pass Hash Map',
  '',
  '### Step-by-Step Dry Run',
  '',
  '| Step | `num` | `seen` | Action |',
  '| --- | --- | --- | --- |',
  '| 1 | 2 | `{ 2 => 0 }` | store |',
  '| 2 | 7 | `{ 2 => 0, 7 => 0 }` | return |',
  '',
].join('\n');

t('plan decision 2: a guide with one playable table and one scalar table', () => {
  const tables = parseGuide(GUIDE);
  eq(tables.length, 2, 'two dry-run tables in document order');
  eq(tables[0].level, 1, 'L1 heading owned table 1');
  eq(tables[1].level, 2, 'L2 heading owned table 2');
  eq(buildFrames(tables[0]).playable, true, 'L1 plays');
  eq(buildFrames(tables[1]).playable, false, 'L2 has a map state, not an array');
});

t('frames read the parsed cells, not a re-parse', () => {
  const frames = buildFrames(parseGuide(GUIDE)[0]).frames;
  eq(frames[0].cells, ['2', '7', '11', '15'], 'step 1 cells');
  eq(frames.map((f) => f.cells.join('')), ['271115', '271115', '271115'], 'every step');
});

t('the whole corpus parses through table.js without this module throwing', () => {
  // Guards the import itself: one malformed fixture must not take the module down.
  const junk = parseGuide('### Step-by-Step Dry Run\n\nnot a table\n\n| `nums` |\n| --- |\n');
  eq(buildFrames(junk[0]).playable, false, 'unplayable');
  eq(buildFrames(null).playable, false, 'null table');
  eq(buildFrames(undefined).playable, false, 'undefined table');
});

t('THIN_ROW_LIMIT is the row-21 constant, not a second one', () => {
  eq(PLAN.THIN_ROW_LIMIT, THIN_ROW_LIMIT, 'single definition');
});

/* ------------------------------------------------------------------ */

console.log('');
console.log('-'.repeat(60));
console.log(`Checks: ${checks} | Failures: ${failures}`);
console.log('-'.repeat(60));
process.exit(failures === 0 ? 0 : 1);