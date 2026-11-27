// عميل Agnes AI (OpenAI-compatible). كل الدوال بتاخد المفتاح كأول باراميتر
// وبتتنادى من جوه withKey('agnes', (key) => ...).
//
// ⚠️ حقول الفيديو والصورة اتكتبت من الوثائق العامة. شغّل `npm run smoke`
//    مرة واحدة وشوف الـ raw response، ولو فيه اختلاف عدّل بس buildVideoBody / extract*.

const BASE = process.env.AGNES_API_BASE || 'https://apihub.agnes-ai.com';

async function req(path, { method = 'GET', key, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`Agnes ${res.status}: ${text.slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

export async function chat(key, messages, model = process.env.AGNES_TEXT_MODEL || 'agnes-2.0-flash') {
  const j = await req('/v1/chat/completions', { method: 'POST', key, body: { model, messages } });
  return j.choices?.[0]?.message?.content ?? '';
}

// يرجع { url } أو { b64 }
export async function image(key, prompt, { size = process.env.AGNES_IMAGE_SIZE || '768x1344', model = 'agnes-image-2.1-flash' } = {}) {
  const j = await req('/v1/images/generations', { method: 'POST', key, body: { model, prompt, size } });
  const d = j.data?.[0];
  if (d?.url) return { url: d.url, raw: j };
  if (d?.b64_json) return { b64: d.b64_json, raw: j };
  const e = new Error(`Agnes image: unexpected response ${JSON.stringify(j).slice(0, 200)}`);
  e.status = 422;
  throw e;
}

function buildVideoBody(prompt, imageRef) {
  const body = { model: 'agnes-video-v2.0', prompt };
  if (imageRef) body.image = imageRef; // TODO: تأكد من اسم الحقل من smoke test
  return body;
}

function extractVideoId(j) {
  return j.videoId || j.video_id || j.data?.videoId || j.data?.video_id || j.id;
}

function extractVideoUrl(j) {
  return j.video_url || j.videoUrl || j.url || j.data?.video_url || j.data?.url || j.result?.url || j.urls?.[0];
}

const DONE = new Set(['completed', 'succeeded', 'success', 'done', 'finished']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled']);

// يعمل task ويستنى لحد ما يخلص (بنفس المفتاح). يرجع { url }
export async function video(key, prompt, imageRef, { pollEverySec = 8, timeoutSec = 900 } = {}) {
  const created = await req('/v1/videos', { method: 'POST', key, body: buildVideoBody(prompt, imageRef) });
  const videoId = extractVideoId(created);
  if (!videoId) {
    const e = new Error(`Agnes video: no video id in ${JSON.stringify(created).slice(0, 200)}`);
    e.status = 422;
    throw e;
  }
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollEverySec * 1000));
    const j = await req(`/agnesapi?video_id=${encodeURIComponent(videoId)}`, { key });
    const st = String(j.status || j.state || j.data?.status || '').toLowerCase();
    const url = extractVideoUrl(j);
    if (DONE.has(st) || (url && !st)) {
      if (!url) { const e = new Error('Agnes video: done but no url'); e.status = 422; throw e; }
      return { url, videoId, raw: j };
    }
    if (FAILED.has(st)) {
      const e = new Error(`Agnes video failed: ${JSON.stringify(j).slice(0, 200)}`);
      e.status = 422; // مش ذنب المفتاح
      throw e;
    }
  }
  const e = new Error('Agnes video: polling timeout');
  e.status = 504;
  throw e;
}
