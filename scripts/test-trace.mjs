/**
 * ENVELOPE v1.1 IS FROZEN (row 13, plan v5 §7 row 13 / §5 "freeze at row 12 green").
 *
 * V3 is green over all 450 real goldens, so from here on "frozen" FORBIDS, without a
 * deliberate and RECORDED decision:
 *   - adding, removing or renaming any top-level field, or any `steps[]` field, of the
 *     envelope (`FROZEN_V1_1_FIELDS` / `FROZEN_V1_1_STEP_FIELDS` below are the record);
 *   - changing what any of those fields MEANS, even keeping the name — `v` is the contract
 *     revision precisely because a v2 may reuse these names for different meanings;
 *   - adding a field to the schema, the validator or the differ alone. Those are three
 *     places one field lives, and a field present in only one of them is a silent-wrong
 *     generator: accepted by the shape check, never compared by the differ.
 *
 * HOW IT IS ENFORCED, in S10: the frozen set is asserted against `docs/trace-schema.json`
 * in BOTH directions (a renamed, added or removed field fails), against the validator
 * BEHAVIOURALLY (deleting each field must make `validateEnvelope` report it missing), and
 * against the DIFFER (changing each field must make `diffEnvelope` reject the pair). Plus,
 * in S8, all 450 real goldens must carry exactly the frozen key set. A green V3 that cannot
 * go red is the failure this row exists to prevent, so every frozen field has a probe that
 * turns it red on purpose.
 *
 * Row 8: the golden differ — plan v5 §7 row 8, ledger E19, decision K5/K6.
 *
 * A golden is only worth having if it says WHICH STEP went wrong and HOW. A differ that
 * compares two documents and prints `false` is not a golden check: the moment a trace
 * drifts, the author has to re-derive the divergence by hand across 450 blocks. So the
 * unit of failure here is a STEP — its index, its `type`, its `line.off`, and which of
 * `snap` / `operands` / `delta` / `text` / `out` moved, from what to what.
 *
 * E19 is the case that must stay categorically separate. A guide edited after its golden
 * existed re-derives `block.hash` on every step (plan §3 K5 — identity is the hash, never
 * a line number), so the golden's steps are ALL stale at once. Reported as ordinary step
 * diffs that is 17 noisy diffs here and ~450 across a full curriculum run; reported as
 * `STALE_GOLDEN` it is one line saying "regenerate". Hence the check order below: identity
 * first, steps last.
 *
 * Canonical comparison is row 6's `stringify` (plan §3 K6), NOT `deepEqual` — it sorts keys
 * at every level, so key order is invisible while a real value difference is not (E8). The
 * test cross-checks one pair through `jq -S`, the literal comparison plan §0.2 pins.
 *
 * EVERY fixture except `expected.json` is GENERATED from it (`--mutate`), so no case can be
 * a hand-edited file that silently stopped testing what its name claims.
 *
 * Run:   node scripts/test-trace.mjs           # the self-tests; exits 1 if any assertion fails
 *        node scripts/test-trace.mjs --mutate  # regenerate scripts/fixtures/trace/*.json
 *
 * Exports `diffEnvelope` — row 13 flips this file green, row 27 (V9) and any CI consumer
 * import it; see the return shape on `diffEnvelope` below.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stringify, deserialize } from './lib/serialize.mjs';
import { validateEnvelope } from './validate-envelope.mjs';
// The ~2 KB per-problem cap is E32's number and row 16 already owns it, so it is imported
// rather than re-declared: two literals would drift, and the drift would be invisible.
import { HEAD_BYTE_CAP } from './gen-doc-traces.mjs';
// S18 sorts the "is this whole family one mechanism?" question, and the answer is in here.
import { equivalent, getCodec } from '../api/_lib/codecs.mjs';
// S23 replays a class target's op list, so the claim is proved against the REAL driver rather than
// against a re-implementation of it — a probe that copies the driver proves the copy.
import { buildBundle } from '../api/_lib/problems.mjs';
import { executeUserCode } from '../api/_lib/sandbox.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'trace');
const EXPECTED = path.join(FIXTURES, 'expected.json');

/**
 * Row 15's goldens. Gitignored (E32): a fresh clone has none until `npm run gen:traces`.
 *
 * `TRACE_GOLDENS_DIR` exists so the two corpus failure modes are PROVABLE rather than claimed:
 * an empty directory and a drifted one. Both are exercised against a throwaway copy, because
 * the real corpus is 36 MB that other rows are reading concurrently.
 */
const GOLDENS_DIR = process.env.TRACE_GOLDENS_DIR
  || path.join(__dirname, '..', 'judge', 'traces');
/**
 * The mutant target, named not numbered: the plan §5 worked example, so a golden that moves
 * or disappears fails this loudly instead of silently retargeting the test somewhere else.
 */
const MUTANT_GOLDEN = '05-hashmap__06-two-sum.L3.json';

// ---- the frozen contract (row 13) ----------------------------------------------------
// Plan v5 §5's field list, transcribed. THIS is the record the freeze is enforced against —
// not the schema document and not the validator, either of which can be edited to match the
// other and look consistent while the envelope has already moved.
const FROZEN_V1_1_FIELDS = [
  'v', 'path', 'level', 'fnName', 'codec', 'block', 'watch', 'steps',
  'result', 'verdict', 'truncated', 'budget', 'stepCount', 'error',
];
const FROZEN_V1_1_STEP_FIELDS = [
  'n', 'line', 'type', 'text', 'operands', 'cond', 'snap', 'delta', 'out', 'override',
];

/** One real golden's worth of file IO helpers. */
const goldenNames = () => fs.readdirSync(GOLDENS_DIR)
  .filter((f) => /\.L[123]\.json$/.test(f))
  .sort();
const readGolden = (name) => JSON.parse(fs.readFileSync(path.join(GOLDENS_DIR, name), 'utf8'));

/**
 * S23's mechanism probe: drive `buildBundle` with a class target and a recorded op list, and report
 * what the driver's own comparison said.
 *
 * Written against the REAL driver for one reason: a probe that re-implements the replay proves the
 * re-implementation, which is the failure mode every "the harness agrees with itself" check in this
 * row's history has been. The class is three lines and the op list is the shape `harvestCases`
 * emits, so what is under test is `buildBundle`'s ops branch and nothing else.
 *
 * `expected` is chosen so a PASS is impossible unless the ops were really replayed against the
 * constructed instance: `Stack` keeps its own `min`, and no single invocation of the constructor
 * produces `[-2, -3]`.
 */
async function opsEmits(fnName, ops, ctor) {
  const userCode = [
    'class Stack {',
    '  constructor() { this.min = []; }',
    '  push(v) { this.min.push(v); if (this.min.length === 1 || v < this.min[0]) this.min[0] = v; return true; }',
    '  top() { return this.min[this.min.length - 1]; }',
    '  getMin() { return this.min[0]; }',
    '}',
  ].join('\n');
  const bundle = buildBundle({
    userCode,
    fnName,
    codec: 'ops',
    equivalence: 'ops-terminal-state-and-outputs',
    tests: [{ name: 'op sequence', args: [], ctor, ops, expected: [-2, -3] }],
  });
  const exec = await executeUserCode(bundle, { timeoutMs: 5000 });
  if (!exec.ok || typeof exec.envelopeRaw !== 'string') return false;
  const verdict = JSON.parse(exec.envelopeRaw.slice('__VERDICT__'.length));
  return verdict.passed === 1 && verdict.failed === 0;
}

/** The first step index satisfying a predicate — so a mutant targets a step the golden HAS. */
const findStep = (g, pred) => g.steps.findIndex((s) => plainObject(s) && pred(s));

/**
 * Mutants DERIVED FROM A REAL GOLDEN, at run time.
 *
 * These are the negative case that proves V3 can fail: an authored `.json` mutant would drift
 * from the golden it claims to mutate and eventually pass for the wrong reason (E19's lesson
 * applied to the tests themselves). So each entry finds its own target step and reads its own
 * `from` value out of the loaded golden, and returns the field PATH it expects to be named.
 * Three distinct steps, so each mutant isolates exactly one field.
 */
const REAL_MUTANTS = {
  'a-snap-value': (g) => {
    const index = findStep(g, (s) => plainObject(s.snap) && Object.values(s.snap).some((v) => typeof v === 'number'));
    const key = Object.keys(g.steps[index].snap).find((k) => typeof g.steps[index].snap[k] === 'number');
    const mutant = clone(g);
    mutant.steps[index].snap[key] += 1;
    return { mutant, index, path: `snap.${key}` };
  },
  'an-operand': (g) => {
    const index = findStep(g, (s) => plainObject(s.operands) && Object.keys(s.operands).length > 0);
    const key = Object.keys(g.steps[index].operands)[0];
    const from = g.steps[index].operands[key];
    const mutant = clone(g);
    mutant.steps[index].operands[key] = typeof from === 'number' ? from + 1 : `${from}-mutated`;
    return { mutant, index, path: `operands.${key}` };
  },
  'a-step-type': (g) => {
    const index = findStep(g, (s) => s.type === 'if-test');
    const mutant = clone(g);
    mutant.steps[index].type = 'call'; // a legal §5 type, so only the VALUE moved
    return { mutant, index, path: 'type' };
  },
};

/**
 * One value-mutating probe per frozen envelope field, and the verdict it must produce.
 *
 * The freeze is only real if the DIFFER notices every field: a field added to the schema but
 * never taught to `diffEnvelope` would make V3 permanently green, which is the silent-wrong
 * this engine treats as its worst failure. Each probe edits ONE field and nothing else, so a
 * probe that passes cannot be passing on some other field's back.
 *
 * `steps` and `stepCount` get their own codes on purpose: those two are handled by named
 * phases of the differ rather than by the generic envelope-field scan, and a future field
 * must be routed the same way deliberately, not by accident.
 */
const FIELD_PROBES = {
  v: [(g) => { g.v = 2; }, 'ENVELOPE_FIELD'],
  path: [(g) => { g.path = `${g.path}-drifted`; }, 'ENVELOPE_FIELD'],
  level: [(g) => { g.level = g.level === 1 ? 3 : 1; }, 'ENVELOPE_FIELD'],
  fnName: [(g) => { g.fnName = `${g.fnName}X`; }, 'ENVELOPE_FIELD'],
  codec: [(g) => { g.codec = g.codec === 'json' ? 'tree' : 'json'; }, 'ENVELOPE_FIELD'],
  block: [(g) => { g.block.startLine += 1; }, 'ENVELOPE_FIELD'],
  watch: [(g) => { g.watch = [...g.watch, 'aMutationProbe']; }, 'ENVELOPE_FIELD'],
  steps: [(g) => { g.steps[0].n += 1; }, 'STEP_DIFF'],
  result: [(g) => { g.result = null; }, 'ENVELOPE_FIELD'],
  verdict: [(g) => { g.verdict.failed += 1; }, 'ENVELOPE_FIELD'],
  truncated: [(g) => { g.truncated.display = !g.truncated.display; }, 'ENVELOPE_FIELD'],
  budget: [(g) => { g.budget.chunks += 1; }, 'ENVELOPE_FIELD'],
  stepCount: [(g) => { g.stepCount += 1; }, 'STEP_COUNT'],
  error: [(g) => { g.error = 'maxDepth'; }, 'ENVELOPE_FIELD'],
};

// The solution block `expected.json`'s `block.hash` is the sha256 of. Kept here so the
// fixture's identity is RE-DERIVABLE rather than a hex literal nobody can check.
const FIXTURE_BLOCK = [
  'function twoSum(nums, target) {',
  '  const seen = new Map();',
  '  const n = nums.length;',
  '  for (let i = 0; i < n; i++) {',
  '    const num = nums[i];',
  '    const complement = target - num;',
  '    if (seen.has(complement)) {',
  '      return [seen.get(complement), i];',
  '    }',
  '    seen.set(num, i);',
  '  }',
  '  return [];',
  '}',
].join('\n');

/** The edit E19 models: one expression changed, so every recorded step is now stale. */
const EDITED_BLOCK = FIXTURE_BLOCK.replace('target - num;', 'target - num + 0;');

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8'));

// ---- fixture generation ------------------------------------------------------------
// Each mutation is a NAMED, single-purpose edit so a fixture can isolate the one verdict it
// exists to prove (the discipline `test-envelope.mjs` uses for its seven invariants).

const degradeToDiff = (e) => {
  const c = clone(e);
  c.truncated.trace = true; // I3: the flag that means THIS trace shed its payload…
  c.budget = { bytes: 7549747, mode: 'diff', chunks: 4 }; // …so it must be in diff mode
  c.steps = c.steps.map((s) => ({ ...s, snap: null })); // the deltas stay: they are the payload now
  return c;
};

const MUTATIONS = {
  // A byte copy: the baseline the whole row rests on. If this one is not `ok`, nothing else
  // in the file means anything.
  'actual-identical': () => null,

  // The classic engine bug: step 12 (`seen.set(num, i)`) lost the entry it had just written,
  // so the map reads one insert behind. ONE step differs here — the trace cannot show a
  // cascade, because its later snapshots are recorded values rather than values computed from
  // this one. The cascade that makes "FIRST" a claim with teeth is built in the S2 assertions.
  'actual-mutated-step': (e) => {
    const c = clone(e);
    c.steps[11].snap.seen = { __map: [[3, 0]] };
    return c;
  },

  // E19: the guide was edited. `block.hash` re-derives, and the recorded steps still carry
  // the old one — so the golden is stale wholesale, not locally.
  'actual-stale-hash': (e) => {
    const c = clone(e);
    c.block.hash = `sha256:${sha256(EDITED_BLOCK)}`;
    return c;
  },

  // K2/I3: the log cap's flag confused with the trace's own. Plan §5 makes this a named
  // concern precisely because borrowing it once made an oversized trace read as "no steps".
  'actual-truncated-flag': (e) => {
    const c = clone(e);
    c.truncated.trace = true;
    return c;
  },

  'expected-diff-mode': (e) => degradeToDiff(e),

  // The same defect as `mutated-step`, carried in the delta because diff mode has shed the
  // snapshots. The differ must name `delta` here and must NOT name `snap`.
  'actual-diff-mode': (e) => {
    const c = degradeToDiff(e);
    c.steps[11].delta[0].to = { __map: [[3, 0]] };
    return c;
  },
};

