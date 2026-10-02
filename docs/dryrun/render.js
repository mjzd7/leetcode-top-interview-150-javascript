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

/* ================================================================== *
 * Tier 2 — the canonical-level presets and the two overlays (row 24)
 * ================================================================== */

/**
 * The level Tier 2 animates, and nothing else.
 *
 * Plan §9 decision 2, verbatim: "all three for Tier 1, **canonical level only for
 * Tier 2**". Tier 1's four presets are about a SHAPE (a stack is LIFO whatever the level
 * says), so mounting them at L1 shows the same lesson a beginner already has. Tier 2's four
 * are about a DATA STRUCTURE the canonical solution is built on — a linked list, a tree, a
 * graph, an object's field-state — and the brute-force and optimized levels do not carry that
 * structure at all. So the level is the gate, checked before the readers run, and every
 * planner below returns `null` on anything that is not level 3.
 *
 * The gate lives here rather than in `mountPresets` so the pure planners carry it with them:
 * a planner called from Node, from a future trace adapter, or from the Playwright spec, is
 * gated identically to the one the portal calls.
 */
export const TIER2_LEVEL = 3;

/**
 * Tier 2's four presets, in the order they outrank one another.
 *
 * `graph` first because it is the only one whose structure is not derivable from the rows'
 * order — nodes and edges need union-find. `tree` next: a level-order wire is a shape, but
 * the parent/child edges inside it are the lesson. `statecard` before `linkedlist` because a
 * state column also parses as a chain of values (`[10, 30]`) and only the op column beside
 * it says which reading is right. `array` (row 22) stays last, in `PRESETS`.
 */
export const TIER2_PRESETS = ['graph', 'tree', 'statecard', 'linkedlist'];

/**
 * The two overlays, which are NOT presets and do not compete for a table.
 *
 * `dp-table` and `recursion-tree` add a second panel to a player that already exists — they
 * have no stage of their own and they never take a table away from a preset. `pickOverlays`
 * is a separate pass over the same rows for exactly that reason: a DP guide that also recurses
 * gets both panels, and `pickPreset` still answers `null` if nothing else claims it.
 */
export const OVERLAYS = ['dp-table', 'recursion-tree'];

/** One planner per Tier-2 preset name, and one per overlay name. */
const TIER2_PLANNERS = {};
const OVERLAY_PLANNERS = {};

