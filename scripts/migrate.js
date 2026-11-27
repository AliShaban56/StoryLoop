import fs from "node:fs/promises";
import { db } from "../lib/db.js";

const sql = await fs.readFile(new URL("../schema.sql", import.meta.url), "utf8");
await db.executeMultiple(sql);

async function ensureColumn(table, column, definition) {
  const info = await db.execute("PRAGMA table_info(" + table + ")");
  const exists = info.rows.some((row) => row.name === column);
  if (!exists) {
    await db.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
    console.log("[migrate] added " + table + "." + column);
  }
}

await ensureColumn("stories", "style", "TEXT");
await ensureColumn("stories", "characters_json", "TEXT");
await ensureColumn("stories", "job_id", "TEXT");
await ensureColumn("scenes", "image_url", "TEXT");
await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_job_id ON stories(job_id) WHERE job_id IS NOT NULL");

console.log("schema applied ✓");
