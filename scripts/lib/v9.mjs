#!/usr/bin/env node
/**
 * `scripts/lib/v9.mjs` — plan v5 §7 row 32, the V9 predicate of row 27 EXTRACTED.
 *
 * Row 32 wants the "Unverified" label to be a *pure function of per-guide evidence*. It cannot
 * be, and this file is the reason the row was renamed. The predicate needs, for one guide:
 * every step's `text`, `operands` and `snap`. Steps 2…N−1 are not published anywhere
 * (`scripts/gen-traces.mjs` writes a head of only `first`/`last`, via `headStep`), the two that
 * are published are degraded (`out` is a 240-char, 4-binding human summary —
 * `api/_lib/trace-runner.mjs:721-729`), and `docs/traces/` is a gitignored build artefact. So
 * the browser cannot recompute this; the BUILD computes it, once, and the portal renders the
 * verdict. What is pure here is the verdict function, not the label's provenance.
 *
 * ── WHAT IS PORTED, AND FROM WHERE ───────────────────────────────────────────────────
 * Every function below is the inline body of `scripts/test-trace.mjs`'s S14 block, moved
 * unchanged. Nothing is reimplemented and nothing is "improved" — a cross-check whose
 * semantics drifted from the gate that enforces it would stop being a cross-check:
 *
 *   numbersIn          <- test-trace.mjs:1156     the `-?\d+` token extractor
 *   level3TableNumbers <- test-trace.mjs:1165-1169 parseGuide -> level 3 rows -> numeric cells
 *   sharedNumbers      <- test-trace.mjs:1175-1177 trace text -> numeric tokens -> intersection
 *   v9Verdict          <- test-trace.mjs:1163-1179 the three-way verdict, in the same order
 *   declaredIn         <- test-trace.mjs:1190-1193 the code's own declared names
 *   namesIn            <- test-trace.mjs:1197      the words a sentence MENTIONS
 *   overrideOk         <- test-trace.mjs:1198-1199 the override identifier guard
 *
 * `parseGuide` is INJECTED rather than imported. `docs/dryrun/table.js` documents itself as
 * browser-safe (`docs/dryrun/table.js:3-9`) and `scripts/lib/serialize.mjs:22` as a pure
 * library, so this module's whole dependency list is one sibling import that is already proven
 * to have no `node:`, no fs and no network — which is what keeps it importable from a page
 * (the same constraint `docs/dryrun/table.js` keeps). Injecting `parseGuide` rather than
 * importing it is what lets `scripts/test-trace.mjs` hand in the module it already loaded at
 * :1155 instead of this file taking a second path to the table parser.
 *
 * The self-check at the bottom is the gate that has to be able to fail; run it with
 * `node scripts/lib/v9.mjs`. Its dynamic `node:assert` import means importing this module in a
 * browser never touches `node:`.
 */

import { stringify } from './serialize.mjs';

/** The three verdicts V9 can return. UNCOMPARABLE is not a disagreement: `test-trace.mjs:1170-1173`
 *  is explicit that reporting no-comparison as drift is "the same sin as calling them agreement". */
export const AGREES = 'agrees';
export const DISAGREES = 'disagrees';
export const UNCOMPARABLE = 'uncomparable';

/** A trace too short to contain a shared value cannot confirm or contradict the table
 *  (`test-trace.mjs:1171-1174`). Ported as a named constant so the threshold is visible. */
export const MIN_STEPS = 3;

/** test-trace.mjs:1156 — every `-?\d+` token in some text, as numbers. */
export function numbersIn(text) {
  return (String(text).match(/-?\d+/g) || []).map(Number);
}

/**
 * test-trace.mjs:1165-1169 — the numeric tokens of a guide's authored LEVEL 3 dry-run table.
 *
 * @param {string} guideText full guide markdown
 * @param {(s: string) => Array<{level: number, rows: string[][]}>} parseGuide from `docs/dryrun/table.js`
 * @returns {Set<number>|null} null when the guide has no L3 table or the table has no rows,
 *   which is the first UNCOMPARABLE branch (`test-trace.mjs:1166-1167`)
 */
