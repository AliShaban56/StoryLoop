import { isAuthed, unauthorized } from '../../../lib/auth.js';
import { withKey } from '../../../lib/keyManager.js';
import * as agnes from '../../../lib/agnes.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

// اختبار حي: رسالة صغيرة لـ Agnes عبر مدير المفاتيح (بيجرب التبديل لو مفتاح فشل)
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  try {
    const reply = await withKey('agnes', (k) => agnes.chat(k, [{ role: 'user', content: 'رد بكلمة واحدة: تمام' }]), { maxWaitSec: 20 });
    return Response.json({ ok: true, reply: String(reply).slice(0, 100) });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message).slice(0, 200) });
  }
}
