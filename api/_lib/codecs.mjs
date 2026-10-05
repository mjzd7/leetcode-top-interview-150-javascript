/**
 * Codec registry — plan v5 §3 G1, §7 row 17, §6 E7/E28, §8 invariant 2.
 *
 * ONE place a codec NAME resolves to behaviour. Plan §4 puts `codec` in
 * `catalog/problems.json`, `build/blocks.json` and the envelope, and §8 invariant 2 says
 * nothing re-declares it — this module is the only mapping from a name to an encoding.
 * Rows 10 (trace-runner) and 15 (gen-traces) drive every codec through the same two
 * methods, `encode` and `decode`, so the shape is deliberately uniform rather than
 * clever.
 *
 * ── G1, the hard rule ────────────────────────────────────────────────────────────
 * Exactly five codecs are implemented, because those are the five
 * `catalog/problems.json` actually names (measured: json 101, tree 20, list 13,
 * graph 9, ops 7 = 150). Plan §1 finding L1 cut the original 11-codec guess to those
 * five; §2's cross-attack kept "5 now" only on the condition that a sixth name FAILS
 * CI LOUDLY.
 *
 * There is therefore NO default branch, no lazy fallback and no silent passthrough
 * anywhere below. `getCodec` throws `CodecNotImplementedError` for every name outside
 * the registry. A fallback would undo this row: the failure it prevents is a trace that
 * renders as plausible-looking wrong data instead of stopping the build (plan §1 U2's
 * silent-wrong class — the worst failure mode in this engine).
 *
 * ── Exotic values belong to row 6 ────────────────────────────────────────────────
 * `undefined`, `NaN`, `±Infinity`, `-0`, `BigInt`, `Map`/`Set`, typed arrays and
 * cycles are the five things `JSON.stringify` loses or throws on, and this repo's own
 * guides use all of them (plan §1 U5). Every codec delegates them to
 * `scripts/lib/serialize.mjs` rather than inventing a second encoding: `encode` runs its
 * wire through `serialize`, and `json` delegates outright. That is the whole reason row 6
 * exists.
 *
 * Pure: no filesystem, no network, no `node:` builtins, no dependencies. It lives under
 * `api/_lib/` so it has to run inside a serverless function. Reaching into `scripts/` for
 * the serializer is precedented here — `api/_lib/problems.mjs` already reads
 * `judge/tests/` across the same boundary.
 */

import { serialize, deserialize, stringify } from '../../scripts/lib/serialize.mjs';

// ---- shared helpers --------------------------------------------------------------

const isNil = (v) => v === null || v === undefined;

/**
 * A back-reference this module minted: `{__ref: N}` means "the node already emitted at
 * wire position N". Strictly a single-key object so it can never be confused with a
 * domain value that happens to have a `__ref` field.
 */
const isRef = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === 1 && typeof v.__ref === 'number';

const ref = (at) => ({ __ref: at });

// ---- the four questions every caller has to ask a value ---------------------------
//
// `encode`/`decode` answer "what is this value's WIRE?". They cannot answer "is this value
// even mine?", and that omission is the whole class of bug row 15 measured: a driver that
// applies a codec unconditionally turns a scalar into a structure and then compares the
// structure against a scalar. `maxDepth(root)` returns the number 3; `tree.encode(3)` is
// `[null]`, and `[null] !== 3` is a verdict that can never be anything but wrong.
//
// So each codec also answers, for ONE definition of its own domain:
//
//   owns(wire)         this value is already my live form -> do NOT decode it again
//   acceptsWire(wire)  this value is a WIRE of mine, in canonical form -> decode it
//   toWire(live)       the shape half of `encode` (row 6's `serialize` applied on top)
//   fromWire(wire)     the shape half of `decode`
//
// `encode` is then COMPOSED from `toWire`, never a second implementation, so the sandbox
// driver and the host agree by construction rather than by review. `api/_lib/problems.mjs`
// inlines these four through `driverCodecSource()` — the sandbox has no module loader, so the
// ONLY way to keep one implementation is to ship the implementation's own source text.
//
// ponytail: `owns` is deliberately SHALLOW — a non-null, non-array object for `tree`/`list`,
// because that is exactly the set `treeToArray`/`listToArray` can read, and a deeper rule
// ("has a `val` AND is reachable from a `left`/`right`") would need a walk per comparison for
// no corpus case. Ceiling: an object that is not a node but IS a bare object (a returned
// `{a:1}` on a tree guide) is treated as a node and encodes to `[undefined]`. Upgrade path:
// a per-codec `nodeShape` predicate once a guide needs it — never a mode flag on `owns`.

