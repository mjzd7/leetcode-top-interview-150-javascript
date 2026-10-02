/**
 * Curriculum audit — row 0 / G2.
 *
 * The single source for every count the docs quote. Read-only: it never writes a
 * file, never runs `npm run build`, never touches `docs/`, `build/`,
 * `test-results/` or git. `DRY_RUN_ENGINE_PLAN_v5.md` §1 is a claim; this script
 * is the measurement.
 *
 *   node scripts/audit-curriculum.mjs            report (exits 0, even on drift)
 *   node scripts/audit-curriculum.mjs --check    structural self-check (exits 1 on failure)
 *   node scripts/audit-curriculum.mjs --json     machine-readable, incl. thinTables
 *   node scripts/audit-curriculum.mjs --scores   per-guide guide-quality score (row 0b, gates nothing)
 *   node scripts/audit-curriculum.mjs --strict   exit 1 if any asserted number drifted
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

// Mirrors the `SKIP_DIRS` / `SKIP_FILES` / `SKIP_INDEX_PARENTS` sets in
// validate-guide.mjs and test-runner.mjs verbatim. Copy, not an import:
// validate-guide.mjs does not export them and row 2 owns that file. If one
// script's idea of "a guide" moves, all three move together. Cited by symbol, not
// by line — the validator's line numbers shift as rows land.
//
// `docs` is the portal, not the curriculum: page sources and generated bundles live
// there. It used to need no entry because every markdown file in it was excluded by
// name (`00-INDEX.md`, `_TEMPLATE-subpage.md`, `00-IA-PLAN.md` via the PLAN rule) —
// so the walk passed by luck. Row 0b added `docs/rubrics/guide-quality.md`, a real
// document that is not a guide, and the luck ran out: 151 guides, 4 bogus errors.
// Name the directory instead of relying on every future file happening to match a
// skip pattern.
const SKIP_DIRS = new Set(['00-foundations', '24-maang-guides', 'modern-engineer-skills', 'fresher-roadmap', 'mid-level-roadmap', 'scratch', 'test-results', 'playwright-report', 'docs']);
const SKIP_FILES = new Set(['_TEMPLATE-subpage.md', '00-INDEX.md']);
const SKIP_INDEX_PARENTS = new Set(['modern-engineer-skills', 'fresher-roadmap', 'mid-level-roadmap']);

/**
 * PINNED PREDICATE (K7) — row 0 owns this definition. Rows 4, 7 and 21 import it
 * instead of re-inventing it.
 *
 * A **solution block** is the FIRST ` ```javascript ` fence that appears inside
 * each `## 2. Level 1`, `## 3. Level 2`, `## 4. Level 3` H2 heading. The heading
 * is matched by prefix because guides append a parenthetical
 * (`## 3. Level 2: Optimized Approach (Row and Column Marker Arrays)`).
 *
 * Everything else is deliberately NOT a solution block: worked examples in
 * section 1, polyfill/`class` snippets in section 5, and the follow-up
 * extensions in sections 6 and 7. Counting those is what made "every fence" and
 * "450 blocks" look like two different numbers — there is one predicate and it
 * selects one block per level.
 *
 * @param {string} content full guide markdown
 * @returns {{level: 1|2|3, section: number, startLine: number, code: string}[]} document order
 */
export function selectSolutionBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^(#{1,6})\s+(\d+)\.\s+Level\s+([123])\b/);
    if (!head) continue;
    const depth = head[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].match(/^(#{1,6})\s/);
      if (next && next[1].length <= depth) break; // section ends here
      if (/^```javascript/.test(lines[j])) {
        const body = [];
        let k = j + 1;
        while (k < lines.length && !/^```/.test(lines[k])) body.push(lines[k++]);
        blocks.push({ level: Number(head[3]), section: Number(head[2]), startLine: j + 1, code: body.join('\n') });
        break; // first fence in the section only
      }
    }
  }
  return blocks;
}

/** Every ` ```javascript ` fence in a guide, unfiltered. Mirrors test-runner.mjs `extractJsBlocks`. */
export function extractJsBlocks(content) {
  return [...content.matchAll(/```javascript\n([\s\S]*?)```/g)].map((m) => m[1]);
}

