/**
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
import { fileURLToPath } from 'node:url';
import { stringify } from './lib/serialize.mjs';
import { validateEnvelope } from './validate-envelope.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'trace');
const EXPECTED = path.join(FIXTURES, 'expected.json');

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

function main() {
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

  console.log('\n========================================');
  console.log(`Golden fixtures: ${Object.keys(MUTATIONS).length} derived from expected.json (all reproducible with --mutate)`);
  console.log(`Assertions: ${assertions} | Failures: ${failures}`);
  console.log('========================================\n');

  if (failures > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--mutate')) writeFixtures();
  main();
}