/** A live `tree`/`list` node graph: what `treeToArray` / `listToArray` can actually read. */
export function isNodeLive(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * A value the `tree` codec owns — a node graph, or NIL.
 *
 * Nil is in `tree`'s domain because the encoder puts it there: `treeToArray(null)` returns
 * `[]`, so an empty tree IS `null` on this wire, and a target that returns `null` for an
 * empty tree is answering in this codec's own vocabulary. Leaving nil unowned made
 * `invertTree(null)` compare as `null` against an expected `[]` — the driver reading a
 * correct answer as a wrong one, which is the whole bug class this registry now owns.
 *
 * ponytail: `list` deliberately does NOT take nil, even though `listToArray(null)` is `[]`
 * in exactly the same way. The corpus authored BOTH answers for a null list head —
 * `08-linked-list/07-remove-nth-node-from-end.md` expects `[]` (its script went through
 * `listToArray`) and `08-linked-list/04-copy-list-with-random-pointer.md` expects `null`
 * (its script compared the raw head) — and no rule can satisfy both. `tree` is encoded
 * because it is the pilot's own codec (`judge/tests/invert-binary-tree.json` asserts the
 * empty tree as `[]`); `list` is not because doing so costs `copy-list-with-random-pointer`
 * its only passing case. Ceiling: a `list` guide whose target returns a null head and whose
 * expectation is `[]` needs that one case to fail. Upgrade path: make the corpus state one
 * convention — `catalog/cases.json` is the place, and it is authored data, not a codec rule.
 */
export function isNodeValue(v) {
  return isNil(v) || isNodeLive(v);
}

/**
 * A value is a WIRE of this codec only if decoding and re-encoding it is the IDENTITY —
 * i.e. the value is already in the canonical encoding, not merely array-shaped.
 *
 * That round-trip requirement is the load-bearing half. Without it a tree guide whose
 * target takes a plain array (`sortedArrayToBST(nums)`, `buildTree(preorder, inorder)`) has
 * that array silently rewritten into a node graph before the call, and the solution is then
 * asked a question nobody asked. `[3,9,20,15,7]` decodes to a tree that re-encodes as
 * `[3,9,20,null,null,15,7]`, so it is NOT this codec's wire and is passed through untouched;
 * `[3,9,20,null,null,15,7]` round-trips exactly, so it is.
 *
 * The structural half (`isNodeWire`) is what keeps a nested array — `[[3],[9,20]]`, a level
 * ORDER result — from being read as a node wire in the first place.
 */
function acceptsNodeWire(fromWire, toWire, wire) {
  if (!Array.isArray(wire)) return false;
  for (let i = 0; i < wire.length; i++) {
    const cell = wire[i];
    if (cell === null || cell === undefined) continue;
    if (typeof cell === 'object') return false; // nested array or a node: not a level-order wire
  }
  return stringify(toWire(fromWire(wire))) === stringify(wire);
}

// ---- 1. json: plain values; row 6 for the five JSON cannot carry ------------------
// This codec IS row 6. Nothing is reimplemented here on purpose — plan §1 U5 measured
// all five losses in this repo's own guides, and a second serializer would be a second
// answer to the same question.
//
// `owns` is unconditionally true and `toWire`/`fromWire` are the identity: `json` is the
// wire format itself, so every value is already in its final form and re-encoding it would
// only lose information.

const identity = (v) => v;

const json = Object.freeze({
  name: 'json',
  /** domain value -> canonical, JSON-safe wire. */
  encode: (value) => serialize(value),
  /** canonical wire -> the live value, tokens resolved (Map is a Map again). */
  decode: (wire) => deserialize(wire),
  toWire: identity,
  fromWire: identity,
  owns: () => true,
  acceptsWire: () => true,
});

