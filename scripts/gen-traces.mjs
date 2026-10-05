#!/usr/bin/env node
/**
 * `scripts/gen-traces.mjs` — generate the golden corpus from the engine that landed in rows
 * 6, 7, 9, 10 and 17. Plan v5 §7 row 15, §3 D10/K4/K5/K6/G1, §5, §6 E19/E26/E28,
 * §7 F5/F6, §8 invariant 2.
 *
 * Everything today is unit-tested. This is the row that makes the claim falsifiable: a golden
 * is an end-to-end assertion that a guide's canonical solution produces the DOCUMENTED trace.
 *
 * ── THE ADAPTER: why this file contains a probe ────────────────────────────────────────
 * Rows 9 and 10 do not compose, and neither may be edited from here. Row 9
 * (`scripts/instrument.mjs`) emits
 *
 *     __T(region, off, type, text, operandsThunk, snapThunk, cond)
 *
 * and ships its own `vm`-based runtime; row 10 (`api/_lib/trace-runner.mjs`) provides a probe
 * named `__T__` with a DIFFERENT argument order, inside a QuickJS sandbox, reading steps out
 * of a buffer it chunks itself. Row 10's own `importRow9` guard proves the drift — it raises
 * `TraceAbiError: it emits __T(region, off, type, text, operands, cond)`.
 *
 * So this generator keeps the half that is right on each side and bridges them:
 *
 *   - row 9's PLACEMENT — which node gets a probe, at which block-relative offset, with which
 *     type, text, operand leaves, snapshot bindings, and the region INTEGER baked per probe
 *     from `build/blocks.json`'s `regionTable`. That is the hard part, and it is reused whole.
 *   - row 10's TRANSPORT — canonical normalisation (`__T_CANON__`), the 1 MB slot budget, the
 *     chunked `__TRACE__<seq>` writer, host-side assembly, the throw-safe flush, the codec
 *     `result` encode, and the separate UNINSTRUMENTED verdict run.
 *
 * `ADAPTER_PROBE` below is the whole bridge: row 9's probe call sites are untouched, and this
 * function is what they resolve to inside row 10's sandbox. It is ~12 lines and it contains no
 * placement logic of its own — a second instrumenter here would violate plan §3 D4 (one
 * instrumentation path) and drift from row 9 silently, which is the exact failure this engine
 * exists to stop.
 *
 * ── GRANULARITY ─────────────────────────────────────────────────────────────────────────
 * All three levels, for all 150 guides. Owner decision 2 asks for "all three for Tier 1,
 * canonical level only for Tier 2", and a golden is only worth generating at a level the UI
 * will animate — L1 brute force and L2 optimized are both animated Tier 1 presets, so a
 * canonical-only corpus would leave two thirds of the product untested. 150 guides x 3 levels
 * = 450 envelopes. §10 counts "150/150 goldens"; this satisfies it at 3x and the per-problem
 * `eventFloor` is still pinned to the canonical level alone, because that is the one level
 * every scale track animates (F5).
 *
 * ── CASES ───────────────────────────────────────────────────────────────────────────────
 * Nothing here invents a case. Plan §8 invariant 2 says every artifact derives from
 * `catalog/problems.json`, and a golden whose `expected` came from the code under test would
 * be tautological — it could never disagree with the solution, which is the whole point lost.
 * So cases are resolved, in order, from:
 *
 *   1. `judge/tests/<slug>.json`   — authored `{name, args, expected}` triples (5 pilot specs)
 *   2. `RUNTIME_TESTS[path].cases` — authored `{args, expect}` triples in `test-runner.mjs`
 *   3. `catalog/cases.json[path]`  — an authored `assertEq` SCRIPT, harvested (see `harvestCases`)
 *
 * Form 3 needs harvesting because `buildBundle`'s driver wants `{args, expected}` and an
 * `assertEq` script states them as source. The harvest RUNS the guide's own script, so the
 * input is the one a human wrote next to the dry-run table, not one this file composed.
 *
 * A guide with no case source anywhere is REPORTED with its path and the reason, and gets no
 * golden. It never gets a stub: a golden that cannot fail is worse than a missing one.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBlockTrace, loadBlocks, getBlock, BLOCKS_PATH } from '../api/_lib/trace-runner.mjs';
import { executeUserCode } from '../api/_lib/sandbox.mjs';
import { getCodec, driverCodecSource, IMPLEMENTED_CODECS } from '../api/_lib/codecs.mjs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import { instrumentGuideBlock } from './instrument.mjs';
import { validateEnvelope } from './validate-envelope.mjs';
import { stringify } from './lib/serialize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Where the corpus lands. Flat filenames: `judge/traces/*.json` is gitignored, and a
 *  per-module SUBDIRECTORY would fall outside that pattern and commit ~300 MB (E32). */
export const TRACES_DIR = path.join(ROOT, 'judge', 'traces');

const CATALOG_FILE = path.join(ROOT, 'catalog', 'problems.json');
const CASES_FILE = path.join(ROOT, 'catalog', 'cases.json');
const RUNTIME_TESTS_FILE = path.join(ROOT, 'scripts', 'test-runner.mjs');
const JUDGE_TESTS_DIR = path.join(ROOT, 'judge', 'tests');

const LEVELS = [1, 2, 3];

/** UI-only, from `validate-envelope.mjs`. A golden above it must say so, or it fails I-Display. */
const DISPLAY_STEP_CAP = 2000;
/** 60% of 12 x the measured 1 MB slot (`validate-envelope.mjs`'s own constant). */
const BYTE_BUDGET = Math.floor(1024 * 1024 * 12 * 0.6);
/**
 * Generation gets a wider sandbox budget than the judge route does.
 *
 * `sandbox.mjs` defaults to 3 s, which is right for a learner waiting on one answer. It is
 * too tight for BATCH generation on a loaded machine: `09-binary-tree-general/
 * 07-flatten-binary-tree` L1 builds its tree recursively and passed three consecutive
 * standalone runs at ~9 s total, then hit `Time Limit Exceeded` part-way through a full
 * `npm run verify` chain. A gate that flakes on machine load is worse than no gate, so the
 * generator widens only its OWN budget and leaves the judge route's 3 s untouched.
 *
 * ponytail: 3x the interactive default, because the whole corpus runs in one process here.
 * Raise it if a guide legitimately needs more, not because CI was slow once.
 */
const GEN_TIMEOUT_MS = 9000;

// ---------------------------------------------------------------------------
// THE PROBE ADAPTER
// ---------------------------------------------------------------------------

/**
 * Row 9's probe call sites resolve to this inside row 10's sandbox.
 *
 * Argument order is row 9's. The gate is row 9's, unchanged — ONE integer, compared once
 * (K4); there is no depth counter and no call stack, which is why a recursive target's own
 * body is depth 0 in the manifest and therefore emits.
 *
 * `ponytail:` row 9 hands over a snapshot thunk that returns LIVE values and an operand thunk
 * that has already been evaluated lazily. Both are canonicalised here through row 10's own
 * `__T_CANON__` rather than being re-encoded here: a second normaliser is a second chance to
 * disagree with row 6, and plain `JSON.stringify` cannot express `undefined`, `NaN`, `-0`,
 * `BigInt`, `Map`/`Set`, a typed array or a cycle (E1-E7) — it throws on the last one, which
 * would kill the run from inside the probe. Ceiling: one `__T_CANON__` call per watched
 * binding per step, so a step costs `watch.length` normalisations. Upgrade path: capture the
 * tokens directly in the instrumented thunk, which needs row 9 to change.
 */
export const ADAPTER_PROBE = `
function __T(region, off, type, text, operandsThunk, snapThunk, cond) {
  if (region !== 0) return;
  var snap = {};
  if (snapThunk) {
    try {
      var raw = snapThunk();
      if (raw && typeof raw === 'object') {
        for (var k in raw) { try { snap[k] = __T_CANON__(raw[k]); } catch (e) {} }
      }
    } catch (e) {}
  }
  var operands = {};
  if (operandsThunk) {
    try {
      var ops = operandsThunk();
      if (ops && typeof ops === 'object') {
        for (var j in ops) { try { operands[j] = __T_CANON__(ops[j]); } catch (e) {} }
      }
    } catch (e) {}
  }
  var step = { n: __T_SENT__ + __T_BUF__.length + 1, off: off, type: type, cond: cond === undefined ? null : cond, operands: operands, snap: snap };
  __T_BUF__.push(step);
  __T_BYTES__ += JSON.stringify(step).length + 1;
  if (__T_BYTES__ >= __T_CAP__) __T_WRITE__(false, null, null);
}
`;

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

export function loadCatalog() {
  let raw;
  try {
    raw = fs.readFileSync(CATALOG_FILE, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read the catalog at ${CATALOG_FILE}: ${err.message}. Row 1 owns that file.`);
  }
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.problems;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`${CATALOG_FILE} carries no problems array`);
  }
  return list;
}

/** Keyed by PATH, never slug (plan §8 invariant 1, E30). */
export function loadProblemIndex() {
  const index = new Map();
  for (const entry of loadCatalog()) index.set(entry.path, entry);
  return index;
}

/**
 * Places where `catalog/problems.json` disagrees with the block manifest, REPORTED rather than
 * corrected: row 15 may not edit the catalog, and a silently-preferred source is how a registry
 * ends up with two truths.
 *
 * Plan §7 row 2 already settled which side wins for fn names — "fn names resolve from
 * `blocks.json`" — so a null in the catalog is a catalog defect, not a block defect. Measured
 * one: `02-two-pointers/02-is-subsequence.md` carries `fnName.L3: null` while the manifest's
 * L3 target is the class `SubsequenceMatcher`, which also makes its `canonicalTargetIsClass`
 * flag wrong. The generator uses the manifest and records the drift in the report.
 */
export function catalogDrifts(catalog = loadCatalog()) {
  const drifts = [];
  const blocks = loadBlocks();
  for (const entry of catalog) {
    const rows = blocks.filter((b) => b.path === entry.path);
    for (const row of rows) {
      const key = `fnName.L${row.level}`;
      if (!entry.fnName?.[`L${row.level}`]) {
        drifts.push({
          path: entry.path,
          level: row.level,
          kind: 'CATALOG_FN_NAME_NULL',
          detail: `catalog \`${key}\` is ${JSON.stringify(entry.fnName?.[`L${row.level}`])} but the manifest's target is \`${row.targetFn}\``,
        });
      } else if (entry.fnName[`L${row.level}`] !== row.targetFn) {
        drifts.push({
          path: entry.path,
          level: row.level,
          kind: 'CATALOG_FN_NAME_DRIFT',
          detail: `catalog \`${key}\` is \`${entry.fnName[`L${row.level}`]}\`, the manifest's target is \`${row.targetFn}\``,
        });
      }
    }
    const l3 = rows.find((b) => b.level === 3);
    if (l3) {
      let isClass = false;
      try {
        const lines = fs.readFileSync(path.join(ROOT, entry.path), 'utf-8').split('\n');
        const source = lines.slice(l3.blockOffset - 1, l3.blockOffset - 1 + l3.blockLines).join('\n');
        isClass = new RegExp(`(^|\\n)\\s*(export\\s+)?class\\s+${l3.targetFn}\\b`).test(source);
      } catch { /* the guide is unreadable; row 10 will say so with better words */ }
      if (isClass !== Boolean(entry.canonicalTargetIsClass)) {
        drifts.push({
          path: entry.path,
          level: 3,
          kind: 'CATALOG_CLASS_FLAG_DRIFT',
          detail: `catalog \`canonicalTargetIsClass\` is ${Boolean(entry.canonicalTargetIsClass)} but L3's target \`${l3.targetFn}\` ${isClass ? 'IS' : 'is not'} a class declaration`,
        });
      }
    }
  }
  return drifts;
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

/**
 * `RUNTIME_TESTS` out of `scripts/test-runner.mjs`.
 *
 * It is a module-level `const` in a script that EXECUTES the whole suite on import, so it
 * cannot be imported — importing it would run 828 assertions as a side effect of generating
 * traces. Instead the object literal is sliced out by brace matching and read with `Function`.
 *
 * `ponytail:` a text slice rather than an AST walk, because the literal is plain data (strings,
 * arrays, template literals) and no guide can inject a brace into it. Ceiling: a `RUNTIME_TESTS`
 * entry whose value is a computed expression instead of a literal would not slice cleanly, and
 * the `Function` constructor would then throw with a parse error naming the offset — which is
 * loud, not silent. Upgrade path: row 3 moves the corpus into `catalog/cases.json`, at which
 * point this resolver has one source instead of three.
 */
function readRuntimeTests() {
  if (readRuntimeTests.cache) return readRuntimeTests.cache;
  let text;
  try {
    text = fs.readFileSync(RUNTIME_TESTS_FILE, 'utf-8');
  } catch (err) {
    throw new Error(`Cannot read ${RUNTIME_TESTS_FILE}: ${err.message}`);
  }
  const decl = text.indexOf('const RUNTIME_TESTS = {');
  if (decl === -1) throw new Error(`${RUNTIME_TESTS_FILE} declares no RUNTIME_TESTS object`);
  const open = text.indexOf('{', decl);
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close === -1) throw new Error(`${RUNTIME_TESTS_FILE}: RUNTIME_TESTS is not closed — the file is being edited`);
  let parsed;
  try {
    parsed = new Function(`return ${text.slice(open, close + 1)}`)();
  } catch (err) {
    throw new Error(
      `${RUNTIME_TESTS_FILE}: RUNTIME_TESTS does not read as an object literal (${err.message}). `
      + 'This resolver slices it as text; a syntax error here means the file is mid-edit. Retry once it settles.',
    );
  }
  readRuntimeTests.cache = parsed;
  return parsed;
}

function readAuthoredCases() {
  if (!fs.existsSync(CASES_FILE)) return {};
  return JSON.parse(fs.readFileSync(CASES_FILE, 'utf-8'));
}

/** Never spied: the ambient globals. Everything else, INCLUDING `assertEq`, goes through the
 *  spy — the spy is what records an assertion, so an asserter must not bypass it. */
