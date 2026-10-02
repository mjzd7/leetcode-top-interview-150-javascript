/**
 * Runtime instrumenter — plan v5 §7 row 9, decisions K4/K5, ledger E10–E15/E18/E19,
 * invariants I1 (block-relative offsets) and I2 (a trace can never move a verdict).
 *
 *   node scripts/instrument.mjs                                   report over build/blocks.json
 *   node scripts/instrument.mjs 09-binary-tree-general/01-maximum-depth.md 3
 *
 * An AST WALK over `acorn` rewrites one solution block so every interesting statement inside
 * the target's region reports a step, runs the rewritten block under `vm.runInThisContext`, and
 * assembles an envelope v1.1 that `scripts/validate-envelope.mjs` ACCEPTS.
 *
 * ── THE ONE RULE THIS ROW EXISTS TO ENFORCE ────────────────────────────────────────────────
 *
 * **There is no depth logic.** No `depth++`, no call stack, no runtime region inference.
 *
 * A runtime depth counter suppresses a RECURSIVE target's own body on every recursive call
 * after the first. 102 of the 450 solution blocks are `selfRecursive`, so such a counter
 * yields an EMPTY trace for a fifth of the corpus and row 20's V11 non-vacuity assertion
 * would pass VACUOUSLY — a check that cannot fail is worse than no check (plan §1 U3, §6 E10).
 *
 * So region membership is READ, never derived. `scripts/gen-blocks.mjs` (row 7) computed it
 * STATICALLY into `build/blocks.json`'s `regionTable`: `depth 0` = the target plus every
 * function node lexically inside it (class methods, object-literal methods, getters, arrow
 * fields, IIFEs, callbacks — E11/E12/E15), `depth 1` = a same-block sibling, suppressed
 * (E13). This file aligns its own acorn walk to that table BY NAME and bakes each node's
 * integer into the probes it emits; the runtime compares it once
 * (`if (region !== 0) return;`) and does nothing else. A recursive self-call re-enters a
 * probe that was already baked `0`, so it emits — precisely what a counter cannot do.
 *
 * Measured on this corpus: the acorn walk reproduces row 7's depth sequence POSITIONALLY on
 * 449 of 450 blocks. The one exception is `20-trie/03-word-search-ii.md` L2, where row 7's
 * regex scanner read `new Map()` inside an object literal as an `object-method: Map` node that
 * acorn does not see. Name-alignment skips it, so no real node's depth is shifted — which is
 * the failure that would put a recursive target's own body at depth 1 and empty its trace.
 *
 * ── WHY acorn, given row 7 regex-scanned ───────────────────────────────────────────────────
 *
 * Because this row needs exact node identity to attach a probe to the right source range,
 * and because row 7's own `ponytail:` header names this file as its successor: "Row 9 swaps
 * this pass for an acorn walk and keeps every field name." The field names are kept.
 *
 * ── WHY THE PROBES ARE SOURCED, NOT WRITTEN ────────────────────────────────────────────────
 *
 * A probe's `text` is the block source sliced at the probe's own offset, so `text` can never
 * drift from `line.off` — they are one number read two ways. The trace runtime lives in the
 * runner's scope, never inside the rewritten block, so the emitted code is the guide's own
 * JavaScript plus `__T(...)` calls.
 *
 * ── WHY THE BLOCK RUNS IN THIS REALM, NOT A `vm` CONTEXT ───────────────────────────────────
 *
 * A `vm.createContext` context is a separate realm, so every value the traced code builds is a
 * different `Map`/`Set`/`BigInt` than the host's and row 6's serializer — which dispatches on
 * `v instanceof Map` — silently degrades them to `{}`. The first version of this file shipped a
 * live LRU map as `"this.map": {}`: a snapshot that was hollow in exactly the way plan §1 U5 and
 * ledger E5-E7 describe. Same realm is what makes `__map`, `__set`, `__bi` and the cycle `__ref`
 * table work at all. See `blockScript` for what replaces the isolation. *
 * ── CEILINGS, EACH WITH ITS UPGRADE PATH ─────────────────────────────────────────────────
 *
 * ponytail: every deliberate simplification, named here so a reader does not have to find it:
 *
 *  1. REGION MEMBERSHIP IS ALIGNED BY NAME, not by kind. Measured 449/450 blocks agree on row
 *     7's depth sequence; the one gap is a row-7 regex artifact. Upgrade when row 7 moves to
 *     acorn too (its own header names this row as the swap): then the table carries `start`
 *     offsets and the alignment becomes exact by construction, and the skip list disappears.
 *  2. A CONDITION IS EVALUATED ONCE, into a hoisted `__cN` temp, so the probe cannot change the
 *     answer (I2). Upgrade: nothing needed — this is the correct shape, not a simplification.
 *  3. AN OPERAND CARRYING A CALL IS DROPPED and reported on `droppedOperands` (1770 across the
 *     corpus, mostly `new Map()`, `x.has(k)`, `arr.sort(cmp)`). Reading it would run it twice.
 *     Upgrade with a measured need: hoist each leaf into a `__v` temp — exact, at one temp per
 *     operand per probe.
 *  4. THE SNAPSHOT THUNK IS EMITTED PER PROBE, so the instrumented block is larger than the
 *     guide's source. Upgrade: hoist a per-scope reader into a leading `const` — impossible
 *     today only because the reader must close over a method's parameters.
 *  5. SCOPE IS SHALLOW AND LEXICAL: the parameters and top-level bindings of each enclosing
 *     function or class. A `catch` parameter is seen only when the probe is inside its `catch`.
 *     Upgrade with a measured guide whose trace loses a value.
 *  6. `if (c) function f(){}` IS LEFT UNPROBED (0 of 450 blocks): bracing it would turn
 *     Annex-B var-hoisting into module block-scoping. Upgrade if a guide ever needs it.
 *  7. THE BLOCK RUNS IN THE HOST REALM inside an IIFE, for the serializer reason above.
 *     Upgrade the moment row 10's sandbox exists and can serialize in-realm.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

import { ROOT_DIR, selectSolutionBlocks } from './audit-curriculum.mjs';
import { blockHashOf, OUTPUT_PATH, GENERATOR } from './gen-blocks.mjs';
import { serialize, stringify } from './lib/serialize.mjs';
import { validateEnvelope, SCHEMA_VERSION } from './validate-envelope.mjs';

export const GENERATOR_NAME = 'scripts/instrument.mjs';

/** Acorn options. `ecmaVersion: 2022` is the repo's Node-20 floor plus class fields. */
const ACORN_OPTIONS = { ecmaVersion: 2022, locations: true };

