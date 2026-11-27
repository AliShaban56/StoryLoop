import { isAuthed, unauthorized } from '../../../lib/auth.js';
import { withKey } from '../../../lib/keyManager.js';
import * as agnes from '../../../lib/agnes.js';

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
      const r = await withKey('agnes', (k) =>
        agnes.request('/v1/videos', { method: 'POST', key: k, body: agnes.buildVideoBody('The fox slowly turns its head and smiles, gentle camera push-in', image) }), { maxWaitSec: 30 });
      return Response.json({ ok: true, raw: trunc(r) });
    }
    if (step === 'video-poll') {
      const r = await withKey('agnes', (k) => agnes.request(`/agnesapi?video_id=${encodeURIComponent(id)}`, { key: k }), { maxWaitSec: 30 });
      return Response.json({ ok: true, raw: trunc(r) });
    }
    return Response.json({ ok: false, error: 'bad step' }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message).slice(0, 400) });
  }
}
