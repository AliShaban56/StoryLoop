import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { getStoryImageKey, getMotionKeys } from "../../../lib/envKeys.js";
import * as agnes from "../../../lib/agnes.js";

export const runtime = "nodejs";
export const maxDuration = 60;

const trunc = (value) =>
  typeof value === "string" ? (value.length > 160 ? value.slice(0, 160) + "…(" + value.length + " chars)" : value)
  : Array.isArray(value) ? value.map(trunc)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trunc(item)]))
  : value;

export async function POST(request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const step = body.step;
  const imageUrl = body.image;
  const id = body.id;
  try {
    if (step === "image") {
      const referenceImageUrl = process.env.FOX_REFERENCE_IMAGE_URL;
      if (!referenceImageUrl) throw new Error("FOX_REFERENCE_IMAGE_URL is not configured");
      const result = await agnes.image(getStoryImageKey(),
        "A cute small fox in the exact same identity as the supplied reference, soft cinematic 3D children's illustration, portrait 9:16",
        { referenceImageUrl });
      return Response.json({ ok: true, url: result.url || null, raw: trunc(result.raw) });
    }
    const key = getMotionKeys()[0]?.key;
    if (!key) throw new Error("Set AGNES_API_KEY_2 to test image-to-video");
    if (step === "video-create") {
      const created = await agnes.createVideo(key,
        "The fox slowly turns its head and smiles, gentle cinematic camera push-in",
        imageUrl);
      return Response.json({ ok: true, raw: trunc(created.raw), videoId: created.videoId, model: created.model });
    }
    if (step === "video-poll") {
      const result = await agnes.pollVideo(key, id, process.env.AGNES_VIDEO_MODEL || "agnes-video-2.5-flash");
      return Response.json({ ok: true, raw: trunc(result) });
    }
    return Response.json({ ok: false, error: "bad step" }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: String(error.message).slice(0, 400), status: error.status || null });
  }
}
