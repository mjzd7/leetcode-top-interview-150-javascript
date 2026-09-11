import { PROBLEMS, isPilotProblem, buildBundle } from '../api/_lib/problems.mjs';
import { executeUserCode, parseVerdictEnvelope } from '../api/_lib/sandbox.mjs';
import { signSession, verifySession, getSession, randomToken, appBaseUrl } from '../api/_lib/session.mjs';
import { kvConfigured, readProgress, recordPass } from '../api/_lib/kv.mjs';
import runHandler from '../api/judge/run.mjs';
import loginHandler from '../api/auth/login.mjs';
import callbackHandler from '../api/auth/callback.mjs';
import meHandler from '../api/auth/me.mjs';
import logoutHandler from '../api/auth/logout.mjs';

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
  const headers = {};
  return {
    statusCode: 200,
    body: undefined,
    headers,
    ended: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(o) {
      this.body = o;
      return this;
    },
    setHeader(k, v) {
      headers[String(k).toLowerCase()] = v;
    },
    writeHead(c, h) {
      this.statusCode = c;
      for (const [k, v] of Object.entries(h || {})) headers[String(k).toLowerCase()] = v;
    },
    end() {
      this.ended = true;
    },
  };
}

const realFetch = globalThis.fetch;
function mockFetch(handler) {
  globalThis.fetch = handler;
}
function restoreFetch() {
  globalThis.fetch = realFetch;
}

