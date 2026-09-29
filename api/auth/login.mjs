import { randomToken, appBaseUrl, oauthStateCookieHeader } from '../_lib/session.mjs';

/**
 * GET /api/auth/login — start GitHub OAuth.
 * Sets a short-lived `state` cookie (CSRF protection, checked in callback),
 * then redirects to github.com/login/oauth/authorize.
 * 500 when the OAuth App is not configured (missing client ID).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }
  const state = randomToken(16);
  const redirectUri = `${appBaseUrl(req)}/api/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state,
    allow_signup: 'false',
  });
  // The cookie itself is built in _lib/session.mjs, so the state cookie and the
  // session cookie cannot drift apart on `Secure`.
  res.setHeader('Set-Cookie', oauthStateCookieHeader(state));
  res.writeHead(302, { Location: `https://github.com/login/oauth/authorize?${params}` });
  res.end();
}
