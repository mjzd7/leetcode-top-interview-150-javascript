import crypto from 'node:crypto';

const COOKIE_NAME = 'sid';
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

/**
 * Mint a session token: base64url(payload).base64url(sig).
 * Payload: { githubId: number, login: string, iat, exp }.
 */
export function signSession(payload, secret, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlEncode(JSON.stringify({ ...payload, iat: now, exp: now + maxAgeSec }));
  return `${body}.${signHS256(body, secret)}`;
}

/**
 * Verify a session token. Returns the payload or null (bad signature,
 * malformed, or expired). Signature compared in constant time.
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
 * Public base URL of the app from request headers (Vercel-aware).
 * Defaults to https (GitHub requires https callbacks except localhost).
 */
export function appBaseUrl(req) {
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

export function sessionCookieHeader(token, maxAgeSec = DEFAULT_MAX_AGE_SEC) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAgeSec}`, 'SameSite=Lax'];
  if (process.env.VERCEL_ENV === 'production' || process.env.COOKIE_SECURE === '1') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