const SPY_EXEMPT = new Set(['console', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Reflect', 'Map', 'Set']);

/** A block reading one of these answers differently on two runs of the same tree (E26). */
const NON_DETERMINISTIC_RE = /Math\.random|Date\.now|new Date\b/;

/**
 * A script's assertion helpers, by shape rather than by name: `(actual, expected, label)`.
 *
 * Most scripts call `assertEq`, but `18-graph-general/04-evaluate-division.md` asserts through
 * a local `approxArr(got, exp, label)` and never touches `assertEq` at all. Both put the
 * expected value in argument 1, which is the only thing the harvest needs, so one shape rule
 * covers both and the asserter's own arguments are ignored in favour of the input recorded by
 * the call INSIDE it.
 *
 * `ponytail:` matched by name prefix, because there is no other signal that a call is an
 * assertion. Ceiling: an asserter with a different arity or a different name shape is missed,
 * and the guide is then reported as uncovered rather than mis-harvested. Upgrade path: the
 * authored corpus declares its asserters — `catalog/cases.json`'s `__meta` already carries
 * `keyRules`/`entryShape`, so an `asserters: [...]` field is a one-line addition there.
 */
const ASSERTER_RE = /^(assert|approx|check|expect|verify|eq|same|isEqual|isDeep|isStrict)/i;

/**
 * Rewrite every direct call in a guide's authored case script into a recording form:
 *
 *     twoSum(nums, target)     ->  __SPY__("twoSum", twoSum)(nums, target)
 *     new Trie()              ->  new (__SPY__("Trie", Trie, 1))()
 *     arrayToTree([3, 9, 20]) ->  __SPY__("arrayToTree", arrayToTree)([3, 9, 20])
 *
 * WHY A REWRITE AND NOT A WRAPPER AROUND THE BINDING. The obvious approach — reassign
 * `twoSum = spy(twoSum)` before running the script — is illegal for most targets: a `const`
 * arrow, a `class` declaration and a `const X = class {}` all refuse reassignment, in sloppy
 * mode too, and QuickJS reports `Assignment to constant variable.` That is 105 of the 150
 * guides, so the approach is not a fallback, it is the majority case. Rewriting the CALL SITES
 * touches only the authored script, never the solution block, so it cannot perturb the thing
 * being measured — and an object property (`__SPY__`) is freely mutable, which is exactly what
 * a `const` binding is not.
 *
 * `ponytail:` only a direct `Identifier` callee is caught, so a call through a loop alias
 * (`for (const fn of [f1, f2, f3]) fn(x)`) is not recorded. That is acceptable rather than
 * lucky: the informative call in those scripts is the HELPER the alias passes through
 * (`fn(arrayToTree([…]))` records `arrayToTree`'s level-order array, which is what the `tree`
 * codec wants), and it is a direct call. Ceiling: one Acorn parse per script-shaped guide.
 * Upgrade path: if a guide's cases ever turn out to be captured only through an alias, bind
 * the alias too — the spy needs no region table, so it extends for free.
 */
function spyRewrite(script, targetNames = [], reserved = new Set(), siblingSources = [], { ops = true, mutArgs = false } = {}) {
  let ast;
  try {
    ast = acorn.parse(script, { ecmaVersion: 2024, sourceType: 'script', locations: false });
  } catch (err) {
    return {
      code: script,
      rewritten: 0,
      targets: targetNames,
      error: `the authored script does not parse (${err.message})`,
      viaCode: '',
      viaCount: 0,
      viaByStart: new Map(),
      derivationDeps: [],
    };
  }

  // A loop alias IS a target. `for (const fn of [f1, f2, f3]) assertEq(normWords(fn(board, WORDS)), …)`
  // never spells the target's name at the call site, so a spy that only knows the manifest's
  // target names would record the NORMALISER's argument — the expected value's own shape — and
  // the golden would trace a call nobody wrote. One extra AST rule buys the whole family: a
  // `for (const X of [ …targets… ])` binding joins the target set.
  const targets = new Set(targetNames.filter(Boolean));
  walk.simple(ast, {
    ForOfStatement(node) {
      const decl = node.left;
      if (decl?.type !== 'VariableDeclaration') return;
      const binding = decl.declarations?.[0]?.id;
      const iterable = node.right;
      if (binding?.type !== 'Identifier' || iterable?.type !== 'ArrayExpression') return;
      const holdsTarget = iterable.elements.some((el) => el?.type === 'Identifier' && targets.has(el.name));
      if (holdsTarget) targets.add(binding.name);
    },
  });

  // ── The op sequence of a class target ────────────────────────────────────────────────────
  // A class guide's script does not CALL the target, it CONSTRUCTS it and then drives it:
  // `const m = new C(); m.push(-2); m.push(0); assertEq(m.getMin(), -3)`. Every one of those
  // method calls has a MemberExpression callee, which the spy below does not rewrite, so the whole
  // sequence collapsed into one record with `args: []` — and the driver then constructed the class
  // and compared a scalar against an empty instance's state. Measured: min-stack yields 9 cases,
  // every one of them `{"args":[], "expected":<scalar>, "callee":"C"}`.
  //
  // So the calls are rewritten too, to a form that both RUNS the method and records it. Two shapes
  // cover the corpus: the receiver is a variable holding a constructed target (`m.push(-2)`), or the
  // call is on the construction itself (`new SubsequenceMatcher(t).isSubsequence(s)`). Both are
  // recorded as `[method, args, emitted]`, and `emitted` is the whole of the "did the author use
  // this value" question: a method call used as a STATEMENT contributed nothing to the assertion
  // (`m.pop()`) and a method call whose value is used contributed exactly that value
  // (`out.push(c.get(1))`, `assertEq(m.getMin(), -3)`). One rule, no per-guide table.
  const instanceVars = new Set();
  walk.simple(ast, {
    VariableDeclarator(node) {
      const init = node.init;
      if (node.id?.type !== 'Identifier' || init?.type !== 'NewExpression') return;
      const ctor = init.callee;
      if (ctor?.type === 'Identifier' && targets.has(ctor.name)) instanceVars.add(node.id.name);
      else if (ctor?.type === 'MemberExpression' && targets.has(ctor.property?.name)) {
        instanceVars.add(node.id.name);
      }
    },
  });
  const opCalls = [];
  const stmtStarts = new Set();
  const ctorStarts = new Set();
  if (ops) walk.simple(ast, {
    ExpressionStatement: (node) => stmtStarts.add(node.expression.start),
    CallExpression(node) {
      const callee = node.callee;
      if (callee?.type !== 'MemberExpression' || callee.computed) return;
      const method = callee.property?.name;
      if (typeof method !== 'string') return;
      const obj = callee.object;
      const onNew = obj?.type === 'NewExpression';
      if (!onNew && !(obj?.type === 'Identifier' && instanceVars.has(obj.name))) return;
      if (onNew) ctorStarts.add(obj.start);
      opCalls.push(node);
    },
  });
  // `acorn-walk` gives no parent pointer, so "was the return value used" is answered by a SET of
  // the calls that ARE statements — order-independent, and it reads off the same AST the edits
  // slice, so the two can never disagree about which call is which.
  const opEdits = opCalls.map((node) => {
    const obj = node.callee.object;
    const objText = script.slice(obj.start, obj.end);
    const argText = node.arguments.map((a) => script.slice(a.start, a.end)).join(', ');
    const used = stmtStarts.has(node.start) ? 0 : 1;
    const onNew = obj.type === 'NewExpression';
    // A receiver that IS the construction carries the constructor arguments, because that `new` is
    // left unspied — two edits cannot span one range — so `__SPY__`'s constructor branch never runs
    // and `__CTOR__` would stay empty. Without this, `new SubsequenceMatcher(t).isSubsequence(s)`
    // reconstructs with no arguments and dies on `.length` of undefined.
    const ctorText = onNew
      ? `[${(obj.arguments ?? []).map((a) => script.slice(a.start, a.end)).join(', ')}]`
      : 'null';
    return {
      start: node.start,
      end: node.end,
      text: `__SPYOP__(${JSON.stringify(node.callee.property.name)}, ${objText}, [${argText}], ${used}, ${ctorText})`,
    };
  });

  // The derivations, collected from the SAME AST and the SAME `script` text the edits below
  // slice — collected BEFORE any edit is applied, because an edit shifts every offset after it
  // and `byStart` is keyed on offsets into the ORIGINAL string.
  const derivations = collectDerivations(script, ast, targets, reserved, siblingSources, { mutArgs });

  const edits = [];
  const rewrite = (callee, ctor, callStart) => {
    if (callee?.type !== 'Identifier') return;
    if (SPY_EXEMPT.has(callee.name)) return;
    // The derivation key rides along as `__SPY__`'s 4th argument, looked up by the CALL's start
    // offset — the one position both this walk and `collectDerivations` agree on, because both
    // read the same unrewritten `script`.
    const via = derivations.byStart.get(callStart);
    // ── `isCtor` is emitted as an EXPLICIT 0/1 whenever a `via` key follows it ──────────────
    // Omitting it and writing `__SPY__("fn", fn, "v1")` looks equivalent and is not: the key
    // lands in the `isCtor` SLOT, so the spy takes its constructor branch and calls
    // `Reflect.construct(target, args)` instead of `target.apply(this, args)`.
    //
    // For a plain `function` declaration that is silent and catastrophic. `Reflect.construct`
    // DISCARDS the return value and yields the fresh `this` object, so
    // `removeNthFromEndBruteForce([1,2,3,4,5], 2)` came back as `{}` instead of a list head, the
    // guide's own `listToArray({})` then dereferenced `head.next` on a plain object and threw
    // `cannot read property 'val' of undefined` — four authored scripts dead, with `gen:traces`
    // still exiting 0 because a guide with no cases is reported, never fatal. A `function` that
    // returns an OBJECT survives it (the object is the result), which is why exactly the guides
    // whose derivation wraps the call in a list/tree encoder died and the rest did not.
    //
    // Emitting the slot explicitly costs three characters and makes the two paths differ only in
    // a boolean, which is the only way this can be got right by accident later.
    const args = ctor ? ', 1' : via === undefined ? '' : ', 0';
    const viaArg = via === undefined ? '' : `, ${JSON.stringify(via)}`;
    edits.push({ start: callee.start, end: callee.end, text: `__SPY__(${JSON.stringify(callee.name)}, ${callee.name}${args}${viaArg})` });
  };
  walk.simple(ast, { CallExpression: (node) => rewrite(node.callee, false, node.start) });
  walk.simple(ast, {
    // A construction that is the RECEIVER of a recorded op is left alone: the op edit already spans
    // the whole call, and two edits over one range cannot both apply. Nothing is lost — the driver
    // constructs from the recorded ctor args rather than re-running the construction.
    NewExpression: (node) => { if (!ctorStarts.has(node.start)) rewrite(node.callee, true, node.start); },
  });
  const allEdits = edits.concat(opEdits).sort((a, b) => b.start - a.start);
  let code = script;
  for (const edit of allEdits) {
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  }
  return {
    code,
    rewritten: allEdits.length,
    opCount: opEdits.length,
    targets: [...targets],
    error: null,
    viaCode: derivations.viaCode,
    viaCount: derivations.count,
    viaByStart: derivations.byStart,
    derivationDeps: derivations.deps,
  };
}

/** The spy `spyRewrite` emits calls to. Two slots: the first call to a TARGET, and the first
 *  call of any kind, used only when no target was called since the last assertion.
 *
 *  `via` is the DERIVATION key `spyRewrite` attached to this call site (row 15 / S22). It rides in
 *  as the 4th argument and is recorded beside the case, so `buildBundle` can replay the author's
 *  own post-processing in the driver instead of comparing the target's raw return. It is set in
 *  exactly the three places `__AN__`/`__FN__` are set, and reset with the other per-assertion
 *  resets, because a derivation belongs to the call it was written on and to no other.
 *
 *  `ponytail:` two slots rather than one because "first call wins" is right for a single-argument
 *  guide and wrong for a multi-argument one. `findWords(board, ["eat","oath"])` — whose script
 *  builds `board` through a spied helper first — would otherwise record the HELPER's argument
 *  and drop `words`, so the golden would trace a one-argument call and answer about the wrong
 *  question. Preferring the first call whose callee IS a manifest target fixes that; the
 *  first-any-call fallback keeps working for the alias loops (`for (const fn of [f1, f2, f3])`),
 *  where the recorded call is the helper the alias passes through. Ceiling: a script that calls
 *  the target only through an alias AND whose informative call is not a direct one.
 *  Upgrade path: a real parameter mapping, which needs the target's arity from the AST. */
const SPY_RUNTIME = `
// Row 15 / S23 — the op sequence of a CLASS target. \`__OPS__\` is the accumulated
// \`[method, args, emitted]\` list for the instance constructed most recently, and it is NOT reset per
// assertion: the driver's replay reconstructs the instance from \`ctor\` and then applies the WHOLE
// list, so every case in a sequence has to carry the list as it stood when that assertion was
// written. It is reset by a CONSTRUCTION instead, which is the one event that starts a new sequence.
var __OPS__ = [];
var __CTOR__ = null;
// How many ops the PREVIOUS assertion already consumed. An op's "emitted" flag is a property of
// the call SITE, but an assertion only collects the values produced since the last one: min-stack's
// three assertions share one instance, and replaying all three getMins for the second would
// compare [-3, 0] against an expected 0.
var __FROM__ = 0;
function __TXA__(a) { try { return JSON.parse(JSON.stringify(Array.prototype.slice.call(a))); } catch (e) { return null; } }
function __SPYOP__(method, recv, args, emit, ctorArgs) {
  if (ctorArgs !== null) { var __ca__ = __TXA__(ctorArgs); __CTOR__ = __ca__ === null ? [] : __ca__; __OPS__ = []; __FROM__ = 0; }
  var r = recv[method].apply(recv, args);
  var tx = __TXA__(args);
  __OPS__.push([method, tx === null ? [] : tx, emit]);
  return r;
}
function __SPY__(name, target, isCtor, via) {
  return function () {
    var __isTarget = __TARGETS__.indexOf(name) !== -1;
    // Set when THIS invocation already recorded a literal, so the return-value collector below
    // does not record the same tree twice. isSameTree(arrayToTree(A), arrayToTree(B)) is
    // the case that makes this necessary: without the guard, A's own node lands at __FL__[1]
    // and B's literal at __FL__[2], so position 1 gets A back and same-tree breaks (S21).
    var __pushed__ = false;
    // Positional level-order evidence, collected for EVERY call in call order and BEFORE any
    // of the first-wins bookkeeping below. It has to sit here: a second arrayToTree([...])
    // arrives when __F__ is already occupied, so the guarded block below never runs for it —
    // which is exactly how isSameTree(A, B) lost its B.
    if (__LE__(arguments[0]) || __LIST_WIRE__(arguments[0])) { __FL__.push([arguments[0]]); __pushed__ = true; }
    // Row 15 / S28 - a TARGET call always re-records, so the case an assertion gets is the call
    // NEAREST it. First-wins was right about HELPER vs TARGET (see the findWords(board, WORDS)
    // note below, which is unchanged) and wrong about two TARGETS before one assertion: a script
    // that checks a float result with "if (Math.abs(got - 9.261) > 1e-9) process.exit(1)" asserts
    // through no asserter at all, so its call was still recorded when the NEXT assertion arrived and
    // that case kept the STALE arguments with the NEW expected value - the committed head said
    // args [2.1, 3] against expected 1024, i.e. a case asserting myPow(2, 10) == 1024 while
    // calling myPow(2.1, 3).
    //
    // The untransportable marker moves with it: it describes the args of the call that set it, so a
    // later TRANSPORTABLE call has to clear it or the next assertion is dropped for a stale reason.
    if (true) {
      if (__isTarget || __F__ === null) {
        var __args = null;
        try { __args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments))); } catch (e) { __args = null; }
        if (__isTarget) {
          // Positional repair, tree guides only. Every argument that is a live node graph is
          // replaced by the level-order recording the script made for THAT POSITION, and a
          // scalar argument passes through untouched — kthSmallest(arrayToTree([…]), 1)
          // keeps its k. First-wins could not do this: it kept ONE recording and dropped
          // every other argument, so isSameTree(A, B) was called as isSameTree(A, undefined).
          // If some node-graph argument has no recording the whole call falls back to the old
          // rule, so a case that already worked cannot regress.
          var __fixed = null;
          if (__TREE__ && __args !== null) {
            __fixed = __args.slice();
            for (var __i = 0; __i < __args.length; __i++) {
              if (!__GRAPH__(__args[__i])) continue;
              if (__i < __FL__.length && __FL__[__i] && __LE__(__FL__[__i][0])) __fixed[__i] = __FL__[__i][0];
              else { __fixed = null; break; }
            }
          }
          // Row 15 / S34 - and the tree repair above cannot help a LIST guide, because a list wire is
          // [1, 4, 5] and not a level-order array: there is nothing to substitute and nothing to derive
          // from, so __fixed stays null and the RAW argument is recorded. That is right for the
          // argument shapes a list target really takes - merge-k's merged-order case records an array
          // of chains, [{val:1,next:...}, ...], and list.acceptsWire refuses it, so the driver leaves
          // it alone and the merge walks the plain objects the author built. It is wrong for ONE shape:
          // the empty array, which list.acceptsWire([]) accepts, because arrayToList([]) is null and
          // listToArray(null) is [] - so the round trip holds and the codec claims it. The driver then
          // decodes the author's fn([]), meaning "no lists at all", into an empty chain and the target
          // throws on its first iteration.
          //
          // __pushed__ is the test, and it is this codec's own: it was computed on the way IN from
          // __LIST_WIRE__, which IS list.acceptsWire. The empty array is byte-identical in two records
          // that need opposite handling - invert-binary-tree's empty-tree case is arrayToTree([])'s
          // wire and must decode, and here it is the author's own [] - so the discriminator is not the
          // VALUE but the CALL it was handed to, and this branch is the only place that knows the
          // difference: a value that reached the TARGET is an input, and a value that reached a
          // constructor is a wire. acceptsWire([]) declined instead fixes these 2 blocks and breaks
          // invert-binary-tree x3 (measured), so the codec cannot decide this and the case carries it.
          //
          // __LIST__ and not the tree flag, deliberately: the positional repair above already owns
          // every tree argument, including the ones it cannot repair, so no tree golden can move here.
          __LIVE__ = (__LIST__ && __pushed__) ? 1 : 0;
          if (__fixed !== null) {
            __A__ = __fixed; __AN__ = name; __AV__ = via || null; __TX__ = 0;
          } else if (__TREE__ && __args !== null && !__LE__(__args[0]) && __F__ !== null && __LE__(__F__[0])) {
            // keep the level-order recording
          } else {
            __A__ = __args; __AN__ = name; __AV__ = via || null;
            __TX__ = (__args === null) ? 1 : 0;
          }
        } else if (__F__ === null) {
          // NOT a target, so NOT this case's derivation. Setting __AV__ here is what left 5 of
          // combinations' 6 cases keyless: the second argument of
          // assertEq(normCombos(fn(1, 1)), normCombos([[1]]), ...) is itself a normCombos call,
          // evaluated after the target call and before the asserter, and it overwrote the key the
          // target had just set. A derivation belongs to the target call it was written on --
          // collectDerivations only ever keys a target call site -- so nothing else may write it.
          __F__ = __args; __FN__ = name;
        }
      }
    }
    // Row 15 / S23: a plain-FUNCTION target call starts a different subject, so the instance op
    // list is dropped here rather than carried. is-subsequence is the measured reason: one
    // authored script drives the L3 CLASS and the L1/L2 functions in the same loop body, so without
    // this the class's op list was attached to the function's cases too and the L3 block drove a
    // constructor with a function's arguments.
    if (__isTarget && !isCtor) { __OPS__ = []; __CTOR__ = null; __FROM__ = 0; }
    if (__ASSERTERS__.indexOf(name) !== -1) {
      // Row 15 / S23: \`.slice()\` is load-bearing, not defensive. \`__CAP__\` is serialised ONCE at the
      // end of the script, so a shared array reference would give every case in the sequence the
      // FINAL list and silently grade all of them against the last assertion.
      var __ops__ = null;
      if (__OPS__.length > 0) {
        var __base__ = __FROM__;
        __ops__ = __OPS__.map(function (o, i) { return [o[0], o[1], i >= __base__ ? o[2] : 0]; });
        __FROM__ = __OPS__.length;
      }
      // Row 15 / S24 — the unbacked flag is set when the "args" recorded for this case ARE the asserter's
      // own arguments: no target call was recorded since the last assertion (the one that was could
      // not be transported), so the first-any-call fallback below recorded the ASSERTER. That is not
      // a case about the target — it is the target being asked to be called with
      // [true, true, "deep copy, no shared nodes"] — and grading it is how
      // copy-list-with-random-pointer reported 1 passed / 6 failed. Dropped and counted, on the same
      // ground as the untransportable case above it: a golden for an input the script never wrote
      // down is not a golden.
      // An op list backs the case on its own, so the test is the OPS LENGTH and not __A__:
      // is-subsequence's class case has no recorded ARGUMENTS (the receiver's construction is left
      // unspied) and is entirely carried by the op list.
      var __unbacked__ = (__A__ === null && __OPS__.length === 0 && __ASSERTERS__.indexOf(__FN__) !== -1) ? 1 : 0;
      __CAP__.push({ label: arguments[2] === undefined ? null : String(arguments[2]), expected: arguments[1], args: __A__ !== null ? __A__ : __F__, callee: __A__ !== null ? __AN__ : __FN__, untransportable: __TX__, unbacked: __unbacked__, live: __LIVE__, via: __AV__, ops: __ops__, ctor: __ops__ !== null ? __CTOR__ : null, draws: __DRAWS__.slice(__DRAWFROM__) });
      __DRAWFROM__ = __DRAWS__.length;
      __A__ = null; __AN__ = null; __F__ = null; __FN__ = null; __LIVE__ = 0; __TX__ = 0; __FL__ = []; __AV__ = null;
    }

    // A node argument the script never WROTE as a literal. lowestCommonAncestor is called as
    // fn(t1, findNode(t1, 5), findNode(t1, 1)): the two derived nodes are live graphs, so the
    // literal test above declined them and the positional repair had nothing for positions 1 and
    // 2 — a three-argument target driven with one. Recording the helper's RETURN in the SAME
    // __FL__ list, in call order and in the same one-element shape, means the repair loop
    // downstream is untouched: it already reads __FL__[i][0].
    //
    // Collects on RETURN rather than on the way in, because the derived arguments are evaluated
    // before the call they belong to. Skipped for a constructor (there is nothing to marshal) and
    // for a non-node return, and guarded because a cyclic or exotic return must not abort the
    // harvest — a tree whose level-order form is ambiguous stays unrecorded, exactly as it did
    // before.
    // Row 15 / S23: a new instance starts a new op sequence. Only a TARGET construction does —
    // \`new Node(v)\` inside a script is a helper and must not truncate the sequence.
    if (__isTarget && isCtor) { var __ca__ = __TXA__(arguments); __CTOR__ = __ca__ === null ? [] : __ca__; __OPS__ = []; __FROM__ = 0; }
    var __ret__ = isCtor ? Reflect.construct(target, Array.prototype.slice.call(arguments))
                         : target.apply(this, arguments);
    if (__TREE__ && !isCtor && !__pushed__ && __GRAPH__(__ret__)) {
      try {
        var __le__ = treeToArray(__ret__);
        if (__LE__(__le__)) __FL__.push([__le__]);
      } catch (e) { /* not a shape the tree codec can carry — leave it unrecorded */ }
    }
    return __ret__;
  };
}
`;

/**
 * Names the DRIVER already declares inside its own IIFE, so a derivation helper sliced out of an
 * authored script can be checked against them BEFORE it is emitted.
 *
 * ── Why this set exists (the measured cause of a reverted feature) ─────────────────────────
 * The derivation helpers are sliced out of the AUTHORED SCRIPT by name and emitted into the
 * driver bundle. Most of the names a derivation expression references are not declared by the
 * script at all — they come from the guide's own block (`listToArray`, `treeToArray`,
 * `arrayToTree`, `graphToAdj`, `quadToGrid`, `inorderVals`, `treeHeight`), which
 * `buildInstrumented` puts in `blockSource` OUTSIDE the driver IIFE. A handful of those names
 * are ALSO the codec registry's own: `driverCodecSource()` emits `listToArray`, `arrayToList`,
 * `treeToArray` and `arrayToTree` INSIDE the IIFE, where they shadow the block's copies.
 *
 * That shadowing is not a name clash, it is a semantic one. `codecs.mjs`'s `listToArray` walks a
 * chain with `isNil(node)` and records `node.val`; a guide's own `listToArray` walks the same
 * chain. Slicing the guide's version into the IIFE — AFTER `driverCodecSource()` has already
 * declared its own — replaces the codec's encoder for every case in the run, and the result was
 * four authored scripts dying on
 * `TypeError: cannot read property 'val' of undefined at listToArray (submission.mjs:119)`, with
 * `gen:traces` still exiting 0 because a guide that produces no cases is REPORTED, never fatal.
 *
 * So the emitted helper set is filtered against this set, and against the block's own
 * declarations, before anything is sliced. A name in here is resolved by the driver that is
 * already there.
 *
 * ponytail: a fixed list derived by reading `driverCodecSource()`'s own top-level declarations
 * ONCE at module load, rather than re-parsing the emitted source per guide. Ceiling: a name the
 * driver declares INSIDE a function body is not seen, so a helper could still shadow a local —
 * the driver's own functions declare no such name today. Upgrade path: derive the set from the
 * emitted bundle text in `problems.mjs`, which is the only place the full driver shape exists.
 */
const DRIVER_DECLARED = (() => {
  const names = new Set([
    // `buildBundle`'s own driver-body locals, declared before the codec source is emitted.
    '__JUDGE_LOG__', '__TESTS__', '__FN_NAME__', '__KIND__', '__CODEC__', '__CMP__',
    '__errText__', '__snap__', '__RESULT__', '__FN__', '__IS_CLASS__', '__VIA_FNS__',
  ]);
  try {
    const ast = acorn.parse(driverCodecSource(), { ecmaVersion: 2024, sourceType: 'script' });
    for (const node of ast.body) {
      if (node.type === 'FunctionDeclaration' && node.id?.name) names.add(node.id.name);
      else if (node.type === 'ClassDeclaration' && node.id?.name) names.add(node.id.name);
      else if (node.type === 'VariableDeclaration') {
        for (const decl of node.declarations) if (decl.id?.type === 'Identifier') names.add(decl.id.name);
      }
    }
  } catch {
    // An unparseable codec source is not this function's problem to report: `buildBundle` will
    // fail loudly on the same text. The literal half of the set above still stands.
  }
  return names;
})();

/**
 * The derivation an assertion applied to its target's return, and the code needed to replay it.
 *
 * A harvested case records what the authored script asserted AFTER its own post-processing, but
 * `buildBundle`'s driver compares the target's RAW return. `normCombos(fn(4, 2))` asserts a
 * mapped-and-sorted array of comma-joined STRINGS; the driver calls `fn(4, 2)` and gets nested
 * arrays, then compares them to those strings. No equivalence kind bridges the two — measured,
 * not assumed: `equivalent('order-insensitive', ['1,2','1,3'], [[1,2],[1,3]])` is `false`,
 * because order-insensitive forgives ORDERING, not REPRESENTATION.
 *
 * So the derivation is replayed. One rule covers both shapes the corpus actually uses: take the
 * asserter's `arguments[0]`, find the OUTERMOST `CallExpression` inside it whose callee is a
 * target, and replace that call's source range with the literal text `__R__` — the target's
 * RETURN, which the driver has already computed by the time it applies the derivation. The result
 * is `normCombos(__R__)` for the wrapper shape and `__R__.val` for the projection shape — same
 * rule, no per-guide table, and the target stays at exactly one invocation per case.
 *
 * The expression still references helper names (`normCombos`, `normPerms`), so each one's
 * top-level declaration is sliced out of the SAME script. A name the driver already declares, or
 * the guide's own block already declares, is NOT sliced — see `DRIVER_DECLARED` for why that
 * filter is load-bearing rather than cosmetic.
 *
 * @param {string} script   the authored case script, unrewritten
 * @param {object} ast      its parsed form (the caller already has one)
 * @param {Set<string>|string[]} targets  names a recorded call may resolve to
 * @param {Set<string>} [reserved]  names already declared by the block source; never sliced
 * @returns {{viaCode: string, count: number, byStart: Map<number, string>}}
 *   `byStart` maps a target call's source offset to its registry key, so the spy rewrite can hand
 *   the key to that exact call site.
 */
export function collectDerivations(script, ast, targets, reserved = new Set(), siblings = [], { mutArgs = false } = {}) {
  const targetSet = targets instanceof Set ? targets : new Set(targets);
  const entries = [];
  const byStart = new Map();

  // The OUTERMOST target call inside `arguments[0]`. Outermost matters: `normCombos(fn(4, 2))`
  // has `fn(4, 2)` nested inside `normCombos(...)`, and the derivation is the whole wrapper, not
  // the inner call. `lca`'s `fn(t1, …).val` has the target call as the `.object` of a member
  // expression, which the same descent finds because it walks every child, not just callee.
  const outermostTargetCall = (node) => {
    let found = null;
    const visit = (n) => {
      if (!n || typeof n.type !== 'string' || found !== null) return;
      if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && targetSet.has(n.callee.name)) {
        found = n;
        return;
      }
      for (const key of Object.keys(n)) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const value = n[key];
        if (Array.isArray(value)) for (const child of value) visit(child);
        else if (value && typeof value.type === 'string') visit(value);
      }
    };
    visit(node);
    return found;
  };

  // Row 15 / S25 - the OTHER place the target's value can reach an assertion: bound to a VARIABLE
  // first. `const r1 = fn('babad'); assertEq(r1.length === 3 && isPalStr(r1), true)` puts no target
  // call inside the asserter at all, so the rule below found nothing, recorded no derivation, and
  // the driver compared the raw return "bab" against an expected true. A variable initialised by a
  // target call is the same value by another route, so its references in an assertion become the
  // return placeholder - same substitution, same one-invocation guarantee.
  const retVars = new Set();
  const retVarSite = new Map();
  // A name the SCRIPT declares at top level is a helper, not a value the target returned — even when
  // the script also calls a target inside its initialiser. `merge-sorted-array` declares
  // `const merge = (nums1, m, nums2, n) => {…}` and then calls it, so without this filter `merge`
  // became a "return variable" and the derivation came out as
  // `__R__([1, 2, 3, 0, 0, 0], 3, [2, 5, 6], 3)` — the target call with its own callee replaced.
  // Measured cost of getting that wrong: 21 blocks across 7 guides went clean to zero-pass.
  // Row 15 / S26 - the THIRD place the target's value reaches an assertion: a MUTATED ARGUMENT.
  // `fn(t1); assertEq(collectRightChain(t1), [1,2,3,4,5,6])` - a void target rewrites its argument
  // in place, so the asserted value is a derivation over that argument, not over the return.
  // Offered only when the target is `void` (see `harvestCases`): for a target that RETURNS a value
  // the driver has no changed argument to hand the registry, and left ungated this fired on every
  // assertion mentioning an argument name - measured cost: word-search-ii's three levels went clean
  // to zero-pass and the corpus read `clean 424 zeroPass 15`.
  const argVars = new Set();
  const argVarSite = new Map();
  if (mutArgs) walk.simple(ast, {
    CallExpression(node) {
      if (node.callee?.type !== 'Identifier' || !targetSet.has(node.callee.name)) return;
      for (const a of node.arguments ?? []) {
        if (a?.type !== 'Identifier') continue;
        argVars.add(a.name);
        if (!argVarSite.has(a.name)) argVarSite.set(a.name, node.start);
      }
    },
  });
  const declaredHere = topLevelDeclarations(script);
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (node.id?.type !== 'Identifier' || !node.init) return;
      if (targetSet.has(node.id.name) || declaredHere.has(node.id.name)) return;
      const inner = outermostTargetCall(node.init);
      if (!inner) return;
      retVars.add(node.id.name);
      retVarSite.set(node.id.name, inner.start);
    },
  });
  // Replace every REFERENCE to `names`, and nothing that merely looks like one: a computed-free
  // member's property (`r1.length` is a reference to r1, `obj.r1` is not), an object-literal or
  // pattern key, and a label are all spelled the same way and mean something else.
  const substituteRefs = (text, names, placeholder = '__R__') => {
    let tree;
    try {
      tree = acorn.parse(text, { ecmaVersion: 2024, sourceType: 'script' });
    } catch {
      return null;
    }
    const cuts = [];
    const note = (n, parent) => {
      if (n.type !== 'Identifier' || !names.has(n.name)) return;
      if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
      if (parent?.type === 'Property' && parent.key === n && !parent.computed) return;
      if (parent?.type === 'LabeledStatement' && parent.label === n) return;
      if (parent?.type === 'BreakStatement' || parent?.type === 'ContinueStatement') return;
      cuts.push({ start: n.start, end: n.end });
    };
    const visit = (node, parent) => {
      if (!node || typeof node.type !== 'string') return;
      note(node, parent);
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const value = node[key];
        if (Array.isArray(value)) for (const child of value) visit(child, node);
        else if (value && typeof value.type === 'string') visit(value, node);
      }
    };
    visit(tree, null);
    let out = text;
    for (const cut of cuts.sort((a, b) => b.start - a.start)) {
      out = out.slice(0, cut.start) + placeholder + out.slice(cut.end);
    }
    return out;
  };

  walk.simple(ast, {
    CallExpression: (node) => {
      const callee = node.callee;
      if (callee?.type !== 'Identifier') return;
      if (targetSet.has(callee.name)) return;
      if (callee.name !== 'assertEq' && !ASSERTER_RE.test(callee.name)) return;
      const actual = node.arguments[0];
      if (!actual) return;
      const call = outermostTargetCall(actual);
      // No inline target call: the author may have bound the return to a variable first (S25), and
      // then the derivation is whatever the assertion did to THAT name.
      const raw = script.slice(actual.start, actual.end);
      // The RETURN is the more specific answer, so it is tried first; a mutated argument is the
      // fallback, and only a void target ever reaches it.
      let expr = call
        ? script.slice(actual.start, call.start) + '__R__' + script.slice(call.end, actual.end)
        : substituteRefs(raw, retVars);
      let base = '__R__';
      if (expr === null || !expr.includes('__R__')) {
        expr = substituteRefs(raw, argVars, '__MUT__');
        base = '__MUT__';
      }
      if (expr === null || !expr.includes(base)) return;
      // Where the key has to be ATTACHED. An inline target call is keyed by its own offset, because
      // that is the call site the spy rewrite can tag. A variable-bound return has no inline call in
      // the assertion at all, so the key is attached to the call INSIDE the declarator that bound it
      // - the same two hops the value itself travelled, in reverse.
      let site = call?.start ?? null;
      if (site === null) {
        for (const name of retVars) {
          if (retVarSite.has(name) && new RegExp(`\\b${name}\\b`).test(raw)) { site = retVarSite.get(name); break; }
        }
      }
      if (site === null && base === '__MUT__') {
        // A mutated-argument derivation attaches to the TARGET CALL that took the argument, which is
        // a call site the spy rewrite can tag exactly like any other. `fn(t1)` is where the value the
        // author later asserted was produced.
        for (const name of argVars) {
          if (argVarSite.has(name) && new RegExp(`\\b${name}\\b`).test(raw)) { site = argVarSite.get(name); break; }
        }
      }
      // The substituted call becomes the RETURN VALUE, `__R__`. The driver has already invoked the
      // target by the time it applies this derivation, so re-invoking it here would be a SECOND
      // call — and for a target that mutates its argument in place (`mergeTwoLists` relinks `a`'s
      // own nodes into the result) that second call walks a chain that is no longer a list and
      // never terminates. `__R__` keeps the target at exactly one invocation per case.
      //
      // Both real shapes reduce to it unchanged: `normCombos(fn(4, 2))` becomes `normCombos(__R__)`
      // and `fn(t1, …).val` becomes `__R__.val`.
      let exprAst;
      try {
        exprAst = acorn.parse(expr, { ecmaVersion: 2024, sourceType: 'script' });
      } catch {
        return; // an expression this generator cannot re-parse is one it will not replay
      }
      // Over-approximate the referenced names, exactly like `missingDeclarations` does: a helper
      // pulled in that the expression did not need is inert (it is the script's own text, it just
      // declares a name), while under-approximating would emit a derivation that throws on a
      // free identifier — which is the failure this whole mechanism exists to remove.
      const referenced = new Set();
      walk.simple(exprAst, {
        Identifier: (n) => {
          if (targetSet.has(n.name) || n.name === '__R__' || n.name === '__FN__' || n.name === '__ARGS__') return;
          referenced.add(n.name);
        },
      });
      const key = `v${entries.length + 1}`;
      entries.push({ key, expr, base, helpers: [...referenced] });
      if (site !== null) byStart.set(site, key);
    },
  });

  if (entries.length === 0) return { viaCode: '', count: 0, byStart, deps: [] };

  // Slice each helper out of the SAME script, skipping anything already declared where the code
  // is going to land. `topLevelDeclarations` is the existing resolver; a name the script declares
  // as `function`/`class`/`const`/`let`/`var` at top level is sliced whole.
  const declared = topLevelDeclarations(script);
  // Row 15 / S27 — a derivation helper the SCRIPT does not declare is not necessarily the driver's
  // own: it is very often declared by the GUIDE, in one of its three blocks, at a level this run is
  // not given. `quadToGrid` is declared once in construct-quad-tree's markdown and in none of the
  // selected blocks, so the derivation sliced a registry entry that threw
  // `ReferenceError: 'quadToGrid' is not defined` before comparing anything. So the lookup falls
  // through to the SIBLING blocks — the guide's own code, verbatim, uninstrumented, exactly as
  // `missingDeclarations` already lifts them into the block half of the bundle. The two filters stay:
  // a name the driver already declares is resolved by the driver, and a name the block declares is
  // already in scope through the closure.
  const needed = new Set();
  const slices = [];
  // …and they are NOT sliced into the driver. Two reasons, both measured:
  //   - a derivation helper that reaches the IIFE can SHADOW a name the codec registry declares
  //     there, which is the reverted-feature note on `DRIVER_DECLARED`;
  //   - `reserved` is the union of ALL THREE levels' declarations, so a helper that only one level's
  //     block declares looks "already in scope" for the other two and is skipped, leaving those
  //     levels with a registry entry that throws `ReferenceError` before comparing anything.
  // So a name neither the script nor the block-half declares is reported as a DEPENDENCY and lifted
  // into the block half instead — the guide's own code, verbatim and uninstrumented, which is what
  // `missingDeclarations` already does for a block's cross-level references.
  const deps = new Set();
  for (const entry of entries) {
    for (const name of entry.helpers) {
      if (needed.has(name) || deps.has(name)) continue;
      if (DRIVER_DECLARED.has(name)) continue;
      const text = declared.get(name);
      // Not declared by the SCRIPT: it is a dependency for the block half to supply, and
      // `missingDeclarations` decides per level whether the block already has it. Consulting
      // `reserved` here is what broke it — that set is the union of all three levels, so a helper
      // only one level declares looks available to the other two and is dropped.
      if (text === undefined) { deps.add(name); continue; }
      // Declared by the script AND already in scope where the code lands: not sliced, or it would
      // shadow the block's own copy.
      if (reserved.has(name)) continue;
      needed.add(name);
      slices.push(text);
    }
  }

  // The registry body is UNARY: it receives the target's RETURN, which the driver has already
  // computed, and transforms it. Handing it the target and the arguments instead would re-invoke
  // the target a second time, which is not merely redundant — for a target that mutates its input
  // in place it corrupts the input and the second call never terminates. See the note where the
  // `__R__` placeholder is substituted.
  const viaCode = [
    ...slices,
    `var __VIA_FNS__ = __VIA_FNS__ || {};`,
    // TWO parameters, because a derivation has two legitimate bases and the driver has both values in
    // hand: the target's RETURN and the ARGUMENT the call changed. Which one an entry reads is
    // decided by which placeholder its expression substituted, so there is no flag to keep in sync.
    ...entries.map((e) => `__VIA_FNS__[${JSON.stringify(e.key)}] = function (__R__, __MUT__) { return ${e.expr}; };`),
  ].join('\n');
  return { viaCode, count: entries.length, byStart, deps: [...deps] };
}