// ---- 2. tree: binary tree <-> LeetCode level-order array --------------------------
// `treeToArray` / `arrayToTree` are the logic from `api/_lib/problems.mjs`'s inline
// `__treeToArray__` / `__arrayToTree__`, LIFTED rather than forked: same BFS, same
// trailing-null trim, same `undefined` child treated as absent. What the inline copy
// cannot express is E7 — a node reachable twice. An inline BFS with no id table walks a
// cycle forever, so the registry adds one: the FIRST time a node is emitted it records
// its wire position, and every sighting after that emits `{__ref: thatPosition}` and
// stops descending. Decode reverses it, and because positions are the ids, the parent
// that holds the back-reference is always already built.
//
// ponytail: `tree` assumes a BINARY tree read as `val`/`left`/`right` — at most two
// children per node, `null` for absent. No n-ary trees, no `children[]` form, and no
// graph-of-trees (a shared child IS supported, via `__ref`). Upgrade path: a 4th codec
// entry once a guide in the catalog needs it; do NOT widen this one into a mode flag.

function treeToArray(root) {
  if (isNil(root)) return [];
  const out = [];
  const firstAt = new Map(); // live node -> wire position of its FIRST emission
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!isNil(node) && firstAt.has(node)) {
      out.push(ref(firstAt.get(node)));
      continue; // a repeat is a leaf on the wire: descending would not terminate
    }
    if (isNil(node)) {
      out.push(null);
      continue;
    }
    firstAt.set(node, out.length);
    out.push(node.val);
    queue.push(isNil(node.left) ? null : node.left);
    queue.push(isNil(node.right) ? null : node.right);
  }
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out;
}

function arrayToTree(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || isNil(arr[0]) || isRef(arr[0])) return null;
  const made = new Array(arr.length); // wire position -> the node built there
  const mk = (val) => ({ val, left: null, right: null });

  made[0] = mk(arr[0]);
  const queue = [made[0]];
  let i = 1;
  // The wire IS the encoder's queue in visit order, so `i` tracks each popped node's own
  // wire position and its two child slots are `i` and `i + 1`.
  while (i < arr.length) {
    const node = queue.shift();
    for (let slot = 0; slot < 2 && i < arr.length; slot++, i++) {
      const cell = arr[i];
      const field = slot === 0 ? 'left' : 'right';
      if (isRef(cell)) {
        node[field] = made[cell.__ref];
        made[i] = node[field];
      } else if (isNil(cell)) {
        made[i] = null;
      } else {
        node[field] = mk(cell);
        made[i] = node[field];
        queue.push(node[field]);
      }
    }
  }
  return made[0];
}

const tree = Object.freeze({
  name: 'tree',
  toWire: treeToArray,
  fromWire: arrayToTree,
  encode: (root) => serialize(treeToArray(root)),
  // No `deserialize` here, and that is load-bearing: this codec MINTS `__ref` tokens in
  // its own position space, and row 6's deserializer would read them as ITS ref table
  // and substitute the wire array itself for the back-reference. The wire is already
  // canonical text-wise (`serialize` sorted every level), so reading it directly is the
  // correct inverse. ponytail: a token hidden inside a node's `val` — a Map as a tree
  // value — therefore stays a token after decode instead of being re-inflated; absurd
  // input for a tree, and `ops` is where that case is carried.
  decode: (wire) => arrayToTree(wire),
  owns: isNodeValue,
  acceptsWire: (wire) => acceptsNodeWire(arrayToTree, treeToArray, wire),
});

// ---- 3. list: ListNode chain <-> array -------------------------------------------
// `null` head is the empty list and encodes to `[]`. A decode stops at the first null
// cell, so a wire may spell out its tail (`[1, 2, null]`) or leave it implicit
// (`[1, 2]`) — both are the same chain, and `encode` always emits the short form because
// goldens need canonical bytes.
//
// ponytail: `list` is SINGLY linked with a `val`/`next` pair and no extra per-node
// payload. A doubly-linked list, a node carrying a `random` pointer (the LC copy-list
// guides) or a list-of-lists is out of scope; upgrade path is a 6th codec, measured
// against the catalog first — plan L1's rule is that a codec is added on evidence.

function listToArray(head) {
  if (isNil(head)) return [];
  const out = [];
  const firstAt = new Map(); // the E7 id table, same idea as the tree's
  let node = head;
  while (!isNil(node)) {
    if (firstAt.has(node)) {
      out.push(ref(firstAt.get(node)));
      break; // a cycle closes the walk; there is nothing past it
    }
    firstAt.set(node, out.length);
    out.push(node.val);
    node = isNil(node.next) ? null : node.next;
  }
  return out;
}

