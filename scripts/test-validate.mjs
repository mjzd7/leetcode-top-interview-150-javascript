import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateProblemGuide } from './validate-guide.mjs';

// E16/E17 + K7's section-scoped half: a solution block that is async, a generator,
// or dynamically evaluated would make the trace instrumenter produce an empty or
// truncated trace that passes CI vacuously. Each fixture below carries the whole
// 6-section schema, so the ONLY error it can raise is the one asserted here —
// `errors.length === 1` is what proves the fixture does not trip a pre-existing check.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

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

function validateFixture(name) {
  return validateProblemGuide(path.join(FIXTURES, name));
}

// A fixture may trip more than one of the K7 rules (a generator also yields, an eval
// usually rides with `new Function`), so isolation is asserted as "every error is a K7
// error" — no pre-existing check may fire.
const K7_ERROR = /^(SOLUTION_BLOCK_FORBIDDEN|SOLUTION_BLOCK_UNPARSABLE|MISSING_SOLUTION_BLOCK|SOLUTION_SCAN_UNAVAILABLE)\b/;

/** Asserts the fixture is rejected, by a named K7 error, and by nothing else. */
function expectRejected(name, needle, label) {
  const res = validateFixture(name);
  const hit = res.errors.filter((e) => e.includes(needle));
  const leaked = res.errors.filter((e) => !K7_ERROR.test(e));
  check(!res.isValid, `${label}: guide is rejected`, `isValid was true, errors: ${JSON.stringify(res.errors)}`);
  check(hit.length === 1, `${label}: rejected by "${needle}"`, `errors: ${JSON.stringify(res.errors)}`);
  check(leaked.length === 0, `${label}: no pre-existing check fires`, `errors: ${JSON.stringify(leaked)}`);
  return hit[0] || '';
}

/** The reported line number must be the line the construct is actually on. */
function expectLineMatch(name, message, construct, label) {
  const reported = /line (\d+)/.exec(message);
  const lines = fs.readFileSync(path.join(FIXTURES, name), 'utf-8').split('\n');
  const actual = reported ? lines[Number(reported[1]) - 1] : '';
  check(!!actual && actual.includes(construct), `${label}: reported line is the construct's line`,
    `reported line ${reported?.[1]} is ${JSON.stringify(actual)}`);
}

// ---- 1. E16: await / async in a Level 1 solution block ------------------------
const awaitMsg = expectRejected(
  'bad-await-in-solution.md',
  'SOLUTION_BLOCK_FORBIDDEN [no-await]',
  'E16 await'
);
check(/Level 1/.test(awaitMsg), 'E16 await: names the offending level', awaitMsg);
expectLineMatch('bad-await-in-solution.md', awaitMsg, 'await', 'E16 await');

// ---- 2. E16: generator in a Level 3 solution block ---------------------------
const genMsg = expectRejected(
  'bad-generator-in-solution.md',
  'SOLUTION_BLOCK_FORBIDDEN [no-generator-function]',
  'E16 generator'
);
check(/Level 3/.test(genMsg), 'E16 generator: names the offending level', genMsg);
expectLineMatch('bad-generator-in-solution.md', genMsg, 'function*', 'E16 generator');
check(
  validateFixture('bad-generator-in-solution.md').errors.some((e) => e.includes('SOLUTION_BLOCK_FORBIDDEN [no-yield]')),
  'E16 yield: reported as its own named error',
  `errors: ${JSON.stringify(validateFixture('bad-generator-in-solution.md').errors)}`
);

// ---- 3. E17: eval / new Function in a Level 2 solution block ----------------
const evalMsg = expectRejected(
  'bad-dynamic-code-in-solution.md',
  'SOLUTION_BLOCK_FORBIDDEN [no-eval]',
  'E17 eval'
);
check(/Level 2/.test(evalMsg), 'E17 eval: names the offending level', evalMsg);
expectLineMatch('bad-dynamic-code-in-solution.md', evalMsg, 'eval', 'E17 eval');
check(
  validateFixture('bad-dynamic-code-in-solution.md').errors.some((e) => e.includes('SOLUTION_BLOCK_FORBIDDEN [no-new-function]')),
  'E17 new Function: reported as its own named error',
  `errors: ${JSON.stringify(validateFixture('bad-dynamic-code-in-solution.md').errors)}`
);

// ---- 4. K7: three javascript fences, none of them the Level 3 solution block --
const missingMsg = expectRejected(
  'bad-missing-canonical-block.md',
  'MISSING_SOLUTION_BLOCK',
  'K7 missing Level 3'
);
check(/Level 3/.test(missingMsg), 'K7 missing Level 3: names the missing level', missingMsg);
const missingFixture = fs.readFileSync(path.join(FIXTURES, 'bad-missing-canonical-block.md'), 'utf-8');
check(
  (missingFixture.match(/```javascript/g) || []).length === 3,
  'K7 missing Level 3: fixture really does have three javascript fences',
  `fences: ${(missingFixture.match(/```javascript/g) || []).length}`
);

// ---- 5. Control: `await` only in prose-shaped positions must NOT be rejected --
// A regex over raw markdown cannot tell these from a real `await`; `sg` can.
const good = validateFixture('good-prose-await-only.md');
check(good.isValid, 'control: prose-shaped await is accepted', `errors: ${JSON.stringify(good.errors)}`);

console.log('\n========================================');
console.log(`Assertions: ${assertions} | Failures: ${failures}`);
console.log('========================================\n');

if (failures > 0) process.exit(1);
