/**
 * Tier-1 dry-run table player (row 21).
 *
 * Every guide's `### Step-by-Step Dry Run` markdown table becomes data a stepper
 * can drive: step rows in document order, the column headers, and the row count.
 * Reads a guide's markdown as a string and touches nothing else — no fs, no
 * `node:` imports, no top-level effects, no globals beyond these exports — so
 * the portal can `import` it once next to the stepper (plan G4) and a build step
 * can drive the same code in Node.
 *
 * Cells come back VERBATIM: backticks, `$…$` math, `\|` and `**bold**` survive
 * intact, so a cell can be handed straight to the portal's existing
 * marked → Prism → KaTeX pass. Nothing here assumes a cell is plain text.
 *
 *   const [l1, l2, l3] = parseGuide(guideMarkdown);        // document order
 *   parseGuide(item.content)[0].rows[2][4];                // one cell
 *   findThinTables(parseAll([{ path, content }]));        // row 29's worklist
 *
 * Predicate provenance: `scripts/audit-curriculum.mjs` counts these same tables
 * and owns the corpus numbers, but its `dryRunTables()` is not exported and its
 * module imports `fs` at the top level (audit-curriculum.mjs:14), which a
 * browser module cannot take. So the *selection* predicates are repeated here
 * textually, each tagged with its source line — one definition of "a dry-run
 * table", two runtimes. What is new here is what the audit never needed: cells,
 * headers and the owning level.
 *
 * ponytail: a line scanner, not a markdown parser. It splits cells on `|`
 * outside backtick spans and honours `\|`, and it does nothing else — a bare `|`
 * inside `$…$` math would mis-split (none in the corpus), short rows are kept
 * short rather than padded (3 of 1 814 data rows are), and a table further than
 * SCAN_LINES from its heading is treated as absent, which is the audit's own
 * window rather than a real search.
 */

/** Row count below which a table is too thin to step through. */
export const THIN_ROW_LIMIT = 3;

// audit-curriculum.mjs:138-139 — the row/separator test, verbatim.
const isRow = (l) => l !== undefined && /^\s*\|.*\|\s*$/.test(l);
const isSepRow = (l) => l !== undefined && /^\s*\|[\s:|-]+\|\s*$/.test(l);

// audit-curriculum.mjs:53 — also the K7 block-selection heading, which is how a
// table learns which level it belongs to.
const LEVEL_HEADING = /^(#{1,6})\s+(\d+)\.\s+Level\s+([123])\b/;
// audit-curriculum.mjs:149 — prefix match: guides suffix the heading with
// "(Visual Trace)" in 291 of 450 tables.
const DRY_RUN_HEADING = /^###\s+Step-by-Step Dry Run/;
// audit-curriculum.mjs:151 — how far past the heading the table may sit (guides
// put a one-line input recap in between).
const SCAN_LINES = 40;
// audit-curriculum.mjs:157 — stop at the next section; there is no table there.
const SECTION_BREAK = /^#{2,3}\s/;

/**
 * Split one `| a | b |` row into its cells, trimmed at the edges only.
 *
 * A pipe ends a cell only when it is unescaped and outside a code span, which is
 * what keeps `| `1 \| 2 = 3` |` a single cell instead of three, and
 * `| `|lo|=1, |hi|=0` |` a single cell too.
 *
 * @param {string} line one markdown table row
 * @returns {string[]} cells, verbatim
 */
function splitRow(line) {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const cells = [];
  let cell = '';
  let fence = ''; // the currently open backtick run; '' means outside code
  for (let i = 0; i < body.length; ) {
    if (body.startsWith('\\|', i)) {
      cell += '\\|';
      i += 2;
      continue;
    }
    if (body[i] === '`') {
      let run = 1;
      while (body[i + run] === '`') run++;
      const ticks = '`'.repeat(run);
      if (fence === '') fence = ticks;
      else if (fence === ticks) fence = '';
      cell += ticks;
      i += run;
      continue;
    }
    if (body[i] === '|' && fence === '') {
      cells.push(cell.trim());
      cell = '';
      i++;
      continue;
    }
    cell += body[i++];
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Every dry-run table in one guide, in document order — three per guide, so
 * `tables[n]` is level `n + 1` today.
 *
 * @param {string} content full guide markdown
 * @returns {Array<{
 *   path: string|null, level: 1|2|3|0, heading: string, line: number,
 *   columns: string[], rows: string[][], rowCount: number,
 * }>}
 *   `level` is 0 if no `## N. Level X` heading preceded the table; `path` is
 *   null here and stamped by {@link parseAll}; `line` is 1-based within the
 *   string passed in (the portal's markdown, with any frontmatter already
 *   stripped, so it is not always the file's own line number); a heading with no
 *   table under it yields `columns: []` and `rows: []` — 3 such guides today,
 *   and they are exactly the tables row 29 has to repair.
 */
export function parseGuide(content) {
  const lines = content.split('\n');
  const tables = [];
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(LEVEL_HEADING);
    if (head) level = Number(head[3]);
    if (!DRY_RUN_HEADING.test(lines[i])) continue;

    let columns = [];
    const rows = [];
    for (let j = i + 1; j < lines.length && j < i + SCAN_LINES; j++) {
      if (isRow(lines[j]) && isSepRow(lines[j + 1])) {
        columns = splitRow(lines[j]);
        for (let k = j + 2; k < lines.length && isRow(lines[k]); k++) rows.push(splitRow(lines[k]));
        break;
      }
      if (SECTION_BREAK.test(lines[j])) break;
    }
    tables.push({ path: null, level, heading: lines[i].trim(), line: i + 1, columns, rows, rowCount: rows.length });
  }
  return tables;
}

/**
 * {@link parseGuide} over many guides, each table stamped with its owning path.
 * This is the thin-table report's input: the path and level row 29 needs to
 * repair a table it never loaded.
 *
 * @param {Array<{path: string, content: string}>} guides
 * @returns {ReturnType<typeof parseGuide>}
 */
export function parseAll(guides) {
  const out = [];
  for (const guide of guides) {
    for (const table of parseGuide(guide.content)) out.push({ ...table, path: guide.path });
  }
  return out;
}

/**
 * Tables too thin to animate — fewer than {@link THIN_ROW_LIMIT} data rows.
 *
 * Measured against `scripts/audit-curriculum.mjs` (row 0): 27 tables across 23
 * of the 150 guides, identical path/line/row-count for every one. That
 * agreement is the check that keeps this module from becoming a third way of
 * counting tables.
 *
 * @param {ReturnType<typeof parseAll>} tables
 * @returns {typeof tables} the thin subset, input order preserved
 */
export function findThinTables(tables) {
  return tables.filter((table) => table.rowCount < THIN_ROW_LIMIT);
}