/**
 * Row 6 self-tests: the canonical serializer (plan v5 §3 K6, ledger E1–E9 in §6).
 *
 * Every case is a ROUND TRIP checked through `jq -S`, never `deepEqual` on object key
 * order (plan §7 row 6): the comparison is the one the golden differ uses, so a key
 * order that is merely *stable* rather than sorted still compares equal, while a real
 * value difference — `-0` against `0`, say — never does.
 *
 * Run: node scripts/test-serialize.mjs     (exits 1 if any case fails)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serialize, stringify, deserialize, MAX_DEPTH } from './lib/serialize.mjs';

/** Canonical, sorted-key JSON — the exact call the golden comparator makes. */
function jqSort(json) {
  const r = spawnSync('jq', ['-S', '.'], { input: json, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`jq -S failed: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

/** A chain of `levels` nested objects, built iteratively so the test itself never recurses. */
function deepChain(levels) {
  const root = {};
  let cur = root;
  for (let i = 1; i < levels; i++) cur = cur.next = {};
  return root;
}

const CASES = [
  {
    id: 'E1',
    title: '`undefined` is a token, never a dropped key',
    make: () => ({ left: undefined, right: 4 }),
    extra({ ok, text, back }) {
      ok(text.includes('"__u":1'), 'carries the __u token');
      ok(!text.includes('null'), 'no null substituted for undefined');
      ok('left' in back, 'the key survives the round trip');
      ok(back.left === undefined, 'decode restores undefined');
    },
  },
  {
    id: 'E2',
    title: 'NaN / Infinity / -Infinity are typed tokens, never null',
    make: () => ({ nan: NaN, pos: Infinity, neg: -Infinity }),
    extra({ ok, text, back }) {
      ok(text.includes('"__nan":1'), 'NaN is __nan');
      ok(text.includes('"__inf":1'), 'Infinity is __inf');
      ok(text.includes('"__ninf":1'), '-Infinity is __ninf');
      ok(!text.includes('null'), 'no value degraded to null');
      ok(Number.isNaN(back.nan), 'decode restores NaN');
      ok(back.pos === Infinity && back.neg === -Infinity, 'decode restores both infinities');
    },
  },
  {
    id: 'E3',
    title: '-0 and 0 are different values, not the same golden',
    make: () => [{ z: -0 }, { z: 0 }],
    extra({ ok, text, trees }) {
      ok(text[0].includes('"__n0":1'), '-0 carries the __n0 token');
      ok(text[1].includes('"z":0'), '0 stays a plain 0');
      ok(Object.is(deserialize(trees[0]).z, -0), 'decode restores -0 (Object.is, not ===)');
      // The comparator is jq -S on canonical text; this is the golden-diff regression.
      ok(jqSort(text[0]) !== jqSort(text[1]), 'jq -S says the -0 and 0 fixtures are NOT equal');
    },
  },
  {
    id: 'E4',
    title: 'BigInt becomes a string token, never a raw BigInt',
    make: () => ({ mask: 2n ** 70n, neg: -2n }),
    extra({ ok, text, back }) {
      ok(text.includes('"__bi":"1180591620717411303424"'), 'magnitude kept as a decimal string');
      ok(typeof back.mask === 'bigint' && back.mask === 2n ** 70n, 'decode restores BigInt exactly');
      // The failure this row exists to prevent: a raw BigInt throws inside the sandbox.
      let threw = false;
      try {
        JSON.stringify({ mask: 2n ** 70n });
      } catch {
        threw = true;
      }
      ok(threw, 'JSON.stringify on a raw BigInt does throw (the bug being fixed)');
    },
  },
  {
    id: 'E5',
    title: 'Map / Set become insertion-ordered entries arrays',
    make: () => ({
      m: new Map([['zebra', 1], ['apple', 2], ['mango', 3]]),
      s: new Set(['zebra', 'apple', 'mango']),
    }),
    extra({ ok, text, back }) {
      ok(text.includes('[["zebra",1],["apple",2],["mango",3]]'), 'Map is an insertion-ordered entries array');
      ok(text.includes('"__set":["zebra","apple","mango"]'), 'Set is an insertion-ordered array');
      ok(back.m instanceof Map && back.s instanceof Set, 'decode restores real Map and Set');
      ok([...back.m.keys()].join() === 'zebra,apple,mango', 'restored Map keeps insertion order');
    },
  },
  {
    id: 'E6',
    title: 'Typed arrays / ArrayBuffer become {"__ta":"Uint8","v":[...]}',
    make: () => ({
      u8: new Uint8Array([1, 2, 255]),
      f64: new Float64Array([1.5, -0]),
      big: new BigInt64Array([2n]),
      buf: new Uint8Array([9, 8]).buffer,
    }),
    extra({ ok, text, trees, back }) {
      ok(trees.u8.__ta === 'Uint8', 'typed array is tagged with its short constructor name');
      ok(trees.u8.v.join() === '1,2,255', 'payload is the cell values');
      ok(trees.buf.__ta === 'ArrayBuffer', 'ArrayBuffer is tagged as itself');
      ok(text.includes('"__n0":1'), '-0 inside a typed array is a token, not a 0');
      ok(back.u8 instanceof Uint8Array && back.u8[2] === 255, 'decode restores a real Uint8Array');
      ok(Object.is(back.f64[1], -0), 'decode keeps -0 inside a Float64Array');
      ok(back.big instanceof BigInt64Array && back.big[0] === 2n, 'decode restores a BigInt64Array');
      ok(back.buf instanceof ArrayBuffer && back.buf.byteLength === 2, 'decode restores the ArrayBuffer');
    },
  },
  {
    id: 'E7',
    title: 'Cycle / shared ref goes through the id table, never re-serialized',
    make: () => {
      const shared = { tag: 'shared', n: 1 };
      const cyclic = { name: 'cyclic' };
      cyclic.self = cyclic; // a true cycle: JSON.stringify would die here
      return { first: shared, second: shared, cyclic, list: [shared], nested: { inner: shared } };
    },
    extra({ ok, text, trees, back }) {
      ok(text.includes('"__ref"'), 'the second sighting emits a __ref token');
      ok(trees.first.tag === 'shared', 'the first sighting is stored in full');
      ok(text.length < 300, 'the text is finite (cycle closed by a ref)');
      ok(back.first === back.second, 'decode restores IDENTITY for the shared ref');
      ok(back.first === back.list[0], 'the shared ref inside an array is the same object');
      ok(back.nested.inner === back.first, 'the shared ref two containers down is the same object');
      ok(back.cyclic.self === back.cyclic, 'decode restores the cycle as a real cycle');
    },
  },
  {
    id: 'E8',
    title: 'Key order is canonicalised at every level',
    make: () => [
      { zebra: 1, apple: 2, mango: { y: 1, x: 2 } },
      { mango: { x: 2, y: 1 }, apple: 2, zebra: 1 },
      // Integer-like keys: JS hoists these into ascending numeric order on BOTH sides of
      // the round trip, so the two insertion orders below still have to agree.
      { 10: 'ten', 2: 'two', x: 1 },
      { x: 1, 2: 'two', 10: 'ten' },
      { ['__proto__']: 'data', a: 1 }, // a computed key, so this is an own property
    ],
    extra({ ok, text, back }) {
      ok(text[0] === text[1], 'two insertion orders serialise BYTE-IDENTICALLY');
      ok(text[2] === text[3], 'two integer-like-key orders serialise BYTE-IDENTICALLY');
      ok(text[0].indexOf('"apple"') < text[0].indexOf('"zebra"'), 'top-level keys are sorted');
      ok(text[0].indexOf('"x"') < text[0].indexOf('"y"'), 'nested keys are sorted too');
      ok(jqSort(text[0]) === jqSort(text[1]), 'jq -S agrees the two orders are one document');
      ok(text[4].includes('"__proto__"'), 'a key named __proto__ survives as data');
      ok(Object.getPrototypeOf(back[4]) === Object.prototype, '…without touching the prototype');
      ok(back[4]['__proto__'] === 'data', '…with its value intact');
    },
  },
  {
    id: 'E9',
    title: 'Depth past 10 000 flushes error:"maxDepth" instead of blowing the stack',
    make: () => deepChain(MAX_DEPTH + 2),
    extra({ ok, text, trees, back }) {
      ok(serialize(deepChain(MAX_DEPTH + 1)).error === undefined, 'depth exactly at the cap still encodes');
      ok(trees.error === 'maxDepth', 'the reported error is exactly "maxDepth"');
      ok(trees.depth === MAX_DEPTH + 1, 'it reports the first depth over the cap');
      ok(text.includes('"maxDepth"'), 'the flushed trace carries error:"maxDepth" (plan §5 `error`)');
      ok(back.error === 'maxDepth', 'the flushed trace decodes back to error:"maxDepth"');
    },
  },
];

function runCase(c) {
  const failed = [];
  const ok = (cond, label) => {
    if (!cond) failed.push(label);
  };

  const fixtures = c.make();
  const list = Array.isArray(fixtures) ? fixtures : [fixtures];
  const trees = list.map((v) => serialize(v));
  const texts = list.map((v) => stringify(v));
  const backs = trees.map((t) => deserialize(t));

  // The round trip: canonical text of the fixture vs canonical text of what came back,
  // compared through jq -S so key order is normalised and only VALUES can differ.
  for (let i = 0; i < list.length; i++) {
    ok(jqSort(texts[i]) === jqSort(stringify(backs[i])), `jq -S round trip of fixture ${i + 1}`);
  }
  c.extra({ ok, text: texts.length === 1 ? texts[0] : texts, trees: trees.length === 1 ? trees[0] : trees, back: backs.length === 1 ? backs[0] : backs });

  const label = `${c.id} ${c.title}`;
  if (failed.length === 0) {
    console.log(`✅ ${label}`);
  } else {
    console.error(`❌ ${label} — failed: ${failed.join('; ')}`);
  }
  return failed.length;
}

function main() {
  const started = CASES.map(runCase).reduce((a, b) => a + b, 0);

  // The literal comparison the plan pins, printed so CI logs show what was compared.
  console.log(`\ncomparison: jq -S .   (fixture vs round-trip canonical text, per case)`);
  console.log(`serialize/stringify/deserialize round trips: ${CASES.length} cases, failures: ${started}`);
  console.log('========================================\n');

  if (started > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}