import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { getKeySummary } from "../../../lib/envKeys.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Secrets are never returned. Keys are read only from AGNES_API_KEY_N environment variables.
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const keys = getKeySummary();
  return Response.json({
    storage: "environment",
    keys,
    total: keys.length,
    storyImageKeyConfigured: keys.some((key) => key.index === 1),
    motionKeysConfigured: keys.filter((key) => key.role === "motion").length,
  });
}

function envOnly() {
  return Response.json({
    ok: false,
    error: "API keys are environment-only. Configure AGNES_API_KEY_1, AGNES_API_KEY_2, ... in your deployment settings.",
  }, { status: 405 });
}

export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  return envOnly();
}

export async function PATCH() {
  if (!(await isAuthed())) return unauthorized();
  return envOnly();
}

export async function DELETE() {
  if (!(await isAuthed())) return unauthorized();
  return envOnly();
}
