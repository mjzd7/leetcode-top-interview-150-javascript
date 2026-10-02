/**
 * `api/_lib/trace-runner.mjs` — run an instrumented solution block and produce an
 * envelope v1.1. Plan v5 §7 row 10, §3 K2/K4/G3, §5, §6 ledger.
 *
 * Five responsibilities live here, and nothing else:
 *
 *   1. STATIC REGION GATE (K4). A step is emitted only when the manifest says the node it
 *      came from is at region depth 0. The comparison is ONE integer against the
 *      `regionTable` that ships into the sandbox; there is no runtime depth counter and no
 *      call-stack inspection anywhere in this file. That is the whole point: a recursive
 *      target's own self-call is lexically inside the target, so the manifest marks it
 *      depth 0 and it emits. A runtime counter would have to guess, and would guess wrong
 *      exactly where it matters (row 7 measured 106 selfRecursive blocks).
 *
 *   2. WATCH SNAPSHOTS (K6). Every watched binding is captured through the canonical
 *      serializer — `scripts/lib/serialize.mjs`, the SAME module row 6 wrote and
 *      `api/_lib/codecs.mjs` already imports — injected into the sandbox with its `export`
 *      keywords stripped. Plain `JSON.stringify` drops `undefined`, turns `NaN`/`Infinity`
 *      into `null`, collapses `Map`/`Set` to `{}`, and THROWS on BigInt, which would kill
 *      the run from inside the probe.
 *
 *   3. CHUNKED OUTPUT (K2). Steps go out as `__TRACE__<seq>` slots, each held under the
 *      measured 1 MB ceiling, and are assembled HOST-side. A gap in the sequence is a
 *      hard `TraceAssemblyError`, never a silently short trace.
 *
 *   4. THROW-SAFE FLUSH (G3). A thrown step flushes everything captured so far with
 *      `error` set, and the trace stays valid.
 *
 *   5. THE CAPS, AND WHAT HAPPENS WHEN A TRACE STOPS FITTING (rows 11/12).
 *
 * ── Where each cap comes from, and why none of them is a number someone picked ────────────
 * `api/_lib/sandbox.mjs` measures three things: a 1 MB envelope slot (line 11), a 16 MB heap,
 * and a 3 s clock. Every ceiling below is one of those or arithmetic on one of them.
 *
 *   IN THE SANDBOX (`buildPrelude`):
 *     - `__T_TRAVEL__`  — a step wider than the whole transport can never be delivered, so
 *                         recording stops rather than shipping a step that eats the log
 *                         allowance and makes `sandbox.mjs` drop the NEXT slot. (E22)
 *     - `__T_ALLOW__`   — `chunkCap x slots + LOG_HEADROOM`, which is `sandbox.mjs`'s own
 *                         `maxLogChars` for this run. The WRITER stops at one slot cap below
 *                         it, reserving room for the terminating slot. The writer is where this
 *                         lives, not the probe, because the writer is the one place every probe
 *                         must pass through and the only one that knows the real size of what
 *                         it is about to send — which is also how row 15's `ADAPTER_PROBE`, a
 *                         separate emitter this row may not edit, is covered for free.
 *     - `__T_DEGRADE_SLOT__` — shed snapshots, emit deltas instead, two slots before the end.
 *     - `__T_EXECD__`   — `EXEC_STEP_CAP` steps, after which the probe THROWS, because a
 *                         runaway loop that keeps running while nothing is recorded is the
 *                         opposite of what a cap is for. (E23)
 *     - a delta that is not SMALLER than the snapshot it replaces ends recording: a watched
 *       container that grows every step (two-sum's `seen` Map) re-encodes in full on both
 *       sides of every delta, so the "compact" form is the larger form. Measured on the
 *       `n=5000` fixture: 879 delta-encoded steps still cost 12.6 MB, over the schema's own
 *       7.5 MB ceiling — an envelope `validateEnvelope` REJECTS, which is worse than a short
 *       one. (E22)
 *
 *   HOST-SIDE (this file):
 *     - `BYTE_BUDGET`     — the settled envelope's own size; over it, `degradeToDiff`. (E20)
 *     - `DISPLAY_STEP_CAP` — sets `truncated.display`. A LABEL, not a rewrite: §5's own
 *       validator accepts a step list above the cap once the flag is set, five shipped
 *       goldens rely on it, and `judge/traces/*.head.json` commits the LAST step, so slicing
 *       here would leave the committed head describing a step the file does not contain.
 *       `stepCount` stays the EXECUTED count either way.
 *
 * `truncated.trace` is this file's OWN flag and never borrows `sandbox.mjs`'s boolean of the
 * same name, which means "the 100 k log cap was hit". Reusing it is how an oversized trace
 * used to arrive as a plausible trace with no steps — silent-wrong, plan §1 U2.
 *
 * ── Verdict isolation (I2) ─────────────────────────────────────────────────────────
 * The verdict comes from an UNINSTRUMENTED run. `runBlockTrace` therefore executes the
 * sandbox TWICE: once with the instrumented block for steps, once with the raw block
 * through `buildBundle` for `{passed, failed}`. Instrumentation reads state, costs time,
 * and changes allocation behaviour; a verdict produced while the probe suite is live
 * describes the probe suite. Nothing this file writes can reach the raw run's counts.
 *
 * ── The ABI `scripts/instrument.mjs` (row 9) emits against ─────────────────────────
 * One injected global, called at each emit point:
 *
 *     __T__(regionIdx, off, type, cond, operandKeys, snapThunks, operandThunks)
 *
 *       regionIdx     index into the manifest's `regionTable`
 *       off           0-based line offset within the BLOCK (never a guide line — K5)
 *       type          decl|assign|if-test|loop-head|loop-back|call|return|exit|throw
 *       cond          boolean for a branch, null otherwise
 *       operandKeys   ["nums[mid] >= target", ...]  — static, for invariant 5
 *       snapThunks    { left: function(){ return left; }, ... }  — keys are watch names
 *       operandThunks [function(){ return nums[mid]; }, ...]    — parallel to operandKeys
 *
 * Snapshots and operand values are THUNKS, never bare identifiers, and that is not
 * stylistic. A bare `left` at a point where `let left` is still in TDZ throws inside the
 * traced function and takes the whole case down; each thunk is called in its own
 * try/catch and a binding that cannot be read is simply absent from that step's snapshot,
 * which is what "not captured here" honestly looks like.
 *
 * ── Filesystem ────────────────────────────────────────────────────────────────────
 * Reads `build/blocks.json` and, when no `source` is supplied, the guide itself. That is
 * one more directory beyond what `api/_lib/problems.mjs` already reads (`catalog/`,
 * `judge/tests/`) and one more than `codecs.mjs` reaches into (`scripts/lib/`), and it is
 * the third: `build/` is a regenerable artifact, gitignored, produced by
 * `node scripts/gen-blocks.mjs`. It ships in the bundle (not in `.vercelignore`), and a
 * missing manifest raises `ManifestMissingError` naming that command rather than
 * degrading to "no blocks".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { executeUserCode } from './sandbox.mjs';
import { PROBLEMS, buildBundle } from './problems.mjs';
import { getCodec } from './codecs.mjs';
import { serialize, deserialize, stringify } from '../../scripts/lib/serialize.mjs';
// Row 5 owns the caps and says so in its own header: "defined ONCE here so the runner cannot
// pick a second, larger number than the schema". So rows 11/12 IMPORT them rather than
// re-deriving them — a second copy of a budget is how v4 ended up shipping a 4 MB wish
// against a 1 MB slot. `CHUNK_MAX_CHARS` is re-exported below under its historical name.
import {
  CHUNK_MAX_CHARS,
  BYTE_BUDGET,
  EXEC_STEP_CAP,
  DISPLAY_STEP_CAP,
} from '../../scripts/validate-envelope.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The regenerable manifest row 7 writes. Gitignored on purpose — see the header. */
export const BLOCKS_PATH = path.resolve(here, '../../build/blocks.json');

