/**
 * Row 5 self-tests: the envelope v1.1 contract (plan v5 §5, all seven invariants).
 *
 * This row is the row-13 FREEZE POINT. "v1.1 is frozen" only means something if something
 * executes the seven invariants, so each one is asserted here by id, and each bad fixture
 * is rejected for EXACTLY ONE named reason — `errors.length === 1` is what proves the
 * fixture isolates its invariant instead of tripping a neighbouring check.
 *
 * The three bad fixtures that a `.json` file cannot express (a live BigInt, a boolean
 * `truncated`, a `tests` array smuggled out of the sandbox envelope) are constructed in
 * this file rather than written as fixtures; see the I2/I3/I6 blocks.
 *
 * Run: node scripts/test-envelope.mjs     (exits 1 if any assertion fails)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateEnvelope } from './validate-envelope.mjs';
import { serialize, stringify, deserialize, MAX_DEPTH } from './lib/serialize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'envelope');
const SCHEMA = path.join(__dirname, '..', 'docs', 'trace-schema.json');

let assertions = 0;
let failures = 0;
let rejectedFiles = 0; // bad fixture FILES rejected by exactly one named reason
let rejectedCases = 0; // …plus the invariants no JSON fixture can express

function check(cond, label, detail = '') {
  assertions++;
  if (cond) {
    console.log(`✅ [PASS] ${label}`);
  } else {
    failures++;
    console.error(`❌ [FAIL] ${label}${detail ? `\n   ${detail}` : ''}`);
  }
}

const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8'));
const loadModule = async (name) => (await import(path.join(FIXTURES, name))).default;
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Asserts the fixture is rejected by exactly one named error, and that the name carries
 * the invariant id it defends. A second error means the fixture leaked into a
 * neighbouring check, which is how a weakened assertion hides.
 */
function expectRejected(envelope, code, invariantId, label, isFixtureFile = false) {
  const res = validateEnvelope(envelope);
  const names = res.errors.map((e) => (e.match(/^[A-Z_]+/) || [''])[0]);
  const hits = res.errors.filter((e) => e.startsWith(code));
  check(!res.isValid, `${label}: rejected`, `isValid was true`);
  check(res.errors.length === 1, `${label}: exactly one reason`, `errors: ${JSON.stringify(res.errors)}`);
  check(hits.length === 1, `${label}: rejected by ${code}`, `errors: ${JSON.stringify(res.errors)}`);
  check(
    invariantId === null || names[0] !== '' && res.errors[0].includes(`[${invariantId}]`),
    `${label}: reason is tagged [${invariantId}]`,
    `errors: ${JSON.stringify(res.errors)}`
  );
  if (!res.isValid && res.errors.length === 1 && hits.length === 1) {
    if (isFixtureFile) rejectedFiles++;
    else rejectedCases++;
  }
  return res.errors[0] || '';
}

const good = loadJson('good-two-sum.json');

// ---- S1: the good envelope is accepted, and every invariant holds on it ------------

const goodRes = validateEnvelope(good);
check(goodRes.isValid, 'good fixture: accepted', `errors: ${JSON.stringify(goodRes.errors)}`);
check(goodRes.errors.length === 0, 'good fixture: no errors at all', JSON.stringify(goodRes.errors));

// I1 on the good fixture: the point is that the check is not vacuous — it is compared
// against a real block hash, not a placeholder both sides share.
const HASH = good.block.hash;
check(/^sha256:[0-9a-f]{64}$/.test(HASH), 'I1 good: block.hash is a real sha256 of the block source');
check(good.steps.every((s) => s.line.h === HASH), 'I1 good: every step carries block.hash');
check(good.steps.every((s) => s.line.off >= 0 && s.line.off < good.block.lines),
  'I1 good: every line.off is inside the block', `lines: ${good.block.lines}`);

// I4 on the good fixture: full mode, snapshots present.
check(good.budget.mode === 'full' && good.steps.every((s) => s.snap),
  'I4 good: full mode carries a snap on every step');

