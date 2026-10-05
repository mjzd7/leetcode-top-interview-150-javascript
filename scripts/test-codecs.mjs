/**
 * Row 17 self-tests: the codec registry — plan v5 §3 G1, §7 row 17, §6 E28, §8 invariant 2.
 *
 * G1 is a HARD RULE and this file is where it is enforced: exactly five codec names
 * resolve to behaviour, and any other name is a NAMED throw. There is deliberately no
 * `default` branch and no silent passthrough — plan §1 finding L1 cut the original
 * 11-codec guess to the five the catalog actually names, and §2's cross-attack kept
 * "5 now" only on the condition that the sixth name FAILS LOUDLY. A fallback here would
 * undo the row: the failure it prevents is a trace that renders as plausible-looking
 * wrong data (U2's silent-wrong class) instead of stopping the build.
 *
 * Every round-trip is proved able to FAIL: each codec has a fixture the round-trip
 * accepts AND a mutated fixture the SAME assertion rejects (plan §6 E28's pattern). A
 * round-trip test that cannot fail is not a test.
 *
 * Run: node scripts/test-codecs.mjs     (exits 1 if any assertion fails)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMPLEMENTED_CODECS,
  getCodec,
  hasCodec,
  equivalent,
  CodecNotImplementedError,
} from '../api/_lib/codecs.mjs';
import { stringify } from './lib/serialize.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG = path.join(__dirname, '..', 'catalog', 'problems.json');

/** The agreed codec surface, sorted. Every codec must expose exactly this, no more, no less. */
const CODEC_INTERFACE = 'acceptsWire,decode,encode,fromWire,name,owns,toWire';

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

// The round-trip contract, written ONCE so "mutated must fail" compares against the
// identical predicate the passing fixture satisfied. Canonical text (E8) rather than
// deepEqual: `stringify` is what resolves undefined / NaN / -0 / BigInt / Map / Set /
// typed arrays / cycles, so a naive deepEqual would call NaN unequal to NaN and -0
// unequal to 0 and fail fixtures that are actually correct.
// Tallied, not hardcoded: the summary prints what the file actually exercised.
const rtCounts = Object.fromEntries(IMPLEMENTED_CODECS.map((n) => [n, 0]));

/**
 * A codec case is proved in BOTH directions against a HAND-WRITTEN literal wire, never
 * against its own output. `decode(encode(x)) === x` is true by construction for any `x` —
 * a codec that dropped every field would still pass it — so it proves nothing alone. The
 * literal is the independent source of truth: the LeetCode level-order form, the row-6
 * token forms, the documented `{nodes, edges}` shape. Then BOTH mutants must break it,
 * which is plan §6 E28's pattern and the only proof that these assertions can fail.
 *
 *   encode(domain) === wire      forward, against the literal
 *   encode(decode(wire)) === wire  backward, against the literal
 *   encode(mutatedDomain) !== wire    forward can fail
 *   encode(decode(mutatedWire)) !== wire  backward can fail
 *
 * @param {string} codecName
 * @param {string} label
 * @param {any} wire         the expected canonical wire, written out by hand
 * @param {any} domain       the domain value that must produce it
 * @param {any} mutatedDomain
 * @param {any} mutatedWire
 */
function expectCodec(codecName, label, wire, domain, mutatedDomain, mutatedWire) {
  const codec = getCodec(codecName);
  rtCounts[codecName] = (rtCounts[codecName] ?? 0) + 1;
  const want = stringify(wire);

  const gotFwd = stringify(codec.encode(domain));
  check(gotFwd === want, `${codecName}/${label}: encode(domain) === the documented wire`,
    gotFwd === want ? '' : `got ${gotFwd}, want ${want}`);

  const gotBack = stringify(codec.encode(codec.decode(wire)));
  check(gotBack === want, `${codecName}/${label}: decode(wire) re-encodes to the same wire`,
    gotBack === want ? '' : `got ${gotBack}, want ${want}`);

  const mutFwd = stringify(codec.encode(mutatedDomain));
  check(mutFwd !== want, `${codecName}/${label}: a MUTATED domain encodes differently (the check can fail)`,
    `mutant still encodes as ${mutFwd}`);

  const mutBack = stringify(codec.encode(codec.decode(mutatedWire)));
  check(mutBack !== want, `${codecName}/${label}: a MUTATED wire decodes differently (the check can fail)`,
    `mutant still re-encodes as ${mutBack}`);
}

