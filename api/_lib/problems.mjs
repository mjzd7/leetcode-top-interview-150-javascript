import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.resolve(here, '../../judge/tests');

const PILOT_SLUGS = [
  'two-sum',
  'valid-parentheses',
  'search-insert-position',
  'climbing-stairs',
  'invert-binary-tree',
];

function loadTests(slug) {
  const raw = fs.readFileSync(path.join(TESTS_DIR, `${slug}.json`), 'utf-8');
  const spec = JSON.parse(raw);
  if (!spec.fnName || !Array.isArray(spec.tests) || !['json', 'tree'].includes(spec.codec)) {
    throw new Error(`Invalid test spec for problem: ${slug}`);
  }
  return spec;
}

/** Pilot registry: slug -> { slug, fnName, codec, tests }. */
export const PROBLEMS = {};
for (const slug of PILOT_SLUGS) {
  const spec = loadTests(slug);
  PROBLEMS[slug] = { slug, fnName: spec.fnName, codec: spec.codec, tests: spec.tests };
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
 * - `fnName` comes from OUR registry (never user input) — safe to inline.
 * - Tree codec converts level-order arrays to/from linked node objects.
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