/** The trace slot prefix. Distinct from `sandbox.mjs`'s `ENVELOPE_PREFIX` on purpose. */
export const TRACE_PREFIX = '__TRACE__';

/**
 * The four caps of plan §5, re-exported from `validate-envelope.mjs` rather than declared
 * here. Row 5's own header says why: they are "defined ONCE here so the runner cannot pick a
 * second, larger number than the schema". A second copy of a budget is not a harmless
 * duplicate — it is exactly how v4 shipped a 4 MB wish against a 1 MB slot (plan §1 U2), where
 * the overflow was dropped silently and an oversized trace arrived as a plausible trace with
 * no steps.
 *
 * `CHUNK_MAX_CHARS` is the per-slot ceiling `api/_lib/sandbox.mjs:11` measures: 1 MB, past
 * which the payload is DROPPED and the log cap's `truncated` flag is reused. `BYTE_BUDGET` is
 * 60 % of twelve of those (`validate-envelope.mjs`), `EXEC_STEP_CAP` bounds steps executed,
 * `DISPLAY_STEP_CAP` bounds steps handed to a UI. The `ponytail:` ceiling for each lives with
 * its definition.
 */
export { CHUNK_MAX_CHARS, BYTE_BUDGET, EXEC_STEP_CAP, DISPLAY_STEP_CAP };

/**
 * Slots one trace may occupy before the log allowance runs out. Matches the plan's
 * `caps.chunksPerTrace`; row 11 re-derives the byte budget from both.
 */
export const CHUNKS_PER_TRACE = 12;

// ponytail: sandbox.mjs has exactly ONE special slot and it is `__VERDICT__`. A `__TRACE__`
// line therefore travels the LOG path, so `maxLogChars` — not ENVELOPE_MAX_CHARS — is what
// bounds a chunk in practice. This is the slack that allowance leaves above the slot count,
// and it is what the sandbox leaves itself to write the TERMINATING slot in. Upgrade path:
// raise `CHUNKS_PER_TRACE` (which sizes `maxLogChars`, the envelope budget and the display
// budget together) rather than this, so one number moves the transport and not three.
export const LOG_HEADROOM_CHARS = 100_000;

/**
 * The assembled ceiling, i.e. the whole trace's worth of slots. At the production numbers this
 * is `sandbox.mjs`'s own `maxLogChars` for the traced run — measured, not chosen.
 *
 * Why the sandbox has to stop somewhere below it: past this, `sandbox.mjs` DROPS a whole
 * `__TRACE__<seq>` line, and a dropped slot is a sequence gap, which `assembleChunks` refuses
 * to ship. The trace would then arrive as a hard error on an input that is merely large —
 * measured on `n=5000` two-sum, whose 5 000 snapshots of a 5 000-element array are ~120 MB of
 * step JSON against a 12.6 MB transport.
 */
export const ASSEMBLED_CEILING = CHUNK_MAX_CHARS * CHUNKS_PER_TRACE + LOG_HEADROOM_CHARS;

/** A `build/blocks.json` that is absent or unparseable. Named, never degraded around. */
export class ManifestMissingError extends Error {
  constructor(detail) {
    super(
      `Cannot read the block manifest at ${BLOCKS_PATH}: ${detail}. `
      + 'It is a regenerable artifact (gitignored) — run `node scripts/gen-blocks.mjs` first. '
      + 'There is no fallback: without the manifest there is no region table, and a step '
      + 'with no region is a step that was silently suppressed.',
    );
    this.name = 'ManifestMissingError';
  }
}

/**
 * The trace on the wire does not add up. Never returned as a shorter trace: a gap, a
 * duplicated slot, a slot sliced by the log cap, or a run that ended without a terminator
 * all mean the steps on hand are NOT the steps that executed.
 */
export class TraceAssemblyError extends Error {
  constructor(message) {
    super(`Trace assembly failed: ${message}`);
    this.name = 'TraceAssemblyError';
  }
}

/**
 * The instrumented source did not call this module's probe. Almost always means row 9's
 * emitter and this runner's ABI have drifted, and the symptom would otherwise be an EMPTY
 * trace that validates perfectly and says nothing — the vacuity hole E10/E11 exist to close.
 */