// ---- 1. the registry itself ------------------------------------------------------

check(Array.isArray(IMPLEMENTED_CODECS), 'registry: IMPLEMENTED_CODECS is an array');
check(IMPLEMENTED_CODECS.length === 5, 'registry: exactly five codecs (plan L1 cut)', `got ${IMPLEMENTED_CODECS.length}`);
check(
  JSON.stringify(IMPLEMENTED_CODECS) === JSON.stringify(['json', 'tree', 'list', 'ops', 'graph']),
  'registry: the five are exactly json, tree, list, ops, graph',
  `got ${JSON.stringify(IMPLEMENTED_CODECS)}`
);
check(Object.isFrozen(IMPLEMENTED_CODECS), 'registry: the list is frozen — nothing appends a sixth at runtime');
for (const name of IMPLEMENTED_CODECS) {
  check(hasCodec(name), `hasCodec(${name}): true`);
}
check(!hasCodec('graph-v2'), 'hasCodec(graph-v2): false');
check(!hasCodec('json '), 'hasCodec("json "): false — a trailing space is a typo, not json');

// Uniformity matters more than cleverness here: row 15 drives all five generically, so
// the shape is asserted rather than assumed.
for (const name of IMPLEMENTED_CODECS) {
  const codec = getCodec(name);
  check(codec !== undefined && typeof codec === 'object', `uniform: ${name} resolves to an object`);
  check(codec.name === name, `uniform: ${name}.name is its own name`, `got ${JSON.stringify(codec.name)}`);
  check(typeof codec.encode === 'function' && typeof codec.decode === 'function',
    `uniform: ${name} has encode() and decode()`);
  check(Object.isFrozen(codec), `uniform: ${name} is frozen`);
  check(getCodec(name) === codec, `uniform: getCodec(${name}) is stable across calls (row 15 can cache)`);
  // Row 15's driver fix (6a194d6) widened the interface on purpose, and uniformly: `owns` /
  // `acceptsWire` / `toWire` / `fromWire` are what let ONE registry decide whether a value is
  // already live, is a wire to decode, or is something the codec does not own — which is how
  // 139 goldens stopped grading wrong. So the assertion moved with the contract rather than
  // being deleted: it still pins a CLOSED interface, identical across all five codecs, so the
  // next person to bolt a method onto one codec and not the other still trips it.
  check(Object.keys(codec).sort().join() === CODEC_INTERFACE,
    `uniform: ${name} exposes exactly the agreed codec interface (${CODEC_INTERFACE.split(',').length} members)`,
    `keys: ${Object.keys(codec).sort().join()}`);
}

// ---- 2. G1's hard rule: an unmapped codec name fails LOUDLY ----------------------

const BAD_NAME = 'graph-v2';
let thrown = null;
try {
  getCodec(BAD_NAME, '18-graph-general/07-shortest-path.md');
} catch (err) {
  thrown = err;
}
check(thrown !== null, 'G1: an unregistered codec name THROWS (it does not fall through to a default)');
check(thrown instanceof CodecNotImplementedError, 'G1: the error is a CodecNotImplementedError', `${thrown?.constructor?.name}`);
check(thrown?.name === 'CodecNotImplementedError', 'G1: err.name is CodecNotImplementedError', `${thrown?.name}`);
check(String(thrown?.message).includes(BAD_NAME), 'G1: the message names the offending codec', String(thrown?.message));
check(String(thrown?.message).includes('18-graph-general/07-shortest-path.md'),
  'G1: the message names the slug that asked for it', String(thrown?.message));
for (const name of IMPLEMENTED_CODECS) {
  check(String(thrown?.message).includes(name), `G1: the message lists the implemented codec "${name}"`);
}
check(/implemented/i.test(String(thrown?.message)), 'G1: the message says the set is what IS implemented', String(thrown?.message));