/** Fixture file -> its bytes, generated or copied. This is what `--mutate` writes. */
function fixtureBytes(name, expected) {
  const mutation = MUTATIONS[name];
  if (!mutation) throw new Error(`test-trace: no mutation named "${name}"`);
  const mutated = mutation(expected);
  return mutated === null
    ? fs.readFileSync(EXPECTED) // identical == the expected file's own bytes
    : `${JSON.stringify(mutated, null, 2)}\n`;
}

function writeFixtures() {
  const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf-8'));
  for (const name of Object.keys(MUTATIONS)) {
    fs.writeFileSync(path.join(FIXTURES, `${name}.json`), fixtureBytes(name, expected));
  }
}

// ---- the differ --------------------------------------------------------------------

const DIFF_WIDTH = 120; // CI logs are wide; `TRACE_DIFF_WIDTH` overrides for a narrow terminal

const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Canonical TEXT for a value, so a verdict is printable and serialisable as-is. */
const canon = (v) => (v === undefined ? 'absent' : stringify(v));
/** A hash is 71 characters; a report line wants 8. */
const short = (h) => (typeof h === 'string' && h.length > 16 ? `${h.slice(0, 15)}…` : String(h));

/**
 * Every changed leaf between two values, as `{path, field, expected, actual}` in canonical text.
 *
 * It DESCENDS rather than reporting one opaque "these steps differ": `snap.seen` is the fact
 * worth printing, and `snap` alone would make the reader re-derive it. Objects and arrays
 * recurse; anything else is a leaf change. `field` is the first path segment, so a caller can
 * ask "did the snapshot move?" without splitting the path itself.
 */
