import { COOKIE, checkPassword, sessionToken } from '../../../lib/auth.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const { password } = await req.json().catch(() => ({}));
  if (!checkPassword(password)) return Response.json({ error: 'wrong password' }, { status: 401 });
  const res = Response.json({ ok: true });
  res.headers.append(
    'Set-Cookie',
    `${COOKIE}=${sessionToken()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`,
  );
  return res;
}
