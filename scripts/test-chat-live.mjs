/**
 * Real-provider smoke test for the chat backend.
 *
 * Scope, deliberately narrow: the mocked suite in scripts/test-chat.mjs proves
 * the contract (rate limits, 403, 503, truncated streams, buffer boundaries) —
 * things a live provider cannot be made to emit on demand. This script proves
 * the opposite thing, that the real integration actually works: that the model
 * id resolves, that openai@7 streams, that our delta parsing and our system
 * prompt produce a usable answer grounded in the guide.
 *
 * NOT part of `npm run verify` and NOT wired into CI. It costs money and needs
 * a secret, so it only runs when a human asks for it by name.
 *
 *   npm run test:chat:live
 *
 * Configuration is read from the environment, falling back to .env.local (which
 * is gitignored). An absent key is a clean skip, never a failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env.local wins only for keys the shell has not already set.
try {
  const dotenv = (await import('dotenv')).default;
  dotenv.config({ path: path.join(ROOT, '.env.local') });
} catch {
  // dotenv is optional; the shell environment is enough.
}

function skip(reason) {
  console.log(`⏭️  SKIPPED — ${reason}`);
  process.exit(0);
}

// Guarded before the route is imported: the skip path must not depend on any
// of the code it is skipping.
if (process.env.CI) skip('refusing to spend a real API call inside CI');
if (!process.env.OPENAI_API_KEY) skip('OPENAI_API_KEY is not set (add it to .env.local)');

const { buildChatRequest, DEFAULT_MODEL } = await import('../api/_lib/chat-prompt.mjs');
const { resetLimiterCache } = await import('../api/_lib/chat-security.mjs');
const chatModule = await import('../api/chat.mjs');
const chatHandler = chatModule.default;
const resetProviderClient = chatModule.resetProviderClient;

const GUIDE = '05-hashmap/06-two-sum.md';
const QUESTION = 'In one sentence, what is the brute-force approach for this problem?';

let failures = 0;
function check(cond, label, detail = '') {
  if (cond) {
    console.log(`✅ [PASS] ${label}`);
  } else {
    failures++;
    console.error(`❌ [FAIL] ${label}${detail ? `\n   ${detail}` : ''}`);
  }
}

/** Collects the streamed response exactly as a browser would receive it. */
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writableEnded: false,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.writableEnded = true; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    flushHeaders() {},
    write(c) { this.chunks.push(String(c)); return true; },
    end() { this.writableEnded = true; },
    on() {},
    get text() { return this.chunks.join(''); },
  };
}

/** Reassemble the answer the same way the widget does. */
function answerFrom(sseBody) {
  let out = '';
  for (const frame of sseBody.split('\n\n')) {
    const line = frame.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const obj = JSON.parse(payload);
      const d = obj?.choices?.[0]?.delta?.content;
      if (d) out += d;
    } catch { /* not a JSON frame */ }
  }
  return out;
}

console.log(`\n── live provider smoke test ──`);
console.log(`model:      ${process.env.AI_MODEL || DEFAULT_MODEL}`);
console.log(`base url:   ${process.env.AI_BASE_URL || 'https://api.openai.com/v1 (default)'}`);
console.log(`key:        set (${process.env.OPENAI_API_KEY.length} chars, not shown)`);
console.log(`guide:      ${GUIDE}\n`);

const guidePath = path.join(ROOT, GUIDE);
if (!fs.existsSync(guidePath)) {
  console.error(`❌ [FAIL] guide fixture not found at ${GUIDE}`);
  process.exit(1);
}
const pageContext = fs.readFileSync(guidePath, 'utf-8').slice(0, 12000);

// Prove the prompt split before spending a call.
const prepared = await buildChatRequest({
  context: pageContext,
  title: 'Two Sum',
  category: 'HASHMAP',
  history: [{ role: 'user', content: QUESTION }],
  model: process.env.AI_MODEL || DEFAULT_MODEL,
});
const SENTINEL = pageContext.slice(500, 560).trim();
check(prepared.messages.every((m) => !m.content.includes(SENTINEL)),
  'pageContext is kept out of the message history');
check(prepared.system.includes(SENTINEL), 'pageContext reaches the system prompt');
console.log(`   prompt budget: ${prepared.meta.totalTokens} tokens (system ${prepared.meta.systemTokens} + history ${prepared.meta.historyTokens})`);
console.log(`   injection markers stripped: ${prepared.meta.injectionMarkersRemoved}\n`);

resetLimiterCache();
resetProviderClient();

const started = Date.now();
const res = mockRes();
const req = {
  method: 'POST',
  // No Origin header: non-browser caller, allowed by design (see chat-security).
  headers: { host: 'localhost:3000', 'x-forwarded-for': '203.0.113.99' },
  body: { messages: [{ role: 'user', content: QUESTION }], pageContext, pageTitle: 'Two Sum', pageCategory: 'HASHMAP' },
  on() {},
};

try {
  await chatHandler(req, res);
} catch (e) {
  console.error(`❌ [FAIL] handler threw: ${e?.message || e}`);
  process.exit(1);
}

const elapsed = Date.now() - started;
const answer = answerFrom(res.text);

check(res.statusCode === 200, 'route returned 200', `got ${res.statusCode} ${JSON.stringify(res.body)}`);
check(res.headers['content-type'] === 'text/event-stream; charset=utf-8', 'served as text/event-stream');
check(res.writableEnded, 'stream was closed cleanly');
check(answer.trim().length > 0, 'received a non-empty answer', `sse was: ${res.text.slice(0, 300)}`);
check(!/"error"/.test(res.text), 'no error frame in the stream', res.text.slice(0, 300));
check((res.text.match(/data: \[DONE\]/g) || []).length === 1, 'exactly one [DONE] terminator');

if (!answer.trim()) {
  console.error('\n   Likely causes:\n'
    + '   - the key is not valid for the configured base URL (a gateway key 401s against api.openai.com — set AI_BASE_URL)\n'
    + '   - the model name is unknown to this provider (set AI_MODEL)\n'
    + '   - the provider returned a refusal or an empty completion\n');
}

console.log(`\n── answer (${elapsed}ms, ${answer.length} chars) ──\n`);
console.log(answer.trim().slice(0, 700));
console.log('\n──────────────────────────────────\n');

if (failures > 0) {
  console.error(`Assertions: live | Failures: ${failures}`);
  process.exit(1);
}
console.log('Assertions: live | Failures: 0');
