import { isAuthed, unauthorized } from "../../../../lib/auth.js";
import { getJob } from "../../../../lib/jobStore.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  if (!(await isAuthed())) return unauthorized();
  const params = await context.params;
  const job = await getJob(params.id);
  if (!job) return Response.json({ ok: false, error: "job not found" }, { status: 404 });
  return Response.json({ ok: true, job }, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
