import { randomToken, appBaseUrl } from '../_lib/session.mjs';

const STATE_COOKIE = 'oauth_state';
const STATE_TTL_SEC = 600; // 10 minutes: enough to complete GitHub login

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
  res.setHeader(
    'Set-Cookie',
    `${STATE_COOKIE}=${state}; Path=/; HttpOnly; Max-Age=${STATE_TTL_SEC}; SameSite=Lax`,
  );
  res.writeHead(302, { Location: `https://github.com/login/oauth/authorize?${params}` });
  res.end();
}
