# StoryLoop — asynchronous story-to-video pipeline

StoryLoop generates one JSON story, sequential reference-consistent images, parallel image-to-video scenes, then assembles the final MP4 only after every numbered scene is ready.

## Pipeline

1. AGNES_API_KEY_1 writes the story JSON and generates every scene image sequentially.
2. The JSON contains one global style, a fixed characters dictionary (including fox), and exactly SCENES_PER_VIDEO scenes numbered from 1.
3. FOX_REFERENCE_IMAGE_URL is attached as an image-to-image reference for every scene. Image URLs are persisted in Turso (scenes.image_url and assets.source_url).
4. AGNES_API_KEY_2, AGNES_API_KEY_3, ... each work on one video scene at a time. A Redis lease enforces one active scene per key across concurrent jobs; free keys are assigned in parallel, and a scene that fails with a key is retried against another key.
5. get_channel_failed, 408, 429, and 5xx errors are treated as temporary provider outages. They do not disable a key. The task is retried with exponential backoff; after repeated Agnes outages, the optional fal.ai queue adapter is used.
6. The story becomes scenes_done only when all scene clips are complete. worker/finish.js orders scenes by idx, creates narration and refuses to assemble a partial video.
7. Redis/KV stores the resumable job state and lock. Turso stores story, scene, and asset records.

## API keys and environment variables

Add, replace, test, and remove Agnes API keys directly in the StoryLoop dashboard under **ربط المفاتيح**. Key #1 handles story text and sequential scene images; keys #2 onward handle parallel scene animation. Secrets are encrypted with AES-256-GCM before being written to the Turso `provider_keys` table. API responses expose only the key slot and a masked hint; raw secrets are never sent back to the browser. Redis stores job state and leases, not provider secrets.

Set a stable `KEYS_ENCRYPTION_SECRET` (recommended) or `ENCRYPTION_KEY` in Vercel before saving keys. If neither exists, the stable `TURSO_AUTH_TOKEN` is used as a fallback. Keep the selected value unchanged: rotating it without re-encrypting stored rows makes previously saved keys unreadable. A dedicated strong encryption secret is recommended.
- FOX_REFERENCE_IMAGE_URL: public HTTPS URL of the canonical fox reference image.
- KV_REST_API_URL and KV_REST_API_TOKEN: Upstash Redis REST or Vercel KV REST credentials.
- FAL_KEY: optional fallback provider key.
- FAL_I2V_MODEL: optional fal model path; default fal-ai/kling-video/v3/standard/image-to-video.
- TURSO_DATABASE_URL, TURSO_AUTH_TOKEN: story and asset database.
- ADMIN_PASSWORD: dashboard password (and legacy encryption-key fallback).
- Optional tuning: SCENES_PER_VIDEO, VIDEOS_PER_DAY, AGNES_TRANSIENT_MAX, AGNES_MAX_ATTEMPTS_PER_SCENE, AGNES_TEXT_MODEL, AGNES_IMAGE_MODEL, AGNES_VIDEO_MODEL, AGNES_IMAGE_SIZE, AGNES_VIDEO_SIZE.

Copy .env.example to .env for local development. Set the same required variables in the Vercel project and the GitHub repository secrets. The image reference URL must be accessible by the Agnes API provider. `KEYS_ENCRYPTION_SECRET` must remain stable while encrypted provider keys are stored.

## API

- POST /api/jobs creates a new job and schedules the first tick.
- POST /api/jobs/tick accepts { "jobId": "..." }, schedules one state-machine step using after(), and immediately returns HTTP 202.
- GET /api/jobs/:id returns the persisted job state without cache.
- The dashboard polls status and schedules another tick every five seconds while the job is active.

## Database migration and legacy keys

Run:

    npm install
    npm run migrate

Provider keys from older StoryLoop versions may still exist in the legacy api_keys table. First configure the numbered environment variables, then remove those old encrypted DB rows intentionally with:

    CONFIRM_DELETE_LEGACY_DB_KEYS=YES npm run cleanup_legacy_keys

This cleanup deletes only the old api_keys rows. New code does not read or write that table.

## Run locally

    npm run dev

To run a daily batch from a worker with the same environment variables:

    npm run daily
    npm run finish

The worker requires Node.js 20+, ffmpeg, ffprobe, and edge-tts (install with pip install edge-tts).

## Provider references

Agnes current integration uses the agnes-2.5-flash, agnes-image-2.5-flash, and agnes-video-2.5-flash model family. fal.ai is an optional queue-based image-to-video fallback. Confirm provider models and billing in their dashboards before production use.