function arrayToList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const made = new Array(arr.length);
  let head = null;
  let tail = null;
  for (let i = 0; i < arr.length; i++) {
    const cell = arr[i];
    if (isNil(cell)) break; // an explicit null tail ends the chain
    if (isRef(cell)) {
      if (tail) tail.next = made[cell.__ref];
      else head = made[cell.__ref];
      break;
    }
    const node = { val: cell, next: null };
    made[i] = node;
    if (tail) tail.next = node;
    else head = node;
    tail = node;
  }
  return head;
}

const list = Object.freeze({
  name: 'list',
  toWire: listToArray,
  fromWire: arrayToList,
  encode: (head) => serialize(listToArray(head)),
  decode: (wire) => arrayToList(wire), // no `deserialize` — see the note on `tree.decode`
  // Row 15 / S31 — was `isNodeLive`, and that is the asymmetry S26 fixed for `tree` ONLY. `owns`
  // decides whether a value is re-encoded through `toWire` before comparison, so with nil excluded
  // a `null` EXPECTATION stayed `null` while a `null` RETURN became `[]` — and no case whose
  // authored expectation is `null` could ever pass, on any list guide. `merge-k-sorted-lists`'s
  // `assertEq(fn([]), null, 'empty array')` is the measured instance (3 cases, L1 and L2).
  // `isNodeValue` is `isNil(v) || isNodeLive(v)`, so this is the SAME rule `tree` already uses.
  // `acceptsWire` is deliberately untouched: the earlier entry's probe moved THAT lever and measured
  // it net-negative (declining `[]` fixes 2 blocks and breaks `invert-binary-tree` x3). The defect
  // was on the comparison side, not the wire.
  owns: isNodeValue,
  acceptsWire: (wire) => acceptsNodeWire(arrayToList, listToArray, wire),
});

// ---- 4. ops: terminal field-state + outputs (plan F6) -----------------------------
// The catalog has 7 `ops` guides and 15 entries on the
// `ops-terminal-state-and-outputs` equivalence kind, so this codec and `equivalent()`
// below are the pair row 19's differential harness drives.
//
// The domain value is `{state, outputs}`: `state` is the object the ops left behind
// (usually a class instance), `outputs` is the sequence they emitted. F6 defines the
// equivalence as "same final field-state + same emitted outputs sequence", so `state` is
// snapshotted as OWN ENUMERABLE FIELDS ONLY — a prototype method is behaviour, not
// observable state, and shipping it would put a function in the envelope.
//
// ponytail: `ops` snapshots fields one level deep via `serialize`, which walks the whole
// object graph, so nested instances and Maps inside the state are carried faithfully. What
// it does NOT do is reconstruct a prototype: `decode` returns plain objects, and the
// caller re-attaches the class. That is deliberate — reconstructing an arbitrary
// constructor from a wire would need a class registry, which is a second registry.

/** Own enumerable, non-function fields of a terminal state. */
export function fieldState(value) {
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const v = value[key];
    if (typeof v === 'function') continue; // a method is not state
    out[key] = v;
  }
  return out;
}

/** The `{state, outputs}` shape this codec's whole domain is. */
const opsWire = (terminal) => ({ state: fieldState(terminal?.state), outputs: terminal?.outputs });

const ops = Object.freeze({
  name: 'ops',
  toWire: opsWire,
  fromWire: identity,
  encode: (terminal) => serialize(opsWire(terminal)),
  decode: (wire) => {
    const w = deserialize(wire);
    return { state: w.state, outputs: w.outputs };
  },
  // A freshly-constructed class instance is NOT this codec's value — it is the `state`
  // half, and only a runner that recorded an operation sequence can build the `outputs`
  // half. Saying so here is what keeps a driver from "helpfully" wrapping an instance into
  // `{state, outputs: undefined}` and reporting the result as a comparison it never made.
  owns: (v) => isNodeLive(v) && 'state' in v && 'outputs' in v,
  acceptsWire: () => true,
});

