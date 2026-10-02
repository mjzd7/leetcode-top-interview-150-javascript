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
import { getCodec, IMPLEMENTED_CODECS } from '../api/_lib/codecs.mjs';
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
function spyRewrite(script, targetNames = []) {
  let ast;
  try {
    ast = acorn.parse(script, { ecmaVersion: 2024, sourceType: 'script', locations: false });
  } catch (err) {
    return { code: script, rewritten: 0, targets: targetNames, error: `the authored script does not parse (${err.message})` };
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

  const edits = [];
  const rewrite = (callee, ctor) => {
    if (callee?.type !== 'Identifier') return;
    if (SPY_EXEMPT.has(callee.name)) return;
    const args = ctor ? `, 1` : '';
    edits.push({ start: callee.start, end: callee.end, text: `__SPY__(${JSON.stringify(callee.name)}, ${callee.name}${args})` });
  };
  walk.simple(ast, { CallExpression: (node) => rewrite(node.callee, false) });
  walk.simple(ast, { NewExpression: (node) => rewrite(node.callee, true) });
  let code = script;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  }
  return { code, rewritten: edits.length, targets: [...targets], error: null };
}

/** The spy `spyRewrite` emits calls to. Two slots: the first call to a TARGET, and the first
 *  call of any kind, used only when no target was called since the last assertion.
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
function __SPY__(name, target, isCtor) {
  return function () {
    var __isTarget = __TARGETS__.indexOf(name) !== -1;
    // Positional level-order evidence, collected for EVERY call in call order and BEFORE any
    // of the first-wins bookkeeping below. It has to sit here: a second arrayToTree([...])
    // arrives when __F__ is already occupied, so the guarded block below never runs for it —
    // which is exactly how isSameTree(A, B) lost its B.
    if (__TREE__ && __LE__(arguments[0])) __FL__.push([arguments[0]]);
    if (!__isTarget || __A__ === null) {
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
          if (__fixed !== null) {
            __A__ = __fixed; __AN__ = name;
          } else if (__TREE__ && __args !== null && !__LE__(__args[0]) && __F__ !== null && __LE__(__F__[0])) {
            // keep the level-order recording
          } else {
            __A__ = __args; __AN__ = name;
            if (__args === null) __TX__ = 1;
          }
        } else if (__F__ === null) {
          __F__ = __args; __FN__ = name;
        }
      }
    }
    if (__ASSERTERS__.indexOf(name) !== -1) {
      __CAP__.push({ label: arguments[2] === undefined ? null : String(arguments[2]), expected: arguments[1], args: __A__ !== null ? __A__ : __F__, callee: __A__ !== null ? __AN__ : __FN__, untransportable: __TX__ });
      __A__ = null; __AN__ = null; __F__ = null; __FN__ = null; __TX__ = 0; __FL__ = [];
    }
    if (isCtor) return Reflect.construct(target, Array.prototype.slice.call(arguments));
    return target.apply(this, arguments);
  };
}
`;

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
async function harvestCases(script, blocksByLevel, codec = null) {
  if (typeof script !== 'string' || script.trim() === '') {
    return { cases: [], reason: 'the authored script is empty' };
  }
  const spied = spyRewrite(script, blocksByLevel.map((b) => b.targetFn).filter(Boolean));
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
    `var __F__ = null;`,
    `var __FN__ = null;`,
    `var __TX__ = 0;`,
    `var __TREE__ = ${JSON.stringify(codec === 'tree')};`,
    `var __FL__ = [];`,
    `var __TARGETS__ = ${JSON.stringify(targets)};`,
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
    `  if (!Array.isArray(a)) return false;`,
    `  for (var i = 0; i < a.length; i++) {`,
    `    var v = a[i];`,
    `    if (Array.isArray(v)) { if (!__LE__(v)) return false; continue; }`,
    `    if (v !== null && typeof v === 'object') return false;`,
    `  }`,
    `  return true;`,
    `}`,
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
  for (const record of captured) {
    if (record.args === null || record.args === undefined) continue; // no block call before this assertion
    // The TARGET was called and its arguments could not be transported. `buildBundle` inlines
    // `JSON.stringify(tests)`, so a cyclic node graph has no form the driver can accept — and
    // recording the helper's arguments instead would trace a call the guide never documents.
    // Dropped, and counted, because a golden for a substituted input is not a golden.
    if (record.untransportable) { untransportable++; continue; }
    if (!Array.isArray(record.args)) { unserialisable++; continue; }
    const testCase = { name: record.label ?? `case${cases.length}`, args: record.args };
    // A void target returns nothing, and `buildBundle` compares `expected` through a
    // serialiser that renders an absent key as the string `'__undefined__'` — so ABSENT is the
    // honest encoding of "this function returns nothing", which is what the catalog's
    // `returnType: "void"` says. Copying the wrapper's post-state here instead would assert
    // that the target RETURNS the mutated array, which it does not.
    if (record.expected !== undefined) testCase.expected = record.expected;
    cases.push(testCase);
  }
  if (cases.length === 0) {
    return {
      cases: [],
      untransportable,
      reason: untransportable > 0
        ? `every assertion calls the target with an input that cannot be transported to the driver (${untransportable} cyclic/non-JSON argument lists). `
          + '`api/_lib/problems.mjs`\'s `buildBundle` marshals ONLY the `tree` codec — its own comment names row 17 as the fix — so a `list`/`graph` input (a node graph, or a cycle) has no form `JSON.stringify(tests)` can carry.'
        : 'no assertion in the authored script calls a function this block declares, so there is no input to trace',
    };
  }
  return { cases, unserialisable, untransportable };
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
export async function buildInstrumented(guidePath, level = 3) {
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
  const shared = missingDeclarations(source, siblings);

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
  const built = await buildInstrumented(guidePath, level);

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
  loadBlocks();

  fs.mkdirSync(TRACES_DIR, { recursive: true });

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

    for (const level of LEVELS) {
      const label = `${entry.path} L${level}`;
      try {
        const envelope = await traceOne(entry.path, level, {
          cases: source.cases,
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