/** The node types that open a K4 region. A class counts: its whole body is its region. */
const REGION_NODES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ClassDeclaration', 'ClassExpression',
]);

/**
 * How many hoisted condition temps a block may use. One per nesting level of `if`/loop, because
 * `while (__c0 = (t)) { while (__c0 = (u)) {…} }` would clobber the outer test. 32 is far above
 * anything the corpus needs (measured max nesting in the 450 blocks: 3); ponytail: raise it with
 * a measured guide that nests deeper, and `COND_TEMPS` is the only number to change.
 */
const COND_TEMPS = 32;

/** Step types, named exactly as `docs/trace-schema.json` names them. */
const STEP_TYPES = {
  decl: 'decl', assign: 'assign', if: 'if-test', loop: 'loop-head', loopBack: 'loop-back',
  call: 'call', ret: 'return', exit: 'exit', throw: 'throw',
};

// ---------------------------------------------------------------------------
// The runtime. Placed in the runner's scope, NOT emitted into the block, so the instrumented
// source stays the guide's own JavaScript plus `__T(...)` calls and remains diffable.
//
// K4 is the FIRST LINE of `__T`: one integer, compared once. Everything after it is
// snapshotting. There is no counter to increment and no stack to consult, so re-entering
// `__T` on a recursive self-call costs exactly what the first call cost.
export const TRACE_RUNTIME = `
var __TRACE__ = { n: 0, steps: [], error: null };
function __T(region, off, type, text, operandsThunk, snapThunk, cond) {
  if (region !== 0) return;                 // K4: the entire region gate is this one comparison
  var s = __TRACE__;
  var operands = {};
  if (operandsThunk) {
    // Two reasons this is a thunk rather than an object literal. It is LAZY, so a suppressed
    // (depth 1) region never evaluates anything — that is where the laziness of K4 pays off.
    // And it is GUARDED, so a probe can never break the program it measures: a probe inside a
    // region that has not finished initialising reads a binding that does not exist yet, and
    // an unguarded read threw a ReferenceError that killed the run and truncated the trace (G3).
    try { operands = operandsThunk() || {}; } catch (e) { operands = {}; }
  }
  s.steps.push({
    n: ++s.n,
    line: { h: __H__, off: off },
    type: type,
    text: text,
    operands: operands,
    cond: cond === undefined ? null : cond,
    snap: snapThunk ? snapThunk() : null,
    delta: [],
    out: '',
    override: null
  });
}
`;

/** Every binding a `pattern` introduces, at any depth (`{a, b: [c]}`, `...rest`). */
function boundNames(pattern, into) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier': into.add(pattern.name); return;
    case 'AssignmentPattern': boundNames(pattern.left, into); return;
    case 'RestElement': boundNames(pattern.argument, into); return;
    case 'ArrayPattern': for (const e of pattern.elements) boundNames(e, into); return;
    case 'ObjectPattern': for (const p of pattern.properties) boundNames(p.value ?? p.argument, into); return;
    default: return;
  }
}

/**
 * `walk.simple(root, visitors)` — dispatch by node type over a subtree.
 *
 * NOT `walk.full`: that one is `(node, callback, baseVisitor, state)`, so its THIRD argument is
 * the walker TABLE, and handing it a type dispatch throws "No walker function defined for node
 * type" from the middle of the walk. Named once here so the shape is not re-derived.
 */

/** `true` for `this.<field> = …`, the one assignment whose target IS a binding. */
function isThisFieldAssign(n) {
  return n.left && n.left.type === 'MemberExpression' && !n.left.computed
    && n.left.object.type === 'ThisExpression' && n.left.property.type === 'Identifier';
}

/**
 * The bindings a region node introduces to its own body: its parameters, plus everything
 * declared at the TOP LEVEL of its body (function declarations hoist, so a recursive helper is
 * visible from its own body), plus every `this.<field>` it assigns anywhere in its subtree
 * (a class's fields are visible in all of its methods).
 *
 * Memoized per node: computing it walks the subtree, and the corpus sweep calls this for every
 * probe of all 450 blocks.
 */
const hoistedCache = new WeakMap();
function hoistedIn(node) {
  const hit = hoistedCache.get(node);
  if (hit) return hit;
  const names = new Set();
  if (node.id && node.id.name) names.add(node.id.name);
  for (const param of node.params || []) boundNames(param, names);
  const body = node.body;
  if (body && body.type === 'BlockStatement') {
    for (const st of body.body) {
      // ESTree calls the list `declarations` (`const a = 1, b = 2` has two).
      if (st.type === 'VariableDeclaration') for (const d of st.declarations) boundNames(d.id, names);
      else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) names.add(st.id.name);
    }
  }
  // ponytail: one eager subtree walk per region node, memoized by `hoistedCache`. A class's
  // fields are visible in all of its methods, so `this.map` stays readable from `get`; the
  // cost is one walk per region node per block, not one per probe.
  const fields = new Set();
  walk.simple(body || node, {
    AssignmentExpression(n) { if (isThisFieldAssign(n)) fields.add(`this.${n.left.property.name}`); },
  });
  const result = { names, fields };
  hoistedCache.set(node, result);
  return result;
}

