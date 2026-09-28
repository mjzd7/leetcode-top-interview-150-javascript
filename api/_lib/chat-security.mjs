/**
 * Abuse controls for /api/chat: origin allowlist, prompt-injection scrubbing,
 * and distributed rate limiting.
 *
 * Design notes
 * ------------
 * Origin checking is a *browser* control, not authentication. Browsers attach
 * `Origin` to every cross-origin POST (and `Referer` to navigations), so it
 * stops a random web page from quietly burning the owner's OpenAI budget. It
 * does nothing against a curl script that simply omits or forges the header —
 * so we do NOT reject header-less requests, because that would only break
 * legitimate non-browser callers (CI, the E2E suite, server-to-server) while
 * stopping no real attacker. The real cost control is `rateLimit()`.
 *
 * Prompt-injection scrubbing is defence in depth, not the primary defence.
 * The primary defences are (a) pageContext never entering the history array,
 * (b) delimiter wrapping, (c) an explicit system instruction to treat context
 * as inert data. Scrubbing is written to be *code-safe* — these guides are full
 * of JavaScript object literals like `{ user: 'alice' }`, and a naive
 * `system:` strip would corrupt real content.
 */

/** Delimiter used to fence pageContext inside the system prompt. */
export const CONTEXT_OPEN = '<<<GUIDE_CONTENT>>>';
export const CONTEXT_CLOSE = '<<<END_GUIDE_CONTENT>>>';

const DEFAULT_RATE_LIMIT = 5; // requests ...
const DEFAULT_RATE_WINDOW_MS = 60_000; // ... per minute (integration plan §2.3)

/* ------------------------------------------------------------------ *
 * Client identity
 * ------------------------------------------------------------------ */

/** Best-effort client IP. Vercel sets x-forwarded-for; x-real-ip for local proxies. */
export function clientIp(req) {
  const h = req?.headers || {};
  const fwd = h['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  if (Array.isArray(fwd) && fwd.length) return String(fwd[0]).split(',')[0].trim();
  if (typeof h['x-real-ip'] === 'string' && h['x-real-ip']) return h['x-real-ip'].trim();
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * Origin allowlist
 * ------------------------------------------------------------------ */

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Env-driven allowlist. Accepts a comma-separated list of origins or bare
 * hostnames. `*.vercel.app` style wildcards match any single-label subdomain, so
 * every Preview deployment is allowed without a redeploy.
 */
export function allowedOrigins(env = process.env) {
  const raw = env.CHAT_ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matchesAllowlist(origin, allowlist) {
  const host = hostOf(origin);
  if (!host) return false;
  for (const entry of allowlist) {
    if (entry === '*') return true;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".vercel.app"
      if (host.endsWith(suffix) && host.slice(0, -suffix.length).indexOf('.') === -1) return true;
    } else if (entry.includes('://')) {
      if (host === hostOf(entry)) return true;
    } else if (host === entry) {
      return true;
    }
  }
  return false;
}

/**
 * Authorise a chat request.
 *
 * Allowed when any of:
 *   - Origin (or Referer) matches CHAT_ALLOWED_ORIGINS
 *   - Origin/Referer host equals the request's own Host header (same-origin
 *     through this same deployment — covers production with zero config)
 *   - Neither header is present (non-browser caller; see module header)
 *
 * Returns { ok, reason, origin }.
 */
export function checkOrigin(req, { allowlist = allowedOrigins() } = {}) {
  const headers = req?.headers || {};
  const origin = typeof headers.origin === 'string' && headers.origin ? headers.origin : null;
  const referer = typeof headers.referer === 'string' && headers.referer ? headers.referer : null;
  const candidate = origin || referer;

  if (!candidate) return { ok: true, reason: 'no-origin-header', origin: null };

  if (matchesAllowlist(candidate, allowlist)) {
    return { ok: true, reason: 'allowlisted', origin };
  }

  // Same-origin through this deployment: the browser's Origin host equals the
  // host it actually reached. Avoids requiring config in the common case.
  const reqHost = String(headers.host || headers[':authority'] || '').toLowerCase();
  const candHost = hostOf(candidate);
  if (reqHost && candHost && reqHost === candHost) {
    return { ok: true, reason: 'same-origin', origin };
  }

  return {
    ok: false,
    reason: `origin not allowed: ${origin || referer}`,
    origin: origin || referer,
  };
}

/* ------------------------------------------------------------------ *
 * Prompt-injection scrubbing
 * ------------------------------------------------------------------ */

// Chat-template control tokens. Unconditional removal: they have no place in
// study-guide prose, and they are the highest-signal injection carrier.
const CONTROL_TOKENS = [
  /<\|[a-z_]{2,30}\|>/gi, // <|im_start|> <|endoftext|> <|system|> ...
  /<<\/?SYS>>/gi,
  /\[\/?INST\]/g,
  /<\/?s>/gi,
];

/** Our own fence. Unconditional: a guide containing it could break out early. */
const FENCE_BREAK = new RegExp(CONTEXT_OPEN.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''), 'gi');

// Line-leading conversational role turns: "System: ...", "assistant: ...".
// The lookahead deliberately skips matches where the value is a quoted string,
// which is the signature of a JS object literal ({ user: 'alice' }) rather than
// a role turn. Without that guard this corrupts legitimate code in the guides.
const ROLE_TURN = /(^|\n)([ \t]*)(system|developer|assistant|user)([ \t]*):(?=\s*[^\s'"`])/gi;

/**
 * Scrub untrusted pageContext text.
 *
 * Returns { text, removed } where `removed` counts how many injection markers
 * were neutralised (for logging — a high rate is a signal, not an error).
 */
export function sanitizeContext(input, { maxChars = 60_000 } = {}) {
  if (typeof input !== 'string' || input.length === 0) {
    return { text: '', removed: 0 };
  }
  let text = input;
  let removed = 0;

  // 1. NUL + C0 control chars (keep \n, \t).
  const controls = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g);
  if (controls) {
    removed += controls.length;
    text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  // 2. Chat-template control tokens.
  for (const re of CONTROL_TOKENS) {
    text = text.replace(re, () => {
      removed += 1;
      return '';
    });
  }

  // 3. Fence-break attempts on our own delimiter.
  text = text.replace(FENCE_BREAK, () => {
    removed += 1;
    return '[redacted]';
  });

  // 4. Line-leading role turns.
  text = text.replace(ROLE_TURN, (_m, nl, indent, role) => {
    removed += 1;
    return `${nl}${indent}[${role}-role-marker removed]`;
  });

  // 5. Whitespace: collapse runs of spaces/tabs, cap blank-line runs.
  text = text.replace(/[ \t]{3,}/g, '  ').replace(/\n{3,}/g, '\n\n').trim();

  // 6. Absolute character ceiling as a last-resort bound (token trimming runs
  //    after this, in chat-tokens.mjs).
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }

  return { text, removed };
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

function restConfig(env) {
  // Prefer dedicated Upstash names, then the Vercel KV vars this repo already
  // uses (api/_lib/kv.mjs) — Vercel KV is Upstash-over-REST.
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || null;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || null;
  if (!url || !token) return null;
  // @upstash/redis speaks REST. A rediss:// TCP URL (which some providers put in
  // REDIS_URL) is silently unusable, so require an http(s) REST endpoint.
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, token };
}

let limiterPromise;

/**
 * Build (once per instance) the Upstash sliding-window limiter.
 * Resolves to null when Redis isn't configured or the client can't be built.
 */
async function resolveLimiter(env) {
  const cfg = restConfig(env);
  if (!cfg) return null;
  if (limiterPromise === undefined) {
    limiterPromise = (async () => {
      try {
        const [{ Redis }, { Ratelimit }] = await Promise.all([
          import('@upstash/redis'),
          import('@upstash/ratelimit'),
        ]);
        const redis = new Redis({ url: cfg.url, token: cfg.token });
        return new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(DEFAULT_RATE_LIMIT, '60 s'),
          prefix: 'lt150:chat',
          analytics: true,
        });
      } catch {
        return null;
      }
    })();
  }
  return limiterPromise;
}

