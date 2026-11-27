import { after } from "next/server";
import { isAuthed, unauthorized } from "../../../../lib/auth.js";
import { createStoryJob, tickJob } from "../../../../lib/pipeline.js";
import { getJob } from "../../../../lib/jobStore.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// A single idempotent three-scene smoke run; it cannot create an unlimited job queue.
const DEMO_JOB_ID = "storyloop-three-scene-test-2026-11-27";

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  try {
    let job = await getJob(DEMO_JOB_ID);
    let created = false;
    if (!job) {
      job = await createStoryJob({
        jobId: DEMO_JOB_ID,
        sceneCount: 3,
        theme: "حكاية سينمائية قصيرة عن ثعلب صغير يعثر على نجمة ضائعة قرب قرية مصرية على ضفة النيل، ويحاول إعادتها إلى السماء. اجعل القصة مشوقة ودافئة وبنهاية مؤثرة، بثلاثة مشاهد مترابطة بالضبط."
      });
      created = true;
    }
    if (!["completed", "ready_for_assembly", "failed"].includes(job.status)) {
      after(() => tickJob(job.id).catch((error) => {
        console.error("[three-scene-demo] pipeline tick failed", error);
      }));
    }
    return Response.json({
      ok: true,
      created,
      scheduled: !["completed", "ready_for_assembly", "failed"].includes(job.status),
      job,
    }, { status: created ? 202 : 200 });
  } catch (error) {
    return Response.json({ ok: false, error: String(error.message || error).slice(0, 300) }, { status: 500 });
  }
}