/**
 * The bindings visible at a probe, per the shallow lexical rule.
 *
 * `chain` is the acorn ancestor chain, root first. Walking it UPWARD collects the parameters
 * and top-level bindings of every enclosing function or class, which is what makes `this.map`
 * visible in `get` and a closure's parameter visible inside a nested callback. Then one
 * downward walk over the statement itself adds what it declares — a `decl` probe runs AFTER its
 * own declaration, so `const right = …` must already read back.
 */
function scopeFor(node, chain) {
  const names = new Set();
  for (const anc of chain || []) {
    if (!REGION_NODES.has(anc.type)) continue;
    const h = hoistedIn(anc);
    for (const n of h.names) names.add(n);
    for (const n of h.fields) names.add(n);
  }
  walk.simple(node, {
    VariableDeclarator(n) { boundNames(n.id, names); },
    FunctionDeclaration(n) { if (n.id) names.add(n.id.name); },
    ClassDeclaration(n) { if (n.id) names.add(n.id.name); },
    CatchClause(n) { boundNames(n.param, names); },
    AssignmentExpression(n) { if (isThisFieldAssign(n)) names.add(`this.${n.left.property.name}`); },
  });
  return names;
}

// ---------------------------------------------------------------------------
// Operands (I5).
//
// §5 pins the shape: keyed by the expression AS WRITTEN (`nums[left]`, `seen.get(complement)`,
// `2`). So keys are source slices of the probe's own expression and values are those same
// slices evaluated in place — never a re-spelling that could disagree with the guide.
//
// A key is EMITTED only when every binding it names is in the manifest's `watch` or is a
// literal, checked with the same rule `scripts/validate-envelope.mjs` uses (a `.` makes the
// next identifier a property, not a binding). An operand we cannot capture is not an operand:
// emitting it would render a plausible value with nothing behind it, which is the shape of
// every CI guard in the plan. Dropped keys are reported on `instrumentBlock().droppedOperands`.
//
// A leaf that would RUN something is not emitted. The probe reads each leaf a second time, and
// a second call is exactly the hazard invariant I2 exists to prevent: a guide helper with a
// side effect would change the answer the traced run computes. So a call-bearing operand is
// DROPPED and reported on `droppedOperands` — an operand we cannot capture is not an operand
// (see the I5 note above). ponytail: the operand set is the probe expression's LEAF atoms.
// Ceiling: `seen.get(complement)` is dropped for carrying a call, so the map/set guides (64 of
// them) lose their most informative operand. Upgrade with a measured need: hoist the leaf into
// a __v temp so it is evaluated once, which is exact but needs one temp per operand per probe.
const IMPURE_LEAF = new Set(['CallExpression', 'NewExpression', 'AssignmentExpression', 'UpdateExpression',
  'TaggedTemplateExpression', 'AwaitExpression', 'YieldExpression', 'DeleteExpression']);

function isPure(node) {
  let impure = false;
  walk.simple(node, Object.fromEntries([...IMPURE_LEAF].map((t) => [t, () => { impure = true; }])));
  return !impure;
}

function leafOperands(node, source) {
  const leaves = [];
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'BinaryExpression':
      case 'LogicalExpression':
        visit(n.left); visit(n.right); return;
      case 'ConditionalExpression':
        visit(n.test); visit(n.consequent); visit(n.alternate); return;
      case 'SequenceExpression':
        for (const e of n.expressions) visit(e); return;
      case 'AssignmentExpression':
        visit(n.right); return;
      case 'UpdateExpression':
        visit(n.argument); return;
      default:
        leaves.push({ node: n, text: source.slice(n.start, n.end) });
    }
  };
  visit(node);
  const seen = new Set();
  return leaves.filter((l) => {
    if (!l.text || seen.has(l.text)) return false;
    seen.add(l.text);
    return true;
  });
}

/** The bindings an operand key names, using row 5's rule verbatim. */
const OPERAND_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this']);

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

/** Splices text at source offsets, right to left, so earlier offsets stay valid. */
function splice(source, edits) {
  const sorted = [...edits].sort((a, b) => (b.at - a.at) || (b.order - a.order));
  let out = source;
  // `end == null` (loose) because an append-only edit carries no `end` at all, and a strict
  // `=== null` test would slice from `undefined` and truncate the block to nothing.
  for (const e of sorted) out = out.slice(0, e.at) + e.text + out.slice(e.end == null ? e.at : e.end);
  return out;
}

// ---------------------------------------------------------------------------
// Region alignment (K4). Read the table; never recompute it.

