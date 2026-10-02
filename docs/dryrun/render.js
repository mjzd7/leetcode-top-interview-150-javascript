/**
 * The remaining Tier-1 presets — `stack`, `matrix`, `window`, `bits` (row 23).
 *
 * One ES module under `docs/dryrun/`, imported once, adding no global (plan G4). It reads the
 * same parsed tables row 22 reads, decides per table which of the four shapes the table is
 * actually recording, and swaps the `array` primitive's flat row of cells for the shape that
 * teaches. Together with row 22 that is all five Tier-1 presets.
 *
 * ── Why a preset is not an array ──────────────────────────────────────────────
 * A dry-run table records a shape, and the shape is the lesson:
 *
 *   `stack`   LIFO, not a list. Cells run top-down, the top entry is marked, and the step says
 *             `push`/`pop` with the entry that moved — a stack drawn as a row has lost the one
 *             property that makes it a stack.
 *   `matrix`  a rectangle with row/column headers and the `(r, c)` the step addresses, so
 *             `matrix[r][c]` arithmetic is legible instead of implied.
 *   `window`  the BOUNDS, the size, and what crossed the edge. The underlying array is
 *             reconstructed from the windows themselves (see `planWindow`), because a window is
 *             a range over something and the guide only ever writes the range's contents.
 *   `bits`    a number as its digits, with the bit the step cleared marked. A cell reading
 *             `101 & 110 = 100` is a bit operation; rendering it as `[101, 110, 100]` would be
 *             three numbers instead of one bit.
 *
 * ── One contract, shared with row 22 ──────────────────────────────────────────
 *   - `plan.steps === table.rows.length`. Always. The transport is row 22's, whose scrubber is
 *     built for exactly that many steps; a preset that returned a different count would leave
 *     the reader dragging past the end of the run.
 *   - An unreadable cell carries the previous frame forward, tagged `source: 'carried'`, exactly
 *     as row 22's `buildFrames` does.
 *   - Step 0 highlights nothing: there is no previous step to have changed from.
 *   - The column is decided by the ROWS, not the header, except where the header is the only
 *     thing that can tell two array-shaped things apart — a `Stack After` column and a
 *     `Resulting Corners` column are both `[…]`, and only their names distinguish a LIFO from
 *     a matrix.
 *
 * ── Where the chrome comes from ───────────────────────────────────────────────
 * Where row 22 already mounted a player, this module ADOPTS it: the transport, the scrubber,
 * the table-row marker and `data-step` stay row 22's, and this module only swaps the stage and
 * follows `data-step`. That is the reuse, and it is why there is no second control bar.
 *
 * It cannot be the whole story, and the gap is worth naming: row 22's `buildPlayer` — the
 * chrome itself — is private to `docs/dryrun/index.js`, and its `paint()` is closed over the
 * array plan. So for a table row 22 SKIPPED (no array column of its own: `[')']` is not a plain
 * array literal, a `Mutated Grid` cell is a nested one), there is no player to adopt and this
 * file builds one. `buildPresetPlayer` below emits row 22's exact DOM contract — same classes,
 * same SVG icons, same 900 ms, same `data-step` attribute — so the two are interchangeable from
 * the reader's side and from row 25's spec. The de-duplication is one `export` keyword in row
 * 22's file plus the deletion of `buildPresetPlayer`; it is not done here because
 * `docs/dryrun/index.js` is row 22's committed deliverable and this row does not edit it.
 *
 * ── ponytail: authored rows only, and each preset names its own ceiling ───────
 * There is no trace replay here (E34). Every frame is a row a human wrote, at the granularity
 * the human wrote it. Four named ceilings, each with the upgrade path:
 *   `stack`    assumes a LIFO of scalars written as one array literal; a stack of nodes
 *              (row 24's `linkedlist`) needs a different stage, not a different plan.
 *   `matrix`   assumes a rectangle whose cells are scalars; a ragged list of lists is a list,
 *              and is refused rather than padded.
 *   `window`   assumes the window is a CONTIGUOUS range and that its contents are written out.
 *              A sparse or gapped window is refused. The upgrade path is one seam: `planWindow`
 *              already returns `{lo, hi}`, so a window carried as a pair of pointers instead of
 *              a written range replaces the range reader and nothing else.
 *   `bits`     assumes one word per row, bounded by `CELL_CAP` (64, i.e. wider than the 32 bits
 *              every bit guide in this corpus uses). A second word per row — a carry column —
 *              needs a wider grid, not new logic.
 * Real execution is rows 15 and 25 (`docs/traces/*.json`), which replace the table reading with
 * a trace adapter producing the same `{steps, frames}` shape.
 */
import { parseGuide, THIN_ROW_LIMIT } from './table.js';
import { COL_MIN_PARSE_RATIO, clampStep, stepFrame } from './index.js';

/* ------------------------------------------------------------------ *
 * Pure logic — no DOM, no globals, importable from Node
 * ------------------------------------------------------------------ */

/**
 * Every preset, in the order they outrank one another, `array` (row 22) last.
 *
 * The order is by how much a preset adds over the one below it, not by frequency: `window`
 * carries bounds no other preset has, `matrix` carries both axes, `stack` carries LIFO, `bits`
 * carries bit positions. A table two presets both claim — simplify-path L3 is a plain array
 * literal AND a stack — goes to the higher one, because rendering it as a row of cells throws
 * away the property that makes it worth animating.
 */
export const PRESETS = ['window', 'matrix', 'stack', 'bits', 'array'];

/** One planner per preset name. `array` is row 22's and lives in `index.js`. */
const PLANNERS = { window: planWindow, matrix: planMatrix, stack: planStack, bits: planBits };

/** Widest a stack, a grid, a window or a bit word may be. Beyond this a cell is prose. */
const CELL_CAP = 64;

/** Strip the authored layer: surrounding emphasis, whitespace, and a `$…$` math wrapper. */
const strip = (cell) => String(cell == null ? '' : cell).replace(/^[`~* ]+/, '').replace(/[`~* ]+$/, '').trim();
const math = (cell) => strip(cell).replace(/^\$+/, '').replace(/\$+$/, '').trim();