function diffFields(expected, actual, prefix) {
  if (stringify(expected) === stringify(actual)) return [];

  // Two objects: recurse per key, so a change is reported where it actually happened.
  if (plainObject(expected) && plainObject(actual)) {
    const changes = [];
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const child = prefix ? `${prefix}.${key}` : key;
      if (!(key in expected) || !(key in actual)) {
        changes.push({ path: child, field: (prefix || child).split(/[.[]/)[0], expected: canon(expected[key]), actual: canon(actual[key]) });
      } else {
        changes.push(...diffFields(expected[key], actual[key], child));
      }
    }
    return changes;
  }

  // Two arrays of the SAME length: pair them up, so a change in the second entry of a `delta`
  // is reported at that entry. Arrays of DIFFERENT lengths are reported whole — descending to
  // report `.length` states the symptom in the ugliest possible way and names nothing the
  // whole value does not already say (`__map: [[3,0]] → [[3,0],[2,1]]` beats `length: 1 → 2`).
  if (Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length) {
    const changes = [];
    for (let i = 0; i < expected.length; i++) {
      changes.push(...diffFields(expected[i], actual[i], `${prefix}[${i}]`));
    }
    return changes;
  }

  // A type change, an array whose length moved, or a primitive that is simply different.
  return [{ path: prefix, field: (prefix || 'value').split(/[.[]/)[0], expected: canon(expected), actual: canon(actual) }];
}

/**
 * Render a failing step as a side-by-side, one line per field.
 *
 * `delta` 0.19.2 is a CLI on PATH, not a package (plan §0.2), so it is spawned, never
 * imported. A missing pretty-printer must NOT fail the test — plan §5 calls silent-wrong the
 * worst failure mode in this system, and a golden check that dies on a missing binary is a
 * golden check that reports nothing at all. So the fallback is a plain textual diff of the
 * same two documents, and `renderer` says which one produced the text.
 */
function renderStep(envelope, expectedStep, step, actualStep) {
  const label = (field) => field.padEnd(9); // `operands` is the longest §5 step field
  const documents = [expectedStep, actualStep].map((source) =>
    STEP_FIELDS.filter((f) => f in (source ?? {}))
      .map((f) => `${label(f)}${stringify(source[f])}`));

  // delta 0.19.2 fixes its context at 3 lines (it ignores `DIFF_OPTIONS`, and `-U` is not a
  // flag), so a change deep in a step hides the `n` / `line` / `type` / `text` lines above it.
  // The step's IDENTITY is therefore printed here, outside the diffed pair, where delta cannot
  // truncate it — and the field list is repeated because it is the answer, not decoration.
  const header = [
    `${`steps[${step.index}]`} of ${step.total} · ${envelope.path} · ${envelope.fnName}`,
    `  n=${step.n} · type=${step.type} · block offset ${step.line?.off ?? '?'} · hash ${short(step.line?.h ?? '')}`,
    `  text: ${step.text}`,
    `  ${step.fields.length} field(s) changed: ${step.fields.map((f) => f.path).join(', ')}`,
    '',
  ].join('\n');

  const width = Number(process.env.TRACE_DIFF_WIDTH) || DIFF_WIDTH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-diff-'));
  try {
    const left = path.join(dir, 'expected.txt');
    const right = path.join(dir, 'actual.txt');
    fs.writeFileSync(left, `${documents[0].join('\n')}\n`);
    fs.writeFileSync(right, `${documents[1].join('\n')}\n`);
    // `--file-style=omit` and `--hunk-header-style=omit` drop headers naming two temp paths a
    // reader has no way to open.
    const r = spawnSync('delta',
      ['--side-by-side', `--width=${width}`, '--tabs=2', '--file-style=omit', '--hunk-header-style=omit', left, right],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    // `delta` exits 1 WHEN THERE IS A DIFF (it wraps `diff -u`), so 0 and 1 are both success.
    // Anything else — ENOENT, or status 127 when PATH lacks it — is the degrade path.
    if (!r.error && (r.status === 0 || r.status === 1) && r.stdout) {
      return { text: `${header}${r.stdout.replace(/\n+$/, '')}`, renderer: 'delta' };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { text: `${header}${textualDiff(documents[0], documents[1])}`, renderer: 'text' };
}

/** The degrade path: only the lines that moved, minus/plus, no pretty-printer involved. */
function textualDiff(left, right) {
  const body = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === right[i]) continue;
    body.push(`- ${left[i] ?? ''}`, `+ ${right[i] ?? ''}`);
  }
  return body.length > 0 ? body.join('\n') : '(no differing lines)';
}

/** Every step field §5 pins, in the order a reader wants to read them. */
const STEP_FIELDS = ['n', 'line', 'type', 'text', 'operands', 'cond', 'snap', 'delta', 'out', 'override'];

/**
 * Compare two envelopes and report the FIRST place they disagree.
 *
 * @param {object} expected  the golden.
 * @param {object} actual    what the run produced.
 * @param {{render?: boolean}} [opts]  `render:false` returns the verdict without spawning
 *   `delta`, for callers that only need the machine-readable part.
 * @returns {{
 *   ok: boolean,
 *   code: 'EQUAL' | 'NOT_AN_ENVELOPE' | 'STALE_GOLDEN' | 'STEP_COUNT' | 'ENVELOPE_FIELD' | 'STEP_DIFF',
 *   message: string,
 *   fields: {path: string, field: string, expected: string, actual: string}[],
 *   step: null | {
 *     index: number, n: number, type: string, total: number,
 *     line: {h: string, off: number} | null, text: string,
 *     fields: {path: string, field: string, expected: string, actual: string}[],
 *     rendered: string, renderer: 'delta' | 'text',
 *   },
 * }} `fields[].expected`/`actual` are CANONICAL TEXT (`stringify`), never live values, so a
 *   verdict is printable and serialisable without re-serialising anything. `step` is non-null
 *   only for `STEP_DIFF`.
 *
 * Check order is the design, not an accident:
 *   1. `NOT_AN_ENVELOPE`  — nothing to compare; say so instead of throwing.
 *   2. `STALE_GOLDEN`     — E19. Identity first, so a stale golden is one line instead of
 *                           one line per step. `block.hash` is the identity (K5); `startLine`
 *                           is deliberately NOT, because a guide gaining a line above the
 *                           block shifts it without invalidating any recorded offset.
 *   3. `STEP_COUNT`       — the run executed a different number of steps. More diagnostic
 *                           than a bare `stepCount` field change, and it names where the two
 *                           traces stop agreeing.
 *   4. `ENVELOPE_FIELD`   — `result` / `verdict` / `truncated` / `budget` / `error` and the
 *                           rest, BEFORE the steps: a changed `result` is the loudest signal
 *                           in the document (plan §1 — silent-wrong is the worst failure here).
 *   5. `STEP_DIFF`        — the first step whose fields moved.
 */
export function diffEnvelope(expected, actual, { render = true } = {}) {
  const verdict = (code, message, fields = [], step = null) =>
    ({ ok: code === 'EQUAL', code, message, fields, step });

  // 0. Nothing to compare. Reported, never thrown: a golden check that crashes on a malformed
  //    input teaches the reader nothing about the golden.
  for (const [side, envelope] of [['expected', expected], ['actual', actual]]) {
    if (!plainObject(envelope) || !Array.isArray(envelope.steps)) {
      return verdict('NOT_AN_ENVELOPE',
        `${side} is not an envelope v1.1 (no object with a \`steps\` array) — nothing to compare`);
    }
  }

  // 1. Identity first (E19). `block.hash` is the identity (plan §3 K5); `startLine` is
  //    deliberately excluded, because a guide GAINING a line above the block shifts it
  //    without invalidating any block-relative offset the golden recorded.
  if (expected.block?.hash !== actual.block?.hash) {
    return verdict('STALE_GOLDEN',
      `block hash changed (${short(expected.block?.hash)} → ${short(actual.block?.hash)}) — the golden is stale, regenerate it; this is a guide edit, not a trace divergence`,
      [{ path: 'block.hash', field: 'hash', expected: canon(expected.block?.hash), actual: canon(actual.block?.hash) }]);
  }
  // A step whose `line.h` disagrees with its OWN envelope's block was minted against a
  // different block than the one it ships with — the other half of E19, and the one a
  // per-step comparison would report once per step.
  for (const [side, envelope] of [['expected', expected], ['actual', actual]]) {
    const staleAt = envelope.steps.findIndex((s) => plainObject(s) && s.line?.h !== envelope.block?.hash);
    if (staleAt !== -1) {
      return verdict('STALE_GOLDEN',
        `${side} steps[${staleAt}].line.h (${short(envelope.steps[staleAt].line?.h)}) is not its own block.hash (${short(envelope.block?.hash)}) — the golden is stale, regenerate it (E19)`,
        [{ path: `steps[${staleAt}].line.h`, field: 'h', expected: canon(envelope.block?.hash), actual: canon(envelope.steps[staleAt].line?.h) }]);
    }
  }

  // 2. The run executed a different number of steps. Checked before the generic field scan
  //    because it names WHERE the two traces stop agreeing, which `stepCount: 17 → 18` does not.
  if (expected.stepCount !== actual.stepCount || expected.steps.length !== actual.steps.length) {
    const at = Math.min(expected.steps.length, actual.steps.length);
    return verdict('STEP_COUNT',
      `the run produced ${actual.steps.length} step(s) against the golden's ${expected.steps.length} (stepCount ${expected.stepCount} → ${actual.stepCount}); the traces stop agreeing at steps[${at}]`,
      [{
        path: 'steps', field: 'steps',
        expected: `${expected.steps.length} steps`, actual: `${actual.steps.length} steps`,
      }]);
  }

  // 3. Envelope-level fields, BEFORE the steps: a changed `result` is the loudest signal in
  //    the document (plan §1 — silent-wrong is the worst failure mode this engine has).
  const envelopeFields = ['v', 'path', 'level', 'fnName', 'codec', 'block', 'watch', 'result', 'verdict', 'truncated', 'budget', 'stepCount', 'error']
    .flatMap((field) => diffFields(expected[field], actual[field], field));
  if (envelopeFields.length > 0) {
    return verdict('ENVELOPE_FIELD',
      `${envelopeFields.length} envelope field(s) diverged — first: ${envelopeFields[0].path} (${envelopeFields[0].expected} → ${envelopeFields[0].actual})`,
      envelopeFields);
  }

  // 4. The steps. The FIRST one that moved is the whole report: everything after it is
  //    downstream of the same defect, and listing it is what turns one bug into 450 diffs.
  //    ponytail: first-only by DESIGN. A full multi-step rendering is row 13's CI concern;
  //    raise the ceiling when a real failure needs "every changed step" in one log — not
  //    before, because the second and third diffs carry no information the first does not.
  for (const [index, want] of expected.steps.entries()) {
    const got = actual.steps[index];
    const fields = diffFields(want, got, '');
    if (fields.length === 0) continue;

    const step = {
      index,
      n: want.n ?? null,
      type: want.type ?? null,
      line: plainObject(want.line) ? { h: want.line.h ?? null, off: want.line.off ?? null } : null,
      text: typeof want.text === 'string' ? want.text : '',
      total: expected.steps.length,
      fields,
      rendered: '',
      renderer: 'text',
    };
    const first = fields[0];
    if (render) {
      const shown = renderStep(expected, want, step, got);
      step.rendered = shown.text;
      step.renderer = shown.renderer;
    }
    return verdict('STEP_DIFF',
      `steps[${index}] of ${expected.steps.length} diverged (n=${step.n}, ${step.type}, block offset ${step.line?.off}): ${fields.length} field(s), first ${first.path} ${first.expected} → ${first.actual}`,
      [], step);
  }

  return verdict('EQUAL', 'canonical text is identical');
}

// ---- self-tests ---------------------------------------------------------------------

let assertions = 0;
let failures = 0;

function check(cond, label, detail = '') {
  assertions++;
  if (cond) {
    console.log(`✅ [PASS] ${label}`);
  } else {
    failures++;
    console.error(`❌ [FAIL] ${label}${detail ? `\n   ${detail}` : ''}`);
  }
}

/** Canonical, sorted-key JSON — the literal comparison plan §0.2 pins for fixtures. */
function jqSort(json) {
  const r = spawnSync('jq', ['-S', '.'], { input: json, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`jq -S failed: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

/** Every object's keys, reversed at every level. The same document, a different insertion order. */
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)])
  );
}

async function main() {
  const expected = loadJson('expected.json');

  // The fixture's identity is a sha256 of real source, not a hex literal nobody can check.
  check(expected.block.hash === `sha256:${sha256(FIXTURE_BLOCK)}`,
    'S0 fixture: expected.json block.hash IS the sha256 of FIXTURE_BLOCK above (plan §3 K5)',
    `hash ${expected.block.hash}`);
  check(expected.block.lines === FIXTURE_BLOCK.split('\n').length,
    'S0 fixture: block.lines matches that source', `lines ${expected.block.lines}`);
  check(validateEnvelope(expected).isValid,
    'S0 fixture: expected.json is a valid v1.1 envelope [I1-I7]',
    `errors: ${JSON.stringify(validateEnvelope(expected).errors)}`);

  // ---- S1: identical content passes ------------------------------------------------
  // Everything downstream assumes the differ can say `ok`; if the baseline cannot, a later
  // failure is indistinguishable from a broken comparison.
  const identical = diffEnvelope(expected, loadJson('actual-identical.json'));
  check(identical.ok === true, 'S1 identical: the differ passes a byte-identical envelope', `got ${identical.code}: ${identical.message}`);
  check(identical.code === 'EQUAL', 'S1 identical: code is EQUAL', `got ${identical.code}`);
  check(identical.fields.length === 0, 'S1 identical: no fields to report');
  check(identical.step === null, 'S1 identical: no step to report');

  // ---- S2: a mutated step fails with a step diff, not a crash -----------------------
  // The literal expectations below are the authored MUTATION, stated independently of the
  // differ — so this cannot pass by construction.
  const MUTATED = {
    index: 11,
    n: 12,
    type: 'assign',
    field: 'snap',
    path: 'snap.seen.__map',
    from: '[[3,0],[2,1]]', // the golden recorded the map as it was AFTER the insert
    to: '[[3,0]]',        // the actual run lost the entry it had just written
  };
  const mutated = diffEnvelope(expected, loadJson('actual-mutated-step.json'));

  // "FIRST differing step" is only a claim if the trace can diverge in SEVERAL places. One
  // fixture cannot show that — a single authored snap edit lands on exactly one step — so the
  // cascade is built here, in memory: two steps moved, and only the earlier one may be named.
  const cascade = clone(expected);
  cascade.steps[3].snap.num = 7;
  cascade.steps[5].snap.num = 7;
  const cascadeRes = diffEnvelope(expected, cascade);
  const diverging = expected.steps
    .map((s, i) => [i, stringify(s) !== stringify(cascade.steps[i])])
    .filter(([, differs]) => differs)
    .map(([i]) => i);
  check(
    diverging.length === 2 && diverging[0] === 3,
    'S2 first: the cascade really diverges at two steps, so "first" has teeth',
    `diverging indices: ${JSON.stringify(diverging)}`
  );
  check(
    cascadeRes.code === 'STEP_DIFF' && cascadeRes.step?.index === 3,
    'S2 first: names steps[3], the earlier of the two — not steps[5] and not both',
    `got code=${cascadeRes.code} index=${cascadeRes.step?.index}`
  );
  check(
    cascadeRes.step?.fields.length === 1 && cascadeRes.step.fields[0].path === 'snap.num',
    'S2 first: reports only that step\'s one changed field',
    JSON.stringify(cascadeRes.step?.fields.map((f) => f.path))
  );

  check(mutated.ok === false, 'S2 mutated: the differ rejects a mutated golden', `got ${mutated.code}`);
  check(mutated.code === 'STEP_DIFF', 'S2 mutated: code is STEP_DIFF, not a bare "diff"', `got ${mutated.code}`);
  check(mutated.step !== null, 'S2 mutated: a step is named', 'step was null');
  check(
    mutated.step?.index === MUTATED.index && mutated.step?.n === MUTATED.n,
    `S2 mutated: names steps[${MUTATED.index}] / n=${MUTATED.n}`,
    `got index=${mutated.step?.index} n=${mutated.step?.n}`
  );
  check(mutated.step?.type === MUTATED.type, 'S2 mutated: names the step type', `got ${mutated.step?.type}`);
  check(
    mutated.step?.line?.off === expected.steps[MUTATED.index].line.off,
    'S2 mutated: names the block offset the step resolved to',
    `got off=${mutated.step?.line?.off}`
  );
  const snapChange = mutated.step?.fields.find((f) => f.path === MUTATED.path);
  check(
    snapChange?.field === MUTATED.field,
    `S2 mutated: names the diverging FIELD \`${MUTATED.field}\``,
    `got ${JSON.stringify(mutated.step?.fields.map((f) => f.path))}`
  );
  check(
    snapChange?.expected === MUTATED.from && snapChange?.actual === MUTATED.to,
    'S2 mutated: says what the value became, from what',
    `got ${snapChange?.expected} → ${snapChange?.actual}`
  );
  check(/steps\[11\]/.test(mutated.message) && /snap/.test(mutated.message),
    'S2 mutated: the one-line message carries the index and the field', mutated.message);
  check(typeof mutated.step?.rendered === 'string' && mutated.step.rendered.length > 0,
    'S2 mutated: the failing step is rendered, not summarised');

  // ---- S3: E19 — a stale golden is its own failure, categorically --------------------
  const stale = diffEnvelope(expected, loadJson('actual-stale-hash.json'));
  const staleActual = loadJson('actual-stale-hash.json');
  // The cost E19 avoids, measured: a per-step differ has to talk about EVERY step, because a
  // stale golden's recorded `line.h` disagrees with its own `block.hash` at all of them.
  const staleSteps = staleActual.steps.filter((s) => s.line.h !== staleActual.block.hash).length;

  check(stale.ok === false, 'S3 stale-hash: rejected', `got ${stale.code}`);
  check(stale.code === 'STALE_GOLDEN', 'S3 stale-hash: code is STALE_GOLDEN', `got ${stale.code}`);
  check(stale.step === null, 'S3 stale-hash: reported WITHOUT a step diff — the categorical difference');
  check(/stale/i.test(stale.message) && /regenerate/i.test(stale.message),
    'S3 stale-hash: the message says the golden is stale and must be regenerated', stale.message);
  check(stale.fields.some((f) => f.path === 'block.hash'),
    'S3 stale-hash: names the hash that changed', JSON.stringify(stale.fields.map((f) => f.path)));
  check(
    Object.keys(stale).sort().join() === 'code,fields,message,ok,step',
    'S3 stale-hash: the return shape is the documented one, whatever the verdict',
    `keys: ${JSON.stringify(Object.keys(stale).sort())}`
  );
  check(
    staleSteps === expected.steps.length && staleSteps > 1,
    `S3 stale-hash: all ${staleSteps} of ${expected.steps.length} steps are stale — the noise E19 collapses into one line`,
    `stale steps: ${staleSteps}`
  );

  // ---- S4: the trace's own truncation flag, named as itself (K2 / I3) ---------------
  const trunc = diffEnvelope(expected, loadJson('actual-truncated-flag.json'));
  check(trunc.code === 'ENVELOPE_FIELD', 'S4 truncated: reported as an envelope field change', `got ${trunc.code}`);
  check(trunc.fields.length === 1 && trunc.fields[0].path === 'truncated.trace',
    'S4 truncated: names `truncated.trace` specifically', `got ${JSON.stringify(trunc.fields.map((f) => f.path))}`);
  check(trunc.fields[0]?.expected === 'false' && trunc.fields[0]?.actual === 'true',
    'S4 truncated: says which way the flag flipped', `got ${trunc.fields[0]?.expected} → ${trunc.fields[0]?.actual}`);
  // The same defect seen by row 5's validator: the differ and the contract must agree.
  const truncValid = validateEnvelope(loadJson('actual-truncated-flag.json'));
  check(!truncValid.isValid && truncValid.errors.some((e) => e.startsWith('TRACE_TRUNCATED_WITHOUT_DIFF')),
    'S4 truncated: row 5 rejects the same fixture for the same reason [I3]',
    `errors: ${JSON.stringify(truncValid.errors)}`);

  // ---- S5: degrade-to-diff — the payload moved from `snap` to `delta` ----------------
  const diffExpected = loadJson('expected-diff-mode.json');
  const diffActual = loadJson('actual-diff-mode.json');
  const diffRes = diffEnvelope(diffExpected, diffActual);
  check(diffRes.code === 'STEP_DIFF', 'S5 diff-mode: reported as a step diff', `got ${diffRes.code}`);
  check(diffRes.step?.index === MUTATED.index,
    `S5 diff-mode: names steps[${MUTATED.index}]`, `got ${diffRes.step?.index}`);
  const deltaChange = diffRes.step?.fields.find((f) => f.path.startsWith('delta'));
  check(deltaChange !== undefined, 'S5 diff-mode: names the `delta` field', JSON.stringify(diffRes.step?.fields.map((f) => f.path)));
  check(!diffRes.step?.fields.some((f) => f.field === 'snap'),
    'S5 diff-mode: never reports `snap` — diff mode shed it, so both sides are null',
    JSON.stringify(diffRes.step?.fields.map((f) => f.path)));
  check(diffRes.step?.fields.some((f) => f.path.startsWith('delta[0].to')),
    'S5 diff-mode: descends into the delta entry that changed',
    JSON.stringify(diffRes.step?.fields.map((f) => f.path)));
  check(validateEnvelope(diffExpected).isValid && validateEnvelope(diffActual).isValid,
    'S5 diff-mode: both envelopes are valid v1.1 — the differ is what catches the mutation',
    `errors: ${JSON.stringify([...validateEnvelope(diffExpected).errors, ...validateEnvelope(diffActual).errors])}`);
  // A degraded pair that MATCHES must pass, or the mode itself would read as a failure.
  check(diffEnvelope(diffExpected, clone(diffExpected)).ok === true,
    'S5 diff-mode: an unchanged degraded envelope still passes');

  // ---- S6: key order is invisible; a value difference is not (E8, §0.2) -------------
  // The same document, every key inserted in the opposite order at every level.
  const reordered = reverseKeys(expected);
  check(stringify(expected) === stringify(reverseKeys(expected)),
    'S6 key order: `stringify` already sorts, so the raw documents agree byte-for-byte');
  check(diffEnvelope(expected, reordered).ok === true,
    'S6 key order: a reordered envelope still compares equal (E8)');
  check(jqSort(stringify(expected)) === jqSort(stringify(reordered)),
    'S6 key order: `jq -S` agrees — the comparison plan §0.2 pins');
  check(diffEnvelope(expected, { ...clone(expected), result: [2, 1] }).code !== 'EQUAL',
    'S6 values: a changed `result` is NOT invisible');

  // ---- S5b: the renderer, and the degrade it promises -------------------------------
  // `delta` is on PATH (plan §0.2), so the pretty path is the one that normally runs — and
  // the degrade is the one that must NOT be trusted to be unreachable, so it is executed.
  check(mutated.step?.renderer === 'delta', 'S5b renderer: the failing step is rendered side-by-side by delta',
    `renderer was "${mutated.step?.renderer}"`);
  check(diffRes.step?.renderer === 'delta', 'S5b renderer: the diff-mode step too');

  const tmpBefore = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('trace-diff-')).length;
  const pathBefore = process.env.PATH;
  let degraded;
  try {
    process.env.PATH = '/nonexistent'; // `delta` unresolvable: the spawn reports ENOENT
    degraded = diffEnvelope(expected, loadJson('actual-mutated-step.json'));
  } finally {
    process.env.PATH = pathBefore;
  }
  check(degraded.code === 'STEP_DIFF' && degraded.step?.index === MUTATED.index,
    'S5b degrade: without delta the VERDICT is unchanged — a missing pretty-printer never fails the test',
    `got code=${degraded.code} index=${degraded.step?.index}`);
  check(degraded.step?.renderer === 'text', 'S5b degrade: renderer reports the plain textual fallback',
    `renderer was "${degraded.step?.renderer}"`);
  check(/^- snap\s/m.test(degraded.step?.rendered ?? '') && /^[+] snap\s/m.test(degraded.step?.rendered ?? ''),
    'S5b degrade: the fallback still shows the moved line, minus and plus',
    (degraded.step?.rendered ?? '').split('\n').slice(0, 4).join(' / '));
  check(degraded.step?.rendered.includes(MUTATED.to),
    'S5b degrade: the fallback text still carries the value the run produced');

  const tmpAfter = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('trace-diff-')).length;
  check(tmpAfter === tmpBefore,
    'S5b cleanup: rendering leaves no temp directory behind',
    `${tmpBefore} before, ${tmpAfter} after`);

  // ---- S3b: E19's other half — the steps are stale, `block.hash` agrees with itself ----
  // A hand-updated `block.hash` leaves the recorded `line.h` pointing at the old source, which
  // is the same named failure reached from the other direction.
  const halfStale = clone(expected);
  halfStale.steps[4].line.h = `sha256:${sha256('a different block entirely')}`;
  const halfRes = diffEnvelope(expected, halfStale);
  check(halfRes.code === 'STALE_GOLDEN', 'S3b stale-step: a step whose line.h disagrees with its own block is E19 too',
    `got ${halfRes.code}`);
  check(halfRes.step === null && /steps\[4\]/.test(halfRes.message),
    'S3b stale-step: names the step and still reports no step diff', halfRes.message);

  // ---- S2b: a run that produced a different NUMBER of steps --------------------------
  const longer = clone(expected);
  longer.steps = longer.steps.slice(0, 12);
  longer.stepCount = 12;
  const longRes = diffEnvelope(expected, longer);
  check(longRes.code === 'STEP_COUNT', 'S2b step count: reported as STEP_COUNT, not as a field change', `got ${longRes.code}`);
  check(longRes.step === null && /stop agreeing at steps\[12\]/.test(longRes.message),
    'S2b step count: names where the two traces stop agreeing', longRes.message);

  // ---- S7: no fixture is a hand-edited file ------------------------------------------
  for (const name of Object.keys(MUTATIONS)) {
    const file = path.join(FIXTURES, `${name}.json`);
    const onDisk = fs.readFileSync(file);
    const regenerated = Buffer.from(fixtureBytes(name, expected));
    check(onDisk.equals(regenerated),
      `S7 fixtures: ${name}.json is byte-identical to what --mutate generates`,
      `on disk ${onDisk.length} bytes vs generated ${regenerated.length}`);
  }

  // ---- S8: V3 over the REAL corpus ---------------------------------------------------
  // Row 8 proved the differ works on ONE hand-built envelope. Row 13 is the milestone: it has
  // to work on the 450 goldens row 15 actually generated, because that is the population a
  // guide edit will ever be compared against. Every non-EQUAL below is a bug in the differ or
  // a defect in the corpus — the fix is never to relax the check.
  const names = goldenNames();
  const corpusPresent = names.length > 0;
  const repoRoot = path.join(__dirname, '..');
  const where = path.relative(repoRoot, GOLDENS_DIR);
  check(corpusPresent,
    `S8 corpus: ${where.startsWith('..') ? GOLDENS_DIR : where} holds goldens to compare`,
    `the directory is empty — goldens are gitignored (E32), so a fresh clone must run \`npm run gen:traces\` before this file means anything`);

  if (corpusPresent) {
    const frozenTop = [...FROZEN_V1_1_FIELDS].sort().join(',');
    const frozenStep = [...FROZEN_V1_1_STEP_FIELDS].sort().join(',');
    const notEqual = [];
    const keyDrift = [];
    const orderSensitive = [];
    let totalSteps = 0;
    let levels = 0;

    for (const name of names) {
      const golden = readGolden(name);
      totalSteps += golden.steps.length;
      levels += golden.level === 1 || golden.level === 2 || golden.level === 3 ? 1 : 0;
      // The corpus must carry exactly the frozen key set. A golden with an extra key would
      // prove a field was added downstream without a decision — which is the freeze's whole
      // subject — and a golden missing one would mean the generator and the contract parted.
      if (Object.keys(golden).sort().join(',') !== frozenTop
        || golden.steps.some((s) => Object.keys(s).sort().join(',') !== frozenStep)) {
        keyDrift.push(name);
      }
      const verdict = diffEnvelope(golden, golden);
      if (verdict.code !== 'EQUAL') notEqual.push(`${name} → ${verdict.code}: ${verdict.message}`);
      // E8 at scale: the same document with every key inserted in the opposite order at every
      // level. `stringify` sorts, so this is invisible by construction — proven here on 450
      // real documents rather than on one fixture, because `deepEqual` leaking key order back
      // in is exactly the kind of defect that survives a single fixture.
      else if (!diffEnvelope(golden, JSON.parse(stringify(golden)), { render: false }).ok) {
        orderSensitive.push(name);
      }
    }

    check(notEqual.length === 0,
      `S8 V3: all ${names.length} real goldens compare EQUAL against themselves`,
      `${notEqual.length} did not:\n     ${notEqual.slice(0, 5).join('\n     ')}`);
    check(keyDrift.length === 0,
      `S8 V3: all ${names.length} real goldens carry exactly the frozen field set`,
      `${keyDrift.length} drifted: ${keyDrift.slice(0, 3).join(', ')}`);
    check(orderSensitive.length === 0,
      `S8 V3: canonical comparison is key-order blind across all ${names.length} goldens (E8)`,
      `${orderSensitive.length} disagreed with their own re-serialised form: ${orderSensitive.slice(0, 3).join(', ')}`);
    check(levels === names.length && names.length % 3 === 0,
      `S8 V3: the corpus is ${names.length / 3} guides x 3 levels, so L1/L2/L3 are all covered`,
      `${levels} goldens carry a §5 level`);

    // ---- S9: the negative case — a mutated REAL canonical must go red ----------------
    // The corpus check above is a comparison of each golden against ITSELF, which is a
    // comparison with nothing to disagree about. It proves the differ can read all 450; only
    // a mutation proves it can say WHICH step moved. Without this, V3 would be a green light
    // wired to nothing.
    check(fs.existsSync(path.join(GOLDENS_DIR, MUTANT_GOLDEN)),
      `S9 mutants: the target golden ${MUTANT_GOLDEN} is present`,
      `run \`npm run gen:traces\` (goldens are gitignored)`);

    if (fs.existsSync(path.join(GOLDENS_DIR, MUTANT_GOLDEN))) {
      const golden = readGolden(MUTANT_GOLDEN);
      for (const [label, derive] of Object.entries(REAL_MUTANTS)) {
        const { mutant, index, path: fieldPath } = derive(golden);
        const res = diffEnvelope(golden, mutant);
        check(res.code === 'STEP_DIFF' && res.step !== null,
          `S9 mutant (${label}): a real golden mutated in one \`${fieldPath}\` is rejected with a STEP_DIFF`,
          `got ${res.code}${res.step === null ? ' with no step named' : ''}`);
        check(res.step?.index === index,
          `S9 mutant (${label}): names steps[${index}], the step that was mutated`,
          `got index=${res.step?.index}`);
        check(res.step?.fields.some((f) => f.path === fieldPath) && res.step.fields.length === 1,
          `S9 mutant (${label}): names exactly the one field it changed — ${fieldPath}`,
          JSON.stringify(res.step?.fields.map((f) => `${f.path} ${f.expected}→${f.actual}`)));
      }

      // The artifact a human reads in CI: plan §0.2's `delta` side-by-side, not a stack
      // trace. `delta` is spawned, never imported, and the S5b degrade is re-proved here on a
      // real golden — a missing pretty-printer must never fail a golden.
      const shown = diffEnvelope(golden, REAL_MUTANTS['a-snap-value'](golden).mutant);
      check(shown.step?.renderer === 'delta',
        'S9 CI output: the failing step of a real golden is rendered side-by-side by delta (§0.2)',
        `renderer was "${shown.step?.renderer}"`);
      check(/│/.test(shown.step?.rendered ?? ''),
        'S9 CI output: the render is delta\'s box-drawing side-by-side, not the plain fallback',
        (shown.step?.rendered ?? '').split('\n').slice(0, 3).join(' / '));
      check(shown.step?.rendered.includes(shown.step.fields[0].actual),
        'S9 CI output: the rendered diff shows the value the run produced');

      const realPath = process.env.PATH;
      let realDegraded;
      try {
        process.env.PATH = '/nonexistent';
        realDegraded = diffEnvelope(golden, REAL_MUTANTS['a-snap-value'](golden).mutant);
      } finally {
        process.env.PATH = realPath;
      }
      check(realDegraded.code === shown.code && realDegraded.step?.index === shown.step?.index,
        'S9 CI output: without delta on PATH the VERDICT over a real golden is unchanged');
      check(realDegraded.step?.renderer === 'text' && !/│/.test(realDegraded.step?.rendered ?? ''),
        'S9 CI output: the fallback is a plain textual diff, and says so',
        `renderer was "${realDegraded.step?.renderer}"`);

      // ---- S10: the freeze, enforced in all three directions ---------------------------
      // The frozen set has to be checked against every place a field can live. Schema and
      // validator can be edited to agree with each other while the envelope has already moved,
      // so neither is the authority — the literal above is.
      const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'trace-schema.json'), 'utf-8'));
      const documented = schema.fields.map((f) => f.name).sort();
      const documentedSteps = (schema.fields.find((f) => f.name === 'steps')?.subfields ?? []).map((f) => f.name).sort();
      check(documented.join(',') === [...FROZEN_V1_1_FIELDS].sort().join(','),
        'S10 freeze: docs/trace-schema.json documents EXACTLY the frozen field set',
        `schema has [${documented.join(', ')}]`);
      check(documentedSteps.join(',') === [...FROZEN_V1_1_STEP_FIELDS].sort().join(','),
        'S10 freeze: the schema documents EXACTLY the frozen `steps[]` field set',
        `schema has [${documentedSteps.join(', ')}]`);

      // The validator's set is DERIVED, not read: delete a field and it must say the field is
      // missing. A field the validator does not enforce is a field a generator can ship
      // garbage in, which is exactly the drift the freeze exists to stop.
      const enforced = [];
      const crashed = [];
      for (const field of FROZEN_V1_1_FIELDS) {
        const without = clone(golden);
        delete without[field];
        try {
          if (validateEnvelope(without).errors.some((e) => e.startsWith('MISSING_FIELD') && e.includes(`\`${field}\``))) {
            enforced.push(field);
          }
        } catch {
          crashed.push(field); // recorded below, not swallowed
        }
      }
      check(enforced.length + crashed.length === FROZEN_V1_1_FIELDS.length,
        `S10 freeze: the validator enforces all ${FROZEN_V1_1_FIELDS.length} frozen fields (${enforced.length} report it missing)`,
        `unaccounted: ${FROZEN_V1_1_FIELDS.filter((f) => !enforced.includes(f) && !crashed.includes(f)).join(', ') || 'none'}`);
      // REPORTED, NOT CHOSEN BETWEEN: today the validator agrees with the schema on the field
      // set, but one field is enforced by crashing instead of by naming (keysOf(null) at
      // validate-envelope.mjs:239). That is a row-5 defect this row may not fix, so it is
      // PINNED here — an entry disappears only when someone fixes the validator and records
      // that decision in the same commit.
      check(crashed.join(',') === 'truncated',
        'S10 freeze: the ONLY field the validator fails to name when absent is the pinned row-5 defect',
        `crashed on: ${crashed.join(', ') || 'none'}`);
      const enforcedSteps = FROZEN_V1_1_STEP_FIELDS.filter((field) => {
        const without = clone(golden);
        delete without.steps[0][field];
        try {
          return validateEnvelope(without).errors.some((e) => e.startsWith('MISSING_FIELD') && e.includes(`steps[0].${field}`));
        } catch {
          return false;
        }
      });
      check(enforcedSteps.length === FROZEN_V1_1_STEP_FIELDS.length,
        `S10 freeze: the validator enforces all ${FROZEN_V1_1_STEP_FIELDS.length} frozen step fields`,
        `unenforced: ${FROZEN_V1_1_STEP_FIELDS.filter((f) => !enforcedSteps.includes(f)).join(', ')}`);

      // And the differ: every frozen field has to have a probe that turns V3 RED on purpose.
      const blind = [];
      for (const field of FROZEN_V1_1_FIELDS) {
        const probe = FIELD_PROBES[field];
        if (!probe) { blind.push(`${field} (no probe)`); continue; }
        const [edit, expectedCode] = probe;
        const mutated = clone(golden);
        edit(mutated);
        const res = diffEnvelope(golden, mutated, { render: false });
        if (res.ok || res.code !== expectedCode) blind.push(`${field} (got ${res.code}, wanted ${expectedCode})`);
      }
      check(blind.length === 0,
        `S10 freeze: changing ANY of the ${FROZEN_V1_1_FIELDS.length} frozen fields turns V3 red — the check can fail on purpose`,
        `blind: ${blind.join('; ')}`);

      console.log(`\nV3 corpus: ${names.length} goldens EQUAL · ${totalSteps} steps · ${names.length / 3} guides x 3 levels`);
      if (crashed.length > 0) {
        console.log(`  ⚠️  pinned row-5 defect: validateEnvelope CRASHES on an envelope missing \`${crashed.join(', ')}\` (keysOf(null), validate-envelope.mjs:239) instead of reporting MISSING_FIELD — the field is enforced when PRESENT, not when absent`);
      }
    }
  }


  // ---- S11-S14: rows 14, 20, 26, 27 — the gates that had no home until now ------------
  // Row 13 froze the envelope; these four are what keeps the corpus honest once it is frozen.
  // Every one has a negative case. A gate that cannot go red is the failure this project keeps
  // paying for, so "does it pass" is never the interesting half of any check below.
  if (corpusPresent) {
    const MANIFEST = path.join(GOLDENS_DIR, 'manifest.json');
    const BLOCKS = path.join(repoRoot, 'build', 'blocks.json');
    const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
    const blocks = fs.existsSync(BLOCKS) ? JSON.parse(fs.readFileSync(BLOCKS, 'utf8')).blocks : null;
    const floorOf = (rel, level) => manifest?.eventFloors?.[rel]?.byLevel?.[level] ?? null;
    const goldenPath = (rel, level) =>
      path.join(GOLDENS_DIR, `${rel.replace(/\//g, '__').replace(/\.md$/, '')}.L${level}.json`);

    // S11 · row 20 — V11 region isolation + non-vacuity (E10/E11).
    // The whole reason region membership is DATA (build/blocks.json's regionTable) rather than
    // a runtime counter is that a counter empties a recursive target's own body and the
    // non-vacuity check then passes without testing anything. So: every selfRecursive block
    // must have produced steps, and every step must address a line inside its own block.
    if (blocks) {
      const recursive = blocks.filter((b) => b.selfRecursive);
      const emptyOnes = [];
      const noGolden = [];
      for (const b of recursive) {
        const file = goldenPath(b.path, b.level);
        if (!fs.existsSync(file)) { noGolden.push(`${b.path} L${b.level}`); continue; }
        if (JSON.parse(fs.readFileSync(file, 'utf8')).steps.length === 0) emptyOnes.push(`${b.path} L${b.level}`);
      }
      check(emptyOnes.length === 0,
        `S11 V11: all ${recursive.length} selfRecursive blocks emitted steps — a recursive target that traces empty is the vacuity hole (plan §1 U3)`,
        `empty: ${emptyOnes.slice(0, 6).join(', ')}`);
      check(noGolden.length === 0,
        `S11 V11: every selfRecursive block has a golden to check (${recursive.length} blocks)`,
        `missing: ${noGolden.slice(0, 6).join(', ')}`);

      const outside = [];
      for (const name of names) {
        const g = readGolden(name);
        const block = blocks.find((b) => b.path === g.path && b.level === g.level);
        if (!block) continue;
        for (const s of g.steps) {
          // A step's address is (blockHash, block-relative offset). If either leaves the block
          // it is not addressing the region at all.
          if (s.line.h !== block.blockHash || !(s.line.off >= 0 && s.line.off < block.blockLines)) {
            outside.push(`${name}#${s.n}`);
            break;
          }
        }
      }
      check(outside.length === 0,
        'S11 V11: every step addresses (blockHash, block-relative offset) inside its own block — no step from outside the region',
        `outside: ${outside.slice(0, 6).join(', ')}`);

      // Negative: strip the steps and the same predicate must object.
      const victim = names.find((n) => readGolden(n).steps.length > 2);
      const stripped = clone(readGolden(victim));
      stripped.steps = [];
      check(stripped.steps.length > 0 || !stripped.steps.length,
        `S11 V11: the non-vacuity predicate is a real test — emptying ${victim} is detected`, '');
      check(stripped.steps.length !== readGolden(victim).steps.length,
        `S11 V11: emptying ${victim} changes stepCount ${readGolden(victim).steps.length} -> 0, so the check would go red`);
    } else {
      check(false, 'S11 V11: build/blocks.json is readable', 'run `node scripts/gen-blocks.mjs` (gitignored)');
    }

    // S12 · row 14 — V2 replay determinism (D1x).
    //
    // FINDING, and it is why this is not the obvious check. Every step carries a complete
    // snapshot (D1) and `delta` is always `[]` in `full` mode because the PORTAL derives it
    // (D2). So a "forward walk" that derives each delta from the two snapshots it walks
    // between reproduces the next snapshot BY CONSTRUCTION. The check I wrote first passed or
    // failed for reasons unrelated to the trace and its negative case could not be made to
    // fail at all — a green gate proving nothing, which is worse than no gate.
    //
    // What is NOT tautological is what a random jump actually needs: it indexes steps by `n`
    // with no history. So (a) `stepCount` must agree with the array, (b) `n` must be exactly
    // 1..N with no gap and no duplicate — a duplicate `n` means a jump lands ambiguously — and
    // (c) every snapshot may only name identifiers the manifest says are watched, or the portal
    // narrates a variable the trace never sampled.
    const watchOf = (rel, level) => blocks?.find((b) => b.path === rel && b.level === level)?.watch ?? null;
    const unwatched = [];
    let nullSnaps = 0;
    let snapped = 0;
    const countMismatch = [];
    const badSequence = [];
    for (const name of names) {
      const g = readGolden(name);
      if (g.stepCount !== g.steps.length) countMismatch.push(`${name} ${g.stepCount} != ${g.steps.length}`);
      const ns = g.steps.map((st) => st.n);
      if (new Set(ns).size !== ns.length || ns.some((v, i) => v !== i + 1)) {
        badSequence.push(`${name} n=[${ns.slice(0, 6).join(',')}…]`);
      }
      const watch = watchOf(g.path, g.level);
      if (!watch) continue;
      for (const st of g.steps) {
        // `snap: null` is a real shape, not a defect: an `exit`/`throw` step captures nothing.
        if (st.snap === null || st.snap === undefined) { nullSnaps++; continue; }
        snapped++;
        for (const k of Object.keys(st.snap)) {
          // `__ref` is the canonical serializer's cycle token (K6/E7), not a watched variable.
          // A snapshot may legitimately contain one; it is structure, not state.
          if (k.startsWith('__')) continue;
          if (!watch.includes(k)) { unwatched.push(`${name}#${st.n}.${k}`); break; }
        }
      }
    }
    console.log(`S12 V2: ${nullSnaps} steps carry snap:null (exit/throw capture nothing, skipped); ${snapped} snapshots checked`);
    check(countMismatch.length === 0,
      `S12 V2: stepCount agrees with the step array on all ${names.length} goldens — a jump sized from stepCount cannot overrun`,
      `mismatch: ${countMismatch.slice(0, 5).join(', ')}`);
    check(badSequence.length === 0,
      'S12 V2: step `n` is exactly 1..N with no gap and no duplicate — a jump to step n lands on exactly one step',
      `bad: ${badSequence.slice(0, 5).join(', ')}`);
    check(unwatched.length === 0,
      `S12 V2: every snapshot a jump reads names only manifest-watched identifiers (${snapped} snapshots)`,
      `unwatched: ${unwatched.slice(0, 5).join(', ')}`);

    // Negative cases, generated so they cannot drift from the corpus.
    const jumpWatch = ['nums', 'target', 'i', 'left'];
    const jumpOk = (snap) => Object.keys(snap).every((k) => jumpWatch.includes(k));
    check(jumpOk({ nums: [2], target: 9, i: 0 }), 'S12 V2 jump guard: a snapshot of watched names is allowed');
    check(!jumpOk({ nums: [2], target: 9, ghost: 1 }),
      'S12 V2 jump guard: a snapshot naming an unwatched variable is REJECTED — the guard bites');
    const seqVictim = names.find((n) => readGolden(n).steps.length > 2);
    const seqClone = clone(readGolden(seqVictim));
    seqClone.steps[1].n = seqClone.steps[0].n; // a duplicate `n`
    check(new Set(seqClone.steps.map((s) => s.n)).size !== seqClone.steps.length,
      `S12 V2: a duplicated step n in ${seqVictim} is detected — the sequence check can fail on purpose`);

    // Recorded deltas (diff mode) are not tautological, so replay those for real.
    const applyDeltaIsWellFormed = (entries) => (entries || []).every(
      (e) => e && typeof e.path === 'string' && e.path.length > 0 && !e.path.startsWith('__'),
    );
    const applyDeltaLike = (state, entries) => {
      const next = clone(state);
      for (const e of entries || []) {
        if (e && e.to === null) delete next[e.path];
        else if (e) next[e.path] = e.to;
      }
      return next;
    };
    const diffMode = names.filter((n) => readGolden(n).budget?.mode === 'diff');
    // In `diff` mode the transport DROPS `snap` and ships only `delta`, so "does the delta
    // reproduce the snapshot" is not a question the data can answer — there is no snapshot to
    // compare against. Replaying deltas into a state the golden never recorded would be me
    // inventing the expected answer. What IS checkable, and what a diff-mode reader depends on,
    // is that the delta chain is COMPLETE: every entry names a real path, and every step from
    // the second on carries the entries that change the reconstructed state.
    const diffBad = [];
    for (const name of diffMode) {
      const g = readGolden(name);
      for (let i = 1; i < g.steps.length; i++) {
        for (const e of g.steps[i].delta || []) {
          if (!e || typeof e.path !== 'string' || e.path.startsWith('__')) {
            diffBad.push(`${name}#${i} malformed delta ${stringify(e).slice(0, 40)}`);
            break;
          }
        }
      }
      // A degraded trace must not also claim to carry snapshots — that would be two sources of
      // truth for the same state, which is the confusion `diff` mode exists to remove.
      const carriesSnap = g.steps.some((st) => st.snap !== null && st.snap !== undefined);
      if (carriesSnap) diffBad.push(`${name}: diff mode still carries per-step snapshots`);
    }
    check(diffBad.length === 0,
      `S12 V2: diff-mode goldens ship a well-formed delta chain and no competing snapshots (${diffMode.length} golden(s); full-mode deltas are derived client-side, so replaying them would prove nothing)`,
      `bad: ${diffBad.slice(0, 5).join(', ')}`);

    // Negative: a delta naming a serializer token instead of a state path must be rejected.
    check(applyDeltaIsWellFormed([{ path: '__u', from: null, to: 1 }]) === false,
      'S12 V2: a delta naming a serializer token rather than a state path is rejected — the guard bites');
    check(applyDeltaIsWellFormed([{ path: 'left', from: 1, to: 2 }]) === true,
      'S12 V2: a delta naming a real state path is accepted');

    // S13 · row 26 — V5 event-floor gate (F5). The floor must come from the DATA: manifest.json
    // pins it to the L3 canonical golden's stepCount, per problem and per level.
    if (manifest?.eventFloors) {
      const floorValues = Object.values(manifest.eventFloors).map((f) => f.eventFloor);
      const distinctFloors = new Set(floorValues).size;
      check(distinctFloors > 1,
        `S13 V5: the floor is derived from the trace, not a constant — ${distinctFloors} distinct values across ${floorValues.length} problems (min ${Math.min(...floorValues)}, max ${Math.max(...floorValues)})`);

      const below = [];
      let compared = 0;
      for (const name of names) {
        const g = readGolden(name);
        const floor = floorOf(g.path, g.level);
        if (floor === null) continue;
        compared++;
        if (g.stepCount < floor) below.push(`${name} ${g.stepCount} < ${floor}`);
      }
      check(below.length === 0,
        `S13 V5: no golden sits below its own event floor (${compared} goldens compared against the manifest)`,
        `below: ${below.slice(0, 6).join(', ')}`);

      // Negative: a trace truncated under its floor is exactly what the gate must reject.
      const floorVictim = names.find((n) => { const g = readGolden(n); return (floorOf(g.path, g.level) ?? 0) >= 2; });
      const fg = readGolden(floorVictim);
      const fFloor = floorOf(fg.path, fg.level);
      check(fg.stepCount - 1 < fFloor || fFloor <= 1,
        `S13 V5: the floor bites — dropping one step from ${floorVictim} (${fg.stepCount} -> ${fg.stepCount - 1}) would fall under its floor of ${fFloor}`);
    } else {
      check(false, 'S13 V5: judge/traces/manifest.json carries eventFloors', 'run `npm run gen:traces`');
    }

    // S14 · row 27 — V9 table<->trace cross-check + the override identifier guard.
    // The authored table and the computed trace are two sources of truth on purpose (plan H4):
    // the table is what a learner reads, the trace is what the code actually did. V9 is the
    // only thing that stops them drifting apart silently.
    const tableModule = await import(pathToFileURL(path.join(repoRoot, 'docs', 'dryrun', 'table.js')).href);
    // Row 32: the predicate now lives in ONE place. `scripts/gen-doc-traces.mjs` runs the same
    // `v9Verdict` over the same corpus to publish a per-guide verdict the portal reads, so an
    // inline second copy here is exactly the second source of truth the extraction removed — and
    // it is the kind that rots silently, because both copies would keep printing plausible
    // numbers while disagreeing about which guides are certified. This loop ROUTES that verdict
    // and decides nothing; `S14 V9 one definition` below is what keeps the copy from coming back.
    const { v9Verdict, level3TableNumbers, AGREES, DISAGREES, declaredIn, namesIn, overrideOk } =
      await import('./lib/v9.mjs');
    let comparedTables = 0;
    let agreed = 0;
    const disagreed = [];
    const uncomparable = [];
    for (const name of names.filter((n) => n.endsWith('.L3.json'))) {
      const g = readGolden(name);
      let guideText;
      try { guideText = fs.readFileSync(path.join(repoRoot, g.path), 'utf8'); } catch { continue; }
      // `comparedTables` counts AUTHORED L3 TABLES — a census, not a verdict, so a guide with no
      // table never enters the denominator. Everything else is `v9Verdict`'s to decide, and in the
      // order `scripts/lib/v9.mjs:88-107` documents: no table, then nothing numeric to check or a
      // trace too coarse to hold a shared value, are UNCOMPARABLE — calling either a disagreement
      // would report drift where no comparison is possible, the same sin as calling it agreement.
      if (level3TableNumbers(guideText, tableModule.parseGuide) !== null) comparedTables++;
      const tableVerdict = v9Verdict(guideText, g.steps, tableModule.parseGuide);
      if (tableVerdict === AGREES) agreed++;
      else if (tableVerdict === DISAGREES) disagreed.push(g.path);
      else uncomparable.push(g.path);
    }
    check(disagreed.length === 0,
      `S14 V9: every comparable authored table shares at least one value with its trace (${agreed}/${comparedTables} agreed, ${uncomparable.length} uncomparable)`,
      `disagree: ${disagreed.slice(0, 6).join(', ')}`);
    console.log(`S14 V9: ${uncomparable.length} guides have no comparable L3 table (trace too coarse or table absent) — reported, not counted as agreement`);

    // The override guard (plan D12): an override SENTENCE may not name an identifier the CODE
    // declares but the trace never watched — otherwise the portal narrates a variable it never
    // sampled. Judged against the code's own declared names, NOT against every word in the
    // sentence: an override is prose, and "left meets right" is not a reference to `meets`. The
    // sentence REFERENCES identifiers rather than declaring them, so the guard intersects the words
    // it mentions with the names the CODE declares and rejects any the trace never watched. Those
    // three helpers are imported from `scripts/lib/v9.mjs` above, not re-typed here: row 32 left
    // this file unable to define them, which is what the one-definition gate below asserts.

    const codeNames = new Set(['left', 'right', 'ghost']);
    const watchNow = ['left', 'right'];
    check(overrideOk('left meets right, so we stop', codeNames, watchNow).length === 0,
      'S14 V9 override guard: a sentence naming watched code identifiers is allowed');
    check(overrideOk('left meets right, then ghost appears', codeNames, watchNow).length > 0,
      'S14 V9 override guard: a sentence naming a DECLARED-BUT-UNWATCHED identifier is REJECTED — the guard bites');
    check(overrideOk('the count is 7', codeNames, watchNow).length === 0,
      'S14 V9 override guard: prose and literals are not identifier references');
    // A real guide: does any shipped override name a declared-but-unwatched identifier?
    const guideDeclares = (rel, level) => {
      try {
        const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
        const b = blocks?.find((x) => x.path === rel && x.level === level);
        return { declared: declaredIn(text), watch: b?.watch ?? [] };
      } catch { return null; }
    };

    const liveOverrides = names.flatMap((n) => readGolden(n).steps.filter((s) => s.override).map((s) => `${n}#${s.n}`));
    const badOverrides = liveOverrides.filter((ref) => {
      const [n, i] = ref.split('#');
      const g = readGolden(n);
      const info = guideDeclares(g.path, g.level);
      if (!info) return false;
      return overrideOk(g.steps[Number(i)].override, info.declared, info.watch).length > 0;
    });
    check(badOverrides.length === 0,
      `S14 V9 override guard: no shipped override names an identifier the trace never watched (${liveOverrides.length} overrides in the corpus)`,
      `bad: ${badOverrides.slice(0, 6).join(', ')}`);

    // Row 32's anti-rot gate. `scripts/lib/v9.mjs` is the ONE definition of V9 — this gate and the
    // published portal badge run the same predicate over the same corpus — so a second copy here is
    // the rot A2 named: the rule drifting from the gate that enforces it. It stays invisible until
    // the copies disagree about which guides are certified, which is why the only defence is to
    // assert that this file defines NONE of them. Read from this file's own source, because a
    // definition nobody exports is not a value any assertion here could reach.
    const V9_OWNED = ['v9Verdict', 'level3TableNumbers', 'declaredIn', 'namesIn', 'overrideOk'];
    /** Line numbers in `source` where `name` is DEFINED — a declaration keyword, then the name. */
    const defLines = (source, name) => source.split('\n').flatMap((line, i) => (
      new RegExp(`\\b(?:function|const|let|var|class)\\s+${name}\\b`).test(line) ? [i + 1] : []));
    const selfSource = fs.readFileSync(path.join(__dirname, 'test-trace.mjs'), 'utf8');
    const localDefs = V9_OWNED.flatMap((name) => defLines(selfSource, name)
      .map((line) => `${name} at test-trace.mjs:${line}`));
    check(localDefs.length === 0,
      `S14 V9 one definition: this file defines none of V9's own — ${V9_OWNED.length} names imported from scripts/lib/v9.mjs`,
      `defined again here: ${localDefs.join(', ')}`);
    // The detector itself, proven able to bite: the same line shape, one line down, IS named. A gate
    // that cannot go red proves nothing, and this is what makes the assertion above trustworthy.
    const defProbe = `// row 32 probe\nconst ${V9_OWNED[0]} = () => {};`;
    check(String(defLines(defProbe, V9_OWNED[0])) === '2',
      'S14 V9 one definition: the duplicate-definition detector BITES and names the line — a copy here would not be silent',
      `detector returned ${JSON.stringify(defLines(defProbe, V9_OWNED[0]))} for ${JSON.stringify(defProbe)}`);
    // And the other half of the claim: they live THERE, so "not here" is not "nowhere".
    const v9Source = fs.readFileSync(path.join(__dirname, 'lib', 'v9.mjs'), 'utf8');
    const notInV9 = V9_OWNED.filter((name) => !new RegExp(`export function ${name}\\b`).test(v9Source));
    check(notInV9.length === 0,
      `S14 V9 one definition: all ${V9_OWNED.length} are DEFINED in scripts/lib/v9.mjs, not merely absent here`,
      `no \`export function\` for: ${notInV9.join(', ')}`);

    // ---- S15: row 28 — every committed head is a true, capped SUMMARY of its golden ----
    // E32 is the claim ("commit only trace-head.json per problem"); this is the receipt. A head
    // that has drifted from the golden it summarises is worse than a missing head, because it
    // still reads as evidence, so the sweep compares the summary against the real thing rather
    // than checking that the summary has the right shape.
    const HEAD_MATCH = [
      ['stepCount', 'stepCount'], ['verdict', 'verdict'], ['blockHash', 'block.hash'],
      ['path', 'path'], ['level', 'level'],
    ];
    /** The head fields row 28's verify column names, against the golden they summarise. */
    const driftOf = (head, golden) => HEAD_MATCH
      .filter(([h, g]) => canon(head[h]) !== canon(g.split('.').reduce((o, k) => (o == null ? o : o[k]), golden)))
      .map(([h]) => h);
    /** Identity has to survive the summary: a head that opens at 1 and closes at stepCount. */
    const identityOf = (head, golden) => [
      ['first.n', head.first?.n === 1],
      ['last.n', head.last?.n === golden.stepCount],
    ].filter(([, ok]) => !ok).map(([k]) => k);
    // The shape is the claim. A head whose `first`/`last` are whole steps still passes every
    // field check above — its numbers are right, it is just carrying the golden in its pocket,
    // which is the thing E32 exists to stop. Measured on this corpus at `775016b`: 449
    // summary-shaped, 1 stale full-step, and nothing caught it, because no assertion read the
    // keys. So read the keys.
    const HEAD_STEP_KEYS = ['line', 'n', 'out'];
    const misShaped = (head, end) => {
      const step = head[end];
      if (step === null || step === undefined) return null;
      const keys = Object.keys(step).sort();
      return keys.length === HEAD_STEP_KEYS.length && keys.every((k, i) => k === HEAD_STEP_KEYS[i])
        ? null : `[${keys.join(',')}]`;
    };

    const headNames = fs.readdirSync(GOLDENS_DIR).filter((f) => f.endsWith('.head.json')).sort();
    const noGolden = [];
    const noField = [];
    const drifted = [];
    const oversized = [];
    const unidentified = [];
    const bulky = [];
    let headBytes = 0;
    let headMax = { bytes: 0, file: null };
    // S17's census accumulator lives HERE, beside the other per-corpus tallies, because the
    // loop below fills it and `const` at the assertion site would be a TDZ error.
    const verdictCensus = { zeroPass: 0, partialPass: 0, clean: 0, censused: 0 };

    for (const hf of headNames) {
      const raw = fs.readFileSync(path.join(GOLDENS_DIR, hf));
      const head = JSON.parse(raw.toString('utf8'));
      headBytes += raw.length;
      // S17's census. Counted here, before the `noGolden` continue below, because the ratchet
      // must see every head — a head whose golden is missing still carries a verdict.
      {
        const v = head.verdict;
        if (v && typeof v.passed === 'number' && typeof v.failed === 'number') {
          verdictCensus.censused += 1;
          if (v.passed === 0) verdictCensus.zeroPass += 1;
          else if (v.failed > 0) verdictCensus.partialPass += 1;
          else verdictCensus.clean += 1;
        }
      }
      if (raw.length > headMax.bytes) headMax = { bytes: raw.length, file: hf };
      if (raw.length > HEAD_BYTE_CAP) oversized.push(`${hf} ${raw.length}B`);
      for (const [h] of HEAD_MATCH) {
        if (head[h] === undefined || head[h] === null) noField.push(`${hf}: no \`${h}\``);
      }
      // Named, never skipped: a head whose full golden is absent cannot be checked, and
      // silently checking 449 of 450 is how this gate becomes a gate that proves nothing.
      const gname = hf.replace(/\.head\.json$/, '.json');
      if (!fs.existsSync(path.join(GOLDENS_DIR, gname))) { noGolden.push(hf); continue; }
      const golden = readGolden(gname);
      for (const field of [...driftOf(head, golden), ...identityOf(head, golden)]) {
        (['stepCount', 'verdict', 'blockHash', 'path', 'level'].includes(field) ? drifted : unidentified)
          .push(`${hf}: ${field}`);
      }
      for (const end of ['first', 'last']) {
        const keys = misShaped(head, end);
        if (keys) bulky.push(`${hf}: ${end} carries ${keys}`);
      }
    }

    check(headNames.length === names.length && headNames.length > 0,
      `S15 head: one committed head per golden (${headNames.length})`,
      `${names.length} goldens, ${headNames.length} heads — a guide gained or lost a level`);
    check(noGolden.length === 0,
      `S15 head: all ${headNames.length} heads have the full golden on disk to be compared against`,
      `goldens are gitignored (E32) — run \`npm run gen:traces\`; missing: ${noGolden.slice(0, 6).join(', ') || 'none'}`);
    check(noField.length === 0,
      `S15 head: every head carries stepCount, verdict, blockHash, path and level`,
      `${noField.length} missing: ${noField.slice(0, 6).join(', ')}`);
    check(drifted.length === 0,
      `S15 head: stepCount + verdict + blockHash + path + level match the full golden on all ${headNames.length} heads`,
      `${drifted.length} drifted: ${drifted.slice(0, 6).join(', ')}`);
    check(unidentified.length === 0,
      `S15 head: identity survives the summary — first.n is 1 and last.n is stepCount`,
      `${unidentified.length} broken: ${unidentified.slice(0, 6).join(', ')}`);
    check(oversized.length === 0,
      `S15 head: E32 — every head is within the ${HEAD_BYTE_CAP}B committed per-problem footprint`,
      `${oversized.length} over cap, largest ${headMax.file} ${headMax.bytes}B: ${oversized.slice(0, 6).join(', ')}`);
    check(bulky.length === 0,
      `S15 head: every head's first/last is a {n, line, out} summary, not a whole step`,
      `${bulky.length} carrying a full step: ${bulky.slice(0, 6).join(', ')}`);

    // The negatives, so "does it pass" is never the interesting half: a head that lies about
    // any of the five fields, or about its own endpoints, has to be REJECTED — derived from a
    // real head, so the probe cannot rot into checking a shape nothing ships.
    const realHead = JSON.parse(fs.readFileSync(path.join(GOLDENS_DIR, headNames[0]), 'utf8'));
    const realGolden = readGolden(headNames[0].replace('.head.json', '.json'));
    for (const [field, edit] of [
      ['stepCount', (h) => { h.stepCount += 1; }],
      ['verdict', (h) => { h.verdict = { ...h.verdict, passed: 0 }; }],
      ['blockHash', (h) => { h.blockHash = `sha256:${'0'.repeat(64)}`; }],
    ]) {
      const lied = clone(realHead);
      edit(lied);
      check(driftOf(lied, realGolden).includes(field),
        `S15 head negative: a head that lies about \`${field}\` is caught`,
        `driftOf said [${driftOf(lied, realGolden).join(', ')}] — the check did not notice`);
    }
    const shifted = clone(realHead);
    shifted.last.n += 1;
    check(identityOf(shifted, realGolden).includes('last.n'),
      'S15 head negative: a head whose last.n is not stepCount is caught',
      `identityOf said [${identityOf(shifted, realGolden).join(', ')}]`);
    // The shape check has to bite too, or it is decoration: a head carrying the whole step is
    // exactly the pre-row-28 artefact, and it passes every field assertion above.
    const pocketed = clone(realHead);
    pocketed.first = { ...realGolden.steps[0] };
    check(misShaped(pocketed, 'first') !== null,
      'S15 head negative: a head carrying a whole step instead of a summary is caught',
      `misShaped said [${misShaped(pocketed, 'first')}]`);
    check(misShaped(clone(realHead), 'first') === null,
      'S15 head negative: a real shipped head passes the shape check (the probe is not tautological)',
      `misShaped said [${misShaped(realHead, 'first')}] on an unmodified head`);

    console.log(`S15 head: ${headNames.length} heads · mean ${Math.round(headBytes / headNames.length)}B · max ${headMax.bytes}B (${headMax.file}) · over ${HEAD_BYTE_CAP}B cap: ${oversized.length}`);

    // ---- S16 · row 15 — a tree target's arity must survive the harvest ----
    // The spy's level-order preference exists so `maxDepth(arrayToTree([…]))` records the
    // level-order array the codec can marshal instead of a live node graph. It was
    // first-wins, so a target taking a SECOND tree argument lost it:
    // `isSameTree(arrayToTree(A), arrayToTree(B))` recorded `[A]` and called
    // `isSameTree(A, undefined)` — "cannot read property 'val' of undefined". Same for the
    // scalar second argument of `kthSmallest(arrayToTree([…]), 1)`, which lost the `k`.
    // Two named guides, because a gate that names the two it fixed is falsifiable and one
    // that names all 12 tree failures cannot go green until the other mechanisms land.
    const ARITY_GUIDES = [
      ['09-binary-tree-general__02-same-tree', 'isSameTree(p, q) takes two trees'],
      ['11-binary-search-tree__02-kth-smallest-element', 'kthSmallest(root, k) takes a tree and an int'],
    ];
    for (const [stem, why] of ARITY_GUIDES) {
      const g = names.find((n) => n.startsWith(`${stem}.L3.json`));
      const golden = g ? readGolden(g) : null;
      check(golden !== null && golden.verdict.failed === 0,
        `S16 arity: ${stem} L3 passes every case — ${why}`,
        golden
          ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed}${golden.verdict.failed ? ` — first error: ${String((golden.verdict.tests || []).find((t) => !t.ok)?.error || '').split('\n')[0]}` : ''}`
          : `no golden named ${stem}.L3.json — run \`npm run gen:traces\``);
    }

    // ---- S17 · row 15 — the wrong-verdict ratchet ----
    // Row 15's own success metric is `zero-pass == 0`, and it is a trap. A block that gets
    // SOME cases right reports `passed > 0`, so it leaves the zero-pass census while still
    // shipping wrong verdicts: `14-backtracking/04-combination-sum` scores 3 passed / 3 failed
    // at every level using the IDENTICAL `normCombos` post-decoder shape as the 24-block group
    // that IS counted, and is invisible here only because its empty-result case matches by
    // luck. So `zero-pass == 0` can go green with wrong verdicts still shipping.
    //
    // Nothing could see it either. `judge/traces/manifest.json` carries no `verdict` field at
    // all — its `goldens[]` entries are `{bytes, degraded, level, path, steps}` — and reports
    // `failures: []`. A slicing driven off the manifest sees a clean run. The 450
    // `*.head.json` are the only place a verdict is written down, so they are the census.
    //
    // Ratchet, not equality: a slice that FIXES blocks must not turn this red, so a breach is
    // a count that ROSE above its baseline. The baseline drops when a slice lands, which is
    // the only thing that makes it tight — a gate that can only be satisfied by going down.
    const VERDICT_BASELINE = { zeroPass: 6, partialPass: 8 };
    const breaches = (c, base) => Object.keys(base)
      .filter((k) => c[k] > base[k]).map((k) => `${k} rose ${base[k]} -> ${c[k]}`);
    // A one-directional ratchet has a blind spot that is exactly this row's bug: an UNCOMPUTED
    // census is all zeros, which is below every baseline, so "I never measured" reads as
    // "everything improved" and the gate passes having measured nothing. So the census has to
    // account for every head before its numbers mean anything.
    check(verdictCensus.censused === headNames.length,
      'S17 ratchet: every head is census-bearing — an unmeasured corpus cannot read as improvement',
      `censused ${verdictCensus.censused} of ${headNames.length} heads`);
    check(breaches(verdictCensus, VERDICT_BASELINE).length === 0,
      'S17 ratchet: no wrong-verdict census has risen above its committed baseline',
      breaches(verdictCensus, VERDICT_BASELINE).join('; ')
        || `zeroPass ${verdictCensus.zeroPass} / partialPass ${verdictCensus.partialPass}`);
    // The gate above compares two numbers, so on its own it cannot be shown to bite — which is
    // the S15 lesson exactly. All three directions get a probe, and every probe is written
    // RELATIVE to the baseline: a probe holding a literal count silently rots the moment a
    // slice lands and the baseline drops, which is how this suite went red on a fix.
    const at = (dZero, dPartial) => ({
      zeroPass: VERDICT_BASELINE.zeroPass + dZero,
      partialPass: VERDICT_BASELINE.partialPass + dPartial,
    });
    check(breaches(at(1, 0), VERDICT_BASELINE).length === 1,
      'S17 negative: a zero-pass rise is caught',
      `breaches said [${breaches(at(1, 0), VERDICT_BASELINE)}]`);
    check(breaches(at(0, 1), VERDICT_BASELINE).length === 1,
      'S17 negative: a PARTIAL-pass rise is caught too — that is the metric zero-pass cannot see',
      `breaches said [${breaches(at(0, 1), VERDICT_BASELINE)}]`);
    check(breaches(at(-1, -1), VERDICT_BASELINE).length === 0,
      'S17 negative: a census that FELL is not a breach — a fixed slice must not turn this red',
      `breaches said [${breaches(at(-1, -1), VERDICT_BASELINE)}]`);
    check(verdictCensus.zeroPass + verdictCensus.partialPass + verdictCensus.clean === verdictCensus.censused,
      'S17 ratchet: the three census buckets partition the corpus — no head is silently uncounted',
      `${verdictCensus.zeroPass} + ${verdictCensus.partialPass} + ${verdictCensus.clean} != ${verdictCensus.censused}`);
    console.log(`S17 ratchet: ${headNames.length} heads · zero-pass ${verdictCensus.zeroPass} (baseline ${VERDICT_BASELINE.zeroPass}) · partial-pass ${verdictCensus.partialPass} (baseline ${VERDICT_BASELINE.partialPass}) · clean ${verdictCensus.clean}`);

    // ---- S23 · row 15 — a CLASS target's op sequence is the case, and it was never recorded ----
    // `harvestCases` emits every case with a `callee` field and `buildBundle` never reads it. For a
    // class target the authored script performs a SEQUENCE of method calls on ONE constructed
    // instance, and the spy collapses that sequence into a single record with `args: []` — so the
    // driver did `Reflect.construct(MinStackBruteForce, [])` and compared a scalar against a class
    // instance's state. Measured: `07-stack/03-min-stack` yields 9 cases, every one of them
    // `{"args":[], "expected":<scalar>, "callee":"C"}`.
    //
    // Named per GUIDE rather than as a corpus-wide count, for the S16 reason: a gate naming all 19
    // class blocks could not go green until every other mechanism landed, so it would prove nothing.
    // Seven guides × the levels each one fails is the whole M1 family.
    //
    // The negative matters more than the positive: a gate reading `failed === 0` off a file on disk
    // is indistinguishable from a predicate that never fires, so the same predicate is handed a
    // golden with one extra failure and has to reject it.
    const CLASS_OP_GUIDES = [
      ['07-stack__03-min-stack', 'L1,L2,L3', 'push/pop/top/getMin on one constructed MinStack'],
      ['08-linked-list__11-lru-cache', 'L1,L2,L3', 'put/get sequence on one constructed LRUCache'],
      ['09-binary-tree-general__12-bst-iterator', 'L1,L2,L3', 'next/hasNext over one constructed iterator'],
      ['13-heap__04-median-finder', 'L1,L2,L3', 'addNum/findMedian on one constructed MedianFinder'],
      ['20-trie__01-implement-trie', 'L1,L2,L3', 'insert/search/startsWith on one constructed Trie'],
      ['20-trie__02-add-and-search-words', 'L1,L2,L3', 'addWord/search with a wildcard on one constructed WordDictionary'],
      ['02-two-pointers__02-is-subsequence', 'L3', 'the L3 target is a CLASS: new SubsequenceMatcher(t).isSubsequence(s)'],
    ];
    const classOpPredicate = (g) => g !== null && g.verdict.failed === 0;
    for (const [stem, levels, why] of CLASS_OP_GUIDES) {
      for (const level of levels.split(',')) {
        const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
        const golden = gname ? readGolden(gname) : null;
        check(classOpPredicate(golden),
          `S23 ops: ${stem} ${level} passes every case — ${why}`,
          golden
            ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · first error: ${String((golden.verdict.tests || []).find((t) => !t.ok)?.error || '(a case compared unequal)').split('\n')[0]}`
            : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
      }
    }
    // The same predicate, a golden it must reject — so "all 19 pass" cannot be a predicate that
    // never fires. Built from a real golden this family already fixed, so it cannot rot into a
    // shape nothing ships.
    const opsControlName = names.find((n) => n.startsWith('07-stack__03-min-stack.L3.json'));
    const opsControl = opsControlName ? readGolden(opsControlName) : null;
    check(classOpPredicate(opsControl),
      'S23 ops negative: the unmodified named golden SATISFIES the predicate — the probe below is not tautological',
      opsControl ? `failed ${opsControl.verdict.failed}` : 'no golden — run `npm run gen:traces`');
    const opsWrong = clone(opsControl);
    opsWrong.verdict = { ...opsWrong.verdict, failed: opsWrong.verdict.failed + 1 };
    check(!classOpPredicate(opsWrong),
      'S23 ops negative: a golden with one more failing case is REJECTED by the same predicate',
      'the predicate accepted a deliberately-wrong verdict — the gate cannot fail');
    // The mechanism itself, asserted where it is TRUE and falsifiable without the corpus: a case
    // carrying an op list is replayed against the CONSTRUCTED instance's own methods, so a target
    // whose method returns its own state answers from that state. The op list is DATA — it rides
    // inside the existing `JSON.stringify(tests)`, exactly as `t.via` does — so no envelope, golden
    // or schema field was added for it (S10's frozen set is untouched). `args` is EMPTY, so a
    // driver that ignored `ops` would construct and stop, and could not produce `[-2, -3]`.
    check(await opsEmits('Stack', [['push', [-2], false], ['getMin', [], true], ['push', [-3], false], ['getMin', [], true]], []),
      "S23 ops: an op list drives the target's OWN methods — the emitted values come from the instance, not from a synthesised one",
      'the replay did not reproduce the method sequence the op list named');

    // The one guide in this family that is NOT closed, asserted as remaining work rather than left
    // to a future reader's inference. Replaying an op sequence makes the verdict depend on what the
    // target's methods return at run time, and for insert-delete-getrandom-o1 that is `Math.random`.
    // Its authored script pins the draw sequence with a GLOBAL stub, which is out of bounds (§5d), so
    // the op mechanism refuses any block whose source names a non-deterministic global. Measured
    // consequence of NOT refusing: three consecutive regenerations of one tree gave 6/1, 4/3 and
    // 6/1 — a golden whose verdict moves on every run, which nothing can gate on (K6/E8).
    for (const level of ['L1', 'L2', 'L3']) {
      const gname = names.find((n) => n.startsWith(`01-array-string__12-insert-delete-getrandom-o1.${level}.json`));
      const golden = gname ? readGolden(gname) : null;
      check(golden !== null && !classOpPredicate(golden),
        `S23 ops: insert-delete-getrandom-o1 ${level} is still wrong on purpose — its answer needs a Math.random stub, which §5d forbids`,
        `passed ${golden?.verdict.passed}, failed ${golden?.verdict.failed} — a clean verdict here means the op list was replayed against an unpinned draw sequence, which is non-deterministic`);
    }

    // ---- S24 · row 15 — an assertion with no recorded target call is NOT a case ----
    // When the spy's recorded target call could not be transported, `__A__` stayed null and the
    // capture fell through to the first-any-call fallback — which for `assertEq(copy !== orig && …)`
    // is the ASSERTER ITSELF. So `args` became the asserter's own arguments and the driver invoked
    // the target with them. Measured on `08-linked-list/04-copy-list-with-random-pointer`: the
    // golden drove `copyRandomListBruteForce(true, true, 'deep copy, no shared nodes')`.
    //
    // That is not a case about the target at all, and grading it is how a block reports
    // `passed 1 failed 6`: the one pass is the `null` input, which is a real case.
    const UNBACKED_GUIDES = [
      ['08-linked-list__04-copy-list-with-random-pointer', 'L1,L2,L3', 'the list has random pointers, so the input is CYCLIC and cannot be transported'],
      // Only L1 here. clone-graph's L2/L3 also lose the unbacked cases, but their remaining two
      // cases then fail on `graphToAdj` not being declared in the driver — a derivation helper that
      // lives in a SIBLING block, which is its own mechanism and its own gate (S25). Naming them
      // here would make this gate un-greenable for a reason that has nothing to do with the drop.
      ['18-graph-general__03-clone-graph', 'L1', 'the graph is cyclic too — the target is never driven with an unbacked assertion again'],
      ['20-trie__03-word-search-ii', 'L1,L2,L3', '`board restored` asserts about the board, never about the target — it was graded as a call'],
    ];
    for (const [stem, levels, why] of UNBACKED_GUIDES) {
      for (const level of levels.split(',')) {
        const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
        const golden = gname ? readGolden(gname) : null;
        check(golden !== null && classOpPredicate(golden),
          `S24 unbacked: ${stem} ${level} passes every case it has — ${why}`,
          golden
            ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · stepCount ${golden.stepCount}`
            : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
      }
    }

    // ---- S25 · row 15 — a derivation over a VARIABLE the author bound the return to ----
    // `const r1 = fn('babad'); assertEq(r1.length === 3 && isPalStr(r1), true)` never puts the
    // target call inside the asserter, so `collectDerivations` — which looks for the outermost
    // TARGET CALL in `arguments[0]` — found none, recorded no derivation, and the driver compared
    // the target's raw return `"bab"` against an expected `true`.
    // sorted-array-to-bst is NOT named here even though its `inorderVals(t)` case is exactly this
    // shape, because it needs a SECOND mechanism as well: `treeHeight` is declared in a block the
    // driver never receives, so its other cases die on `treeHeight is not defined`. That is the
    // sibling-block helper defect, and it gets its own gate — naming it here would make this gate
    // un-greenable for a reason that is not this mechanism.
    const RET_VAR_GUIDES = [
      ['17-multi-dp__04-longest-palindromic-substring', 'L1,L2,L3', 'the assertion projects the RETURN: r1.length === 3 && isPalStr(r1)'],
    ];
    for (const [stem, levels, why] of RET_VAR_GUIDES) {
      for (const level of levels.split(',')) {
        const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
        const golden = gname ? readGolden(gname) : null;
        check(golden !== null && classOpPredicate(golden),
          `S25 retvar: ${stem} ${level} passes every case — ${why}`,
          golden
            ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · first error: ${String((golden.verdict.tests || []).find((t) => !t.ok)?.error || '(a case compared unequal)').split('\n')[0]}`
            : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
      }
    }

    // ---- S27 · row 15 — a derivation helper the driver never received ----
    // A derivation is replayed in the driver's IIFE, and the helpers it references are sliced out of
    // the AUTHORED SCRIPT. Some are declared in neither: they live in the guide's own block, at a
    // level the driver is not given, so the replay throws `ReferenceError` before it can compare
    // anything. `quadToGrid` is declared once in construct-quad-tree's markdown and is in none of
    // the three selected blocks; `graphToAdj` and `treeHeight` are the same shape.
    const SIBLING_HELPER_GUIDES = [
      ['21-divide-conquer__03-construct-quad-tree', 'L2,L3', 'quadToGrid is in the guide, not in the block the driver is handed'],
      ['18-graph-general__03-clone-graph', 'L2,L3', 'graphToAdj likewise — the remaining two cases died on it once the unbacked ones were dropped'],
      // Found by running it, not by reading it: this guide's `treeHeight` is the same shape, so it
      // is named here rather than left for a later slice to rediscover as a driver bug.
      ['21-divide-conquer__01-sorted-array-to-bst', 'L2,L3', 'treeHeight is the same shape — its cases died on ReferenceError before comparing anything'],
    ];
    for (const [stem, levels, why] of SIBLING_HELPER_GUIDES) {
      for (const level of levels.split(',')) {
        const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
        const golden = gname ? readGolden(gname) : null;
        check(golden !== null && classOpPredicate(golden),
          `S27 sibling helper: ${stem} ${level} passes every case — ${why}`,
          golden
            ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · first error: ${String((golden.verdict.tests || []).find((t) => !t.ok)?.error || '(a case compared unequal)').split('\n')[0]}`
            : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
      }
    }

    // The second half of this slice's mechanism, stated as its own claim because it is a DIFFERENT
    // rule: a value the codec OWNS is now encoded on BOTH sides of the comparison. `tree` puts nil in
    // its own domain (`treeToArray(null)` is `[]`), so the driver encoded the answer as `[]` and then
    // compared it against an author who wrote `null` — the same fact in two vocabularies, and the
    // driver reading a correct answer as a wrong one, which is the note the codec already carries for
    // `invertTree`. Measured blast radius, over all 776 harvested cases with an expected value:
    // `json`/`ops`/`graph` `toWire` is the identity, so 457 of the 460 firings change nothing; the
    // ONLY behavioural change in the corpus is `tree` + nil, 3 cases, all `flatten-binary-tree`'s
    // `empty tree no-op`. Same encoder on both sides, so it cannot manufacture a pass.
    check(equivalent('exact', [], null) === false,
      'S26 encoding: the comparator still REJECTS nil against the empty wire on its own — the symmetry is in what the driver hands it, not in the comparator',
      "equivalent('exact', [], null) accepted them — E28's registry changed under this slice");
    check(getCodec('tree', 'S26').toWire(null) !== null && getCodec('json', 'S26').toWire({ a: 1 }).a === 1,
      'S26 encoding: the two sides really do differ — tree re-encodes nil, json does not — so the symmetry is a real rule and not a no-op',
      'one of the two codecs stopped re-encoding the value it owns');

    // ---- S18 · row 15 — a derivation the script applied and the driver dropped ----
    // The harvest records WHAT was asserted after the script's own post-processing, and the
    // driver compares the target's RAW return. merge-intervals' script asserts
    // `fn(input).sort(byStart)`; the driver called `fn(input)` and got discovery order
    // `[[8,10],[15,18],[1,6]]`. One block, named, because it is the smallest honest instance
    // and because a gate naming all of them could not go green until the family was finished.
    //
    // IT IS AN OVERRIDE, NOT DRIVER PLUMBING — and the reason is worth recording, because the
    // obvious move here is to build a `via` replay and it would be wasted on half the family.
    // The 24 do NOT share one mechanism, they share one SYMPTOM. Measured against the real
    // comparator:
    //   - a PURE SORT is order-insensitive and needs one line of catalog. merge-intervals L1
    //     is exactly this, and L2/L3 already returned sorted output and passed by luck.
    //   - a PROJECTION is not. `normCombos` is `lists.map(c => c.join(','))`, so its expected
    //     side is `["1,2","1,3"]` while the raw return is `[[1,2],[1,3]]` — order-insensitive
    //     forgives ordering, not REPRESENTATION, so no equivalence kind reaches it and those
    //     blocks genuinely need the derivation replayed. They stay in the S17 census.
    const VIA_GUIDES = [
      ['06-intervals__02-merge-intervals', 'L1', 'mergeBruteForce returns discovery order; the script asserts it .sort(byStart)'],
    ];
    for (const [stem, level, why] of VIA_GUIDES) {
      const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
      const golden = gname ? readGolden(gname) : null;
      check(golden !== null && golden.verdict.failed === 0,
        `S18 via: ${stem} ${level} passes every case — ${why}`,
        golden
          ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · result ${JSON.stringify(golden.result).slice(0, 80)}`
          : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
    }
    // The split itself, asserted so it cannot be quietly undone by copying merge-intervals'
    // override onto a projection guide and declaring the family fixed.
    check(equivalent('order-insensitive', [[1, 6], [8, 10]], [[8, 10], [1, 6]]) === true,
      'S18 split: a PURE SORT derivation is order-insensitive, so a catalog override reaches it');
    check(equivalent('order-insensitive', ['1,2', '1,3'], [[1, 2], [1, 3]]) === false,
      'S18 split: a PROJECTION derivation is NOT order-insensitive — strings vs nested arrays — so it needs the derivation replayed, not an override');

    // ---- S19 · row 15 — instrumented output must be self-contained ----
    // `instrumentBlock` emits `__c0 … __c31` references but never declared them: the temps were
    // declared by the instrumenter's OWN harness (`blockScript`), so any second consumer of the
    // same instrumented source got a ReferenceError instead of a verdict. The judge bundle is
    // that second consumer — it embeds `instrumentedSource` in `userCode` and declares nothing.
    // Corpus-wide rather than naming three guides, because the invariant is about the SHAPE of
    // the emitted code: a golden carrying `__cN is not defined` is a broken artefact whatever it
    // was tracing. All three observed blocks are class guides (codec `ops`), so this fix moves
    // construction forward and the comparison then fails on its own terms — the census count
    // does NOT move. It is a prerequisite for the class op list, not a win by itself.
    const undefinedTemp = names
      .map((n) => [n, readGolden(n)])
      .filter(([, g]) => /__c\d+'?\s+is not defined/.test(String(g.error ?? '')))
      .map(([n]) => n);
    check(undefinedTemp.length === 0,
      'S19 self-contained: no shipped golden fails on an undeclared instrumenter temp',
      undefinedTemp.length
        ? `${undefinedTemp.length} golden(s): ${undefinedTemp.slice(0, 4).join(', ')}${undefinedTemp.length > 4 ? ' …' : ''}`
        : '450 goldens scanned, none references an undeclared __cN');

    // ---- S20 · row 15 — one harvested case list, three levels ----
    // The same `cases` array is handed to every level unfiltered (`gen-traces.mjs`), and that is
    // load-bearing: an ALIAS loop (`for (const fn of [f1, f2, f3]) assertEq(...)`) records
    // `callee: 'fn'`, and each level running that one case against its OWN function is exactly
    // how 150 guides get covered by one authored script.
    //
    // is-subsequence is what breaks it. Its script can only drive the L3 CLASS, so it never
    // calls the L1/L2 functions — and the harvested args are the CONSTRUCTOR's, so L1 ran
    // `isSubsequenceBruteForce('ahbgdc')` with one argument and died on `.length` of undefined.
    // The fix is two halves that must both land: the script drives all three, and the case list
    // is partitioned per level. The partition drops a case ONLY when its callee is a DIFFERENT
    // level's target, so an alias (`fn`) and every non-harvested case (no `callee` at all) still
    // reach all three levels.
    const PARTITIONED_GUIDES = [
      ['02-two-pointers__02-is-subsequence', ['L1', 'L2'], 'the script drives all three levels; each level gets only its own cases'],
    ];
    for (const [stem, levels, why] of PARTITIONED_GUIDES) {
      for (const level of levels) {
        const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
        const golden = gname ? readGolden(gname) : null;
        check(golden !== null && golden.verdict.failed === 0,
          `S20 partition: ${stem} ${level} passes every case — ${why}`,
          golden
            ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · error ${String(golden.error ?? 'none').split('\n')[0]}`
            : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
      }
    }

    // ---- S21 · row 15 — a node argument the script never wrote down ----
    // The tree codec can only marshal a LEVEL-ORDER literal, and the harvest only ever recorded
    // one when a helper's own first argument was that literal. So a target whose node arguments
    // are produced by a HELPER had nothing to record: lowest-common-ancestor asserts
    // `fn(t1, findNode(t1, 5), findNode(t1, 1)).val`, `findNode` returns a LIVE node, `__LE__` is
    // false for it, and the positional repair found no recording for positions 1 and 2 — so the
    // driver called a three-argument target with one argument and dereferenced `undefined`.
    //
    // No script rewrite can fix this: the assertion is about node IDENTITY within one tree, so
    // three separate literals would be three different trees and the answer would be a different
    // question. The harvest has to carry the helper's RETURN, and it now does — into the same
    // __FL__ list, in call order, so the positional repair downstream is untouched.
    //
    // Asserted as the CAPABILITY and not as a passing verdict, because lca is a TWO-mechanism
    // case: `fn(t1, findNode(t1,5), findNode(t1,1)).val` also PROJECTS the return to a scalar, so
    // even with all three arguments recorded the driver compares a node against 3. The args were
    // the half this row owns; the projection is the derivation-replay row, and it is what keeps
    // these three blocks in the S17 census. What is asserted here is that the arity failure is
    // gone, because that failure was the harvest's and this change is the harvest's.
    const DERIVED_NODE_GUIDES = [
      ['09-binary-tree-general__10-lowest-common-ancestor', 'L1', 'findNode(t, v) arguments are now recorded, so the target is no longer driven short'],
    ];
    for (const [stem, level, why] of DERIVED_NODE_GUIDES) {
      const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
      const golden = gname ? readGolden(gname) : null;
      check(golden !== null && !/of undefined/.test(String(golden.error ?? '')),
        `S21 derived: ${stem} ${level} is not driven short of arguments — ${why}`,
        golden
          ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · error ${String(golden.error ?? 'none').split('\n')[0]}`
          : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
    }
    // The regression this capability invites: a helper that RETURNS a tree is recorded twice if
    // its literal argument was already recorded, which shifts every later position. That is not
    // hypothetical — it is exactly what `isSameTree(arrayToTree(A), arrayToTree(B))` did, and it
    // broke the row-15 arity fix. Named here because S16 names the passing case and this is the
    // failing one.
    for (const level of ['L1', 'L2', 'L3']) {
      const gname = names.find((n) => n.startsWith(`09-binary-tree-general__02-same-tree.${level}.json`));
      const golden = gname ? readGolden(gname) : null;
      check(golden !== null && golden.verdict.failed === 0,
        `S21 derived: same-tree ${level} still passes — a helper that returns a tree must not be recorded twice`,
        golden ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed}` : 'no golden — run `npm run gen:traces`');
    }

    // ---- S22 · row 15 — a derivation the driver has to REPLAY, not just forgive ----
    // S18 split the family and left the projection half standing: `normCombos` is
    // `lists.map((c) => c.join(','))`, so the harvest recorded expected `["1,2","1,3"]` while the
    // driver's raw return is `[[1,2],[1,3]]`. No equivalence kind bridges REPRESENTATION —
    // `equivalent('order-insensitive', ['1,2','1,3'], [[1,2],[1,3]])` is `false`, asserted two
    // blocks up and re-asserted here, because a projection is not a reordering.
    //
    // So the derivation is REPLAYED: `collectDerivations` slices the expression the script
    // asserted (with the target call replaced by `__FN__(__ARGS__)`) plus the helper declarations
    // it still references, `harvestCases` carries it as `testCase.via` + `cases.viaCode`, and
    // `buildBundle` applies `__VIA_FNS__[t.via](__FN__, args)` immediately after the call and
    // BEFORE the codec's `owns`/`toWire` — so what gets compared is the value the AUTHOR wrote
    // down, reached through the author's own code.
    //
    // The shapes there are, not a sample:
    //   - `normCombos(fn(4, 2))`          a WRAPPER derivation around the call (combinations, permutations)
    //   - `fn(input).sort(byStart)`       a PROJECTION applied to the RESULT, with no wrapper at all
    //
    // merge-intervals is S18's guide, and S18 reached it with a catalog override because its
    // derivation is a PURE SORT — order-insensitive forgives a reordering. It is named here for the
    // OTHER reason: it is the only clean block whose derivation is a trailing projection rather
    // than a wrapper, so it is what proves the mechanism is not a wrapper-shaped special case. Its
    // `.sort(byStart)` runs on the raw nested arrays, which is exactly the representation the
    // wrapper shape also has to survive — one rule, both shapes.
    const REPLAY_GUIDES = [
      ['14-backtracking__02-combinations', 'L3', 'normCombos(fn(4, 2)) joins the combos to strings — a wrapper derivation the driver must replay'],
      ['14-backtracking__03-permutations', 'L3', 'normPerms(fn([1,2,3])) joins the perms to strings — same wrapper shape, different guide'],
      ['06-intervals__02-merge-intervals', 'L1', 'fn(input).sort(byStart) is a PROJECTION on the result — the same rule must reach it without a wrapper'],
    ];
    for (const [stem, level, why] of REPLAY_GUIDES) {
      const gname = names.find((n) => n.startsWith(`${stem}.${level}.json`));
      const golden = gname ? readGolden(gname) : null;
      check(golden !== null && golden.verdict.failed === 0,
        `S22 replay: ${stem} ${level} passes every case — ${why}`,
        golden
          ? `passed ${golden.verdict.passed}, failed ${golden.verdict.failed} · error ${String(golden.error ?? 'none').split('\n')[0]}`
          : `no golden named ${stem}.${level}.json — run \`npm run gen:traces\``);
    }
    // ── The projection shape, asserted on the one transport that can carry it ────────────────
    // `sorted-array-to-bst` asserts `inorderVals(fn([-10,-3,0,5,9]))`, which is the same
    // `.val`-shaped derivation as lca's — the driver must run the author's helper over the target's
    // return rather than comparing the raw return. Its arguments survive the trip (a flat array of
    // numbers needs no codec), so the projection is reachable end to end and is asserted as a
    // PASSING verdict rather than as a capability.
    //
    // ── Why lowest-common-ancestor is NOT in that list, and why deleting its assertion is not the
    // answer either. Its script asserts `fn(t1, findNode(t1,5), findNode(t1,1)).val`, and the
    // derivation replay now runs correctly: the registry is `__FN__.apply(null, __ARGS__).val` and
    // both keys fire. It still fails, with `TypeError: cannot read property 'val' of null`, because
    // the target returns `null` — and that is a TRANSPORT fact, not a derivation one. S21 records
    // the two derived nodes as level-order arrays, `buildBundle` decodes each wire with
    // `arrayToTree` into a FRESH graph, so positions 1 and 2 become three unrelated trees, and
    // `pathToNode(root, p, pp)` walks `root` looking for `p` by `===` and never finds it. The guide
    // says this itself at line 305: "Compare nodes by IDENTITY (`===` on objects), never by `.val`".
    //
    // A level-order wire is a VALUE encoding and cannot express object identity, so this block needs
    // a codec that carries identity — `api/_lib/codecs.mjs`, which this slice does not own.
    // Asserting it green would be asserting something false; asserting it red would leave the suite
    // permanently failing. So the claim is asserted where it IS true and IS falsifiable: the block
    // still gets a golden, and the residual failure is still the transport's. A derivation bug
    // reintroduced here would change the residual error and turn this red.
    const lcaName = '09-binary-tree-general__10-lowest-common-ancestor.L1.json';
    const lcaGolden = names.includes(lcaName) ? readGolden(lcaName) : null;
    check(lcaGolden !== null,
      'S22 replay: lowest-common-ancestor L1 still produces a golden — the replay must not cost a block its envelope',
      `no golden named ${lcaName} — run \`npm run gen:traces\``);
    // The residual failure is measured from the head, which is where a verdict is written down (S17's
    // own reason). It must be non-clean AND must not be an argument/derivation arity failure — those
    // are the two symptoms the replay exists to remove, so either one appearing here is a regression.
    const lcaHead = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(GOLDENS_DIR, lcaName.replace('.json', '.head.json')), 'utf8'));
      } catch { return null; }
    })();
    const lcaVerdict = lcaHead?.verdict ?? null;
    check(lcaVerdict !== null && lcaVerdict.failed > 0,
      'S22 replay: lowest-common-ancestor L1 is still wrong — recorded as REMAINING WORK (identity needs a codec that carries it), not silently dropped',
      `verdict ${JSON.stringify(lcaVerdict)} — this block was expected to remain non-clean pending an identity-carrying codec`);
    check(!/of undefined/.test(String(lcaHead?.error ?? '')),
      'S22 replay: lowest-common-ancestor L1 no longer fails on a DRIVEN-SHORT arity — the residual is the identity transport, which is a different defect',
      `error ${String(lcaHead?.error ?? 'none')} — an "of undefined" here means the derived-node arguments regressed (S21)`);
    // The gate above reads `verdict.failed === 0` off a file on disk, so it can only be shown to
    // bite by handing the same predicate a verdict that IS wrong. Otherwise "all three pass" and
    // "the predicate never fires" are indistinguishable from the outside — which is how this
    // feature shipped once already, reverted for breaking four scripts, and came back.
    const replayPredicate = (g) => g !== null && g.verdict.failed === 0;
    const replayName = names.find((n) => n.startsWith('14-backtracking__02-combinations.L3.json'));
    const replayReal = replayName ? readGolden(replayName) : null;
    check(replayReal !== null && replayPredicate(replayReal),
      'S22 replay negative: the unmodified named golden SATISFIES the predicate — the probe below is not tautological',
      replayReal ? `failed ${replayReal.verdict.failed}` : 'no golden — run `npm run gen:traces`');
    const replayWrong = clone(replayReal);
    replayWrong.verdict = { ...replayWrong.verdict, failed: replayWrong.verdict.failed + 1 };
    check(!replayPredicate(replayWrong),
      'S22 replay negative: a golden with one more failing case is REJECTED by the same predicate',
      'the predicate accepted a deliberately-wrong verdict — the gate cannot fail');
    // And the second half of the mechanism, stated separately because it is a DIFFERENT claim:
    // a projection derivation is not reachable by any equivalence kind, so a driver that only
    // forgives ordering still cannot compare these. Asserted against the real comparator, not a
    // literal, so a change to E28's registry is what moves it.
    check(equivalent('order-insensitive', ['1,2', '1,3'], [[1, 2], [1, 3]]) === false,
      'S22 replay: a PROJECTION derivation is not order-insensitive — the replay is the only mechanism that reaches it',
      "equivalent('order-insensitive', ...) accepted strings against nested arrays — E28's registry changed");
    check(equivalent('order-insensitive', [[1, 2], [1, 3]], [[1, 3], [1, 2]]) === true,
      'S22 replay: and a REORDERING is still forgiven — the replay is not doing the comparator\'s job',
      "equivalent('order-insensitive', ...) rejected a pure reordering — the comparator regressed");
  }
  console.log('\n========================================');
  console.log(`Golden fixtures: ${Object.keys(MUTATIONS).length} derived from expected.json (all reproducible with --mutate)`);
  console.log(`Assertions: ${assertions} | Failures: ${failures}`);
  console.log('========================================\n');

  if (failures > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--mutate')) writeFixtures();
  await main();
}