export class TraceAbiError extends Error {
  constructor(detail) {
    super(
      `The instrumented source does not call \`__T__\`: ${detail}\n`
      + 'This runner provides `__T__(regionIdx, off, type, cond, operandKeys, snapThunks, operandThunks)`\n'
      + 'and reads steps back from `__TRACE__<seq>` slots. An emitter with a different probe shape '
      + 'would produce an empty envelope that still passes every schema check, so this is refused '
      + 'rather than shipped. Pass `instrumented` matching the ABI documented at the top of this file.',
    );
    this.name = 'TraceAbiError';
  }
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// ---- the manifest ------------------------------------------------------------------

let blockIndex = null;

const readManifest = () => {
  let raw;
  try {
    raw = fs.readFileSync(BLOCKS_PATH, 'utf-8');
  } catch (err) {
    throw new ManifestMissingError(err.code === 'ENOENT' ? 'the file does not exist' : err.message);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ManifestMissingError(`it is not valid JSON (${err.message})`);
  }
  if (!Array.isArray(parsed?.blocks) || parsed.blocks.length === 0) {
    throw new ManifestMissingError('it carries no `blocks` array');
  }
  return parsed.blocks;
};

/**
 * Every block row 7 selected. Read once per cold start, then cached — this is a
 * regenerable 450-entry artifact, not per-request state.
 */
export function loadBlocks() {
  if (!blockIndex) {
    blockIndex = new Map();
    for (const block of readManifest()) blockIndex.set(`${block.path}#${block.level}`, block);
  }
  return [...blockIndex.values()];
}

/**
 * The manifest entry for one guide level. Throws for an unknown path/level rather than
 * returning undefined: an envelope with a made-up block hash validates and means nothing.
 */
export function getBlock(guidePath, level = 3) {
  loadBlocks();
  const block = blockIndex.get(`${guidePath}#${level}`);
  if (!block) {
    throw new ManifestMissingError(
      `no block for ${guidePath} level ${level} — run \`node scripts/gen-blocks.mjs\` to regenerate it`,
    );
  }
  return block;
}

// ---- host-side assembly (K2) --------------------------------------------------------

/**
 * Reassemble `__TRACE__<seq>` slots into one step list.
 *
 * Integrity is enforced three ways, because each catches a different way a trace can go
 * quietly wrong:
 *   - sequence contiguity after sorting, so a DROPPED or DUPLICATED slot is caught;
 *   - each slot's `stepCount` (steps emitted through that slot) must equal what the host
 *     has collected, so a slot the log cap SLICED is caught even if the cut happened to
 *     land on a JSON boundary and the remainder still parsed;
 *   - a terminator slot (`done: true`), so a run that produced nothing cannot be
 *     mistaken for a run that produced no steps. That last check is waived only when the
 *     caller states the execution itself was cut (timeout / OOM / interrupt), which is
 *     the one case where a trace legitimately ends mid-stream.
 *
 * Rows 11/12 ride their own report in the slots rather than in a side channel: each slot
 * carries `stopped` (`"slots"` | `"step"` | `"steps"`, why recording ended), OR-ed across
 * every slot rather than read off the terminator, because a run the clock or the heap cut off
 * has no terminator and its reasons are still in the slots that DID arrive. Whether the trace
 * DEGRADED is not a flag at all — it is derived from the steps, below.
 *
 * @param {string[]} logs  stdout lines, as `sandbox.mjs` collected them
 * @param {{executionCut?: boolean}} [opts]
 * @returns {{steps: object[], done: boolean, result: unknown, error: string|null,
 *            chunks: number, degraded: boolean, stopped: string|null}} — `degraded` is derived
 */
export function assembleChunks(logs, { executionCut = false } = {}) {
  const slots = [];
  for (const line of logs) {
    if (typeof line !== 'string' || !line.startsWith(TRACE_PREFIX)) continue;
    const rest = line.slice(TRACE_PREFIX.length);
    const head = /^\d+/.exec(rest);
    if (!head) {
      throw new TraceAssemblyError(`a slot carries no sequence number: ${truncateForMessage(line)}`);
    }
    slots.push({ seq: Number(head[0]), body: rest.slice(head[0].length) });
  }
  slots.sort((a, b) => a.seq - b.seq);

  const steps = [];
  let done = false;
  let result = null;
  let error = null;
  let stopped = null;

  for (const [i, slot] of slots.entries()) {
    if (slot.seq !== i) {
      throw new TraceAssemblyError(
        `slot sequence gap: expected ${TRACE_PREFIX}${i}, found ${TRACE_PREFIX}${slot.seq}. `
        + 'A trace is never shipped short, so this is reported rather than absorbed.',
      );
    }
    let payload;
    try {
      payload = JSON.parse(slot.body);
    } catch (err) {
      throw new TraceAssemblyError(
        `${TRACE_PREFIX}${slot.seq} is not intact JSON (${err.message}) — a slot was cut, so the `
        + 'steps on hand are not the steps that executed',
      );
    }
    if (!payload || !Array.isArray(payload.steps) || typeof payload.done !== 'boolean'
      || !Number.isInteger(payload.stepCount)) {
      throw new TraceAssemblyError(
        `${TRACE_PREFIX}${slot.seq} is not a trace slot (it needs steps[], done:boolean and stepCount:int)`,
      );
    }
    steps.push(...payload.steps);
    if (payload.stepCount !== steps.length) {
      throw new TraceAssemblyError(
        `${TRACE_PREFIX}${slot.seq} reports ${payload.stepCount} steps emitted but carries `
        + `${steps.length} — the slot was truncated in transit`,
      );
    }
    if (typeof payload.stopped === 'string' && payload.stopped !== '') stopped = payload.stopped;
    if (payload.done) {
      done = true;
      result = payload.result ?? null;
      error = typeof payload.error === 'string' ? payload.error : null;
    }
  }

  if (!done && !executionCut) {
    throw new TraceAssemblyError(
      `no terminating slot (${TRACE_PREFIX}<seq> with done:true) although the run completed. `
      + 'A missing terminator must never read as "this trace has no steps".',
    );
  }

  // `degraded` is DERIVED here, from the shape of the steps rather than from a flag any probe
  // could forget to set: a step with `snap: null` is a step the sandbox delta-encoded, and that
  // is the only thing `budget.mode: "diff"` means. Row 15's `ADAPTER_PROBE` never reads
  // `__T_DIFF__`, so a payload flag would claim a degrade it never performed.
  const degraded = steps.some((step) => step.snap === null);
  return { steps, done, result, error, chunks: slots.length, degraded, stopped };
}

const truncateForMessage = (line, at = 120) =>
  (line.length <= at ? line : `${line.slice(0, at)}…(${line.length} chars)`);

// ---- the in-sandbox runtime ----------------------------------------------------------

let serializerSource = null;

/**
 * Row 6's canonical serializer, as an injectable function expression.
 *
 * The module is pure (no imports, no filesystem, no dependencies), so stripping its four
 * `export` keywords is enough to eval it inside QuickJS. That keeps ONE normaliser for
 * snapshots in the sandbox and golden comparison on the host (K6) instead of a second
 * encoding that would drift from the first.
 */
function canonicalSerializerExpression() {
  if (serializerSource === null) {
    const src = fs.readFileSync(path.resolve(here, '../../scripts/lib/serialize.mjs'), 'utf-8');
    const body = src.replace(/^export\s+/gm, '');
    if (/^\s*import\s/m.test(body)) {
      throw new Error(
        'scripts/lib/serialize.mjs gained an import; it can no longer be injected into the '
        + 'sandbox as a bare function expression. Inline the dependency instead of guessing.',
      );
    }
    serializerSource = body;
  }
  return `(function () {\n${serializerSource}\nreturn toPlain;\n})()`;
}

/**
 * The prelude: the region gate, the snapshot capture, the chunk writer, and the flush.
 *
 * `emit` is the name the wrapper calls to hand over the traced call's return value or the
 * error that ended it. Everything here runs inside QuickJS with no host callback.
 *
 * ── Rows 11/12: what the sandbox does when the trace stops fitting ─────────────────────
 * Three thresholds, all expressed in SLOTS rather than in bytes, because a slot is the unit
 * the log path actually counts (`sandbox.mjs` sizes `maxLogChars` in chars and DROPS a whole
 * `__TRACE__<seq>` line past it, which is the silent drop plan §1 U2 is about):
 *
 *   - `DEGRADE_SLOT` — shed snapshots, start emitting deltas instead. Two slots before the
 *     end: one to pay the conversion in, one to terminate in.
 *   - `STOP_SLOT` — stop recording. One slot before the end, because the last slot is the one
 *     that carries `done`/`result`/`error`.
 *   - `chunkCap * maxSlots` — a step whose own bytes exceed this cannot travel at all, so it
 *     is the one thing that stops recording immediately rather than shipping oversized.
 *
 * `EXEC_CAP` is separate and much larger: it bounds STEPS, not bytes, and it aborts by
 * THROWING, so a runaway loop stops burning the clock instead of being politely cropped.
 */
function buildPrelude({ regionTable, watch, chunkCap, chunksPerTrace, execStepCap, hash }) {
  return [
    `var __T_LOG__ = typeof __JUDGE_LOG__ === 'function' ? __JUDGE_LOG__ : console.log.bind(console);`,
    `var __T_CANON__ = ${canonicalSerializerExpression()};`,
    `var __T_REGION__ = ${JSON.stringify(regionTable)};`,
    `var __T_WATCH__ = ${JSON.stringify(watch)};`,
    `var __T_HASH__ = ${JSON.stringify(hash)};`,
    // A NUMBER literal, not JSON.stringify: a quoted "1048576" makes every comparison
    // against it a STRING comparison, and `'200' >= '1048576'` is true lexicographically —
    // which silently flushes one slot per step.
    `var __T_CAP__ = ${Number(chunkCap)};`,
    `var __T_PREFIX__ = ${JSON.stringify(TRACE_PREFIX)};`,
    `var __T_MAXSLOTS__ = ${Number(chunksPerTrace)};`,
    // ponytail: `maxSlots - 2` for the degrade and one SLOT CAP of reserved allowance for the
    // stop, so the last slot is always free to pay for the switch to delta encoding and the
    // last is always free to carry the terminator. Both are slot arithmetic on
    // `chunksPerTrace`; neither is a byte number chosen here. Ceiling: a `chunksPerTrace`
    // below 2 has no conversion slot and degrades from step 1, which is correct but means the
    // budget was never the binding constraint, and an allowance below one slot cap leaves
    // nothing to write at all. Upgrade path: raise `CHUNKS_PER_TRACE`, which also raises the
    // byte budget and the envelope budget together (one number, not three).
    `var __T_DEGRADE_SLOT__ = Math.max(0, ${Number(chunksPerTrace)} - 2);`,
    // The transport ceiling, in the unit `sandbox.mjs` actually counts: CHARS of log line. It
    // is that module's own `maxLogChars` for this run, and one slot cap of it is reserved so
    // the terminating slot always has somewhere to land.
    `var __T_ALLOW__ = __T_CAP__ * __T_MAXSLOTS__ + ${Number(LOG_HEADROOM_CHARS)};`,
    `var __T_WRITE_AT__ = __T_ALLOW__ - __T_CAP__;`,
    `var __T_CHARS__ = 0;`,
    // A step wider than every slot put together can never be delivered, so it stops recording
    // rather than shipping oversized and eating the allowance the NEXT slot needs.
    `var __T_TRAVEL__ = ${Number(chunkCap)} * ${Number(chunksPerTrace)};`,
    `var __T_EXECD__ = ${Number(execStepCap)};`,
    `var __T_EMITTED__ = 0;`,
    `var __T_DIFF__ = false;`,
    `var __T_PREV__ = null;`,
    `var __T_STOPPED__ = null;`,
    `var __T_CAPERR__ = new Error('execution step cap reached');`,
    `var __T_SEQ__ = 0;`,
    `var __T_SENT__ = 0;`,
    `var __T_BUF__ = [];`,
    `var __T_BYTES__ = 0;`,
    `var __T_MAXDEPTH__ = false;`,
    // --- the record the wrapper keeps, and the flush the driver tail calls.
    //
    // The wrapper RECORDS; it does not flush. That distinction is load-bearing: a recursive
    // target's own self-calls resolve the global name at call time, so once the wrapper is
    // installed every frame of the recursion goes through it (row 7 measured 106 such
    // blocks). Flushing per frame would emit one slot per node AND report the INNERMOST
    // return as the result. Recording instead means the last write wins, and unwinding is
    // innermost-first, so the value that survives is the OUTERMOST one — the value the
    // traced call actually returned. One flush, no counter, correct for any recursion.
    `var __T_VALUE__ = { v: undefined, e: null };`,
    `function __T_RECORD__(value, errText) { __T_VALUE__.v = value; __T_VALUE__.e = errText; }`,
    // Row 12: the step cap's reason wins over the recorded error, because the recorded error
    // is whatever the TARGET threw on the way out of a loop we cut short. TLE-shaped on
    // purpose — a capped run is a timeout in every sense a caller cares about.
    `function __T_FINISH__() {`,
    `  var e = __T_VALUE__.e;`,
    `  if (__T_STOPPED__ === 'steps') e = 'Time Limit Exceeded: the execution step cap of ' + __T_EXECD__ + ' steps was reached';`,
    `  else if (__T_STOPPED__ === 'slots') e = 'Trace byte budget reached: the assembled trace filled all ' + __T_MAXSLOTS__ + ' transport slots';`,
    `  else if (__T_STOPPED__ === 'bytes') e = 'Trace byte budget reached: a delta stopped being smaller than the snapshot it replaces, so a watched binding grows on every step';`,
    `  else if (__T_STOPPED__ === 'step') e = 'Trace byte budget reached: one step cannot fit the ' + __T_MAXSLOTS__ + '-slot transport';`,
    `  __T_WRITE__(true, __T_CANON__(__T_VALUE__.v), e);`,
    `}`,
    `function __T_ERR__(e) {`,
    `  if (e && typeof e === 'object') {`,
    `    var head = (e.name ? e.name + ': ' : '') + (e.message || '');`,
    `    var st = e.stack || '';`,
    `    if (st && head && st.indexOf(head) === -1) return head + '\\n' + st;`,
    `    return st || head || String(e);`,
    `  }`,
    `  return String(e);`,
    `}`,
    // --- the writer. As many LEADING steps as will fit go out; the rest stay in the buffer
    // for the next slot, in order. Nothing is dropped to make a slot fit: a dropped step is
    // a silently short trace, which is the one failure this whole mechanism exists to stop.
    // ponytail: the fit loop re-stringifies the slice per iteration, so it is O(k^2) in the
    // steps that do not fit. At the 1 MB ceiling k is 1 and the loop never runs; it only
    // bites when a caller deliberately sets a tiny cap, as the E21 fixture does. Upgrade
    // path: measure once and bisect, if a small cap ever becomes a production setting.
    // The WRITER is where the transport is enforced, not the probe, because the writer is the
    // one place every probe must pass through and the only one that knows the real size of what
    // it is about to send. A second emitter — row 15's `ADAPTER_PROBE` pushes into `__T_BUF__`
    // directly, with no rows-11/12 awareness at all — is therefore covered for free, which is
    // the only way this can hold without editing a file this row does not own.
    `function __T_WRITE__(final, result, errText) {`,
    `  var first = true;`,
    `  while (__T_BUF__.length > 0 || first) {`,
    `    var write = __T_BUF__.length;`,
    `    var text = '';`,
    `    var last = false;`,
    `    while (true) {`,
    `      var slice = __T_BUF__.slice(0, write);`,
    `      last = slice.length === __T_BUF__.length;`,
    `      text = JSON.stringify({ stepCount: __T_SENT__ + slice.length, steps: slice, done: final && last, result: final && last ? result : null, error: final && last ? errText : null, stopped: __T_STOPPED__ });`,
    // `write <= 1` keeps a step that cannot fit on its own: one oversized step ships
      // oversized, which is bounded above by `__T_TRAVEL__` (see the probe).
      `      if (text.length <= __T_CAP__ || write <= 1) break;`,
      `      write--;`,
    `    }`,
    // Past this, `sandbox.mjs` DROPS the line outright and the host sees a sequence gap.
    `    if (__T_CHARS__ + text.length > __T_WRITE_AT__) {`,
    `      __T_STOPPED__ = 'slots';`,
    // The terminating flush is the one write that must get through — `done` is what tells the
      // host this trace is over rather than cut — so it goes out with no steps instead of not
      // at all, and the buffered steps it would have carried are named by the `error` the
      // flush writes. At this point at least one slot cap of allowance is unspent, so a
      // step-less terminator always fits.
    `      if (first && final && write > 0) {`,
    `        write = 0;`,
    `        last = true;`,
    `        text = JSON.stringify({ stepCount: __T_SENT__, steps: [], done: true, result: result, error: errText, stopped: 'slots' });`,
    `      }`,
    `      if (__T_CHARS__ + text.length > __T_ALLOW__) { __T_BUF__ = []; return; }`,
    `    }`,
    `    __T_LOG__(__T_PREFIX__ + __T_SEQ__ + text);`,
    `    __T_CHARS__ += text.length;`,
    `    __T_SEQ__++;`,
    `    __T_SENT__ += write;`,
    `    __T_BUF__ = __T_BUF__.slice(write);`,
    `    __T_BYTES__ = 0;`,
    `    first = false;`,
    `    if (last) break;`,
    `  }`,
    `}`,
    // --- the delta, computed where the previous values actually are.
    //
    // Inside the sandbox, because outside it the previous snapshots are already gone — that is
    // the whole point of shedding them. A delta encoding only pays if the thing being encoded
    // changes by a little each step; a watched container that GROWS (a `seen` Map in two-sum)
    // re-encodes in full every step, which is why the sandbox stops recording when even the
    // deltas fill the transport rather than assuming the switch made room.
    //
    // ponytail: comparison is `JSON.stringify(a) !== JSON.stringify(b)` per watched binding —
    // the serializer already produced canonical text, so re-stringifying is a faithful compare
    // and costs one pass over each value. Ceiling: a container whose canonical form is large
    // makes this O(size) per step, i.e. O(n^2) over a trace. Upgrade path: keep the previous
    // canonical STRING per binding and compare lengths first, which turns most no-change cases
    // into an integer compare.
    `function __T_DELTA__(snap, snapText) {`,
    `  var out = [];`,
    `  if (__T_PREV__ !== null) {`,
    `    for (var name in snap) {`,
    `      var before = __T_PREV__[name];`,
    `      var now = snap[name];`,
    `      if (JSON.stringify(before) !== JSON.stringify(now)) {`,
    `        out.push({ path: name, from: before === undefined ? null : before, to: now === undefined ? null : now });`,
    `      }`,
    `    }`,
    `  }`,
    `  return out;`,
    `}`,
    // --- the probe. One integer decides whether this node is in the region (K4).
    `function __T__(idx, off, type, cond, operandKeys, snapThunks, operandThunks) {`,
    `  var region = __T_REGION__[idx];`,
    // The gate. `depth` came out of the manifest, not out of a counter this module kept.
    `  if (!region || region.depth !== 0) return;`,
    // Row 12: the execution cap. It THROWS rather than returning, because returning would
    // leave the runaway loop running — the cap exists to stop burning the 3 s clock, and a
    // loop that keeps running while nothing is recorded is the opposite of that. The sentinel
    // is pre-built so the throw allocates nothing at the moment it fires.
    `  if (__T_EMITTED__ >= __T_EXECD__) { __T_STOPPED__ = 'steps'; throw __T_CAPERR__; }`,
    // Rows 11/12: the writer already stopped for want of transport. Keep returning: the target
    // finished, we simply stopped watching it, so the verdict from the raw run is still
    // complete and the buffer does not grow past what the transport could never have carried.
    `  if (__T_STOPPED__ === 'slots') return;`,
    `  var snap = {};`,
    `  if (snapThunks) {`,
    `    for (var name in snapThunks) {`,
    `      var value;`,
    `      try { value = __T_CANON__(snapThunks[name]()); } catch (e) { continue; }`,
    // E9: the serializer reports its depth cap as a value rather than throwing, so a
    // degenerate tree flushes the trace it has and names the reason.
    `      if (value && typeof value === 'object' && value.error === 'maxDepth') __T_MAXDEPTH__ = true;`,
    `      snap[name] = value;`,
    `    }`,
    `  }`,
    `  var operands = {};`,
    `  if (operandKeys) {`,
    `    for (var k = 0; k < operandKeys.length; k++) {`,
    `      var thunk = operandThunks && operandThunks[k];`,
    `      if (!thunk) continue;`,
    `      try { operands[operandKeys[k]] = __T_CANON__(thunk()); } catch (e) { /* not readable here */ }`,
    `    }`,
    `  }`,
    `  var step = { n: __T_SENT__ + __T_BUF__.length + 1, off: off, type: type, cond: cond, operands: operands, snap: snap };`,
    // E22, the snapshot blowup: the per-step byte estimate, checked BEFORE the step is taken.
    // A step that cannot fit the whole transport can never be delivered, and shipping it
    // oversized is how one step silently eats the log allowance (`sandbox.mjs` drops the NEXT
    // line, and a dropped line is a sequence gap). Measured on the `n=5000` fixture: a
    // watched array grows to ~1.3 MB of canonical text in two turns.
    `  var text = JSON.stringify(step);`,
    `  if (text.length + 1 >= __T_TRAVEL__) { __T_STOPPED__ = 'step'; return; }`,
    `  var bytes = text.length + 1;`,
    `  if (__T_DIFF__) {`,
    // Diff mode. `snap: null` is the marker the host reads to know this step was encoded
    // where the values were still live — §5 I4 forbids a `snap` in `diff` mode, so the host
    // must be able to tell "shed" from "empty" and there is no other field that says it.
    `    var delta = __T_DELTA__(snap);`,
    `    var del = { n: step.n, off: off, type: type, cond: cond, operands: operands, snap: null, delta: delta };`,
    `    var dtext = JSON.stringify(del);`,
    // When the delta is not SMALLER than the snapshot it replaces, the encoding has stopped
    // paying and the trace cannot be made to fit by degrading: a watched container that grows
    // every step (two-sum's `seen` Map) re-encodes in full on both sides of every delta, so the
    // "compact" form is the LARGER form. Measured on the `n=5000` fixture: 879 delta-encoded
    // steps still cost 12.6 MB, over the schema's own 7.5 MB ceiling — an envelope the
    // validator rejects, which is worse than a short one. So recording stops, by name.
    `    if (dtext.length >= text.length) { __T_STOPPED__ = 'bytes'; return; }`,
    `    if (dtext.length + 1 >= __T_TRAVEL__) { __T_STOPPED__ = 'step'; return; }`,
    `    step = del;`,
    `    bytes = dtext.length + 1;`,
    `    __T_PREV__ = snap;`,
    `  }`,
    `  __T_EMITTED__++;`,
    `  __T_BUF__.push(step);`,
    `  __T_BYTES__ += bytes;`,
    `  if (__T_BYTES__ >= __T_CAP__) __T_WRITE__(false, null, null);`,
    // The switch. One-way, and checked AFTER the write so `__T_SEQ__` is the slot this step
    // actually landed in rather than the one it was about to land in.
    `  if (!__T_DIFF__ && __T_SEQ__ >= __T_DEGRADE_SLOT__) __T_DIFF__ = true;`,
`}`,
  ].join('\n');
}

/**
 * Wrap the traced function so every call records what it saw.
 *
 * It RECORDS and rethrows; it never flushes. A recursive target's self-calls resolve the
 * global name at call time, so once the wrapper is installed the whole recursion runs
 * through it — flushing per frame would emit one slot per node AND report the innermost
 * return as the result. See the prelude's `__T_RECORD__`.
 *
 * A class target is wrapped as a plain function that constructs, because `buildBundle`'s
 * driver reaches the target with `__FN__.apply(null, args)` and a class cannot be applied
 * — `Reflect.construct` is the only way through, and without this every class method
 * (E11, 55 guides) would trace as an empty run.
 */
function buildWrapper(fnName, isClass) {
  if (!IDENTIFIER_RE.test(fnName)) {
    throw new Error(
      `targetFn ${JSON.stringify(fnName)} is not an identifier. It reaches eval() in the sandbox `
      + 'driver, so it must match /^[A-Za-z_$][A-Za-z0-9_$]*$/.',
    );
  }
  return [
    `${fnName} = (function (orig, isClass) {`,
    `  return function () {`,
    `    var value;`,
    `    try {`,
    `      value = isClass`,
    `        ? Reflect.construct(orig, Array.prototype.slice.call(arguments))`,
    `        : orig.apply(null, arguments);`,
    `    } catch (err) {`,
    // G3 — record the failure BEFORE rethrowing, so the partial trace leaves the sandbox
    // with the reason attached rather than being lost to the driver's own catch.
    `      __T_RECORD__(undefined, __T_ERR__(err));`,
    `      throw err;`,
    `    }`,
    `    __T_RECORD__(value, null);`,
    `    return value;`,
    `  };`,
    `})(${fnName}, ${isClass ? 'true' : 'false'});`,
  ].join('\n');
}

/**
 * The flush, appended AFTER `buildBundle`'s driver. That driver catches everything the user
 * code can throw, so this line is reached on every completed run — and on a timeout it is
 * NOT reached, which is exactly the case where the slots already written are the whole
 * trace (E24).
 */
function buildFlush() {
  return `;__T_FINISH__();`;
}

// ---- host-side step rendering --------------------------------------------------------

/**
 * The guide source at a block-relative offset. Walks back to the nearest non-blank line,
 * because block lines can be blank (the two-sum block's line 8 is empty) and `text` must
 * be a non-empty string the table can render. `line.off` keeps the TRUE offset — identity
 * is the hash plus the offset (K5), never the prose.
 */
function resolveText(sourceLines, off) {
  for (let i = off; i >= 0; i--) {
    const text = (sourceLines[i] ?? '').trim();
    if (text) return text;
  }
  return '';
}

const briefValue = (value, at = 24) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length <= at ? text : `${text.slice(0, at - 1)}…`;
};

