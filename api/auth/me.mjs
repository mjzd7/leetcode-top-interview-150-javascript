import { getSession } from '../_lib/session.mjs';
import { readProgress } from '../_lib/kv.mjs';

/**
 * Determine if an unauthenticated request is a browser session probe.
 * Browser fetch requests send `sec-fetch-mode` (or client sets `x-soft-auth: 1`).
 * These receive 200 with unauthenticated payload rather than 401 to prevent
 * noisy browser console errors on anonymous page loads.
 */
export function isBrowserSessionProbe(req) {
  const headers = req?.headers || {};
  return Boolean(headers['sec-fetch-mode'] || headers['x-soft-auth'] === '1');
}

/**
 * GET /api/auth/me — identity + synced progress.
 * 401 without a valid session. KV failures degrade to `done: []`
 * (identity is proven by the session itself, not the store).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const session = getSession(req);
  if (!session) {
    if (isBrowserSessionProbe(req)) {
      return res.status(200).json({
        authenticated: false,
        user: null,
        progress: null,
        githubId: null,
        login: '',
        done: [],
      });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const progress = await readProgress(session.githubId);
  return res.status(200).json({
    authenticated: true,
    githubId: session.githubId,
    login: session.login || '',
    done: progress.done,
  });
}
