import { parseCookies, signSession, sessionCookieHeader, appBaseUrl } from '../_lib/session.mjs';

function fail(res, status, message) {
  // Login failures redirect home with an error flag (no stack traces to users).
  res.writeHead(302, { Location: `/?login_error=${encodeURIComponent(message)}` });
  res.end();
  return status;
}

/**
 * GET /api/auth/callback?code=…&state=… — finish GitHub OAuth.
 *
 * 1. Validate `state` against the short-lived cookie (login CSRF defense).
 * 2. Exchange `code` for an access token (server-side; secret never in browser).
 * 3. Fetch identity (id + login) — the token is then DISCARDED, never stored.
 * 4. Mint our own session cookie and redirect home.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  const query = req.query || {};
  const { code, state } = query;
  const cookies = parseCookies(req.headers?.cookie);
  if (!code || !state || !cookies.oauth_state || cookies.oauth_state !== state) {
    fail(res, 400, 'invalid_state');
    return;
  }

  let tokenJson;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'lt150-judge' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${appBaseUrl(req)}/api/auth/callback`,
      }),
    });
    tokenJson = await tokenRes.json();
  } catch {
    fail(res, 502, 'token_exchange_failed');
    return;
  }
  if (!tokenJson || !tokenJson.access_token) {
    fail(res, 401, 'token_denied');
    return;
  }

  let me;
  try {
    const meRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'lt150-judge',
      },
    });
    me = await meRes.json();
  } catch {
    fail(res, 502, 'identity_failed');
    return;
  }
  if (!me || typeof me.id !== 'number') {
    fail(res, 401, 'identity_denied');
    return;
  }

  // Identity only: the GitHub token is intentionally dropped here.
  const session = signSession({ githubId: me.id, login: me.login || '' }, sessionSecret);
  res.setHeader('Set-Cookie', [
    sessionCookieHeader(session),
    'oauth_state=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax',
  ]);
  res.writeHead(302, { Location: '/' });
  res.end();
}
