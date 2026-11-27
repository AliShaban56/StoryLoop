import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { getKeySummary, saveAgnesKey, deleteAgnesKey } from "../../../lib/envKeys.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function keySlots(summary) {
  const byIndex = new Map(summary.map((key) => [key.index, key]));
  const indexes = new Set([...Array.from({ length: 10 }, (_, index) => index + 1), ...byIndex.keys()]);
  return [...indexes].sort((a, b) => a - b).map((index) => {
    const key = byIndex.get(index);
    return {
      index,
      name: "Agnes #" + index,
      role: index === 1 ? "story-images" : "motion",
      configured: Boolean(key),
      masked: key?.masked || null,
      source: key?.source || null,
    };
  });
}

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  try {
    const summary = await getKeySummary();
    const keys = keySlots(summary);
    return Response.json({
      storage: "turso-encrypted",
      keys,
      total: summary.length,
      storyImageKeyConfigured: summary.some((key) => key.index === 1),
      motionKeysConfigured: summary.filter((key) => key.index !== 1).length,
    });
  } catch (error) {
    return Response.json({ ok: false, error: String(error.message || error) }, { status: 503 });
  }
}

export async function POST(request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    const saved = await saveAgnesKey(body.index, body.key);
    return Response.json({ ok: true, key: saved });
  } catch (error) {
    return Response.json({ ok: false, error: String(error.message || error) }, { status: 400 });
  }
}

export async function DELETE(request) {
  if (!(await isAuthed())) return unauthorized();
  const index = new URL(request.url).searchParams.get("index");
  try {
    const removed = await deleteAgnesKey(index);
    return Response.json({ ok: true, key: removed });
  } catch (error) {
    return Response.json({ ok: false, error: String(error.message || error) }, { status: 400 });
  }
}
