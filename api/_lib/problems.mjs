import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  PROBLEMS[slug] = { slug, path: entry.path, fnName: entry.fnName.L3, codec: entry.codec, tests };
}

export function isPilotProblem(problemId) {
  return Object.prototype.hasOwnProperty.call(PROBLEMS, problemId);
}

/**
 * Build one self-contained bundle: user code + driver. The driver prints a
 * single `__VERDICT__<json>` line; everything else on stdout is user noise.
 *
 * Notes:
 * - `__JUDGE_LOG__` snapshots the pristine console.log BEFORE user code runs,
 *   so user reassignments cannot swallow the verdict envelope.
 * - `fnName` comes from the catalog (never user input) — safe to inline.
 * - Tree codec converts level-order arrays to/from linked node objects.
 * - ponytail: `tree` is the ONLY codec this driver marshals; `list`/`graph`/`ops` fall
 *   through to the raw-args branch, so their verdicts are wrong until row 17 routes every
 *   codec through `codecs.mjs`. Nothing here gates them — that silence is the bug surface.
 */
export function buildBundle({ userCode, fnName, codec, tests }) {
  return (
    `var __JUDGE_LOG__ = console.log.bind(console);\n` +
    `${userCode}\n` +
    `;(function () {\n` +
    `  var __TESTS__ = ${JSON.stringify(tests)};\n` +
    `  var __FN_NAME__ = ${JSON.stringify(fnName)};\n` +
    `  var __CODEC__ = ${JSON.stringify(codec)};\n` +
    `  var __RESULT__ = { passed: 0, failed: 0, tests: [], error: null };\n` +
    `  function __ser__(v) { return typeof v === 'undefined' ? '__undefined__' : JSON.stringify(v); }\n` +
  `  function __errText__(e) {\n` +
  `    if (e && typeof e === 'object') {\n` +
  `      var head = (e.name ? e.name + ': ' : '') + (e.message || '');\n` +
  `      var st = e.stack || '';\n` +
  `      if (st && head && st.indexOf(head) === -1) return head + '\\n' + st;\n` +
  `      return st || head || String(e);\n` +
  `    }\n` +
  `    return String(e);\n` +
  `  }\n` +
    `  function __arrayToTree__(arr) {\n` +
    `    if (!arr || arr.length === 0 || arr[0] === null || arr[0] === undefined) return null;\n` +
    `    function N(val, left, right) { return { val: val, left: left === undefined ? null : left, right: right === undefined ? null : right }; }\n` +
    `    var root = N(arr[0], null, null);\n` +
    `    var queue = [root];\n` +
    `    var i = 1;\n` +
    `    while (i < arr.length) {\n` +
    `      var node = queue.shift();\n` +
    `      if (i < arr.length && arr[i] !== null && arr[i] !== undefined) { node.left = N(arr[i], null, null); queue.push(node.left); }\n` +
    `      i++;\n` +
    `      if (i < arr.length && arr[i] !== null && arr[i] !== undefined) { node.right = N(arr[i], null, null); queue.push(node.right); }\n` +
    `      i++;\n` +
    `    }\n` +
    `    return root;\n` +
    `  }\n` +
    `  function __treeToArray__(root) {\n` +
    `    if (root === null || root === undefined) return [];\n` +
    `    var out = [];\n` +
    `    var queue = [root];\n` +
    `    while (queue.length > 0) {\n` +
    `      var node = queue.shift();\n` +
    `      if (node === null || node === undefined) { out.push(null); continue; }\n` +
    `      out.push(node.val);\n` +
    `      queue.push(node.left === undefined ? null : node.left);\n` +
    `      queue.push(node.right === undefined ? null : node.right);\n` +
    `    }\n` +
    `    while (out.length > 0 && out[out.length - 1] === null) out.pop();\n` +
    `    return out;\n` +
    `  }\n` +
    `  try {\n` +
    `    var __FN__ = eval(__FN_NAME__);\n` +
    `    if (typeof __FN__ !== 'function') throw new Error('Function ' + __FN_NAME__ + ' is not defined');\n` +
    `    for (var ti = 0; ti < __TESTS__.length; ti++) {\n` +
    `      var t = __TESTS__[ti];\n` +
    `      var got;\n` +
    `      var ok = false;\n` +
    `      var errText = null;\n` +
    `      try {\n` +
    `        if (__CODEC__ === 'tree') {\n` +
    `          got = __treeToArray__(__FN__(__arrayToTree__(t.args[0])));\n` +
    `        } else {\n` +
    `          got = __FN__.apply(null, t.args);\n` +
    `        }\n` +
    `        ok = __ser__(got) === __ser__(t.expected);\n` +
    `      } catch (e) { errText = __errText__(e); }\n` +
    `      if (ok) { __RESULT__.passed++; } else { __RESULT__.failed++; }\n` +
    `      __RESULT__.tests.push({ name: t.name, ok: ok, expected: t.expected, got: errText !== null ? undefined : got, error: errText });\n` +
    `    }\n` +
    `  } catch (e) {\n` +
    `    __RESULT__.error = __errText__(e);\n` +
    `  }\n` +
    `  __JUDGE_LOG__('__VERDICT__' + JSON.stringify(__RESULT__));\n` +
    `})();\n`
  );
}
