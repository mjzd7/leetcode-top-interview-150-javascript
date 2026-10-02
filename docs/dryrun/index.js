/**
 * The `array` primitive and its table player (row 22).
 *
 * One ES module, imported once next to the table parser, adding no global (plan G4).
 * It mounts a stepper under EVERY `### Step-by-Step Dry Run` table of the open guide —
 * all three levels, per plan §9 decision 2 — and each stepper animates the array state
 * that table's rows actually record.
 *
 * ── Where the data comes from ────────────────────────────────────────────────
 * `docs/dryrun/table.js` is the only markdown-table parser in the page and stays the
 * only one. This module reads the guide's markdown out of `window.CURRICULUM_DATA`
 * (the bundle `scripts/build-site.mjs` already ships, already frontmatter-stripped),
 * hands it to `parseGuide`, and pairs the result with the rendered DOM by document
 * order — both walk the same headings in the same sequence, so the n-th dry-run
 * heading on the page is the n-th entry parseGuide returns.
 *
 * ── What a stepper shows ────────────────────────────────────────────────────
 * A dry-run table's array state lives in ONE column, written as a literal:
 * `` `[0, 1, 3, 2, 3, 0, 4, 2]` `` under a header like `` `nums` State ``. That
 * column is the whole animation. Cells that changed since the previous step light up,
 * so the reader sees the swap rather than reading a table sideways.
 *
 * ── ponytail: drives off authored table rows only ───────────────────────────
 * There is no trace replay here. Every frame is a row a human wrote, so the player
 * shows what the guide claims, at the granularity the guide claims it; it cannot show
 * a step the table never had, and a row whose array is written in prose carries the
 * previous array forward rather than guessing a new one. Real execution is rows 15
 * and 25 (`docs/traces/*.json`), and the upgrade path is one seam: buildFrames()
 * already takes `{level, columns, rows}`, so a trace adapter that produces that shape
 * replaces this file's reading of the table and nothing else. Raise ARRAY_CELL_CAP
 * when a preset (row 23's matrix/graph codecs) needs a wider array than 64.
 */
import { parseGuide, THIN_ROW_LIMIT } from './table.js';

/* ------------------------------------------------------------------ *
 * Pure logic — no DOM, no globals, importable from Node
 * ------------------------------------------------------------------ */

/** Reason codes, so a caller never string-matches a sentence. */
export const PLAN = {
  THIN_ROW_LIMIT,
  NO_TABLE: 'no-table',
  NO_COLUMN: 'no-array-column',
};

/**
 * Fraction of a column's rows that must hold a literal array before the column is
 * treated as the state column.
 *
 * Not unanimity: 50 of the 101 rows that a strict rule would reject are prose restating
 * the array, and requiring every row to parse would drop those tables over one word.
 * Not much lower either — the columns around it are scalars, and 0.6 is where the two
 * populations separate cleanly across all 447 tables that have columns.
 */
export const COL_MIN_PARSE_RATIO = 0.6;

/**
 * Rows that must hold an array of at least two cells before the column counts.
 *
 * Two, because a one-cell read is almost always a scalar wearing brackets — `Output
 * Accumulator` = `` `(`` ``, `Bursts All?` = `3, 4`. A state column that shows one
 * element on two rows has no state to animate.
 *
 * Applied as `min(COL_MIN_ROWS, rows.length)`, so a one-row table is judged on its one
 * row rather than being unreachable by construction. All 8 one-row tables in the corpus
 * have scalar columns and stay unplayable either way; the difference is that a genuine
 * single-step trace stays reachable for a guide that authors one.
 */
export const COL_MIN_ROWS = 2;

/**
 * Refuse a cell longer than this. Measured across the whole corpus the widest array
 * state is 9 cells; 64 is headroom for row 23's matrix codec, not a target.
 */
export const ARRAY_CELL_CAP = 64;

/**
 * A cell that is not a plain array literal. Backtick, equals, math delimiters, braces,
 * pipes, brackets and arrows inside a value all mean the cell is describing a write, a
 * map, a nested matrix, a before→after rewrite or an index expression rather than
 * recording one array.
 */
