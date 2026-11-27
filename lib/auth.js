// حماية لوحة التحكم بكلمة سر واحدة (ADMIN_PASSWORD) + كوكي موقّعة. للويب فقط.
import crypto from 'node:crypto';
import { cookies } from 'next/headers';

export const COOKIE = 'sl_auth';

export function sessionToken() {
  return crypto
    .createHash('sha256')
    .update(`${process.env.ADMIN_PASSWORD || ''}|${process.env.ENCRYPTION_KEY || ''}`)
    .digest('hex');
}

export function checkPassword(p) {
  const a = Buffer.from(String(p ?? ''));
  const b = Buffer.from(process.env.ADMIN_PASSWORD || '');
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function isAuthed() {
  // لو ADMIN_PASSWORD مش متحددة، اللوحة مفتوحة من غير تسجيل دخول
  if (!process.env.ADMIN_PASSWORD) return true;
  const c = (await cookies()).get(COOKIE)?.value;
  const t = sessionToken();
  return !!c && c.length === t.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(t));
}

export const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });
