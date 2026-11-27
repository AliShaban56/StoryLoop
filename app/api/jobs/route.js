import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { createStoryJob } from "../../../lib/pipeline.js";
import { after } from "next/server";
import { tickJob } from "../../../lib/pipeline.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await request.json().catch(() => ({}));
  try {
    const job = await createStoryJob({ theme: body.theme });
    after(() => tickJob(job.id).catch((error) => {
      console.error("[jobs] initial tick failed", job.id, error);
    }));
    return Response.json({ ok: true, job }, { status: 202 });
  } catch (error) {
    return Response.json({ ok: false, error: String(error.message || error) }, { status: 500 });
  }
}