// ---- 5. graph: nodes + edges -----------------------------------------------------
// The domain is `{nodes, edges}` with edges as `[from, to]` index pairs, which covers an
// adjacency list, an edge list and an undirected pair (both directions present) without
// a mode flag — and it represents an ISOLATED node, which a bare index-to-adjacency map
// cannot.
//
// `encode` SORTS the edges. Goldens are byte-compared (plan E8), so an insertion-order
// dependency would make a trace churn for a graph that did not change. Sorting is not
// information loss for an adjacency graph: edge order carries no meaning, which is also
// why the catalog puts 9 entries on `order-insensitive`.
//
// ponytail: `graph` is UNDIRECTED-agnostic (an undirected edge is stored twice) and does
// not compute connectivity, degrees or components — those belong to the guide, not the
// codec. Node payloads are opaque and canonicalised by `serialize`. Upgrade path for a
// labelled/weighted edge is a wider edge tuple, which needs no new codec.

const graphWire = (g) => ({
  nodes: [...(g?.nodes ?? [])],
  edges: [...(g?.edges ?? [])].map(([from, to]) => [from, to]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
});

const graph = Object.freeze({
  name: 'graph',
  toWire: graphWire,
  fromWire: identity,
  encode: (g) => serialize(graphWire(g)),
  decode: (wire) => {
    const { nodes, edges } = deserialize(wire);
    for (const [from, to] of edges) {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0
        || from >= nodes.length || to >= nodes.length) {
        // A named throw, not a silently dropped edge: a rendered graph missing one edge
        // is exactly the plausible-looking-wrong-data failure this module exists to stop.
        throw new Error(`codec graph: edge [${from},${to}] points outside nodes.length=${nodes.length}`);
      }
    }
    return { nodes, edges };
  },
  owns: (v) => isNodeLive(v) && Array.isArray(v.nodes) && Array.isArray(v.edges),
  acceptsWire: () => true,
});

// ---- the sandbox driver runtime ---------------------------------------------------

/**
 * The registry, as SOURCE TEXT, for a sandbox that has no module loader.
 *
 * `api/_lib/problems.mjs` builds a single self-contained string that QuickJS evaluates: the
 * user's guide code plus a verdict driver. There is no `import` in there and there cannot be
 * one, so the ONLY way for the driver to share this module's behaviour instead of forking it
 * is to hand over the implementation's own text — `Function.prototype.toString()` of the very
 * function objects `getCodec` returns. A second hand-written copy is the failure mode this
 * whole module exists to prevent (plan §1 U2: a second source of truth renders as
 * plausible-looking wrong data), so there is deliberately no way to write one here.
 *
 * Everything emitted lives inside the CALLER's IIFE, so `stringify` — the one name the
 * comparators below close over — cannot collide with a guide solution that happens to be
 * called `stringify`. That is why the comparators are inlined too: E28's six kinds are the
 * catalog's declared comparison contract, and a driver that compared with `===` on JSON text
 * would silently disagree with `catalog/problems.json` on every `order-insensitive` guide
 * (measured: `20-trie/03-word-search-ii`, whose L1 returns `["oath","eat"]` for an expected
 * `["eat","oath"]`).
 *
 * ponytail: `stringify` here is `JSON.stringify` over the codec's wire, NOT row 6's
 * `serialize`. Row 6 lives in `scripts/lib/serialize.mjs`, whose `toPlain` closure
 * (`leaf`, `isContainer`, `put`, `shortCtorName`, `TOKEN_KEYS`) is not exported, so its
 * source cannot be lifted the way the codec bodies are. Ceiling: a verdict that hinges on
 * `undefined`-in-array, `NaN`, `-0` or an empty `Map` comparing equal to a different value
 * inside the SANDBOX — the HOST side (envelope `result`, golden differ) still goes through
 * `serialize`, because `encode` composes it. Upgrade path: export `toPlain`'s closure from
 * row 6 and have `stringify` here be `serialize`'s own text; nothing else changes.
 */
let driverSourceCache = null;

