/**
 * Envelope v1.1 validator — plan v5 §5, all seven invariants.
 *
 * Row 5 is the row-13 freeze point, so this file is what "frozen" means: once the goldens
 * (row 13) are green, nothing may change the envelope's meaning without changing this.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO
 *
 * 1. It does not use a schema library. `ajv`/`zod`/`joi` are deliberately NOT added:
 *    plan v5 §0.2 admits exactly `acorn` + `acorn-walk` as new devDependencies, and none of
 *    them is a validator. The whole contract is ~200 lines of `typeof` checks, and the
 *    cross-field invariants a JSON Schema cannot express anyway (I1, I3, I4, I5, I7) are
 *    the only ones worth failing CI over.
 * 2. It does not re-implement the serializer. Snap values are checked THROUGH
 *    `scripts/lib/serialize.mjs` (row 6), because `JSON.stringify` is the bug that module
 *    exists to kill: it silently drops `undefined`, turns `NaN`/`Infinity` into `null`,
 *    prints `-0` as `0`, and THROWS on `BigInt` (plan §6 E1–E4).
 * 3. It does not re-derive `blockHash`. `line.h === block.hash` is the whole contract —
 *    row 7 hashes the block once, and this checks that every step agrees with it.
 *
 * Exports:
 *   validateEnvelope(obj) -> { isValid, errors }   — the stable shape rows 10/11/12 import.
 *   SCHEMA_VERSION / CHUNK_MAX_CHARS / BYTE_BUDGET / EXEC_STEP_CAP / DISPLAY_STEP_CAP
 *   — defined ONCE here so the runner cannot pick a second, larger number than the schema.
 *
 * CLI: node scripts/validate-envelope.mjs <file>   (exits 1 on any error)
 *      A `.mjs` path is imported for its default export, because a raw BigInt — the I6
 *      fixture — cannot be written in JSON at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serialize, stringify, deserialize, MAX_DEPTH } from './lib/serialize.mjs';

// ---- the caps, from measured constants (plan §5, plan §1 P5) ----------------------

/** `api/_lib/sandbox.mjs:11` — `ENVELOPE_MAX_CHARS = 1024 * 1024`. The REAL slot. */
export const CHUNK_MAX_CHARS = 1024 * 1024;
// ponytail: 12 chunks x 60% of the slot. v4's "4 MB byte budget" was fiction — the payload
// was silently dropped on overflow and the log-spam `truncated` flag reused, so an oversized
// trace surfaced as a trace with no steps (plan §1 U2, silent-wrong is the worst failure this
// system has). Degrade at 60% so there is room to ship the truncation flag itself. Raise only
// with a measured need, e.g. the median step size across 3 000 problems.
export const BYTE_BUDGET = Math.floor(CHUNK_MAX_CHARS * 12 * 0.6);
export const EXEC_STEP_CAP = 200_000; // ponytail: arbitrary, ~4x the worst guide measured; retune after 150 goldens
export const DISPLAY_STEP_CAP = 2_000; // ponytail: UI-only; raise when a real trace needs it

/** The contract revision this file enforces. Frozen at row 13. */
export const SCHEMA_VERSION = 1;

// ---- the shapes §5 pins -----------------------------------------------------------

const STEP_TYPES = ['decl', 'assign', 'if-test', 'loop-head', 'loop-back', 'call', 'return', 'exit', 'throw'];
const LEVELS = [1, 2, 3];
const BUDGET_MODES = ['full', 'diff'];
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** Words that are values, not bindings, so invariant 5 does not demand they be watched. */
const OPERAND_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this']);

/**
 * The BINDINGS an `operands` key names. A dot means the next identifier is a property, not
 * a binding (`seen.get` -> `get` is not a variable), so `seen.get(complement)` yields
 * {seen, complement}.
 *
 * ponytail: an operand expression is one of three things — a literal, an identifier, or a
 * member/call expression — so a token walk covers all of them. Ceiling: a template literal
 * or a computed member key (`nums[i + 1]`, `obj[name]`) is read as plain identifiers, which
 * is over-strict rather than under-strict (it can demand a watch entry that does not exist,
 * never let an uninstrumented name through). Row 9's acorn walk is the place to parse it.
 */
