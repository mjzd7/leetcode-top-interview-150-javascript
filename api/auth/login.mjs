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
  const base = appBaseUrl(req);
  const redirectUri = `${base}/api/auth/callback`;
  // A preview deployment derives its callback from its own host, and GitHub
  // rejects a callback it has never seen — so login simply fails on every
  // preview, for a reason that looks like a broken integration rather than an
  // unregistered URL. PUBLIC_ORIGIN removes the accident: the callback becomes
  // the configured one. Without it, say so in the log instead of failing quietly.
  // Never surfaced to the reader; the redirect itself is unchanged either way.
  if (process.env.VERCEL_ENV === 'preview' && !process.env.PUBLIC_ORIGIN) {
    console.log(JSON.stringify({
      t: new Date().toISOString(), event: 'auth.login_preview_origin', origin: base,
      hint: 'login on a preview needs PUBLIC_ORIGIN, or a GitHub OAuth App whose callback is registered for this host',
    }));
  }
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