export function driverCodecSource() {
  if (driverSourceCache !== null) return driverSourceCache;
  // A named `function`/`class` carries its own name in `toString()`; an arrow does not, so
  // it has to be re-bound. Both forms are emitted under their REGISTRY name so the closures
  // the lifted bodies reference (`isNil`, `isRef`, `nearEqual`, `stringify`) resolve inside
  // the caller's scope.
  const emit = (name, body) => {
    const src = body.toString();
    return /^\s*(function|class)\b/.test(src) ? src : `var ${name} = ${src};`;
  };
  const table = {};
  for (const name of IMPLEMENTED_CODECS) {
    const c = getCodec(name);
    table[name] = c;
  }
  driverSourceCache = [
    'function stringify(v) { return v === undefined ? "__undefined__" : JSON.stringify(v); }',
    emit('isNil', isNil),
    emit('isRef', isRef),
    emit('ref', ref),
    emit('isNodeLive', isNodeLive),
    emit('isNodeValue', isNodeValue),
    emit('acceptsNodeWire', acceptsNodeWire),
    emit('fieldState', fieldState),
    emit('treeToArray', treeToArray),
    emit('arrayToTree', arrayToTree),
    emit('listToArray', listToArray),
    emit('arrayToList', arrayToList),
    emit('orderFree', orderFree),
    emit('leaves', leaves),
    emit('shape', shape),
    'var EPS = 1e-9;',
    emit('nearEqual', nearEqual),
    emit('tolerantEqual', tolerantEqual),
    emit('EXACT', EXACT),
    emit('opsTerminalEqual', opsTerminalEqual),
    'var __COMPARATORS__ = {',
    '  "exact": EXACT,',
    '  "order-insensitive": function (a, b) { return EXACT(orderFree(a), orderFree(b)); },',
    '  "multiset": function (a, b) { var x = leaves(a); var y = leaves(b); return x.length === y.length && x.sort().join("\\u0000") === y.sort().join("\\u0000"); },',
    '  "shape-only": function (a, b) { return EXACT(shape(a), shape(b)); },',
    '  "int-with-tolerance": tolerantEqual,',
    '  "ops-terminal-state-and-outputs": opsTerminalEqual,',
    '};',
    'var __CODECS__ = {',
    ...Object.entries(table).flatMap(([name, c]) => [
      `  ${JSON.stringify(name)}: {`,
      `toWire: ${c.toWire.toString()},`,
      `fromWire: ${c.fromWire.toString()},`,
      `owns: ${c.owns.toString()},`,
      `acceptsWire: ${c.acceptsWire.toString()},`,
      '},',
    ]),
    '};',
  ].join('\n');
  return driverSourceCache;
}

// ---- the registry ----------------------------------------------------------------

/** The five implemented names, frozen: nothing appends a sixth at runtime. */
export const IMPLEMENTED_CODECS = Object.freeze(['json', 'tree', 'list', 'ops', 'graph']);

const REGISTRY = Object.freeze({ json, tree, list, ops, graph });

/** Named error for an unimplemented codec — plan §3 G1's "fails CI loudly". */
export class CodecNotImplementedError extends Error {
  constructor(codecName, slug) {
    const who = slug ? ` for slug "${slug}"` : '';
    super(
      `codec "${codecName}"${who} is not implemented. Implemented codecs: ${IMPLEMENTED_CODECS.join(', ')}. `
      + 'There is no default codec on purpose — a slug naming an unimplemented codec must fail, '
      + 'not render as a plausible-looking wrong trace.'
    );
    this.name = 'CodecNotImplementedError';
    this.codec = codecName;
    this.slug = slug ?? null;
    this.implemented = IMPLEMENTED_CODECS;
  }
}

/** True only for an implemented name. Exact match — no trimming, no lowercasing. */
export function hasCodec(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

/**
 * The codec for a name. THROWS `CodecNotImplementedError` for anything else — there is
 * no default branch in this module, by design.
 *
 * @param {string} name        a `codec` value from the catalog / blocks / envelope
 * @param {string} [slug]      the slug or path asking for it, so the error names the culprit
 * @returns {{name: string, encode: Function, decode: Function}}
 */
export function getCodec(name, slug) {
  if (!hasCodec(name)) throw new CodecNotImplementedError(name, slug);
  return REGISTRY[name];
}

// ---- E28: the six equivalence kinds ---------------------------------------------
// Plan §6 E28 requires all six, each with a fixture that passes and a mutated one that
// fails. `exact` and friends are what makes "a mutated fixture FAILS" mean anything, and
// row 19 drives the same six against the catalog's `equivalence` field.
//
// ponytail: these compare through row 6's canonical text rather than a bespoke deep-equal,
// so `undefined`, `NaN`, `-0`, `BigInt`, Map/Set and cycles are handled by the one
// normaliser instead of a second set of rules here. Cost: `exact` and friends are O(size)
// string compares rather than O(1) short-circuits — irrelevant at envelope sizes, and it
// is what lets one implementation serve the golden differ (row 13) too.

export const EQUIVALENCE_KINDS = Object.freeze([
  'exact',
  'order-insensitive',
  'multiset',
  'shape-only',
  'int-with-tolerance',
  'ops-terminal-state-and-outputs',
]);

/** Canonical text with every array sorted at every level: order carries no meaning. */
function orderFree(v) {
  if (Array.isArray(v)) return v.map(orderFree).sort((a, b) => (stringify(a) < stringify(b) ? -1 : 1));
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = orderFree(v[k]);
    return out;
  }
  return v;
}

