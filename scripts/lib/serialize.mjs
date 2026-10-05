/**
 * Canonical value serializer — plan v5 §3 decision K6, ledger cases E1–E9 (§6).
 *
 * ONE normaliser for both the trace envelope and the golden comparison, because
 * `JSON.stringify` loses five things this engine measures in its own guides
 * (plan §1 finding U5: 64 guides use Map/Set, 19 use typed arrays, 14 carry
 * BigInt-scale literals):
 *
 *   undefined        silently DROPS the key            -> {"__u":1}
 *   NaN / ±Infinity  silently becomes null             -> {"__nan":1} {"__inf":1} {"__ninf":1}
 *   -0               prints as 0                       -> {"__n0":1}
 *   BigInt           THROWS, killing the whole run     -> {"__bi":"…"}
 *   Map / Set        silently becomes {}                -> {"__map":[…]} {"__set":[…]}
 *
 * Object keys are sorted at every level, so canonical text is byte-stable and golden
 * comparison reduces to a string compare (E8). Cycles and shared references go through
 * one id table and emit {"__ref":N} on every sighting after the first (E7). Depth past
 * MAX_DEPTH returns {"error":"maxDepth",…} rather than throwing, so the caller can still
 * flush the partial trace it already holds (E9, plan §5 `error`, §3 G3).
 *
 * Pure library: no filesystem, no network, no git, no dependencies.
 */

/** Plan §6 E9: the depth a container may reach. Past it the cap fires, never a RangeError. */
// ponytail: MAX_DEPTH is 10 000 because that is what §6 E9 pins; it costs nothing to
// reach (the walk is iterative, see below) so raise it only if a real degenerate tree
// needs more, and never so far that canonical text outgrows the 1 MB trace slot.
export const MAX_DEPTH = 10_000;

/**
 * A node is a token when its key SET matches one of these exactly — no more keys, no
 * fewer. `__ta` carries a payload (`v`), so it is the one two-key token.
 */
const TOKEN_KEYS = {
  __u: ['__u'],
  __nan: ['__nan'],
  __inf: ['__inf'],
  __ninf: ['__ninf'],
  __n0: ['__n0'],
  __bi: ['__bi'],
  __ref: ['__ref'],
  __map: ['__map'],
  __set: ['__set'],
  __ta: ['__ta', 'v'],
};

/** Typed-array constructors `deserialize` may call, by name. A whitelist, never `eval`. */
const TYPED_ARRAY_CTORS = {
  Int8: Int8Array,
  Uint8: Uint8Array,
  Uint8Clamped: Uint8ClampedArray,
  Int16: Int16Array,
  Uint16: Uint16Array,
  Int32: Int32Array,
  Uint32: Uint32Array,
  Float32: Float32Array,
  Float64: Float64Array,
  BigInt64: BigInt64Array,
  BigUint64: BigUint64Array,
};

/** ponytail: ONE id table per `serialize()` call, keyed by identity, and `{"__ref":N}`
 * on every sighting after the first — so a live object is never walked twice and a cycle
 * costs one token. Ceiling: ids are only stable WITHIN one call, never across two
 * independently serialised subtrees; if goldens ever need cross-call ids, swap the
 * `Map` for a caller-supplied table. */
const isContainer = (v) => v !== null && (typeof v === 'object' || typeof v === 'function');

/** Values with no children: JS primitives, plus the tokens for what JSON cannot carry. */
function leaf(value) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'undefined') return { __u: 1 };
  if (type === 'bigint') return { __bi: value.toString() };
  if (type === 'number') {
    if (Number.isNaN(value)) return { __nan: 1 };
    if (value === Infinity) return { __inf: 1 };
    if (value === -Infinity) return { __ninf: 1 };
    if (Object.is(value, -0)) return { __n0: 1 };
    return value;
  }
  // A function or symbol: no JSON form, so it reaches the object branch and becomes {}
  // under its own (empty) key list — the key stays, which is the E1 rule applied to types
  // JSON has no vocabulary for. ponytail: class instances and Date degrade the same way,
  // to their own enumerable fields — exactly what JSON.stringify would have done for
  // them — because throwing here would kill the sandbox run this module exists to save.
  return null;
}

