// Assemble only stories whose every numbered scene has a completed clip.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../lib/db.js";
import { getJob, saveJob } from "../lib/jobStore.js";
import { muxScene, concat } from "../lib/ffmpeg.js";

const run = promisify(execFile);
const OUT = process.env.OUT_DIR || "out";
const VOICE = process.env.TTS_VOICE || "ar-EG-SalmaNeural";
const RATE = process.env.TTS_RATE || "-5%";

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function ensureFile(assetId) {
  const result = await db.execute({ sql: "SELECT local_path, source_url FROM assets WHERE id = ?", args: [assetId] });
  const asset = result.rows[0];
  if (!asset) throw new Error("Missing asset " + assetId);
  if (asset.local_path && await exists(asset.local_path)) return asset.local_path;
  if (!asset.source_url) throw new Error("Asset " + assetId + " has no download URL");
  const response = await fetch(asset.source_url);
  if (!response.ok) throw new Error("Asset download failed with HTTP " + response.status);
  const target = asset.local_path || path.join(OUT, "downloads", "asset-" + assetId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

async function tts(text, file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await run("edge-tts", ["--voice", VOICE, "--rate=" + RATE, "--text", text, "--write-media", file]);
}

async function finishStory(story) {
  const dir = path.join(OUT, String(story.day) + "_s" + String(story.slot));
  const result = await db.execute({
    sql: "SELECT * FROM scenes WHERE story_id = ? ORDER BY idx ASC",
    args: [story.id],
  });
  const scenes = result.rows;
  if (!scenes.length || scenes.some((scene) => !scene.clip_asset_id)) {
    throw new Error("Refusing to assemble: one or more numbered scene clips are missing");
  }

  const parts = [];
  for (const scene of scenes) {
    const audioFile = path.join(dir, "scene" + (Number(scene.idx) + 1) + ".mp3");
    if (!scene.audio_asset_id || !(await exists(audioFile))) {
      await tts(scene.narration, audioFile);
      const audio = await db.execute({
        sql: "INSERT INTO assets (type, prompt, local_path) VALUES (?, ?, ?)",
        args: ["audio", scene.narration, audioFile],
      });
      await db.execute({
        sql: "UPDATE scenes SET audio_asset_id = ? WHERE id = ?",
        args: [Number(audio.lastInsertRowid), scene.id],
      });
    }

    const clipFile = await ensureFile(scene.clip_asset_id);
    const sceneOut = path.join(dir, "scene" + (Number(scene.idx) + 1) + "_final.mp4");
    await muxScene(clipFile, audioFile, sceneOut);
    parts.push(sceneOut);
    console.log("[finish] story " + story.id + " scene " + (Number(scene.idx) + 1) + " ✓");
  }

  const finalFile = path.join(dir, "final.mp4");
  await concat(parts, finalFile);
  const finalAsset = await db.execute({
    sql: "INSERT INTO assets (type, prompt, local_path) VALUES (?, ?, ?)",
    args: ["final", story.title, finalFile],
  });
  await db.execute({ sql: "UPDATE stories SET status = 'assembled' WHERE id = ?", args: [story.id] });

  if (story.job_id) {
    try {
      const job = await getJob(story.job_id);
      if (job) {
        job.status = "completed";
        job.stage = "completed";
        job.progress = 100;
        job.finalPath = finalFile;
        job.finalAssetId = Number(finalAsset.lastInsertRowid);
        job.error = null;
        await saveJob(job);
      }
    } catch (error) {
      console.error("[finish] could not update Redis job status:", error.message);
    }
  }
  console.log("[finish] story " + story.id + " assembled → " + finalFile);
}

const pending = await db.execute("SELECT * FROM stories WHERE status = 'scenes_done' ORDER BY id ASC");
for (const story of pending.rows) {
  try {
    await finishStory(story);
  } catch (error) {
    console.error("[finish] story " + story.id + " ✗ " + error.message);
    process.exitCode = 1;
  }
}
