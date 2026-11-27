// خط الإنتاج اليومي - المرحلة 3: قصة → مشاهد → صور → مقاطع متحركة.
// قابل للاستئناف: كل مشهد له status في Turso، وإعادة التشغيل بتكمل من آخر نقطة.
// الصوت (TTS) والتجميع (ffmpeg) والنشر: المراحل 5-6.
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../lib/db.js';
import { withKey } from '../lib/keyManager.js';
import * as agnes from '../lib/agnes.js';

const VIDEOS_PER_DAY = Number(process.env.VIDEOS_PER_DAY || 2);
const SCENES_PER_VIDEO = Number(process.env.SCENES_PER_VIDEO || 8); // 8 × ~7.5s ≈ 60s
const OUT = process.env.OUT_DIR || 'out';

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()); // YYYY-MM-DD

function parseJson(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function recentTitles() {
  const r = await db.execute('SELECT title FROM stories WHERE title IS NOT NULL ORDER BY id DESC LIMIT 30');
  return r.rows.map((x) => x.title);
}

async function createStory(day, slot) {
  const avoid = await recentTitles();
  const prompt = `اكتب قصة أطفال عربية قصيرة (فيها قيمة أخلاقية بسيطة) تتحكي في دقيقة واحدة تقريباً.
قسّمها إلى ${SCENES_PER_VIDEO} مشاهد بالظبط. لا تكرر هذه العناوين: ${avoid.join(' | ') || 'لا شيء'}.
رجّع JSON فقط بهذا الشكل بدون أي نص آخر:
{
 "title": "عنوان عربي",
 "character_sheet": "English: fixed visual description of each character and the art style (e.g. 'soft 3D Pixar-like children's illustration, ...') to keep consistency",
 "scenes": [
  {"narration": "نص التعليق الصوتي لهذا المشهد بالعربية (جملتين أو ثلاث، حوالي 7 ثواني قراءة)",
   "image_prompt": "English description of the frame, vertical 9:16 composition",
   "motion_prompt": "English short description of the camera/character motion"}
 ]
}`;
  const text = await withKey('agnes', (k) => agnes.chat(k, [{ role: 'user', content: prompt }]));
  const s = parseJson(text);
  if (!Array.isArray(s.scenes) || s.scenes.length < 3) throw new Error('Story JSON has too few scenes');

  const ins = await db.execute({
    sql: 'INSERT INTO stories (day, slot, title, character_sheet) VALUES (?, ?, ?, ?)',
    args: [day, slot, s.title, s.character_sheet || ''],
  });
  const storyId = Number(ins.lastInsertRowid);
  for (let i = 0; i < s.scenes.length; i++) {
    const sc = s.scenes[i];
    await db.execute({
      sql: 'INSERT INTO scenes (story_id, idx, narration, image_prompt, motion_prompt) VALUES (?, ?, ?, ?, ?)',
      args: [storyId, i, sc.narration, sc.image_prompt, sc.motion_prompt],
    });
  }
  console.log(`[story] #${storyId} "${s.title}" (${s.scenes.length} scenes)`);
  return storyId;
}

async function saveAsset({ type, prompt, sourceUrl, b64, file, ext }) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (b64) {
    await fs.writeFile(file, Buffer.from(b64, 'base64'));
  } else {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  const r = await db.execute({
    sql: 'INSERT INTO assets (type, prompt, source_url, local_path) VALUES (?, ?, ?, ?)',
    args: [type, prompt, sourceUrl || null, file],
  });
  return Number(r.lastInsertRowid);
}

async function processScene(story, scene) {
  const dir = path.join(OUT, `${story.day}_s${story.slot}`);
  const fullImagePrompt = `${story.character_sheet}\n${scene.image_prompt}`;

  // 1) الصورة
  if (scene.status === 'pending') {
    const img = await withKey('agnes', (k) => agnes.image(k, fullImagePrompt));
    const assetId = await saveAsset({
      type: 'image', prompt: fullImagePrompt, sourceUrl: img.url, b64: img.b64,
      file: path.join(dir, `scene${scene.idx}.png`),
    });
    await db.execute({ sql: "UPDATE scenes SET image_asset_id=?, status='image_done' WHERE id=?", args: [assetId, scene.id] });
    scene.image_asset_id = assetId;
    scene.status = 'image_done';
    scene._imageRef = img.url || `data:image/png;base64,${img.b64}`;
  }

  // 2) التحريك (image-to-video)
  if (scene.status === 'image_done') {
    if (!scene._imageRef) {
      const a = await db.execute({ sql: 'SELECT source_url FROM assets WHERE id=?', args: [scene.image_asset_id] });
      scene._imageRef = a.rows[0]?.source_url || null;
    }
    const clip = await withKey('agnes', (k) =>
      agnes.video(k, `${scene.motion_prompt}. ${scene.image_prompt}`, scene._imageRef),
    );
    const assetId = await saveAsset({
      type: 'clip', prompt: scene.motion_prompt, sourceUrl: clip.url,
      file: path.join(dir, `scene${scene.idx}.mp4`),
    });
    await db.execute({ sql: "UPDATE scenes SET clip_asset_id=?, status='clip_done' WHERE id=?", args: [assetId, scene.id] });
    scene.status = 'clip_done';
  }
}

async function runSlot(day, slot) {
  let r = await db.execute({ sql: 'SELECT * FROM stories WHERE day=? AND slot=?', args: [day, slot] });
  let story = r.rows[0];
  if (!story) {
    await createStory(day, slot);
    r = await db.execute({ sql: 'SELECT * FROM stories WHERE day=? AND slot=?', args: [day, slot] });
    story = r.rows[0];
  }
  if (story.status !== 'pending') {
    console.log(`[slot ${slot}] already ${story.status}, skipping`);
    return;
  }
  const sc = await db.execute({ sql: 'SELECT * FROM scenes WHERE story_id=? ORDER BY idx', args: [story.id] });
  const scenes = sc.rows.map((x) => ({ ...x }));
  let failed = 0;
  for (const scene of scenes) {
    if (scene.status === 'clip_done') continue;
    try {
      await processScene(story, scene);
      console.log(`[slot ${slot}] scene ${scene.idx} ✓`);
    } catch (e) {
      failed++;
      console.error(`[slot ${slot}] scene ${scene.idx} ✗ ${e.message}`);
      await db.execute({ sql: 'UPDATE scenes SET error=? WHERE id=?', args: [String(e.message).slice(0, 300), scene.id] });
    }
  }
  if (failed === 0) {
    await db.execute({ sql: "UPDATE stories SET status='scenes_done' WHERE id=?", args: [story.id] });
    console.log(`[slot ${slot}] all scenes done → next: TTS + assemble + publish`);
  } else {
    console.warn(`[slot ${slot}] ${failed} scenes failed; re-run to resume`);
    process.exitCode = 1;
  }
}

const day = today();
for (let slot = 1; slot <= VIDEOS_PER_DAY; slot++) {
  await runSlot(day, slot);
}