/**
 * Split on commas at bracket depth zero: `[a, [b, c]]` → `['a', '[b, c]']`.
 *
 * Depth-aware, because a grid cell is a list of lists and splitting it naively is how a 2x3
 * turns into six cells.
 */
function splitTop(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** `[…]` → `[start, end]` for every top-level group, or null if the brackets do not balance. */
function bracketPairs(b) {
  const open = [];
  const pairs = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i] === '[') open.push(i);
    else if (b[i] === ']') {
      const start = open.pop();
      if (start === undefined) return null;
      pairs.push([start, i]);
    }
  }
  return open.length ? null : pairs;
}

/** `[a, b]` → `['a', 'b']`, or null when it is not one row of scalars. */
function rowOf(group) {
  const inner = group.slice(1, -1).trim();
  if (!inner) return [];
  const items = splitTop(inner);
  if (items.some((item) => !item || /[`=$→\\]/.test(item))) return null;
  return items;
}

/** Indices `lo…hi` inclusive, or `[]` for no window. */
const span = (lo, hi) => (lo === null || hi === null || hi < lo ? [] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));

/** Left-pad a bit pattern with zeroes so two patterns compare digit for digit. */
const pad = (bits, width) => String(bits).padStart(width, '0');

/* ------------------------------------------------------------------ *
 * stack — one LIFO column
 * ------------------------------------------------------------------ */

/** A quoted token is a value whatever it contains (`')'`, `"a"`, `"/"`). */
const QUOTED = /^('[^']*'|"[^"]*")$/;
/** …or it must look like a bare scalar or identifier, which is all a stack of scalars holds. */
const BARE = /^-?\d+(?:\.\d+)?$|^[A-Za-z_][\w.]*$|^∞$/;

/**
 * The stack one cell holds, or null when the cell is not one.
 *
 * Stricter than row 22's `readArray` on purpose: a stack's entries are values, so a quoted
 * bracket (`')'`) is accepted where `readArray` refuses it, and a nested array is refused where
 * `readGrid` should have it instead.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {string[]|null} entries verbatim, bottom of the stack first
 */
export function readStack(cell) {
  const b = strip(cell);
  if (b[0] !== '[' || b[b.length - 1] !== ']') return null;
  const inner = b.slice(1, -1).trim();
  if (!inner) return [];
  if (inner.includes('=>')) return null;
  const items = splitTop(inner);
  if (items.length > CELL_CAP) return null;
  if (items.some((item) => !QUOTED.test(item) && !BARE.test(item))) return null;
  return items;
}

/**
 * What one step did to the stack, from two consecutive states.
 *
 * Derived, not read: the guides say "Pop `']'`" in prose and `[1, 2]` in the column, and the
 * prose is not always there. A longer stack is a push of exactly the new entries, a shorter one
 * a pop of exactly the entries that left, and a stack that changed in place is a `swap` — named
 * rather than drawn as a push, because calling a mutation a push is the lie this preset exists
 * to avoid.
 *
 * @param {string[]|null} previous the previous frame's entries, null on step 0
 * @param {string[]} next this frame's entries
 * @returns {{op: 'start'|'push'|'pop'|'same'|'swap', moved: number[]}}
 */
export function stackOp(previous, next) {
  if (!previous) return { op: 'start', moved: [] };
  let differs = -1;
  const shared = Math.min(previous.length, next.length);
  for (let i = 0; i < shared; i++) {
    if (previous[i] !== next[i]) {
      differs = i;
      break;
    }
  }
  if (differs !== -1) return { op: 'swap', moved: [differs] };
  if (next.length > previous.length) return { op: 'push', moved: span(previous.length, next.length - 1) };
  if (next.length < previous.length) return { op: 'pop', moved: span(next.length, previous.length - 1) };
  return { op: 'same', moved: [] };
}

/**
 * One playable stack table, or null.
 *
 * Claims a column whose HEADER names a stack — the one case where the header decides rather
 * than the rows, because a stack and an array are both `[…]` and only the name distinguishes
 * them. Between two stack columns the post-step one wins (`Stack After` over `Stack Before`):
 * the player shows the state a step produced, which is what row 22's array player does too.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, column: number, label: string, steps: number,
 *   frames: Array<{n: number, items: string[], op: string, moved: number[], source: string}>}}
 */
export function planStack(table) {
  const level = table && Number(table.level) ? Number(table.level) : 0;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let column = -1;
  let best = -1;
  for (let c = 0; c < table.columns.length; c++) {
    if (!/stack/i.test(table.columns[c])) continue;
    const ratio = table.rows.filter((row) => readStack(row[c]) !== null).length / table.rows.length;
    if (ratio < COL_MIN_PARSE_RATIO) continue;
    // Post-step beats pre-step; then the denser column; then the leftmost.
    const after = /after|state|result|updated/i.test(table.columns[c]) ? 1 : 0;
    const before = /before|prev/i.test(table.columns[c]) ? 1 : 0;
    const score = (after ? 2 : 0) - (before ? 1 : 0) + ratio;
    if (score > best) {
      best = score;
      column = c;
    }
  }
  if (column === -1) return null;

  const frames = [];
  let previous = null;
  for (let i = 0; i < table.rows.length; i++) {
    const written = readStack(table.rows[i][column]);
    const items = written !== null ? written : previous || [];
    frames.push({
      n: i,
      items,
      ...stackOp(previous, items),
      source: written !== null ? 'cell' : 'carried',
    });
    if (written !== null) previous = written;
  }
  return { preset: 'stack', level, column, label: table.columns[column], steps: frames.length, frames };
}

/* ------------------------------------------------------------------ *
 * matrix — one rectangle
 * ------------------------------------------------------------------ */

/**
 * The rectangle one cell holds, or null.
 *
 * Two authored spellings are accepted, because the guides use both: the nested form
 * `` `[[1, 4], [2, 5]]` `` and the row-joined form `` `[1, 4], [2, 5]` `` (spiral-matrix L2). A
 * flat `[7, 4, 1]` is a one-row grid — which is what a 2-D state looks like while it is being
 * rebuilt one row at a time (rotate-image L3's last three steps).
 *
 * Refused: ragged rows (a list of lists, not a rectangle) and a cell with commentary after the
 * literal (`… (Correct!)`). The second is row 22's "refuse rather than guess" rule for the same
 * reason — a guessed cell is a state the guide never claimed — and the frame then carries the
 * previous grid forward and says so.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {string[][]|null} rows of cells, or null
 */
export function readGrid(cell) {
  const b = math(strip(cell));
  if (b[0] !== '[' || b[b.length - 1] !== ']') return null;

  const pairs = bracketPairs(b);
  if (!pairs) return null;
  const outer = pairs.find((pair) => pair[0] === 0);
  let groups;
  if (outer && outer[1] === b.length - 1) {
    // Container form: the outermost brackets hold the rows. No nested group means one flat row.
    const nested = pairs.filter((pair) => pair[0] > outer[0] && pair[1] < outer[1]);
    groups = nested.length ? nested : [outer];
  } else {
    // Row-joined form: every top-level group is a row, and only commas sit outside them.
    if (b.replace(/\[[^\]]*\]/g, '').replace(/[\s,]/g, '')) return null;
    groups = pairs;
  }

  const rows = [];
  for (const [start, end] of groups) {
    const row = rowOf(b.slice(start, end + 1));
    if (row === null) return null;
    rows.push(row);
  }
  const width = rows.length ? rows[0].length : 0;
  if (!width || width > CELL_CAP || rows.length > CELL_CAP) return null;
  if (rows.some((row) => row.length !== width)) return null;
  return rows;
}

/** `(0, 1)` → `[0, 1]`: the cell a step addresses in a 2-D state. */
export function readAddress(cell) {
  const m = math(strip(cell)).match(/\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * One playable grid table, or null.
 *
 * Claims a column whose header names a grid (`matrix`, `grid`, `board`) AND whose rows hold a
 * rectangle at least two rows tall. Both halves are needed: the header rejects the list of
 * intervals that happens to be a rectangular array of pairs (merge-intervals L1 `Active List`),
 * and the height rejects a one-row column that is simply an array — row 22's preset owns those.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, column: number, label: string,
 *   addressColumn: number, steps: number,
 *   frames: Array<{n: number, rows: string[][], changed: number[][], at: number[]|null, source: string}>}}
 */
export function planMatrix(table) {
  const level = table && Number(table.level) ? Number(table.level) : 0;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let column = -1;
  let best = 0;
  for (let c = 0; c < table.columns.length; c++) {
    if (!/matrix|grid|board/i.test(table.columns[c])) continue;
    const parsed = table.rows.map((row) => readGrid(row[c]));
    const ratio = parsed.filter((grid) => grid !== null).length / table.rows.length;
    if (ratio < COL_MIN_PARSE_RATIO) continue;
    if (!parsed.some((grid) => grid && grid.length > 1)) continue;
    if (ratio > best) {
      best = ratio;
      column = c;
    }
  }
  if (column === -1) return null;

  // The cell the step addresses, when the table has a `(r, c)` column. This is what makes
  // `matrix[r][c]` legible: the arithmetic and the box it lands in are on screen together.
  let address = -1;
  for (let c = 0; c < table.columns.length; c++) {
    if (c === column) continue;
    const ratio = table.rows.filter((row) => readAddress(row[c]) !== null).length / table.rows.length;
    if (ratio >= COL_MIN_PARSE_RATIO) {
      address = c;
      break;
    }
  }

  const frames = [];
  let previous = null;
  let previousAt = null;
  for (let i = 0; i < table.rows.length; i++) {
    const written = readGrid(table.rows[i][column]);
    const rows = written !== null ? written : previous || [];
    const changed = [];
    if (previous) {
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          if (!previous[r] || previous[r][c] !== rows[r][c]) changed.push([r, c]);
        }
      }
    }
    const at = readAddress(table.rows[i][address]);
    frames.push({ n: i, rows, changed, at: at || previousAt, source: written !== null ? 'cell' : 'carried' });
    if (written !== null) previous = written;
    if (at) previousAt = at;
  }
  return {
    preset: 'matrix',
    level,
    column,
    label: table.columns[column],
    addressColumn: address,
    steps: frames.length,
    frames,
  };
}

/* ------------------------------------------------------------------ *
 * window — a range over something
 * ------------------------------------------------------------------ */

/**
 * The range one cell states, or null.
 *
 * `a..b`, `$a \\to b$`, `s[0 ... 5]` — the guides spell a window's bounds three ways. A
 * descending range is refused: a window never ends before it starts, and `5 \to 0` is prose
 * about two numbers rather than a window.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {[number, number]|null} inclusive bounds, or null
 */
export function readRange(cell) {
  const m = math(strip(cell)).match(/(\d+)\s*(?:\.\.\.?|\\to\b|\\rightarrow\b|→|…)\s*(\d+)/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return hi >= lo ? [lo, hi] : null;
}

/**
 * What one step did to a window's membership: its size, and the indices that crossed the edge.
 *
 * Isolated because it is the arithmetic the preset teaches, and because the guides compress
 * several steps into one row: minimum-size-subarray-sum jumps its left edge from 2 to 4 because
 * the guide skips `i = 3`, and the honest rendering is "two left, one right", not "one left".
 *
 * @param {[number, number]|null} bounds this step's bounds
 * @param {[number, number]|null} previous the previous step's bounds
 * @returns {{size: number, entered: number[], departed: number[]}}
 */
export function windowBounds(bounds, previous) {
  const now = bounds ? span(bounds[0], bounds[1]) : [];
  const before = previous ? span(previous[0], previous[1]) : [];
  const inside = new Set(now);
  const wasInside = new Set(before);
  return {
    size: now.length,
    entered: now.filter((i) => !wasInside.has(i)),
    departed: before.filter((i) => !inside.has(i)),
  };
}

/**
 * What fills a window: the contents of a range, one entry per index.
 *
 * An array literal gives one entry per element; a quoted string gives one per character, which
 * is the same window over a string rather than an array. A frequency list (`A:1, B:1`) is
 * refused — it has no order, so it fills no contiguous range.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {string[]|null}
 */
export function readSequence(cell) {
  const grid = readGrid(cell);
  if (grid) return grid.length === 1 ? grid[0] : null;
  const quoted = strip(cell).match(/^"([^"]*)"$/);
  return quoted ? quoted[1].split('') : null;
}

/**
 * One playable sliding-window table, or null.
 *
 * Detection is entirely structural, with no header gate: a range column is only a window if
 * another column's cells are exactly as long as the range they fill. Measured over the 450
 * tables that is two guides — the two that write their window's contents — which is the honest
 * count: no header name distinguishes a range carrying data from a range carrying an address
 * (sudoku's `Cells Checked`).
 *
 * `base` is the reconstruction: the array the windows sit inside, rebuilt by writing each
 * window's contents at its own offset. That is what makes this a window rather than a list of
 * fragments — for minimum-size-subarray-sum L1 the four windows reassemble the guide's stated
 * `nums = [2, 3, 1, 2, 4, 3]` exactly. Where two rows disagree about an index both readings
 * are kept, the index is listed in `conflicts`, and the cell is marked rather than silently
 * resolved in favour of whichever row came first.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, rangeColumn: number, sequenceColumn: number,
 *   label: string, base: Array<string|null>, conflicts: number[], steps: number,
 *   frames: Array<{n: number, lo: number, hi: number, size: number, items: string[],
 *     entered: number[], departed: number[], source: string}>}}
 */
export function planWindow(table) {
  const level = table && Number(table.level) ? Number(table.level) : 0;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let rangeColumn = -1;
  let sequenceColumn = -1;
  let ranges = null;
  let sequences = null;

  for (let c = 0; c < table.columns.length && rangeColumn === -1; c++) {
    const parsed = table.rows.map((row) => readRange(row[c]));
    if (parsed.filter(Boolean).length / table.rows.length < COL_MIN_PARSE_RATIO) continue;
    for (let d = 0; d < table.columns.length; d++) {
      if (d === c) continue;
      const seq = table.rows.map((row) => readSequence(row[d]));
      const filled = parsed.filter((range, i) => range && seq[i] && seq[i].length === range[1] - range[0] + 1).length;
      if (filled / table.rows.length < COL_MIN_PARSE_RATIO) continue;
      rangeColumn = c;
      sequenceColumn = d;
      ranges = parsed;
      sequences = seq;
      break;
    }
  }
  if (rangeColumn === -1) return null;

  const base = [];
  const conflicts = [];
  const frames = [];
  let previous = null;

  for (let i = 0; i < table.rows.length; i++) {
    const range = ranges[i];
    const items = range ? sequences[i] : null;
    const written = range !== null && items !== null;
    const move = windowBounds(range, previous);

    if (written) {
      const at = range[0] + items.length;
      if (at > base.length) base.length = at;
      for (let k = 0; k < items.length; k++) {
        const index = range[0] + k;
        if (base[index] === undefined) base[index] = items[k];
        else if (base[index] !== items[k] && conflicts.indexOf(index) === -1) conflicts.push(index);
      }
    }

    frames.push({
      n: i,
      lo: range ? range[0] : null,
      hi: range ? range[1] : null,
      size: move.size,
      items: items || (previous ? frames[frames.length - 1].items : []),
      entered: move.entered,
      departed: move.departed,
      source: written ? 'cell' : 'carried',
    });
    if (written) previous = range;
  }
  if (!frames.some((frame) => frame.source === 'cell')) return null;

  return {
    preset: 'window',
    level,
    rangeColumn,
    sequenceColumn,
    label: table.columns[rangeColumn],
    base,
    conflicts,
    steps: frames.length,
    frames,
  };
}

/* ------------------------------------------------------------------ *
 * bits — one word
 * ------------------------------------------------------------------ */

/** `6` in binary, for proving a parenthesised field is binary rather than decimal. */
const binary = (n) => (n < 0 ? `-${Math.abs(n).toString(2)}` : n.toString(2));

/**
 * The bit field one cell holds, or null when the cell is not about bits at all.
 *
 * The rule that matters is the FIRST one: a parenthesised run of zeroes and ones is only read
 * as binary when the decimal beside it really is that number in binary. `n = 6 (110)` and
 * `n = 11` (`1011`) qualify; `n = 1011 (1011)` does not, because 1011 decimal is not 1011
 * binary, so the cell is ambiguous. That proof is what stops a decimal column from posing as a
 * word — integer-to-roman writes `5 * 1000`, and without it `1000` renders as ten bits.
 *
 * A bare run (`101`) is only admitted with `{ lax: true }`, which the column scan uses once a
 * neighbouring row has proven the column binary. An equation cell always returns an object —
 * possibly all-null — so the caller can tell "an equation with nothing binary in it" from
 * "not a bit cell at all".
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @param {{lax?: boolean}} [opts] allow a bare run once the column is proven
 * @returns {null|{value: string|null, result: string|null}} `value` is the operand under test,
 *   `result` the cell's own stated outcome after `=`
 */
export function readBits(cell, { lax = false } = {}) {
  if (typeof cell !== 'string') return null;
  // Code spans inside the cell are markdown, not content: `n = 11` (`1011`) is one claim split
  // across two spans, and without dropping the backticks the decimal and the field it proves
  // never become neighbours.
  const b = math(strip(cell).replace(/[`*]/g, ''));
  if (!b) return null;

  const proven = b.match(/(\d+)\s*\(\s*([01]{2,})\s*\)/);
  if (proven && binary(Number(proven[1])) === proven[2]) return { value: proven[2], result: null };

  const quoted = b.match(/^"([01]+)"$/);
  if (quoted) return { value: quoted[1], result: null };

  if (!/[&|^]|<<|>>|=/.test(b)) return lax && /^[01]{2,}$/.test(b) ? { value: b, result: null } : null;

  const at = b.search(/[&|^]|<<|>>>|>>/);
  let value = null;
  if (at > 0) {
    const runs = (b.slice(0, at).match(/[01]+/g) || []).filter((run) => run.length >= 2);
    if (runs.length) value = runs[runs.length - 1];
  }
  // The right of an `=` is only a bit pattern when the equation is a bit operation. `n = 1011`
  // assigns a decimal; `101 & 110 = 100` states bits.
  const stated = /[&|^]|<<|>>>|>>/.test(b) ? b.match(/=\s*([01]+)/) : null;
  return { value, result: stated ? stated[1] : null };
}

