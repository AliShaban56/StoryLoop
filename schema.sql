-- Stories, scene assets and publishing metadata. API keys are intentionally NOT stored here.
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  slot INTEGER NOT NULL,
  title TEXT,
  character_sheet TEXT,
  style TEXT,
  characters_json TEXT,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(day, slot)
);

CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL REFERENCES stories(id),
  idx INTEGER NOT NULL,
  narration TEXT NOT NULL,
  image_prompt TEXT NOT NULL,
  motion_prompt TEXT NOT NULL,
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  image_asset_id INTEGER,
  clip_asset_id INTEGER,
  audio_asset_id INTEGER,
  error TEXT,
  UNIQUE(story_id, idx)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  prompt TEXT,
  tags TEXT,
  source_url TEXT,
  storage_url TEXT,
  local_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS publish_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id INTEGER NOT NULL REFERENCES stories(id),
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_scenes_story_status ON scenes(story_id, status);
CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);


-- Provider API keys are encrypted with AES-256-GCM before they are stored.
CREATE TABLE IF NOT EXISTS provider_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  key_index INTEGER NOT NULL,
  encrypted_secret TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(provider, key_index)
);
