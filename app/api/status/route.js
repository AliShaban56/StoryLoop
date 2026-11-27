import fs from "node:fs/promises";
import path from "node:path";
import { isAuthed, unauthorized } from "../../../lib/auth.js";
import { getAgnesKeys } from "../../../lib/envKeys.js";
import { pingRedis } from "../../../lib/jobStore.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureColumn(db, table, column, definition) {
  const info = await db.execute("PRAGMA table_info(" + table + ")");
  if (!info.rows.some((row) => row.name === column)) {
    await db.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
  }
}

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const lamps = [];
  let keys = [];
  try {
    keys = await getAgnesKeys();
    lamps.push({
      id: "agnes_text_images",
      label: "Agnes — النص والصور",
      state: keys.some((key) => key.index === 1) ? "ok" : "error",
      detail: keys.some((key) => key.index === 1) ? "المفتاح رقم 1 محفوظ وجاهز" : "احفظ مفتاح Agnes رقم 1 من قسم ربط المفاتيح",
    });
    const motionCount = keys.filter((key) => key.index !== 1).length;
    lamps.push({
      id: "agnes_motion",
      label: "Agnes — التحريك المتوازي",
      state: motionCount ? "ok" : "error",
      detail: motionCount + " مفاتيح تحريك محفوظة",
    });
  } catch (error) {
    lamps.push({ id: "agnes_text_images", label: "Agnes — النص والصور", state: "error", detail: String(error.message).slice(0, 140) });
    lamps.push({ id: "agnes_motion", label: "Agnes — التحريك المتوازي", state: "error", detail: "تعذر قراءة المفاتيح من قاعدة البيانات" });
  }

  lamps.push({
    id: "fox_reference",
    label: "الصورة المرجعية للثعلب",
    state: process.env.FOX_REFERENCE_IMAGE_URL ? "ok" : "error",
    detail: process.env.FOX_REFERENCE_IMAGE_URL ? "الرابط مضبوط" : "اضبط FOX_REFERENCE_IMAGE_URL كرابط HTTPS عام",
  });

  try {
    await pingRedis();
    lamps.push({ id: "redis", label: "تخزين المهام والطوابير", state: "ok", detail: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? "Redis / KV متصل" : "يعمل عبر Turso — لا يلزم Redis" });
  } catch (error) {
    lamps.push({ id: "redis", label: "تخزين المهام والطوابير", state: "error", detail: String(error.message).slice(0, 140) });
  }

  try {
    const { db } = await import("../../../lib/db.js");
    await db.execute("SELECT 1");
    const sql = await fs.readFile(path.join(process.cwd(), "schema.sql"), "utf8");
    await db.executeMultiple(sql);
    await ensureColumn(db, "stories", "style", "TEXT");
    await ensureColumn(db, "stories", "characters_json", "TEXT");
    await ensureColumn(db, "stories", "job_id", "TEXT");
    await ensureColumn(db, "scenes", "image_url", "TEXT");
    await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_job_id ON stories(job_id) WHERE job_id IS NOT NULL");
    lamps.push({ id: "turso", label: "قاعدة البيانات (Turso)", state: "ok", detail: "متصلة والجداول محدثة — تخزين المفاتيح مشفّر" });
  } catch (error) {
    lamps.push({ id: "turso", label: "قاعدة البيانات (Turso)", state: "error", detail: String(error.message).slice(0, 140) });
  }

  lamps.push({
    id: "fal",
    label: "منصة التحريك الاحتياطية (fal.ai)",
    state: process.env.FAL_KEY ? "ok" : "idle",
    detail: process.env.FAL_KEY ? (process.env.FAL_I2V_MODEL || "fal-ai/kling-video/v3/standard/image-to-video") : "اختياري — اضبط FAL_KEY لتفعيل التحويل الاحتياطي",
  });
  return Response.json({ lamps, keyStorage: "turso-encrypted", configuredAgnesKeys: keys.length });
}