/**
 * Which bit two patterns disagree on, counted from the right — or -1 when they do not disagree.
 *
 * This is the bit under test the preset marks. It is read off the row's own stated result where
 * the row states one (`n & (n-1) = 1010` against `1011`) and off the previous frame otherwise,
 * so step 0 highlights when the guide says something and stays blank when it does not.
 *
 * @param {string} value this frame's word
 * @param {string} [other] the comparator; absent highlights nothing
 * @returns {number} bit index from the right, -1 when there is no difference
 */
export function lowestBit(value, other) {
  if (!value || !other) return -1;
  const width = Math.max(value.length, other.length);
  const a = pad(value, width);
  const b = pad(other, width);
  for (let i = 0; i < width; i++) if (a[width - 1 - i] !== b[width - 1 - i]) return i;
  return -1;
}

/** Set bits in a word — for the guides whose answer is the count. */
const popcount = (bits) => Array.from(bits).filter((digit) => digit === '1').length;

/**
 * One playable bit table, or null.
 *
 * Claims a column at least `COL_MIN_PARSE_RATIO` of whose rows carry a PROVEN bit field — row
 * 22's floor, not a second number. The comparator is the row's own stated result when it has
 * one, preferring a cell that names a bit operator over one that merely has an `=`, so
 * `n & (n-1) = 1010` is read as the operator's result and not as `count = 1`.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, column: number, label: string, width: number,
 *   steps: number, frames: Array<{n: number, value: string, tested: number, ones: number,
 *   comparator: string|null, source: string}>}}
 */