function operandBindings(expr) {
  const names = new Set();
  const re = /([A-Za-z_$][A-Za-z0-9_$]*)|(\.)/g;
  let afterDot = false;
  let m;
  while ((m = re.exec(String(expr))) !== null) {
    if (m[2]) { afterDot = true; continue; }
    if (afterDot) { afterDot = false; continue; }
    if (!OPERAND_LITERALS.has(m[1])) names.add(m[1]);
  }
  return names;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const keysOf = (v) => Object.keys(v).sort().join();

/**
 * Why a `snap` is not the canonical form the envelope transports — `{code, detail}`, or
 * null if it is.
 *
 * The envelope IS text. A `snap` therefore has to arrive already tokenised: the live values
 * are what row 6's serializer consumes, and anything still live is a producer that skipped
 * it. So this compares the two forms, which is the only comparison with teeth here —
 * plain JSON accepts a BigInt-shaped thing silently (it becomes null) and only throws on a
 * raw BigInt, whereas the canonical serializer accounts for all four (E1-E4).
 *
 * Three distinct codes, because they are three different producer bugs: a snap past the
 * depth cap (E9), a snap the serializer cannot decode at all (a dangling `__ref`, an
 * unknown typed-array name — neither of which any amount of JSON parsing would notice), and
 * a snap that simply never went through the serializer.
 */
function snapDefect(snap) {
  const encoded = serialize(snap);
  if (isObject(encoded) && encoded.error === 'maxDepth') {
    return {
      code: 'SNAP_MAX_DEPTH',
      detail: `depth ${encoded.depth} exceeds the canonical serializer's MAX_DEPTH (${MAX_DEPTH}) — the flush must carry error:"maxDepth", not a ${MAX_DEPTH + 1}-deep snap`,
    };
  }
  try {
    deserialize(snap);
  } catch (err) {
    return { code: 'SNAP_UNDESERIALIZABLE', detail: `the canonical serializer refuses to decode it (${err.message})` };
  }
  let plain;
  try {
    plain = JSON.stringify(snap);
  } catch (err) {
    return {
      code: 'SNAP_NOT_CANONICAL',
      detail: `plain JSON has no form for it (${err.message}) — the canonical serializer would have tokenised it, so this snap never went through one`,
    };
  }
  const transported = stringify(JSON.parse(plain));
  if (transported !== stringify(snap)) {
    return {
      code: 'SNAP_NOT_CANONICAL',
      detail: 'it holds live values, not the canonical tokens (`undefined`, `NaN`, `-0`, `BigInt`, `Map`/`Set` and typed arrays are all tokenised by serialize.mjs)',
    };
  }
  return null;
}

/**
 * Validate one envelope v1.1.
 * @returns {{isValid: boolean, errors: string[]}} — the shape rows 10/11/12 import. Every
 *   error is `CODE [tag]: message`, so a caller can filter by invariant id.
 */
export function validateEnvelope(obj) {
  const errors = [];
  const err = (code, tag, message) => errors.push(`${code} [${tag}]: ${message}`);

  if (!isObject(obj)) {
    err('ENVELOPE_NOT_OBJECT', 'required', 'an envelope must be a JSON object');
    return { isValid: false, errors };
  }

  // An absent field is reported ONCE, by MISSING_FIELD below, and never a second time as a
  // shape error — otherwise "rejected for exactly one named reason" is untestable for absence.
  const has = (key) => key in obj;

  // ---- [version] the contract revision. Checked, not assumed: an envelope from another
  // revision may use the same field NAMES for different MEANINGS.
  if (has('v') && obj.v !== SCHEMA_VERSION) {
    err('VERSION_UNSUPPORTED', 'version', `v is ${JSON.stringify(obj.v)}; this validator enforces v1.1, whose \`v\` is ${SCHEMA_VERSION}`);
  }

  // ---- [required] every top-level field §5 shows. Reported together so one run lists
  // everything that is absent, rather than making CI show them one push at a time.
  for (const field of ['v', 'path', 'level', 'fnName', 'codec', 'block', 'watch', 'steps', 'result', 'verdict', 'truncated', 'budget', 'stepCount', 'error']) {
    if (!has(field)) err('MISSING_FIELD', 'required', `\`${field}\` is required by §5`);
  }

  if (has('path') && !isNonEmptyString(obj.path)) err('BAD_FIELD', 'required', '`path` must be a non-empty string');
  if (has('level') && !LEVELS.includes(obj.level)) err('BAD_FIELD', 'required', `\`level\` must be one of ${LEVELS.join('|')}, got ${JSON.stringify(obj.level)}`);
  if (has('fnName') && !isNonEmptyString(obj.fnName)) err('BAD_FIELD', 'required', '`fnName` must be a non-empty string');
  // ponytail: the codec WHITELIST is row 17's (plan §3 G1), and it grows as codecs land, so
  // pinning the five names here would reject a valid envelope the moment row 17 ships a
  // sixth. Check the shape; let the registry own the membership.
  if (has('codec') && !isNonEmptyString(obj.codec)) err('BAD_FIELD', 'required', '`codec` must be a non-empty string');
  if (has('stepCount') && !isCount(obj.stepCount)) err('BAD_FIELD', 'required', `\`stepCount\` must be a non-negative integer, got ${JSON.stringify(obj.stepCount)}`);
  else if (obj.stepCount > EXEC_STEP_CAP) {
    err('STEP_CAP_EXCEEDED', 'required', `\`stepCount\` ${obj.stepCount} exceeds the execution cap of ${EXEC_STEP_CAP} — the run must abort with a TLE-shaped verdict instead`);
  }
  if (has('error') && obj.error !== null && !isNonEmptyString(obj.error)) {
    err('BAD_FIELD', 'required', '`error` must be null or a non-empty string (§5 G3: set on a thrown step, with the partial trace still flushed)');
  }

  // ---- `block`: the anchor every step's offset resolves against (plan §3 K5).
  const blockOk = has('block') && isObject(obj.block);
  if (blockOk) {
    if (!HASH_RE.test(obj.block.hash ?? '')) {
      err('BAD_FIELD', 'required', `\`block.hash\` must be \`sha256:\` + 64 lowercase hex (sha256 of the block source), got ${JSON.stringify(obj.block.hash)}`);
    }
    if (!isCount(obj.block.startLine) || obj.block.startLine < 1) err('BAD_FIELD', 'required', '`block.startLine` must be a positive integer');
    if (!isCount(obj.block.lines) || obj.block.lines < 1) err('BAD_FIELD', 'required', '`block.lines` must be a positive integer');
  } else if (has('block')) {
    err('BAD_FIELD', 'required', '`block` must be an object {hash, startLine, lines}');
  }

  // ---- `watch`: the identifiers the instrumenter captured (plan §1 A1).
  const watch = has('watch') && Array.isArray(obj.watch) ? obj.watch.filter(isNonEmptyString) : null;
  if (has('watch')) {
    if (!watch) err('BAD_FIELD', 'required', '`watch` must be an array of non-empty strings');
    else if (new Set(watch).size !== watch.length) err('BAD_FIELD', 'required', '`watch` has duplicate entries');
  }

  // ---- `budget`: what the envelope cost, and whether it shed its snapshots.
  const budget = has('budget') && isObject(obj.budget) ? obj.budget : null;
  if (budget) {
    if (!isCount(budget.bytes)) err('BAD_FIELD', 'required', '`budget.bytes` must be a non-negative integer');
    else if (budget.bytes > BYTE_BUDGET) {
      err('BYTE_BUDGET_EXCEEDED', 'required', `\`budget.bytes\` ${budget.bytes} exceeds the assembled budget of ${BYTE_BUDGET} (60% of 12 x the 1 MB envelope slot, sandbox.mjs:11)`);
    }
    if (!BUDGET_MODES.includes(budget.mode)) err('BAD_FIELD', 'required', `\`budget.mode\` must be one of ${BUDGET_MODES.join('|')}, got ${JSON.stringify(budget.mode)}`);
    if (!isCount(budget.chunks) || budget.chunks < 1) err('BAD_FIELD', 'required', '`budget.chunks` must be a positive integer (one `__TRACE__<seq>` slot minimum)');
  } else if (has('budget')) {
    err('BAD_FIELD', 'required', '`budget` must be an object {bytes, mode, chunks}');
  }

  // ---- [I2] `verdict` — copied from an UNINSTRUMENTED run; a trace can never move it.
  // The provenance half is enforced by construction (row 10 runs the canonical case twice:
  // once instrumented for steps, once raw for the verdict) and is not checkable from a
  // single envelope. What IS checkable is that nothing else rode along: `sandbox.mjs:64-69`
  // carries a `tests` array in its verdict envelope, and copying that whole object is how a
  // traced run would get to edit the counts it is supposed to report.
  if (has('verdict') && !isObject(obj.verdict)) {
    err('BAD_FIELD', 'I2', '`verdict` must be an object {passed, failed}');
  } else if (isObject(obj.verdict)) {
    if (keysOf(obj.verdict) !== 'failed,passed') {
      err('VERDICT_EXTRA_FIELD', 'I2', `\`verdict\` must be exactly {passed, failed} — a traced run must not be able to report anything else (got {${keysOf(obj.verdict)}})`);
    }
    if (!isCount(obj.verdict.passed)) err('BAD_FIELD', 'I2', '`verdict.passed` must be a non-negative integer');
    if (!isCount(obj.verdict.failed)) err('BAD_FIELD', 'I2', '`verdict.failed` must be a non-negative integer');
  }

  // ---- [I3] `truncated.trace` carries its OWN flag.
  // In v1.1 `truncated` is an object of three named booleans. In `sandbox.mjs:187` it is a
  // single BOOLEAN meaning "the 100 k log cap was hit". Reusing that one flag is precisely
  // how an oversized trace used to look like a run with no steps: the payload was dropped
  // silently and the only signal pointed at the log buffer instead (plan §1 U2).
  const truncated = has('truncated') && isObject(obj.truncated) ? obj.truncated : null;
  if (has('truncated') && !truncated) {
    err('TRUNCATED_FLAG_ALIAS', 'I3', `\`truncated\` must be the object {execution, display, trace} — a bare boolean is sandbox.mjs's LOG cap (maxLogChars), which plan §5 forbids borrowing as a trace flag`);
  } else {
    if (keysOf(truncated) !== 'display,execution,trace') {
      err('TRUNCATED_FLAG_ALIAS', 'I3', `\`truncated\` must be exactly {execution, display, trace}, got {${keysOf(truncated)}} — a fourth flag is the log cap wearing the trace's name`);
    }
    for (const key of ['execution', 'display', 'trace']) {
      if (typeof truncated[key] !== 'boolean') err('BAD_FIELD', 'I3', `\`truncated.${key}\` must be a boolean`);
    }
  }

  // ---- [I7] a verdict that ran nothing says nothing. The one exception is a truncated
  // EXECUTION (E24, the 3 s timeout), where the raw run produced no verdict either.
  const verdictSum = isObject(obj.verdict) && isCount(obj.verdict.passed) && isCount(obj.verdict.failed)
    ? obj.verdict.passed + obj.verdict.failed
    : null;
  if (verdictSum === 0 && !(truncated && truncated.execution === true)) {
    err('VERDICT_ZERO_SUM', 'I7', '`verdict.passed + verdict.failed` is 0 while `truncated.execution` is false — either no case ran, or the verdict came from the traced run');
  }

  // ---- [I4] degrade-to-diff has to actually degrade.
  const diffMode = budget && budget.mode === 'diff';
  if (diffMode) {
    // The snapshot is the payload. Keeping it in diff mode means the same 1 MB slot that
    // overflowed is still full of the thing that overflowed it.
    if (Array.isArray(obj.steps)) {
      for (const [i, step] of obj.steps.entries()) {
        if (isObject(step) && step.snap != null) {
          err('DIFF_MODE_HAS_SNAP', 'I4', `steps[${i}].snap is present while \`budget.mode\` is "diff" — a degraded envelope must shed snapshots and stream server-emitted deltas instead`);
        }
      }
    }
    const emitted = Array.isArray(obj.steps) && obj.steps.some((s) => isObject(s) && Array.isArray(s.delta) && s.delta.length > 0);
    if (!emitted) {
      err('DIFF_MODE_NO_DELTA', 'I4', '`budget.mode` is "diff" but no step carries a delta — nothing was shed and nothing was emitted, so the trace renders blank');
    }
  }

  // ---- [I3] a trace that shed its payload must say so in the one field that means it.
  if (truncated && truncated.trace === true && budget && budget.mode !== 'diff') {
    err('TRACE_TRUNCATED_WITHOUT_DIFF', 'I3', '`truncated.trace` is true while `budget.mode` is not "diff" — a truncated trace has shed its snapshots, and this one claims it kept them');
  }

  // ---- steps
  const steps = has('steps') && Array.isArray(obj.steps) ? obj.steps : null;
  if (steps && isCount(obj.stepCount) && obj.stepCount < steps.length) {
    err('BAD_FIELD', 'required', `\`stepCount\` ${obj.stepCount} is below the ${steps.length} steps present — it counts EXECUTED steps, which is at least the ones shipped`);
  }
  if (steps && steps.length > DISPLAY_STEP_CAP && !(truncated && truncated.display === true)) {
    err('DISPLAY_STEP_CAP_EXCEEDED', 'required', `${steps.length} steps exceed the display cap of ${DISPLAY_STEP_CAP} without \`truncated.display\` — the UI would be handed more than it can show`);
  }
  if (steps) {
    const watched = watch ? new Set(watch) : null;
    let previousN = 0;
    for (const [i, step] of steps.entries()) {
      if (!isObject(step)) {
        err('BAD_FIELD', 'required', `steps[${i}] must be an object`);
        continue;
      }
      for (const field of ['n', 'line', 'type', 'text', 'operands', 'cond', 'snap', 'delta', 'out', 'override']) {
        if (!(field in step)) err('MISSING_FIELD', 'required', `steps[${i}].${field} is required by §5`);
      }
      if (isCount(step.n)) {
        if (step.n <= previousN) err('BAD_FIELD', 'required', `steps[${i}].n is ${step.n}, not greater than the previous step's ${previousN}`);
        previousN = step.n;
      } else {
        err('BAD_FIELD', 'required', `steps[${i}].n must be a positive integer`);
      }
      if (!STEP_TYPES.includes(step.type)) err('BAD_FIELD', 'required', `steps[${i}].type must be one of ${STEP_TYPES.join('|')}, got ${JSON.stringify(step.type)}`);
      if (!isNonEmptyString(step.text)) err('BAD_FIELD', 'required', `steps[${i}].text must be a non-empty string (the guide source at that offset)`);
      if (step.cond !== null && typeof step.cond !== 'boolean') err('BAD_FIELD', 'required', `steps[${i}].cond must be a boolean or null`);
      if (!isObject(step.operands)) {
        err('BAD_FIELD', 'required', `steps[${i}].operands must be an object`);
      } else if (watched) {
        // ---- [I5] every identifier an operand names is either watched, or a literal.
        // An unwatched name renders a value no instrumenter ever captured — the trace
        // looks right and is hollow, which is the shape of every CI guard in the plan.
        // ONE error per step, naming every missing binding: an operator expression can name
        // several (`nums[k]` names `nums` and `k`), and one finding per step is what keeps
        // "rejected for exactly one named reason" a property a fixture can hold.
        const missing = new Map(); // binding -> the operand keys that asked for it
        for (const expr of Object.keys(step.operands)) {
          for (const name of operandBindings(expr)) {
            if (!watched.has(name)) missing.set(name, [...(missing.get(name) ?? []), expr]);
          }
        }
        if (missing.size > 0) {
          const named = [...missing].map(([name, keys]) => `\`${name}\` (from ${keys.map((k) => `"${k}"`).join(', ')})`).join(', ');
          err('OPERAND_NOT_WATCHED', 'I5', `steps[${i}].operands names ${named}, which is in neither \`watch\` nor a literal — capture it or drop the operand`);
        }
      }
      if (step.snap != null) {
        if (!isObject(step.snap)) {
          err('BAD_FIELD', 'I6', `steps[${i}].snap must be an object or null`);
        } else {
          const defect = snapDefect(step.snap);
          if (defect) err(defect.code, 'I6', `steps[${i}].snap is not the canonical serializer's output: ${defect.detail}`);
        }
      }
      if (!Array.isArray(step.delta)) {
        err('BAD_FIELD', 'I4', `steps[${i}].delta must be an array`);
      } else {
        for (const [j, change] of step.delta.entries()) {
          if (!isObject(change)) { err('BAD_FIELD', 'I4', `steps[${i}].delta[${j}] must be an object {path, from, to}`); continue; }
          if (!isNonEmptyString(change.path)) err('BAD_FIELD', 'I4', `steps[${i}].delta[${j}].path must be a non-empty string`);
          if (!('from' in change) || !('to' in change)) err('BAD_FIELD', 'I4', `steps[${i}].delta[${j}] needs both \`from\` and \`to\` (either may be null)`);
        }
      }
      if (!isNonEmptyString(step.out)) err('BAD_FIELD', 'required', `steps[${i}].out must be a non-empty string (the rendered narration)`);
      if (step.override != null && typeof step.override !== 'string') {
        err('BAD_FIELD', 'required', `steps[${i}].override must be a string or null (plan §3 D12)`);
      }

      // ---- [I1] the guide↔trace link. `line.h` is what makes a golden survive an edit to
      // the guide (plan §1 U4): the offset stays meaningful because the HASH re-derives, and
      // a stale one is a named failure instead of an unreadable line diff (E19).
      if (!isObject(step.line)) {
        err('BAD_FIELD', 'I1', `steps[${i}].line must be an object {h, off}`);
      } else {
        if (step.line.h !== (blockOk ? obj.block.hash : undefined)) {
          err('STEP_HASH_MISMATCH', 'I1', `steps[${i}].line.h is ${JSON.stringify(step.line.h)} but \`block.hash\` is ${JSON.stringify(blockOk ? obj.block.hash : undefined)} — the guide was edited after this step was recorded (E19)`);
        }
        const span = blockOk ? obj.block.lines : null;
        if (!isCount(step.line.off) || (span !== null && step.line.off >= span)) {
          err('STEP_OFFSET_OUT_OF_RANGE', 'I1', `steps[${i}].line.off is ${JSON.stringify(step.line.off)}, outside the block's ${span} line(s)`);
        }
      }
    }
  } else if (has('steps')) {
    err('BAD_FIELD', 'required', '`steps` must be an array');
  }

  return { isValid: errors.length === 0, errors };
}

/** CLI: read one envelope, print every error, exit non-zero if there are any. */
async function runCli(argv) {
  const target = argv[0];
  if (!target) {
    console.error('usage: node scripts/validate-envelope.mjs <envelope.json|envelope.mjs>');
    process.exit(2);
  }
  const abs = path.resolve(target);
  let envelope;
  try {
    // A `.mjs` fixture has to be imported, not parsed: a live BigInt — the I6 case — cannot
    // be written in JSON at all, and `JSON.parse` would reject the document as malformed
    // before any invariant got a chance to speak.
    envelope = abs.endsWith('.mjs')
      ? (await import(pathToFileURL(abs).href)).default
      : JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error(`❌ UNREADABLE_ENVELOPE: ${path.relative(process.cwd(), abs)} — ${err.message}`);
    process.exit(1);
  }
  const res = validateEnvelope(envelope);
  if (res.isValid) {
    console.log(`✅ [PASS] ${path.relative(process.cwd(), abs)} — envelope v1.1, ${Array.isArray(envelope.steps) ? envelope.steps.length : 0} steps`);
    return;
  }
  console.error(`❌ [FAIL] ${path.relative(process.cwd(), abs)} — ${res.errors.length} error(s)`);
  for (const e of res.errors) console.error(`   - ${e}`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runCli(process.argv.slice(2));
}