/** A region's name, resolved the way row 7 resolves it, so the alignment can compare names. */
function nodeName(node, ancestors) {
  if (node.id && node.id.name) return node.id.name;
  const parent = ancestors[ancestors.length - 2];
  if (!parent) return null;
  // `Property` is an object-literal member; `MethodDefinition` and `PropertyDefinition` are the
  // two class-member shapes, and acorn emits the latter for `bump = (by) => …`.
  if ((parent.type === 'MethodDefinition' || parent.type === 'Property' || parent.type === 'PropertyDefinition') && parent.key) {
    return parent.key.name ?? parent.key.value ?? null;
  }
  if (parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') return parent.id.name;
  if (parent.type === 'AssignmentExpression' && parent.left && parent.left.type === 'Identifier') return parent.left.name;
  return null;
}

/** The innermost region node enclosing a node in `chain`, or null at the block's top level. */
function enclosingRegion(chain) {
  for (let i = chain.length - 2; i >= 0; i--) {
    if (REGION_NODES.has(chain[i].type)) return chain[i];
  }
  return null;
}

const norm = (n) => (typeof n === 'string' ? n.replace(/^['"`]|['"`]$/g, '') : n);

function alignRegions(entry, ast) {
  const walked = [];
  walk.ancestor(ast, Object.fromEntries([...REGION_NODES].map((type) => [type, (node, state, ancestors) => {
    walked.push({ node, name: norm(nodeName(node, ancestors)) });
  }])));
  // ponytail: acorn-walk's `ancestor` is POST-order (it walks children before calling the
  // callback), which would list `value` before `compute` — and a mis-ordered alignment shifts
  // every subsequent depth by one, the failure that puts a recursive target's own body at
  // depth 1 and empties its trace. Region nodes are totally ordered by `start` (a nested one
  // starts after its enclosing one, a sibling after the previous), so sorting by it IS
  // document order, which is the order row 7 emitted its table in.
  walked.sort((a, b) => a.node.start - b.node.start);

  const table = Array.isArray(entry.regionTable) ? entry.regionTable : [];
  const regionOf = new Map();
  const skipped = [];
  let i = 0;
  let j = 0;
  while (i < table.length && j < walked.length) {
    if (norm(table[i].name) === walked[j].name) {
      Object.assign(walked[j], { depth: table[i].depth, kind: table[i].kind, regionIndex: i });
      regionOf.set(walked[j].node, walked[j]);
      i += 1; j += 1;
      continue;
    }
    // Does this table row match anything acorn sees LATER? If not, row 7 saw a node this
    // parser does not have (the `new Map()` artifact) and the row is skipped — never allowed
    // to consume a real node's depth, because one shifted depth puts a recursive target's
    // own body at 1 and empties its trace. That is the bug K4 exists to prevent.
    if (!walked.slice(j).some((c) => c.name === norm(table[i].name))) {
      skipped.push({ name: table[i].name, kind: table[i].kind, reason: 'no matching node in the acorn walk (a row 7 regex artifact)' });
      i += 1;
      continue;
    }
    // acorn sees a node row 7 has no row for. depth 1 (suppressed) rather than an invented
    // depth: a suppressed region is a visible gap, a fabricated one is a lie.
    Object.assign(walked[j], { depth: 1, kind: 'unmatched', regionIndex: -1 });
    regionOf.set(walked[j].node, walked[j]);
    j += 1;
  }
  for (; j < walked.length; j++) {
    Object.assign(walked[j], { depth: 1, kind: 'unmatched', regionIndex: -1 });
    regionOf.set(walked[j].node, walked[j]);
  }
  for (; i < table.length; i++) {
    skipped.push({ name: table[i].name, kind: table[i].kind, reason: 'no matching node in the acorn walk (a row 7 regex artifact)' });
  }
  return { regionOf, walked, skipped };
}

// ---------------------------------------------------------------------------
// The walk: decide where probes go.

export function instrumentBlock(source, entry) {
  if (typeof source !== 'string' || !entry || typeof entry !== 'object') {
    throw new Error(`instrumentBlock: needs (source: string, entry: object) — got ${typeof source}, ${typeof entry}`);
  }
  const where = `${entry.path || '(fixture)'} L${entry.level ?? '?'}`;

  // E19/K5: a manifest entry that no longer describes this source is a NAMED failure. The
  // hash IS the identity, so this is the one check that catches a guide edited after the
  // manifest was generated — before a single probe is placed.
  const actualHash = blockHashOf(source);
  if (entry.blockHash && entry.blockHash !== actualHash) {
    throw new Error(
      `instrumentBlock: blockHash is stale for ${where} — the manifest says ${entry.blockHash} but this source `
      + `hashes to ${actualHash}. Regenerate it with \`node ${GENERATOR}\`.`,
    );
  }
  const lines = source.split('\n');
  if (entry.blockLines != null && entry.blockLines !== lines.length) {
    throw new Error(
      `instrumentBlock: blockLines is stale for ${where} — the manifest says ${entry.blockLines} but this source `
      + `has ${lines.length} line(s). Regenerate it with \`node ${GENERATOR}\`.`,
    );
  }
  if (!entry.targetFn) {
    throw new Error(`instrumentBlock: ${where} has no targetFn in the manifest — row 7 could not derive one. Regenerate with \`node ${GENERATOR}\`.`);
  }

  let ast;
  try {
    ast = acorn.parse(source, ACORN_OPTIONS);
  } catch (err) {
    throw new Error(`instrumentBlock: ${where} does not parse — ${err.message}`);
  }

  const { regionOf, walked, skipped } = alignRegions(entry, ast);
  const watch = new Set(entry.watch || []);
  const edits = [];
  const probes = [];
  const droppedOperands = new Set();
  let order = 0;

  /**
   * The snapshot thunk source for one probe, emitted AT THE PROBE SITE.
   *
   * It cannot be a shared module-level function: `watch` names are block-wide, so a probe
   * inside `put(key, value)` has to read THAT method's parameters, and only an arrow created
   * at the call site can see them — and can see the method's `this` without being handed it.
   *
   * ponytail: it is emitted per probe rather than deduplicated per scope, because a shared
   * reader is what made `key`/`value` read as `undefined` in the first version. Ceiling: the
   * emitted block is larger than the guide's own source (a few lines per probe). Upgrade by
   * hoisting a per-scope reader into a leading `const` when a measured block needs it —
   * impossible today only because the reader must close over the method's parameters.
   */
  const snapThunkSource = (node, chain) => {
    const visible = scopeFor(node, chain);
    const names = (entry.watch || []).filter((n) => visible.has(n));
    const lines = ['var o = {};'];
    for (const name of names) {
      lines.push(`try { o[${JSON.stringify(name)}] = ${name}; } catch (e) { o[${JSON.stringify(name)}] = undefined; }`);
    }
    lines.push('return o;');
    return `() => { ${lines.join(' ')} }`;
  };

  const lineOff = (node) => node.loc.start.line - 1; // 0-based, BLOCK-relative (K5)
  const lineText = (node) => (lines[lineOff(node)] ?? '').trim() || 'step';

  /** The depth the TABLE gave the region owning a node; depth 1 at the block's top level. */
  const regionFor = (chain) => {
    const owner = enclosingRegion(chain);
    if (!owner) return { depth: 1, name: '(block top level)', kind: 'block', regionIndex: -1 };
    return regionOf.get(owner) || { depth: 1, name: '(unmatched)', kind: 'unmatched', regionIndex: -1 };
  };

  /**
   * Place one probe.
   *
   * A step that RECORDS a decision (`if-test`, `loop-head`) REPLACES the condition expression:
   * the condition is evaluated into a temp, the probe reads that temp, and the construct branches
   * on the same temp — evaluated EXACTLY ONCE. That matters because a condition can carry a call
   * (`if (canJump(nums, i + 1))` — 21 of the 450 blocks do), and evaluating it a second time for
   * the probe is precisely the I2 hazard: the traced run could compute something the raw run never
   * did. Prepending the probe instead of replacing leaves the construct reading the original test,
   * which is the bug this shape exists to prevent.
   *
   * Every other step type APPENDS a statement, which cannot touch the value the program computes.
   */
  const emit = ({ at, end = null, hoist = null, region, off, type, text, enclosing, kind, regionIndex, operands, cond, node, chain }) => {
    // I1: never place a probe whose offset falls outside its own block.
    if (!Number.isInteger(off) || off < 0 || off >= lines.length) return;
    const entries = [];
    for (const leaf of leafOperands(operands, source)) {
      if (!isPure(leaf.node) || [...operandBindings(leaf.text)].some((b) => !watch.has(b))) {
        droppedOperands.add(leaf.text);
        continue;
      }
      entries.push(`${JSON.stringify(leaf.text)}: (${leaf.text})`);
    }
    probes.push({ region, off, type, text, enclosing, regionKind: kind, regionIndex });
    // `null` operands for a step with no decision to record (decl/assign/exit/loop-back); a
    // thunk otherwise, because __T evaluates it lazily and inside a guard.
    const opsThunk = entries.length === 0 ? 'null' : `() => ({ ${entries.join(', ')} })`;
    const call = `__T(${region}, ${off}, ${JSON.stringify(type)}, ${JSON.stringify(text)}, ${opsThunk}, ${snapThunkSource(node, chain)}${cond === undefined ? '' : `, ${cond}`})`;
    edits.push({
      at,
      end,
      order: order++,
      text: hoist ? `(${hoist}, ${call}, ${cond})` : `${call};`,
    });
  };

  /**
   * The hoisted temp index for a control construct: how many `if`/loop constructs already enclose
   * it. Two constructs at the same level get the same index, which is safe because they are
   * sequential; a nested one gets a fresh index, which is what stops an inner loop from
   * overwriting the outer loop's test.
   */
  const condTemp = (node, chain) => {
    let depth = 0;
    for (const anc of chain) {
      if (anc === node) break;
      if (anc.type === 'IfStatement' || anc.type.endsWith('Statement') || anc.type.endsWith('Expression')) {
        if (/^(If|While|DoWhile|For|Do)/.test(anc.type)) depth += 1;
      }
    }
    return `__c${Math.min(depth, COND_TEMPS - 1)}`;
  };

   /**
   * `{ … }` around a statement that is the UNBRACED body of an `if`/`else`/loop.
   *
   * This is not cosmetic. `if (node === null) return 0;` with a probe spliced before the
   * `return` becomes `if (node === null) __T(…); return 0;` — the probe REPLACES the body and
   * the `return` runs unconditionally, which silently truncates the trace (and, for an
   * early return, changes the guide's own answer — invariant I2). Bracing restores it, and
   * bracing is equivalent: a `let`/`const` in an `if` body is already scoped to that body.
   *
   * A FunctionDeclaration is EXEMPT: `if (c) function f(){}` is Annex-B sloppy-mode
   * var-hoisting, and `if (c) { function f(){} }` is block-scoped in a module. Measured 0 of
   * these in the 450 blocks; rather than risk it, such a body is left unprobed.
   */
  function canBrace(stmt) {
    return stmt.type !== 'FunctionDeclaration' && stmt.type !== 'ClassDeclaration';
  }

  // The opening brace goes in first and the CLOSING brace goes in LAST, after the probes.
  // Order matters: a probe spliced at `stmt.end` shares an offset with the closing brace, and
  // `if (c) { ... } __T(...); else ...` does not parse — the call lands between the consequent
  // and the `else` that belongs to it.
  const openBrace = (stmt) => edits.push({ at: stmt.start, text: '{', order: order++ });
  const closeBrace = (stmt) => edits.push({ at: stmt.end, text: '}', order: order++ });

  walk.ancestor(ast, {
    Program(node, state, ancestors) {
      for (const stmt of node.body) statement(stmt, [node, ...ancestors]);
    },
    BlockStatement(node, state, ancestors) {
      for (const stmt of node.body) statement(stmt, [node, ...ancestors]);
    },
    SwitchCase(node, state, ancestors) {
      for (const stmt of node.consequent) statement(stmt, [node, ...ancestors]);
    },
    // `exit` — a region node that falls off the end of its body rather than returning.
    ...Object.fromEntries([...REGION_NODES].map((type) => [type, exit])),
  });

  function exit(node, state, ancestors) {
    const body = node.body;
    if (!body || body.type !== 'BlockStatement') return; // an expression-bodied arrow has no block
    const r = regionOf.get(node);
    if (!r) return;
    const last = body.body[body.body.length - 1];
    if (!last || last.type === 'ReturnStatement' || last.type === 'ThrowStatement') return;
    emit({
      at: body.end - 1, // immediately before the closing brace
      region: r.depth, off: lineOff(node), type: STEP_TYPES.exit, text: lineText(node),
      enclosing: r.name, kind: r.kind, regionIndex: r.regionIndex, operands: null, node, chain: ancestors,
    });
  }

  /**

  /** Instrument `stmt` when it is a control statement's unbraced body, bracing it first. */
  function subStatement(stmt, chain) {
    if (!stmt || stmt.type === 'BlockStatement' || !canBrace(stmt)) return;
    openBrace(stmt);
    statement(stmt, chain);
    closeBrace(stmt);
  }

  /**
   * The `else` arm, and the `else if` chain with it.
   *
   * An `else if` IS instrumented, and it used to be a syntax error: the probe was appended as a
   * statement at the nested `if`'s offset, and there is nothing between `else` and `if` for a
   * statement to sit in — `else __T(…); if (…)` does not parse. Replacing the CONDITION instead
   * of prepending a call fixes it: `else if ((__c0 = (t), __T(…), __c0))` is a single statement,
   * and each link of the chain gets its own `if-test` probe.
   *
   * Every link shares one `__cN` temp (they are siblings, so `condTemp` gives them the same
   * depth), which is safe because they are sequential: the outer `if` has already branched by
   * the time the next link runs.
   */
  function alternate(alt, chain) {
    if (!alt || alt.type === 'BlockStatement') return;
    if (alt.type === 'IfStatement') { statement(alt, chain); return; }
    subStatement(alt, chain);
  }

  function statement(stmt, chain) {
    const r = regionFor(chain);
    const base = { region: r.depth, off: lineOff(stmt), enclosing: r.name, kind: r.kind, regionIndex: r.regionIndex };

    switch (stmt.type) {
      case 'VariableDeclaration':
        emit({ ...base, at: stmt.end, type: STEP_TYPES.decl, text: lineText(stmt), operands: null, node: stmt, chain });
        return;
      case 'ExpressionStatement': {
        const e = stmt.expression;
        if (e.type === 'AssignmentExpression') {
          emit({ ...base, at: stmt.end, type: STEP_TYPES.assign, text: lineText(stmt), operands: e.right, node: stmt, chain });
        } else if (e.type === 'CallExpression') {
          emit({ ...base, at: stmt.start, type: STEP_TYPES.call, text: lineText(stmt), operands: e, node: stmt, chain });
        }
        return;
      }
      case 'IfStatement': {
        const temp = condTemp(stmt, chain);
        emit({
          ...base, at: stmt.test.start, end: stmt.test.end, type: STEP_TYPES.if, text: lineText(stmt),
          operands: stmt.test, cond: temp, node: stmt, chain,
          hoist: `${temp} = (${source.slice(stmt.test.start, stmt.test.end)})`,
        });
        // An unbraced body is not a BlockStatement, so nothing else would walk it.
        subStatement(stmt.consequent, chain);
        alternate(stmt.alternate, chain);
        return;
      }
      case 'ReturnStatement':
        emit({ ...base, at: stmt.start, type: STEP_TYPES.ret, text: lineText(stmt), operands: stmt.argument || null, node: stmt, chain });
        return;
      case 'ThrowStatement':
        emit({ ...base, at: stmt.start, type: STEP_TYPES.throw, text: lineText(stmt), operands: stmt.argument || null, node: stmt, chain });
        return;
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForOfStatement':
      case 'ForInStatement':
        loop(stmt, base, chain);
        return;
      default:
        return;
    }
  }

  /**
   * A loop gets a `loop-head` (its condition, read ONCE into `cond`) and a `loop-back` at the
   * end of its body. Reading the test into `cond` is what keeps I2 honest: re-evaluating it
   * for the probe would double a side-effecting test and move the guide's own answer.
   */
  function loop(stmt, base, chain) {
    const test = stmt.test || null;
    const temp = condTemp(stmt, chain);
    emit({
      ...base,
      at: test ? test.start : stmt.start, end: test ? test.end : null,
      type: STEP_TYPES.loop, text: lineText(stmt), operands: test,
      cond: test ? temp : undefined, node: stmt, chain,
      hoist: test ? `${temp} = (${source.slice(test.start, test.end)})` : null,
    });
    const body = stmt.body;
    if (body.type === 'BlockStatement') {
      emit({ ...base, at: body.end - 1, type: STEP_TYPES.loopBack, text: lineText(stmt), operands: null, node: body, chain });
      return;
    }
    // An unbraced loop body: brace it so the `loop-back` lands INSIDE the body and fires per
    // iteration. Without the braces it would fire once, after the loop.
    if (canBrace(body)) {
      emit({ ...base, at: body.end, type: STEP_TYPES.loopBack, text: lineText(stmt), operands: null, node: body, chain });
      openBrace(body);
      statement(body, chain);
      closeBrace(body);
    }
  }

  return {
    code: splice(source, edits),
    source, // the UNINSTRUMENTED block, so I2 can compare against it
    probes,
    hash: actualHash,
    droppedOperands: [...droppedOperands].sort(),
    regionGate: {
      d0: walked.filter((w) => w.depth === 0).map((w) => ({ name: w.name, kind: w.kind, region: w.depth })),
      d1: walked.filter((w) => w.depth === 1).map((w) => w.name),
      skipped,
      depthLogic: 'none — every probe carries the integer build/blocks.json gave it; the runtime compares it once',
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest access. `build/blocks.json` is generated and gitignored, so a missing file is a
// NORMAL state for a fresh clone, not a bug: it must name the command that fixes it.

/** The one place that reads build/blocks.json. Throws a NAMED error, never a bare ENOENT. */
export function loadManifest() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    throw new Error(
      `loadManifest: ${path.relative(ROOT_DIR, OUTPUT_PATH)} is missing — it is generated and gitignored, not committed. `
      + `Run \`node ${GENERATOR}\` to create it, then re-run.`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(
      `loadManifest: ${path.relative(ROOT_DIR, OUTPUT_PATH)} is unreadable (${err.message}) — regenerate it with \`node ${GENERATOR}\`.`,
    );
  }
}

/** One block's manifest entry, or null. Keyed by PATH (plan §8 invariant 1, E30). */
export function blockEntry(manifest, guidePath, level) {
  const blocks = Array.isArray(manifest?.blocks) ? manifest.blocks : [];
  return blocks.find((b) => b.path === guidePath && b.level === level) ?? null;
}

/** Re-read one block's source from its guide, via row 0's pinned K7 predicate. */
export function readBlockSource(guidePath, level) {
  const file = path.join(ROOT_DIR, guidePath);
  if (!fs.existsSync(file)) throw new Error(`readBlockSource: guide ${guidePath} does not exist under ${ROOT_DIR}`);
  const selected = selectSolutionBlocks(fs.readFileSync(file, 'utf-8')).find((s) => s.level === level);
  if (!selected) throw new Error(`readBlockSource: ${guidePath} selects no Level ${level} solution block — the K7 predicate found none.`);
  return selected.code;
}

/** Manifest entry + re-read source + instrumented code for one guide level, in one call. */
export function instrumentGuideBlock(guidePath, level, manifest = loadManifest()) {
  const entry = blockEntry(manifest, guidePath, level);
  if (!entry) {
    throw new Error(`instrumentGuideBlock: ${guidePath} L${level} is not in the manifest — regenerate it with \`node ${GENERATOR}\`.`);
  }
  const source = readBlockSource(guidePath, level);
  return { entry, source, instrumented: instrumentBlock(source, entry) };
}

// ---------------------------------------------------------------------------
// Running a block, traced and untraced.
//
// The block runs through `vm.runInThisContext` INSIDE AN IIFE, and the choice is load-bearing:
// a `vm.createContext` context is a SEPARATE REALM, so every value the traced code creates is a
// different `Map`/`Set`/`ArrayBuffer` than the host's. Row 6's serializer dispatches on
// `v instanceof Map`, which is false across a realm boundary — the first version emitted
// `"this.map": {}` for a live LRU map, i.e. a snapshot that was hollow in exactly the way plan
// §1 U5 and ledger E5-E7 describe. Same realm is what makes `__map`, `__set`, `__bi` and the
// cycle `__ref` table work at all.
//
// The IIFE is the isolation that remains: every run gets fresh function-scoped declarations, so
// the traced run and the raw run that reports its verdict share no bindings (I2), and nothing
// leaks into this module's realm. ponytail: this is the same realm as the test process, so a
// solution block that reached for `process` or `globalThis` would be visible here. Measured 0 in
// the 450 blocks, and row 12's sandbox is where untrusted-shaped code belongs — owner decision 5
// keeps the instrumenter pointed at repo files only.

/** The script that runs one block in one shape (traced or raw) and hands back its trace. */
function blockScript(source, entry, drive, traced) {
  const globals = [
    `var __H__ = ${JSON.stringify(entry.blockHash)};`,
    // The hoisted condition temps live here, not in the block: the instrumented code stays the
    // guide's own JavaScript plus __T(...) calls, so a diff of it is still readable.
    `var ${Array.from({ length: COND_TEMPS }, (_, i) => `__c${i}`).join(', ')};`,
    traced ? TRACE_RUNTIME : 'var __TRACE__ = { n: 0, steps: [], error: null };',
  ];
  return new vm.Script(`(function () {
  ${globals.join('\n  ')}
  ${source}
  var __rec = {};
  var __err = null;
  try {
    // The drive runs where the block's own top-level declarations are in scope — which is how
    // E13 proves the suppressed helper really executed.
    (${drive.toString()})(${entry.targetFn}, __rec);
  } catch (e) { __err = e; }
  // G3: a throw is RETURNED, not propagated. Letting it escape would discard the steps already
  // captured, which is the silent truncation plan §1 U3 is about.
  return { rec: __rec, trace: __TRACE__, error: __err };
})()`, { filename: `${entry.path || 'block'}#L${entry.level}` });
}

/**
 * Run the UNINSTRUMENTED block. This is where the verdict comes from — plan §5 invariant 2:
 * a trace can never move a verdict, so the verdict is produced by a run with no probes in it,
 * and the traced run contributes steps and nothing else.
 */
export function runRaw(source, entry, drive) {
  let r = { rec: { result: undefined }, trace: { n: 0, steps: [] }, error: null };
  try {
    r = blockScript(source, entry, drive, false).runInThisContext();
  } catch (err) {
    r.error = err; // the block itself failed to load
  }
  return {
    result: r.rec.result,
    error: r.error ? String(r.error.message ?? r.error) : null,
    verdict: { passed: r.error ? 0 : 1, failed: r.error ? 1 : 0 },
  };
}

/** Narration + the D2 delta (only the fields that CHANGED against the previous step). */
function finishSteps(steps) {
  let prev = null;
  for (const step of steps) {
    if (prev) {
      for (const key of Object.keys(step.snap).sort()) {
        if (stringify(step.snap[key]) !== stringify(prev.snap[key])) {
          step.delta.push({ path: key, from: prev.snap[key], to: step.snap[key] });
        }
      }
    }
    const cond = step.cond === null ? '' : ` → ${step.cond}`;
    // row 6's `stringify`, never `JSON.stringify`: a watched value is routinely cyclic (a
    // doubly linked list, plan §6 E7) and plain JSON throws on the cycle mid-run.
    const moved = step.delta.map((d) => `${d.path} → ${stringify(d.to)}`).join(', ');
    step.out = `Step ${step.n}: ${step.type} ${step.text}${cond}${moved ? ` (${moved})` : ''}`;
    prev = step;
  }
  return steps;
}

/**
 * Run the INSTRUMENTED block, flush whatever it captured, and return a VALIDATED envelope v1.1.
 *
 * G3: a throw does NOT discard the trace. Steps already captured survive, `error` names the
 * failure, and `result` is null — §5 documents exactly that case for `result`.
 */
export function runTraced(instrumented, entry, drive, opts = {}) {
  let r = { rec: { result: undefined }, trace: { n: 0, steps: [] }, error: null };
  try {
    r = blockScript(instrumented.code, entry, drive, true).runInThisContext();
  } catch (err) {
    r.error = err; // the instrumented block itself failed to load
  }
  const raw = runRaw(instrumented.source, entry, drive); // I2: the verdict is the RAW run's

  const steps = finishSteps(r.trace.steps).map((step) => ({
    ...step,
    snap: serialize(step.snap),
    delta: step.delta.map((d) => ({ path: d.path, from: serialize(d.from), to: serialize(d.to) })),
  }));

  return buildEnvelope({
    path: opts.path || entry.path || '(fixture)',
    level: opts.level ?? entry.level ?? 3,
    entry,
    traced: { steps, stepCount: r.trace.n },
    result: r.error ? null : r.rec.result,
    verdict: raw.verdict,
    error: r.error ? String(r.error.message ?? r.error) : null,
  });
}

/**
 * Assemble an envelope v1.1 and VALIDATE it against row 5's validator.
 *
 * The validation is not optional here: rows 10/11/12 consume this file's output, so an
 * envelope this file cannot validate is a defect HERE, not at row 12. Throwing names the
 * invariants, which is what makes the failure actionable at the point it was created.
 */
export function buildEnvelope({ path: guidePath, level, entry, traced, result, verdict, error = null }) {
  const envelope = {
    v: SCHEMA_VERSION,
    path: guidePath,
    level,
    fnName: entry.targetFn,
    codec: entry.codec,
    block: { hash: entry.blockHash, startLine: entry.blockOffset, lines: entry.blockLines },
    watch: entry.watch,
    steps: traced.steps,
    result: result === undefined ? null : serialize(result),
    verdict,
    truncated: { execution: false, display: false, trace: false },
    budget: { bytes: 0, mode: 'full', chunks: 1 },
    stepCount: traced.stepCount,
    error,
  };
  envelope.budget.bytes = Buffer.byteLength(stringify(envelope), 'utf8');
  const res = validateEnvelope(envelope);
  if (!res.isValid) {
    throw new Error(
      `buildEnvelope: ${guidePath} L${level} produced an envelope row 5 rejects — ${res.errors.length} error(s):\n  `
      + res.errors.slice(0, 6).join('\n  '),
    );
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// CLI: report over the whole manifest, or print one block's instrumented source.

function report() {
  const manifest = loadManifest();
  let probes = 0, d0 = 0, d1 = 0, skipped = 0, dropped = 0;
  const skippedAt = [];
  for (const b of manifest.blocks) {
    const out = instrumentBlock(readBlockSource(b.path, b.level), b);
    probes += out.probes.length;
    d0 += out.regionGate.d0.length;
    d1 += out.regionGate.d1.length;
    dropped += out.droppedOperands.length;
    skipped += out.regionGate.skipped.length;
    if (out.regionGate.skipped.length) {
      skippedAt.push(`${b.path} L${b.level}: ${out.regionGate.skipped.map((s) => s.name).join(', ')}`);
    }
  }
  console.log(`INSTRUMENT — ${GENERATOR_NAME} — plan v5 §7 row 9 (K4 region table · K5 block-relative offsets)`);
  console.log(`blocks: ${manifest.blockCount} | probes: ${probes} | depth-0 region nodes: ${d0} | depth-1 suppressed: ${d1}`);
  console.log(`region gate: ONE integer per probe, compared once. 0 runtime counters, 0 call stacks.`);
  console.log(`skipped region-table rows: ${skipped} (row 7 regex artifacts acorn does not see) · operand keys dropped for I5: ${dropped}`);
  for (const s of skippedAt) console.log(`  skipped: ${s}`);
  return 0;
}

function show(guidePath, level) {
  const { entry, instrumented } = instrumentGuideBlock(guidePath, level);
  console.log(`— ${guidePath} L${level} · targetFn ${entry.targetFn} · selfRecursive ${entry.selfRecursive} · codec ${entry.codec}`);
  console.log(`region table: ${entry.regionTable.map((r) => `${r.name ?? '(anonymous)'}@${r.depth}`).join('  ')}`);
  console.log(`probes: ${instrumented.probes.length} (region 0: ${instrumented.probes.filter((p) => p.region === 0).length} · region 1 suppressed: ${instrumented.probes.filter((p) => p.region === 1).length})`);
  if (instrumented.droppedOperands.length) console.log(`operand keys dropped for I5: ${instrumented.droppedOperands.join(', ')}`);
  console.log(`\n${instrumented.code}\n`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [guidePath, level] = process.argv.slice(2);
  try {
    process.exit(guidePath ? show(guidePath, Number(level)) : report());
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