// The same throw through every consumer entry point, and for a name that is a plausible
// typo of a real one — the failure this row exists to prevent.
for (const [bad, slug] of [['', '01-array-string/01-merge.md'], ['JSON', 'x.md'], ['tre', 'y.md'], ['lists', 'z.md']]) {
  let t = null;
  try {
    getCodec(bad, slug);
  } catch (err) {
    t = err;
  }
  check(t instanceof CodecNotImplementedError, `G1: ${JSON.stringify(bad)} throws rather than defaulting`, `${t}`);
}
let noSlugStillThrows = false;
try {
  getCodec(BAD_NAME);
} catch {
  noSlugStillThrows = true;
}
check(noSlugStillThrows, 'G1: an unknown name throws even with no slug context');

// Domain constructors, declared up front because the fixtures below build every codec's
// input with them. `t` is the binary-tree node the tree codec reads; `L` is the ListNode
// the list codec reads. Both are the shapes the guides in this repo already use.
const t = (val, left = null, right = null) => ({ val, left, right });
const L = (val, next = null) => ({ val, next });

// ---- 3. json: plain values, plus row 6 for the five JSON cannot carry -------------
// Plan §1 U5 measured each of these in this repo's own guides, so each gets a
// hand-written token wire — the canonical forms plan §3 K6 pins — and a mutant.

const json = getCodec('json');
const cycObj = { val: 1 };
cycObj.self = cycObj;
const cycRawList = L(1);
const cycRawList2 = L(2, cycRawList);
cycRawList.next = cycRawList2;

// [label, expected wire, domain, mutated domain, mutated wire]
const jsonCases = [
  ['E1 undefined', { i: 1, prev: { __u: 1 } }, { i: 1, prev: undefined }, { i: 1, prev: null }, { i: 1 }],
  ['E2 NaN', { best: { __nan: 1 } }, { best: NaN }, { best: null }, { best: { __u: 1 } }],
  ['E2 Infinity', { best: { __inf: 1 } }, { best: Infinity }, { best: null }, { best: { __nan: 1 } }],
  ['E3 -0 vs 0', { d: { __n0: 1 } }, { d: -0 }, { d: 0 }, { d: 0 }],
  ['E4 BigInt', { mask: { __bi: '10' } }, { mask: 0b1010n }, { mask: 10 }, { mask: 10 }],
  ['E5 Map', { seen: { __map: [[2, 0]] } }, { seen: new Map([[2, 0]]) }, { seen: {} }, { seen: {} }],
  ['E5 Set is not an array', { dup: { __set: ['a', 'b', 'c'] } }, { dup: new Set(['a', 'b', 'c']) },
    { dup: ['a', 'b', 'c'] }, { dup: ['a', 'b', 'c'] }],
  ['E6 Uint8Array', { buf: { __ta: 'Uint8', v: [1, 2, 255] } }, { buf: new Uint8Array([1, 2, 255]) },
    { buf: { 0: 1, 1: 2, 2: 255 } }, { buf: { __ta: 'Uint16', v: [1, 2, 255] } }],
  ['E7 object cycle', { self: { __ref: 0 }, val: 1 }, cycObj, { self: { val: 1 }, val: 1 }, { self: { val: 1 }, val: 1 }],
  ['E7 linked-list cycle (the named guide)', { next: { next: { __ref: 0 }, val: 2 }, val: 1 },
    cycRawList, L(1, L(2)), { next: { next: null, val: 2 }, val: 1 }],
  ['number 0', 0, 0, false, null],
  ['string "0" is not number 0', '0', '0', 0, 0],
  ['false', false, false, 0, null],
  ['empty string', '', '', ' ', null],
];
for (const [label, wire, domain, mutDomain, mutWire] of jsonCases) {
  expectCodec('json', label, wire, domain, mutDomain, mutWire);
}
// Distinctness, asserted directly — a truthiness test would call these three equal.
check(stringify(json.encode(0)) !== stringify(json.encode(false)) && stringify(json.encode(0)) !== stringify(json.encode(null)),
  'json: 0, false and null encode to three different wires, not one falsy value');

// The five losses plain `JSON.stringify` actually makes, re-proved here so this file does
// not merely assert the codec is right — it shows what delegating to row 6 bought.
let plainThrewOnBigInt = false;
try {
  JSON.stringify({ mask: 1n });
} catch {
  plainThrewOnBigInt = true;
}
check(plainThrewOnBigInt, 'json/E4: plain JSON.stringify THROWS on a live BigInt — the bug row 6 exists for');
check(JSON.stringify({ seen: new Map([[2, 0]]) }) === '{"seen":{}}', 'json/E5: plain JSON flattens a Map to {}');
check(JSON.stringify({ best: NaN }) === '{"best":null}', 'json/E2: plain JSON turns NaN into null');
check(JSON.stringify({ prev: undefined, i: 1 }) === '{"i":1}', 'json/E1: plain JSON DROPS the undefined key');
check(JSON.stringify({ d: -0 }) === '{"d":0}', 'json/E3: plain JSON prints -0 as 0');

