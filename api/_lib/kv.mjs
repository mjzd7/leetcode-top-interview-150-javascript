/**
 * Progress store over Upstash-compatible REST KV (Vercel KV).
 *
 * Env: KV_REST_API_URL, KV_REST_API_TOKEN.
 * All functions degrade to explicit { ok: false } when unconfigured or on
 * transport errors — callers must never fail user-visible flows on KV issues.
 */

function kvEnv() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

export function kvConfigured() {
  return kvEnv() !== null;
}

async function kvCommand(args, { timeoutMs = 5000 } = {}) {
  const env = kvEnv();
  if (!env) return { ok: false, error: 'KV not configured' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(env.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, error: `KV HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, result: data.result ?? null };
  } catch (e) {
    return { ok: false, error: e?.name === 'AbortError' ? 'KV timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

const progressKey = (githubId) => `user:${githubId}:progress`;

/**
 * Read a user's completed problem slugs. Returns { ok, done }.
 * Missing key -> { ok: true, done: [] }. Transport failure -> { ok: false }.
 */
export async function readProgress(githubId) {
  const res = await kvCommand(['GET', progressKey(githubId)]);
  if (!res.ok) return { ok: false, done: [] };
  if (res.result === null || res.result === undefined) return { ok: true, done: [] };
  try {
    const parsed = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
    const done = Array.isArray(parsed.done) ? parsed.done.filter((s) => typeof s === 'string') : [];
    return { ok: true, done };
  } catch {
    return { ok: true, done: [] };
  }
}

/**
 * Record a full-pass: add slug to the user's done set (deduplicated).
 * Best-effort: returns { ok } only. Read-modify-write race is acceptable
 * for pilot scale (idempotent set-union semantics).
 */
export async function recordPass(githubId, slug) {
  const current = await readProgress(githubId);
  const done = current.ok ? current.done : [];
  if (!done.includes(slug)) done.push(slug);
  const payload = JSON.stringify({ done, updatedAt: new Date().toISOString() });
  const res = await kvCommand(['SET', progressKey(githubId), payload]);
  return { ok: res.ok };
}
