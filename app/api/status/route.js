import fs from "node:fs/promises";
import path from "node:path";
import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { getAgnesKeys } from "../../../lib/envKeys.js";
import { pingRedis } from "../../../lib/jobStore.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const lamps = [];
  const keys = getAgnesKeys();
  lamps.push({
    id: "agnes_text_images",
    label: "Agnes — النص والصور",
    state: keys.some((key) => key.index === 1) ? "ok" : "error",
    detail: keys.some((key) => key.index === 1) ? "المفتاح رقم 1 مضبوط في Environment Variables" : "اضبط AGNES_API_KEY_1",
  });
  const motionCount = keys.filter((key) => key.index !== 1).length;
  lamps.push({
    id: "agnes_motion",
    label: "Agnes — التحريك المتوازي",
    state: motionCount ? "ok" : "error",
    detail: motionCount + " مفاتيح تحريك من Environment Variables",
  });
  lamps.push({
    id: "fox_reference",
    label: "الصورة المرجعية للثعلب",
    state: process.env.FOX_REFERENCE_IMAGE_URL ? "ok" : "error",
    detail: process.env.FOX_REFERENCE_IMAGE_URL ? "الرابط مضبوط" : "اضبط FOX_REFERENCE_IMAGE_URL كرابط HTTPS عام",
  });

  try {
    await pingRedis();
    lamps.push({ id: "redis", label: "Redis / KV — حالة المهام", state: "ok", detail: "متصل" });
  } catch (error) {
    lamps.push({ id: "redis", label: "Redis / KV — حالة المهام", state: "error", detail: String(error.message).slice(0, 140) });
  }

  try {
    const { db } = await import("../../../lib/db.js");
    await db.execute("SELECT 1");
    const sql = await fs.readFile(path.join(process.cwd(), "schema.sql"), "utf8");
    await db.executeMultiple(sql);
    lamps.push({ id: "turso", label: "قاعدة البيانات (Turso)", state: "ok", detail: "متصلة" });
  } catch (error) {
    lamps.push({ id: "turso", label: "قاعدة البيانات (Turso)", state: "error", detail: String(error.message).slice(0, 140) });
  }

  lamps.push({
    id: "fal",
    label: "منصة التحريك الاحتياطية (fal.ai)",
    state: process.env.FAL_KEY ? "ok" : "idle",
    detail: process.env.FAL_KEY ? (process.env.FAL_I2V_MODEL || "fal-ai/kling-video/v3/standard/image-to-video") : "اختياري — اضبط FAL_KEY لتفعيل التحويل الاحتياطي",
  });
  return Response.json({ lamps, keyStorage: "environment-only" });
}