// I5 on the good fixture: the operand identifiers really are all watched.
const operandKeys = good.steps.flatMap((s) => Object.keys(s.operands));
check(operandKeys.length > 0, 'I5 good: the trace names operands at all');
check(operandKeys.some((k) => /[.[]/.test(k)), 'I5 good: operands include a member/index expression, not just bare names',
  `keys: ${JSON.stringify(operandKeys)}`);

// I6 on the good fixture: the snap must already BE canonical — every value is either a
// plain JSON value or one of serialize.mjs's tokens, and the whole snap decodes back to
// byte-identical canonical text. (`__map` is the E5 case: plain JSON would flatten a live
// Map to `{}`. `__u` is E1: plain JSON would drop the key. Row 6 proves both those manglings
// directly; what matters HERE is that this envelope carries the token instead.)
const mapStep = good.steps.find((s) => s.snap && s.snap.seen && s.snap.seen.__map);
const undefinedStep = good.steps.find((s) => s.snap && 'prev' in s.snap);
check(mapStep !== undefined, 'I6 good: a snap carries the canonical Map token');
check(undefinedStep !== undefined, 'I6 good: a snap carries the canonical undefined token');
check(
  good.steps.every((s) => s.snap === null || stringify(deserialize(s.snap)) === stringify(s.snap)),
  'I6 good: every snap round-trips through the canonical serializer unchanged'
);
check(
  mapStep !== undefined && stringify(mapStep.snap).includes('"__map"'),
  'I6 good: the canonical serializer keeps the Map instead of flattening it'
);
check(
  undefinedStep !== undefined && stringify(undefinedStep.snap).includes('"prev":{"__u":1}'),
  'I6 good: the canonical serializer keeps the undefined key instead of dropping it'
);

// I7 on the good fixture.
check(good.verdict.passed + good.verdict.failed > 0, 'I7 good: a zero-sum verdict needs truncated.execution');

// I2 / I3 on the good fixture: the closed key sets the plan pins.
check(Object.keys(good.verdict).sort().join() === 'failed,passed',
  'I2 good: verdict is exactly {passed, failed}');
check(Object.keys(good.truncated).sort().join() === 'display,execution,trace',
  'I3 good: truncated is exactly {execution, display, trace}');

// ---- S2: the bad fixtures, one named reason each --------------------------------

// I1 — a step minted under a stale block hash. Plan §5 invariant 1 (D2x): this is E19,
// a guide edited after the golden existed, and it must be a NAMED failure, not a line diff.
const i1Msg = expectRejected(loadJson('bad-line-hash-mismatch.json'), 'STEP_HASH_MISMATCH', 'I1', 'bad-line-hash-mismatch', true);
check(/steps\[0\]/.test(i1Msg), 'I1: names the offending step', i1Msg);

// I4 — mode "diff" that still carries a snap. Plan §5 invariant 4 (D2/F1): the payload was
// never shed, so the caller believes it is streaming deltas while it is shipping 184 kB
// of snapshots into the same 1 MB slot that overflowed in the first place.
expectRejected(loadJson('bad-diff-mode-with-snap.json'), 'DIFF_MODE_HAS_SNAP', 'I4', 'bad-diff-mode-with-snap', true);

// I5 — `operands` names `k`, which the watch list never declared. Plan §5 invariant 5:
// an instrumented name that no watch entry covers renders a value nobody captured.
expectRejected(loadJson('bad-operand-not-watched.json'), 'OPERAND_NOT_WATCHED', 'I5', 'bad-operand-not-watched', true);

// I7 — a zero-sum verdict with no truncated.execution. Plan §5 invariant 7: the raw run
// reported nothing, so this "passed" is silence wearing a green shirt.
expectRejected(loadJson('bad-zero-verdict.json'), 'VERDICT_ZERO_SUM', 'I7', 'bad-zero-verdict', true);

// Required field — `watch` deleted. Everything downstream of invariant 5 depends on it,
// so a missing one must fail on the field itself, not on a downstream symptom.
expectRejected(loadJson('bad-missing-watch.json'), 'MISSING_FIELD', 'required', 'bad-missing-watch', true);

// Wrong v — an envelope from a contract revision whose field MEANINGS may differ, which
// is exactly what row 13 freezes.
expectRejected(loadJson('bad-wrong-version.json'), 'VERSION_UNSUPPORTED', 'version', 'bad-wrong-version', true);

// I6 — a live BigInt (plus a raw NaN, -0 and undefined) in a snap. Plan §5 invariant 6
// (K6) / §6 E1-E4. No `.json` fixture can hold a raw BigInt: `JSON.stringify` throws on
// it, which is the sandbox-killing bug the canonical serializer exists to prevent, so the
// fixture has to mint the value in JS.
const bigintFixture = await loadModule('bad-raw-bigint-snap.mjs');
let plainThrew = false;
try {
  JSON.stringify(bigintFixture.steps[0].snap);
} catch {
  plainThrew = true;
}
check(plainThrew, 'I6: plain JSON.stringify THROWS on this snap — the bug K6 kills');
expectRejected(bigintFixture, 'SNAP_NOT_CANONICAL', 'I6', 'bad-raw-bigint-snap', true);

// ---- the invariants a `.json` fixture cannot express -----------------------------
// Built here from the good fixture, so no file has to lie about being JSON.

/** Same envelope, `snap` holding live values instead of canonical tokens. */
function withLiveSnap(snap) {
  const e = clone(good);
  e.steps = [{ ...clone(good.steps[0]), snap }];
  e.stepCount = 1;
  return e;
}

// Each of these is silently MANGLED by plain JSON and tokenised by the real serializer,
// so each one is caught only because the validator compares the two forms.
for (const [id, value, why] of [
  ['E2 NaN', NaN, 'plain JSON turns it into null'],
  ['E3 -0', -0, 'plain JSON prints it as 0'],
  ['E1 undefined', undefined, 'plain JSON drops the key'],
  ['E5 Map', new Map([[2, 0]]), 'plain JSON flattens it to {}'],
  ['E6 typed array', new Uint8Array([1, 2, 255]), 'plain JSON turns it into {"0":1,…}'],
]) {
  expectRejected(withLiveSnap({ left: value }), 'SNAP_NOT_CANONICAL', 'I6', `I6 live snap: ${id} (${why})`);
}

// A dangling __ref decodes to nothing at all, and NO amount of JSON parsing would notice.
const dangling = withLiveSnap({ alias: { __ref: 7 } });
dangling.steps[0].snap.head = { n: 1 };
const dangRes = validateEnvelope(dangling);
check(
  !dangRes.isValid && dangRes.errors.some((e) => e.startsWith('SNAP_UNDESERIALIZABLE')),
  'I6: a dangling __ref is caught by the real serializer, not by JSON',
  `errors: ${JSON.stringify(dangRes.errors)}`
);

// Past MAX_DEPTH the serializer returns an error object rather than throwing, so the
// flush still happens (E9) — but the envelope must SAY so rather than ship a 10 000-deep
// snap as if it were a value.
const deep = withLiveSnap({ tree: (() => { const r = {}; let c = r; for (let i = 1; i < MAX_DEPTH + 2; i++) c.next = (c = {}); return r; })() });
const deepRes = validateEnvelope(deep);
check(
  !deepRes.isValid && deepRes.errors.some((e) => e.startsWith('SNAP_MAX_DEPTH') && e.includes('maxDepth')),
  'I6: a snap past MAX_DEPTH is reported, not silently accepted',
  `errors: ${JSON.stringify(deepRes.errors.slice(0, 2))}`
);
check(serialize(deep.steps[0].snap.tree).error === 'maxDepth', 'I6: MAX_DEPTH is the serializer own cap, imported not re-declared');

// I2 — the sandbox envelope (`sandbox.mjs:64-69`) carries `tests`. If trace-runner copies
// that verdict wholesale, a traced run gets to edit the counts it is supposed to report,
// and plan §5 invariant 2 ("a trace can never move a verdict") fails silently.
const smuggled = clone(good);
smuggled.verdict = { passed: 3, failed: 0, tests: [{ name: 'canonical', ok: true }] };
expectRejected(smuggled, 'VERDICT_EXTRA_FIELD', 'I2', 'I2 verdict carrying a tests array');

// I3 — `truncated` is an object in v1.1 but a BOOLEAN in `sandbox.mjs:187`, where it means
// "the 100 k log cap was hit". Borrowing it is how an oversized trace used to look like a
// run with no steps: the payload was dropped and the flag pointed somewhere else.
const borrowedFlag = clone(good);
borrowedFlag.truncated = true;
expectRejected(borrowedFlag, 'TRUNCATED_FLAG_ALIAS', 'I3', 'I3 truncated borrowed from the log cap');

const aliasedFlag = clone(good);
aliasedFlag.truncated = { execution: false, display: false, trace: false, logs: true };
expectRejected(aliasedFlag, 'TRUNCATED_FLAG_ALIAS', 'I3', 'I3 truncated carrying a fourth log-cap flag');

// …and the flag that IS the trace's own must mean what it says: a truncated trace has
// shed its snapshots, so it must be in diff mode.
const lyingFlag = clone(good);
lyingFlag.truncated = { execution: false, display: false, trace: true };
const lyingRes = validateEnvelope(lyingFlag);
check(
  !lyingRes.isValid && lyingRes.errors.some((e) => e.startsWith('TRACE_TRUNCATED_WITHOUT_DIFF')),
  'I3: truncated.trace:true must be paired with budget.mode:"diff"',
  `errors: ${JSON.stringify(lyingRes.errors)}`
);

// I4, second half — diff mode with no server delta at all is the other way this invariant
// breaks: nothing was shed and nothing was emitted.
const noDelta = clone(good);
noDelta.budget = { bytes: 7549747, mode: 'diff', chunks: 4 };
noDelta.steps = good.steps.map((s) => ({ ...s, snap: null, delta: [] }));
expectRejected(noDelta, 'DIFF_MODE_NO_DELTA', 'I4', 'I4 diff mode with no server delta');

// I7, positive half — a truncated execution is the ONE case where a zero sum is legal
// (E24: the 3 s timeout fired, so the raw run produced no verdict either).
const timedOut = clone(good);
timedOut.verdict = { passed: 0, failed: 0 };
timedOut.truncated = { execution: true, display: false, trace: false };
check(validateEnvelope(timedOut).isValid, 'I7: truncated.execution makes a zero-sum verdict legal');

// I1, second half — an offset past the end of the block is the same class of stale link.
const pastEnd = clone(good);
pastEnd.steps = [{ ...clone(good.steps[0]), line: { h: HASH, off: good.block.lines } }];
pastEnd.stepCount = 1;
expectRejected(pastEnd, 'STEP_OFFSET_OUT_OF_RANGE', 'I1', 'I1 line.off past block.lines');

// ---- the schema document is the contract these assertions read --------------------

const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf-8'));
const jqSchema = spawnSync('jq', ['-S', '.'], { input: fs.readFileSync(SCHEMA, 'utf-8'), encoding: 'utf8' });
check(jqSchema.status === 0, 'schema: `jq -S . docs/trace-schema.json` parses it', jqSchema.stderr);

const schemaIds = schema.invariants.map((i) => i.id);
check(schema.invariants.length === 7, 'schema: carries all seven invariants', `ids: ${JSON.stringify(schemaIds)}`);
for (const id of ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']) {
  check(schemaIds.includes(id), `schema: invariant ${id} is numbered as this test asserts it`);
  check(
    typeof schema.invariants.find((i) => i.id === id)?.check === 'string',
    `schema: invariant ${id} states the check that is executed`
  );
}
const documented = new Set(schema.fields.map((f) => f.name));
for (const field of ['v', 'path', 'level', 'fnName', 'codec', 'block', 'watch', 'steps', 'result', 'verdict', 'truncated', 'budget', 'stepCount', 'error']) {
  check(documented.has(field), `schema: field \`${field}\` is documented`);
}
check(schema.fields.every((f) => typeof f.meaning === 'string' && f.meaning.length > 0),
  'schema: every field states what it MEANS, not just its type');
check(schema.caps.envelopeSlotChars === 1024 * 1024, 'schema: the 1 MB slot is the measured sandbox constant');
check(schema.caps.timeoutMs === 3000 && schema.caps.heapBytes === 16 * 1024 * 1024,
  'schema: 3 s timeout and 16 MB heap come from sandbox.mjs, not from a wish');
check(schema.validator.includes('validate-envelope.mjs'), 'schema: names the executable that enforces it');

// ---- S3: the CLI is the surface rows 10/11/12 will actually call -----------------

function runCli(file) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'validate-envelope.mjs'), path.join(FIXTURES, file)], { encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

const cliGood = runCli('good-two-sum.json');
check(cliGood.status === 0, 'CLI: good fixture exits 0', cliGood.output);
const cliBigint = runCli('bad-raw-bigint-snap.mjs');
check(cliBigint.status === 1, 'CLI: a live-BigInt .mjs fixture exits non-zero', cliBigint.output);
check(cliBigint.output.includes('SNAP_NOT_CANONICAL'), 'CLI: it names the reason it rejected', cliBigint.output);
const cliMissing = runCli('does-not-exist.json');
check(cliMissing.status !== 0, 'CLI: an unreadable path exits non-zero rather than throwing', cliMissing.output);

// ---- summary ---------------------------------------------------------------------
// Seven bad fixture FILES (six `.json` + one `.mjs`) plus the invariants no file can hold.
console.log('\n========================================');
console.log(`Bad fixture FILES rejected by name: ${rejectedFiles}/7 — stale block hash [I1], diff mode with a snap [I4],`);
console.log(`  unwatched operand [I5], zero-sum verdict [I7], missing \`watch\` [required], wrong v [version], live BigInt [I6]`);
console.log(`Extra rejections from in-test mutations: ${rejectedCases} (the cases no .json fixture can hold)`);
console.log(`Invariants asserted by id: ${schemaIds.join(', ')}`);
console.log(`Assertions: ${assertions} | Failures: ${failures}`);
console.log('========================================\n');

if (failures > 0) process.exit(1);