/**
 * Concatenate three levels' block sources with LATER declarations winning on a shared name.
 *
 * The scripts exercise all three levels (`for (const fn of [fBrute, fOpt, fCanon])`), so the
 * bundle needs all three, and a name declared by more than one is a `SyntaxError: invalid
 * redefinition of global identifier` when it is a `class` or a `const` — a `function`
 * redeclaration is legal, which is why this only bites a minority of guides and looks random.
 * Level order is L1, L2, L3, so the canonical declaration is the one that survives.
 *
 * `ponytail:` the dedup is by top-level declaration NAME, not by AST identity, and it drops the
 * whole statement that redeclares — so `const a = 1, b = 2;` in L2 loses `b` too if L1 declared
 * it. Measured 0 such mixed statements in the corpus, and dropping one inert declaration costs
 * nothing while keeping the merge would be a second pass over the same AST. Ceiling: a helper
 * whose body differs between levels keeps only the canonical one; that is the intended reading,
 * since the script asserts against the canonical answer.
 */
function dedupedBlockSource(sources, shadowed = new Set()) {
  const seen = new Set();
  const kept = [];
  for (const source of sources) {
    for (const { names, text } of topLevelStatementTexts(source)) {
      if (names.some((name) => seen.has(name) || shadowed.has(name))) continue;
      for (const name of names) seen.add(name);
      kept.push(text);
    }
  }
  return kept.join('\n');
}