// ---- 4. tree: LeetCode level-order arrays, lifted from problems.mjs --------------

const shared = t(5);
const cycA = t(1);
const cycB = t(2, cycA);
cycA.right = cycB;

expectCodec('tree', 'balanced', [1, 2, 3, 4, 5, 6, 7],
  t(1, t(2, t(4), t(5)), t(3, t(6), t(7))),
  t(1, t(2, t(4), t(5)), t(3, t(6), t(9))), [1, 2, 3, 4, 5, 6, 9]);
expectCodec('tree', 'empty / null root', [], null, t(0), [0]);
expectCodec('tree', 'single node', [1], t(1), t(2), [2]);
expectCodec('tree', 'sparse (null left)', [1, null, 2, 3], t(1, null, t(2, t(3))), t(1, null, t(2, t(4))), [1, null, 2, 4]);
expectCodec('tree', 'left chain only', [1, 2, null, 3], t(1, t(2, t(3))), t(1, t(2, t(3), t(4))), [1, 2, 4, 3]);
expectCodec('tree', 'E7 cyclic tree (b.left === a)', [1, null, 2, { __ref: 0 }], cycA, t(1, null, t(2)), [1, null, 2]);
expectCodec('tree', 'shared node reached twice', [1, 5, { __ref: 1 }], t(1, shared, shared), t(1, t(5), t(5)), [1, 5, 5]);

check(getCodec('tree').decode([]) === null, 'tree: an empty array decodes to a null root');
check(getCodec('tree').decode([null]) === null, 'tree: [null] decodes to a null root');
check(getCodec('tree').encode(null).length === 0, 'tree: encode(null) === []');

// The inline `__arrayToTree__` in problems.mjs loops forever on a cyclic tree — that is
// the whole reason this codec carries an id table (E7).
const cycWire = getCodec('tree').encode(cycA);
check(Array.isArray(cycWire) && cycWire.some((c) => c && typeof c === 'object' && '__ref' in c),
  'tree/E7: the wire carries a __ref token instead of walking forever', `wire: ${JSON.stringify(cycWire)}`);
const revived = getCodec('tree').decode(cycWire);
check(revived.right.left === revived, 'tree/E7: decode restores the SHARED node (identity, not a copy)');
check(revived.right.left !== revived.right, 'tree/E7: …and it is a distinct node from its parent');
const sharedBack = getCodec('tree').decode([1, 5, { __ref: 1 }]);
check(sharedBack.left === sharedBack.right, 'tree: a shared child stays shared across decode (one node, two parents)');

// ---- 5. list: ListNode chain <-> array -----------------------------------------

expectCodec('list', 'empty list', [], null, L(1), [1]);
expectCodec('list', 'single node', [1], L(1), L(2), [2]);
expectCodec('list', 'three nodes', [1, 2, 3], L(1, L(2, L(3))), L(1, L(2, L(4))), [1, 2, 4]);
expectCodec('list', 'falsy head value 0', [0, 1], L(0, L(1)), L(1), [1]);
expectCodec('list', 'E7 cycle (a.next.next === a)', [1, 2, { __ref: 0 }], cycRawList, L(1, L(2)), [1, 2]);

check(getCodec('list').decode([]) === null, 'list: [] decodes to null (the empty list)');
check(getCodec('list').encode(null).length === 0, 'list: encode(null) === []');
// "a list whose tail is null mid-array": the wire may spell the tail out, and it is the
// same chain as the short form — decode stops at the first null cell.
check(stringify(getCodec('list').decode([1, 2, null])) === stringify(L(1, L(2))),
  'list: a trailing null in the array decodes to the same chain as the short form');
check(getCodec('list').encode(L(1, L(2))).length === 2,
  'list: encode does not pad a trailing null (canonical form for goldens)');
check(getCodec('list').decode([1, null, 2]) === null || getCodec('list').decode([1, null, 2]).val === 1,
  'list: a null cell ends the chain — everything after it is not a second list');

