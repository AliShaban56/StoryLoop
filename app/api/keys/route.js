import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { getKeySummary } from "../../../lib/envKeys.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Return configuration state and masked hints only. Secret values never leave the server.
export async function GET() {
  if (!(await isAuthed())) return unauthorized();

  const configured = getKeySummary();
  const byIndex = new Map(configured.map((key) => [key.index, key]));
  const visibleIndexes = new Set([...Array.from({ length: 10 }, (_, index) => index + 1), ...byIndex.keys()]);
  const keys = [...visibleIndexes]
    .sort((a, b) => a - b)
    .map((index) => {
      const key = byIndex.get(index);
      return {
        index,
        name: "AGNES_API_KEY_" + index,
        role: index === 1 ? "story-images" : "motion",
        configured: Boolean(key),
        masked: key?.masked || null,
      };
    });

  return Response.json({
    storage: "environment",
    keys,
    total: configured.length,
    storyImageKeyConfigured: byIndex.has(1),
    motionKeysConfigured: configured.filter((key) => key.index !== 1).length,
    settingsUrl: "https://vercel.com/a-2731/story-loop/settings/environment-variables",
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