/** Top-level statements of a block, each with the names it declares. */
function topLevelStatementTexts(source) {
  const out = [];
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2024, sourceType: 'script', locations: false });
  } catch {
    return [{ names: [], text: source }];
  }
  for (const node of ast.body) {
    const names = [];
    if (node.type === 'FunctionDeclaration' && node.id?.name) names.push(node.id.name);
    else if (node.type === 'ClassDeclaration' && node.id?.name) names.push(node.id.name);
    else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) if (decl.id?.type === 'Identifier') names.push(decl.id.name);
    }
    out.push({ names, text: source.slice(node.start, node.end) });
  }
  return out;
}

/**
 * Harvest `{args, expected}` from a guide's authored `assertEq` script by RUNNING it.
 *
 * The rule that makes this work: capture the arguments of the FIRST direct call since the
 * previous `assertEq`. "First", not "last", because the interesting call is the outermost
 * INPUT — `maxDepth(arrayToTree([3,9,20,…]))` records `arrayToTree`'s level-order array, which
 * is exactly what `buildBundle`'s `tree` codec marshalling expects, while the `maxDepth` call
 * that follows records a live node graph that JSON cannot carry.
 *
 * ALL THREE levels' sources are in the bundle because the scripts exercise all three —
 * `for (const fn of [maxDepthBFS, maxDepthIterative, maxDepth])` references L1 and L2 names that
 * the L3 block does not declare, and a stub for them would make the harvest assert against a
 * fake. Level order is L1, L2, L3 so the canonical definitions win any shared name.
 *
 * The `expected` recorded is the one a human wrote in the script, so it is an INDEPENDENT
 * source of truth: this file never derives an expected value from the solution it is checking.
 *
 * `ponytail:` arguments are JSON round-tripped because `buildBundle` inlines `JSON.stringify(tests)`.
 * An argument that is not JSON-representable (`undefined`, a `Map`, a cycle) is therefore
 * dropped or refused by the driver itself — this resolver reports `argsUnserialisable` rather
 * than inventing a substitute, because a substituted input is a golden for a case nobody wrote.
 * Ceiling: one sandbox run per script-shaped guide, and concatenating three blocks is a
 * SyntaxError if two of them declare the same name with `const`/`class` (a `function`
 * redeclaration is legal), which is reported per guide rather than worked around.
 * Upgrade path: cache the harvest to `build/cases.json` beside the block manifest, which
 * `scripts/gen-blocks.mjs` already owns.
 */
