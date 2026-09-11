import { PROBLEMS, isPilotProblem, buildBundle } from '../api/_lib/problems.mjs';
import { executeUserCode, parseVerdictEnvelope } from '../api/_lib/sandbox.mjs';
import { signSession, verifySession, getSession } from '../api/_lib/session.mjs';
import runHandler from '../api/judge/run.mjs';

process.env.SESSION_SECRET = 'test-secret-for-judge-suite-only';

const TEST_SECRET = 'test-secret-for-judge-suite-only';

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

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
  };
}

function authedReq(body, githubId = 1) {
  const token = signSession({ githubId, login: `tester${githubId}` }, TEST_SECRET);
  return { method: 'POST', body, headers: { cookie: `sid=${encodeURIComponent(token)}` } };
}

// Canonical solutions (from the curriculum guides) for positive tests.
const GOOD = {
  'two-sum': `function twoSum(nums, target) {
    const seen = new Map();
    for (let i = 0; i < nums.length; i++) {
      if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
      seen.set(nums[i], i);
    }
  }`,
  'valid-parentheses': `function isValid(s) {
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
      else if (stack.pop() !== pairs[ch]) return false;
    }
    return stack.length === 0;
  }`,
  'search-insert-position': `function searchInsert(nums, target) {
    let lo = 0, hi = nums.length - 1;
    while (lo <= hi) {
      const mid = lo + ((hi - lo) >> 1);
      if (nums[mid] >= target) hi = mid - 1;
      else lo = mid + 1;
    }
    return lo;
  }`,
  'climbing-stairs': `function climbStairs(n) {
    if (n <= 2) return n;
    let a = 1, b = 2;
    for (let i = 3; i <= n; i++) { const c = a + b; a = b; b = c; }
    return b;
  }`,
  'invert-binary-tree': `function invertTree(root) {
    if (root === null || root === undefined) return root;
    const tmp = root.left;
    root.left = invertTree(root.right);
    root.right = invertTree(tmp);
    return root;
  }`,
};

async function runBundle(code, entry, opts) {
  const bundle = buildBundle({
    userCode: code,
    fnName: entry.fnName,
    codec: entry.codec,
    tests: entry.tests,
  });
  return executeUserCode(bundle, opts);
}

function parseEnvelope(exec) {
  // Dedicated envelope slot first (survives stdout truncation), log scan second.
  return parseVerdictEnvelope(exec.envelopeRaw, exec.logs);
}

