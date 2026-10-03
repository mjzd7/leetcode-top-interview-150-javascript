import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getCodec, driverCodecSource, equivalent } from './codecs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.resolve(here, '../../judge/tests');
const CATALOG_PATH = path.resolve(here, '../../catalog/problems.json');

// Identity — path, slug, codec, canonical fn name — is owned by catalog/problems.json, and
// nothing here declares it: no slug list, no codec whitelist. A judge spec owns only its cases.
// Judging whether a codec is implemented is row 17's `codecs.mjs` job, not this module's.
//
// ponytail: reads catalog/ + judge/tests/ off disk at import and parses the 81 KB catalog per
// cold start, so both directories must ship in the bundle (they do — neither is in
// .vercelignore). When the pilot outgrows a directory of hand-authored specs, swap the two
// reads for an import.meta.glob over the row-15 trace corpus.
const BY_PATH = new Map(
  JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8')).problems.map((p) => [p.path, p]),
);

// E30: the registry is keyed by path. The route's contract is a slug `problemId`, so the slug
// index is a lookup convenience only — a shared slug is an error, never a silent overwrite.
const BY_SLUG = new Map();
for (const entry of BY_PATH.values()) {
  const first = BY_SLUG.get(entry.slug);
  if (first) throw new Error(`Catalog slug "${entry.slug}" is shared by ${first.path} and ${entry.path}`);
  BY_SLUG.set(entry.slug, entry);
}

/** Pilot registry: slug -> { slug, path, fnName, codec, tests }. */
export const PROBLEMS = {};
for (const file of fs.readdirSync(TESTS_DIR)) {
  if (!file.endsWith('.json')) continue;
  const slug = file.replace(/\.json$/, '');
  const entry = BY_SLUG.get(slug);
  if (!entry?.fnName?.L3) {
    throw new Error(`No canonical identity in catalog/problems.json for pilot spec: ${slug}`);
  }
  const { tests } = JSON.parse(fs.readFileSync(path.join(TESTS_DIR, file), 'utf-8'));
  if (!Array.isArray(tests) || tests.length === 0) {
    throw new Error(`Invalid test spec for problem: ${slug}`);
  }
  PROBLEMS[slug] = {
    slug,
    path: entry.path,
    fnName: entry.fnName.L3,
    codec: entry.codec,
    equivalence: entry.equivalence,
    returnType: entry.returnType,
    tests,
  };
}

export function isPilotProblem(problemId) {
  return Object.prototype.hasOwnProperty.call(PROBLEMS, problemId);
}

/**
 * The catalog's declaration for one guide path — the identity `problems.mjs` does not own.
 *
 * `build/blocks.json` owns which function a LEVEL traces; `catalog/problems.json` owns what
 * comparing that function's answer MEANS (`equivalence`) and what it gives back
 * (`returnType`). The driver needs the second and never had it, which is why it fell back to
 * `===` on JSON text and why `void` had nowhere to go.
 *
 * @returns {{path: string, codec: string, equivalence: string, returnType: string}|null}
 */
export function catalogFor(guidePath) {
  const entry = BY_PATH.get(guidePath);
  if (!entry) return null;
  return {
    path: entry.path,
    codec: entry.codec,
    equivalence: entry.equivalence,
    returnType: entry.returnType,
  };
}

/**
 * Build one self-contained bundle: user code + driver. The driver prints a
 * single `__VERDICT__<json>` line; everything else on stdout is user noise.
 *
 * Notes:
 * - `__JUDGE_LOG__` snapshots the pristine console.log BEFORE user code runs,
 *   so user reassignments cannot swallow the verdict envelope.
 * - `fnName` comes from the catalog (never user input) — safe to inline.
 * - The driver carries NO codec of its own. `driverCodecSource()` hands it this
 *   registry's own bodies (`toWire`/`fromWire`/`owns`/`acceptsWire` plus E28's six
 *   comparators) as source text, because the sandbox has no module loader and a
 *   hand-written second copy is the second source of truth plan §1 U2 forbids.
 *
 * Four mechanisms this driver used to get wrong, all now decided by the codec that owns the
 * value rather than by a hard-coded branch:
 *
 * 1. IN-PLACE MUTATOR — `merge(nums1, m, nums2, n)` has no `return`. When the call yields
 *    `undefined` AND the case states an expectation, the answer is the first argument the
 *    call changed, snapshotted through the same `toWire` the return path uses.
 * 2. SCALAR RETURN — `maxDepth(root)` returns the number `3`. Encoding that through `tree`
 *    yields `[null]`, and `[null] === 3` is a verdict that can never be anything but wrong,
 *    so `owns` gates it: a value the codec does not own is compared as it is.
 * 3. LIST NODE — `addTwoNumbers` wants `ListNode`s and returns one; the codec both decodes
 *    the argument and encodes the result, so the comparison is array-to-array.
 * 4. CLASS TARGET — `new RandomizedSet()` cannot be `.apply`'d. Detected from the target's
 *    own source (`String(__FN__)`), which is also why the traced run still works: row 10's
 *    `buildWrapper` replaces the class with a plain function, so that run correctly applies.
 *
 * ponytail: `equivalence` defaults to `'exact'`, the STRICTEST of E28's six, so a caller that
 * states nothing can never manufacture a pass it would not otherwise earn — and all five
 * pilot specs are `exact` or `order-insensitive` over already-canonical answers. Ceiling: the
 * driver does not take `returnType`, because "the call returned `undefined`" is the same fact
 * observed directly rather than read from a catalog field. Upgrade path: a guide whose target
 * returns `undefined` while ALSO stating an expectation about something other than a mutated
 * argument needs an explicit `expect: 'arg'|'return'` per case; no corpus case needs it.
 */