async function harvestCases(script, blocksByLevel, codec = null, { voidTarget = false } = {}) {
  if (typeof script !== 'string' || script.trim() === '') {
    return { cases: [], reason: 'the authored script is empty' };
  }
  // Names the guide's OWN block source declares, across all three levels. Passed to the spy so a
  // derivation helper that is already available where the bundle puts it is never sliced out and
  // re-declared — see `DRIVER_DECLARED` for the same filter on the driver's half.
  const reserved = new Set(blocksByLevel.flatMap((b) => [...topLevelDeclarations(b.source ?? '').keys()]));
  // Row 15 / S23 — a class target whose source reads a NON-DETERMINISTIC global gets NO op list.
  //
  // Replaying an op sequence makes the verdict depend on what the target's own methods return at
  // run time, and for `01-array-string/12-insert-delete-getrandom-o1` that is `Math.random`. Its
  // authored script pins the draw sequence with a global stub precisely because the answer depends
  // on it, and the stub is out of bounds here (§5d). Without a draw sequence the same guide measured
  // `passed 6 failed 1`, `passed 4 failed 3` and `passed 6 failed 1` on three consecutive
  // regenerations of the SAME tree — a golden whose verdict moves on every run is worse than a wrong
  // one, because nothing can gate on it (K6/E8 assume a byte-reproducible artefact).
  //
  // So the refusal is by SOURCE, not by guide name: any block naming `Math.random`, `Date.now` or
  // `new Date` keeps the pre-S23 recording, and its blocks stay in the S17 census as honest
  // remaining work. The repo already has this vocabulary — E26, and row 4's validator gate.
  const nonDeterministic = blocksByLevel.some((b) => NON_DETERMINISTIC_RE.test(b.source ?? ''));
  const spied = spyRewrite(
    script,
    blocksByLevel.map((b) => b.targetFn).filter(Boolean),
    reserved,
    blocksByLevel.map((b) => b.source ?? ''),
    { ops: true, mutArgs: voidTarget },
  );
  if (spied.error) return { cases: [], reason: spied.error };
  const targets = spied.targets;
  // `assertEq` is ALWAYS one: after the rewrite its call sites no longer declare it, and most
  // scripts never declared it — the runner's harness supplied it. A pattern-only set would
  // silently drop every script that asserts the ordinary way. A name that is also a manifest
  // target is excluded, so a guide whose own solution is called `check`/`isEqual` is not read
  // as asserting on itself.
  const declared = topLevelStatementTexts(spied.code).flatMap((st) => st.names);
  const asserterNames = [...new Set([
    'assertEq',
    ...declared.filter((name) => ASSERTER_RE.test(name) && !targets.includes(name)),
  ])];
  // A name the SCRIPT declares shadows the block's declaration of the same name: the authored
  // corpus writes `const isSubsequence = (s, t) => new SubsequenceMatcher(t).isSubsequence(s);`
  // in `02-two-pointers/02-is-subsequence.md`, which collides with L2's `function isSubsequence`
  // and is a hard `SyntaxError: invalid redefinition of global identifier`. The script's binding
  // is the one its assertions call, so it wins and the block's version is dropped.
  const scriptNames = topLevelStatementTexts(spied.code).flatMap((st) => st.names);
  const blockSource = dedupedBlockSource(blocksByLevel.map((b) => b.source), new Set(scriptNames));
  const bundle = [
    `var __JUDGE_LOG__ = console.log.bind(console);`,
    `var __CAP__ = [];`,
    `var __A__ = null;`,
    `var __AN__ = null;`,
    // The derivation key for the call currently being recorded, row 15 / S22. Reset with the rest
    // of the per-assertion state, because a derivation belongs to one call site and no other.
    `var __AV__ = null;`,
    `var __F__ = null;`,
    `var __FN__ = null;`,
    // Row 15 / S34 — 1 when the arguments just recorded are LIVE values the script wrote for the
    // TARGET, not a wire this codec's own constructor consumed. Reset with the rest of the
    // per-assertion state, for `__FN__`'s reason: it describes ONE recorded call.
    `var __LIVE__ = 0;`,
    `var __TX__ = 0;`,
    `var __TREE__ = ${JSON.stringify(codec === 'tree')};`,
    // A PARALLEL flag, deliberately not a widening of `__TREE__`. Four of the six `__TREE__` reads in
    // `SPY_RUNTIME` are tree-specific SEMANTICS, not "is this a node codec": the `__LE__` level-order
    // push on the way in, the `__GRAPH__` positional repair at the target call, `treeToArray` over the
    // return, and the keep-the-level-order-recording fallback. Widening the flag would hand every
    // `list` block all four — pushing level-order arrays and running a TREE encoder over a list
    // return — and would edit the shared code every tree golden is built from. The ONE thing widened
    // is `driverCodecSource()`'s emission below, which is codec-agnostic (it emits the whole
    // registry) and is what makes `__CODECS__` readable for either decoder's own name.
    `var __LIST__ = ${JSON.stringify(codec === 'list')};`,
    `var __FL__ = [];`,
    `var __TARGETS__ = ${JSON.stringify(targets)};`,
    // Row 15 / S27 — the recorded DRAW sequence. `Math.random` is installed as an ACCESSOR so
    // this observes whatever draw function the authored script installs (`Math.random = () =>
    // DRAWS[i++ % DRAWS.length]` in insert-delete-getrandom-o1) instead of racing it: the
    // script's assignment lands in the setter, and every value the target then receives comes
    // back through the getter. Recorded as DATA and replayed by the driver, so no authored text
    // executes there. `__DRAWFROM__` mirrors S23's `__FROM__`: an assertion collects only the
    // draws since the last one, because the script resets its own cursor between sequences.
    `var __DRAWS__ = [];`,
    `var __DRAWFROM__ = 0;`,
    `var __SCRIPT_RANDOM__ = Math.random;`,
    `Object.defineProperty(Math, 'random', {`,
    `  configurable: true,`,
    `  get: function () { return function () { var v = __SCRIPT_RANDOM__(); __DRAWS__.push(v); return v; }; },`,
    `  set: function (fn) { __SCRIPT_RANDOM__ = fn; },`,
    `});`,
    `var __ASSERTERS__ = ${JSON.stringify(asserterNames)};`,
    // A level-order encoding: scalars/null, or nested arrays of them. This is the ONLY shape
    // `buildBundle`'s `tree` branch can marshal (`__arrayToTree__(t.args[0])`), so for a `tree`
    // guide it is the shape a usable case must have.
    //
    // ponytail: the level-order test is structural, not a check against the guide. Ceiling: a
    // tree whose level-order encoding is itself ambiguous (a node whose value is an array) is
    // rejected. Upgrade path: row 17 routes every codec through `codecs.mjs`, at which point the
    // codec encodes its own input and this predicate moves there with it.
    // A node graph is the one argument shape a tree guide must never hand the codec raw: a
    // plain object, so exactly what a scalar is not. __LE__ only says "not a level-order
    // array", which is true of a graph AND of kthSmallest's integer k — without this the
    // repair loop demands a recording for the scalar and gives up on the whole call.
    `function __GRAPH__(a) { return a !== null && typeof a === 'object' && !Array.isArray(a); }`,
    `function __LE__(a) {`,
    `  if (!__TREE__) return false;`,
    `  if (!Array.isArray(a)) return false;`,
    `  for (var i = 0; i < a.length; i++) {`,
    `    var v = a[i];`,
    `    if (Array.isArray(v)) { if (!__LE__(v)) return false; continue; }`,
    `    if (v !== null && typeof v === 'object') return false;`,
    `  }`,
    `  return true;`,
    `}`,
    // Row 15 / S34 — the `list` codec's own answer to "is this value a wire of mine", which is the
    // `list` analogue of `__LE__` above. Read off the REGISTRY rather than reimplemented, because
    // `acceptsNodeWire` is already the round-trip test and a second notion of "a list wire" is how
    // the tree/list pair drifted apart in the first place. A `list` wire is `[1, 4, 5]`, not a
    // level-order array, so `__LE__` is exactly the wrong question here.
    `function __LIST_WIRE__(a) { return __LIST__ && __CODECS__.list.acceptsWire(a); }`,
    // `treeToArray`, for the case the spy's own literal test cannot catch: a node argument
    // produced by a HELPER (row 15 / S21). Tree guides only, so the other 413 bundles are
    // byte-identical to before, and LIFTED from codecs.mjs rather than forked — that file
    // records having already forked this once.
    //
    // Row 15 / S34 widened the name to `list` as well, and ONLY the name: the emission is the whole
    // registry, so `list` gets `arrayToList`/`listToArray`/`acceptsNodeWire`/`__CODECS__` it already
    // needs, and the block's own `function arrayToList` still comes later in the bundle and still
    // wins the global binding — so a `list` guide's derivation keeps calling the GUIDE's helper, which
    // is what `DRIVER_DECLARED` below exists to protect. No other codec gains anything: a bundle that
    // declares neither flag never reaches `__CODECS__` at all.
    (codec === 'tree' || codec === 'list') ? driverCodecSource() : '',
    SPY_RUNTIME,
    // A no-op. The spy rewrites every asserter's call site to go through `__SPY__`, which is
    // where an assertion is recorded, so this only has to keep the identifier resolvable.
    `function assertEq() {}`,
    blockSource,
    spied.code,
    `__JUDGE_LOG__('__CASES__' + JSON.stringify(__CAP__));`,
  ].join('\n');

  const exec = await executeUserCode(bundle, { timeoutMs: 5000 });
  if (!exec.ok) {
    return { cases: [], reason: `the authored script does not run (${String(exec.error ?? 'unknown').slice(0, 160)})` };
  }
  const line = exec.logs.find((l) => typeof l === 'string' && l.startsWith('__CASES__'));
  if (!line) {
    return { cases: [], reason: 'the authored script emitted no assertion record — it may assert through a helper that never reached assertEq' };
  }
  let captured;
  try {
    captured = JSON.parse(line.slice('__CASES__'.length));
  } catch (err) {
    return { cases: [], reason: `the assertion record is not readable JSON (${err.message})` };
  }

  const cases = [];
  let unserialisable = 0;
  let untransportable = 0;
  // Row 15 / S27 — cases dropped for want of a RECORDED draw sequence. Counted, never silent.
  let unpinned = 0;
  let unbacked = 0;
  for (const record of captured) {
    if (record.args === null || record.args === undefined) continue; // no block call before this assertion
    // The TARGET was called and its arguments could not be transported. `buildBundle` inlines
    // `JSON.stringify(tests)`, so a cyclic node graph has no form the driver can accept — and
    // recording the helper's arguments instead would trace a call the guide never documents.
    // Dropped, and counted, because a golden for a substituted input is not a golden.
    if (record.untransportable) { untransportable++; continue; }
    // Row 15 / S24: nothing was recorded behind this assertion, so its `args` are the ASSERTER's.
    if (record.unbacked) { unbacked++; continue; }
    if (!Array.isArray(record.args)) { unserialisable++; continue; }
    const testCase = { name: record.label ?? `case${cases.length}`, args: record.args };
    // The target that produced this case, carried so a level can tell its OWN cases from another
    // level's (row 15 / S20). Without it every level runs every case, and a class guide's
    // constructor arguments reach a plain function one argument short. Inert in the driver,
    // which reads only name/args/expected.
    // A void target returns nothing, and `buildBundle` compares `expected` through a
    // serialiser that renders an absent key as the string `'__undefined__'` — so ABSENT is the
    // honest encoding of "this function returns nothing", which is what the catalog's
    // `returnType: "void"` says. Copying the wrapper's post-state here instead would assert
    // that the target RETURNS the mutated array, which it does not.
    if (record.expected !== undefined) testCase.expected = record.expected;
    if (record.callee !== undefined) testCase.callee = record.callee;
    // Row 15 / S34 — the recorded arguments are LIVE values, so `buildBundle`'s driver must not
    // decode them. Only ever set when the spy's own provenance test says so, so its absence means
    // "decode, exactly as before" and a bundle for any other codec is byte-identical.
    //
    // DATA on the existing `JSON.stringify(tests)`, the way `via`/`ops`/`ctor`/`draws` already ride:
    // no envelope field, no golden field, no schema entry, so S10's frozen v1.1 set is untouched.
    if (record.live) testCase.live = 1;
    // The derivation the SCRIPT applied to this call's return before asserting (row 15 / S22), as
    // a registry key. It is inert in the driver unless a `__VIA_FNS__` entry of that name is
    // present, which `buildBundle` emits from the array property below.
    if (record.via !== undefined && record.via !== null) testCase.via = record.via;
    // Row 15 / S27 — the draw sequence this assertion consumed, as data. Non-empty only for a
    // target that actually drew, so a deterministic guide carries no `draws` at all and the
    // driver's replay is inert for it.
    if (Array.isArray(record.draws) && record.draws.length > 0) testCase.draws = record.draws;
    // Row 15 / S23 — the op list of a class target, and the CONSTRUCTOR arguments it starts from.
    // DATA, not code: it rides inside the existing `JSON.stringify(tests)`, exactly as `t.via` does,
    // so no envelope field, golden field or schema entry was added to carry it (S10's frozen v1.1
    // set is untouched). `args` deliberately stays whatever the spy recorded — the driver ignores
    // it on the ops branch, and keeping it means a case that BOTH has ops and is read by a host
    // that predates them still says what the script called.
    if (Array.isArray(record.ops) && record.ops.length > 0) {
      testCase.ops = record.ops;
      testCase.ctor = Array.isArray(record.ctor) ? record.ctor : [];
    }
    cases.push(testCase);
  }
  // Row 15 / S27 — a non-deterministic block is only gradable if its draw sequence was RECORDED.
  // The recorded draws ride the case as data and the driver replays them, so a case that carries
  // them has a verdict that does not move between runs — that is the whole property, and it is why
  // the earlier blanket refusal can be lifted. A case from such a block with NO draws would be
  // graded against a live `Math.random`, which is exactly the moving verdict this row exists to
  // remove, so it is DROPPED and counted on the same ground as an untransportable one: a golden for
  // an input the script never pinned is not a golden. Measured before this row, that state gave
  // 6/1, 4/3 and 6/1 on three consecutive regenerations of one tree.
  if (nonDeterministic) {
    const pinned = cases.filter((c) => Array.isArray(c.draws) && c.draws.length > 0);
    unpinned += cases.length - pinned.length;
    cases.length = 0;
    cases.push(...pinned);
  }
  if (cases.length === 0) {
    return {
      cases: [],
      untransportable,
      unbacked,
      reason: unbacked > untransportable
        ? `every assertion had no recorded target call behind it (${unbacked} of them), so there was no input to trace — the spy fell back to the asserter's own arguments`
        : untransportable > 0
        ? `every assertion calls the target with an input that cannot be transported to the driver (${untransportable} cyclic/non-JSON argument lists). `
          + '`api/_lib/problems.mjs`\'s `buildBundle` marshals ONLY the `tree` codec — its own comment names row 17 as the fix — so a `list`/`graph` input (a node graph, or a cycle) has no form `JSON.stringify(tests)` can carry.'
        : 'no assertion in the authored script calls a function this block declares, so there is no input to trace',
    };
  }
  // The derivation CODE rides as a PROPERTY ON THE ARRAY, not as an element. That is deliberate:
  // `JSON.stringify` ignores non-index own properties of an array, so `buildBundle`'s existing
  // `JSON.stringify(tests)` carries the cases and NOT this code — the driver receives the code as
  // a separate emitted prelude instead, and no signature, schema or envelope field changes
  // anywhere to accommodate it. A reader that spreads or filters the array drops the property,
  // which is why the level partition in `main()` re-attaches it explicitly.
  if (spied.viaCode) cases.viaCode = spied.viaCode;
  // Same non-index-on-the-array trick as `viaCode`, for the same reason: these names have to reach
  // `buildInstrumented` and they are not cases. `JSON.stringify` drops them by design, so nothing
  // downstream that only sees the serialised cases is affected.
  if (spied.derivationDeps?.length) cases.derivationDeps = spied.derivationDeps;
  // Row 15 / S30 — a tree guide's node CLASS, requested through the same sibling-lift the
  // derivation helpers use. `09-binary-tree-general/14-next-right-pointers-ii`'s L2 block never
  // mentions `Node` — it only assigns `node.next` on nodes it is handed — so nothing referenced it,
  // nothing lifted it, and the decoded node had no `next` for `findNextChild` to walk. Lifting it by
  // name costs nothing where it is already declared (`missingDeclarations` skips those) and is
  // simply not found where no sibling declares it, so this is safe for every tree guide, not just
  // the one that needs it.
  if (codec === 'tree') cases.derivationDeps = [...new Set([...(cases.derivationDeps ?? []), 'Node'])];
  return { cases, unserialisable, untransportable, unpinned, viaCount: spied.viaCount ?? 0 };
}