async function main() {
  console.log('🧪 Starting Judge Subsystem Tests...\n');

  // ---- 1. Registry loads all 5 pilot problems ----
  const slugs = Object.keys(PROBLEMS);
  check(slugs.length === 5, 'registry holds 5 pilot problems', `got ${slugs.length}`);
  for (const slug of slugs) {
    const e = PROBLEMS[slug];
    check(
      typeof e.fnName === 'string' && (e.codec === 'json' || e.codec === 'tree') && e.tests.length > 0,
      `registry entry valid: ${slug}`,
    );
  }
  check(isPilotProblem('two-sum') && !isPilotProblem('nope'), 'allowlist accepts/rejects');

  // ---- 2. Correct solutions pass every level ----
  for (const slug of slugs) {
    const exec = await runBundle(GOOD[slug], PROBLEMS[slug]);
    const env = parseEnvelope(exec);
    check(
      exec.ok && env && env.failed === 0 && env.passed === PROBLEMS[slug].tests.length && !env.error,
      `correct solution passes: ${slug}`,
      JSON.stringify(env),
    );
  }

  // ---- 3. Wrong solution fails (not crashes) ----
  {
    const exec = await runBundle('function twoSum(nums, target) { return [0, 0]; }', PROBLEMS['two-sum']);
    const env = parseEnvelope(exec);
    check(exec.ok && env && env.failed > 0 && !env.error, 'wrong solution fails cleanly', JSON.stringify(env));
  }

  // ---- 4. Missing function -> error verdict ----
  {
    const exec = await runBundle('function notTwoSum() { return [0, 1]; }', PROBLEMS['two-sum']);
    const env = parseEnvelope(exec);
    check(
      exec.ok && env && env.error && env.error.includes('not defined'),
      'missing function yields error verdict',
      JSON.stringify(env),
    );
  }

  // ---- 5. Syntax error -> error verdict ----
  {
    const exec = await runBundle('function twoSum( {', PROBLEMS['two-sum']);
    check(!exec.ok && !!exec.error && !exec.timedOut, 'syntax error yields error verdict', exec.error);
  }

  // ---- 6. Infinite loop -> TLE ----
  {
    const exec = await runBundle('function twoSum() { while (true) {} }', PROBLEMS['two-sum'], {
      timeoutMs: 800,
    });
    check(!exec.ok && exec.timedOut === true, 'infinite loop times out', JSON.stringify(exec).slice(0, 200));
  }

  // ---- 7. Stdout bomb truncated, verdict survives ----
  {
    const code = `function twoSum(nums, target) {
      for (let i = 0; i < 5000; i++) console.log('x'.repeat(100));
      return [0, 1];
    }`;
    const exec = await runBundle(code, PROBLEMS['two-sum']);
    const env = parseEnvelope(exec);
    check(exec.ok && exec.truncated === true, 'stdout bomb truncated', `truncated=${exec.truncated}`);
    check(!!env && env.passed + env.failed > 0, 'verdict parsed despite spam');
  }

  // ---- 8. User clobbers console.log -> verdict survives ----
  {
    const code = `console.log = () => { throw new Error('nope'); };
function twoSum(nums, target) { return [0, 1]; }`;
    const exec = await runBundle(code, PROBLEMS['two-sum']);
    const env = parseEnvelope(exec);
    check(!!env && env.passed + env.failed > 0, 'verdict survives console clobbering');
  }

  // ---- 9. Session round-trip + failures ----
  {
    const token = signSession({ githubId: 7, login: 'tester7' }, TEST_SECRET);
    const payload = verifySession(token, TEST_SECRET);
    check(payload && payload.githubId === 7, 'session sign/verify round-trip');
    check(verifySession(token + 'x', TEST_SECRET) === null, 'tampered token rejected');
    check(
      verifySession(signSession({ githubId: 7, login: 't' }, TEST_SECRET, -1), TEST_SECRET) === null,
      'expired token rejected',
    );
    check(
      getSession({ headers: { cookie: `sid=${encodeURIComponent(token)}` } })?.githubId === 7,
      'getSession reads cookie',
    );
    check(getSession({ headers: {} }) === null, 'missing cookie -> null session');
  }

  // ---- 10. Route: method/shape guards ----
  {
    const r1 = mockRes();
    await runHandler({ method: 'GET', body: {}, headers: {} }, r1);
    check(r1.statusCode === 405, 'non-POST -> 405');

    const r2 = mockRes();
    await runHandler({ method: 'POST', body: {}, headers: {} }, r2);
    check(r2.statusCode === 401, 'no session -> 401');

    const r3 = mockRes();
    await runHandler(authedReq({ problemId: 'nope', code: 'x' }, 11), r3);
    check(r3.statusCode === 400, 'unknown problemId -> 400');

    const r4 = mockRes();
    await runHandler(authedReq({ problemId: 'two-sum', code: '' }, 12), r4);
    check(r4.statusCode === 400, 'empty code -> 400');

    const r5 = mockRes();
    await runHandler(authedReq({ problemId: 'two-sum', code: 'x'.repeat(200 * 1024) }, 13), r5);
    check(r5.statusCode === 400, 'oversize code -> 400');
  }

  // ---- 11. Route: happy path end-to-end ----
  {
    const res = mockRes();
    await runHandler(authedReq({ problemId: 'two-sum', code: GOOD['two-sum'] }, 21), res);
    check(
      res.statusCode === 200 && res.body && res.body.failed === 0 && res.body.passed === 3 && !res.body.error,
      'happy path returns full-pass verdict',
      JSON.stringify(res.body),
    );
  }

  // ---- 12. Route: rate limit (fresh identity, 21 rapid runs) ----
  {
    let last = null;
    for (let i = 0; i < 21; i++) {
      const res = mockRes();
      await runHandler(authedReq({ problemId: 'climbing-stairs', code: GOOD['climbing-stairs'] }, 99), res);
      last = res;
    }
    check(last.statusCode === 429, '21st rapid run -> 429', `got ${last.statusCode}`);
  }

  // ---- 13. Route: timeout maps to TLE verdict (costs ~3s by design) ----
  {
    const res = mockRes();
    await runHandler(
      authedReq({ problemId: 'two-sum', code: 'function twoSum() { while (true) {} }' }, 77),
      res,
    );
    check(
      res.statusCode === 200 && res.body && res.body.error === 'TLE',
      'route timeout maps to TLE verdict',
      JSON.stringify(res.body),
    );
  }

  console.log(`\n========================================`);
  console.log(`Assertions: ${assertions} | Failures: ${failures}`);
  console.log(`========================================\n`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