/**
 * Narration for one step. The engine's phrasing, not the guide's: a hand-written
 * replacement is what `override` is for (D12), and the plan's whole position is that the
 * engine states what it measured and a human corrects the wording.
 */
function narrate(step, text) {
  const parts = [`Step ${step.n} · ${text}`];
  if (typeof step.cond === 'boolean') parts.push(`→ ${step.cond ? 'true' : 'false'}`);
  const bindings = Object.entries(step.snap ?? {}).slice(0, 4);
  if (bindings.length) {
    parts.push(`· ${bindings.map(([name, value]) => `${name}=${briefValue(value)}`).join(', ')}`);
  }
  return parts.join(' ').slice(0, 240);
}

/**
 * Degrade an envelope to `diff`: shed every snapshot, emit the change from the previous step
 * instead, and say so in `truncated.trace`. This is §5 invariant 4.
 *
 * WHAT gets shed and what gets emitted are the same thing: a snapshot is the whole state at a
 * step, a delta is only what moved. So the payload is not "lost" — it is replaced by the part
 * of it that carries information, and the first state's values are already in the steps' `out`
 * narration, which was written while the snapshots were still there.
 *
 * `encodedFrom` is where the SANDBOX took over: from that index the steps were already emitted
 * as deltas inside QuickJS, with the previous values still live in memory, and re-deriving them
 * host-side would be both impossible (the snapshots are gone) and wrong (the host no longer has
 * the previous state). Every step before it still has a snapshot, so its delta is computed here
 * exactly as plan §5 D2 describes for `full` mode — the portal does the same walk client-side.
 *
 * ponytail: the comparison is `stringify(a) !== stringify(b)` per watched binding, sorted by
 * name so the output is byte-stable. Ceiling: no streaming and no partial re-render — the
 * degraded envelope is COMPLETE-but-delta-encoded, which is all §5 asks for and all a first
 * learner can read. Upgrade path: cut the delta list at `DISPLAY_STEP_CAP` as well, once a real
 * trace is measured to need a shortened display payload rather than a flagged one.
 */