/** A bare identifier: a node name, a key, a field label. Digits may follow the first letter (`1a`). */
const NAME = /^[A-Za-z_][\w']*$/;

/** Strip the authored layer and drop backticks — a chain node and a read value are both labels. */
const bare = (s) => String(s == null ? '' : s).replace(/[`*]/g, '').trim();

/** `1a`, `…`, `∞`, `2.5`, `H` — everything a `next` chain may hold as one node. */
const CHAIN_TOKEN = /^-?\d+(?:\.\d+)?$|^[A-Za-z_0-9][\w.]*$|^∞$|^(…|\.\.\.)$/;

/** The tokens that end a chain, when a guide writes one. */
const TERMINATOR = /^(null|nil|none|∅|ø)$/i;

/** The level a table belongs to, or 0 when it is not the canonical one. */
const tier2 = (table) => (table && Number(table.level) === TIER2_LEVEL ? TIER2_LEVEL : 0);

/* ------------------------------------------------------------------ *
 * linkedlist — nodes joined by `next`
 * ------------------------------------------------------------------ */

/** One authored chain into `{values, terminated, unreachable}`, or null when it is not one. */
function chainOf(tokens) {
  const clean = tokens.map((t) => t.trim()).filter((t) => t !== '');
  if (!clean.length) return null;
  const stop = clean.findIndex((t) => TERMINATOR.test(t));
  return {
    values: stop === -1 ? clean : clean.slice(0, stop),
    terminated: stop !== -1,
    unreachable: stop === -1 ? [] : clean.slice(stop + 1),
  };
}

/**
 * The `next` chain one cell states, or null.
 *
 * Two authored spellings, because the corpus uses both: the linked form
 * (`` `2 -> null` ``, `` `... -> 1b` ``) and the value form (`` `[1, 2, null, 5, 6]` ``).
 *
 * A `null` is a TERMINATOR, not a gap, and everything written past it is reported in
 * `unreachable` rather than dropped. That is the `list` codec's own rule —
 * `api/_lib/codecs.mjs:184`, "a decode stops at the first null cell" — so the preset and
 * the thing that will eventually drive it agree about where a chain ends. The empty list is
 * zero nodes with `terminated: true`, which is why `null`, `∅`, `[]` and `—` all read.
 *
 * Refused: a set literal (`seen = {3,2,0}` has no `next`), two bracket groups joined by `+`
 * (two lists, not one chain), and anything without an arrow or a bracket.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {null|{values: string[], terminated: boolean, unreachable: string[]}}
 */
export function readChain(cell) {
  const b = math(strip(cell));
  if (!b) return null;
  if (/^(—|-|∅|ø|null|nil|none|empty)$/i.test(b)) return { values: [], terminated: true, unreachable: [] };

  const pairs = bracketPairs(b);
  if (pairs && pairs.length) {
    if (pairs.length !== 1 || pairs[0][0] !== 0 || pairs[0][1] !== b.length - 1) return null;
    const inner = b.slice(1, -1).trim();
    if (!inner) return { values: [], terminated: true, unreachable: [] };
    const items = splitTop(inner);
    if (items.length > CELL_CAP || items.some((item) => !CHAIN_TOKEN.test(item.trim()))) return null;
    return chainOf(items);
  }

  if (!/->|→/.test(b)) return null;
  const tokens = b.split(/\s*(?:->|→)\s*/);
  if (tokens.some((token) => !CHAIN_TOKEN.test(token.trim()))) return null;
  return chainOf(tokens);
}

/**
 * What one step did to a chain, from two consecutive states.
 *
 * `push` is a node added at the HEAD (the previous chain is still a suffix), `pop` is a node
 * lost from it, and anything else that differs is a `rewrite` — named, not drawn as a push,
 * because calling a rewire a push is the lie this preset exists to avoid. Unchanged is
 * `same`, and a row that wrote no chain is `carried`.
 *
 * @param {string[]|null} previous null on step 0
 * @param {string[]} next
 * @returns {{op: string, moved: number[]}}
 */
export function chainOp(previous, next) {
  if (!previous) return { op: 'start', moved: [] };
  if (previous.length === next.length && previous.every((v, i) => v === next[i])) return { op: 'same', moved: [] };
  const tail = next.slice(next.length - previous.length);
  if (next.length > previous.length && tail.every((v, i) => v === previous[i])) {
    return { op: 'push', moved: span(0, next.length - previous.length - 1) };
  }
  if (next.length < previous.length && previous.slice(previous.length - next.length).every((v, i) => v === next[i])) {
    return { op: 'pop', moved: span(next.length, previous.length - 1) };
  }
  return { op: 'rewrite', moved: next.map((_, i) => i).filter((i) => previous[i] !== next[i]) };
}

/**
 * One playable chain table, or null.
 *
 * Claims a column when either half of the evidence holds: at least `COL_MIN_PARSE_RATIO` of
 * its rows parse AND at least that many wrote an explicit `next` arrow (the linked spelling,
 * which is proof the author meant a chain), or they parse and its HEADER names a list
 * (`list`, `chain`, `node`, `next`, `link`, `order`). Both halves are needed, because
 * `In-Place State` on 08-linked-list/11-lru-cache.md holds `[H,2,1,T]` — which parses as a
 * four-node chain and is in fact a doubly-linked list with two sentinels. That table belongs
 * to `statecard`, which can see the `put(1,1)` beside it; a chain cannot.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, column: number, label: string, steps: number,
 *   frames: Array<{n: number, values: string[], terminated: boolean, unreachable: string[],
 *     op: string, moved: number[], source: string}>}}
 */
export function planLinkedList(table) {
  const level = tier2(table);
  if (!level) return null;
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let column = -1;
  let best = 0;
  for (let c = 0; c < table.columns.length; c++) {
    const parsed = table.rows.map((row) => readChain(row[c]));
    const ratio = parsed.filter(Boolean).length / table.rows.length;
    if (ratio < COL_MIN_PARSE_RATIO) continue;
    const arrows = table.rows.filter((row) => /->|→/.test(math(strip(row[c])))).length / table.rows.length;
    const named = /list|chain|node|next|link|order/i.test(table.columns[c]) ? 1 : 0;
    if (arrows < COL_MIN_PARSE_RATIO && !named) continue;
    if (ratio > best) {
      best = ratio;
      column = c;
    }
  }
  if (column === -1) return null;

  const frames = [];
  let previous = null;
  for (let i = 0; i < table.rows.length; i++) {
    const written = readChain(table.rows[i][column]);
    const values = written ? written.values : previous || [];
    const move = written ? chainOp(previous, values) : { op: 'carried', moved: [] };
    frames.push({
      n: i,
      values,
      terminated: written ? written.terminated : true,
      unreachable: written ? written.unreachable : [],
      op: move.op,
      moved: move.moved,
      source: written ? 'cell' : 'carried',
    });
    if (written) previous = values;
  }
  return { preset: 'linkedlist', level, column, label: table.columns[column], steps: frames.length, frames };
}

TIER2_PLANNERS.linkedlist = planLinkedList;

/* ------------------------------------------------------------------ *
 * tree — a level order is not a tree until the edges are drawn
 * ------------------------------------------------------------------ */

/**
 * The levels of a level-order tree, or null when the cell is not one.
 *
 * The corpus writes a tree the way its BFS walks it — as nested levels, `out = [[3],[20,9]]` —
 * which is also the `tree` codec's wire (`api/_lib/codecs.mjs:68`). One rule separates a tree
 * from the other nested arrays: **every level but the last must be full**. A binary tree's
 * level `d` holds 2^d slots, so `[[3],[9,20]]` is a tree, `[[1,3],[6,9]]` is a rectangle — which
 * is the one shape `matrix` already owns and the reason `insert-interval`'s `result` state is
 * not claimed here — and `[[3],[20,9],[15,7]]` is a tree whose last level is half empty,
 * which is the shape the level-order guides actually write.
 *
 * A single level parses: it is what step 0 of a growing tree says, and `planTree` separately
 * requires one row that opens a second level, so a table of `[[3]]` is still not a tree.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {null|{levels: string[][]}}
 */
export function readTreeWire(cell) {
  const b = math(strip(cell));
  const start = b.indexOf('[');
  const end = b.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  const body = b.slice(start, end + 1);
  const pairs = bracketPairs(body);
  const outer = pairs && pairs.find((pair) => pair[0] === 0);
  // A tree is written in LEVELS, so the cell must hold groups inside the outermost brackets.
  // One flat group is an array, and `matrix`/`array` own those.
  const nested = outer ? pairs.filter((pair) => pair[0] > 0 && pair[1] < outer[1]) : [];
  if (!nested.length || nested.length > CELL_CAP) return null;
  const levels = [];
  for (const [from, to] of nested) {
    const row = rowOf(body.slice(from, to + 1));
    if (row === null || !row.length) return null;
    levels.push(row);
  }
  for (let d = 0; d < levels.length - 1; d++) if (levels[d].length !== 2 ** d) return null;
  return { levels };
}

/**
 * Lay a level-order wire out as a tree: a parent for every node, and the edges between them.
 *
 * The layout is the wire's own, which is what makes the edges correct rather than guessed:
 * index `i`'s parent is `(i - 1) / 2`, its depth is `floor(log2(i + 1))`, and its slot inside
 * its level is `i - 2^depth + 1`. An absent child is `null` on the wire and gets `present:
 * false` — it is a hole, and no edge is emitted to it. This is `treeToArray`'s BFS inverted
 * one-for-one (`api/_lib/codecs.mjs:82`), so the tree drawn here is the tree the codec holds.
 *
 * @param {Array<string|null>} wire level-order values, `null` for an absent node
 * @returns {null|{height: number, width: number,
 *   nodes: Array<{i: number, value: string|null, depth: number, parent: number|null, present: boolean}>,
 *   edges: Array<[number, number]>}}
 */
export function treeLayout(wire) {
  if (!Array.isArray(wire) || !wire.length || wire.length > CELL_CAP) return null;
  const nodes = wire.map((value, i) => ({
    i,
    value: value == null ? null : String(value),
    depth: i === 0 ? 0 : Math.floor(Math.log2(i + 1)),
    parent: i === 0 ? null : Math.floor((i - 1) / 2),
    present: value != null,
  }));
  const edges = [];
  for (const node of nodes) {
    if (node.parent !== null && node.present && nodes[node.parent].present) edges.push([node.parent, node.i]);
  }
  return {
    height: Math.max(...nodes.map((n) => n.depth)) + 1,
    width: 2 ** Math.max(...nodes.map((n) => n.depth)),
    nodes,
    edges,
  };
}

/**
 * One playable tree table, or null.
 *
 * Claims a column at least `COL_MIN_PARSE_RATIO` of whose rows are levels of a level-order,
 * and requires one of them to open a second level. Frame `n` draws the tree as the guide had
 * written it by step `n`, and `added` names the nodes that step introduced — so the animation
 * is a tree gaining nodes, which is the thing a flat row of cells cannot show.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, column: number, label: string, steps: number,
 *   frames: Array<{n: number, levels: string[][], layout: object, added: number[], source: string}>}}
 */
export function planTree(table) {
  const level = tier2(table);
  if (!level) return null;
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let column = -1;
  let best = 0;
  for (let c = 0; c < table.columns.length; c++) {
    const parsed = table.rows.map((row) => readTreeWire(row[c]));
    const ratio = parsed.filter((tree) => tree && tree.levels.length > 1).length / table.rows.length;
    const anyParsed = parsed.filter(Boolean).length / table.rows.length;
    if (anyParsed < COL_MIN_PARSE_RATIO || !ratio) continue;
    if (anyParsed > best) {
      best = anyParsed;
      column = c;
    }
  }
  if (column === -1) return null;

  const frames = [];
  let previous = null;
  let previousLayout = null;
  for (let i = 0; i < table.rows.length; i++) {
    const written = readTreeWire(table.rows[i][column]);
    const levels = written ? written.levels : previous || [];
    const layout = (written ? treeLayout([].concat(...levels)) : null) || previousLayout;
    const added = layout
      ? layout.nodes.filter((n) => n.present && (!previousLayout || n.i >= previousLayout.nodes.length)).map((n) => n.i)
      : [];
    frames.push({ n: i, levels, layout, added, source: written ? 'cell' : 'carried' });
    if (written) {
      previous = levels;
      previousLayout = layout;
    }
  }
  return { preset: 'tree', level, column, label: table.columns[column], steps: frames.length, frames };
}

TIER2_PLANNERS.tree = planTree;

/* ------------------------------------------------------------------ *
 * graph — nodes, edges, and the components they do not form
 * ------------------------------------------------------------------ */

/** The node set one cell holds, in any of the three spellings the corpus uses. */
function nodeSet(cell) {
  const b = math(String(cell == null ? '' : cell).replace(/[`*]/g, ''))
    .replace(/^\s*(expand|visit|dequeue|pop|founds?|neighbors?\s+of|discovers?)\b[:\s]*/i, '')
    .trim();
  if (!b) return null;
  const group = /^([{[])([^[\]{}]*)([\]}])(?![A-Za-z0-9_'])/.exec(b);
  if (!group) return null;
  const items = splitTop(group[2]).map((t) => t.trim()).filter(Boolean);
  return items.length && items.every((item) => NAME.test(item)) ? items : null;
}

/**
 * The edges one row states: the frontier it expanded times the neighbours it found.
 *
 * The frontier is the FIRST cell that names an expansion — the guide may put it in any column
 * (19-graph-bfs/03-word-ladder.md L3 step 3 has `expand {cog}` in `Pointer R` and the
 * neighbours it found in `Pointer L`, the other way round from every other step) — and the
 * neighbours are every OTHER node set on the row. A cell saying a node is `in endSet` is a
 * terminal, not an edge, and is returned as `terminal` instead.
 *
 * Only a BRACKETED group counts as a neighbour list. A bare word is prose — `unwind` is not
 * a node the guide found — and every authored set in this corpus is braced (`{hot}`,
 * `{dot,lot}`, `{dog,log}`).
 *
 * @param {string[]} cells one row, verbatim
 * @returns {null|{from: string[], to: string[], terminal: string|null}} `to` may be empty, and
 *   `terminal` may be set on a row that adds no edge
 */
export function readEdge(cells) {
  if (!Array.isArray(cells)) return null;
  const clean = cells.map((cell) => math(strip(cell)));

  let terminal = null;
  for (const cell of clean) {
    const isEnd = /in endSet|contact|equals end/i.test(cell);
    if (!isEnd || /neither|\bnot\b/i.test(cell)) continue;
    const node = cell.match(/([A-Za-z_][\w']*)/);
    terminal = node ? node[1] : null;
    break;
  }

  let fromAt = -1;
  const from = [];
  for (let i = 0; i < clean.length; i++) {
    if (!/\b(expand|visit|dequeue|pop|discover)\b/i.test(clean[i])) continue;
    const set = nodeSet(clean[i]);
    if (set && set.length) {
      from.push(...set);
      fromAt = i;
      break;
    }
  }
  if (fromAt === -1) return null;

  const to = [];
  for (let i = 0; i < clean.length; i++) {
    if (i === fromAt) continue;
    if (/in endSet|contact|equals end/i.test(clean[i])) continue;
    const set = nodeSet(clean[i]);
    if (set && set.length) to.push(...set);
  }
  return { from, to, terminal };
}

/**
 * Group nodes into connected components by the edges between them, union-find style.
 *
 * Disconnection is the point. A graph preset that drew one blob for a graph the guide's own
 * edges leave in two pieces would be lying about the data structure it exists to teach, so
 * components are computed rather than assumed, each is sorted, and the list is ordered by
 * smallest member so two runs of the same graph draw the same way. An edge to a node no row
 * mentioned still joins that node — it was discovered by being an endpoint.
 *
 * @param {string[]} nodes
 * @param {Array<[string, string]>} edges
 * @returns {string[][]} components, each sorted, the list sorted by first member
 */
export function graphComponents(nodes, edges) {
  const parent = new Map();
  const find = (x) => {
    let at = x;
    while (parent.get(at) !== at) at = parent.get(at);
    let root = x;
    while (parent.get(root) !== root) {
      const next = parent.get(root);
      parent.set(root, at);
      root = next;
    }
    return at;
  };
  for (const node of nodes || []) parent.set(node, node);
  for (const [a, b] of edges || []) {
    for (const node of [a, b]) if (!parent.has(node)) parent.set(node, node);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const node of parent.keys()) {
    const root = find(node);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(node);
  }
  return [...groups.values()].map((group) => group.sort()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/**
 * One playable graph table, or null.
 *
 * A row that states edges contributes them, and the frame shows every edge found SO FAR — so
 * the graph grows the way a BFS or a union-find discovers it, and `components` is recomputed
 * each step. On 19-graph-bfs/03-word-ladder.md L3 that is the real shape of the guide's own
 * data: after step 3 the edges form two components (`hit—hot—{dot,lot}` and
 * `cog—{dog,log}`) and a renderer that drew one blob would be wrong, not merely untidy.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, label: string, steps: number,
 *   frames: Array<{n: number, nodes: string[], edges: Array<[string, string]>, added: Array<[string, string]>,
 *     components: string[][], terminal: string|null, source: string}>}}
 */
export function planGraph(table) {
  const level = tier2(table);
  if (!level) return null;
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  const read = table.rows.map((row) => readEdge(row));
  if (read.filter(Boolean).length / table.rows.length < COL_MIN_PARSE_RATIO) return null;

  const edges = [];
  const frames = [];
  let terminal = null;
  for (let i = 0; i < table.rows.length; i++) {
    const edge = read[i];
    const added = [];
    if (edge) {
      if (edge.terminal) terminal = edge.terminal;
      for (const from of edge.from) {
        for (const to of edge.to) {
          edges.push([from, to]);
          added.push([from, to]);
        }
      }
    }
    const nodes = [...new Set(edges.flat())].sort();
    frames.push({
      n: i,
      nodes,
      edges: edges.slice(),
      added,
      components: graphComponents(nodes, edges),
      terminal,
      source: edge ? 'cell' : 'carried',
    });
  }
  const label = table.columns.find((name) => /state|graph|edge|neighbor|frontier|queue|adjacen/i.test(name)) || '';
  return { preset: 'graph', level, label, steps: frames.length, frames };
}

TIER2_PLANNERS.graph = planGraph;

/* ------------------------------------------------------------------ *
 * statecard — an object's state after each operation, plus its output
 * ------------------------------------------------------------------ */

/**
 * The operations one cell calls, or null when it calls none.
 *
 * A cell may name more than one (`put(1,1), put(2,2)` on 08-linked-list/11-lru-cache.md L3
 * step 1) and all of them are kept, because two `put`s are two operations and collapsing
 * them into one step would hide the eviction they cause. The names may not be dotted, which
 * is what keeps a statement column (`map.set(10, 0); list.push(10)`) from posing as an op
 * column.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {null|string[]} calls, whitespace collapsed
 */
export function readOp(cell) {
  const b = math(strip(cell));
  if (!b) return null;
  if (!/^[A-Za-z_]\w*\s*\([^()]*\)(\s*,\s*[A-Za-z_]\w*\s*\([^()]*\))*$/.test(b)) return null;
  const calls = b.match(/[A-Za-z_]\w*\s*\([^()]*\)/g);
  return calls ? calls.map((call) => call.replace(/\s+/g, '')) : null;
}

/**
 * The field state one cell holds — the FIRST bracketed group in it — or null.
 *
 * A bracketed group anywhere in the cell counts, because the corpus writes the state and the
 * output in the same cell (`[H,3,1,T]`, `get(2)=-1`) and requiring the group to BE the cell
 * would read exactly the two LRU rows that carry the state. Both `[…]` and `{…}` are read:
 * `ops` snapshots an object's own enumerable fields (`api/_lib/codecs.mjs:223`), and in this
 * corpus that is a list, a stack, a queue and a map.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {null|string} the group, verbatim
 */
export function readState(cell) {
  const b = math(strip(cell));
  const m = /[[{]([^[\]{}]*)[\]}]/.exec(b);
  if (!m || !m[1].trim()) return null;
  return m[0];
}

/**
 * What the row says the operation returned, or null.
 *
 * Read from the STATE columns, never from the prose around them: 11-lru-cache.md L3 step 3
 * writes `Evict tail.prev = 2` in `Invariant Checked` and `get(2)=-1` in the state column,
 * and only the second is what the call returned. The state group is removed first so a cell
 * that is nothing but state has no output to report.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {null|string}
 */
export function readOutput(cell) {
  const b = String(cell == null ? '' : cell)
    .replace(/[`*]/g, '')
    .replace(/[[{][^[\]{}]*[\]}]/, '')
    .replace(/\$/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();
  if (!b) return null;
  return /^(return|returns|yield|yields|median|emit|emits|output|outputs)\b/i.test(b) || /=[^=]/.test(b) ? b : null;
}

/**
 * The state columns a table worth a state card carries, and why the floor is what it is.
 *
 * `COL_MIN_PARSE_RATIO` is the floor for the OP column, which is the table's spine. The state
 * fields use `TIER2_STATE_RATIO` instead, because a state card's whole subject is a field an
 * operation did not touch: on 08-linked-list/11-lru-cache.md L3 the state column is written on
 * 2 of 4 rows, with `Returns 1` and `get(2)=-1` on the rows between. A floor that demanded a
 * written state on most rows would refuse precisely the table a state card exists for.
 */
const TIER2_STATE_RATIO = 0.4;

/**
 * One playable ops table, or null.
 *
 * Claims the op column at row 22's parse ratio, then every state column beside it. Each
 * frame carries the operations that step performed, the value of every field AFTER them, and
 * the output the guide states — so the animation is a state TRANSITION, not the final answer.
 * A field the step did not write is carried forward and tagged `carried`, which is what makes
 * the `ops-terminal-state-and-outputs` equivalence (`api/_lib/codecs.mjs:200`) visible: the
 * outputs are in one place on screen and the state they left behind in another.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{preset: string, level: number, opColumn: number, opLabel: string,
 *   fields: Array<{column: number, label: string}>, steps: number,
 *   frames: Array<{n: number, ops: string[], state: Array<{label: string, value: string|null, source: string}>,
 *     output: string|null, source: string}>}}
 */
export function planStatecard(table) {
  const level = tier2(table);
  if (!level) return null;
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let opColumn = -1;
  let best = 0;
  for (let c = 0; c < table.columns.length; c++) {
    const ratio = table.rows.filter((row) => readOp(row[c])).length / table.rows.length;
    if (ratio >= COL_MIN_PARSE_RATIO && ratio > best) {
      best = ratio;
      opColumn = c;
    }
  }
  if (opColumn === -1) return null;

  const fields = [];
  for (let c = 0; c < table.columns.length; c++) {
    if (c === opColumn || !/state|stack|queue|heap|list|map|tree|set/i.test(table.columns[c])) continue;
    const written = table.rows.map((row) => readState(row[c]));
    const count = written.filter(Boolean).length;
    if (count >= 2 && count / table.rows.length >= TIER2_STATE_RATIO) fields.push({ column: c, label: table.columns[c], written });
  }
  if (!fields.length) return null;

  const carried = fields.map(() => null);
  const frames = [];
  for (let i = 0; i < table.rows.length; i++) {
    const ops = readOp(table.rows[i][opColumn]) || [];
    const state = fields.map((field, k) => {
      const own = field.written[i];
      if (own) carried[k] = own;
      return { label: field.label, value: carried[k], source: own ? 'cell' : 'carried' };
    });
    let output = null;
    for (const field of fields) {
      const found = readOutput(table.rows[i][field.column]);
      if (found) {
        output = found;
        break;
      }
    }
    frames.push({ n: i, ops, state, output, source: ops.length ? 'cell' : 'carried' });
  }

  return {
    preset: 'statecard',
    level,
    opColumn,
    opLabel: table.columns[opColumn],
    fields: fields.map((field) => ({ column: field.column, label: field.label })),
    steps: frames.length,
    frames,
  };
}

TIER2_PLANNERS.statecard = planStatecard;

/* ------------------------------------------------------------------ *
 * dp-table — the overlay
 * ------------------------------------------------------------------ */

/**
 * The cells one step writes into a DP row, or null when it writes none.
 *
 * Three authored spellings, all of which the corpus uses: a whole row from the left edge
 * (`dp = [1,1,1]`, 17-multi-dp/03-unique-paths-ii.md L3 step 1), a range
 * (`dp[6..10] = [2,2,3,3,2]`, 16-one-dp/04-coin-change.md L3 step 2) and a single cell
 * (`Return dp[2] = 2`, unique-paths-ii L3 step 3).
 *
 * A READ is not a write. `min(dp[10],dp[9],dp[6]) + 1` names three cells and assigns none, so
 * it returns null and the frame carries the row forward — which is the honest reading, since a
 * frame that "wrote" the minimum it just read would be showing an arithmetic result as a
 * stored value.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {null|{lo: number, hi: number, values: string[]}}
 */
export function readDpWrite(cell) {
  const b = math(strip(cell));

  const range = /\bdp\s*\[\s*(\d+)\s*(?:\.\.\.?|\\to\b|→)\s*(\d+)\s*\]\s*=\s*\[([^\[\]]*)\]/.exec(b);
  if (range) {
    const values = splitTop(range[3]).map((v) => v.trim()).filter(Boolean);
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (!values.length || hi < lo || hi - lo + 1 !== values.length) return null;
    return { lo, hi, values };
  }

  const whole = /\bdp\s*=\s*\[([^\[\]]*)\]/.exec(b);
  if (whole) {
    const values = splitTop(whole[1]).map((v) => v.trim()).filter(Boolean);
    return values.length ? { lo: 0, hi: values.length - 1, values } : null;
  }

  const one = /\bdp\s*\[\s*(\d+)\s*\]\s*=\s*([^=,;]+)/.exec(b);
  if (one) {
    const at = Number(one[1]);
    const value = bare(one[2]);
    return value ? { lo: at, hi: at, values: [value] } : null;
  }
  return null;
}

/**
 * The DP row this table fills, cell by cell, with the cell each step wrote marked.
 *
 * The overlay — it adds a panel to a player and never takes the table from a preset. Cells
 * keep their position across steps, so a reader sees the same row fill rather than a new row
 * each time, and `changed` is diffed against the previous frame exactly as `planStack` diffs
 * its entries. `cursor` is the FIRST cell the step changed: on step 0 nothing has changed yet,
 * so nothing is marked.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{overlay: string, level: number, column: number, label: string, width: number,
 *   steps: number, frames: Array<{n: number, cells: Array<string|null>, changed: number[],
 *     cursor: number, source: string}>}}
 */
export function planDpTable(table) {
  const level = tier2(table);
  if (!level) return null;
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let column = -1;
  let best = 0;
  for (let c = 0; c < table.columns.length; c++) {
    const written = table.rows.map((row) => readDpWrite(row[c]));
    const count = written.filter(Boolean).length;
    if (count >= 2 && count / table.rows.length >= COL_MIN_PARSE_RATIO && count > best) {
      best = count;
      column = c;
    }
  }
  if (column === -1) return null;

  const frames = [];
  let cells = [];
  let width = 0;
  for (let i = 0; i < table.rows.length; i++) {
    const written = readDpWrite(table.rows[i][column]);
    const changed = [];
    if (written) {
      const at = Math.max(cells.length, written.hi + 1);
      while (cells.length < at) cells.push(null);
      for (let k = 0; k < written.values.length; k++) {
        const index = written.lo + k;
        if (cells[index] !== written.values[k]) {
          cells[index] = written.values[k];
          if (i > 0) changed.push(index);
        }
      }
      width = Math.max(width, at);
    }
    frames.push({
      n: i,
      cells: cells.slice(),
      changed,
      cursor: changed.length ? changed[0] : 0,
      source: written ? 'cell' : 'carried',
    });
  }
  return { overlay: 'dp-table', level, column, label: table.columns[column], width, steps: frames.length, frames };
}

OVERLAY_PLANNERS['dp-table'] = planDpTable;

/* ------------------------------------------------------------------ *
 * recursion-tree — the overlay
 * ------------------------------------------------------------------ */

/**
 * The call one cell names, or null.
 *
 * Refuses an argument that is itself an expression (`max(0, 0+2)` on 16-one-dp/02-house-robber.md
 * L3 is a `max` call, not a recursion the guide is unfolding) and refuses anything with no
 * call at all, so a bottom-up DP table's arithmetic column is not read as a call spine.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {null|{name: string, args: string[]}}
 */
export function readCall(cell) {
  const b = math(strip(cell));
  const m = /^([A-Za-z_]\w*)\s*\(([^()]*)\)$/.exec(b);
  if (!m) return null;
  const args = m[2].split(',').map((arg) => arg.trim()).filter(Boolean);
  if (!args.length || args.some((arg) => /[+\-*/=<>^|&]/.test(arg))) return null;
  return { name: m[1], args };
}

/** A row that returns, unwinds, or pops. */
const RETURNS = /\breturn|unwind|back up|\bup\b/i;
/** A row that opens a nested call: the guide says it recursed, expanded or enqueued. */
const DESCENDS = /\brecurse|descend|expand|enqueue|child|subtree|deeper|dive/i;
/** A row that hit a base case: a leaf, a bottom, an empty child. */
const BASE_CASE = /\blea(f|v)|\bbase\b|\bbottom\b|no children|\bnone\b/i;

/**
 * The recursion this table unfolds: a call spine with a depth, and the base case on it.
 *
 * The depth is the guide's own, not a guess about how deep recursion "usually" goes. A row
 * that names a call and says it recursed pushes one frame onto the spine; a row that names a
 * call and says it is returning has come back up to the nearest open frame, so the call it
 * makes next is that frame's child, at the same depth as the one it replaced; a row that names
 * a call and says neither is a sibling and replaces the top frame. A row with no call is the
 * function returning, and the spine collapses to the root. On 09-binary-tree-general/03-invert-binary-tree.md L3 that is
 * depths 0, 1, 1, 0 with the base case on step 2 — `invert(7)`, which the guide's own
 * `Invariant Checked` cell calls `Leaves swap nulls`.
 *
 * This is the overlay that makes the 102 `selfRecursive` blocks legible: the static region
 * table the player sits under says WHICH block recurses; this says what recursing looks like
 * at that depth, and where it stops.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {null|{overlay: string, level: number, column: number, label: string, height: number,
 *   steps: number, frames: Array<{n: number, call: string|null, depth: number, base: boolean,
 *     spine: Array<string|null>, source: string}>}}
 */
export function planRecursion(table) {
  const level = tier2(table);
  if (!level) return null;
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.rows.length) return null;

  let column = -1;
  let best = 0;
  for (let c = 0; c < table.columns.length; c++) {
    const ratio = table.rows.filter((row) => readCall(row[c])).length / table.rows.length;
    if (ratio >= COL_MIN_PARSE_RATIO && ratio > best) {
      best = ratio;
      column = c;
    }
  }
  if (column === -1) return null;

  const frames = [];
  const spine = [];
  let height = 0;
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const call = readCall(row[column]);
    const prose = row.map((cell) => math(strip(cell))).join(' ');
    let frame;
    if (call) {
      // A returning row has just come back to the frame below, and a descending row opens one
      // deeper. A row that says NEITHER is a sibling call — the ops guides write `insert(10)`
      // then `insert(20)` and nest nothing — so the top frame is replaced rather than pushed.
      // Without that rule four unrelated `insert` calls render as a four-deep recursion.
      const returning = RETURNS.test(prose);
      if (returning) while (spine.length > 1) spine.pop();
      const label = `${call.name}(${call.args.join(',')})`;
      const entry = { call: label, base: BASE_CASE.test(prose) };
      if (!returning && !DESCENDS.test(prose) && spine.length) spine[spine.length - 1] = entry;
      else spine.push(entry);
      frame = { n: i, call: label, depth: spine.length - 1, base: entry.base, spine: [], source: 'cell' };
    } else {
      while (spine.length > 1) spine.pop();
      frame = { n: i, call: null, depth: 0, base: true, spine: [], source: 'carried' };
    }
    height = Math.max(height, spine.length);
    frame.spine = spine.map((entry) => entry.call);
    frames.push(frame);
  }
  return { overlay: 'recursion-tree', level, column, label: table.columns[column], height, steps: frames.length, frames };
}

OVERLAY_PLANNERS['recursion-tree'] = planRecursion;

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
  for (const name of TIER2_PRESETS) {
    const plan = TIER2_PLANNERS[name](table);
    if (plan) return { preset: name, plan };
  }
  for (const name of PRESETS) {
    if (name === 'array') break;
    const plan = PLANNERS[name](table);
    if (plan) return { preset: name, plan };
  }
  return null;
}

/**
 * Every overlay this table earns, in {@link OVERLAYS} order.
 *
 * A separate pass from {@link pickPreset}, on purpose: an overlay ADDS a panel to whatever
 * player is there and never competes for the table, so a canonical-level table whose only
 * shape is a DP row still gets a player — one with no preset stage, which is why
 * `mountPresets` mounts on `picked || overlays.length`.
 *
 * @param {{level?: number, columns?: string[], rows?: string[][]}|null} table a `parseGuide` entry
 * @returns {Array<{overlay: string, plan: object}>}
 */
export function pickOverlays(table) {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return [];
  const out = [];
  for (const name of OVERLAYS) {
    const plan = OVERLAY_PLANNERS[name](table);
    if (plan) out.push({ overlay: name, plan });
  }
  return out;
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The portal's own tokens, read once. Row 23 already borrows them inline (`AXIS_CELL`) rather
 * than adding a stylesheet, and `docs/index.html` is not this row's to edit — so the SVG stages
 * paint themselves from the same values the stylesheet declares.
 */
const INK = {
  line: 'rgba(148, 163, 184, 0.13)',
  lineStrong: 'rgba(148, 163, 184, 0.42)',
  surface: '#121724',
  ink: '#E9EDF4',
  muted: '#8B94A7',
  accent: '#C8FA4B',
  violet: '#8B5CF6',
  rose: '#FB7185',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

/** A flex row that wraps, matching `.viz-row`'s box metrics without the class. */
const FLEX_ROW = 'display:flex;align-items:center;flex-wrap:wrap;gap:.3rem;margin-top:.5rem;';

/** `display:flex` for a vertical stack of labelled lines. */
const STACK = 'display:flex;flex-direction:column;gap:.3rem;margin-bottom:.45rem;';

/** One SVG element with its attributes set. `class` and `transform` are as common as x/y. */
function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
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

  /* ── bits — most significant digit leftmost, the tested bit lit. ────────────── */
  if (preset === 'bits') {
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

  /* ── linkedlist — nodes with a `next`, and a terminator you can see ─────────── */
  if (preset === 'linkedlist') {
    stage.style.width = '100%';
    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        const nodes = frame.values.length + (frame.terminated ? 1 : 0);
        const columns = Math.max(1, nodes * 2 - 1 + frame.unreachable.length * 2);
        fill(grid, columns);
        grid.style.minWidth = '0';
        grid.style.gridTemplateColumns = `repeat(${columns}, minmax(26px, auto))`;
        for (let i = 0; i < columns; i++) {
          const cell = grid.children[i];
          if (i % 2 === 1) {
            cell.className = 'viz-arrow';
            setText(cell, i < columns - 1 ? '→' : '');
            continue;
          }
          const at = i >> 1;
          if (at < frame.values.length) {
            cell.className = 'viz-cell';
            setText(cell, frame.values[at]);
            cell.setAttribute('data-node', String(at));
            cell.removeAttribute('data-terminator');
            const moved = frame.moved.indexOf(at) !== -1;
            cell.classList.toggle('is-active', moved);
            pop(cell, moved);
          } else if (at === frame.values.length && frame.terminated) {
            cell.className = 'viz-cell';
            cell.removeAttribute('data-node');
            cell.setAttribute('data-terminator', '');
            setText(cell, '∅');
          } else {
            cell.className = 'viz-cell is-done';
            cell.removeAttribute('data-node');
            cell.removeAttribute('data-terminator');
            setText(cell, frame.unreachable[at - frame.values.length - (frame.terminated ? 1 : 0)] || '');
          }
        }
        row.textContent = '';
        row.appendChild(readout([
          { kind: 'label', text: 'chain' },
          { kind: 'live', text: `${frame.values.length} node${frame.values.length === 1 ? '' : 's'}` },
        ]));
        row.appendChild(el('span', 'viz-pair', frame.op));
        if (frame.terminated && frame.values.length) row.appendChild(el('span', 'viz-k', 'next = null'));
        if (!frame.values.length) row.appendChild(el('span', 'viz-arrow', 'empty list'));
        if (frame.unreachable.length) {
          row.appendChild(el('span', 'viz-arrow', `${frame.unreachable.join(', ')} written past the terminator — unreachable`));
        }
        if (frame.source === 'carried') row.appendChild(el('span', 'viz-arrow', 'carried forward — this row writes no chain'));
      },
    };
  }

  /* ── tree — nodes, and the parent/child edges a flat list cannot show ───────── */
  if (preset === 'tree') {
    const box = document.createElementNS(SVG_NS, 'svg');
    box.setAttribute('class', 'dr-graph');
    box.setAttribute('role', 'img');
    stage.replaceChild(box, grid);
    const edgeLayer = document.createElementNS(SVG_NS, 'g');
    const nodeLayer = document.createElementNS(SVG_NS, 'g');
    box.appendChild(edgeLayer);
    box.appendChild(nodeLayer);
    const CELL = 30;
    const STEP = 52;
    const PAD = 8;
    const edgeStyle = { stroke: INK.lineStrong, 'stroke-width': 1.25 };
    const slotOf = (node) => node.i - 2 ** node.depth + 1;
    const cx = (node) => PAD + slotOf(node) * STEP + CELL / 2;
    const cy = (node) => PAD + node.depth * STEP + CELL / 2;

    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        const layout = frame.layout;
        edgeLayer.textContent = '';
        nodeLayer.textContent = '';
        if (!layout) {
          row.textContent = '';
          row.appendChild(readout([{ kind: 'label', text: 'tree' }, { kind: 'live', text: '—' }]));
          return;
        }
        const width = PAD * 2 + layout.width * STEP - (STEP - CELL);
        const height = PAD * 2 + layout.height * STEP - (STEP - CELL);
        box.setAttribute('viewBox', `0 0 ${width} ${height}`);
        box.setAttribute('width', String(width));
        box.setAttribute('height', String(height));
        box.style.maxWidth = '100%';

        for (const [from, to] of layout.edges) {
          edgeLayer.appendChild(svgEl('line', {
            x1: cx(layout.nodes[from]),
            y1: cy(layout.nodes[from]),
            x2: cx(layout.nodes[to]),
            y2: cy(layout.nodes[to]),
            ...edgeStyle,
          }));
        }
        for (const node of layout.nodes) {
          if (!node.present) continue;
          const added = frame.added.indexOf(node.i) !== -1;
          const group = svgEl('g');
          group.setAttribute('data-node', String(node.i));
          if (added) group.setAttribute('data-added', '');
          group.appendChild(svgEl('rect', {
            x: cx(node) - CELL / 2,
            y: cy(node) - CELL / 2,
            width: CELL,
            height: CELL,
            rx: 5,
            fill: added ? 'rgba(200, 250, 75, 0.1)' : INK.surface,
            stroke: added ? INK.accent : INK.line,
            'stroke-width': added ? 2 : 1,
          }));
          const text = svgEl('text', {
            x: cx(node),
            y: cy(node),
            'dominant-baseline': 'central',
            'text-anchor': 'middle',
            fill: added ? INK.accent : INK.ink,
            'font-family': INK.mono,
            'font-size': 12,
          });
          text.textContent = node.value;
          group.appendChild(text);
          nodeLayer.appendChild(group);
        }

        row.textContent = '';
        row.appendChild(readout([
          { kind: 'label', text: 'tree' },
          { kind: 'live', text: `${layout.height} level${layout.height === 1 ? '' : 's'}` },
        ]));
        row.appendChild(el('span', 'viz-pair', `${layout.edges.length} edge${layout.edges.length === 1 ? '' : 's'}`));
        row.appendChild(el('span', 'viz-pair', `${layout.nodes.filter((n) => n.present).length} nodes`));
        row.appendChild(el('span', 'viz-pair', `+${frame.added.length} this step`));
        if (frame.source === 'carried') row.appendChild(el('span', 'viz-arrow', 'carried forward — this row writes no level'));
      },
    };
  }

  /* ── graph — nodes and edges, and each component kept apart ────────────────── */
  if (preset === 'graph') {
    const box = document.createElementNS(SVG_NS, 'svg');
    box.setAttribute('class', 'dr-graph');
    box.setAttribute('role', 'img');
    stage.replaceChild(box, grid);
    const edgeLayer = document.createElementNS(SVG_NS, 'g');
    const nodeLayer = document.createElementNS(SVG_NS, 'g');
    box.appendChild(edgeLayer);
    box.appendChild(nodeLayer);
    const R = 9;
    const COL = 74;
    const LINE = 38;
    const PAD = 12;
    const edgeStyle = { stroke: INK.lineStrong, 'stroke-width': 1.25 };

    // Deterministic BFS layout inside each component, one component per band. Correctness of
    // the adjacency is what matters here; the geometry only has to be stable across steps.
    const position = (frame) => {
      const at = new Map();
      const bands = [];
      let y = PAD + R;
      for (const component of frame.components) {
        const depth = new Map([[component[0], 0]]);
        const queue = [component[0]];
        while (queue.length) {
          const node = queue.shift();
          for (const [from, to] of frame.edges) {
            const other = from === node ? to : to === node ? from : null;
            if (other === null || !component.includes(other) || depth.has(other)) continue;
            depth.set(other, depth.get(node) + 1);
            queue.push(other);
          }
        }
        const rows = [];
        for (const node of component) {
          const d = depth.get(node) || 0;
          if (!rows[d]) rows[d] = [];
          rows[d].push(node);
        }
        const widest = Math.max(...rows.map((r) => r.length));
        const startX = PAD + Math.max(0, (widest - component.length) / 2) * COL;
        component.forEach((node) => {
          const d = depth.get(node) || 0;
          const at2 = rows[d];
          at.set(node, { x: startX + at2.indexOf(node) * COL + COL / 2, y: y + d * LINE });
        });
        bands.push({ component, rows: rows.length, y });
        y += (rows.length - 1) * LINE + LINE + 14;
      }
      return { at, height: Math.max(PAD * 2 + R, y) };
    };

    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        edgeLayer.textContent = '';
        nodeLayer.textContent = '';
        const { at, height } = position(frame);
        const width = PAD * 2 + Math.max(1, frame.nodes.length) * COL;
        box.setAttribute('viewBox', `0 0 ${width} ${height}`);
        box.setAttribute('width', String(width));
        box.setAttribute('height', String(height));
        box.style.maxWidth = '100%';

        for (const [from, to] of frame.edges) {
          const a = at.get(from);
          const b = at.get(to);
          if (!a || !b) continue;
          edgeLayer.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...edgeStyle }));
        }
        for (const node of frame.nodes) {
          const point = at.get(node);
          if (!point) continue;
          const terminal = frame.terminal === node;
          const fresh = frame.added.some(([, to]) => to === node);
          const group = svgEl('g', { transform: `translate(${point.x} ${point.y})` });
          group.setAttribute('data-node', node);
          if (fresh) group.setAttribute('data-added', '');
          if (terminal) group.setAttribute('data-terminal', '');
          group.appendChild(svgEl('circle', {
            r: String(R),
            fill: terminal ? 'rgba(200, 250, 75, 0.16)' : INK.surface,
            stroke: terminal ? INK.accent : fresh ? INK.violet : INK.line,
            'stroke-width': terminal || fresh ? 2 : 1,
          }));
          const text = svgEl('text', {
            y: R + 12,
            'text-anchor': 'middle',
            fill: terminal || fresh ? INK.accent : INK.muted,
            'font-family': INK.mono,
            'font-size': 10,
          });
          text.textContent = node;
          group.appendChild(text);
          nodeLayer.appendChild(group);
        }

        row.textContent = '';
        row.appendChild(readout([
          { kind: 'label', text: 'graph' },
          { kind: 'live', text: `${frame.nodes.length} nodes · ${frame.edges.length} edges` },
        ]));
        row.appendChild(el('span', 'viz-pair', `${frame.components.length} component${frame.components.length === 1 ? '' : 's'}`));
        row.appendChild(el('span', 'viz-pair', `+${frame.added.length} this step`));
        if (frame.terminal) row.appendChild(el('span', 'viz-k', `${frame.terminal} reached the target`));
        if (frame.source === 'carried') row.appendChild(el('span', 'viz-arrow', 'carried forward — this row states no edge'));
      },
    };
  }

  /* ── statecard — the ops case: what the object holds AFTER the call ─────────── */
  if (preset === 'statecard') {
    stage.style.width = '100%';
    const fields = el('div', 'dr-fields');
    fields.style.cssText = STACK;
    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        stage.replaceChildren(fields, row);
        row.textContent = '';
        row.appendChild(readout([
          { kind: 'label', text: 'op' },
          { kind: 'live', text: frame.ops.length ? frame.ops.join(', ') : '—' },
        ]));
        if (fields.childElementCount !== frame.state.length) {
          fields.textContent = '';
          for (const _ of frame.state) {
            const line = el('div', 'dr-field');
            line.appendChild(el('span', 'viz-row-label', ''));
            line.appendChild(el('span', 'viz-pair', ''));
            fields.appendChild(line);
          }
        }
        frame.state.forEach((field, i) => {
          const line = fields.children[i];
          const name = line.children[0];
          const value = line.children[1];
          setText(name, plain(field.label));
          setText(value, field.value === null ? '∅' : field.value);
          value.setAttribute('data-field', plain(field.label));
          value.setAttribute('data-source', field.source);
          value.classList.toggle('is-done', field.source === 'carried');
        });
        if (frame.output) {
          const out = el('span', 'viz-k', `→ ${frame.output}`);
          out.setAttribute('data-output', '');
          row.appendChild(out);
        } else {
          row.appendChild(el('span', 'viz-arrow', 'no output on this step'));
        }
      },
    };
  }

  return { el: stage, paint() {} };
}

/* ------------------------------------------------------------------ *
 * The two overlays
 * ------------------------------------------------------------------ */

/**
 * Build the panels an overlay adds: a second stage below the preset's own, following the same
 * step. There is no separate control bar and no second transport — an overlay is a lens on the
 * same authored rows, not another player.
 *
 * @param {Array<{overlay: string, plan: object}>} overlays `pickOverlays`' output
 * @returns {Array<{el: HTMLElement, paint: (step: number) => void}>}
 */
export function buildPanels(overlays) {
  return (overlays || []).map(({ overlay, plan }) => buildOverlay(overlay, plan));
}

function buildOverlay(overlay, plan) {
  const stage = el('div', 'viz-array dr-array');
  stage.setAttribute('data-preset-stage', overlay);
  stage.setAttribute('data-overlay', overlay);
  stage.style.width = '100%';
  const grid = el('div', 'viz-grid');
  const row = el('div', 'viz-row');
  stage.appendChild(grid);
  stage.appendChild(row);
  const frameAt = (step) => plan.frames[Math.max(0, Math.min(step, plan.frames.length - 1))];

  if (overlay === 'dp-table') {
    return {
      el: stage,
      paint(step) {
        const frame = frameAt(step);
        fill(grid, Math.max(plan.width, frame.cells.length, 1));
        grid.style.minWidth = '0';
        grid.style.gridTemplateColumns = `repeat(${grid.childElementCount}, minmax(28px, 1fr))`;
        for (let i = 0; i < grid.childElementCount; i++) {
          const cell = grid.children[i];
          setText(cell, frame.cells[i] === null || frame.cells[i] === undefined ? '·' : frame.cells[i]);
          cell.setAttribute('data-dp', String(i));
          const here = frame.cursor === i;
          cell.classList.toggle('is-active', here);
          cell.classList.toggle('is-done', !here && frame.cells[i] != null);
          if (here) cell.setAttribute('data-cursor', '');
          else cell.removeAttribute('data-cursor');
        }
        row.textContent = '';
        row.appendChild(readout([
          { kind: 'label', text: 'dp' },
          { kind: 'live', text: frame.cursor === null ? '—' : `dp[${frame.cursor}]` },
        ]));
        row.appendChild(el('span', 'viz-pair', `${frame.cells.filter((c) => c != null).length} of ${plan.width} filled`));
        row.appendChild(el('span', 'viz-pair', `${frame.changed.length} written`));
        if (frame.source === 'carried') row.appendChild(el('span', 'viz-arrow', 'carried forward — this row reads, it does not write'));
      },
    };
  }

  // recursion-tree — the call spine, the deepest frame open at the bottom.
  const spine = el('div', 'dr-spine');
  spine.style.cssText = STACK;
  return {
    el: stage,
    paint(step) {
      const frame = frameAt(step);
      if (spine.parentElement !== stage) stage.replaceChildren(spine, row);
      if (spine.childElementCount !== frame.spine.length) {
        spine.textContent = '';
        for (let i = 0; i < frame.spine.length; i++) {
          const line = el('div', 'dr-frame');
          line.appendChild(el('span', 'viz-row-label', ''));
          line.appendChild(el('span', 'viz-arrow', i > 0 ? '↳' : ''));
          line.appendChild(el('span', 'viz-pair', ''));
          line.appendChild(el('span', 'viz-k', ''));
          spine.appendChild(line);
        }
      }
      frame.spine.forEach((call, i) => {
        const line = spine.children[i];
        const deepest = i === frame.spine.length - 1;
        setText(line.children[0], `depth ${i}`);
        const cell = line.children[2];
        setText(cell, call);
        cell.setAttribute('data-call', call);
        cell.classList.toggle('is-active', deepest);
        const badge = line.children[3];
        const base = deepest && frame.base;
        setText(badge, base ? 'base case' : '');
        if (base) badge.setAttribute('data-base', '');
        else badge.removeAttribute('data-base');
      });
      row.textContent = '';
      row.appendChild(readout([
        { kind: 'label', text: 'recursion' },
        { kind: 'live', text: `depth ${frame.depth}` },
      ]));
      row.appendChild(el('span', 'viz-pair', frame.call || 'returning'));
      row.appendChild(el('span', 'viz-pair', `${frame.spine.length} frame${frame.spine.length === 1 ? '' : 's'} open`));
      if (frame.base) row.appendChild(el('span', 'viz-k', 'base case hit'));
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
 * `picked` may be null: a table whose only claim is an overlay keeps row 22's own array stage
 * and gains the overlay panels, because there is no preset picture to swap in and inventing one
 * would be drawing a shape the guide never claimed.
 *
 * @param {HTMLElement} player row 22's `.dr-player`
 * @param {null|{preset: string, plan: object}} picked
 * @param {Array<{overlay: string, plan: object}>} overlays
 * @returns {HTMLElement} the same player
 */
function adoptPlayer(player, picked, overlays) {
  const panels = buildPanels(overlays);
  let stage = null;
  if (picked) {
    player.setAttribute('data-preset', picked.preset);
    const title = player.querySelector('.dr-title');
    if (title) title.textContent = `Level ${picked.plan.level || '—'} · ${picked.preset}`;
    const label = player.querySelector('.dr-col');
    if (label) label.textContent = plain(picked.plan.label);
    stage = buildStage(picked.preset, picked.plan);
    const old = player.querySelector(':scope > .viz-array');
    if (old) old.replaceWith(stage.el);
    else player.insertBefore(stage.el, player.querySelector('.dr-bar'));
  }
  player.setAttribute('data-chrome', 'adopted');
  if (panels.length) {
    player.setAttribute('data-overlays', panels.map((panel) => panel.el.getAttribute('data-overlay')).join(' '));
    for (const panel of panels) player.insertBefore(panel.el, player.querySelector('.dr-bar'));
  }

  const paint = () => {
    const step = Number(player.getAttribute('data-step')) || 0;
    if (stage) stage.paint(step);
    for (const panel of panels) panel.paint(step);
  };
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
 * @param {null|{preset: string, plan: object}} picked null when only an overlay claims the table
 * @param {Array<{overlay: string, plan: object}>} overlays
 * @param {HTMLTableElement} table
 * @returns {HTMLElement}
 */
function buildPresetPlayer(picked, overlays, table) {
  const plan = picked ? picked.plan : overlays[0].plan;
  const panels = buildPanels(overlays);
  const name = picked ? picked.preset : overlays.map((o) => o.overlay).join(' + ');
  const player = el('div', 'dr-player');
  player.setAttribute('data-dryrun-player', '');
  player.setAttribute('data-level', String(plan.level || 0));
  player.setAttribute('data-steps', String(plan.steps));
  if (picked) player.setAttribute('data-preset', picked.preset);
  if (overlays.length) player.setAttribute('data-overlays', overlays.map((o) => o.overlay).join(' '));
  player.setAttribute('data-chrome', 'own');

  const head = el('div', 'dr-head');
  head.appendChild(el('span', 'dr-title', `Level ${plan.level || '—'} · ${name}`));
  head.appendChild(el('span', 'dr-col', plain(plan.label)));
  player.appendChild(head);
  const stage = picked ? buildStage(picked.preset, plan) : { el: el('div'), paint() {} };
  player.appendChild(stage.el);
  for (const panel of panels) player.appendChild(panel.el);
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
    for (const panel of panels) panel.paint(step);
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
 * Put the right preset, and every overlay, under every dry-run table of `root` that one claims.
 *
 * Paired with `parseGuide`'s output by document order, exactly as row 22 pairs its tables: both
 * count the same `### Step-by-Step Dry Run` headings in the same sequence. A table nothing
 * claims is left entirely alone — row 22's `array` player, or its `data-dryrun="skipped"`
 * marker, stays exactly as it was.
 *
 * Tier 2 mounts on the canonical level only (plan §9 decision 2), which every Tier-2 planner
 * enforces itself, so this function does not repeat the test. What it does add is the overlay
 * pass: a table whose only claim is a `dp-table` or a `recursion-tree` still gets a player,
 * because a panel with no transport to follow is not a panel.
 *
 * @param {HTMLElement} root the article container
 * @param {string} markdown the open guide's markdown
 * @returns {{tables: number, mounted: number, adopted: number, presets: Record<string, number>,
 *   overlays: Record<string, number>}}
 */
export function mountPresets(root, markdown) {
  const result = { tables: 0, mounted: 0, adopted: 0, presets: {}, overlays: {} };
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
    const overlays = pickOverlays(tables[index]);
    result.tables++;
    if (!picked && !overlays.length) continue;

    node.removeAttribute('data-dryrun-current');
    const next = hostOf(node).nextElementSibling;
    const existing = next && next.getAttribute && next.hasAttribute('data-dryrun-player') && !next.hasAttribute('data-preset') ? next : null;
    if (existing) {
      adoptPlayer(existing, picked, overlays);
      result.adopted++;
    } else {
      hostOf(node).insertAdjacentElement('afterend', buildPresetPlayer(picked, overlays, node));
    }
    node.setAttribute('data-dryrun', 'playing');
    result.mounted++;
    const names = picked ? [picked.preset, ...overlays.map((o) => o.overlay)] : overlays.map((o) => o.overlay);
    for (const name of names) result.presets[name] = (result.presets[name] || 0) + 1;
    for (const { overlay } of overlays) result.overlays[overlay] = (result.overlays[overlay] || 0) + 1;
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