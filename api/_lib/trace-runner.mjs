/**
 * `api/_lib/trace-runner.mjs` — run an instrumented solution block and produce an
 * envelope v1.1. Plan v5 §7 row 10, §3 K2/K4/G3, §5, §6 ledger.
 *
 * Four responsibilities live here, and nothing else:
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

const here = path.dirname(fileURLToPath(import.meta.url));

/** The regenerable manifest row 7 writes. Gitignored on purpose — see the header. */
export const BLOCKS_PATH = path.resolve(here, '../../build/blocks.json');

/** The trace slot prefix. Distinct from `sandbox.mjs`'s `ENVELOPE_PREFIX` on purpose. */
export const TRACE_PREFIX = '__TRACE__';

/**
 * Per-slot ceiling. `api/_lib/sandbox.mjs:11` measures the envelope slot at 1 MB, and
 * `sandbox.mjs:117-123` shows what happens past it: the payload is DROPPED and the log
 * cap's `truncated` flag is reused. That silent drop is why an oversized trace used to
 * surface as a plausible trace with no steps — silent-wrong, the worst failure mode in
 * this engine — and why the ceiling is derived from a measured constant rather than a wish.
 */
export const CHUNK_MAX_CHARS = 1024 * 1024;

/**
 * Slots one trace may occupy before the log allowance runs out. Matches the plan's
 * `caps.chunksPerTrace`; row 11 re-derives the byte budget from both.
 */
export const CHUNKS_PER_TRACE = 12;

// ponytail: sandbox.mjs has exactly ONE special slot and it is `__VERDICT__`. A `__TRACE__`
// line therefore travels the LOG path, so `maxLogChars` — not ENVELOPE_MAX_CHARS — is what
// bounds a chunk in practice. 12 slots plus the sandbox's own 100 k log allowance. Upgrade
// path: row 11 sets this from the assembled byte budget once a real 3 000-problem median
// step size exists; until then a runaway trace is caught by the assembly integrity check
// (a sliced slot fails to parse or disagrees with its own step count), not by this number.
const LOG_HEADROOM_CHARS = 100_000;

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
 * @param {string[]} logs  stdout lines, as `sandbox.mjs` collected them
 * @param {{executionCut?: boolean}} [opts]
 * @returns {{steps: object[], done: boolean, result: unknown, error: string|null, chunks: number}}
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

  return { steps, done, result, error, chunks: slots.length };
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
 * The prelude: the region gate, the snapshot capture, the chunk writer and the flush.
 *
 * `emit` is the name the wrapper calls to hand over the traced call's return value or the
 * error that ended it. Everything here runs inside QuickJS with no host callback.
 */
function buildPrelude({ regionTable, watch, chunkCap, hash }) {
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
    `function __T_FINISH__() {`,
    `  __T_WRITE__(true, __T_CANON__(__T_VALUE__.v), __T_VALUE__.e);`,
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
    `function __T_WRITE__(final, result, errText) {`,
    `  var first = true;`,
    `  while (__T_BUF__.length > 0 || first) {`,
    `    var write = __T_BUF__.length;`,
    `    var text = '';`,
    `    var last = false;`,
    `    while (true) {`,
    `      var slice = __T_BUF__.slice(0, write);`,
    `      last = slice.length === __T_BUF__.length;`,
    `      text = JSON.stringify({ stepCount: __T_SENT__ + slice.length, steps: slice, done: final && last, result: final && last ? result : null, error: final && last ? errText : null });`,
    // `write <= 1` keeps a step that cannot fit on its own: one oversized step ships
      // oversized, which row 11 degrades (E20/E22). Splitting a step needs a step format.
    `      if (text.length <= __T_CAP__ || write <= 1) break;`,
    `      write--;`,
    `    }`,
    `    __T_LOG__(__T_PREFIX__ + __T_SEQ__ + text);`,
    `    __T_SEQ__++;`,
    `    __T_SENT__ += write;`,
    `    __T_BUF__ = __T_BUF__.slice(write);`,
    `    __T_BYTES__ = 0;`,
    `    first = false;`,
    `    if (last) break;`,
    `  }`,
    `}`,
    // --- the probe. One integer decides whether this node is in the region (K4).
    `function __T__(idx, off, type, cond, operandKeys, snapThunks, operandThunks) {`,
    `  var region = __T_REGION__[idx];`,
    // The gate. `depth` came out of the manifest, not out of a counter this module kept.
    `  if (!region || region.depth !== 0) return;`,
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
    `  __T_BUF__.push(step);`,
    `  __T_BYTES__ += JSON.stringify(step).length + 1;`,
    `  if (__T_BYTES__ >= __T_CAP__) __T_WRITE__(false, null, null);`,
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
        buildPrelude({ regionTable: meta.regionTable, watch: meta.watch, chunkCap: chunkMaxChars, hash: meta.blockHash }),
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
      snap: step.snap ?? {},
      // Row 11 owns the client/server delta split; in `full` mode the portal derives the
      // delta from consecutive snapshots, so an empty array here is the honest value.
      delta: [],
      out: narrate(step, text),
      override: null,
    };
  });

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
      // The traced run stopped early: timeout (E24), heap (E25), or a syntax error.
      execution: executionCut || !rawExec.ok,
      // Row 12's cap. Never set here — borrowing it would be the I3 defect in miniature.
      display: false,
      // Row 11's degrade-to-`diff` flag, and its OWN flag (I3): `sandbox.mjs`'s boolean
      // `truncated` means "the 100 k log cap was hit" and this envelope never reads it.
      trace: false,
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