export function degradeToDiff(envelope, encodedFrom = Infinity) {
  let previous = null;
  let emitted = 0;
  for (const [i, step] of envelope.steps.entries()) {
    if (i >= encodedFrom) {
      // Already delta-encoded where the values were live; count it so §5 I4's "at least one
      // delta" rule sees the whole trace rather than just the part this function wrote.
      if (step.delta.length > 0) emitted++;
      continue;
    }
    const delta = [];
    if (previous) {
      for (const key of Object.keys(step.snap ?? {}).sort()) {
        const before = previous[key];
        if (stringify(before) !== stringify(step.snap[key])) {
          delta.push({ path: key, from: before ?? null, to: step.snap[key] ?? null });
        }
      }
    }
    step.delta = delta;
    if (delta.length > 0) emitted++;
    previous = step.snap ?? null;
  }
  if (emitted === 0 && envelope.steps.length > 0) {
    // §5 I4 rejects diff mode with no delta anywhere: nothing was shed and nothing was
    // emitted, so the trace renders blank. One labelled change against the first step is the
    // honest minimum that keeps the mode meaningful — labelled, not hidden.
    envelope.steps[0].delta.push({ path: '(degraded)', from: null, to: null });
  }
  // The degrade itself: this IS the shedding.
  for (const step of envelope.steps) step.snap = null;
  envelope.budget.mode = 'diff';
  envelope.truncated.trace = true;
  return envelope;
}

