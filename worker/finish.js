// المرحلة 5: تعليق صوتي عربي (Edge TTS) + تجميع المشاهد → final.mp4
// بياخد القصص اللي حالتها scenes_done ويخليها assembled.
// المتطلبات: ffmpeg + `pip install edge-tts`
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../lib/db.js';
import { muxScene, concat } from '../lib/ffmpeg.js';

const run = promisify(execFile);
const OUT = process.env.OUT_DIR || 'out';
const VOICE = process.env.TTS_VOICE || 'ar-EG-SalmaNeural'; // أو ar-EG-ShakirNeural
const RATE = process.env.TTS_RATE || '-5%'; // أبطأ شوية للأطفال

async function exists(f) { try { await fs.access(f); return true; } catch { return false; } }

async function ensureFile(assetId) {
  const r = await db.execute({ sql: 'SELECT local_path, source_url FROM assets WHERE id=?', args: [assetId] });
  const a = r.rows[0];
  if (await exists(a.local_path)) return a.local_path;
  // الـ runner اتغيّر؟ نحمّل تاني من رابط المزود (لو لسه صالح)
  const res = await fetch(a.source_url);
  if (!res.ok) throw new Error(`file missing and re-download failed (${res.status})`);
  await fs.mkdir(path.dirname(a.local_path), { recursive: true });
  await fs.writeFile(a.local_path, Buffer.from(await res.arrayBuffer()));
  return a.local_path;
}

async function tts(text, file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // execFile بدون shell: النص بيتمرر كـ argument آمن
  await run('edge-tts', ['--voice', VOICE, `--rate=${RATE}`, '--text', text, '--write-media', file]);
}

async function finishStory(story) {
  const dir = path.join(OUT, `${story.day}_s${story.slot}`);
  const sc = await db.execute({ sql: 'SELECT * FROM scenes WHERE story_id=? ORDER BY idx', args: [story.id] });
  const parts = [];

  for (const scene of sc.rows) {
    const audioFile = path.join(dir, `scene${scene.idx}.mp3`);
    if (!scene.audio_asset_id) {
      await tts(scene.narration, audioFile);
      const r = await db.execute({
        sql: 'INSERT INTO assets (type, prompt, local_path) VALUES (?, ?, ?)',
        args: ['audio', scene.narration, audioFile],
      });
      await db.execute({ sql: 'UPDATE scenes SET audio_asset_id=? WHERE id=?', args: [Number(r.lastInsertRowid), scene.id] });
    }
    const clipFile = await ensureFile(scene.clip_asset_id);
    const sceneOut = path.join(dir, `scene${scene.idx}_final.mp4`);
    await muxScene(clipFile, audioFile, sceneOut);
    parts.push(sceneOut);
    console.log(`[finish] story ${story.id} scene ${scene.idx} ✓`);
  }

  const finalFile = path.join(dir, 'final.mp4');
  await concat(parts, finalFile);
  await db.execute({ sql: 'INSERT INTO assets (type, prompt, local_path) VALUES (?, ?, ?)', args: ['final', story.title, finalFile] });
  await db.execute({ sql: "UPDATE stories SET status='assembled' WHERE id=?", args: [story.id] });
  console.log(`[finish] story ${story.id} "${story.title}" → ${finalFile}`);
}

const r = await db.execute("SELECT * FROM stories WHERE status='scenes_done' ORDER BY id");
for (const story of r.rows) {
  try {
    await finishStory(story);
  } catch (e) {
    console.error(`[finish] story ${story.id} ✗ ${e.message}`);
    process.exitCode = 1;
  }
}