/**
 * Resolve one guide's cases, from the authored sources only. Never composes a value from the
 * solution under test.
 *
 * @returns {{cases: object[], origin: string, reason: string|null, unserialisable: number}}
 */
export async function caseSourceFor(entry) {
  // 1. the judge pilot specs — the only authored `{name, args, expected}` triples on disk
  const specFile = path.join(JUDGE_TESTS_DIR, `${entry.slug}.json`);
  if (fs.existsSync(specFile)) {
    const spec = JSON.parse(fs.readFileSync(specFile, 'utf-8'));
    if (Array.isArray(spec.tests) && spec.tests.length > 0) {
      return { cases: spec.tests, origin: `judge/tests/${entry.slug}.json`, reason: null, unserialisable: 0 };
    }
  }

  // 2. RUNTIME_TESTS' authored `{args, expect}` triples. `expect` -> `expected` is a RENAME,
  //    not a derivation: both are authored values.
  const runtime = readRuntimeTests()[entry.path];
  if (runtime && Array.isArray(runtime.cases) && runtime.cases.length > 0) {
    const cases = runtime.cases.map((c, i) => {
      const testCase = { name: `case${i}`, args: c.args };
      if (c.expect !== undefined) testCase.expected = c.expect;
      return testCase;
    });
    return { cases, origin: 'scripts/test-runner.mjs RUNTIME_TESTS[].cases', reason: null, unserialisable: 0 };
  }

  // 3. `catalog/cases.json`. Two shapes land here, because the authored corpus grew one at a
  //    time: a STRUCTURED `{name, args, expect}` list (the current form), and an `assertEq`
  //    SCRIPT that has to be harvested. `expect` -> `expected` is a RENAME of an authored
  //    value, not a derivation. `__meta` and any other non-problem key is skipped: the registry
  //    is keyed by path (E30) and nothing under `__` is a guide.
  const authored = readAuthoredCases()[entry.path];
  if (authored && Array.isArray(authored.cases) && authored.cases.length > 0) {
    const cases = authored.cases.map((c, i) => {
      const testCase = { name: c.name ?? `case${i}`, args: c.args };
      if (c.expect !== undefined) testCase.expected = c.expect;
      return testCase;
    });
    return { cases, origin: 'catalog/cases.json[].cases', reason: null, unserialisable: 0 };
  }

  const script = runtime?.script ?? authored?.script ?? null;
  if (script) {
    const blocksByLevel = LEVELS.map((level) => {
      const block = getBlock(entry.path, level);
      const { entry: meta, source } = instrumentGuideBlock(entry.path, level);
      return { level, block, meta, source, targetFn: block.targetFn, regionTable: meta.regionTable };
    });
    const harvested = await harvestCases(
      script,
      blocksByLevel.map(({ block, meta, source, targetFn, regionTable }) => ({ block, meta, source, targetFn, regionTable })),
      blocksByLevel[0]?.block?.codec ?? null,
      // Row 15 / S26: a derivation over a MUTATED ARGUMENT only means anything for a target that
      // returns nothing, so it is offered only when the catalog says the target is `void`.
      { voidTarget: entry.returnType === 'void' },
    );
    return {
      cases: harvested.cases,
      origin: runtime?.script ? 'scripts/test-runner.mjs RUNTIME_TESTS[].script (harvested)' : 'catalog/cases.json[].script (harvested)',
      reason: harvested.reason,
      unserialisable: harvested.unserialisable ?? 0,
    };
  }

  return {
    cases: [],
    origin: null,
    reason: 'no authored case source: absent from judge/tests, RUNTIME_TESTS and catalog/cases.json',
    unserialisable: 0,
  };
}

// ---------------------------------------------------------------------------
// instrumentation + tracing
// ---------------------------------------------------------------------------

/**
 * The `var` alias row 10's driver reaches the target through.
 *
 * ── Why this exists (a second rows-9-and-10 integration defect) ────────────────────────
 * Row 10's `buildWrapper` installs the recording wrapper by REASSIGNING the target's binding:
 *
 *     twoSum = (function (orig, isClass) { … })(twoSum, false);
 *
 * That is legal for a `function` or `var` declaration and illegal for everything else — a
 * `const` arrow, a `const X = …` and a `class` declaration all refuse reassignment in sloppy
 * mode too, and QuickJS aborts the run with `Assignment to constant variable.` Measured: 351 of
 * the 450 blocks, i.e. the majority. Row 10's `TraceAbiError` guard catches a probe-ABI
 * mismatch but nothing catches this, because the failure is a sandbox abort, not a shape.
 *
 * The alias is a `var`, which is reassignable, and it forwards. `buildWrapper` then wraps the
 * alias legally, and `fnName` on the envelope is restored to the manifest's real target, so the
 * golden's identity is unchanged: `block.hash` is still the sha256 of the guide's own block, so
 * a guide edit still trips a NAMED stale-golden failure (K5/E19) rather than a wall of line
 * diffs.
 *
 * Two properties fall out of the indirection that are worth having:
 *   - a recursive target's SELF-calls resolve the real global name, so they never pass through
 *     the wrapper at all. Row 10's "record, don't flush, last write wins" logic then sees
 *     exactly one record — the OUTERMOST return — with no per-frame bookkeeping.
 *   - `Reflect.construct` is chosen here rather than relying on row 10's `isClass` detection,
 *     because that detection reads the target name out of the block source, and by this point
 *     the source no longer contains the name as a declaration.
 *
 * `ponytail:` `var`, not `let`/a function parameter, because `var` is the only binding form
 * QuickJS will let row 10 reassign. Ceiling: one extra frame between the driver and the
 * target, and an arrow target invoked via `apply` receives `this === undefined`, which is what
 * it already got from `buildBundle`'s `__FN__.apply(null, args)`. Upgrade path: row 10 wraps
 * through a mutable holder object instead of a reassignment, at which point this disappears.
 */
const TARGET_ALIAS = '__T15_TARGET__';

function aliasDeclaration(blockSource, targetFn) {
  const isClass = new RegExp(`(^|\\n)\\s*(export\\s+)?class\\s+${targetFn}\\b`).test(blockSource);
  return `var ${TARGET_ALIAS} = (function (target) {
  return ${isClass
    ? `function () { return Reflect.construct(target, Array.prototype.slice.call(arguments)); }`
    : `function () { return target.apply(null, arguments); }`};
})(${targetFn});`;
}

/** Top-level declaration name -> its exact source text, for one block. */
function topLevelDeclarations(source) {
  const out = new Map();
  let ast;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2024, sourceType: 'script', locations: false });
  } catch {
    return out;
  }
  const record = (name, node) => {
    if (typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      out.set(name, source.slice(node.start, node.end));
    }
  };
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') record(node.id?.name, node);
    else if (node.type === 'ClassDeclaration') record(node.id?.name, node);
    else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id?.type === 'Identifier') record(decl.id.name, decl);
      }
    }
  }
  return out;
}

/**
 * The declarations a block references but does not itself declare, pulled from its SIBLING
 * levels' blocks — the guide's own code, verbatim.
 *
 * ── Why (measured: 15 blocks produce a zero-step trace because of this) ─────────────────
 * The guides share node types across levels and SAY so in a comment: `08-linked-list/
 * 02-add-two-numbers.md` L3 reads `// ListNode shared from Level 1.` and then calls
 * `new ListNode(0)` without declaring it. Row 7 selects the first fence per level, so L3's
 * block declares `addTwoNumbers` and nothing else. `buildBundle` is handed that one block, so
 * the run dies on `ReferenceError: ListNode is not defined` before a single probe fires, and
 * the trace is empty — which is plan §1 U3's vacuity hole reached by a different road: not a
 * broken region gate, but a block that cannot run alone.
 *
 * These declarations go into the `source` and the `instrumented` string AFTER the target block
 * and are NOT instrumented, so they contribute no probes and no steps. The region table is
 * untouched, so the trace still shows only the target's own body (K4). Row 9's block selection
 * is not re-implemented and no code is authored here: this copies text the guide already
 * contains.
 *
 * `ponytail:` identifiers are collected OVER-APPROXIMATELY — every `Identifier` node in the
 * block counts as a reference, including property keys and `.prop` members. Over-approximating
 * only ever pulls in a declaration the block may not need, which is inert (uninstrumented, no
 * probes). Under-approximating would drop one the block DOES need and reproduce the empty
 * trace, so the bias is deliberate. Ceiling: a helper defined in a block that is not one of the
 * three levels' (e.g. in the guide's prose-adjacent fence) is still missed. Upgrade path: row 7
 * records a `missingDecls[]` list in the manifest at generation time, where it belongs.
 */