export function buildBundle({ userCode, fnName, codec, tests, equivalence = 'exact' }) {
  // Both names are validated HOST-side, before a byte of driver is emitted: an unimplemented
  // codec or an unknown E28 kind throws here, loudly, exactly as `getCodec`/`equivalent` do
  // everywhere else. There is no default branch in the sandbox either — see `__CODEC__`.
  getCodec(codec, fnName);
  equivalent(equivalence, null, null);
  // Row 15 / S22 — the derivation replay. A harvested case records what the authored script
  // asserted AFTER its own post-processing (`normCombos(fn(4, 2))` is comma-joined STRINGS), while
  // this driver compares the target's RAW return. No equivalence kind bridges that:
  // `equivalent('order-insensitive', ['1,2','1,3'], [[1,2],[1,3]])` is `false`, because
  // order-insensitive forgives ORDERING, not REPRESENTATION. So the author's own derivation is
  // replayed here, in the driver's own words.
  //
  // Read off the RAW array, BEFORE it is serialised: `harvestCases` parks the code as a non-index
  // own property, which `JSON.stringify` drops by design — so this is the only place it exists, and
  // reading it here is what keeps the change out of every signature and schema in the system.
  const viaCode = tests?.viaCode ?? '';
  return [
    `var __JUDGE_LOG__ = console.log.bind(console);`,
    userCode,
    `;(function () {`,
    `  var __TESTS__ = ${JSON.stringify(tests)};`,
    `  var __FN_NAME__ = ${JSON.stringify(fnName)};`,
    `  var __KIND__ = ${JSON.stringify(equivalence)};`,
    driverCodecSource(),
    // INSIDE the IIFE, and AFTER `driverCodecSource()`, for one measured reason. A derivation
    // expression references helpers that come from the guide's own block (`listToArray`,
    // `treeToArray`, `graphToAdj`), which `userCode` above declares in the ENCLOSING scope — so
    // inside the IIFE they resolve through the closure with no redeclaration at all. The filter
    // that guarantees none of them is re-declared lives in `gen-traces.mjs`
    // (`collectDerivations`/`DRIVER_DECLARED`): emitting a helper here that shares a name with
    // `driverCodecSource()`'s own would shadow the codec's encoder for the whole run, which is
    // what killed four authored scripts the first time this shipped.
    `  var __VIA_FNS__ = {};`,
    ...(viaCode ? viaCode.split('\n').map((line) => `  ${line}`) : []),
    `  var __CODEC__ = __CODECS__[${JSON.stringify(codec)}];`,
    `  var __CMP__ = __COMPARATORS__[__KIND__];`,
    `  if (!__CODEC__ || !__CMP__) {`,
    `    throw new Error('driver: codec ' + ${JSON.stringify(codec)} + ' with equivalence ' + __KIND__ + ' is not in the registry');`,
    `  }`,
    `  function __errText__(e) {`,
    `    if (e && typeof e === 'object') {`,
    `      var head = (e.name ? e.name + ': ' : '') + (e.message || '');`,
    `      var st = e.stack || '';`,
    `      if (st && head && st.indexOf(head) === -1) return head + '\\n' + st;`,
    `      return st || head || String(e);`,
    `    }`,
    `    return String(e);`,
    `  }`,
    // One snapshot rule for every codec: a value the codec owns is reduced to its WIRE first,
    // so comparing "did this argument change" cannot be answered by an object graph that
    // stringifies to `{}`.
    `  function __snap__(v) { return stringify(__CODEC__.owns(v) ? __CODEC__.toWire(v) : v); }`,
    `  var __RESULT__ = { passed: 0, failed: 0, tests: [], error: null };`,
    `  try {`,
    `    var __FN__ = eval(__FN_NAME__);`,
    `    if (typeof __FN__ !== 'function') throw new Error('Function ' + __FN_NAME__ + ' is not defined');`,
    `    var __IS_CLASS__ = false;`,
    `    try { __IS_CLASS__ = /^\\s*class[\\s{]/.test(String(__FN__)); } catch (e) { __IS_CLASS__ = false; }`,
    `    for (var ti = 0; ti < __TESTS__.length; ti++) {`,
    `      var t = __TESTS__[ti];`,
    `      var got;`,
    `      var ok = false;`,
    `      var errText = null;`,
    `      try {`,
    // Only a value that IS this codec's canonical wire is decoded. A tree guide whose target
    // takes a plain array (`buildTree(preorder, inorder)`, `sortedArrayToBST(nums)`) keeps it.
    `        var args = (t.args || []).map(function (a) { return __CODEC__.acceptsWire(a) ? __CODEC__.fromWire(a) : a; });`,
    `        var before = args.map(__snap__);`,
    `        var r = __IS_CLASS__ ? Reflect.construct(__FN__, args) : __FN__.apply(null, args);`,
    // Row 15 / S22: replay the derivation the AUTHOR applied, immediately AFTER the call and
    // BEFORE the codec's `owns`/`toWire` below. That position is the whole point — after the call,
    // because the derivation is a function OF the return; before `toWire`, because the codec must
    // encode the value the author actually asserted (`normCombos` gives strings, which `json`
    // passes straight through) rather than the raw graph it was derived from. A case with no
    // `via`, or a key with no registry entry, keeps the raw return, so a guide with no derivation
    // is byte-identical to before.
    //
    // ── It takes the RETURN, not the target and the arguments ────────────────────────────────
    // The registry is called as `fn(r)`, so the target is invoked EXACTLY ONCE per case. Handing
    // it `(fn, args)` instead — which looks equivalent, because the derivation text is written
    // `__FN__.apply(null, __ARGS__)` — calls the target a SECOND time, and for a target that
    // mutates its argument in place that is not a redundant call, it is a corrupted one:
    // `mergeTwoLists(a, c)` relinks `a`'s own nodes into the result, so the second call walks a
    // chain that is no longer a list and never terminates. Measured: 4 linked-list blocks and
    // 2 divide-conquer blocks went from `passed 6 failed 0` to `passed 0 failed 0` with the
    // driver reporting `Time Limit Exceeded` and the target entered exactly twice.
    //
    // So the derivation is applied to the value the call already produced. The corpus's shapes both
    // reduce to that: `normCombos(fn(4,2))` becomes `normCombos(r)` and `fn(t1,…).val` becomes
    // `r.val`, because the substituted call is the outermost expression the derivation is built on.
    `        if (t.via && __VIA_FNS__[t.via]) r = __VIA_FNS__[t.via](r);`,
    `        if (r === undefined && t.expected !== undefined) {`,
    // A void target's answer is an ARGUMENT. Prefer the one the call actually changed, and
    // fall back to the first: `merge([1], 1, [], 0)` has nothing to merge, so it changes
    // nothing, and the authored edge case still expects the argument back (`[1]`). The
    // fallback is only reachable when NO argument moved, so it can never overrule evidence.
    `          var __ai__ = 0;`,
    `          while (__ai__ < args.length && __snap__(args[__ai__]) === before[__ai__]) __ai__++;`,
    `          if (args.length > 0) {`,
    `            var __a__ = args[__ai__ < args.length ? __ai__ : 0];`,
    `            got = __CODEC__.owns(__a__) ? __CODEC__.toWire(__a__) : __a__;`,
    `          } else {`,
    `            got = undefined;`,
    `          }`,
    `        } else {`,
    `          got = __CODEC__.owns(r) ? __CODEC__.toWire(r) : r;`,
    `        }`,
    `        ok = __CMP__(t.expected, got);`,
    `      } catch (e) { errText = __errText__(e); }`,
    `      if (ok) { __RESULT__.passed++; } else { __RESULT__.failed++; }`,
    `      __RESULT__.tests.push({ name: t.name, ok: ok, expected: t.expected, got: errText !== null ? undefined : got, error: errText });`,
    `    }`,
    `  } catch (e) {`,
    `    __RESULT__.error = __errText__(e);`,
    `  }`,
    `  __JUDGE_LOG__('__VERDICT__' + JSON.stringify(__RESULT__));`,
    `})();`,
  ].join('\n');
}
