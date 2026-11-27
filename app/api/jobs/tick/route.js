import { after } from "next/server";
import { isAuthed, unauthorized } from "../../../../lib/auth.js";
import { tickJob } from "../../../../lib/pipeline.js";
import { getJob } from "../../../../lib/jobStore.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// This endpoint only schedules one durable state-machine step. It never waits for generation.
export async function POST(request) {
  if (!(await isAuthed())) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const jobId = String(body.jobId || "");
  if (!jobId) return Response.json({ ok: false, error: "jobId is required" }, { status: 400 });
  const job = await getJob(jobId);
  if (!job) return Response.json({ ok: false, error: "job not found" }, { status: 404 });

  after(() => tickJob(jobId).catch((error) => {
    console.error("[jobs/tick] background step failed", jobId, error);
  }));
  return Response.json({
    ok: true,
    scheduled: true,
    jobId,
    status: job.status,
    stage: job.stage,
  }, { status: 202 });
}