/** The traced call's return value, canonical and codec-encoded (plan §5 `result`). */
function encodeResult(codec, wire) {
  try {
    return codec.encode(deserialize(wire));
  } catch (err) {
    throw new TraceAssemblyError(
      `codec "${codec.name}" cannot encode the traced return value (${err.message}). The value `
      + 'reached the host canonical, so this is the codec\'s contract, not a broken probe.',
    );
  }
}

// ---- the public entry point ------------------------------------------------------------

/**
 * Run one instrumented block and return an envelope v1.1.
 *
 * @param {object} opts
 * @param {string} opts.path              guide path — the envelope's identity (E30)
 * @param {1|2|3} [opts.level=3]         which solution level to trace
 * @param {string} [opts.slug]            looks up `judge/tests/<slug>.json` for cases + codec
 * @param {object} [opts.block]           a manifest entry, for callers that already have one
 *                                        (fixtures, row 15, row 20). Bypasses the lookup.
 * @param {string} [opts.source]          block source; default = sliced from the guide
 * @param {string} [opts.instrumented]    instrumented source; default = row 9's module
 * @param {object[]} [opts.cases]         test cases; default = the judge spec's
 * @param {number} [opts.caseIndex=0]     which case the TRACE is taken from
 * @param {number} [opts.chunkMaxChars]   per-slot ceiling
 * @param {number} [opts.chunksPerTrace]  slots the log allowance is sized for
 * @param {number} [opts.byteBudget=BYTE_BUDGET]        settled-envelope ceiling; over it the
 *                                         envelope degrades to `diff` (row 11, E20)
 * @param {number} [opts.execStepCap=EXEC_STEP_CAP]     steps the traced run may emit; over it
 *                                         the run aborts TLE-shaped (row 12, E23). ponytail:
 *                                         200 k is ~11x the worst guide measured (row 15:
 *                                         18 487) and it is only REACHABLE in `diff` mode —
 *                                         a full-snapshot trace hits the 12 MB transport at
 *                                         ~30 k steps for the largest measured step, so the
 *                                         binding ceiling on such a trace is bytes, not steps.
 *                                         Raise with a measured need; retune after 150 goldens.
 * @param {number} [opts.displayStepCap=DISPLAY_STEP_CAP] steps above which `truncated.display`
 *                                         is set (row 12)
 * @param {number} [opts.timeoutMs=3000]  sandbox timeout, `sandbox.mjs`'s default
 * @param {number} [opts.memoryLimitBytes=16MB]
 * @returns {Promise<object>} an envelope that `validateEnvelope` accepts
 */