function missingDeclarations(blockSource, siblingSources) {
  const own = topLevelDeclarations(blockSource);
  const referenced = new Set();
  try {
    const ast = acorn.parse(blockSource, { ecmaVersion: 2024, sourceType: 'script', locations: false });
    walk.simple(ast, { Identifier: (node) => referenced.add(node.name) });
  } catch {
    return '';
  }
  const pulled = [];
  const taken = new Set();
  for (const sibling of siblingSources) {
    for (const [name, text] of topLevelDeclarations(sibling)) {
      if (own.has(name) || taken.has(name) || !referenced.has(name)) continue;
      taken.add(name);
      pulled.push(text);
    }
  }
  if (pulled.length === 0) return '';
  return `\n/* ---- declarations this block shares with a sibling level (guide's own text) ---- */\n${pulled.join('\n')}\n`;
}

/**
 * Row 9's placement, wrapped in row 10's probe. Neither half is re-implemented here.
 *
 * `source` is row 9's re-read block rather than row 10's `blockOffset`-based slice, because
 * row 9 selects the block with the K7 predicate (`selectSolutionBlocks`) and row 10 slices by
 * the manifest's line span. When the two disagree about the first line of a block, every
 * probe offset is off by the difference and `resolveText` attaches the wrong source text to
 * every step. Handing row 10 row 9's own slice makes the offsets and the text come from one
 * reader. The envelope's `block.startLine`/`lines` still come from the manifest, which is the
 * identity K5 pins.
 */
export async function buildInstrumented(guidePath, level = 3, { depNames = [] } = {}) {
  const meta = getBlock(guidePath, level); // throws, naming gen-blocks.mjs, on an unknown block
  const { entry, source, instrumented } = instrumentGuideBlock(guidePath, level);
  const probes = Array.isArray(instrumented?.probes) ? instrumented.probes : [];
  const targetFn = meta.targetFn;

  const siblings = LEVELS
    .filter((other) => other !== level)
    .map((other) => {
      try {
        return instrumentGuideBlock(guidePath, other).source;
      } catch {
        return '';
      }
    });
  // Row 15 / S27 — a derivation helper the level's own block does not declare. Appending the NAMES to
  // the source `missingDeclarations` already scans is enough: it lifts a referenced-but-undeclared
  // name out of a sibling block, and it skips anything the block DOES declare, so this is per-level
  // correct without the harvest having to know which level it is building for.
  const shared = missingDeclarations(
    depNames.length > 0 ? `${source}\n${depNames.join('\n')}` : source,
    siblings,
  );

  // The alias goes in BOTH halves. Row 10 builds the traced run from `instrumented` and the
  // raw verdict run from `source`, and `buildWrapper` installs into whichever it is given —
  // so a single copy would leave one of the two runs without a target to wrap.
  const alias = aliasDeclaration(source, targetFn);
  return {
    path: guidePath,
    level,
    targetFn,
    block: { ...meta, targetFn: TARGET_ALIAS },
    entry,
    source: `${source}${shared}\n${alias}`,
    probeCount: probes.length,
    probes,
    sharedDeclarations: shared,
    instrumented: `${ADAPTER_PROBE}\n${instrumented.code}\n${shared}\n${alias}`,
  };
}

/**
 * A zero-step trace is refused, by name.
 *
 * This is the guard plan §1 U3 asks for. The failure it exists to catch is not "the guide is
 * wrong" but "the instrumentation stopped reaching the target": an empty trace validates
 * perfectly against every schema rule in §5, because nothing in the schema says a step must
 * exist. A recursive target whose body is depth 0 in the manifest but whose probe never fires
 * produces exactly that, and without this call it would be committed as a golden asserting
 * nothing.
 */
export function assertNonVacuous(envelope, label) {
  if (!envelope || !Array.isArray(envelope.steps) || envelope.steps.length === 0) {
    // Tagged so the run loop can count a thrown vacuity failure in the SAME tally as an
    // envelope that merely came back empty. Without the tag the two lists disagreed: the
    // summary once printed "empty traces: 0" while listing three zero-step traces three lines
    // below it, because the throw landed in `failures` and the empty-trace tally only ever saw
    // envelopes that survived. A summary that contradicts its own list is worse than no summary.
    const err = new Error(
      `${label}: the trace has ZERO steps. That is not a valid golden — it is the vacuity hole `
      + '(plan §1 U3): an empty trace passes every schema rule because no schema rule requires a '
      + 'step to exist. Check the regionTable entry for this block (a recursive or class target '
      + 'must be depth 0) and that the probe adapter is still the one row 9 calls.',
    );
    err.vacuity = true;
    throw err;
  }
  return envelope;
}

/** Wrapper so the generator and row 13's differ agree on what a golden IS. */
export function validateGolden(envelope) {
  return validateEnvelope(envelope);
}

/** The canonical form of a golden: row 6's key-sorted serialisation, so goldens are byte-diffable (K6/E8). */
export function stringifyEnvelope(envelope) {
  return stringify(envelope);
}

/**
 * One step, reduced to what a committed head may carry — plan §7 row 28, E32's ~2 KB cap.
 *
 * Measured, not guessed: `snap` and `operands` are the whole size story. Serialising the head
 * with the full step left **11 of 450 over the cap, largest 2993 B**, and every one of them a
 * binary-tree or trie guide whose watch state is a nested Map. `out` is already the truncated
 * human summary the portal prints, so it is the payload that survives; `delta`, `cond` and
 * `override` are per-step state that belongs in the full golden, not in a summary of it.
 *
 * Every value is COPIED, never aliased. `stringify` spends one id table per call and emits
 * `{"__ref":N}` on the second sighting of a live object, so a head that shared `first.line`
 * with `last.line` — which is exactly what happens whenever a golden has ONE step, because
 * `steps[0]` and `steps.at(-1)` are then the same object — ships a back-reference instead of
 * its own endpoint. Measured on this corpus: 6 heads carried `last: {"__ref":2}` before this
 * row, i.e. a committed artefact that could not be read without the stringifier that wrote it.
 */
const headStep = (step) => (step ? { n: step.n, line: { ...step.line }, out: step.out } : null);

/**
 * Row 11's degrade-to-`diff`, which row 10 deliberately does not do ("row 11 owns the client/
 * server delta split"). A golden that trips either cap has to say so in the one field that
 * means it, or `validateEnvelope` rejects it — and an envelope that is rejected is not a golden.
 *
 * `ponytail:` the emitted `delta` is computed against the PREVIOUS step's snapshot, over every
 * watched key. That is the whole of row 11's job and it is only ever reached above 2000 steps
 * or 7.5 MB, which measured 0 of 450 blocks at 150 guides — so it is the smallest thing that
 * satisfies [I3] and [I4]. Ceiling: no server-side streaming, no partial re-render; the
 * degraded golden is complete-but-delta-encoded. Upgrade path: row 11 proper.
 */