/** Test seam: force re-resolution with different env. */
export function resetLimiterCache() {
  limiterPromise = undefined;
  memoryState.clear();
}

// In-memory floor. Per-instance only, but it means a deploy with no Redis
// configured is still limited rather than unlimited. Mirrors the shape used in
// api/judge/run.mjs so the codebase reads consistently.
const memoryState = new Map();

function checkMemory(key, windowMs, limit) {
  const now = Date.now();
  const entry = memoryState.get(key);
  if (!entry || now - entry.start >= windowMs) {
    memoryState.set(key, { start: now, count: 1 });
    return { allowed: true, remaining: limit - 1, reset: now + windowMs };
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    reset: entry.start + windowMs,
  };
}

/**
 * Rate limit one chat request.
 *
 * Both layers run and BOTH must allow. Upstash is the distributed truth;
 * in-memory is the floor. Returns
 * { ok, remaining, reset, scope } where scope is 'redis' | 'memory' | 'memory+redis'.
 */
export async function rateLimit(key, {
  env = process.env,
  limit = DEFAULT_RATE_LIMIT,
  windowMs = DEFAULT_RATE_WINDOW_MS,
} = {}) {
  const memory = checkMemory(key, windowMs, limit);
  const limiter = await resolveLimiter(env);
  if (!limiter) {
    return { ...memory, ok: memory.allowed, scope: 'memory' };
  }
  try {
    const res = await limiter.limit(key);
    const ok = memory.allowed && res.success;
    return {
      ok,
      remaining: Math.min(memory.remaining, res.remaining),
      reset: res.reset > memory.reset ? res.reset : memory.reset,
      scope: 'memory+redis',
    };
  } catch {
    // Redis unreachable: keep the in-memory floor rather than failing open.
    return { ...memory, ok: memory.allowed, scope: 'memory' };
  }
}

export { DEFAULT_RATE_LIMIT, DEFAULT_RATE_WINDOW_MS };