export function level3TableNumbers(guideText, parseGuide) {
  const level3 = parseGuide(guideText).find((t) => t.level === 3);
  if (!level3 || !level3.rows.length) return null;
  return new Set(level3.rows.flatMap((r) => r.flatMap((c) => numbersIn(c))));
}

/**
 * test-trace.mjs:1175-1177 — the numeric tokens a whole trace carries, and the ones shared
 * with the table. The trace side is `text` + canonical `operands` + canonical `snap` per step,
 * joined; `stringify` is row 6's canonical normaliser, NOT `JSON.stringify`, because
 * `Map`/`Set`/`undefined`/`NaN`/`BigInt` all serialise differently and this repo has 64 guides
 * that use them (plan v5 §1 finding U5).
 *
 * @param {Set<number>} tableNumbers
 * @param {Array<{text?: string, operands?: unknown, snap?: unknown}>} steps
 * @returns {number[]} the shared tokens
 */
export function sharedNumbers(tableNumbers, steps) {
  const traceText = steps.map((st) => `${st.text} ${stringify(st.operands)} ${stringify(st.snap)}`).join(' ');
  const traceNumbers = new Set(numbersIn(traceText));
  return [...tableNumbers].filter((n) => traceNumbers.has(n));
}

/**
 * test-trace.mjs:1163-1179 — "does this guide's authored L3 table agree with its trace?".
 *
 * Ported in the same order as the inline loop, because the order IS the rule: a missing table
 * is UNCOMPARABLE, and only a table that HAS a value to check but shares none with the trace is
 * a disagreement.
 *
 * @param {string} guideText full guide markdown
 * @param {Array<{text?: string, operands?: unknown, snap?: unknown}>} steps the FULL golden's steps
 * @param {(s: string) => Array<{level: number, rows: string[][]}>} parseGuide
 * @returns {'agrees'|'disagrees'|'uncomparable'}
 */
export function v9Verdict(guideText, steps, parseGuide) {
  const tableNumbers = level3TableNumbers(guideText, parseGuide);
  // test-trace.mjs:1174 — nothing numeric in the table, or a trace too coarse to hold a shared
  // value, means there is nothing to cross-check. Both are UNCOMPARABLE, and both are
  // `continue`s, not verdicts of agreement.
  if (tableNumbers === null || tableNumbers.size === 0 || steps.length < MIN_STEPS) return UNCOMPARABLE;
  return sharedNumbers(tableNumbers, steps).length ? AGREES : DISAGREES;
}

/** test-trace.mjs:1190-1193 — the identifiers the CODE declares: `const|let|var|function|class`
 *  names, plus the leading token of every parameter list. */
export function declaredIn(source) {
  return new Set([
    ...[...String(source).matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ...[...String(source).matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g)].flatMap((m) => m[1].split(',').map((t) => t.trim().split(/[\s=:]/)[0]).filter(Boolean)),
  ]);
}

/** test-trace.mjs:1197 — the words a sentence MENTIONS. It references identifiers; it does not
 *  declare them, which is why the guard intersects instead of subtracts. */
export function namesIn(sentence) {
  return new Set([...(String(sentence).match(/[A-Za-z_$][\w$]*/g) || [])]);
}

/**
 * test-trace.mjs:1198-1199 — plan D12's override guard. An override SENTENCE may not name an
 * identifier the code declares but the trace never watched, or the portal narrates a variable
 * it never sampled. Judged against declared names, not every word: an override is prose, and
 * "left meets right" is not a reference to `meets`.
 *
 * @returns {string[]} the offending identifiers — empty means the override is fine
 */
export function overrideOk(sentence, codeNames, watch) {
  return [...namesIn(sentence)].filter((w) => codeNames.has(w) && !watch.includes(w));
}

/* --------------------------------------------------------------------------- */
/* Self-check. `node scripts/lib/v9.mjs`. The gate has to be able to fail, and one case
 * in it deliberately seeds a table edit that must come back `disagrees`.             */