export function degradeToDiff(envelope) {
  const deltas = [];
  let previous = null;
  for (const step of envelope.steps) {
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
    if (delta.length > 0) deltas.push(step.n);
    previous = step.snap ?? null;
  }
  if (deltas.length === 0) {
    // [I4] rejects diff mode with no delta anywhere: nothing was shed and nothing was emitted,
    // so the trace renders blank. One synthetic change against the FIRST step is the honest
    // minimum that keeps the mode meaningful, and it is labelled rather than hidden.
    envelope.steps[0].delta.push({ path: '(degraded)', from: null, to: null });
  }
  for (const step of envelope.steps) step.snap = null; // [I4]: shed the payload, that IS the degrade
  envelope.budget.mode = 'diff';
  envelope.truncated.trace = true;
  // [required]: `budget.bytes` is checked independently of the mode, so shedding the snapshots
  // does not by itself bring a 10 MB golden back under the budget — the count has to be
  // re-settled, and it is part of the thing being counted, so it is iterated to a fixed point
  // exactly as row 10 settles it (digit-width churn is bounded and four passes exceed that).
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

/**
 * One golden: the canonical (or any) level of one guide, run through the whole engine.
 *
 * @param {string} guidePath
 * @param {1|2|3} level
 * @param {{cases?: object[], caseIndex?: number, codecOverride?: string}} [opts]
 */
export async function traceOne(guidePath, level = 3, opts = {}) {
  const built = await buildInstrumented(guidePath, level, { depNames: opts.cases?.derivationDeps ?? [] });

  if (opts.codecOverride !== undefined) {
    // G1's loud failure, proven: `getCodec` throws on an unimplemented name. Called here so the
    // generator refuses to invent a codec rather than shipping a plausible-looking wrong trace.
    getCodec(opts.codecOverride, guidePath);
  }

  let cases = opts.cases ?? null;
  if (!cases) {
    // The CLI resolves once per guide and passes the list down; a caller that does not (a test,
    // a one-off probe) gets the same authored cases rather than having to know the chain.
    const entry = loadProblemIndex().get(guidePath);
    if (!entry) throw new Error(`${guidePath} is not in catalog/problems.json`);
    cases = (await caseSourceFor(entry)).cases;
  }
  if (cases.length === 0) {
    throw new Error(`${guidePath} L${level}: no cases to run — resolve them with caseSourceFor() first`);
  }

  const envelope = await runBlockTrace({
    path: guidePath,
    level,
    block: built.block,
    source: built.source,
    instrumented: built.instrumented,
    cases,
    caseIndex: opts.caseIndex ?? 0,
    timeoutMs: opts.timeoutMs ?? GEN_TIMEOUT_MS,
  });

  // Undo the alias: the envelope's identity is the guide's target, not the generator's shim.
  // See `aliasSource` — `block.hash` is untouched, so K5/E19 still hold.
  envelope.fnName = built.targetFn;

  assertNonVacuous(envelope, `${guidePath} L${level}`);

  if (envelope.steps.length > DISPLAY_STEP_CAP && envelope.truncated.display !== true) {
    envelope.truncated.display = true;
  }
  if (envelope.budget.bytes > BYTE_BUDGET && envelope.budget.mode !== 'diff') {
    degradeToDiff(envelope);
  }

  // E28/F6: `ops-terminal-state-and-outputs` is a different shape from a plain return, and
  // `buildBundle`'s driver invokes the target EXACTLY ONCE (`__FN__.apply(null, args)`), so for
  // a class target the traced call is a CONSTRUCTION and the engine's codec-encoded return
  // carries no state at all. The trace's own LAST step snapshot is the terminal observable
  // state of everything the manifest watched, so that is what `result` records.
  //
  // ponytail: `outputs` is empty because a single invocation cannot emit a SEQUENCE — the ops a
  // guide documents are applied by its authored case script, not by the driver. Upgrade path:
  // row 10 grows an `ops` mode that drives the authored op list through the target, at which
  // point `outputs` is that list's recorded return values. Do not synthesise it here: an
  // `outputs` this file invented would be exactly the kind of plausible-looking wrong data the
  // engine exists to refuse.
  if (envelope.codec === 'ops') {
    envelope.result = { state: envelope.steps.at(-1)?.snap ?? {}, outputs: [] };
  }

  const verdict = validateGolden(envelope);
  if (!verdict.isValid) {
    throw new Error(
      `${guidePath} L${level}: the golden failed validateEnvelope, so it is not a golden:\n  `
      + verdict.errors.join('\n  '),
    );
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// eventFloor (F5)
// ---------------------------------------------------------------------------

/**
 * The minimum meaningful step count for a problem, DERIVED from the problem's own canonical
 * golden rather than from a constant.
 *
 * F5: the floor is pinned to the canonical case. A constant floor cannot distinguish "this
 * guide legitimately traces in four steps" from "the instrumentation regressed and four steps
 * are all that arrived" — one number cannot be right for 150 guides whose traces span three
 * orders of magnitude. Pinning to L3's measured `stepCount` makes row 26's V5 gate a real
 * regression detector: any change that silently suppresses steps, any `regionTable` edit that
 * moves a target to depth 1, and any guide edit that shortens the canonical trace all show up
 * as "under floor" instead of as a green suite over a hollow trace.
 *
 * `byLevel` is recorded alongside because Tier 1 animates L1 and L2 too, so row 26 needs the
 * same gate at those levels; the canonical floor is the one the manifest gates on.
 */
export async function eventFloorFor(guidePath, { index = null } = {}) {
  const canonical = await traceOne(guidePath, 3);
  return {
    path: guidePath,
    eventFloor: canonical.stepCount,
    basis: 'L3 canonical golden stepCount',
    byLevel: { 3: canonical.stepCount },
  };
}

// ---------------------------------------------------------------------------
// the per-module case-count table
// ---------------------------------------------------------------------------

/**
 * One row per curriculum module: how many problems it has, how many have a case source, and
 * how many do not. Plan §3 G2 — every count in the docs cites a measurement rather than a
 * remembered number, and this is the measurement for "coverage".
 */
export function moduleCaseTable(catalog, coverage) {
  const rows = new Map();
  for (const entry of catalog) {
    const module = entry.path.split('/')[0];
    if (!rows.has(module)) rows.set(module, { module, problems: 0, covered: 0, uncovered: 0, cases: 0, uncoveredPaths: [] });
    const row = rows.get(module);
    row.problems++;
    const status = coverage.get(entry.path);
    if (status && status.cases > 0) {
      row.covered++;
      row.cases += status.cases;
    } else {
      row.uncovered++;
      row.uncoveredPaths.push(entry.path);
    }
  }
  return [...rows.values()].sort((a, b) => a.module.localeCompare(b.module));
}

// ---------------------------------------------------------------------------
// filenames
// ---------------------------------------------------------------------------

/** `05-hashmap/06-two-sum.md` + L3 -> `05-hashmap__06-two-sum.L3.json`. Flat: see TRACES_DIR. */
export function goldenFileName(guidePath, level, suffix = '.json') {
  return `${guidePath.replace(/\//g, '__').replace(/\.md$/, '')}.L${level}${suffix}`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(argv) {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const noWrite = argv.includes('--no-write');
  const catalog = loadCatalog();
  const index = loadProblemIndex();

  // Fail loudly, before writing anything, on a manifest that is absent or unparseable.
  const blocks = loadBlocks();

  fs.mkdirSync(TRACES_DIR, { recursive: true });

  // ── STALE ARTEFACT SWEEP ────────────────────────────────────────────────────────────────
  // A guide that produces no golden writes NOTHING, and nothing here ever deleted what a previous
  // run left behind. So `judge/traces/` accumulated a MIX of fresh and stale files, and every
  // census computed over it — `test:trace`'s S17 ratchet included — was reading a corpus that no
  // single run produced. That is not a rounding error: it is how the same on-disk state was
  // observed as `zero-pass 49` from a standalone script and `zero-pass 94` from inside
  // `npm run test:trace`, and how an uncomputed census can read as improvement.
  //
  // So the directory is emptied BEFORE generation, and `--no-write` is exempt (it is the
  // read-only probe; deleting the corpus under it would destroy the thing being inspected).
  // `--only` is NOT exempt in the same way — it narrows what is rewritten, so it must also not
  // delete what it is not rewriting. It is therefore refused here rather than half-supported.
  if (!noWrite && only) {
    throw new Error(
      `gen:traces --only ${only} cannot clear judge/traces/ without destroying the other 149 guides' `
      + 'goldens. Sweep and partial-regeneration are mutually exclusive: run the full generator, or '
      + 'point --only at a copy of the corpus.',
    );
  }
  if (!noWrite) {
    let swept = 0;
    for (const file of fs.readdirSync(TRACES_DIR)) {
      if (!/\.L[123]\.(head\.)?json$/.test(file) && file !== 'manifest.json') continue;
      fs.rmSync(path.join(TRACES_DIR, file));
      swept += 1;
    }
    if (swept > 0) console.log(`[gen-traces] swept ${swept} stale golden file(s) from judge/traces/ — a census may never be computed over a mix of fresh and stale artefacts`);
  }

  const started = Date.now();
  const coverage = new Map();
  const written = [];
  const validated = [];
  const failures = [];
  const emptyTraces = [];
  const uncovered = [];
  const degraded = [];
  const codecHistogram = {};
  let biggest = { bytes: 0, file: null };
  let totalBytes = 0;

  for (const entry of catalog) {
    if (only && entry.path !== only) continue;

    let source;
    try {
      source = await caseSourceFor(entry);
    } catch (err) {
      failures.push({ path: entry.path, level: null, reason: `case resolution threw: ${err.message}` });
      uncovered.push({ path: entry.path, reason: `case resolution threw: ${err.message}` });
      coverage.set(entry.path, { cases: 0, origin: null });
      continue;
    }

    if (source.cases.length === 0) {
      uncovered.push({ path: entry.path, reason: source.reason ?? 'no authored case source' });
      coverage.set(entry.path, { cases: 0, origin: null });
      continue;
    }
    coverage.set(entry.path, { cases: source.cases.length, origin: source.origin });

    // Row 15 / S20 — one harvested case list feeds all three levels, and that is load-bearing:
    // an ALIAS loop (`for (const fn of [f1, f2, f3]) assertEq(...)`) records `callee: 'fn'`, and
    // each level running that one case against its OWN function is how 150 guides are covered by
    // one authored script. So the list is NOT filtered per level in general.
    //
    // What must not happen is a case recorded against ANOTHER level's target being replayed here,
    // which is how is-subsequence's L1 ran `isSubsequenceBruteForce('ahbgdc')` — the L3 CLASS's
    // constructor argument, one argument short, dying on `.length` of undefined. So a case is
    // dropped on that exact condition and no other: a `callee` that is not any level's target
    // (an alias, or a case from `judge/tests` / `test-runner` / `catalog` with no `callee` at
    // all) still reaches every level, which is what keeps coverage intact.
    // The MANIFEST's per-level target, not the catalog's: `fnName.L3` is null for a guide whose
    // canonical is a class (`02-two-pointers/02-is-subsequence.md` declares `SubsequenceMatcher`,
    // which `declarations()` cannot see), and reading level targets from the catalog made its
    // 7 class cases look like an alias's — so they leaked into L1 and L2, which is the very
    // failure this exists to stop.
    //
    // ONLY a class case is dropped, and the discriminator is the block's own `codec`. A case
    // recorded against a different level's FUNCTION is still a legitimate case here: an alias
    // loop asserts one property of all three, and an assertion that names one level's function
    // outside such a loop (`assertEq(copyRandomListBruteForce(null), null)`) states a property
    // the other two must satisfy too. Dropping those cost 4 blocks their only passing case and
    // was a net loss. An `ops` case is an op sequence against a CONSTRUCTED INSTANCE and is
    // structurally meaningless against a plain function — that asymmetry is the whole defect.
    const blocksByGuide = blocks.filter((b) => b.path === entry.path);
    const codecOfTarget = new Map(blocksByGuide.map((b) => [b.targetFn, b.codec ?? null]));
    const casesForLevel = (level) => {
      const mine = blocksByGuide.find((b) => b.level === level);
      const kept = source.cases.filter((c) => {
        // Row 15 / S23: a case carrying an op list is an op sequence against a CONSTRUCTED
        // INSTANCE, so it is structurally meaningless against a plain function — the same
        // asymmetry the rule below states for a case whose `callee` is an `ops` target, and it
        // reaches only the levels whose own block is an `ops` one. The discriminator is `c.ops`,
        // NOT `c.callee`: recording the op sequence takes the receiver's construction out of the
        // target-call path, so such a case's `callee` is the ASSERTER and the rule below saw
        // nothing to drop. Measured: is-subsequence L2 went 21/0 to 18/3 without this, because
        // three of the L3 class cases reached a plain function.
        if (Array.isArray(c.ops)) return mine?.codec === 'ops';
        // …and the same asymmetry read from the other side: at an `ops` LEVEL the target is a class,
        // so a case recorded against a sibling level's plain FUNCTION is structurally meaningless
        // there too. `is-subsequence` is the measured instance — one authored script drives the L3
        // CLASS and the L1/L2 functions, so without this the L3 block ran 14 function cases against
        // a constructor and answered 0 of 21. `callee: 'C'` (an alias) and `callee: 'assertEq'`
        // name no block at all, so both still reach the level, which is what keeps coverage intact.
        if (mine?.codec === 'ops') {
          const owner = blocksByGuide.find((b) => b.targetFn === c.callee);
          if (owner && owner.codec !== 'ops') return false;
        }
        if (c.callee === mine?.targetFn || !blocksByGuide.some((b) => b.targetFn === c.callee)) return true;
        return !(codecOfTarget.get(c.callee) === 'ops' && mine?.codec !== 'ops');
      });
      // `.filter()` returns a NEW array and does not copy non-index own properties, so the
      // derivation code `harvestCases` parked on `source.cases.viaCode` is GONE by default. It has
      // to be re-attached by hand or every level of a derivation guide silently loses its replay
      // and the block stays in the wrong-verdict census looking like a driver bug.
      if (source.cases.viaCode) kept.viaCode = source.cases.viaCode;
      if (source.cases.derivationDeps) kept.derivationDeps = source.cases.derivationDeps;
      return kept;
    };

    for (const level of LEVELS) {
      const label = `${entry.path} L${level}`;
      try {
        const envelope = await traceOne(entry.path, level, {
          cases: casesForLevel(level),
          caseIndex: 0,
        });

        if (envelope.stepCount === 0) emptyTraces.push({ path: entry.path, level, reason: 'zero steps' });

        const file = goldenFileName(entry.path, level);
        const text = stringifyEnvelope(envelope);
        const bytes = Buffer.byteLength(text, 'utf-8');
        totalBytes += bytes;
        if (bytes > biggest.bytes) biggest = { bytes, file };
        if (envelope.truncated.trace) degraded.push({ path: entry.path, level, bytes, steps: envelope.stepCount });

        codecHistogram[envelope.codec] = (codecHistogram[envelope.codec] ?? 0) + 1;

        if (!noWrite) {
          fs.writeFileSync(path.join(TRACES_DIR, file), `${text}\n`);
          written.push(file);
          // The committed per-problem summary (E32, plan §7 row 28). ~2 KB, and the ONLY thing
          // under judge/traces/ that git tracks. The step shape is row 28's own summary —
          // `headStep`, above — and is NOT the frozen v1.1 step: a head is not the envelope.
          fs.writeFileSync(path.join(TRACES_DIR, goldenFileName(entry.path, level, '.head.json')), `${stringify({
            v: 1,
            path: entry.path,
            level,
            fnName: envelope.fnName,
            codec: envelope.codec,
            blockHash: envelope.block.hash,
            stepCount: envelope.stepCount,
            first: headStep(envelope.steps[0]),
            last: headStep(envelope.steps.at(-1)),
            verdict: envelope.verdict,
            budget: { bytes: envelope.budget.bytes, mode: envelope.budget.mode, chunks: envelope.budget.chunks },
            error: envelope.error,
          })}\n`);
        }
        validated.push({ path: entry.path, level, steps: envelope.stepCount, bytes, degraded: envelope.truncated.trace });
      } catch (err) {
        failures.push({ path: entry.path, level, reason: err.message });
        // A vacuity throw IS an empty trace, so it belongs in that tally too — see the note on
        // assertNonVacuous. Counting it only in `failures` is what let the summary report
        // "empty traces: 0" while listing three of them.
        if (err && err.vacuity) emptyTraces.push({ path: entry.path, level, reason: 'zero steps (threw)' });
      }
    }
  }

  // ---- event floors, canonical level only (F5) --------------------------------------
  const floors = new Map();
  for (const entry of catalog) {
    if (only && entry.path !== only) continue;
    if (!coverage.get(entry.path)?.cases) continue;
    try {
      const canonical = validated.find((v) => v.path === entry.path && v.level === 3);
      if (!canonical) continue;
      floors.set(entry.path, {
        path: entry.path,
        eventFloor: canonical.steps,
        basis: 'L3 canonical golden stepCount',
        byLevel: Object.fromEntries(validated.filter((v) => v.path === entry.path).map((v) => [String(v.level), v.steps])),
      });
    } catch (err) {
      failures.push({ path: entry.path, level: 3, reason: `eventFloor: ${err.message}` });
    }
  }

  // ---- the manifest ------------------------------------------------------------------
  const table = moduleCaseTable(catalog, coverage);
  const manifest = {
    v: 1,
    generator: 'scripts/gen-traces.mjs',
    envelopeSchema: 'v1.1',
    granularity: 'every catalogued guide x levels 1,2,3',
    counts: {
      problems: catalog.length,
      covered: catalog.length - uncovered.length,
      uncovered: uncovered.length,
      goldens: validated.length,
      validated: validated.length,
      failures: failures.length,
      emptyTraces: emptyTraces.length,
      degraded: degraded.length,
      totalBytes,
      largestGolden: biggest,
    },
    codecHistogram,
    equivalenceHistogram: catalog.reduce((acc, entry) => {
      acc[entry.equivalence] = (acc[entry.equivalence] ?? 0) + 1;
      return acc;
    }, {}),
    moduleCaseTable: table,
    eventFloors: Object.fromEntries(floors),
    uncovered,
    emptyTraces,
    degraded,
    failures,
    goldens: validated,
  };
  if (!noWrite) {
    fs.writeFileSync(path.join(TRACES_DIR, 'manifest.json'), `${stringify(manifest)}\n`);
  }

  // ---- the report ---------------------------------------------------------------------
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n[gen-traces] ${manifest.counts.goldens} goldens  ·  ${validated.length} passed validateEnvelope  ·  ${secs}s`);
  console.log(`[gen-traces] problems ${catalog.length}  covered ${manifest.counts.covered}  uncovered ${uncovered.length}`);
  console.log(`[gen-traces] granularity: every guide x L1,L2,L3 — owner decision 2 animates all three at Tier 1, and eventFloor is pinned to L3 alone (F5)`);
  console.log(`[gen-traces] codec histogram: ${Object.entries(codecHistogram).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`[gen-traces] corpus ${(totalBytes / 1024).toFixed(1)} KiB  ·  largest ${biggest.file} ${(biggest.bytes / 1024).toFixed(1)} KiB`);

  if (degraded.length) {
    console.log(`\n[gen-traces] DEGRADED to diff mode (${degraded.length}) — over the display or byte cap:`);
    for (const d of degraded) console.log(`   ${d.path} L${d.level} — ${d.steps} steps, ${(d.bytes / 1024).toFixed(1)} KiB`);
  } else {
    console.log(`[gen-traces] degraded to diff mode: 0 — no golden exceeded the ${DISPLAY_STEP_CAP}-step display cap or the ${(BYTE_BUDGET / 1024 / 1024).toFixed(1)} MiB byte budget`);
  }

  if (emptyTraces.length) {
    console.log(`\n[gen-traces] EMPTY TRACES (${emptyTraces.length}) — plan §1 U3, these must never ship:`);
    for (const e of emptyTraces) console.log(`   ${e.path} L${e.level} — ${e.reason}`);
  } else {
    console.log(`[gen-traces] empty traces: 0 — every selfRecursive and class block emitted steps, so the region gate (K4) is not vacuous`);
  }

  if (uncovered.length) {
    console.log(`\n[gen-traces] UNCOVERED — no authored case source, so NO golden was written (never a stub): ${uncovered.length}`);
    for (const u of uncovered) console.log(`   ${u.path}\n      ${u.reason}`);
  }

  if (failures.length) {
    console.log(`\n[gen-traces] FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`   ${f.path}${f.level ? ` L${f.level}` : ''} — ${f.reason}`);
  }

  console.log(`\n[gen-traces] per-module case-count table:`);
  console.log('   module                        problems  covered  uncovered    cases');
  for (const row of table) {
    console.log(`   ${row.module.padEnd(28)} ${String(row.problems).padStart(8)} ${String(row.covered).padStart(8)} ${String(row.uncovered).padStart(10)} ${String(row.cases).padStart(7)}`);
  }

  if (failures.length) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

export { dedupedBlockSource, topLevelStatementTexts, missingDeclarations, main as runGenerator, stringify, IMPLEMENTED_CODECS, BLOCKS_PATH, harvestCases, readRuntimeTests, spyRewrite, loadBlocks };