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

// ── Dry-run prediction events (plan row 33, V12) ───────────────────────────────────────────
// LOGGING ONLY. There is no score, no leaderboard and no UI, and there will not be one
// until trigger T-b fires — which needs "≥1 guide repair attributable to this aggregate".
// So the only job here is to make that aggregate *measurable*, because a gate whose trigger
// can never be evaluated is not a gate.
//
// The browser writes to localStorage (plan decision 7: "localStorage; aggregates → existing
// kv.mjs"); these functions are the aggregate end of that, and they are exercised against the
// emulator in scripts/test-judge.mjs. Nothing calls them from a route yet — the plan names no
// endpoint for row 33, and adding one nobody calls would be the speculative surface P1 cuts.

const eventsKey = (githubId) => `user:${githubId}:dryrun-events`;

// An unbounded event list is an unbounded key. Capped at the most recent slice, oldest
// dropped: the aggregate that motivates this row asks "does repair correlate with prediction
// misses", which a recent window answers, and a key that grows forever answers nothing.
const EVENT_KEEP = 500;

/** Read a user's dry-run events, newest last. Missing key -> { ok: true, events: [] }. */
export async function readPredictionEvents(githubId) {
  const res = await kvCommand(['GET', eventsKey(githubId)]);
  if (!res.ok) return { ok: false, events: [] };
  if (res.result === null || res.result === undefined) return { ok: true, events: [] };
  try {
    const parsed = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
    const events = Array.isArray(parsed?.events) ? parsed.events.filter((e) => e && typeof e === 'object') : [];
    return { ok: true, events };
  } catch {
    return { ok: true, events: [] };
  }
}

/**
 * Append dry-run events. Best-effort by contract: returns { ok } only, so a KV outage can
 * never break a reader's dry run. Appends are whole-key rewrites (Upstash REST has no append),
 * which is acceptable at this volume and is why EVENT_KEEP exists.
 */
export async function recordPredictionEvents(githubId, events) {
  const incoming = (Array.isArray(events) ? events : [events]).filter((e) => e && typeof e === 'object');
  if (!incoming.length) return { ok: true };
  const current = await readPredictionEvents(githubId);
  const merged = [...(current.ok ? current.events : []), ...incoming].slice(-EVENT_KEEP);
  const res = await kvCommand([
    'SET',
    eventsKey(githubId),
    JSON.stringify({ events: merged, updatedAt: new Date().toISOString() }),
  ]);
  return { ok: res.ok };
}