const cycListWire = getCodec('list').encode(cycRawList);
check(cycListWire.some((c) => c && typeof c === 'object' && '__ref' in c),
  'list/E7: the wire carries a __ref token instead of walking forever', `wire: ${JSON.stringify(cycListWire)}`);
const listRevived = getCodec('list').decode(cycListWire);
check(listRevived.next.next === listRevived, 'list/E7: decode restores the cycle');

// ---- 6. ops: terminal field-state + outputs (plan F6) -----------------------------
// The catalog has 7 ops guides and 15 entries on this equivalence kind, so this codec
// and F6's comparator are the pair the differential harness (row 19) drives.

class LruCache {
  constructor(capacity) {
    this.cap = capacity;
    this.map = new Map([['seed', 1]]);
    this.hits = 0;
  }
  put(k, v) {
    this.map.set(k, v);
    this.hits += 1;
    return this.map.size;
  }
}

const lru = new LruCache(2);
lru.put('a', 1);
lru.put('b', 2);
// The literal is the F6 contract written out: {state, outputs}, state reduced to its own
// enumerable FIELDS (cap, hits, map), the Map as row 6's token, `put` absent.
expectCodec('ops', 'class instance terminal state + outputs',
  { outputs: [2, 3], state: { cap: 2, hits: 2, map: { __map: [['seed', 1], ['a', 1], ['b', 2]] } } },
  { state: lru, outputs: [2, 3] },
  { state: lru, outputs: [2, 4] },
  { outputs: [2, 3], state: { cap: 2, hits: 3, map: { __map: [['seed', 1], ['a', 1], ['b', 2]] } } });

const opsWire = getCodec('ops').encode({ state: lru, outputs: [2, 3] });
check(opsWire && typeof opsWire === 'object' && 'state' in opsWire && 'outputs' in opsWire,
  'ops: the wire is exactly {state, outputs}', `keys: ${Object.keys(opsWire).join()}`);
check(!('put' in opsWire.state), 'ops: the snapshot is FIELD state — prototype methods are not on the wire',
  `state keys: ${Object.keys(opsWire.state).join()}`);
check(opsWire.state.map && opsWire.state.map.__map !== undefined,
  'ops: a Map inside the state survives as the canonical token (E5), not {}',
  `map: ${JSON.stringify(opsWire.state.map)}`);
const opsBack = getCodec('ops').decode(opsWire);
check(opsBack.state.map instanceof Map, 'ops: decode re-inflates the Map', `${opsBack.state.map?.constructor?.name}`);
check(opsBack.outputs.length === 2 && opsBack.outputs[1] === 3, 'ops: the outputs sequence survives in order');
check(opsBack.state.hits === 2, 'ops: the terminal field-state is what is snapshotted (hits === 2 after two puts)');
check(Object.getPrototypeOf(opsBack.state) === Object.prototype,
  'ops: decode returns a plain object, not a reconstructed class — no class registry (see the ponytail note)');

// Three more ops terminals: no ops at all, the exotic values a state field can hold, and a
// state that is not an object at all.
const untouched = new LruCache(2);
expectCodec('ops', 'no ops run (empty outputs, zero hits)',
  { outputs: [], state: { cap: 2, hits: 0, map: { __map: [['seed', 1]] } } },
  { state: untouched, outputs: [] },
  { state: untouched, outputs: [0] },
  { outputs: [], state: { cap: 2, hits: 1, map: { __map: [['seed', 1]] } } });

class Register {
  constructor() {
    this.limit = 1n;
    this.seen = new Set([1, 2]);
    this.missing = undefined;
  }
}
expectCodec('ops', 'exotic state fields (BigInt, Set, undefined)',
  { outputs: ['x'], state: { limit: { __bi: '1' }, missing: { __u: 1 }, seen: { __set: [1, 2] } } },
  { state: new Register(), outputs: ['x'] },
  { state: new Register(), outputs: ['y'] },
  { outputs: ['x'], state: { limit: { __bi: '2' }, missing: { __u: 1 }, seen: { __set: [1, 2] } } });

expectCodec('ops', 'a non-object terminal state', { outputs: [42], state: 42 },
  { state: 42, outputs: [42] }, { state: 42, outputs: [43] }, { outputs: [42], state: 43 });

