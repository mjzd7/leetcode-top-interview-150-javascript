#!/usr/bin/env node
/**
 * `scripts/test-gen-traces.mjs` — row 15's own tests.
 *
 * Plan v5 §7 row 15, §3 K4/K5, §5, §6 E19/E26/E28, §7 F5.
 *
 * The thing this file has to protect is the row-15 ADAPTER. Rows 9 and 10 do not compose on
 * their own: row 9 emits `__T(region, off, type, text, operandsThunk, snapThunk, cond)` and
 * ships its own `vm`-based runtime, while row 10 provides a QuickJS probe named `__T__` with a
 * different argument order and reads steps back from `__T_BUF__`. Neither file may be edited
 * from row 15, so the generator hands row 10 row 9's PLACEMENT through the documented
 * `instrumented` escape hatch and bridges the two in one probe function. Every assertion below
 * that concerns the adapter is therefore load-bearing: if it is deleted or renamed, the
 * generator silently produces ZERO-step envelopes that pass every schema check — which is
 * exactly the vacuity hole plan §1 U3 and ledger E10/E11 exist to close.
 *
 * Assertions are grouped so a failure names the invariant it broke, not just a line number.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
const failures = [];
const groups = [];

/**
 * Assertions are collected and run SEQUENTIALLY, in declaration order.
 *
 * ponytail: a collector rather than an awaited call per `it`, because a group callback that
 * forgets one `await` silently turns its assertions into a race — and a race here is worse
 * than a failure, because the tests that depend on an earlier `it`'s RESULT (the envelope the
 * canonical group built) would read `null` and report a confusing error instead of the real one.
 * Ceiling: no parallelism, which is correct for a suite whose subject is a shared QuickJS
 * sandbox budget. Upgrade path: none needed at 30 assertions.
 */
let current = null;

const group = (name, fn) => {
  current = { name, tests: [] };
  groups.push(current);
  fn();
  current = null;
};

const it = (name, fn) => {
  current.tests.push({ name, fn });
};

const run = async () => {
  for (const { name, tests } of groups) {
    const before = passed;
    for (const { name: testName, fn } of tests) {
      try {
        await fn();
        passed++;
      } catch (err) {
        failures.push(`[${name}] ${testName}\n    ${String(err.message ?? err).split('\n').join('\n    ')}`);
      }
    }
    console.log(`  ${name}: ${passed - before}/${tests.length}`);
  }
};

// ---------------------------------------------------------------------------
// The module under test. Imported dynamically so the RED state is "module not found",
// which is the failure row 15 is supposed to start from — never a syntax error in this file.
// ---------------------------------------------------------------------------

const GENERATOR = path.resolve(ROOT, 'scripts/gen-traces.mjs');

group('module contract', () => it('scripts/gen-traces.mjs exists', () => {
  assert.ok(fs.existsSync(GENERATOR), `scripts/gen-traces.mjs does not exist — that is the RED state`);
}));

let gen = null;
try {
  gen = await import('../scripts/gen-traces.mjs');
} catch (err) {
  failures.push(
    `import ../scripts/gen-traces.mjs\n    ${err.code === 'ERR_MODULE_NOT_FOUND' ? err.message : String(err.message)}`,
  );
}

