import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { getStoryImageKey } from "../../../lib/envKeys.js";
import * as agnes from "../../../lib/agnes.js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  try {
    const key = await getStoryImageKey();
    const reply = await agnes.chat(key, [{ role: "user", content: "رد بكلمة واحدة: تمام" }]);
    return Response.json({ ok: true, reply: String(reply).slice(0, 100) });
  } catch (error) {
    return Response.json({ ok: false, error: String(error.message).slice(0, 200) }, { status: 400 });
  }
}
