import { isAuthed, unauthorized } from '../../../lib/auth.js';
import { withKey } from '../../../lib/keyManager.js';
import * as agnes from '../../../lib/agnes.js';
import { db } from '../../../lib/db.js';
import { decrypt } from '../../../lib/crypto.js';

// للتشخيص: بيستخدم أول مفتاح مباشرة (من غير cooldown) عشان نشوف الخطأ الحقيقي من Agnes
async function directKey() {
  const r = await db.execute("SELECT key_enc FROM api_keys WHERE provider='agnes' AND status!='disabled' ORDER BY id LIMIT 1");
  if (!r.rows[0]) throw new Error('no agnes key');
  return decrypt(r.rows[0].key_enc);
}

export const runtime = 'nodejs';
export const maxDuration = 60;

// يقص أي نص طويل (مثل base64) عشان الناتج يتقري
const trunc = (v) =>
  typeof v === 'string' ? (v.length > 160 ? v.slice(0, 160) + `…(${v.length} chars)` : v)
  : Array.isArray(v) ? v.map(trunc)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trunc(x)]))
  : v;

// اختبار تشخيصي خطوة بخطوة: image → video-create → video-poll
export async function POST(req) {
  if (!(await isAuthed())) return unauthorized();
  const { step, image, id } = await req.json();
  try {
    if (step === 'image') {
      const r = await withKey('agnes', (k) =>
        agnes.request('/v1/images/generations', { method: 'POST', key: k, body: {
          model: 'agnes-image-2.1-flash',
          prompt: 'A cute small fox in a magical forest, soft 3D children illustration, vertical composition',
          size: process.env.AGNES_IMAGE_SIZE || '768x1344',
        } }), { maxWaitSec: 30 });
      return Response.json({ ok: true, url: r.data?.[0]?.url || null, raw: trunc(r) });
    }
    if (step === 'video-create') {
      const body = agnes.buildVideoBody('The fox slowly turns its head and smiles, gentle camera push-in', image);
      try {
        const r = await agnes.request('/v1/videos', { method: 'POST', key: await directKey(), body });
        return Response.json({ ok: true, raw: trunc(r), sent: trunc(body) });
      } catch (e) {
        return Response.json({ ok: false, error: `HTTP ${e.status ?? '?'}: ${String(e.message).slice(0, 400)}`, sent: trunc(body) });
      }
    }
    if (step === 'video-poll') {
      try {
        const r = await agnes.request(`/agnesapi?video_id=${encodeURIComponent(id)}`, { key: await directKey() });
        return Response.json({ ok: true, raw: trunc(r) });
      } catch (e) {
        return Response.json({ ok: false, error: `HTTP ${e.status ?? '?'}: ${String(e.message).slice(0, 400)}` });
      }
    }
    return Response.json({ ok: false, error: 'bad step' }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message).slice(0, 400) });
  }
}