/** Line numbers (1-based) of every javascript fence, in document order. */
function jsFenceLines(lines) {
  const out = [];
  lines.forEach((l, i) => {
    if (/^```javascript/.test(l)) out.push(i + 1);
  });
  return out;
}

/** Guides in the curriculum, repo-relative paths, sorted. */
export function listGuides() {
  const files = [];
  (function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts' || SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
      if (entry.name === 'index.md' && SKIP_INDEX_PARENTS.has(path.basename(dir))) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith('.md') && dir !== ROOT_DIR && !entry.name.includes('PLAN') && !entry.name.includes('README')) files.push(path.relative(ROOT_DIR, full));
    }
  })(ROOT_DIR);
  return files.sort();
}

const HEADER_FIELDS = ['**LeetCode Link**', '**Difficulty**', '**Pattern Category**', '**Prerequisite Primer**'];
const ASYNC_GEN = /\basync\b|\bawait\b|function\s*\*|\byield\b/;
// ponytail: strip `//` before the code-only async scan — a comment that says
// "yield" is prose, not a generator, and the plan's 0 is a claim about code.
// Ceiling: no tokenizer, so a token inside a string literal still trips it;
// row 4 replaces this whole predicate with an `sg` rule.
const stripComment = (line) => line.replace(/\/\/.*$/, '');
// Counted per guide, over the guide's javascript fences only — these exist so
// §5's serializer cases have a pinned consumer list, not because prose mentions them.
const FEATURES = {
  randomOrDate: /Math\.random|new Date\b|Date\.now/,
  mapSet: /\bnew (Map|Set|WeakMap|WeakSet)\b/,
  typedArray: /\b(Uint8Array|Int8Array|Uint8ClampedArray|Uint16Array|Int16Array|Uint32Array|Int32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array|ArrayBuffer|DataView)\b/,
  bigIntLiteral: /\bBigInt\b|\d+n\b/,
  evalOrFunction: /\beval\s*\(|new Function\s*\(/,
};

// ponytail: self-recursion is a text heuristic, not a parse — it misses
// `obj.method()` self-calls and counts a stored arrow const as recursive. Ceiling:
// narrow/broad is the honest width of the guess; row 9's acorn walk replaces both.
const FN_DECL = /(?:^|\n)\s*(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^\n]*|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>))/g;

function selfRecursive(code) {
  const narrow = new Set();
  const broad = new Set();
  for (const d of code.matchAll(FN_DECL)) {
    const name = d[1] || d[2];
    if (!name) continue;
    // Search past the declaration itself, or every function "recurses" into its own params.
    const rest = code.slice(d.index + d[0].length);
    if (new RegExp(`(^|[^.\\w$'"\\\`])${name}\\s*\\(`).test(rest)) {
      broad.add(name);
      if (d[1]) narrow.add(name);
    }
  }
  return { narrow, broad };
}

const isSepRow = (l) => l !== undefined && /^\s*\|[\s:|-]+\|\s*$/.test(l);
const isRow = (l) => l !== undefined && /^\s*\|.*\|\s*$/.test(l);

/**
 * Dry-run tables: the first pipe-row + separator pair after the heading. Guides
 * put a one-line input recap between the two, so the table is not the next line.
 * `rows` counts data rows only (header + `| :--- |` separator excluded).
 */
function dryRunTables(lines, file) {
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s+Step-by-Step Dry Run/.test(lines[i])) continue;
    let rows = 0;
    for (let j = i + 1; j < lines.length && j < i + 40; j++) {
      if (isRow(lines[j]) && isSepRow(lines[j + 1])) {
        let k = j + 2;
        while (k < lines.length && isRow(lines[k])) rows++, k++;
        break;
      }
      if (/^#{2,3}\s/.test(lines[j])) break; // next section: no table here
    }
    tables.push({ path: file, section: lines[i].trim(), headingLine: i + 1, rows });
  }
  return tables;
}

/** `RUNTIME_TESTS` entry styles, read from test-runner.mjs source. */
export function readRuntimeTestRegistry() {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'test-runner.mjs'), 'utf-8');
  const marker = 'const RUNTIME_TESTS = ';
  const from = src.indexOf(marker);
  if (from < 0) return { entries: [], fnsAndCases: 0, script: 0, error: 'RUNTIME_TESTS not found' };
  const start = from + marker.length;
  const end = src.indexOf('\n};', start);
  if (end < 0) return { entries: [], fnsAndCases: 0, script: 0, error: 'RUNTIME_TESTS literal end not found' };
  // The literal is plain data (fns/cases arrays + template strings), so evaluating
  // it reads the map without running the runner or re-implementing its parser.
  let table;
  try {
    table = new Function(`return ${src.slice(start, end + 2)}`)();
  } catch (err) {
    return { entries: [], fnsAndCases: 0, script: 0, error: err.message };
  }
  const entries = Object.keys(table);
  return {
    entries,
    fnsAndCases: entries.filter((k) => table[k].fns && table[k].cases).length,
    script: entries.filter((k) => table[k].script).length,
    // Row 2 removed every `fns` key, so this should be 0 forever now. Counted rather than
    // assumed: a re-introduced duplication is exactly the drift this file exists to catch.
    bothFnsAndScript: entries.filter((k) => table[k].fns && table[k].script).length,
    casesOnly: entries.filter((k) => table[k].cases && !table[k].fns && !table[k].script).length,
  };
}

/** Every count this script pins. */
export function measure() {
  const guides = listGuides();
  const out = {
    guides: guides.length,
    unfilteredFences: 0,
    syntaxBlocks: 0,
    solutionBlocks: 0,
    guidesWithThreeSolutions: 0,
    guidesWhereRunnerSliceEqualsK7: 0,
    level3Headings: 0,
    fourFieldHeader: 0,
    dryRunTables: 0,
    thinTableCount: 0,
    emptyTables: 0,
    thinGuides: 0,
    evalOrNewFunction: 0,
    asyncLinesInSolutions: 0,
    asyncLinesInSolutionsCode: 0,
    asyncLinesOutsideSolutions: 0,
    asyncInFollowUpGuides: 0,
    randomOrDateGuides: 0,
    mapSetGuides: 0,
    typedArrayGuides: 0,
    bigIntLiteralGuides: 0,
    selfRecursiveGuides: null,
    avgBytes: 0,
    avgLines: 0,
    totalBytes: 0,
    totalLines: 0,
    runtimeTested: 0,
    syntaxOnly: 0,
    runtimeTestsUnknownPaths: [],
    asyncHitsInSolutions: [],
    thinTables: [],
    thinTableOwners: [],
  };

  const featureHits = Object.fromEntries(Object.keys(FEATURES).map((k) => [k, 0]));
  const recNarrow = new Set();
  const recBroad = new Set();
  const followUpGuides = new Set();
  let bytes = 0;
  let lines = 0;

  for (const file of guides) {
    const content = fs.readFileSync(path.join(ROOT_DIR, file), 'utf-8');
    const L = content.split('\n');
    bytes += Buffer.byteLength(content);
    lines += (content.match(/\n/g) || []).length; // wc -l semantics

    const fences = extractJsBlocks(content);
    const fenceLines = jsFenceLines(L);
    out.unfilteredFences += fences.length;
    // The runner syntax-checks the FIRST THREE fences per guide whatever section
    // they sit in. Printed next to the K7 count so the two 450s never get conflated.
    out.syntaxBlocks += Math.min(3, fences.length);

    const blocks = selectSolutionBlocks(content);
    out.solutionBlocks += blocks.length;
    if (blocks.length === 3) out.guidesWithThreeSolutions++;
    const k7 = blocks.map((b) => b.startLine);
    const slice = fenceLines.slice(0, 3);
    if (k7.length === 3 && k7.every((n, i) => n === slice[i])) out.guidesWhereRunnerSliceEqualsK7++;
    for (const b of blocks) {
      b.code.split('\n').forEach((l, i) => {
        if (!ASYNC_GEN.test(l)) return;
        const isCode = ASYNC_GEN.test(stripComment(l));
        out.asyncLinesInSolutions++;
        out.asyncHitsInSolutions.push({ path: file, line: b.startLine + i + 1, level: b.level, isCode, text: l.trim() });
        if (isCode) out.asyncLinesInSolutionsCode++;
      });
      // Scoped to solution blocks: the region a target function lives in.
      const rec = selfRecursive(b.code);
      if (rec.narrow.size) recNarrow.add(file);
      if (rec.broad.size) recBroad.add(file);
    }

    if (HEADER_FIELDS.every((f) => content.includes(f))) out.fourFieldHeader++;
    out.level3Headings += L.filter((l) => /^(#{1,6})\s+\d+\.\s+Level\s+3\b/.test(l)).length;

    // §6 follow-up region = the `## 6.` heading up to the next `##`/`#`.
    let section = '';
    for (const l of L) {
      const h2 = l.match(/^(#{1,2})\s+(.*)$/);
      if (h2) section = h2[2];
      if (ASYNC_GEN.test(l)) {
        out.asyncLinesOutsideSolutions++;
        if (section.startsWith('6.')) followUpGuides.add(file);
      }
    }

    const js = fences.join('\n');
    for (const [name, re] of Object.entries(FEATURES)) if (re.test(js)) featureHits[name]++;

    const tables = dryRunTables(L, file);
    out.dryRunTables += tables.length;
    const thin = tables.filter((t) => t.rows < 3);
    out.thinTableCount += thin.length;
    out.emptyTables += thin.filter((t) => t.rows === 0).length;
    out.thinTables.push(...thin);
  }

  out.asyncInFollowUpGuides = followUpGuides.size;
  out.thinGuides = new Set(out.thinTables.map((t) => t.path)).size;
  out.thinTableOwners = [...new Set(out.thinTables.map((t) => t.path))].sort().map((p) => ({
    file: p,
    tables: out.thinTables.filter((t) => t.path === p).length,
    rows: out.thinTables.filter((t) => t.path === p).map((t) => t.rows).join(','),
  }));
  out.evalOrNewFunction = featureHits.evalOrFunction;
  out.randomOrDateGuides = featureHits.randomOrDate;
  out.mapSetGuides = featureHits.mapSet;
  out.typedArrayGuides = featureHits.typedArray;
  out.bigIntLiteralGuides = featureHits.bigIntLiteral;
  out.selfRecursiveGuides = [recNarrow.size, recBroad.size];
  out.totalBytes = bytes;
  out.totalLines = lines;
  out.avgBytes = Math.round(bytes / guides.length);
  out.avgLines = Math.round(lines / guides.length);

  const registry = readRuntimeTestRegistry();
  const known = new Set(guides);
  out.runtimeTested = registry.entries.filter((e) => known.has(e)).length;
  out.runtimeTestsUnknownPaths = registry.entries.filter((e) => !known.has(e));
  out.syntaxOnly = out.guides - out.runtimeTested;
  return out;
}

// ---------------------------------------------------------------------------
// Pinned baseline. Every number the plan/README quote, plus the structural
// invariants the counts depend on. `--check` asserts the invariants; the report
// prints claimed-vs-measured so a stale doc is visible, not silently absorbed.
const PINNED = {
  guides: 150,
  runtimeTested: 109,
  syntaxOnly: 41,
  syntaxBlocks: 450,
  solutionBlocks: 450,
  unfilteredFences: 813,
  level3Headings: 153,
  fourFieldHeader: 151,
  dryRunTables: 453,
  thinTableCount: 22,
  emptyTables: 2,
  thinGuides: 19,
  evalOrNewFunction: 0,
  asyncLinesInSolutions: 0,
  asyncLinesInSolutionsCode: 0,
  asyncLinesOutsideSolutions: 159,
  randomOrDateGuides: 3,
  mapSetGuides: 64,
  typedArrayGuides: 19,
  bigIntLiteralGuides: 14,
  selfRecursiveGuides: null, // plan quotes a range, not a number — see CLAIMED_RANGE
  avgBytes: 20 * 1024,
  avgLines: 556,
  runtimeTestsEntries: 109,
  // Row 2 deleted every `fns` key: names resolve from build/blocks.json now, so 0 is the
  // CORRECT value and the plan's 81 is the pre-deletion state. Kept at 0 deliberately — a
  // non-zero measurement here means the duplication is back, which is worth a DRIFT row.
  runtimeTestsFns: 0,
  // The plan's 28 was wrong from the start; row 0 measured 53 before row 2 ran. Pinned to the
  // measurement, and §1.1 of the progress ledger records the correction.
  runtimeTestsScript: 53,
};

// Plan §1 states self-recursion as a heuristic RANGE, not a number.
const CLAIMED_RANGE = { selfRecursiveGuides: [87, 152] };

/** Fixtures: real guides whose fence lines were read off the files, not guessed. */
const FIXTURES = [
  {
    file: '04-matrix/04-set-matrix-zeroes.md',
    picked: [83, 176, 292],
    skipped: [365, 395],
  },
  {
    file: '08-linked-list/02-add-two-numbers.md',
    picked: [90, 198, 259],
    skipped: [302, 321, 336],
  },
  {
    file: '09-binary-tree-general/01-maximum-depth.md',
    picked: [83, 184, 239],
    skipped: [272, 289, 304],
  },
];

function check(results, label, ok, detail = '') {
  results.push({ label, ok, detail });
}

export function runSelfCheck() {
  const results = [];
  let m = {};
  try {
    m = measure();
  } catch (err) {
    check(results, 'measure() runs', false, err.message);
  }

  const guides = safe(() => listGuides().length, 0);
  check(results, 'guides === 150', guides === PINNED.guides, `measured ${guides}`);
  check(results, 'runtimeTested === 109', m.runtimeTested === PINNED.runtimeTested, `measured ${m.runtimeTested}`);
  check(results, 'syntaxOnly === 41', m.syntaxOnly === PINNED.syntaxOnly, `measured ${m.syntaxOnly}`);
  check(
    results,
    'runtimeTested + syntaxOnly === guides',
    m.runtimeTested + m.syntaxOnly === guides,
    `measured ${m.runtimeTested} + ${m.syntaxOnly} vs ${guides} guides`
  );
  check(results, 'syntaxBlocks === 450', m.syntaxBlocks === PINNED.syntaxBlocks, `measured ${m.syntaxBlocks}`);
  check(results, 'solutionBlocks === 450', m.solutionBlocks === PINNED.solutionBlocks, `measured ${m.solutionBlocks}`);
  check(
    results,
    'every guide selects exactly 3 solution blocks',
    m.guidesWithThreeSolutions === guides,
    `measured ${m.guidesWithThreeSolutions} of ${guides}`
  );
  check(
    results,
    'unfilteredFences > solutionBlocks',
    m.unfilteredFences > m.solutionBlocks,
    `measured ${m.unfilteredFences} vs ${m.solutionBlocks}`
  );
  check(results, 'K7 selection is a subset of every fence', m.solutionBlocks <= m.unfilteredFences, `${m.solutionBlocks} <= ${m.unfilteredFences}`);
  check(
    results,
    'no async/generator CODE inside a solution block',
    m.asyncLinesInSolutionsCode === 0,
    `measured ${m.asyncLinesInSolutionsCode} code / ${m.asyncLinesInSolutions} raw text` +
      (m.asyncHitsInSolutions.length ? ` — ${m.asyncHitsInSolutions.map((h) => `${h.isCode ? 'code' : 'comment'} ${h.path}:${h.line}`).join(', ')}` : '')
  );

  const registry = safe(() => readRuntimeTestRegistry(), null);
  if (registry && !registry.error) {
    check(results, 'RUNTIME_TESTS keys === 109', registry.entries.length === PINNED.runtimeTestsEntries, `measured ${registry.entries.length}`);
    // Row 2 deleted the 56 `fns` keys: names now resolve from build/blocks.json, so an entry
    // is EITHER script-style OR cases-style. The old invariant (fns + script === keys) is
    // obsolete — 0 + 53 = 53 is correct now. What still has to hold is that every entry is
    // one of the two shapes, with no entry left carrying both a duplicated name list and a
    // script, and none left with neither.
    const casesOnly = registry.entries.length - registry.script - registry.fnsAndCases;
    check(
      results,
      'every RUNTIME_TESTS entry is script-style or cases-style (no third shape)',
      registry.script + registry.fnsAndCases + Math.max(0, casesOnly) === registry.entries.length,
      `script ${registry.script} + fns+cases ${registry.fnsAndCases} + cases-only ${casesOnly} vs ${registry.entries.length}`
    );
    check(
      results,
      'no entry declares BOTH `fns` and `script` (the duplication row 2 removed)',
      registry.bothFnsAndScript === 0,
      `measured ${registry.bothFnsAndScript}`
    );
  } else {
    check(results, 'readRuntimeTestRegistry() runs', false, registry ? registry.error : 'threw');
  }

  // selectSolutionBlocks against named real guides: picked lines, and the
  // follow-up fences it must skip.
  for (const fx of FIXTURES) {
    const abs = path.join(ROOT_DIR, fx.file);
    let picked = [];
    try {
      picked = selectSolutionBlocks(fs.readFileSync(abs, 'utf-8')).map((b) => b.startLine);
    } catch (err) {
      picked = [`threw: ${err.message}`];
    }
    const ok = picked.join(',') === fx.picked.join(',');
    const skippedNote = skippedFenceLines(abs, fx.picked);
    check(results, `selectSolutionBlocks ${fx.file}`, ok, `picked [${picked}] expected [${fx.picked}] · skipped follow-up fences ${skippedNote}`);
  }

  // Edge fixture: a synthetic guide whose only §2/3/4 fences are surrounded by
  // decoys — a section-1 example, a §5 snippet, two §6 follow-ups, a §7 snippet
  // and a SECOND fence inside §3. All decoys must be skipped.
  const synthetic = [
    '# 1. Synthetic',
    '## 1. Problem Overview & Edge Case Matrix',
    '```javascript', 'const decoy1 = 1;', '```',
    '## 2. Level 1: Brute Force Approach',
    '```javascript', 'const l1 = 1;', '```',
    '```javascript', 'const decoy2 = 1;', '```',
    '## 3. Level 2: Optimized Approach',
    '```javascript', 'const l2 = 1;', '```',
    '```javascript', 'const decoy3 = 1;', '```',
    '## 4. Level 3: Most Optimal / Canonical Approach (Fast)',
    '```javascript', 'const l3 = 1;', '```',
    '## 5. JavaScript-Specific Gotchas & V8 Optimizations',
    '```javascript', 'const decoy4 = 1;', '```',
    '## 6. Real-World MAANG Interview Follow-Ups & Extensions',
    '```javascript', 'const decoy5 = 1;', '```',
    '## 7. What LeetCode Discuss Says (Language-Independent)',
    '```javascript', 'const decoy6 = 1;', '```',
  ].join('\n');
  let syn = [];
  try {
    syn = selectSolutionBlocks(synthetic);
  } catch (err) {
    syn = [{ startLine: `threw: ${err.message}` }];
  }
  const synOk = syn.length === 3 && syn.every((b) => b.code.startsWith('const l'));
  check(
    results,
    'selectSolutionBlocks skips section 1/5/6/7 fences and a 2nd fence in a level',
    synOk,
    `picked levels [${syn.map((b) => b.level)}] code [${syn.map((b) => String(b.code).split('\n')[0])}]`
  );

  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  return failed === 0;
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function skippedFenceLines(abs, picked) {
  const lines = fs.readFileSync(abs, 'utf-8').split('\n');
  const fenceLines = [];
  lines.forEach((l, i) => {
    if (/^```javascript/.test(l)) fenceLines.push(i + 1);
  });
  const skipped = fenceLines.filter((ln) => !picked.includes(ln));
  return `[${skipped.join(', ')}]`;
}

// ---------------------------------------------------------------------------
// Guide-quality score — row 0b. The rubric is `docs/rubrics/guide-quality.md`;
// read it before touching a weight, it states the same contract in prose.
//
// Every component is a number this file already measures or can count in one
// line. Nothing here re-derives a fact the DRIFT table above already prints.
//
// ponytail: the score is mechanical-only — 7 predicates over text this file
// already reads — so "is the intuition any good" and "is the dry run TRUE"
// cannot move it. Ceiling, on purpose: a criterion nobody can compute is a lie
// in a rubric, and prose judgement before gen-blocks.mjs exists would be a
// number with no reproducer. Upgrade path: T1 wires a threshold over this same
// score once an LLM drafter exists to fail, and rows 21/29 feed real trace-diff
// evidence in as `dep` (a table the trace contradicts is worse than a thin one).
const RUBRIC_PATH = 'docs/rubrics/guide-quality.md';

// Mirrors the 6 numbered entries of `REQUIRED_SECTIONS` in validate-guide.mjs by
// symbol, not by line, for the reason the SKIP_DIRS block gives above: it is not
// exported and row 2 owns that file. Its index 0 (`'# '`) is a title sentinel,
// not a section — a file with no H1 is a different defect, so it is left out.
const RUBRIC_SECTIONS = [
  '## 1. Problem Overview & Edge Case Matrix',
  '## 2. Level 1: Brute Force Approach',
  '## 3. Level 2: Optimized Approach',
  '## 4. Level 3: Most Optimal / Canonical Approach',
  '## 5. JavaScript-Specific Gotchas & V8 Optimizations',
  '## 6. Real-World MAANG Interview Follow-Ups & Extensions',
];

/** Points per criterion. 100 total; the order is the print order. */
const WEIGHTS = [
  ['sch', 20], // 6-section headings (12) + 4-field problem header (8)
  ['sol', 20], // 3 K7 solution blocks, one per level
  ['tbl', 15], // 3 `### Step-by-Step Dry Run` headings
  ['dep', 15], // no dry-run table thinner than 3 data rows
  ['fol', 10], // >= 2 `### Follow-Up N:` headings
  ['run', 10], // the guide has a RUNTIME_TESTS entry, so its code really runs
  ['syn', 10], // no async/generator/eval in solution code
];

/**
 * Descriptive bands. NOT thresholds: nothing below exits non-zero, blocks a
 * commit, or feeds `verify` — row 0b ships the rubric and the number, and the
 * gate is T1's to wire once a drafter exists to fail. A gate here would also
 * fail the 41 syntax-only guides that row 3 exists to fix.
 */
const BANDS = [
  { min: 100, name: 'reference' },
  { min: 90, name: 'sound' },
  { min: 80, name: 'incomplete evidence' },
  { min: 0, name: 'draft' },
];

const bandOf = (score) => (BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1]).name;
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Per-guide score out of 100. Reuses `listGuides`, `selectSolutionBlocks`,
 * `HEADER_FIELDS`, `FEATURES`, `ASYNC_GEN`, `stripComment`, `dryRunTables` and
 * the `thinTableOwners` `measure()` already built — the only per-guide facts it
 * adds are a follow-up heading count and the 4-field header membership.
 *
 * `run` reads RUNTIME_TESTS KEYS, not their contents, so row 2 dropping the
 * `fns` arrays (names come from blocks.json instead) leaves the criterion intact.
 *
 * @returns {{rows: object[], summary: object}}
 */
export function scoreGuides(measured, registry) {
  const m = measured || measure();
  const reg = registry || readRuntimeTestRegistry();
  const runtimeTested = new Set(reg.error ? [] : reg.entries);
  const thinByPath = new Map(m.thinTableOwners.map((o) => [o.file, o.tables]));
  const forbidden = (code) =>
    code.split('\n').filter((l) => ASYNC_GEN.test(stripComment(l)) || FEATURES.evalOrFunction.test(l)).length;

  const rows = listGuides().map((file) => {
    const content = fs.readFileSync(path.join(ROOT_DIR, file), 'utf-8');
    const sections = RUBRIC_SECTIONS.filter((s) => content.includes(s)).length;
    const blocks = selectSolutionBlocks(content);
    const levels = new Set(blocks.map((b) => b.level)).size;
    const tables = dryRunTables(content.split('\n'), file);
    const thin = thinByPath.get(file) || 0;
    const followUps = (content.match(/### Follow-Up \d+:/g) || []).length;
    const header = HEADER_FIELDS.every((f) => content.includes(f));
    const hits = blocks.reduce((n, b) => n + forbidden(b.code), 0);
    const parts = Object.fromEntries(
      Object.entries({
        sch: (sections / RUBRIC_SECTIONS.length) * 12 + (header ? 8 : 0),
        sol: (levels / 3) * 20,
        tbl: Math.min(1, tables.length / 3) * 15,
        dep: (tables.length ? Math.max(0, 1 - thin / tables.length) : 0) * 15,
        fol: Math.min(1, followUps / 2) * 10,
        run: runtimeTested.has(file) ? 10 : 0,
        syn: hits === 0 ? 10 : 0,
      }).map(([k, v]) => [k, Math.round(v * 10) / 10]) // 1/3 of 15 is not a float anyone wants to read
    );
    const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * 10) / 10;
    // `tables`/`thin` are the only fields `parts` does not already explain: dep is
    // their ratio, and "1 of 3 thin" reads differently from "2 of 3 thin".
    return { file, score, band: bandOf(score), parts, tables: tables.length, thin };
  });
  rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  const scores = rows.map((r) => r.score);
  const thinOwners = new Set(m.thinTableOwners.map((o) => o.file));
  const thinRows = rows.filter((r) => thinOwners.has(r.file));
  const restRows = rows.filter((r) => !thinOwners.has(r.file));
  const restMedian = median(restRows.map((r) => r.score));
  return {
    rows,
    summary: {
      guides: rows.length,
      mean: Math.round((scores.reduce((a, b) => a + b, 0) / rows.length) * 10) / 10,
      min: Math.min(...scores),
      max: Math.max(...scores),
      atMax: scores.filter((s) => s === Math.max(...scores)).length,
      minFile: rows[rows.length - 1].file,
      bands: BANDS.map((b) => ({ band: b.name, atLeast: b.min, guides: rows.filter((r) => r.band === b.name).length })),
      // Computed, not asserted: the penalty has to show up in the scores.
      thinOwners: thinRows.length,
      thinMeanDepth: thinRows.length ? Math.round((thinRows.reduce((a, r) => a + r.parts.dep, 0) / thinRows.length) * 10) / 10 : 0,
      cleanMeanDepth: restRows.length ? Math.round((restRows.reduce((a, r) => a + r.parts.dep, 0) / restRows.length) * 10) / 10 : 0,
      thinBelowRestMedian: thinRows.filter((r) => r.score < restMedian).length,
      restMedian,
    },
  };
}

/** One line per guide, highest score first, then the summary a reader needs to trust it. */
export function printScores(scored) {
  const { rows, summary: s } = scored;
  const w = Math.max(...rows.map((r) => r.file.length));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const heads = WEIGHTS.map(([id, max]) => `${id}/${max}`.padStart(max < 10 ? 5 : 7));
  const compWidth = heads.reduce((n, h) => n + h.length, 0) + heads.length - 1;
  console.log('GUIDE QUALITY SCORE — rubric: ' + RUBRIC_PATH + ' — read-only, node ' + process.versions.node);
  console.log('  bands are descriptive labels. Nothing gates: no threshold, no non-zero exit, no `verify` wiring.');
  console.log('\n' + `${'guide'.padEnd(w)} ${'score'.padStart(6)}  ${'band'.padEnd(19)} ${heads.join(' ')}`);
  console.log('-'.repeat(w + 6 + 2 + 19 + 1 + compWidth));
  for (const r of rows) {
    console.log(
      `${r.file.padEnd(w)} ${fmt(r.score).padStart(6)}  ${r.band.padEnd(19)} ` +
        WEIGHTS.map(([id, max]) => `${fmt(r.parts[id])}/${max}`.padStart(max < 10 ? 5 : 7)).join(' ')
    );
  }
  console.log(`\nsummary: ${s.guides} guides · mean ${s.mean} · min ${s.min} (${s.minFile}) · max ${s.max} (${s.atMax} guides)`);
  console.log('bands: ' + s.bands.map((b) => `${b.band} ${b.guides}`).join(' · '));
  console.log(`thin-table cross-check: ${s.thinOwners} guides own a thin dry-run table (row 0) · their mean depth component is ${s.thinMeanDepth}/15 vs ${s.cleanMeanDepth}/15 for the other ${s.guides - s.thinOwners} · ${s.thinBelowRestMedian}/${s.thinOwners} score below the rest's median ${s.restMedian}`);
  console.log('  a component is a number, not a judgement: "the intuition is any good" and "the dry run is TRUE" are not in the score.');
  return s;
}

// ---------------------------------------------------------------------------
// Report.

const ROWS = [
  ['guides', 'guides', 'npm run validate | grep -F "Scanned:"'],
  ['runtimeTested', 'runtimeTested', 'npm test | grep -F "Files:"'],
  ['syntaxOnly', 'syntaxOnly', 'npm test | grep -F "Files:"'],
  ['syntaxBlocks (runner first-3)', 'syntaxBlocks', 'npm test | grep -F "Syntax blocks checked"'],
  ['solutionBlocks (PINNED predicate)', 'solutionBlocks', 'npm run audit | grep -F "solutionBlocks"'],
  ['unfiltered js fences', 'unfilteredFences', "rg -o '```javascript' -g '*.md' 0[1-9]-* 1[0-9]-* 2[0-3]-* | wc -l"],
  ['Level 3 headings', 'level3Headings', 'npm run audit'],
  ['guides with 4-field edge header', 'fourFieldHeader', 'npm run audit'],
  ['Step-by-Step Dry Run tables', 'dryRunTables', "rg -o '### Step-by-Step Dry Run' -g '*.md' 0[1-9]-* 1[0-9]-* 2[0-3]-* | wc -l"],
  ['thin tables (<=2 data rows)', 'thinTableCount', 'npm run audit -- --json | jq ".thinTables | length"'],
  ['empty tables (0 data rows)', 'emptyTables', 'npm run audit -- --json | jq "[.thinTables[] | select(.rows == 0)] | length"'],
  ['guides owning thin tables', 'thinGuides', 'npm run audit -- --json | jq "[.thinTables[].path] | unique | length"'],
  ['eval / new Function guides', 'evalOrNewFunction', 'npm run audit'],
  ['async/generator lines in solutions', 'asyncLinesInSolutions', 'npm run audit'],
  ['…of which CODE, not comments', 'asyncLinesInSolutionsCode', 'npm run audit'],
  ['async/generator lines elsewhere', 'asyncLinesOutsideSolutions', 'npm run audit'],
  ['Math.random / Date guides', 'randomOrDateGuides', 'npm run audit'],
  ['Map / Set guides', 'mapSetGuides', 'npm run audit'],
  ['typed-array guides', 'typedArrayGuides', 'npm run audit'],
  ['BigInt-literal guides', 'bigIntLiteralGuides', 'npm run audit'],
  ['self-recursive guides', 'selfRecursiveGuides', 'npm run audit -- --json | jq ".selfRecursiveGuides"'],
  ['avg guide bytes', 'avgBytes', 'npm run audit'],
  ['avg guide lines', 'avgLines', 'npm run audit'],
  ['RUNTIME_TESTS keys', 'runtimeTestsEntries', 'npm run audit'],
  ['RUNTIME_TESTS fns+cases', 'runtimeTestsFns', 'npm run audit'],
  ['RUNTIME_TESTS script', 'runtimeTestsScript', 'npm run audit'],
];

/** asserted-vs-measured for every row; the drift list is the report's headline. */
export function diffTable(m, registry) {
  const values = { ...m };
  if (registry && !registry.error) {
    values.runtimeTestsEntries = registry.entries.length;
    values.runtimeTestsFns = registry.fnsAndCases;
    values.runtimeTestsScript = registry.script;
  }
  const rows = ROWS.map(([label, key, repro]) => {
    const measured = values[key];
    const claimed = PINNED[key];
    const claimedText = claimed === null || claimed === undefined ? 'n/a' : claimed;
    const ok = claimed === null || claimed === undefined ? null : claimed === measured;
    return { label, key, measured, claimed: claimedText, ok, repro };
  });
  const rangeDrift = [];
  for (const [key, [lo, hi]] of Object.entries(CLAIMED_RANGE)) {
    const [narrow, broad] = values[key];
    rangeDrift.push({ key, label: 'self-recursive range', claimed: `${lo}..${hi}`, measured: `${narrow}..${broad}`, ok: narrow >= lo && broad <= hi });
  }
  return { rows, rangeDrift };
}

export function printReport(m, registry) {
  const { rows, rangeDrift } = diffTable(m, registry);
  const label = Math.max(...ROWS.map(([label]) => label.length));
  const width = (n) => String(n).padStart(9);
  console.log('CURRICULUM AUDIT — ' + path.basename(process.cwd()) + ' — read-only, node ' + process.versions.node);
  console.log('\nPREDICATES');
  console.log('  guide        : markdown under the repo root, minus SKIP_DIRS (mirrors validate-guide.mjs)');
  console.log('  solution blk : K7 — FIRST ```javascript fence inside each `## N. Level 1|2|3` heading,');
  console.log('                 stopping at the next heading of the same or shallower depth.');
  console.log('  syntaxBlocks : the test runner\'s first THREE fences per guide, unscoped — a DIFFERENT');
  console.log('                 predicate that happens to total the same 450 today.');
  console.log('  thin table   : a `### Step-by-Step Dry Run` table with < 3 data rows');
  console.log('\n' + `${'metric'.padEnd(label)} ${'measured'.padStart(9)} ${'claimed'.padStart(9)}   match  reproduce`);
  console.log('-'.repeat(label + 9 + 9 + 48));
  for (const r of rows) {
    const measured = Array.isArray(r.measured) ? `${r.measured[0]}..${r.measured[1]}` : r.measured;
    console.log(`${r.label.padEnd(label)} ${width(measured)} ${width(r.claimed)}   ${r.ok === null ? '  -  ' : r.ok ? ' yes ' : ' NO  '}  ${r.repro}`);
  }
  for (const d of rangeDrift) {
    console.log(`${d.label.padEnd(label)} ${width(d.measured)} ${width(d.claimed)}   ${d.ok ? ' yes ' : ' NO  '}  npm run audit -- --json | jq ".selfRecursiveGuides"`);
  }

  console.log('\nself-recursive guides: pinned heuristic — a function declared inside a solution block');
  console.log('is called at least once by that same name inside the same block. Indirect and mutual');
  console.log('recursion are NOT counted; a same-named call to a different scope would be.');
  console.log(`narrow = function declarations only, broad = + arrow/function-expression consts (${m.selfRecursiveGuides.join('..')}).`);
  console.log(`guides where the runner's unscoped first-3 slice picks the same fences as K7: ${m.guidesWhereRunnerSliceEqualsK7}/${m.guides}`);
  console.log(`async/generator lines outside solution blocks sit in ${m.asyncInFollowUpGuides} §6 follow-up guides (plan says "159 lines across 70 guides").`);
  if (m.asyncHitsInSolutions.length) {
    console.log(`every raw-text async/generator hit inside a solution block (isCode=true is what row 4 must reject):`);
    for (const h of m.asyncHitsInSolutions) console.log(`  ${h.isCode ? 'CODE    ' : 'comment'} ${h.path}:${h.line} [L${h.level}] ${h.text}`);
  }

  const drift = rows.filter((r) => r.ok === false).concat(rangeDrift.filter((d) => !d.ok));
  console.log(`\ntotals: ${m.totalBytes} bytes / ${m.totalLines} lines across ${m.guides} guides`);
  if (drift.length === 0) {
    console.log('\nDRIFT: none — every asserted number matches the repo.');
  } else {
    console.log(`\nDRIFT (${drift.length}) — a doc asserts a number the repo does not produce:`);
    for (const d of drift) console.log(`  ${d.key.padEnd(28)} asserted ${String(d.claimed).padEnd(9)} measured ${d.measured}`);
    console.log('\nDrift is reported, never absorbed: fix the doc or the guide, not this script.');
  }
  if (m.runtimeTestsUnknownPaths.length) {
    console.log(`\nRUNTIME_TESTS keys with no matching guide: ${m.runtimeTestsUnknownPaths.join(', ')}`);
  }
  console.log(`\nguides owning a thin dry-run table (< 3 data rows): ${m.thinTableOwners.length}`);
  for (const g of m.thinTableOwners) console.log(`  ${g.file} — ${g.tables} thin (rows: ${g.rows})`);
  return drift;
}

if (process.argv[1] === __filename) {
  const argv = process.argv.slice(2);
  if (argv.includes('--check')) {
    process.exit(runSelfCheck() ? 0 : 1);
  }
  const m = measure();
  const registry = readRuntimeTestRegistry();
  // `--scores` is additive: without it every output below is byte-for-byte what
  // row 0 shipped. With it, `--json` gains guideScores/guideScoreSummary keys.
  const scored = argv.includes('--scores') ? scoreGuides(m, registry) : null;
  if (argv.includes('--json')) {
    console.log(JSON.stringify({
      ...m,
      ...(scored ? { guideScores: scored.rows.map(({ file, score, band, parts }) => ({ file, score, band, ...parts })), guideScoreSummary: scored.summary } : {}),
      selfRecursiveGuidesNarrow: m.selfRecursiveGuides[0],
      selfRecursiveGuidesBroad: m.selfRecursiveGuides[1],
      runtimeTestsEntries: registry.entries.length,
      runtimeTestsFns: registry.fnsAndCases,
      runtimeTestsScript: registry.script,
      runtimeTestsPaths: registry.entries,
      drift: diffTable(m, registry).rows.filter((r) => r.ok === false).map((r) => ({ key: r.key, asserted: r.claimed, measured: r.measured })),
    }, null, 2));
    process.exit(0);
  }
  if (scored) {
    printScores(scored);
    process.exit(0);
  }
  const drift = printReport(m, registry);
  process.exit(argv.includes('--strict') && drift.length > 0 ? 1 : 0);
}