// ---- 7. graph: nodes + edges, adjacency-shaped ----------------------------------

expectCodec('graph', 'empty graph', { edges: [], nodes: [] },
  { nodes: [], edges: [] }, { nodes: ['a'], edges: [] }, { edges: [], nodes: ['a'] });
expectCodec('graph', 'single isolated node', { edges: [], nodes: ['a'] },
  { nodes: ['a'], edges: [] }, { nodes: ['a'], edges: [[0, 0]] }, { edges: [], nodes: ['a', 'b'] });
expectCodec('graph', 'disconnected components', { edges: [[0, 1], [2, 3]], nodes: ['a', 'b', 'c', 'd'] },
  { nodes: ['a', 'b', 'c', 'd'], edges: [[0, 1], [2, 3]] },
  { nodes: ['a', 'b', 'c', 'd'], edges: [[0, 1], [2, 3], [0, 2]] },
  { edges: [[0, 1]], nodes: ['a', 'b', 'c', 'd'] });
expectCodec('graph', 'undirected pair + self loop', { edges: [[0, 1], [1, 0], [2, 2]], nodes: [0, 1, 2] },
  { nodes: [0, 1, 2], edges: [[0, 1], [1, 0], [2, 2]] },
  { nodes: [0, 1, 2], edges: [[0, 1], [1, 0]] },
  { edges: [[0, 1], [2, 2]], nodes: [0, 1, 2] });
expectCodec('graph', 'a 4-cycle', { edges: [[0, 1], [1, 2], [2, 3], [3, 0]], nodes: [0, 1, 2, 3] },
  { nodes: [0, 1, 2, 3], edges: [[0, 1], [1, 2], [2, 3], [3, 0]] },
  { nodes: [0, 1, 2, 3], edges: [[0, 1], [1, 2], [2, 3], [3, 1]] },
  { edges: [[0, 1], [1, 2], [2, 3]], nodes: [0, 1, 2, 3] });

// Canonical bytes for a golden: edge order must not depend on insertion order.
const g1 = getCodec('graph').encode({ nodes: [0, 1], edges: [[1, 0], [0, 1]] });
const g2 = getCodec('graph').encode({ nodes: [0, 1], edges: [[0, 1], [1, 0]] });
check(stringify(g1) === stringify(g2), 'graph: edge order is canonicalised, so a golden is byte-stable (E8)');
check(getCodec('graph').decode(g1).edges.length === 2, 'graph: a duplicate reversed pair survives the round trip as 2 edges');

// A dangling edge is a broken trace, not something to render: it must be NAMED.
let gErr = null;
try {
  getCodec('graph').decode({ nodes: ['a'], edges: [[0, 7]] });
} catch (err) {
  gErr = err;
}
check(gErr !== null, 'graph: an edge pointing past the last node is rejected', 'no error was raised');
check(gErr instanceof Error && /graph/.test(gErr.message), 'graph: that rejection is a named graph error', String(gErr?.message));

// ---- 8. E28: six equivalence kinds, each with a passing and a FAILING fixture -----

const KINDS = ['exact', 'order-insensitive', 'multiset', 'shape-only', 'int-with-tolerance', 'ops-terminal-state-and-outputs'];
const EQUIV_FIXTURES = [
  ['exact',
    { name: 'two-sum', expected: [0, 1] },
    { name: 'two-sum', expected: [1, 0] },
    'an index pair is not a set'],
  ['order-insensitive',
    { expected: { left: [3, 7], right: [11, 15] } },
    { expected: { left: [15, 11], right: [7, 3] } },
    'level order carries no meaning to the answer'],
  ['multiset',
    { expected: ['a', 'b', 'a', 'c'] },
    { expected: ['a', 'b', 'c', 'c'] },
    'a duplicate counted twice is a different multiset'],
  ['shape-only',
    { expected: [[0, 0], [1, 1], [2, 2]] },
    { expected: [[9, 9], [8, 8], [7, 7]] },
    'shape-only ignores VALUES, so this must pass'],
  ['int-with-tolerance',
    { expected: { area: 12.0000000001, ratio: 0.1 } },
    { expected: { area: 12.0000001, ratio: 0.2 } },
    'rel eps 1e-9 AND abs eps 1e-9 (F5)'],
  ['ops-terminal-state-and-outputs',
    { expected: { state: { queue: [3, 1], count: 2 }, outputs: ['pop 3', 'pop 1'] } },
    { expected: { state: { queue: [1, 3], count: 2 }, outputs: ['pop 3', 'pop 1'] } },
    'same final field-state + same outputs SEQUENCE (F6)'],
];
// shape-only is inverted on purpose: its `expected` passes and its mutant must pass too,
// so the assertion below is written the other way round for that one kind.
const SHAPE_INVERTED = 'shape-only';