const VALUE_GUARD = /[`=$<>{}()\\|[\]→]/;

/**
 * Strip the authored layer — surrounding emphasis, whitespace — and require the cell
 * to BE an array literal rather than to contain one.
 *
 * That containment test is the whole module's correctness story. A greedy first-`[` to
 * last-`]` match accepts `` `nums[0]=nums[2]` `` (reading `[0]=nums[2]`), `Return
 * `[0, 1]` `` and a `Matrix State` column of nested rows. Measured over the 450
 * tables: the greedy match makes 101 tables "playable" and 50 of those render garbage;
 * requiring the cell to start and end with a bracket yields 51, every one of them real.
 *
 * @param {string} cell one verbatim cell from `parseGuide`
 * @returns {string[]|null} the elements verbatim, or null when this is not one literal
 */
export function readArray(cell) {
  if (typeof cell !== 'string') return null;
  const body = cell.trim().replace(/^[`~* ]+/, '').replace(/[`~* ]+$/, '');
  if (body.charAt(0) !== '[' || body.charAt(body.length - 1) !== ']') return null;

  const inner = body.slice(1, -1).trim();
  if (!inner) return [];
  if (inner.includes('=>')) return null; // a Map state; row 23's preset, not this one

  const items = inner.split(',').map((v) => v.trim());
  if (items.length > ARRAY_CELL_CAP) return null;
  if (items.some((v) => !v || VALUE_GUARD.test(v))) return null;
  return items;
}

/**
 * The one column of a table worth animating, or -1.
 *
 * Scored, not guessed from the header: a header called `nums[i]` is a value column and
 * a header called `State` may be an array, a map or a sentence, so the rows decide.
 *
 * @param {string[]} columns headers, verbatim
 * @param {string[][]} rows data rows, verbatim
 * @returns {number} column index, or -1 when no column holds an array state
 */
export function pickArrayColumn(columns, rows) {
  if (!Array.isArray(columns) || !columns.length) return -1;
  if (!Array.isArray(rows) || !rows.length) return -1;

  let best = -1;
  let bestRatio = 0;
  for (let c = 0; c < columns.length; c++) {
    const parsed = rows.filter((row) => readArray(row && row[c]) !== null).length;
    const ratio = parsed / rows.length;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = c;
    }
  }
  if (best === -1 || bestRatio < COL_MIN_PARSE_RATIO) return -1;

  const wide = rows.filter((row) => {
    const a = readArray(row && row[best]);
    return a !== null && a.length >= 2;
  }).length;
  return wide >= Math.min(COL_MIN_ROWS, rows.length) ? best : -1;
}

/**
 * Hold a step index inside `[0, count - 1]`, whatever it was handed.
 *
 * @param {number} index requested step
 * @param {number} count number of steps
 * @returns {number} a step that exists
 */
export function clampStep(index, count) {
  const last = Math.max(0, Math.floor(Number(count)) - 1);
  const n = Math.floor(Number(index));
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return n > last ? last : n;
}

/**
 * Turn one parsed dry-run table into one frame per data row.
 *
 * Each frame carries the array as of that step, or — when the row states it in prose
 * instead of writing it — the last array actually recorded, tagged `carried` so the
 * renderer (and any later row-31 audit) can tell a remembered state from a written one.
 * Step 0 highlights nothing: there is no previous step to have changed from.
 *
 * @param {{level?: number, columns: string[], rows: string[][]}} table a `parseGuide` entry
 * @returns {{
 *   playable: boolean, reason: string|null, level: number, column: number,
 *   label: string, steps: number, frames: Array<{n: number, cells: string[], changed: number[], source: 'cell'|'carried'}>,
 * }}
 */
export function buildFrames(table) {
  const level = table && Number(table.level) ? Number(table.level) : 0;
  const fail = (reason) => ({ playable: false, reason, level, column: -1, label: '', steps: 0, frames: [] });

  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) return fail(PLAN.NO_TABLE);
  if (!Array.isArray(table.columns) || table.columns.length === 0) return fail(PLAN.NO_COLUMN);

  const column = pickArrayColumn(table.columns, table.rows);
  if (column === -1) return fail(PLAN.NO_COLUMN);

  const frames = [];
  let previous = null;
  for (let i = 0; i < table.rows.length; i++) {
    const written = readArray(table.rows[i][column]);
    const cells = written !== null ? written : previous;
    const changed = [];
    if (previous !== null && cells !== null) {
      for (let k = 0; k < cells.length; k++) {
        if (k >= previous.length || previous[k] !== cells[k]) changed.push(k);
      }
    }
    frames.push({ n: i, cells: cells || [], changed, source: written !== null ? 'cell' : 'carried' });
    if (written !== null) previous = written;
  }

  return {
    playable: true,
    reason: null,
    level,
    column,
    label: table.columns[column],
    steps: frames.length,
    frames,
  };
}