export function planBits(table) {
  const level = table && Number(table.level) ? Number(table.level) : 0;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  const valueIn = (cell, lax) => {
    const read = readBits(cell, { lax });
    return read && read.value !== null ? read : null;
  };

  let column = -1;
  let lax = false;
  let best = 0;
  for (let c = 0; c < table.columns.length; c++) {
    const strict = table.rows.filter((row) => valueIn(row[c], false)).length;
    if (!strict) continue;
    const strictRatio = strict / table.rows.length;
    const ratio = strictRatio >= COL_MIN_PARSE_RATIO ? strictRatio : table.rows.filter((row) => valueIn(row[c], true)).length / table.rows.length;
    if (ratio < COL_MIN_PARSE_RATIO) continue;
    const score = ratio + (strictRatio >= COL_MIN_PARSE_RATIO ? 0.01 : 0);
    if (score > best) {
      best = score;
      column = c;
      lax = strictRatio < COL_MIN_PARSE_RATIO;
    }
  }
  if (column === -1) return null;

  const comparatorOf = (row) => {
    const withOp = [];
    const plain = [];
    for (let c = 0; c < table.columns.length; c++) {
      if (c === column) continue;
      const read = readBits(row[c]);
      if (!read || !read.result) continue;
      (/[&|^]|<<|>>/.test(strip(row[c])) ? withOp : plain).push(read.result);
    }
    return withOp[0] || plain[0] || null;
  };

  const frames = [];
  let previous = null;
  let width = 0;
  for (let i = 0; i < table.rows.length; i++) {
    const written = valueIn(table.rows[i][column], lax);
    const value = written ? written.value : previous;
    const stated = written ? written.result : null;
    const comparator = stated || comparatorOf(table.rows[i]) || previous;
    width = Math.max(width, value ? value.length : 0, comparator ? comparator.length : 0);
    frames.push({
      n: i,
      value: value || '',
      comparator: comparator || null,
      tested: value && comparator ? lowestBit(value, comparator) : -1,
      ones: 0,
      source: written ? 'cell' : 'carried',
    });
    if (written) previous = written.value;
  }
  if (width > CELL_CAP || !width) return null;

  // Pad once every word is known, so the digits sit under the same column at every step.
  for (const frame of frames) {
    frame.value = frame.value ? pad(frame.value, width) : '';
    frame.ones = popcount(frame.value);
  }

  return { preset: 'bits', level, column, label: table.columns[column], width, steps: frames.length, frames };
}