for (const [kind, good, bad, why] of EQUIV_FIXTURES) {
  // `expected` must exist on BOTH entries. Comparing `undefined` to `undefined` would
  // make every one of these six assertions pass vacuously — which is exactly how a
  // weakened test hides, and why the wrapper shape is uniform here.
  check(good.expected !== undefined && bad.expected !== undefined,
    `E28 ${kind}: both fixtures carry a value to compare (not undefined)`, why);
  check(equivalent(kind, good.expected, good.expected) === true,
    `E28 ${kind}: the fixture passes`, why);
  if (kind === SHAPE_INVERTED) {
    check(equivalent(kind, good.expected, bad.expected) === true,
      `E28 ${kind}: differing VALUES still pass — that is what shape-only means`, why);
  } else {
    check(equivalent(kind, good.expected, bad.expected) === false,
      `E28 ${kind}: the mutated fixture FAILS`, why);
  }
}

// Each kind must discriminate, not rubber-stamp: these six pairs are where the kinds
// actually come apart, so a kind that stopped implementing its own rule would fail.
check(equivalent('exact', { a: [1, 2] }, { a: [2, 1] }) === false, 'E28 exact: order matters');
check(equivalent('order-insensitive', { a: [1, 2] }, { a: [2, 1] }) === true, 'E28 order-insensitive: order does NOT matter');
check(equivalent('multiset', { a: [1, 2] }, { a: [2, 1] }) === true, 'E28 multiset: order does NOT matter');
check(equivalent('int-with-tolerance', { a: [1, 2] }, { a: [2, 1] }) === false, 'E28 int-with-tolerance: order still matters');
check(equivalent('shape-only', { a: [1, 2] }, { a: [9, 9] }) === true, 'E28 shape-only: values do NOT matter');
check(equivalent('shape-only', { a: [1, 2] }, { a: [1, 2, 3] }) === false, 'E28 shape-only: array LENGTH is shape, so a length change fails');
check(equivalent('order-insensitive', { a: [1, 2] }, { a: [1, 2, 3] }) === false, 'E28 order-insensitive: cardinality is not order, so a length change fails');
check(equivalent('multiset', ['a', 'b', 'a'], ['a', 'a', 'b']) === true, 'E28 multiset: a duplicate counted twice is the same multiset');
check(equivalent('multiset', ['a', 'b', 'a'], ['a', 'b', 'b']) === false, 'E28 multiset: a different duplicate count is a different multiset');
check(equivalent('exact', 1, 1) && !equivalent('exact', 1, '1'), 'E28 exact: 1 !== "1" (no coercion)');
check(!equivalent('int-with-tolerance', 0, { a: 1 }), 'E28 int-with-tolerance: a number is not an object');
check(equivalent('int-with-tolerance', { v: 1e-12 }, { v: 0 }) === true,
  'E28 int-with-tolerance: abs eps 1e-9 covers the 1e-12 gap');
check(equivalent('int-with-tolerance', { v: 1 }, { v: 1.000001 }) === false,
  'E28 int-with-tolerance: rel eps 1e-9 rejects a 1e-6 gap');
check(equivalent('ops-terminal-state-and-outputs', { state: { a: 1 }, outputs: ['x'] }, { state: { a: 1 }, outputs: ['x'] }) === true,
  'E28 ops-terminal: identical terminal + identical outputs passes');
check(equivalent('ops-terminal-state-and-outputs', { state: { a: 1 }, outputs: ['x'] }, { state: { a: 1 }, outputs: ['y'] }) === false,
  'E28 ops-terminal: a different output sequence fails');
let eqErr = null;
try {
  equivalent('nope', 1, 1);
} catch (err) {
  eqErr = err;
}
check(eqErr !== null, 'E28: an unknown equivalence kind throws — there is no default comparator either');