/** `Uint8Array` -> `Uint8`; `ArrayBuffer` keeps its own name. Plan §6 E6 writes "Uint8". */
function shortCtorName(value) {
  const name = value.constructor.name;
  return name === 'ArrayBuffer' ? name : name.replace(/Array$/, '');
}

/** Assign without letting a key named `__proto__` reach a prototype setter. */
function put(target, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

/**
 * value -> JSON-safe tree, or `{error:'maxDepth', depth}` when the cap trips.
 *
 * ponytail: the walk is an explicit stack, NOT recursion — measured on this repo's Node
 * (v26.5.0) a recursive walk dies at ~8 800 frames, i.e. BELOW the 10 000 cap E9 pins,
 * so recursion would raise RangeError before the cap could ever fire. Cost: children are
 * pushed in reverse so the LIFO stack visits them in document order.
 */
function toPlain(root) {
  const seen = new Map(); // live container -> id; ONE table per call
  const holder = [];
  const work = [{ value: root, depth: 0, put: (x) => { holder[0] = x; } }];

  while (work.length > 0) {
    const task = work.pop();
    const v = task.value;

    if (!isContainer(v)) {
      task.put(leaf(v));
      continue;
    }

    const depth = task.depth;
    if (depth > MAX_DEPTH) return { error: 'maxDepth', depth };

    if (seen.has(v)) {
      task.put({ __ref: seen.get(v) });
      continue;
    }
    const id = seen.size;
    seen.set(v, id);
    const childDepth = depth + 1;

    if (Array.isArray(v)) {
      const shell = new Array(v.length);
      task.put(shell);
      for (let i = v.length - 1; i >= 0; i--) {
        work.push({ value: v[i], depth: childDepth, put: (x) => { shell[i] = x; } });
      }
    } else if (v instanceof Map) {
      // Insertion order is the language's, not ours — E5 depends on that.
      const entries = [...v.entries()];
      const shell = { __map: entries.map(() => [null, null]) }; // pairs exist before children run
      task.put(shell);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, val] = entries[i];
        const pair = shell.__map[i];
        work.push({ value: val, depth: childDepth, put: (x) => { pair[1] = x; } });
        work.push({ value: k, depth: childDepth, put: (x) => { pair[0] = x; } });
      }
    } else if (v instanceof Set) {
      const values = [...v.values()];
      const shell = { __set: new Array(values.length) };
      task.put(shell);
      for (let i = values.length - 1; i >= 0; i--) {
        work.push({ value: values[i], depth: childDepth, put: (x) => { shell.__set[i] = x; } });
      }
    } else if (ArrayBuffer.isView(v)) {
      const shell = { __ta: shortCtorName(v), v: new Array(v.length) };
      task.put(shell);
      for (let i = v.length - 1; i >= 0; i--) {
        work.push({ value: v[i], depth: childDepth, put: (x) => { shell.v[i] = x; } });
      }
    } else if (v instanceof ArrayBuffer) {
      const bytes = new Uint8Array(v);
      const shell = { __ta: 'ArrayBuffer', v: new Array(bytes.length) };
      task.put(shell);
      for (let i = bytes.length - 1; i >= 0; i--) {
        work.push({ value: bytes[i], depth: childDepth, put: (x) => { shell.v[i] = x; } });
      }
    } else {
      // A `{}` shell would turn a key named `__proto__` into a prototype setter, so these
      // shells carry no prototype at all.
      const shell = Object.create(null);
      task.put(shell);
      const keys = Object.keys(v).sort(); // E8: canonical at EVERY level, not just the root
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        work.push({ value: v[k], depth: childDepth, put: (x) => put(shell, k, x) });
      }
    }
  }

  return holder[0];
}

/** Typed-array cells are numbers or BigInts, so their tokens resolve to primitives here. */
function cellToken(value) {
  if (value === null || typeof value !== 'object') return null;
  if ('__nan' in value) return NaN;
  if ('__inf' in value) return Infinity;
  if ('__ninf' in value) return -Infinity;
  if ('__n0' in value) return -0;
  if ('__bi' in value) return BigInt(value.__bi);
  return null;
}