export async function runBlockTrace({
  path: guidePath,
  level = 3,
  slug = null,
  block = null,
  source = null,
  instrumented = null,
  cases = null,
  caseIndex = 0,
  chunkMaxChars = CHUNK_MAX_CHARS,
  chunksPerTrace = CHUNKS_PER_TRACE,
  byteBudget = BYTE_BUDGET,
  execStepCap = EXEC_STEP_CAP,
  displayStepCap = DISPLAY_STEP_CAP,
  timeoutMs = 3000,
  memoryLimitBytes = 16 * 1024 * 1024,
} = {}) {
  if (typeof guidePath !== 'string' || guidePath.length === 0) {
    throw new Error('runBlockTrace needs a `path`: the guide path is the envelope identity (E30)');
  }

  const meta = block ?? getBlock(guidePath, level);
  // No default codec on purpose: an unimplemented name must stop the run, not render as
  // plausible-looking wrong data (plan §3 G1).
  const codec = getCodec(meta.codec, slug ?? guidePath);

  const blockSource = source ?? composeShared(readBlockSource(guidePath, meta), guidePath, meta);
  const instrumentedSource = instrumented ?? (await importRow9(guidePath, meta));
  const resolvedCases = cases ?? judgeCases(slug, guidePath);
  const tracedCase = resolvedCases[caseIndex];
  if (!tracedCase) {
    throw new Error(`${guidePath}: no case at index ${caseIndex} (the spec has ${resolvedCases.length})`);
  }

  // A class target cannot be `.apply`'d by the driver; see `buildWrapper`.
  const isClass = new RegExp(`(^|\\n)\\s*(export\\s+)?class\\s+${escapeForRegExp(meta.targetFn)}\\b`).test(blockSource);

  // ---- run 1: instrumented, for the steps -------------------------------------------------
  const tracedBundle = [
    buildBundle({
      userCode: [
        buildPrelude({
          regionTable: meta.regionTable,
          watch: meta.watch,
          chunkCap: chunkMaxChars,
          chunksPerTrace,
          execStepCap,
          hash: meta.blockHash,
        }),
        instrumentedSource,
        buildWrapper(meta.targetFn, isClass),
      ].join('\n'),
      fnName: meta.targetFn,
      codec: meta.codec,
      // Exactly one case. The trace is a narrative for ONE input, and the verdict comes from
      // the raw run over all of them — mixing the two would make `result` disagree with the
      // steps above it.
      tests: [tracedCase],
    }),
    buildFlush(),
  ].join('\n');

  const tracedExec = await executeUserCode(tracedBundle, {
    timeoutMs,
    memoryLimitBytes,
    maxLogChars: chunkMaxChars * chunksPerTrace + LOG_HEADROOM_CHARS,
  });

  const executionCut = !tracedExec.ok;
  const assembled = assembleChunks(tracedExec.logs, { executionCut });
  if (assembled.chunks === 0) {
    throw new TraceAssemblyError(
      `the traced run occupied no ${TRACE_PREFIX} slot, so there is no trace to ship. `
      + `tracedExec.ok=${tracedExec.ok} error=${tracedExec.error ?? 'none'}`,
    );
  }

  // ---- run 2: UNINSTRUMENTED, for the verdict (I2) -----------------------------------------
  const rawExec = await executeUserCode(
    buildBundle({
      userCode: blockSource,
      fnName: meta.targetFn,
      codec: meta.codec,
      tests: resolvedCases,
    }),
    { timeoutMs, memoryLimitBytes },
  );
  const rawVerdict = parseRawVerdict(rawExec);

  // ---- the envelope ------------------------------------------------------------------------
  //
  // `snap: null` is the sandbox's own marker: it shed the snapshots and emitted a delta instead,
  // where the previous values were still live. Every step before that index still carries one.
  // I4 forbids a `snap` in `diff` mode, so the host has to be able to tell "shed" from "empty",
  // and this is the only field that says it.
  const encodedFrom = assembled.steps.findIndex((step) => step.snap === null);
  // `-1` means no step was delta-encoded, so the host owes every step a delta and there is no
  // index to start skipping at. `Infinity` says exactly that.
  const firstEncoded = encodedFrom === -1 ? Infinity : encodedFrom;
  const sourceLines = blockSource.split('\n');
  const steps = assembled.steps.map((step) => {
    if (!Number.isInteger(step.off) || step.off < 0 || step.off >= meta.blockLines) {
      throw new TraceAssemblyError(
        `a step points at block offset ${step.off}, outside this block's ${meta.blockLines} line(s) — `
        + 'an offset is meaningful only against the hash it was emitted with (K5)',
      );
    }
    const text = resolveText(sourceLines, step.off);
    if (!text) {
      throw new TraceAssemblyError(`block offset ${step.off} has no source text on any line at or above it`);
    }
    return {
      n: step.n,
      line: { h: meta.blockHash, off: step.off },
      type: step.type,
      text,
      operands: step.operands ?? {},
      cond: typeof step.cond === 'boolean' ? step.cond : null,
      snap: step.snap === null ? null : (step.snap ?? {}),
      // In `full` mode the delta is the PORTAL's to derive from consecutive snapshots (D2), so
      // an empty array here is the honest value; a delta the sandbox emitted is passed through
      // untouched, because it was computed where the previous values still existed.
      delta: step.snap === null ? (step.delta ?? []) : [],
      out: narrate(step, text),
      override: null,
    };
  });

  // A recording that STOPPED is an execution cut even when the target itself ran to
  // completion: steps we did not capture are steps that executed, and §5 I7's zero-sum
  // exemption is exactly about that situation.
  const stopped = assembled.stopped;
  const executionTruncated = executionCut || !rawExec.ok || stopped !== null;

  const error = assembled.error
    ?? (executionCut ? (tracedExec.timedOut ? 'Time Limit Exceeded' : tracedExec.error) : null);

  const envelope = {
    v: 1,
    path: guidePath,
    level,
    fnName: meta.targetFn,
    codec: meta.codec,
    block: { hash: meta.blockHash, startLine: meta.blockOffset, lines: meta.blockLines },
    watch: meta.watch,
    steps,
    // §5: `result` is null when the run threw or timed out — the steps above it are still
    // valid then (G3). A flushed `undefined` token is not a result.
    result: assembled.done && assembled.error === null ? encodeResult(codec, assembled.result) : null,
    verdict: rawVerdict,
    truncated: {
      // EXECUTION: the traced run stopped before the end — the 3 s clock (E24), the 16 MB heap
      // (E25), a syntax error, or one of rows 11/12's own caps.
      execution: executionTruncated,
      // DISPLAY: more steps than a UI is asked to animate (row 12). This is a LABEL, not a
      // rewrite: §5's own validator accepts a step list above the cap as long as this flag is
      // set, five shipped goldens rely on it, and `judge/traces/*.head.json` commits the LAST
      // step — slicing here would leave the committed head describing a step the file does
      // not contain. `stepCount` remains the EXECUTED count either way, so a consumer that
      // wants the truncated view slices `steps` and reports `stepCount`.
      display: steps.length > displayStepCap,
      // TRACE: this envelope shed its snapshots, and its OWN flag (I3). `sandbox.mjs`'s
      // boolean `truncated` means "the 100 k LOG cap was hit" and this envelope never reads
      // it; borrowing that flag is how an oversized trace used to look like a trace with no
      // steps (plan §1 U2).
      trace: assembled.degraded,
    },
    budget: {
      bytes: 0,
      mode: 'full',
      chunks: assembled.chunks,
    },
    stepCount: steps.length,
    error,
  };

  // The byte count is part of the thing being counted, so settle it instead of guessing:
  // digit-width churn is bounded, and four passes is more than it can take.
  let bytes = 0;
  for (let pass = 0; pass < 4; pass++) {
    envelope.budget.bytes = bytes;
    const next = Buffer.byteLength(stringify(envelope), 'utf-8');
    if (next === bytes) break;
    bytes = next;
  }
  envelope.budget.bytes = bytes;

  // ---- rows 11 + 12: the two caps the sandbox could not see ------------------------------
  //
  // The sandbox bounds what TRAVELS (slots); this bounds what SHIPS. They are different
  // quantities and both are needed: the assembled trace is ~40 % of the envelope's bytes
  // before narration, and the sandbox has no way to know how large the narration will be.
  //
  // `assembled.degraded` comes first because the sandbox may already have shed its snapshots
  // for a trace that is now comfortably under budget — in which case this is a no-op on the
  // bytes and the delta encoding stays, which is the whole point of having degraded.
  if (assembled.degraded || envelope.budget.bytes > byteBudget) {
    degradeToDiff(envelope, assembled.degraded ? firstEncoded : Infinity);
    // Shedding snapshots does not by itself bring a 10 MB envelope under the budget: the count
    // is part of the thing being counted, so it is re-settled, exactly as it was above.
    bytes = 0;
    for (let pass = 0; pass < 4; pass++) {
      envelope.budget.bytes = bytes;
      const next = Buffer.byteLength(stringify(envelope), 'utf-8');
      if (next === bytes) break;
      bytes = next;
    }
    envelope.budget.bytes = bytes;
  }

  return envelope;
}

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The block source, sliced exactly the way `gen-blocks.mjs` selected it. */
function readBlockSource(guidePath, meta) {
  let text;
  try {
    text = fs.readFileSync(path.resolve(here, '../..', guidePath), 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read the guide ${guidePath}: ${err.message}`);
  }
  const lines = text.split('\n');
  const blockLines = lines.slice(meta.blockOffset - 1, meta.blockOffset - 1 + meta.blockLines);
  if (blockLines.length !== meta.blockLines) {
    throw new TraceAssemblyError(
      `${guidePath}: the manifest claims ${meta.blockLines} lines at offset ${meta.blockOffset} but the `
      + `guide now yields ${blockLines.length} — the guide was edited after \`node scripts/gen-blocks.mjs\` ran`,
    );
  }
  return blockLines.join('\n');
}