/**
 * The frame one control press lands on. A delta, so step-forward, step-back and
 * jump-to-step are the same call with a different delta.
 *
 * @param {{frames: unknown[]}} plan a `buildFrames` result
 * @param {number} current the step the player is on
 * @param {number} delta +1 forward, -1 back, anything else to jump
 * @returns {number} a step that exists
 */
export function stepFrame(plan, current, delta) {
  const count = plan && Array.isArray(plan.frames) ? plan.frames.length : 0;
  return clampStep(clampStep(current, count) + delta, count);
}

/* ------------------------------------------------------------------ *
 * Rendering — everything below needs a document
 * ------------------------------------------------------------------ */

/** Milliseconds between autoplay steps. Long enough to read a row. */
const PLAY_MS = 900;

/** Matches the rendered heading `### Step-by-Step Dry Run (Visual Trace)` produces. */
const DRY_RUN_HEADING = /^Step-by-Step Dry Run/;

/** Icons are SVG rather than glyphs, matching `docs/chat-widget.js`. */
const ICON_PREV =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 18l-6-6 6-6"/><path d="M6 5v14"/></svg>';
const ICON_NEXT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l6 6-6 6"/><path d="M18 5v14"/></svg>';
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5.5" width="3.4" height="13" rx="1"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1"/></svg>';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The header is authored markdown, but a label is a label: backticks off, no HTML. */
const plain = (s) => esc(String(s == null ? '' : s).replace(/[`*]/g, '').trim());

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

/* ------------------------------------------------------------------ *
 * One stepper
 * ------------------------------------------------------------------ */

/**
 * Build the DOM for one playable table and wire its controls.
 *
 * The array is drawn with the portal's own `.viz-*` classes — the same boxes the chat
 * widget uses for an array, from the same stylesheet (docs/index.html) — so this adds
 * chrome but no second design system. Every value goes in through `textContent`:
 * there is no markdown here, so KaTeX has nothing to double-render and no cell can be
 * escaped wrong.
 *
 * @param {ReturnType<typeof buildFrames>} plan
 * @param {HTMLTableElement} table the live table this player sits under
 * @returns {HTMLElement}
 */
function buildPlayer(plan, table) {
  const root = document.createElement('div');
  root.className = 'dr-player';
  root.setAttribute('data-dryrun-player', '');
  root.setAttribute('data-level', String(plan.level || 0));
  root.setAttribute('data-steps', String(plan.steps));

  root.innerHTML =
    `<div class="dr-head"><span class="dr-title">Level ${plan.level || '—'} · array</span>` +
    `<span class="dr-col">${plain(plan.label)}</span></div>` +
    '<div class="viz-array dr-array"><div class="viz-grid"></div></div>' +
    '<div class="dr-bar">' +
    `<button type="button" class="dr-btn" data-act="prev" aria-label="Previous step">${ICON_PREV}</button>` +
    `<button type="button" class="dr-btn" data-act="play" aria-label="Play the dry run" aria-pressed="false">${ICON_PLAY}</button>` +
    `<button type="button" class="dr-btn" data-act="next" aria-label="Next step">${ICON_NEXT}</button>` +
    `<input type="range" class="dr-range" min="0" max="${plan.steps - 1}" step="1" value="0" aria-label="Jump to step">` +
    `<span class="dr-count" data-count aria-live="polite">1 / ${plan.steps}</span>` +
    '</div>';

  const grid = root.querySelector('.viz-grid');
  const count = root.querySelector('[data-count]');
  const range = root.querySelector('.dr-range');
  const rows = table.tBodies[0] ? Array.from(table.tBodies[0].rows) : [];
  let step = 0;
  let timer = null;

  const stop = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const paint = () => {
    const frame = plan.frames[step];
    const cells = frame.cells;

    // Rebuild only when the length moved; otherwise update in place so the change is a
    // change rather than a teardown.
    if (grid.childElementCount !== cells.length) {
      grid.textContent = '';
      for (let i = 0; i < cells.length; i++) {
        const cell = document.createElement('div');
        cell.className = 'viz-cell';
        grid.appendChild(cell);
      }
      grid.style.setProperty('--viz-cols', String(cells.length));
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = grid.children[i];
      if (cell.textContent !== cells[i]) cell.textContent = cells[i];
      const moved = frame.changed.indexOf(i) !== -1;
      cell.classList.toggle('is-active', moved);
      cell.classList.toggle('dr-pop', moved && !reducedMotion());
    }

    count.textContent = `${step + 1} / ${plan.steps}`;
    range.value = String(step);
    root.setAttribute('data-step', String(step));
    root.querySelector('[data-act="prev"]').disabled = step === 0;
    root.querySelector('[data-act="next"]').disabled = step === plan.steps - 1;

    // The row the animation is showing, marked on the table it came from. This is the
    // link between the picture and the row of numbers above it.
    rows.forEach((row, i) => {
      if (i === step) row.setAttribute('data-dryrun-current', '');
      else row.removeAttribute('data-dryrun-current');
    });
  };

  const goto = (next) => {
    step = clampStep(next, plan.steps);
    paint();
  };

  const play = (button) => {
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
  };

  root.addEventListener('click', (event) => {
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
      play(button);
    }
  });
  range.addEventListener('input', () => {
    stop();
    goto(Number(range.value));
  });

  paint();
  return root;
}

/* ------------------------------------------------------------------ *
 * Mounting
 * ------------------------------------------------------------------ */

/**
 * Put a stepper under every dry-run table of `root` that has an array to animate.
 *
 * Tables are paired with `parseGuide`'s output by document order: both count the same
 * `### Step-by-Step Dry Run` headings in the same sequence, so walking the rendered
 * headings and tables together cannot drift. A table with no array column is marked
 * `data-dryrun="skipped"` and left exactly as the portal rendered it — an empty box
 * under 345 of the 450 tables would be noise, and a wrong one would be a lie.
 *
 * @param {HTMLElement} root the article container
 * @param {string} markdown the open guide's markdown
 * @returns {{mounted: number, skipped: number, tables: number}}
 */
export function mountPlayers(root, markdown) {
  const result = { mounted: 0, skipped: 0, tables: 0 };
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
    // Only the FIRST table under a dry-run heading is that heading's table, which is
    // what `parseGuide` scans for. Every table after the last heading — the edge-case
    // matrix, the follow-up tables — is somebody else's, and marking or animating those
    // is how one guide ends up with four steppers.
    if (!pending) continue;
    pending = false;
    const plan = buildFrames(tables[index]);
    result.tables++;
    node.removeAttribute('data-dryrun-current');

    if (!plan.playable) {
      node.setAttribute('data-dryrun', 'skipped');
      result.skipped++;
      continue;
    }
    const host = node.parentElement && node.parentElement.classList.contains('table-scroll')
      ? node.parentElement
      : node;
    const player = buildPlayer(plan, node);
    host.insertAdjacentElement('afterend', player);
    node.setAttribute('data-dryrun', 'playing');
    result.mounted++;
  }
  return result;
}

/** Mount for the guide named by the URL hash, or the home view (nothing to mount). */
function mountOpen() {
  const root = document.getElementById('articleContent');
  if (!root) return;
  const id = (location.hash || '').replace(/^#/, '');
  if (!id) return;
  mountPlayers(root, guideMarkdown(id));
}

/**
 * Subscribe once.
 *
 * The portal dispatches `lt150:article` at the end of every `openArticle`, which is the
 * seam `docs/chat-widget.js` already uses — coupling to it costs nothing and means this
 * module never has to be told when the article changes. The initial mount is explicit
 * because the portal's inline script opens the hash article before any deferred module
 * runs, so that first event has already gone by.
 */
function boot() {
  document.addEventListener('lt150:article', mountOpen);
  mountOpen();
}

if (typeof document !== 'undefined') boot();