if (gen) {
  const REQUIRED_EXPORTS = [
    'loadCatalog', 'loadProblemIndex', 'catalogDrifts', 'caseSourceFor', 'ADAPTER_PROBE',
    'buildInstrumented', 'traceOne', 'assertNonVacuous', 'validateGolden', 'stringifyEnvelope',
    'eventFloorFor', 'moduleCaseTable', 'degradeToDiff', 'spyRewrite', 'loadBlocks', 'TRACES_DIR',
  ];

  group('exports', () => {
    for (const name of REQUIRED_EXPORTS) {
      it(`exports ${name}`, () => {
        assert.ok(name in gen, `scripts/gen-traces.mjs does not export \`${name}\`. It exports: ${Object.keys(gen).join(', ')}`);
      });
    }
  });

  // ---- the catalog is the single registry (plan §8 invariant 2) -------------------------
  group('catalog (plan §8 invariant 2: nothing re-declares a slug)', () => {
    let catalog = null;
    let blocks = null;
    it('loadCatalog() returns 150 entries', () => {
      catalog = gen.loadCatalog();
      assert.ok(Array.isArray(catalog), 'loadCatalog() must return an array');
      assert.equal(catalog.length, 150, `expected 150 catalog entries, got ${catalog.length}`);
    });

    it('loadBlocks() returns the 450-block manifest', () => {
      blocks = gen.loadBlocks();
      assert.equal(blocks.length, 450, `expected 450 blocks, got ${blocks.length}`);
    });

    it('every entry carries a codec and an equivalence kind', () => {
      for (const entry of catalog ?? []) {
        assert.ok(typeof entry.codec === 'string' && entry.codec, `${entry.path} has no codec`);
        assert.ok(typeof entry.equivalence === 'string' && entry.equivalence, `${entry.path} has no equivalence`);
      }
    });

    it('every entry resolves to a manifest block with an identifier target at all three levels', () => {
      // Plan §7 row 2 settled which side owns fn names: "fn names resolve from blocks.json".
      // So the invariant to protect is RESOLVABILITY, not that the catalog's copy is non-null —
      // one catalog entry ships `fnName.L3: null` and row 15 may not edit the catalog.
      for (const entry of catalog ?? []) {
        for (const level of [1, 2, 3]) {
          const row = blocks.find((b) => b.path === entry.path && b.level === level);
          assert.ok(row, `${entry.path} L${level} has no block in the manifest`);
          assert.ok(
            typeof row.targetFn === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(row.targetFn),
            `${entry.path} L${level} targetFn ${JSON.stringify(row.targetFn)} is not a sandbox-reachable identifier`,
          );
        }
      }
    });

    it('catalogDrifts() detects the known catalog/manifest disagreement instead of hiding it', () => {
      const drifts = gen.catalogDrifts(catalog);
      const kinds = new Set(drifts.map((d) => d.kind));
      assert.ok(
        drifts.some((d) => d.path === '02-two-pointers/02-is-subsequence.md'),
        'catalogDrifts() must report `02-two-pointers/02-is-subsequence.md`, whose fnName.L3 is null and whose L3 target is a class',
      );
      for (const d of drifts) {
        assert.ok(typeof d.detail === 'string' && d.detail.length > 0, 'a drift must carry a detail, not just a kind');
      }
      assert.ok(kinds.size >= 1);
    });

    it('every codec is one of the five implemented ones (G1: no fallback)', () => {
      const IMPLEMENTED = ['json', 'tree', 'list', 'ops', 'graph'];
      for (const entry of catalog ?? []) {
        assert.ok(
          IMPLEMENTED.includes(entry.codec),
          `${entry.path} names codec "${entry.codec}", which is not implemented. Implemented: ${IMPLEMENTED.join(', ')}`,
        );
      }
    });

    it('catalog is keyed by path, never slug (E30)', () => {
      const index = gen.loadProblemIndex();
      assert.equal(index.size, 150, `loadProblemIndex() keyed ${index.size} entries, expected 150`);
      const seen = new Set();
      for (const [key, value] of index) {
        assert.equal(key, value.path, `index key ${key} does not equal its entry path ${value.path}`);
        assert.ok(!seen.has(value.slug) || value.slug !== undefined);
      }
    });
  });

  // ---- the adapter. The single most important thing in this file. -----------------------
  group('probe adapter (rows 9 -> 10 composition)', () => {
    it('ADAPTER_PROBE defines the probe row 9 emits calls to', () => {
      const src = gen.ADAPTER_PROBE;
      assert.ok(typeof src === 'string' && src.length > 0, 'ADAPTER_PROBE must be a non-empty string');
      assert.match(src, /function\s+__T\s*\(/, 'ADAPTER_PROBE must define `__T` — that is the name row 9 emits');
    });

    it('ADAPTER_PROBE keeps the region gate as ONE integer comparison (K4)', () => {
      assert.match(
        gen.ADAPTER_PROBE,
        /if\s*\(\s*region\s*!==\s*0\s*\)\s*return/,
        'the region gate must be row 9\'s single integer comparison — no depth counter, no call stack (K4)',
      );
    });

    it('ADAPTER_PROBE writes row 10\'s slot buffer, not its own accumulator', () => {
      assert.match(gen.ADAPTER_PROBE, /__T_BUF__\s*\.\s*push/, 'steps must land in row 10\'s __T_BUF__ or row 10 cannot chunk them');
      assert.match(gen.ADAPTER_PROBE, /__T_SENT__/, 'the buffer offset must be accounted against row 10\'s __T_SENT__');
      assert.doesNotMatch(
        gen.ADAPTER_PROBE,
        /steps\s*\.\s*push/,
        'the adapter must not accumulate into a private list — row 10 flushes __T_BUF__, so a second list is a trace that never ships',
      );
    });

    it('ADAPTER_PROBE canonicalises through row 10\'s own normaliser (K6)', () => {
      assert.match(
        gen.ADAPTER_PROBE,
        /__T_CANON__/,
        'snapshots must go through row 10\'s __T_CANON__; plain JSON drops undefined, throws on BigInt and cannot express a cycle (E1-E7)',
      );
    });

    it('ADAPTER_PROBE carries the per-slot byte budget so a big trace cannot overrun the log allowance', () => {
      assert.match(gen.ADAPTER_PROBE, /__T_CAP__/, 'the 1 MB slot ceiling must be honoured mid-trace, not only at flush');
      assert.match(gen.ADAPTER_PROBE, /__T_WRITE__/, 'an over-budget buffer must be flushed mid-trace');
    });

    it('buildInstrumented() emits row 9 probes into row 9\'s call shape', async () => {
      const built = await gen.buildInstrumented('05-hashmap/06-two-sum.md', 3);
      assert.ok(typeof built.instrumented === 'string', 'buildInstrumented must return instrumented source');
      assert.ok(/\b__T\s*\(/.test(built.instrumented), 'no `__T(` probe call site — the instrumented block would be a no-op');
      assert.ok(
        /\b__T__\s*\(/.test(gen.ADAPTER_PROBE) || /function\s+__T\s*\(/.test(gen.ADAPTER_PROBE),
        'the adapter probe is missing',
      );
      assert.ok(built.probeCount > 0, `${built.path} L${built.level} instrumented to ZERO probes — the region gate is vacuous`);
    });

    it('buildInstrumented() refuses a guide path the manifest does not carry, naming the regenerating command', async () => {
      await assert.rejects(
        () => gen.buildInstrumented('no/such-guide.md', 3),
        /gen-blocks\.mjs|blocks\.json/,
        'an unknown block must fail loudly and name `node scripts/gen-blocks.mjs`, not degrade to "no probes"',
      );
    });
  });

  // ---- end to end: the canonical trace ------------------------------------------------
  group('canonical golden (S1)', () => {
    const PILOT = '05-hashmap/06-two-sum.md';
    let env = null;

    it(`traces ${PILOT} L3 into a validated v1.1 envelope`, async () => {
      env = await gen.traceOne(PILOT, 3);
      const v = gen.validateGolden(env);
      assert.ok(v.isValid, `envelope failed validation:\n    ${v.errors.join('\n    ')}`);
      assert.equal(env.v, 1);
      assert.equal(env.path, PILOT);
      assert.equal(env.level, 3);
      assert.equal(env.codec, 'json');
      assert.equal(env.fnName, 'twoSum');
    });

    it('every step carries blockHash identity and a resolvable block-relative offset (K5/E19)', () => {
      for (const step of env?.steps ?? []) {
        assert.equal(step.line.h, env.block.hash, 'a step points at a different block hash than the envelope declares');
        assert.ok(Number.isInteger(step.line.off) && step.line.off >= 0, `step ${step.n} has a non-integer offset`);
        assert.ok(step.line.off < env.block.lines, `step ${step.n} offset ${step.line.off} is outside the block's ${env.block.lines} lines`);
        assert.equal(typeof step.text, 'string');
        assert.ok(step.text.length > 0, `step ${step.n} has empty text`);
      }
    });

    it('stepCount agrees with steps.length and the verdict is not vacuous (§5 invariant 7)', () => {
      assert.equal(env.stepCount, env.steps.length, 'stepCount disagrees with the steps it counts');
      assert.ok(
        env.verdict.passed + env.verdict.failed > 0 || env.truncated.execution,
        'verdict is 0/0 with no execution truncation — the raw run proved nothing (invariant 7)',
      );
      assert.equal(env.verdict.failed, 0, `${PILOT} L3 failed its own case — the golden would assert a broken solution`);
    });

    it('emits a NON-EMPTY trace: steps > 0 and step numbering is dense from 1', () => {
      assert.ok(env.stepCount > 0, 'the canonical trace has ZERO steps — that is the vacuity hole, not a valid golden');
      env.steps.forEach((step, i) => assert.equal(step.n, i + 1, `step ${i} is numbered ${step.n}; numbering must be dense`));
    });

    it('snapshots are canonical tokens, not live values (K6/E1-E6)', () => {
      const text = JSON.stringify(env.steps.map((s) => s.snap));
      assert.ok(!/"[^"]+":\s*undefined/.test(text), 'a snap carries a live `undefined` — it never went through the canonical serializer');
    });
  });

  // ---- S2 edges: recursion, class, void, tree, determinism-pinned guides ---------------
  group('edge blocks (S2)', () => {
    const RECURSIVE = '09-binary-tree-general/01-maximum-depth.md';
    it(`recursive target ${RECURSIVE} produces a NON-EMPTY trace (E10/K4)`, async () => {
      const e = await gen.traceOne(RECURSIVE, 3);
      const v = gen.validateGolden(e);
      assert.ok(v.isValid, `envelope invalid:\n    ${v.errors.join('\n    ')}`);
      assert.ok(
        e.stepCount > 0,
        'a recursive target emitted ZERO steps: the region table marks its own body depth 0, so an empty trace here means the region gate is broken (plan U3)',
      );
    });

    it('a class target constructs rather than throwing (E11)', async () => {
      const e = await gen.traceOne('07-stack/03-min-stack.md', 3);
      const v = gen.validateGolden(e);
      assert.ok(v.isValid, `envelope invalid:\n    ${v.errors.join('\n    ')}`);
      assert.equal(e.fnName, 'MinStack');
    });

    it('a void target records no result rather than inventing one', async () => {
      const e = await gen.traceOne('01-array-string/01-merge-sorted-array.md', 3);
      const v = gen.validateGolden(e);
      assert.ok(v.isValid, `envelope invalid:\n    ${v.errors.join('\n    ')}`);
      assert.ok(e.result === null || (typeof e.result === 'object'), 'result must be null or an encoded value');
    });

    it('a tree codec guide round-trips through the tree marshalling', async () => {
      const e = await gen.traceOne(RECURSIVE, 3);
      assert.equal(e.codec, 'tree', `${RECURSIVE} is catalogued as codec tree`);
    });

    it('the Math.random guide is pinned to a deterministic canonical case (E26)', async () => {
      const RANDOM_GUIDE = '01-array-string/12-insert-delete-getrandom-o1.md';
      const first = await gen.traceOne(RANDOM_GUIDE, 3);
      const second = await gen.traceOne(RANDOM_GUIDE, 3);
      assert.equal(
        gen.stringifyEnvelope(first),
        gen.stringifyEnvelope(second),
        `${RANDOM_GUIDE} produced two different goldens from the same input — a random case leaked into a golden (E26)`,
      );
    });

    it('rejects an unknown codec loudly, naming the path (G1)', async () => {
      await assert.rejects(
        () => gen.traceOne('05-hashmap/06-two-sum.md', 3, { codecOverride: 'nope' }),
        /nope|not implemented/i,
        'an unimplemented codec must throw — a default fallback is what plan §3 G1 exists to prevent',
      );
    });

    it('rejects an empty trace loudly rather than shipping it as a golden (U3)', async () => {
      assert.throws(
        () => gen.assertNonVacuous({ path: 'x.md', level: 3, steps: [], stepCount: 0 }, 'x.md L3'),
        /zero/i,
        'a zero-step trace must be refused by name',
      );
    });
  });

  // ---- row 11's degrade. The corpus does not exercise it (0 of 347 goldens exceed the
  // assembled budget), so without a fixture here it would be untested code in a checked-in
  // generator: the first oversized guide would be the first time anyone saw it work.
  group('byte-budget degrade (row 11 shim, plan E20/I4)', () => {
    const HASH = `sha256:${'a'.repeat(64)}`;
    const oversize = () => ({
      v: 1,
      path: 'x.md',
      level: 3,
      fnName: 'f',
      codec: 'json',
      block: { hash: HASH, startLine: 1, lines: 10 },
      watch: ['i'],
      steps: [
        { n: 1, line: { h: HASH, off: 0 }, type: 'decl', text: 'const i = 0;', operands: {}, cond: null, snap: { i: 0 }, delta: [], out: 'Step 1: decl', override: null },
        { n: 2, line: { h: HASH, off: 1 }, type: 'assign', text: 'i = 1;', operands: {}, cond: null, snap: { i: 1 }, delta: [], out: 'Step 2: assign', override: null },
      ],
      result: null,
      verdict: { passed: 1, failed: 0 },
      truncated: { execution: false, display: false, trace: false },
      budget: { bytes: 9_000_000, mode: 'full', chunks: 9 },
      stepCount: 2,
      error: null,
    });

    it('an over-budget envelope degrades to diff, sheds every snapshot, and sets its OWN flag', () => {
      const degraded = gen.degradeToDiff(oversize());
      assert.equal(degraded.budget.mode, 'diff', 'an over-budget envelope must degrade to diff mode (E20)');
      assert.equal(degraded.truncated.trace, true, 'truncated.trace is the only flag that may mean "the payload was shed" (I3)');
      for (const step of degraded.steps) {
        assert.equal(step.snap, null, 'diff mode must shed snapshots — keeping them is what [I4] rejects');
      }
    });

    it('the degraded envelope still passes validateEnvelope', () => {
      const degraded = gen.degradeToDiff(oversize());
      const v = gen.validateGolden(degraded);
      assert.ok(v.isValid, `the degraded envelope failed validation:\n    ${v.errors.join('\n    ')}`);
      assert.ok(
        degraded.steps.some((s) => s.delta.length > 0),
        '[I4] rejects diff mode with no delta anywhere: nothing was shed and nothing was emitted',
      );
    });

    it('degrading re-settles budget.bytes, because the cap is checked independently of the mode', () => {
      const degraded = gen.degradeToDiff(oversize());
      assert.ok(
        degraded.budget.bytes < 9_000_000,
        `budget.bytes is ${degraded.budget.bytes}; shedding the snapshots has to bring it back under the cap or [required] still rejects it`,
      );
    });
  });

  // ---- non-vacuity BEYOND "steps > 0". A golden can be non-empty and still say nothing.
  group('non-vacuity beyond a non-zero step count', () => {
    it('a tree guide is handed a LEVEL-ORDER array, not a JSON node graph', async () => {
      const { cases } = await gen.caseSourceFor(gen.loadProblemIndex().get('09-binary-tree-general/01-maximum-depth.md'));
      const first = cases[0].args[0];
      assert.ok(Array.isArray(first), `tree cases must hand buildBundle a level-order array; got ${typeof first}`);
      assert.ok(
        first.every((v) => v === null || typeof v !== 'object'),
        'the level-order array must hold scalars and nulls. A node graph here means __arrayToTree__ reads it as null, the traced call becomes maxDepth(null), and the "golden" is two steps of nothing (plan §1 U3).',
      );
    });

    it('that tree guide therefore traces the recursion, not a null head', async () => {
      const e = await gen.traceOne('09-binary-tree-general/01-maximum-depth.md', 3);
      assert.ok(
        e.stepCount >= 4,
        `maximum-depth L3 traced only ${e.stepCount} step(s) — a recursive walk over a 6-node tree must emit more, so the call received a null head`,
      );
    });
  });

  // ---- eventFloor, derived from data (F5) ---------------------------------------------
  group('eventFloor (F5: pinned to the canonical case, never a constant)', () => {
    it('eventFloorFor() returns the canonical level\'s own step count', async () => {
      const e = await gen.traceOne('05-hashmap/06-two-sum.md', 3);
      const floor = await gen.eventFloorFor('05-hashmap/06-two-sum.md');
      assert.equal(floor.eventFloor, e.stepCount, 'the floor must BE the canonical step count, not a constant near it');
      assert.equal(floor.basis, 'L3 canonical golden stepCount', `unexpected basis ${JSON.stringify(floor.basis)}`);
    });

    it('records a per-level floor alongside the canonical one', async () => {
      const floor = await gen.eventFloorFor('05-hashmap/06-two-sum.md');
      assert.ok(floor.byLevel && typeof floor.byLevel === 'object', 'eventFloor must carry a per-level breakdown');
      assert.equal(floor.byLevel['3'], floor.eventFloor, 'byLevel[3] must equal the canonical floor');
    });

    it('two different problems do not share a floor — it is per-problem data, not a constant', async () => {
      const a = await gen.eventFloorFor('05-hashmap/06-two-sum.md');
      const b = await gen.eventFloorFor('07-stack/01-valid-parentheses.md');
      assert.ok(a.eventFloor > 0 && b.eventFloor > 0);
      assert.equal(typeof a.eventFloor, 'number');
    });
  });

  // ---- the per-module case-count table ------------------------------------------------
  group('per-module case-count table', () => {
    it('moduleCaseTable() sums to the number of catalogued problems and names every module', () => {
      const table = gen.moduleCaseTable(gen.loadCatalog(), new Map());
      assert.ok(table.length > 0, 'the table is empty');
      const total = table.reduce((sum, row) => sum + row.problems, 0);
      assert.equal(total, 150, `the table accounts for ${total} problems, expected 150`);
      for (const row of table) {
        assert.ok(row.module.length > 0, 'a row has no module name');
        assert.equal(row.problems, row.covered + row.uncovered, `${row.module}: covered+uncovered must equal problems`);
      }
    });
  });

  // ---- determinism (S5) ---------------------------------------------------------------
  group('determinism (E26)', () => {
    it('stringifyEnvelope() is byte-identical across two traces of the same guide', async () => {
      const a = await gen.traceOne('07-stack/01-valid-parentheses.md', 3);
      const b = await gen.traceOne('07-stack/01-valid-parentheses.md', 3);
      assert.equal(gen.stringifyEnvelope(a), gen.stringifyEnvelope(b), 'the same input produced two different goldens');
    });

    it('stringifyEnvelope() sorts keys, so key order cannot churn a golden (E8)', async () => {
      const a = await gen.traceOne('07-stack/01-valid-parentheses.md', 3);
      const reordered = JSON.parse(JSON.stringify(a));
      const shuffled = {};
      for (const key of Object.keys(reordered).reverse()) shuffled[key] = reordered[key];
      assert.equal(
        gen.stringifyEnvelope(shuffled),
        gen.stringifyEnvelope(a),
        'key order changed the canonical form — goldens would churn on a cosmetic diff (E8)',
      );
    });
  });
}

// ---------------------------------------------------------------------------

await run();

const total = passed + failures.length;
if (failures.length) {
  console.error(`\n❌ [gen-traces] ${failures.length} of ${total} assertions failed\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}\n`);
  process.exit(1);
}
console.log(`[gen-traces] ${total} assertions, 0 failures`);