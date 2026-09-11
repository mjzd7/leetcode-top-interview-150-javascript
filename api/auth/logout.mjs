import { clearSessionCookieHeader } from '../_lib/session.mjs';

/**
 * POST /api/auth/logout — clear the session cookie. Always succeeds
 * (idempotent: logging out twice is harmless).
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return res.status(200).json({ ok: true });
}
