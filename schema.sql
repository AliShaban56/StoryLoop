-- مفاتيح الـ API (مشفّرة) مع حالة كل مفتاح
CREATE TABLE IF NOT EXISTS api_keys (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider       TEXT NOT NULL,                 -- agnes | ...
  label          TEXT,
  key_enc        TEXT NOT NULL UNIQUE,          -- AES-256-GCM
  status         TEXT NOT NULL DEFAULT 'active',-- active | cooling | disabled
  cooldown_until INTEGER,                       -- unix seconds
  uses           INTEGER NOT NULL DEFAULT 0,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

-- القصص (قصتين يومياً)
CREATE TABLE IF NOT EXISTS stories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL,                     -- YYYY-MM-DD (Cairo)
  slot       INTEGER NOT NULL,                  -- 1..N
  title      TEXT,
  character_sheet TEXT,                         -- وصف ثابت للشخصيات لتوحيد الستايل
  status     TEXT NOT NULL DEFAULT 'pending',   -- pending | scenes_done | audio_done | assembled | published | failed
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(day, slot)
);

-- المشاهد
CREATE TABLE IF NOT EXISTS scenes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id      INTEGER NOT NULL REFERENCES stories(id),
  idx           INTEGER NOT NULL,
  narration     TEXT NOT NULL,                  -- التعليق الصوتي (عربي)
  image_prompt  TEXT NOT NULL,                  -- English
  motion_prompt TEXT NOT NULL,                  -- English
  status        TEXT NOT NULL DEFAULT 'pending',-- pending | image_done | clip_done | failed
  image_asset_id INTEGER,
  clip_asset_id  INTEGER,
  audio_asset_id INTEGER,
  error         TEXT,
  UNIQUE(story_id, idx)
);

-- المكتبة: كل صورة/مقطع/صوت/فيديو نهائي
CREATE TABLE IF NOT EXISTS assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,                     -- image | clip | audio | final
  prompt     TEXT,
  tags       TEXT,
  source_url TEXT,                              -- رابط المزود (ممكن ينتهي)
  storage_url TEXT,                             -- الرابط الدائم (R2) - المرحلة القادمة
  local_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS publish_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id   INTEGER NOT NULL REFERENCES stories(id),
  platform   TEXT NOT NULL,                     -- youtube | tiktok
  status     TEXT NOT NULL,
  url        TEXT,
  error      TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
