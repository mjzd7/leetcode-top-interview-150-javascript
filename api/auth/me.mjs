import { getSession } from '../_lib/session.mjs';
import { readProgress } from '../_lib/kv.mjs';

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
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const progress = await readProgress(session.githubId);
  return res.status(200).json({
    githubId: session.githubId,
    login: session.login || '',
    done: progress.done,
  });
}