/** In-memory Upstash-REST emulator for KV client tests. */
function makeKvEmulator() {
  const store = new Map();
  const seen = [];
  async function handler(url, opts) {
    const [cmd, key, value] = JSON.parse(opts.body);
    seen.push({ cmd, key, value });
    if (cmd === 'GET') {
      return { ok: true, json: async () => ({ result: store.has(key) ? store.get(key) : null }) };
    }
    if (cmd === 'SET') {
      store.set(key, value);
      return { ok: true, json: async () => ({ result: 'OK' }) };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  }
  return { handler, seen, store };
}

function withKvEnv(fn) {
  const prevUrl = process.env.KV_REST_API_URL;
  const prevToken = process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL = 'https://kv.test.local';
  process.env.KV_REST_API_TOKEN = 'test-token';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = prevUrl;
      if (prevToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = prevToken;
    });
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

  // ---- 14. Auth: login route ----
  {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    const r0 = mockRes();
    await loginHandler({ method: 'GET', headers: {} }, r0);
    check(r0.statusCode === 500, 'login without client id -> 500');

    process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
    try {
      const r1 = mockRes();
      await loginHandler(
        { method: 'GET', headers: { host: 'app.test.local' } },
        r1,
      );
      const loc = r1.headers.location || '';
      const setCookie = String(r1.headers['set-cookie'] || '');
      const stateMatch = setCookie.match(/oauth_state=([^;]+)/);
      check(r1.statusCode === 302, 'login redirects (302)');
      check(
        loc.startsWith('https://github.com/login/oauth/authorize?') &&
          loc.includes('client_id=test-client-id') &&
          loc.includes('state='),
        'authorize URL carries client_id + state',
        loc.slice(0, 120),
      );
      check(!!stateMatch && loc.includes(`state=${stateMatch[1]}`), 'state cookie matches URL state');
      check(setCookie.includes('HttpOnly') && setCookie.includes('Max-Age=600'), 'state cookie hardened');
    } finally {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
    }

    const r2 = mockRes();
    await loginHandler({ method: 'POST', headers: {} }, r2);
    check(r2.statusCode === 405, 'login non-GET -> 405');
  }

  // ---- 15. Auth: callback route (mocked GitHub) ----
  {
    process.env.GITHUB_OAUTH_CLIENT_ID = 'test-client-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-client-secret';
    try {
      // 15a. state mismatch -> redirect with error flag
      const bad = mockRes();
      await callbackHandler(
        { method: 'GET', query: { code: 'c', state: 'wrong' }, headers: { cookie: 'oauth_state=right' } },
        bad,
      );
      check(
        bad.statusCode === 302 && String(bad.headers.location || '').includes('login_error=invalid_state'),
        'callback state mismatch -> error redirect',
      );

      // 15b. token denied -> redirect with error flag
      mockFetch(async (url) => {
        if (String(url).includes('access_token')) return { ok: true, json: async () => ({ error: 'bad_verification_code' }) };
        throw new Error('unexpected fetch: ' + url);
      });
      try {
        const denied = mockRes();
        await callbackHandler(
          { method: 'GET', query: { code: 'bad', state: 's' }, headers: { cookie: 'oauth_state=s' } },
          denied,
        );
        check(
          denied.statusCode === 302 && String(denied.headers.location || '').includes('login_error=token_denied'),
          'callback token denial -> error redirect',
        );
      } finally {
        restoreFetch();
      }

      // 15c. happy path: token + identity -> session cookie, state cleared
      mockFetch(async (url) => {
        if (String(url).includes('access_token')) return { ok: true, json: async () => ({ access_token: 'gho_test' }) };
        if (String(url).includes('api.github.com/user')) {
          return { ok: true, json: async () => ({ id: 4242, login: 'octo-tester' }) };
        }
        throw new Error('unexpected fetch: ' + url);
      });
      try {
        const good = mockRes();
        await callbackHandler(
          {
            method: 'GET',
            query: { code: 'good', state: 's' },
            headers: { cookie: 'oauth_state=s', host: 'app.test.local' },
          },
          good,
        );
        const cookies = [].concat(good.headers['set-cookie'] || []);
        const sid = cookies.find((c) => c.startsWith('sid='));
        check(good.statusCode === 302 && good.headers.location === '/', 'callback success redirects home');
        check(!!sid && sid.includes('HttpOnly'), 'callback sets session cookie');
        check(
          cookies.some((c) => c.startsWith('oauth_state=;')),
          'callback clears state cookie',
        );
        const payload = verifySession(decodeURIComponent(sid.split(';')[0].slice(4)), TEST_SECRET);
        check(payload && payload.githubId === 4242, 'session encodes github identity');
      } finally {
        restoreFetch();
      }

      // 15d. unconfigured -> 500
      delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
      const unconf = mockRes();
      await callbackHandler({ method: 'GET', query: {}, headers: {} }, unconf);
      check(unconf.statusCode === 500, 'callback unconfigured -> 500');
    } finally {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
      delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    }
  }

  // ---- 16. Auth: me + logout ----
  {
    const anon = mockRes();
    await meHandler({ method: 'GET', headers: {} }, anon);
    check(anon.statusCode === 401, 'me without session -> 401');

    // KV unconfigured: identity proven, progress degrades to [].
    const known = mockRes();
    await meHandler({ method: 'GET', headers: authedReq({}, 31).headers }, known);
    check(
      known.statusCode === 200 && known.body && known.body.githubId === 31 && Array.isArray(known.body.done),
      'me returns identity with degraded progress',
      JSON.stringify(known.body),
    );

    const out = mockRes();
    await logoutHandler({ method: 'POST', headers: {} }, out);
    check(
      out.statusCode === 200 && out.body && out.body.ok === true && String(out.headers['set-cookie'] || '').includes('Max-Age=0'),
      'logout clears cookie',
    );

    const outGet = mockRes();
    await logoutHandler({ method: 'GET', headers: {} }, outGet);
    check(outGet.statusCode === 405, 'logout non-POST -> 405');
  }

  // ---- 17. KV client against emulator ----
  {
    await withKvEnv(async () => {
      const emu = makeKvEmulator();
      mockFetch(emu.handler);
      try {
        check(kvConfigured() === true, 'kvConfigured true with env');
        const miss = await readProgress(77);
        check(miss.ok && miss.done.length === 0, 'missing key -> empty progress');
        const w1 = await recordPass(77, 'two-sum');
        check(w1.ok === true, 'recordPass writes');
        const r1 = await readProgress(77);
        check(r1.ok && r1.done.length === 1 && r1.done[0] === 'two-sum', 'progress round-trips');
        await recordPass(77, 'two-sum');
        const r2 = await readProgress(77);
        check(r2.done.length === 1, 'recordPass dedupes');
        const sets = emu.seen.filter((s) => s.cmd === 'SET');
        check(sets.length === 2, 'two writes issued', `saw ${sets.length}`);
      } finally {
        restoreFetch();
      }
    });
    const down = await readProgress(78);
    check(down.ok === false, 'KV without env -> explicit failure');
  }

  // ---- 18. KV transport failure degrades ----
  {
    await withKvEnv(async () => {
      mockFetch(async () => {
        throw new Error('network down');
      });
      try {
        const r = await readProgress(78);
        check(r.ok === false && r.done.length === 0, 'KV outage -> degraded empty');
        const w = await recordPass(78, 'two-sum');
        check(w.ok === false, 'write outage -> ok:false');
      } finally {
        restoreFetch();
      }
    });
  }

  // ---- 19. run.mjs persists progress on full pass (mocked KV) ----
  {
    await withKvEnv(async () => {
      const emu = makeKvEmulator();
      mockFetch(emu.handler);
      try {
        const res = mockRes();
        await runHandler(authedReq({ problemId: 'two-sum', code: GOOD['two-sum'] }, 55), res);
        const sets = emu.seen.filter((s) => s.cmd === 'SET');
        const wroteSlug = sets.some((s) => {
          try {
            return JSON.parse(s.value).done.includes('two-sum');
          } catch {
            return false;
          }
        });
        check(res.statusCode === 200 && res.body && res.body.failed === 0, 'full pass verdict intact');
        check(wroteSlug, 'full pass persisted to KV');
      } finally {
        restoreFetch();
      }
    });
  }

  // ---- 20. run.mjs survives KV outage (verdict intact) ----
  {
    await withKvEnv(async () => {
      mockFetch(async () => {
        throw new Error('network down');
      });
      try {
        const res = mockRes();
        await runHandler(authedReq({ problemId: 'two-sum', code: GOOD['two-sum'] }, 56), res);
        check(
          res.statusCode === 200 && res.body && res.body.failed === 0 && res.body.passed === 3,
          'KV outage does not break verdicts',
          JSON.stringify(res.body),
        );
      } finally {
        restoreFetch();
      }
    });
  }

  // ---- 21. helpers: randomToken + appBaseUrl ----
  {
    check(typeof randomToken() === 'string' && randomToken() !== randomToken(), 'randomToken unique');
    check(
      appBaseUrl({ headers: { host: 'app.test.local' } }) === 'https://app.test.local',
      'appBaseUrl defaults https',
    );
    check(
      appBaseUrl({ headers: { host: 'localhost:3000' } }) === 'http://localhost:3000',
      'appBaseUrl localhost http',
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