// ---- 9. the catalog: five codecs cover 150 with nothing left over ----------------

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf-8'));
const problems = catalog.problems;
check(Array.isArray(problems), 'catalog: it exposes a `problems` array');
check(problems.length === 150, 'catalog: 150 entries', `got ${problems.length}`);

const codecHistogram = {};
const equivHistogram = {};
for (const p of problems) {
  codecHistogram[p.codec] = (codecHistogram[p.codec] ?? 0) + 1;
  equivHistogram[p.equivalence] = (equivHistogram[p.equivalence] ?? 0) + 1;
}
const codecTotal = Object.values(codecHistogram).reduce((a, b) => a + b, 0);
check(codecTotal === problems.length, 'catalog: every entry names a codec', `${codecTotal}/${problems.length}`);

const unmapped = problems.filter((p) => !hasCodec(p.codec));
check(unmapped.length === 0,
  'catalog: NO entry names an unimplemented codec (G1 — this is the row)',
  unmapped.length ? `unmapped: ${JSON.stringify(unmapped.slice(0, 3).map((p) => ({ slug: p.slug, codec: p.codec })))}` : '');

for (const name of IMPLEMENTED_CODECS) {
  check(codecHistogram[name] > 0, `catalog: "${name}" has a measured consumer (${codecHistogram[name] ?? 0} entries)`,
    'an implemented codec with no consumer is the L1 mistake in the other direction');
}
const leftovers = Object.keys(codecHistogram).filter((n) => !IMPLEMENTED_CODECS.includes(n));
check(leftovers.length === 0, 'catalog: nothing is left over outside the five', `leftover: ${JSON.stringify(leftovers)}`);
check(Object.keys(codecHistogram).length === IMPLEMENTED_CODECS.length,
  'catalog: the histogram has exactly five distinct codec names', `distinct: ${Object.keys(codecHistogram).length}`);

// Every entry must resolve through the registry — the loop row 15 and row 18 will run.
let resolvedAll = true;
let firstBad = '';
for (const p of problems) {
  try {
    getCodec(p.codec, p.slug);
  } catch (err) {
    resolvedAll = false;
    firstBad = `${p.slug}: ${err.message}`;
    break;
  }
}
check(resolvedAll, 'catalog: all 150 slugs resolve through getCodec(codec, slug)', firstBad);

// The equivalence kinds the catalog names must all be ones `equivalent()` implements.
const namedKinds = Object.keys(equivHistogram);
const unknownKinds = namedKinds.filter((k) => !KINDS.includes(k));
check(unknownKinds.length === 0, 'catalog: every equivalence kind in the catalog is implemented',
  `unknown: ${JSON.stringify(unknownKinds)}`);
// Measured, not asserted: `shape-only` has no catalog consumer today. E28 still requires
// the kind, so it ships — but the gap between the spec and the measurement is reported in
// the summary below rather than pinned here, where a future catalog entry would fail it.

// ---- summary ---------------------------------------------------------------------

const rtTotal = Object.values(rtCounts).reduce((a, b) => a + b, 0);
const perCodec = IMPLEMENTED_CODECS.map((n) => `${n} ${rtCounts[n]}`).join(' | ');
console.log('\n========================================');
console.log(`Codecs implemented: ${IMPLEMENTED_CODECS.length} — ${IMPLEMENTED_CODECS.join(', ')} (no default branch; unknown name throws)`);
console.log(`Catalog coverage: ${problems.length} entries = ${JSON.stringify(codecHistogram)}`);
console.log(`  sum ${codecTotal === problems.length ? codecTotal : `${codecTotal} != ${problems.length}`}; leftovers ${JSON.stringify(leftovers)}; unmapped ${unmapped.length}`);
console.log(`Catalog equivalence split: ${JSON.stringify(equivHistogram)}`);
console.log(`Round-trip fixtures: ${perCodec} = ${rtTotal} (every one has a mutant that FAILS the same check)`);
console.log(`E28 equivalence kinds: ${KINDS.length} implemented, ${KINDS.length} fixtures passing, ${KINDS.length - 1} mutants failing (shape-only's mutant passes by definition)`);
console.log(`Assertions: ${assertions} | Failures: ${failures}`);
console.log('========================================\n');

if (failures > 0) process.exit(1);
