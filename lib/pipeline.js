import { randomUUID } from "node:crypto";
import path from "node:path";
import { db } from "./db.js";
import * as agnes from "./agnes.js";
import * as fal from "./fal.js";
import { getStoryImageKey, getMotionKeys } from "./envKeys.js";
import { createJobRecord, getJob, saveJob, acquireJobLock, releaseJobLock, acquireMotionKeyLease, renewMotionKeyLease, releaseMotionKeyLease } from "./jobStore.js";

const SCENE_COUNT = Math.max(1, Number(process.env.SCENES_PER_VIDEO || 8));
const OUT = process.env.OUT_DIR || "out";
const MAX_ATTEMPTS = Math.max(1, Number(process.env.AGNES_MAX_ATTEMPTS_PER_SCENE || 8));
const TRANSIENT_MAX = Math.max(1, Number(process.env.AGNES_TRANSIENT_MAX || 5));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cairoDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

function backoff(attempt, baseMs) {
  return Math.min(5 * 60 * 1000, (baseMs || 5000) * Math.pow(2, Math.max(0, attempt - 1)));
}

function transient(error) {
  return agnes.isTransientProviderError(error);
}

function parseJson(raw) {
  const cleaned = String(raw || "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Text model did not return a JSON object");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function characterSheet(characters) {
  return Object.entries(characters).map(([name, description]) => name + ": " + description).join("\n");
}

function validateStory(story, sceneCount = SCENE_COUNT) {
  if (!story || typeof story.title !== "string" || !story.title.trim()) {
    throw new Error("Story JSON is missing title");
  }
  if (typeof story.style !== "string" || !story.style.trim()) {
    throw new Error("Story JSON is missing the global visual style");
  }
  if (!story.characters || typeof story.characters !== "object" || Array.isArray(story.characters)) {
    throw new Error("Story JSON must include a characters object");
  }
  if (!story.characters.fox || typeof story.characters.fox !== "string") {
    throw new Error("Story JSON must include a fixed fox character description");
  }
  if (!Array.isArray(story.scenes) || story.scenes.length !== sceneCount) {
    throw new Error("Story JSON must contain exactly " + sceneCount + " scenes");
  }
  story.scenes.forEach((scene, index) => {
    if (Number(scene.n) !== index + 1) throw new Error("Scene numbers must be consecutive from 1 to " + sceneCount);
    if (!scene.narration || !scene.image_prompt || !scene.motion_prompt) {
      throw new Error("Scene " + (index + 1) + " is missing a required prompt field");
    }
  });
  return story;
}

export async function createStoryJob(options) {
  const opts = options || {};
  const requestedCount = Number(opts.sceneCount || SCENE_COUNT);
  const sceneCount = Number.isInteger(requestedCount) ? Math.max(1, Math.min(20, requestedCount)) : SCENE_COUNT;
  const id = String(opts.jobId || randomUUID());
  const job = {
    id,
    status: "queued",
    stage: "story",
    theme: String(opts.theme || "قصة أطفال ممتعة عن الثعلب وقيمة أخلاقية بسيطة"),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: 0,
    storyId: null,
    sceneCount,
    scenes: [],
    error: null,
    lastError: null,
  };
  await createJobRecord(job);
  return job;
}

async function generateStory(job) {
  const key = await getStoryImageKey();
  const avoidRows = await db.execute("SELECT title FROM stories WHERE title IS NOT NULL ORDER BY id DESC LIMIT 30");
  const avoid = avoidRows.rows.map((row) => row.title).join(" | ");
  const prompt = [
    "اكتب قصة أطفال عربية أصلية ومترابطة، مدتها الإجمالية نحو دقيقة، وبطلها ثعلب مطابق للشخصية المرجعية.",
    "استخدم ستايل بصري واحد فقط في القصة كلها، ووصفًا ثابتًا لكل شخصية لا يتغير بين المشاهد.",
    "أنشئ " + job.sceneCount + " مشاهد بالضبط، مرقمة من 1 إلى " + job.sceneCount + " دون فقد أو تكرار.",
    "اجعل narration بالعربية، واجعل style وcharacter descriptions وimage_prompt وmotion_prompt بالإنجليزية.",
    "تجنب العناوين السابقة: " + (avoid || "لا يوجد") + ".",
    "فكرة القصة المطلوبة: " + job.theme,
    "أخرج JSON فقط بهذا الشكل:",
    JSON.stringify({
      title: "عنوان القصة بالعربية",
      style: "One fixed global visual style and lighting bible in English",
      characters: {
        fox: "Fixed English description of the exact fox identity, fur, face, clothing and proportions",
        friend: "Optional fixed description for another character"
      },
      scenes: [{
        n: 1,
        narration: "التعليق الصوتي لهذا المشهد بالعربية",
        image_prompt: "English visual description of this exact scene in vertical 9:16",
        motion_prompt: "English description of subtle natural image-to-video motion"
      }]
    }, null, 2),
    "لا تضف أي شرح خارج JSON.",
  ].join("\n");

  job.hasFoxReference = Boolean(process.env.FOX_REFERENCE_IMAGE_URL);
  const raw = await agnes.chat(key, [{ role: "user", content: prompt }]);
  const story = validateStory(parseJson(raw), job.sceneCount);
  const day = cairoDay();
  const sheet = characterSheet(story.characters);
  // Allocate the slot in the same SQLite statement as the insert to avoid
  // duplicate (day, slot) collisions when two jobs start together.
  const inserted = await db.execute({
    sql: "INSERT INTO stories (day, slot, title, character_sheet, style, characters_json, job_id, status) SELECT ?, COALESCE(MAX(slot), 0) + 1, ?, ?, ?, ?, ?, 'pending' FROM stories WHERE day = ?",
    args: [day, story.title, sheet, story.style, JSON.stringify(story.characters), job.id, day],
  });
  const storyId = Number(inserted.lastInsertRowid);
  const slotRow = await db.execute({ sql: "SELECT slot FROM stories WHERE id = ?", args: [storyId] });
  const slot = Number(slotRow.rows[0]?.slot || 1);

  for (const scene of story.scenes) {
    await db.execute({
      sql: "INSERT INTO scenes (story_id, idx, narration, image_prompt, motion_prompt, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      args: [storyId, Number(scene.n) - 1, scene.narration, scene.image_prompt, scene.motion_prompt],
    });
  }

  const sceneRows = await db.execute({
    sql: "SELECT id, idx FROM scenes WHERE story_id = ? ORDER BY idx",
    args: [storyId],
  });
  job.storyId = storyId;
  job.day = day;
  job.slot = slot;
  job.title = story.title;
  job.style = story.style;
  job.characters = story.characters;
  job.stage = "images";
  job.status = "running";
  job.scenes = sceneRows.rows.map((row) => ({
    sceneId: Number(row.id),
    n: Number(row.idx) + 1,
    imageStatus: "pending",
    imageUrl: null,
    imageAttempts: 0,
    imageNextAt: 0,
    motionStatus: "queued",
    motionProvider: null,
    keyIndex: null,
    videoId: null,
    model: null,
    falRequestId: null,
    falStatusUrl: null,
    falResponseUrl: null,
    failedKeyIndexes: [],
    motionAttempts: 0,
    transientAttempts: 0,
    nextPollAt: 0,
    nextRunAt: 0,
    error: null,
  }));
  job.progress = 3;
  job.lastError = null;
  return job;
}

function buildImagePrompt(job, scene) {
  const descriptions = characterSheet(job.characters || {});
  return [
    "GLOBAL STYLE LOCK: " + job.style,
    "FIXED CHARACTER BIBLE (never redesign, recolor, resize, or change clothing):",
    descriptions,
    job.hasFoxReference ? "FOX REFERENCE LOCK: use the supplied fox reference image as the canonical identity. The fox must remain visibly identical in every scene." : "FOX CHARACTER LOCK: keep the fox appearance identical in every scene using the fixed character description above; no reference image is currently configured.",
    "SCENE " + scene.n + ": " + scene.image_prompt,
    "Composition: portrait 9:16, one coherent cinematic children's animation frame, no text, no logos, no watermark.",
    "Keep all recurring characters consistent with the character bible and the supplied reference image.",
  ].join("\n");
}

async function saveAsset(type, prompt, url, localPath) {
  const result = await db.execute({
    sql: "INSERT INTO assets (type, prompt, source_url, local_path) VALUES (?, ?, ?, ?)",
    args: [type, prompt, url, localPath],
  });
  return Number(result.lastInsertRowid);
}

async function generateNextImage(job) {
  const scene = job.scenes.find((item) => item.imageStatus !== "done");
  if (!scene) {
    job.stage = "motion";
    return;
  }
  if (scene.imageNextAt && scene.imageNextAt > Date.now()) return;

  const reference = process.env.FOX_REFERENCE_IMAGE_URL;
  if (!reference) throw new Error("FOX_REFERENCE_IMAGE_URL must be set to the public fox reference image");
  const imagePrompt = buildImagePrompt(job, scene);
  try {
    const image = await agnes.image(await getStoryImageKey(), imagePrompt, { referenceImageUrl: reference });
    if (!image.url) throw new Error("Agnes must return an image URL for persistent scene storage");
    const localPath = path.join(OUT, String(job.day) + "_s" + String(job.slot), "scene" + scene.n + ".png");
    const assetId = await saveAsset("image", imagePrompt, image.url, localPath);
    await db.execute({
      sql: "UPDATE scenes SET image_asset_id = ?, image_url = ?, status = 'image_done', error = NULL WHERE id = ?",
      args: [assetId, image.url, scene.sceneId],
    });
    scene.imageStatus = "done";
    scene.imageUrl = image.url;
    scene.imageAssetId = assetId;
    scene.error = null;
    scene.imageNextAt = 0;
  } catch (error) {
    scene.imageAttempts += 1;
    scene.error = String(error.message || error).slice(0, 300);
    if (transient(error) && scene.imageAttempts < MAX_ATTEMPTS) {
      scene.imageNextAt = Date.now() + backoff(scene.imageAttempts, 7000);
      job.lastError = scene.error;
      return;
    }
    await db.execute({ sql: "UPDATE scenes SET error = ? WHERE id = ?", args: [scene.error, scene.sceneId] });
    if (scene.imageAttempts >= MAX_ATTEMPTS || !transient(error)) {
      job.status = "failed";
      job.stage = "failed";
      job.error = "Image generation failed at scene " + scene.n + ": " + scene.error;
    }
  }

  const done = job.scenes.filter((item) => item.imageStatus === "done").length;
  job.progress = 5 + Math.floor((done / job.sceneCount) * 35);
  if (done === job.sceneCount) job.stage = "motion";
}

async function markAgnesFailure(scene, error) {
  scene.error = String(error.message || error).slice(0, 300);
  if (transient(error)) {
    scene.transientAttempts += 1;
    if (scene.transientAttempts >= TRANSIENT_MAX && process.env.FAL_KEY) {
      scene.motionProvider = "fal";
      scene.motionStatus = "queued";
      scene.keyIndex = null;
      scene.videoId = null;
      scene.nextRunAt = Date.now();
      return;
    }
    if (scene.transientAttempts >= TRANSIENT_MAX + 3 && !process.env.FAL_KEY) {
      scene.motionStatus = "failed";
      return;
    }
    if (scene.videoId) {
      scene.nextPollAt = Date.now() + backoff(scene.transientAttempts, 6000);
      scene.motionStatus = "running";
    } else {
      // A failed create request has no task to poll. Requeue without marking the key invalid.
      scene.motionStatus = "queued";
      scene.motionProvider = null;
      scene.keyIndex = null;
      scene.nextRunAt = Date.now() + backoff(scene.transientAttempts, 6000);
    }
    return;
  }

  if (scene.keyIndex !== null) {
    scene.failedKeyIndexes = Array.from(new Set([...(scene.failedKeyIndexes || []), scene.keyIndex]));
  }
  scene.keyIndex = null;
  scene.videoId = null;
  scene.motionStatus = "queued";
  scene.motionProvider = null;
  scene.nextRunAt = Date.now();
  const keys = await getMotionKeys();
  const allKeysFailed = keys.length > 0 && keys.every((key) => scene.failedKeyIndexes.includes(key.index));
  if (allKeysFailed) {
    if (process.env.FAL_KEY) scene.motionProvider = "fal";
    else scene.motionStatus = "failed";
  }
}

async function pollAgnesScene(scene) {
  const keyIndex = scene.keyIndex;
  const leaseToken = scene.motionLockToken;
  const key = (await getMotionKeys()).find((item) => item.index === keyIndex);
  if (!key) {
    await markAgnesFailure(scene, new Error("Assigned Agnes key is no longer configured"));
    await releaseMotionLease(scene, keyIndex, leaseToken);
    return;
  }
  if (leaseToken) {
    let leaseOk = await renewMotionKeyLease(keyIndex, leaseToken, 7200);
    if (!leaseOk) {
      leaseOk = await acquireMotionKeyLease(keyIndex, leaseToken, 7200);
    }
    if (!leaseOk) {
      // Another live job currently owns this key. Keep this task paused until the lease is free.
      scene.nextPollAt = Date.now() + 5000;
      return;
    }
  }
  try {
    const result = await agnes.pollVideo(key.key, scene.videoId, scene.model);
    if (result.done) {
      await saveClipForScene(scene, result.url);
    } else {
      scene.nextPollAt = Date.now() + 5000;
    }
  } catch (error) {
    await markAgnesFailure(scene, error);
    if (scene.motionStatus !== "running") {
      await releaseMotionLease(scene, keyIndex, leaseToken);
    }
  }
}

async function releaseMotionLease(scene, index = scene.keyIndex, token = scene.motionLockToken) {
  if (index === null || index === undefined || !token) return;
  await releaseMotionKeyLease(index, token).catch(() => {});
  if (scene.motionLockToken === token) scene.motionLockToken = null;
}

async function saveClipForScene(scene, url) {
  const localPath = path.join(OUT, String(scene.day) + "_s" + String(scene.slot), "scene" + scene.n + ".mp4");
  const result = await db.execute({
    sql: "INSERT INTO assets (type, prompt, source_url, local_path) VALUES ('clip', ?, ?, ?)",
    args: ["scene " + scene.n + " " + (scene.motion_prompt || ""), url, localPath],
  });
  await db.execute({
    sql: "UPDATE scenes SET clip_asset_id = ?, status = 'clip_done', error = NULL WHERE id = ?",
    args: [Number(result.lastInsertRowid), scene.sceneId],
  });
  scene.clipAssetId = Number(result.lastInsertRowid);
  scene.motionStatus = "done";
  await releaseMotionLease(scene);
  scene.keyIndex = null;
  scene.videoId = null;
  scene.error = null;
}

async function pollFalScene(scene) {
  try {
    const result = await fal.pollVideo({
      requestId: scene.falRequestId,
      statusUrl: scene.falStatusUrl,
      responseUrl: scene.falResponseUrl,
    });
    if (result.done) {
      await saveClipForScene(scene, result.url);
    } else {
      scene.nextPollAt = Date.now() + 7000;
    }
  } catch (error) {
    scene.transientAttempts += 1;
    scene.error = String(error.message || error).slice(0, 300);
    if (!error.permanent && transient(error) && scene.transientAttempts < TRANSIENT_MAX + 3) {
      scene.nextPollAt = Date.now() + backoff(scene.transientAttempts, 7000);
      return;
    }
    scene.motionStatus = "failed";
  }
}

async function advanceMotion(job) {
  const sceneRows = await db.execute({
    sql: "SELECT id, idx, motion_prompt, image_url, status FROM scenes WHERE story_id = ? ORDER BY idx",
    args: [job.storyId],
  });
  for (const row of sceneRows.rows) {
    const task = job.scenes.find((item) => item.sceneId === Number(row.id));
    if (!task) continue;
    task.motion_prompt = row.motion_prompt;
    task.imageUrl = row.image_url || task.imageUrl;
    task.day = job.day;
    task.slot = job.slot;
    if (row.status === "clip_done") task.motionStatus = "done";
  }

  // Recover a submission interrupted before Agnes returned its video_id.
  for (const scene of job.scenes) {
    if (scene.motionStatus === "submitting" && !scene.videoId &&
        scene.submittedAt && Date.now() - scene.submittedAt > 65000) {
      await releaseMotionLease(scene);
      scene.motionStatus = "queued";
      scene.motionProvider = null;
      scene.keyIndex = null;
      scene.motionLockToken = null;
      scene.submittedAt = null;
      scene.nextRunAt = Date.now() + 3000;
    }
  }

  const due = job.scenes.filter((scene) =>
    scene.motionStatus === "running" && (!scene.nextPollAt || scene.nextPollAt <= Date.now())
  );
  await Promise.all(due.map((scene) =>
    scene.motionProvider === "fal" ? pollFalScene(scene) : pollAgnesScene(scene)
  ));

  const failedBeforeAssignment = job.scenes.find((scene) => scene.motionStatus === "failed");
  if (failedBeforeAssignment) {
    const stillActive = job.scenes.some((scene) =>
      scene.motionStatus === "running" || scene.motionStatus === "submitting"
    );
    job.lastError = "Motion generation failed at scene " + failedBeforeAssignment.n + ": " +
      (failedBeforeAssignment.error || "provider failed");
    if (!stillActive) {
      job.status = "failed";
      job.stage = "failed";
      job.error = job.lastError;
      await db.execute({
        sql: "UPDATE scenes SET status = 'failed', error = ? WHERE id = ?",
        args: [job.error, failedBeforeAssignment.sceneId],
      });
    } else {
      // Keep polling existing tasks so they can finish and release their global key leases.
      job.status = "running";
      job.stage = "motion";
    }
    return;
  }

  const motionKeys = await getMotionKeys();
  const busyKeys = new Set(job.scenes
    .filter((scene) => scene.motionStatus === "running" || scene.motionStatus === "submitting")
    .filter((scene) => scene.motionProvider === "agnes" && scene.keyIndex !== null)
    .map((scene) => scene.keyIndex));

  const assignments = [];
  for (const key of motionKeys) {
    if (busyKeys.has(key.index)) continue;
    const scene = job.scenes.find((item) =>
      item.motionStatus === "queued" &&
      item.motionProvider !== "fal" &&
      (!item.nextRunAt || item.nextRunAt <= Date.now()) &&
      !(item.failedKeyIndexes || []).includes(key.index)
    );
    if (!scene) continue;
    const leaseToken = job.id + ":" + scene.sceneId + ":" + randomUUID();
    const leased = await acquireMotionKeyLease(key.index, leaseToken, 7200);
    if (!leased) continue;
    scene.motionLockToken = leaseToken;
    scene.submittedAt = Date.now();
    scene.motionStatus = "submitting";
    scene.motionProvider = "agnes";
    scene.keyIndex = key.index;
    assignments.push({ scene, key });
    busyKeys.add(key.index);
  }

  // Persist leased key ownership before calling the provider so interrupted requests can recover.
  if (assignments.length) {
    try {
      await saveJob(job);
    } catch (error) {
      await Promise.all(assignments.map(({ scene, key }) =>
        releaseMotionLease(scene, key.index, scene.motionLockToken)
      ));
      throw error;
    }
  }

  await Promise.all(assignments.map(async ({ scene, key }) => {
    try {
      const created = await agnes.createVideo(key.key, scene.motion_prompt, scene.imageUrl);
      scene.videoId = created.videoId;
      scene.model = created.model;
      scene.motionStatus = "running";
      scene.submittedAt = null;
      scene.nextPollAt = Date.now() + 7000;
      scene.motionAttempts += 1;
      scene.error = null;
    } catch (error) {
      scene.motionAttempts += 1;
      const keyIndex = scene.keyIndex;
      const leaseToken = scene.motionLockToken;
      await markAgnesFailure(scene, error);
      if (scene.motionStatus !== "running") {
        await releaseMotionLease(scene, keyIndex, leaseToken);
        scene.submittedAt = null;
      }
    }
  }));

  const falQueued = job.scenes.filter((scene) =>
    scene.motionStatus === "queued" &&
    scene.motionProvider === "fal" &&
    (!scene.nextRunAt || scene.nextRunAt <= Date.now())
  );
  if (process.env.FAL_KEY) {
    await Promise.all(falQueued.map(async (scene) => {
      try {
        scene.motionStatus = "submitting";
        scene.motionAttempts += 1;
        const submitted = await fal.submitVideo(scene.motion_prompt, scene.imageUrl);
        scene.falRequestId = submitted.requestId;
        scene.falStatusUrl = submitted.statusUrl;
        scene.falResponseUrl = submitted.responseUrl;
        scene.motionStatus = "running";
        scene.motionProvider = "fal";
        scene.nextPollAt = Date.now() + 7000;
        scene.error = null;
      } catch (error) {
        scene.transientAttempts += 1;
        scene.error = String(error.message || error).slice(0, 300);
        if (!error.permanent && transient(error) && scene.transientAttempts < TRANSIENT_MAX + 3) {
          scene.motionStatus = "queued";
          scene.nextRunAt = Date.now() + backoff(scene.transientAttempts, 8000);
        } else {
          scene.motionStatus = "failed";
        }
      }
    }));
  }

  const unassigned = job.scenes.filter((scene) => scene.motionStatus === "queued");
  for (const scene of unassigned) {
    const remaining = motionKeys.filter((key) => !(scene.failedKeyIndexes || []).includes(key.index));
    const anyFree = remaining.some((key) => !busyKeys.has(key.index));
    if (!remaining.length && process.env.FAL_KEY) {
      scene.motionProvider = "fal";
    } else if (!remaining.length && !process.env.FAL_KEY) {
      scene.motionStatus = "failed";
      scene.error = scene.error || "All Agnes motion keys failed and FAL_KEY is not configured";
    } else if (!anyFree && remaining.length) {
      // Stay queued; the next tick will claim the key as soon as a running scene completes.
    }
  }

  const failed = job.scenes.find((scene) => scene.motionStatus === "failed");
  if (failed) {
    const stillActive = job.scenes.some((scene) =>
      scene.motionStatus === "running" || scene.motionStatus === "submitting"
    );
    job.lastError = "Motion generation failed at scene " + failed.n + ": " + (failed.error || "provider failed");
    if (stillActive) {
      job.status = "running";
      job.stage = "motion";
      return;
    }
    job.status = "failed";
    job.stage = "failed";
    job.error = job.lastError;
    await db.execute({ sql: "UPDATE scenes SET status = 'failed', error = ? WHERE id = ?", args: [job.error, failed.sceneId] });
    return;
  }

  const done = job.scenes.filter((scene) => scene.motionStatus === "done").length;
  job.progress = 40 + Math.floor((done / job.sceneCount) * 55);
  if (done === job.sceneCount) {
    await db.execute({ sql: "UPDATE stories SET status = 'scenes_done' WHERE id = ?", args: [job.storyId] });
    job.status = "ready_for_assembly";
    job.stage = "ready_for_assembly";
    job.progress = 95;
    job.lastError = null;
  }
}

export async function tickJob(jobId) {
  const lockToken = randomUUID();
  if (!(await acquireJobLock(jobId, lockToken, 90))) return getJob(jobId);
  try {
    const job = await getJob(jobId);
    if (!job) throw new Error("Job not found: " + jobId);
    if (["completed", "ready_for_assembly", "failed"].includes(job.status)) return job;
    if (job.nextRunAt && job.nextRunAt > Date.now()) return job;

    try {
      if (job.stage === "story") {
        await generateStory(job);
      } else if (job.stage === "images") {
        await generateNextImage(job);
      } else if (job.stage === "motion") {
        await advanceMotion(job);
      }
    } catch (error) {
      job.lastError = String(error.message || error).slice(0, 400);
      if (transient(error)) {
        job.transientAttempts = (job.transientAttempts || 0) + 1;
        job.nextRunAt = Date.now() + backoff(job.transientAttempts, 6000);
        if (job.transientAttempts > MAX_ATTEMPTS + 4 && job.stage === "story") {
          job.status = "failed";
          job.stage = "failed";
          job.error = job.lastError;
        }
      } else {
        job.status = "failed";
        job.stage = "failed";
        job.error = job.lastError;
      }
    }
    return await saveJob(job);
  } finally {
    await releaseJobLock(jobId, lockToken).catch(() => {});
  }
}

export async function processJobUntilReady(jobId, options) {
  const opts = options || {};
  const maxMinutes = Number(opts.maxMinutes || 180);
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  let job = await getJob(jobId);
  while (job && !["ready_for_assembly", "completed", "failed"].includes(job.status) && Date.now() < deadline) {
    job = await tickJob(jobId);
    if (job && !["ready_for_assembly", "completed", "failed"].includes(job.status)) {
      const delay = job.nextRunAt ? Math.max(1000, Math.min(10000, job.nextRunAt - Date.now())) : 5000;
      await sleep(delay);
    }
  }
  if (job && !["ready_for_assembly", "completed", "failed"].includes(job.status)) {
    throw new Error("Job timed out before all scene clips were generated: " + jobId);
  }
  if (job?.status === "failed") throw new Error(job.error || "Job failed");
  return job;
}
