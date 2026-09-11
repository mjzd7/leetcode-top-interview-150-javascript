import { PROBLEMS, isPilotProblem, buildBundle } from '../_lib/problems.mjs';
import { executeUserCode, parseVerdictEnvelope } from '../_lib/sandbox.mjs';
import { getSession } from '../_lib/session.mjs';

const MAX_CODE_BYTES = 100 * 1024;
const EXEC_TIMEOUT_MS = 3000;

// Pilot in-memory per-user rate limiter (per instance; resets on cold start).
// KV-backed limits arrive with the progress phase; this blocks trivial abuse now.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_RUNS = 20;
const rateState = new Map(); // githubId -> { windowStart, count }

function checkRateLimit(githubId) {
  const now = Date.now();
  const entry = rateState.get(githubId);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    rateState.set(githubId, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_MAX_RUNS;
}

function readBody(req) {
  const body = req.body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (body && typeof body === 'object') return body;
  return null;
}

function parseEnvelope(exec) {
  // Dedicated envelope slot first (survives stdout truncation), log scan second.
  return parseVerdictEnvelope(exec.envelopeRaw, exec.logs);
}

/**
 * POST /api/judge/run — { problemId, code } -> verdict envelope.
 *
 * Contract:
 * - 405 non-POST · 401 no/invalid session · 400 bad body/unknown problemId/oversize
 * - 429 over per-user rate limit
 * - 200 + { passed, failed, tests[], error, truncated } otherwise.
 *   `error` is null on clean runs, 'TLE' on timeout, else the failure message.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = readBody(req);
  const problemId = body?.problemId;
  const code = body?.code;
  if (typeof problemId !== 'string' || !isPilotProblem(problemId)) {
    return res.status(400).json({ error: 'Unknown problemId' });
  }
  if (typeof code !== 'string' || code.length === 0) {
    return res.status(400).json({ error: 'Missing code' });
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    return res.status(400).json({ error: 'Code too large' });
  }

  if (!checkRateLimit(session.githubId)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  const entry = PROBLEMS[problemId];
  const bundle = buildBundle({ userCode: code, fnName: entry.fnName, codec: entry.codec, tests: entry.tests });

  let exec;
  try {
    exec = await executeUserCode(bundle, { timeoutMs: EXEC_TIMEOUT_MS });
  } catch (e) {
    return res.status(200).json({
      passed: 0,
      failed: 0,
      tests: [],
      error: `Sandbox unavailable: ${(e && e.message) || e}`,
      truncated: false,
    });
  }

  if (!exec.ok) {
    return res.status(200).json({
      passed: 0,
      failed: 0,
      tests: [],
      error: exec.timedOut ? 'TLE' : exec.error || 'Execution failed',
      truncated: exec.truncated,
    });
  }

  const envelope = parseEnvelope(exec);
  if (!envelope) {
    return res.status(200).json({
      passed: 0,
      failed: 0,
      tests: [],
      error: 'Driver protocol error: no verdict envelope',
      truncated: exec.truncated,
    });
  }

  return res.status(200).json({ ...envelope, truncated: exec.truncated || !!envelope.truncated });
}

export { PROBLEMS };
