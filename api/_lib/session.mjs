import crypto from 'node:crypto';

const COOKIE_NAME = 'sid';
const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_TTL_SEC = 600; // 10 minutes: enough to complete GitHub login
const DEFAULT_MAX_AGE_SEC = 30 * 24 * 3600; // 30 days (pilot)

function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signHS256(data, secret) {
  return b64urlEncode(crypto.createHmac('sha256', secret).update(data).digest());
}

/** The epoch every session starts at; see sessionEpoch() for why it is a switch. */
const DEFAULT_SESSION_EPOCH = 1;

/**
 * The epoch new tokens are minted with and that existing tokens must match.
 *
 * Sessions are stateless and last 30 days, so a leaked cookie is valid for a
 * month and nothing on the server can withdraw it: without this there is no
 * incident-response tool at all. Changing the value makes every outstanding
 * token stop verifying at once — no storage, no migration, no user list.
 *
 * Anything that is not an integer >= 1 falls back to the default rather than
 * landing on some other cohort: a typo in an env var must never read as "log
 * everyone out". Read per call, not at import, so a test can move it.
 */
function sessionEpoch(env = process.env) {
  const n = Number(String(env.SESSION_EPOCH ?? '').trim());
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_SESSION_EPOCH;
}

/**
 * Mint a session token: base64url(payload).base64url(sig).
 * Payload: { githubId: number, login: string, epoch, iat, exp }.
 *
 * `epoch` is stamped after the spread, so a caller-supplied epoch in `payload`
 * is server state only and cannot be forged through the API.
 */
export function signSession(payload, secret, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlEncode(JSON.stringify({
    ...payload,
    epoch: sessionEpoch(),
    iat: now,
    exp: now + maxAgeSec,
  }));
  return `${body}.${signHS256(body, secret)}`;
}

/**
 * Verify a session token. Returns the payload or null (bad signature,
 * malformed, expired, or minted under a retired epoch). Signature compared in
 * constant time.
 */
export function verifySession(token, secret) {
  if (typeof token !== 'string' || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signHS256(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  if (typeof payload.githubId !== 'number') return null;
  // An ABSENT field means "minted before epochs existed", which is the default
  // epoch — so the deploy that introduces SESSION_EPOCH does not log out every
  // reader holding a cookie. Bump the epoch and those same cookies are swept,
  // which is precisely the behaviour an operator is asking for at that point.
  const epoch = payload.epoch === undefined ? DEFAULT_SESSION_EPOCH : payload.epoch;
  if (epoch !== sessionEpoch()) return null;
  return payload;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export { parseCookies };

/** CSPRNG token for OAuth `state` values. */
export function randomToken(bytes = 32) {
  return b64urlEncode(crypto.randomBytes(bytes));
}

/**
 * Public base URL of the app, used to build the OAuth `redirect_uri`.
 *
 * Precedence: PUBLIC_ORIGIN, then the forwarded headers. The headers are only
 * trustworthy because Vercel sets them itself; the moment this app is
 * self-hosted or fronted by anything that passes `x-forwarded-host` through,
 * whoever sent the header chooses where real users are sent to log in — a
 * login-defeating and phishing-shaped primitive, bounded only by GitHub's
 * registered-callback allowlist. PUBLIC_ORIGIN is the one value the operator
 * sets, so it wins whenever it is set.
 *
 * A value that is not an http(s) URL is IGNORED, not thrown on: a typo in an
 * env var must degrade to the previous behaviour rather than 500 the login
 * route. With it unset the header logic below is byte-for-byte what shipped.
 */
export function appBaseUrl(req) {
  const configured = String(process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (configured) {
    let protocol = '';
    try {
      protocol = new URL(configured).protocol;
    } catch {
      protocol = '';
    }
    if (protocol === 'http:' || protocol === 'https:') return configured;
  }

  const headers = req.headers || {};
  const protoHeader = headers['x-forwarded-proto'];
  const proto = typeof protoHeader === 'string' ? protoHeader.split(',')[0].trim() : '';
  const host =
    headers['x-forwarded-host'] || headers.host || headers[':authority'] || 'localhost:3000';
  if (proto) return `${proto}://${host}`;
  return host.startsWith('localhost') ? `http://${host}` : `https://${host}`;
}

/**
 * Extract + verify the session from an incoming request.
 * Returns the session payload or null. Null secret => always null
 * (fail closed: routes must not run unauthenticated without a secret).
 */
export function getSession(req) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifySession(token, secret);
}

/**
 * Should this deployment's cookies carry `Secure`?
 *
 * ONE rule, for every cookie this app sets. The session cookie and the OAuth
 * state cookie are set on the same host, so a second copy of this predicate is
 * a second policy that will drift. Production on Vercel is always TLS;
 * anywhere else COOKIE_SECURE=1 is the operator saying "this is TLS too",
 * which is how a self-hosted deployment gets the same protection.
 */
function cookieSecure() {
  return process.env.VERCEL_ENV === 'production' || process.env.COOKIE_SECURE === '1';
}

export function sessionCookieHeader(token, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAgeSec}`, 'SameSite=Lax'];
  if (cookieSecure()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
}

/**
 * The OAuth `state` cookie: the whole login-CSRF defense (GitHub OAuth Apps
 * have no PKCE, so `state` matched against this cookie is all of it).
 *
 * Built here rather than in the login route so it obeys the same `Secure` rule
 * as the session cookie. The state is base64url, so it needs no escaping.
 */
export function oauthStateCookieHeader(state, maxAgeSec = OAUTH_STATE_TTL_SEC) {
  const parts = [`${OAUTH_STATE_COOKIE}=${state}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAgeSec}`, 'SameSite=Lax'];
  if (cookieSecure()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Expire the state cookie. Single-use by construction: it must be cleared on
 * EVERY exit from the callback, not only the success one, or a stale 10-minute
 * cookie outlives every failed attempt.
 */
export function clearOauthStateCookieHeader() {
  return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