async function selfCheck() {
  const { default: assert } = await import('node:assert/strict');
  let n = 0;
  const it = (name, fn) => { fn(); n++; console.log(`  ✓ ${name}`); };

  const TABLE = (level, rows) => [
    `# 0. Fixture`,
    ``,
    `## ${level}. Level ${level} (Canonical)`,
    ``,
    `### Step-by-Step Dry Run`,
    ``,
    `| Step | Value |`,
    `| --- | --- |`,
    ...rows.map((r) => `| ${r} |`),
    ``,
  ].join('\n');

  // A trace carrying exactly the tokens 2 and 7, and no digits in its step text — so a table
  // holding 900/901 shares nothing and the disagreement branch is not reached by accident.
  const TRACE = [
    { text: 'visit', operands: { k: 2 }, snap: { seen: 7 } },
    { text: 'merge', operands: { k: 7 }, snap: { seen: 2 } },
    { text: 'done', operands: { k: 2 }, snap: { seen: 7 } },
  ];

  // numbersIn — test-trace.mjs:1156
  it('numbersIn extracts every -?\\d+ token', () => {
    assert.deepEqual(numbersIn('a 12 b -3 c 4.5'), [12, -3, 4, 5]);
    assert.deepEqual(numbersIn('none here'), []);
  });

  // The three verdicts, test-trace.mjs:1163-1179.
  it('a table sharing a value with the trace AGREES', () => {
    assert.equal(verdict(TABLE(3, ['s | nums=[2,7]']), TRACE), AGREES);
  });

  it('a table with NO shared value DISAGREES — the guard bites', () => {
    assert.equal(verdict(TABLE(3, ['s | nums=[900,901]']), TRACE), DISAGREES);
  });

  it('a guide with no L3 table is UNCOMPARABLE, not a disagreement (test-trace.mjs:1167)', () => {
    assert.equal(verdict(TABLE(1, ['s | x=2']), TRACE), UNCOMPARABLE);
  });

  it('a table with nothing numeric in it is UNCOMPARABLE (test-trace.mjs:1174)', () => {
    assert.equal(verdict(TABLE(3, ['s | left meets right']), TRACE), UNCOMPARABLE);
  });

  it('a trace shorter than MIN_STEPS is UNCOMPARABLE (test-trace.mjs:1174)', () => {
    const two = [{ text: 'visit', operands: { k: 900 }, snap: {} }, { text: 'done', operands: {}, snap: {} }];
    assert.equal(verdict(TABLE(3, ['s | x=901']), two), UNCOMPARABLE);
  });

  it('one unmatched cell does not flip agreement when a value IS shared', () => {
    assert.equal(verdict(TABLE(3, ['s | 7', 's | 4242']), TRACE), AGREES);
  });

  it('MIN_STEPS is the ported threshold, not a fresh guess', () => {
    assert.equal(MIN_STEPS, 3);
  });

  // plan D12 override guard — test-trace.mjs:1203-1208
  const codeNames = new Set(['left', 'right', 'ghost']);
  const watchNow = ['left', 'right'];
  it('override guard allows a sentence naming watched identifiers', () => {
    assert.deepEqual(overrideOk('left meets right, so we stop', codeNames, watchNow), []);
  });
  it('override guard REJECTS a declared-but-unwatched identifier', () => {
    assert.ok(overrideOk('left meets right, then ghost appears', codeNames, watchNow).length > 0);
  });
  it('override guard ignores prose and literals', () => {
    assert.deepEqual(overrideOk('the count is 7', codeNames, watchNow), []);
  });
  it('declaredIn reads the code’s own declarations and parameter lists', () => {
    assert.deepEqual([...declaredIn('const left = 1; function f(right, ghost) { return 1; }')].sort(), ['f', 'ghost', 'left', 'right']);
  });

  console.log(`\n[v9] ${n} self-checks, 0 failures`);
}

// Imported lazily so the self-check and the fixture table parser stay out of the browser path.
let parseGuideFor = null;
function verdict(guideText, steps) {
  return v9Verdict(guideText, steps, parseGuideFor);
}

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('v9.mjs')) {
  ({ parseGuide: parseGuideFor } = await import('../../docs/dryrun/table.js'));
  await selfCheck();
}