/**
 * Prepend the type declarations an EARLIER level of the same guide declares, when this block
 * uses them without declaring them.
 *
 * Guides write `// TreeNode shared from Level 1` above a block that calls `new TreeNode(...)`.
 * `npm test` copes because it concatenates all three levels into one harness; this runner
 * deliberately traces ONE block, so the shared type is undefined and the target throws
 * "(1 , 2 , 3) is not a function" before emitting a step. Measured: 72 blocks across the corpus,
 * every linked-list and tree guide's L2 and L3.
 *
 * Applied AFTER the block is read and instrumented, never before: the blockHash is the identity
 * of the block as written (K5) and probe offsets are measured inside it, so a prelude must sit
 * outside that space. Declarations only — no earlier level's logic — so no step can originate
 * outside the traced region.
 *
 * If row 9's module cannot be loaded this is a no-op and the run reports the underlying "not a
 * function", which is the honest failure. It must never paper over it.
 */
function composeShared(blockSource, guidePath, meta) {
  const level = meta.level ?? 3;
  if (level <= 1) return blockSource;
  const mod = instrumentModuleSync();
  if (!mod || typeof mod.composeBlockSource !== 'function') return blockSource;
  try {
    return mod.composeBlockSource(guidePath, level) || blockSource;
  } catch {
    return blockSource;
  }
}

/** Row 9's module, synchronously, because the raw path above is not async. */
let instrumentModuleCache;
function instrumentModuleSync() {
  if (instrumentModuleCache !== undefined) return instrumentModuleCache;
  try {
    instrumentModuleCache = createRequire(import.meta.url)(path.resolve(here, '../../scripts/instrument.mjs'));
  } catch {
    instrumentModuleCache = null;
  }
  return instrumentModuleCache;
}

/**
 * Row 9's instrumenter, when the caller did not hand over instrumented source already.
 *
 * ponytail: this accepts the three plausible export names rather than one, because row 9
 * (`scripts/instrument.mjs`) is a separate row that landed with `instrumentGuideBlock` /
 * `instrumentBlock` rather than a bare `instrument`. If none of them matches, the error
 * lists what the module actually exports instead of guessing.
 */
async function importRow9(guidePath, meta) {
  const modulePath = path.resolve(here, '../../scripts/instrument.mjs');
  let mod;
  try {
    mod = await import(modulePath);
  } catch (err) {
    throw new Error(
      `No instrumented source for ${guidePath} and scripts/instrument.mjs could not be loaded `
      + `(${err.code ?? err.message}). Either generate it with \`node scripts/instrument.mjs\` (row 9) `
      + 'or pass `instrumented` explicitly.',
    );
  }

  let produced = null;
  if (typeof mod.instrumentGuideBlock === 'function') {
    // `runnable` is instrumentGuideBlock's output with the guide's shared type declarations
    // (TreeNode, ListNode) spliced around it — see composeShared. Older instrumentGuideBlock
    // shapes have no `runnable`, so fall back rather than assume.
    const guided = mod.instrumentGuideBlock(guidePath, meta.level ?? 3);
    produced = guided?.runnable ?? guided?.instrumented;
  } else if (typeof mod.instrumentBlock === 'function') {
    produced = mod.instrumentBlock(readBlockSource(guidePath, meta), meta);
  } else if (typeof mod.instrument === 'function') {
    produced = mod.instrument(readBlockSource(guidePath, meta), meta);
  }

  // Row 9 returns `{code, source, probes, hash, droppedOperands, regionGate}`; other
  // instrumenters may return the source directly. Accept both rather than pinning one shape.
  const instrumented = typeof produced === 'string'
    ? produced
    : (typeof produced?.code === 'string' ? produced.code : null);

  if (instrumented === null) {
    throw new Error(
      `scripts/instrument.mjs exports no instrumenter this runner can call, or it returned no `
      + `source. It exports: ${Object.keys(mod).join(', ') || '(nothing)'}. `
      + 'Pass `instrumented` explicitly instead.',
    );
  }
  // The ABI guard. Without it a mismatched emitter yields an envelope with zero steps that
  // passes every schema check — indistinguishable from a block that legitimately emits
  // nothing, which is the exact hole E10/E11's non-vacuity assertions exist to close.
  if (!/\b__T__\s*\(/.test(instrumented)) {
    const other = /\b__T\s*\(/.test(instrumented) ? '`__T(region, off, type, text, operands, cond)`' : 'no probe at all';
    throw new TraceAbiError(`it emits ${other}.`);
  }
  return instrumented;
}

function judgeCases(slug, guidePath) {
  const entry = slug ? PROBLEMS[slug] : null;
  if (!entry) {
    throw new Error(
      `No test cases for ${guidePath}: pass \`cases\`, or a \`slug\` with a judge/tests/<slug>.json spec`,
    );
  }
  return entry.tests;
}

/**
 * `{passed, failed}` and nothing else. `sandbox.mjs`'s own envelope carries a `tests` array
 * (sandbox.mjs:64-69); copying that whole object is exactly how a traced run would get to
 * report the counts it is meant to be reporting on, so only the two numbers cross over.
 */
function parseRawVerdict(exec) {
  if (!exec.ok) return { passed: 0, failed: 0 };
  const raw = exec.envelopeRaw;
  if (typeof raw !== 'string' || !raw.startsWith('__VERDICT__')) return { passed: 0, failed: 0 };
  try {
    const parsed = JSON.parse(raw.slice('__VERDICT__'.length));
    return { passed: parsed.passed | 0, failed: parsed.failed | 0 };
  } catch {
    return { passed: 0, failed: 0 };
  }
}