/** Flat multiset of every leaf, sorted: `{a:[1,2]}` and `{b:[1],c:[2]}` are the same one. */
function leaves(v, acc = []) {
  if (Array.isArray(v)) {
    for (const x of v) leaves(x, acc);
  } else if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v).sort()) leaves(v[k], acc);
  } else {
    acc.push(stringify(v));
  }
  return acc;
}

/** Structure without values: same kinds, same key sets, same array lengths. */
function shape(v) {
  if (Array.isArray(v)) return v.map(shape);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = shape(v[k]);
    return out;
  }
  // Both literals and the row-6 tokens collapse to their KIND, not their value.
  return v === null ? 'null' : typeof v;
}

/** Plan F5 pins BOTH epsilons: abs 1e-9 OR rel 1e-9, per-guide override out of scope here. */
const EPS = 1e-9;
const nearEqual = (a, b) => {
  const d = Math.abs(a - b);
  return d <= EPS || d <= EPS * Math.max(Math.abs(a), Math.abs(b));
};

function tolerantEqual(expected, got) {
  if (typeof expected === 'number' && typeof got === 'number') return nearEqual(expected, got);
  if (Array.isArray(expected) || Array.isArray(got)) {
    if (!Array.isArray(expected) || !Array.isArray(got) || expected.length !== got.length) return false;
    return expected.every((x, i) => tolerantEqual(x, got[i]));
  }
  if (expected === null || got === null || typeof expected !== 'object' || typeof got !== 'object') {
    return stringify(expected) === stringify(got);
  }
  const ek = Object.keys(expected);
  const gk = Object.keys(got);
  if (ek.length !== gk.length) return false;
  return ek.every((k) => Object.prototype.hasOwnProperty.call(got, k) && tolerantEqual(expected[k], got[k]));
}

const EXACT = (a, b) => stringify(a) === stringify(b);

/** Plan F6: same final field-state + same emitted outputs SEQUENCE. */
function opsTerminalEqual(a, b) {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return EXACT(a, b);
  const has = (v, k) => v !== null && typeof v === 'object' && k in v;
  if (!has(a, 'state') || !has(b, 'state') || !has(a, 'outputs') || !has(b, 'outputs')) return EXACT(a, b);
  return EXACT(a.state, b.state) && EXACT(a.outputs, b.outputs);
}

const COMPARATORS = Object.freeze({
  exact: EXACT,
  'order-insensitive': (a, b) => EXACT(orderFree(a), orderFree(b)),
  multiset: (a, b) => {
    const x = leaves(a);
    const y = leaves(b);
    return x.length === y.length && x.sort().join('\u0000') === y.sort().join('\u0000');
  },
  'shape-only': (a, b) => EXACT(shape(a), shape(b)),
  'int-with-tolerance': tolerantEqual,
  'ops-terminal-state-and-outputs': opsTerminalEqual,
});

/**
 * Compare an expected value with a produced one under a plan §6 E28 equivalence kind.
 * An unknown kind THROWS — same rule as `getCodec`, for the same reason: a silently
 * defaulted comparator would let a real divergence report itself as a pass.
 */
export function equivalent(kind, expected, got) {
  const cmp = COMPARATORS[kind];
  if (!cmp) throw new Error(`codecs: unknown equivalence kind "${kind}". Implemented: ${EQUIVALENCE_KINDS.join(', ')}`);
  return cmp(expected, got);
}