/* ------------------------------------------------------------------ *
 * Choosing
 * ------------------------------------------------------------------ */

/**
 * The preset that should animate a table, or null when none of the four owns it.
 *
 * Null means "row 22 already has this one" — the caller leaves the `array` player alone rather
 * than replacing it, so a plain array table is untouched by this module.
 *
 * Thin tables are claimed exactly as row 22 claims them. `THIN_ROW_LIMIT` is row 21's marker for
 * the 27 thin tables across 23 guides and row 29's repair threshold, not a render gate, and a
 * preset that refused them while the array primitive played them would be inconsistent for no
 * gain.
 *
 * @param {{columns?: string[], rows?: string[][]}|null} table a `parseGuide` entry
 * @returns {null|{preset: string, plan: object}}
 */
export function pickPreset(table) {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return null;
  for (const name of PRESETS) {
    if (name === 'array') break;
    const plan = PLANNERS[name](table);
    if (plan) return { preset: name, plan };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Rendering — everything below needs a document
 * ------------------------------------------------------------------ */

/** Milliseconds between autoplay steps. Row 22's number, because it is the same transport. */
const PLAY_MS = 900;

/** Matches the rendered heading `### Step-by-Step Dry Run (Visual Trace)` produces. */
const DRY_RUN_HEADING = /^Step-by-Step Dry Run/;

/* Row 22 keeps the icons private. They are three SVG constants; if row 22 ever exports them,
 * delete the copies here rather than growing a second spelling of a play button. */
const ICON_PREV =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 18l-6-6 6-6"/><path d="M6 5v14"/></svg>';
const ICON_NEXT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l6 6-6 6"/><path d="M18 5v14"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>';

const plain = (s) => String(s == null ? '' : s).replace(/[`*]/g, '').trim();

function reducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** The guide markdown for the open article, or '' when the bundle is not loaded. */
function guideMarkdown(id) {
  const data = window.CURRICULUM_DATA;
  if (!Array.isArray(data)) return '';
  for (const cat of data) {
    if (!cat || !Array.isArray(cat.items)) continue;
    for (const item of cat.items) if (item && item.id === id) return String(item.content || '');
  }
  return '';
}

/** Axis and unknown cells borrow the stylesheet's own tokens rather than a second palette. */
const AXIS_CELL = 'color:var(--muted);background:transparent;border-color:transparent;';

function el(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A `.viz-cell` that never carries a value: the grid's own row/column header. */
function axisCell(node, text) {
  node.className = 'viz-cell';
  node.setAttribute('data-axis', '');
  node.style.cssText = AXIS_CELL;
  node.textContent = text;
  return node;
}

/** One readout line under a stage: a label, then what is happening, then the details. */
function readout(items) {
  const line = document.createDocumentFragment();
  for (const item of items) {
    line.appendChild(el('span', item.kind === 'label' ? 'viz-row-label' : item.kind === 'live' ? 'viz-k' : 'viz-pair', item.text));
    if (item.kind === 'live') line.appendChild(el('span', 'viz-arrow', '→'));
  }
  return line;
}

/** Fill a stage's cells only when the count moved, so a step reads as a change, not a redraw. */
function fill(grid, count) {
  if (grid.childElementCount !== count) {
    grid.textContent = '';
    for (let i = 0; i < count; i++) grid.appendChild(el('div', 'viz-cell'));
    grid.style.setProperty('--viz-cols', String(count));
  }
  return grid;
}

/** Set a cell's text only when it differs, so the DOM churn matches what the reader sees. */
const setText = (node, text) => {
  if (node.textContent !== text) node.textContent = text;
};

/* ------------------------------------------------------------------ *
 * One stage per preset
 * ------------------------------------------------------------------ */

/**
 * Build the stage a preset draws into: row 22's own array box, so the four presets and the
 * `array` primitive are the same object wearing a different picture.
 *
 * Every stage is `{el, paint(step)}`, and `paint` touches only the DOM it owns — which is what
 * lets the same function serve an adopted player (row 22's transport calls it) and a player
 * this module built.
 *
 * @param {string} preset one of the four names
 * @param {object} plan its plan
 * @returns {{el: HTMLElement, paint: (step: number) => void}}
 */
function buildStage(preset, plan) {
  const stage = el('div', 'viz-array dr-array');
  stage.setAttribute('data-preset-stage', preset);
  const grid = el('div', 'viz-grid');
  const row = el('div', 'viz-row');
  stage.appendChild(grid);
  stage.appendChild(row);
  const pop = (cell, on) => cell.classList.toggle('dr-pop', on && !reducedMotion());
  const frameAt = (step) => plan.frames[Math.max(0, Math.min(step, plan.frames.length - 1))];

  /* stack — top of the stack is the top row, because that is what the reader looks at. */
  if (preset === 'stack') {
    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        const items = frame.items;
        fill(grid, items.length + 1);
        // One column, so the entries stack DOWN: the depth marker is the first row and index 0 —
        // the bottom of the stack — is the last. `--viz-cols` is set by `fill` to the child
        // count, so it is corrected here rather than by changing `fill` for every preset.
        grid.style.setProperty('--viz-cols', '1');
        grid.children[0].className = 'viz-pointer';
        setText(grid.children[0], items.length ? `depth ${items.length - 1}` : 'empty');
        for (let i = 0; i < items.length; i++) {
          const cell = grid.children[items.length - i];
          setText(cell, items[i]);
          const moved = frame.moved.indexOf(i) !== -1;
          cell.classList.toggle('is-active', moved);
          pop(cell, moved);
        }
        row.textContent = '';
        row.appendChild(readout([{ kind: 'label', text: 'stack' }, { kind: 'live', text: frame.op }]));
        for (const index of frame.moved) {
          row.appendChild(el('span', 'viz-pair', items[index] === undefined ? `entry ${index} left` : items[index]));
        }
        if (frame.source === 'carried') row.appendChild(el('span', 'viz-arrow', 'carried forward — this row writes no stack'));
      },
    };
  }

  /* matrix — one extra grid column for row headers and one extra row for column headers. */
  if (preset === 'matrix') {
    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        const rows = frame.rows;
        const height = rows.length;
        const width = height ? rows[0].length : 0;
        fill(grid, (width + 1) * (height + 1));
        grid.style.setProperty('--viz-cols', String(width + 1));
        axisCell(grid.children[0], '');
        for (let c = 0; c < width; c++) axisCell(grid.children[c + 1], `c${c}`);
        for (let r = 0; r < height; r++) {
          axisCell(grid.children[(r + 1) * (width + 1)], `r${r}`);
          for (let c = 0; c < width; c++) {
            const cell = grid.children[(r + 1) * (width + 1) + 1 + c];
            setText(cell, rows[r][c]);
            const changed = frame.changed.some((pair) => pair[0] === r && pair[1] === c);
            const at = !!frame.at && frame.at[0] === r && frame.at[1] === c;
            cell.classList.toggle('is-active', changed);
            cell.classList.toggle('is-swapped', at && !changed);
            if (at) cell.setAttribute('data-at', `${r},${c}`);
            else cell.removeAttribute('data-at');
            pop(cell, changed);
          }
        }
        row.textContent = '';
        row.appendChild(readout([{ kind: 'label', text: 'grid' }, { kind: 'live', text: `${height}×${width}` }]));
        if (frame.at) row.appendChild(el('span', 'viz-pair', `addressed (${frame.at[0]}, ${frame.at[1]})`));
        row.appendChild(el('span', 'viz-pair', `${frame.changed.length} written`));
      },
    };
  }

  /* window — the whole array, membership by colour, and the arithmetic in words. */
  if (preset === 'window') {
    // Unlike every other preset, this one has to show the WHOLE array: the lesson is which part
    // of it the window covers, and half an array is not a window. The stylesheet's track sizing
    // is `minmax(34px, min(108px, 21vw))`, which overflows six cells on a 412px phone and puts
    // the right-hand bound off screen — so the tracks are `minmax(28px, 1fr)` here and the stage
    // takes the article's width. At 28px per cell the floor keeps every value legible, and an
    // array too long even for that overflows into the box's own scroller, which is what
    // `.viz-array`'s `overflow-x` is already there for.
    stage.style.width = '100%';
    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        fill(grid, plan.base.length);
        grid.style.minWidth = '0';
        grid.style.gridTemplateColumns = `repeat(${plan.base.length}, minmax(28px, 1fr))`;
        for (let i = 0; i < plan.base.length; i++) {
          const cell = grid.children[i];
          const inside = frame.lo !== null && i >= frame.lo && i <= frame.hi;
          const own = inside && i - frame.lo < frame.items.length ? frame.items[i - frame.lo] : plan.base[i];
          setText(cell, own === undefined ? '·' : own);
          cell.classList.toggle('is-active', inside);
          cell.classList.toggle('is-done', !inside);
          cell.classList.toggle('is-error', plan.conflicts.indexOf(i) !== -1);
          cell.setAttribute('data-index', String(i));
          pop(cell, frame.entered.indexOf(i) !== -1 || frame.departed.indexOf(i) !== -1);
        }
        row.textContent = '';
        row.appendChild(readout([
          { kind: 'label', text: 'window' },
          { kind: 'live', text: frame.lo === null ? '—' : `${frame.lo}…${frame.hi}` },
        ]));
        row.appendChild(el('span', 'viz-pair', `size ${frame.size}`));
        for (const index of frame.entered) row.appendChild(el('span', 'viz-pair', `+${index}`));
        for (const index of frame.departed) row.appendChild(el('span', 'viz-pair', `−${index}`));
        if (plan.conflicts.length) {
          row.appendChild(el('span', 'viz-arrow', `${plan.conflicts.length} cell(s) the guide states two ways — marked`));
        }
        if (frame.source === 'carried') row.appendChild(el('span', 'viz-arrow', 'carried forward — this row states no window'));
      },
    };
  }

  /* bits — most significant digit leftmost, the tested bit lit. */
  return {
    el: stage,
    paint(step) {
      const frame = frameAt(step);
      fill(grid, plan.width);
      for (let i = 0; i < plan.width; i++) {
        const cell = grid.children[i];
        setText(cell, frame.value[i] || '·');
        // Cell i is the digit for bit `width - 1 - i`, counting from the right.
        const tested = frame.tested === plan.width - 1 - i;
        cell.classList.toggle('is-active', tested);
        if (tested) cell.setAttribute('data-bit', String(plan.width - 1 - i));
        else cell.removeAttribute('data-bit');
        pop(cell, tested);
      }
      row.textContent = '';
      row.appendChild(readout([{ kind: 'label', text: 'bits' }, { kind: 'live', text: frame.value || '—' }]));
      row.appendChild(el('span', 'viz-pair', frame.tested === -1 ? 'no bit under test' : `bit ${frame.tested} under test`));
      row.appendChild(el('span', 'viz-pair', `${frame.ones} set`));
      if (frame.source === 'carried') row.appendChild(el('span', 'viz-arrow', 'carried forward — this row writes no word'));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Two ways to own a player
 * ------------------------------------------------------------------ */

/** Row 22 inserts its player after the `.table-scroll` wrapper when the table has one. */
function hostOf(table) {
  return table.parentElement && table.parentElement.classList.contains('table-scroll') ? table.parentElement : table;
}

/**
 * Take over a player row 22 already mounted: swap its stage, retitle it, follow its step.
 *
 * The controls, the scrubber, the clamping, the autoplay, the table-row marker and `data-step`
 * all stay row 22's. This module observes that one attribute and redraws — which is why a preset
 * cannot drift from the transport's behaviour: there is only one transport.
 *
 * @param {HTMLElement} player row 22's `.dr-player`
 * @param {string} preset
 * @param {object} plan a `pickPreset` plan
 * @returns {HTMLElement} the same player
 */
function adoptPlayer(player, preset, plan) {
  player.setAttribute('data-preset', preset);
  player.setAttribute('data-chrome', 'adopted');
  const title = player.querySelector('.dr-title');
  if (title) title.textContent = `Level ${plan.level || '—'} · ${preset}`;
  const label = player.querySelector('.dr-col');
  if (label) label.textContent = plain(plan.label);

  const stage = buildStage(preset, plan);
  const old = player.querySelector('.viz-array');
  if (old) old.replaceWith(stage.el);
  else player.insertBefore(stage.el, player.querySelector('.dr-bar'));

  const paint = () => stage.paint(Number(player.getAttribute('data-step')) || 0);
  paint();
  new MutationObserver(paint).observe(player, { attributes: true, attributeFilter: ['data-step'] });
  return player;
}

/**
 * Build a player for a table row 22 SKIPPED, emitting row 22's exact DOM contract.
 *
 * This exists only because `docs/dryrun/index.js` does not export `buildPlayer`; that file is
 * row 22's committed deliverable and this row does not edit it. Same classes, same SVG icons,
 * same `PLAY_MS`, same `data-step`, same `data-dryrun-current` marking on the table row. When
 * row 22 exports `buildPlayer` this function deletes itself and every preset keeps working,
 * because {@link adoptPlayer} already proved the two interchangeable.
 *
 * @param {{preset: string, plan: object}} picked
 * @param {HTMLTableElement} table
 * @returns {HTMLElement}
 */
function buildPresetPlayer(picked, table) {
  const plan = picked.plan;
  const player = el('div', 'dr-player');
  player.setAttribute('data-dryrun-player', '');
  player.setAttribute('data-level', String(plan.level || 0));
  player.setAttribute('data-steps', String(plan.steps));
  player.setAttribute('data-preset', picked.preset);
  player.setAttribute('data-chrome', 'own');

  const head = el('div', 'dr-head');
  head.appendChild(el('span', 'dr-title', `Level ${plan.level || '—'} · ${picked.preset}`));
  head.appendChild(el('span', 'dr-col', plain(plan.label)));
  player.appendChild(head);
  const stage = buildStage(picked.preset, plan);
  player.appendChild(stage.el);
  const bar = el('div', 'dr-bar');
  bar.innerHTML =
    `<button type="button" class="dr-btn" data-act="prev" aria-label="Previous step">${ICON_PREV}</button>` +
    `<button type="button" class="dr-btn" data-act="play" aria-label="Play the dry run" aria-pressed="false">${ICON_PLAY}</button>` +
    `<button type="button" class="dr-btn" data-act="next" aria-label="Next step">${ICON_NEXT}</button>` +
    `<input type="range" class="dr-range" min="0" max="${plan.steps - 1}" step="1" value="0" aria-label="Jump to step">`;
  const count = el('span', 'dr-count', `1 / ${plan.steps}`);
  count.setAttribute('data-count', '');
  count.setAttribute('aria-live', 'polite');
  bar.appendChild(count);
  player.appendChild(bar);

  const range = bar.querySelector('.dr-range');
  const rows = table.tBodies[0] ? Array.from(table.tBodies[0].rows) : [];
  let step = 0;
  let timer = null;

  const stop = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const paint = () => {
    stage.paint(step);
    count.textContent = `${step + 1} / ${plan.steps}`;
    range.value = String(step);
    player.setAttribute('data-step', String(step));
    bar.querySelector('[data-act="prev"]').disabled = step === 0;
    bar.querySelector('[data-act="next"]').disabled = step === plan.steps - 1;
    rows.forEach((row, i) => {
      if (i === step) row.setAttribute('data-dryrun-current', '');
      else row.removeAttribute('data-dryrun-current');
    });
  };

  const goto = (next) => {
    step = clampStep(next, plan.steps);
    paint();
  };

  player.addEventListener('click', (event) => {
    const button = event.target.closest('[data-act]');
    if (!button || button.disabled) return;
    const act = button.getAttribute('data-act');
    if (act === 'prev') {
      stop();
      goto(stepFrame(plan, step, -1));
    } else if (act === 'next') {
      stop();
      goto(stepFrame(plan, step, 1));
    } else {
      const on = button.getAttribute('aria-pressed') === 'true';
      stop();
      button.setAttribute('aria-pressed', on ? 'false' : 'true');
      button.setAttribute('aria-label', on ? 'Play the dry run' : 'Pause the dry run');
      button.innerHTML = on ? ICON_PLAY : ICON_PAUSE;
      if (on) return;
      if (step >= plan.steps - 1) goto(0);
      const tick = () => {
        if (step >= plan.steps - 1) {
          button.setAttribute('aria-pressed', 'false');
          button.setAttribute('aria-label', 'Play the dry run');
          button.innerHTML = ICON_PLAY;
          return;
        }
        goto(step + 1);
        timer = setTimeout(tick, PLAY_MS);
      };
      timer = setTimeout(tick, PLAY_MS);
    }
  });
  range.addEventListener('input', () => {
    stop();
    goto(Number(range.value));
  });

  paint();
  return player;
}

/* ------------------------------------------------------------------ *
 * Mounting
 * ------------------------------------------------------------------ */

/**
 * Put the right preset under every dry-run table of `root` that one of the four claims.
 *
 * Paired with `parseGuide`'s output by document order, exactly as row 22 pairs its tables: both
 * count the same `### Step-by-Step Dry Run` headings in the same sequence. A table no preset
 * claims is left entirely alone — row 22's `array` player, or its `data-dryrun="skipped"` marker,
 * stays exactly as it was.
 *
 * @param {HTMLElement} root the article container
 * @param {string} markdown the open guide's markdown
 * @returns {{tables: number, mounted: number, adopted: number, presets: Record<string, number>}}
 */
export function mountPresets(root, markdown) {
  const result = { tables: 0, mounted: 0, adopted: 0, presets: {} };
  if (!root || typeof root.querySelectorAll !== 'function') return result;

  const tables = parseGuide(String(markdown || ''));
  let index = -1;
  let pending = false;

  for (const node of root.querySelectorAll('h3, table')) {
    if (node.tagName === 'H3') {
      if (DRY_RUN_HEADING.test(node.textContent || '')) {
        index++;
        pending = true;
      }
      continue;
    }
    // Only the FIRST table under a dry-run heading is that heading's table, which is what
    // `parseGuide` scans for; every table after it belongs to somebody else.
    if (!pending) continue;
    pending = false;

    const picked = pickPreset(tables[index]);
    result.tables++;
    if (!picked) continue;

    node.removeAttribute('data-dryrun-current');
    const next = hostOf(node).nextElementSibling;
    const existing = next && next.getAttribute && next.hasAttribute('data-dryrun-player') && !next.hasAttribute('data-preset') ? next : null;
    if (existing) {
      adoptPlayer(existing, picked.preset, picked.plan);
      result.adopted++;
    } else {
      hostOf(node).insertAdjacentElement('afterend', buildPresetPlayer(picked, node));
    }
    node.setAttribute('data-dryrun', 'playing');
    result.mounted++;
    result.presets[picked.preset] = (result.presets[picked.preset] || 0) + 1;
  }
  return result;
}

/** Mount for the guide named by the URL hash, or the home view (nothing to mount). */
function mountOpen() {
  const root = document.getElementById('articleContent');
  if (!root) return;
  const id = (location.hash || '').replace(/^#/, '');
  if (!id) return;
  mountPresets(root, guideMarkdown(id));
}

/**
 * Subscribe once, on the seam `docs/dryrun/index.js` already uses.
 *
 * `import` of that module runs its `boot()` first, whatever order two script tags are in: ES
 * modules evaluate a module's dependencies before the importer, and there is only one instance
 * of it. So row 22's players are always on the page before these presets look for them, which is
 * what makes {@link adoptPlayer} reliable rather than racy. The explicit initial mount is for
 * the same reason row 22 has one — the portal's inline script opens the hash article before any
 * deferred module runs.
 */
function boot() {
  document.addEventListener('lt150:article', mountOpen);
  mountOpen();
}

if (typeof document !== 'undefined') boot();