function buildTypedArray(name, values) {
  // Without this, `new Float64Array([{__n0:1}])` would coerce the token to NaN and
  // `new BigInt64Array([{__bi:"2"}])` would throw.
  const cells = values.map((v) => {
    const t = cellToken(v);
    return t === null ? v : t;
  });
  if (name === 'ArrayBuffer') return new Uint8Array(cells).buffer;
  const Ctor = TYPED_ARRAY_CTORS[name];
  if (!Ctor) throw new Error(`serialize: unknown typed array "${name}"`);
  return new Ctor(cells);
}

function tokenOf(node) {
  const keys = Object.keys(node);
  for (const tag of Object.keys(TOKEN_KEYS)) {
    const allowed = TOKEN_KEYS[tag];
    if (keys.length === allowed.length && allowed.every((k) => keys.includes(k))) return tag;
  }
  return null;
}

/**
 * JSON-safe tree -> live value. Mirrors `toPlain`'s visit order exactly, because that
 * order is what hands out ids: tokens consume no id on either side (they are leaves in
 * `toPlain` too), and getting that wrong would desynchronise every id after the first.
 */
function fromPlain(root) {
  const made = new Map(); // id -> reconstructed container
  const holder = [];
  const work = [{ value: root, depth: 0, put: (x) => { holder[0] = x; } }];

  while (work.length > 0) {
    const task = work.pop();
    const node = task.value;

    if (node === null || typeof node !== 'object') {
      task.put(node);
      continue;
    }

    if (Array.isArray(node)) {
      const shell = [];
      made.set(made.size, shell); // registered before children, so a parent __ref resolves
      task.put(shell);
      for (let i = node.length - 1; i >= 0; i--) {
        work.push({ value: node[i], depth: task.depth + 1, put: (x) => { shell[i] = x; } });
      }
      continue;
    }

    const tag = tokenOf(node);
    const childDepth = task.depth + 1;

    if (tag === '__u') task.put(undefined);
    else if (tag === '__nan') task.put(NaN);
    else if (tag === '__inf') task.put(Infinity);
    else if (tag === '__ninf') task.put(-Infinity);
    else if (tag === '__n0') task.put(-0);
    else if (tag === '__bi') task.put(BigInt(node.__bi));
    else if (tag === '__ref') {
      const target = made.get(node.__ref);
      if (target === undefined) throw new Error(`serialize: dangling __ref ${node.__ref}`);
      task.put(target);
    } else if (tag === '__map' || tag === '__set') {
      const isMap = tag === '__map';
      const list = node[tag];
      const shell = isMap ? new Map() : new Set();
      made.set(made.size, shell);
      task.put(shell);
      for (let i = list.length - 1; i >= 0; i--) {
        if (isMap) {
          // The value is pushed first, so the KEY pops and lands before the value does.
          const keySlot = [];
          work.push({ value: list[i][1], depth: childDepth, put: (x) => { shell.set(keySlot[0], x); } });
          work.push({ value: list[i][0], depth: childDepth, put: (x) => { keySlot[0] = x; } });
        } else {
          work.push({ value: list[i], depth: childDepth, put: (x) => { shell.add(x); } });
        }
      }
    } else if (tag === '__ta') {
      const shell = buildTypedArray(node.__ta, node.v);
      made.set(made.size, shell);
      task.put(shell);
    } else {
      const shell = {};
      made.set(made.size, shell);
      task.put(shell);
      // Re-sorted because `JSON.parse` hoists integer-like keys into ascending numeric
      // order; without this the id sequence would desynchronise against `toPlain`.
      const keys = Object.keys(node).sort();
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i];
        work.push({ value: node[k], depth: childDepth, put: (x) => put(shell, k, x) });
      }
    }
  }

  return holder[0];
}

/**
 * value -> the canonical JSON-safe structure: plain objects with sorted keys, arrays,
 * and tokens for everything JSON cannot carry. Returns `{error:'maxDepth', depth}` — a
 * value, never a throw — when the cap trips (E9).
 */
export function serialize(value) {
  return toPlain(value);
}

/** value -> canonical JSON text. This is the golden file's byte-for-byte content. */
export function stringify(value) {
  // ponytail: JSON.stringify is the TEXT emitter, not the serializer: the tree it is
  // handed holds only plain objects, arrays and primitives (every BigInt, non-finite
  // number and undefined already became a token), so nothing can be dropped or thrown on.
  return JSON.stringify(toPlain(value));
}

/** Canonical structure (or canonical text) -> the original value. */
export function deserialize(node) {
  return fromPlain(node);
}