const JOB_PREFIX = "storyloop:job:";
const LOCK_PREFIX = "storyloop:lock:";
const JOB_TTL_SECONDS = 60 * 60 * 24 * 14;
let fallbackSchemaPromise;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

async function fallbackDatabase() {
  const { db } = await import("./db.js");
  if (!fallbackSchemaPromise) {
    fallbackSchemaPromise = db.executeMultiple(`
      CREATE TABLE IF NOT EXISTS storyloop_jobs (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS storyloop_locks (
        lock_name TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_storyloop_jobs_expiry ON storyloop_jobs(expires_at);
      CREATE INDEX IF NOT EXISTS idx_storyloop_locks_expiry ON storyloop_locks(expires_at);
    `).catch((error) => {
      fallbackSchemaPromise = null;
      throw error;
    });
  }
  await fallbackSchemaPromise;
  return db;
}

async function command(parts) {
  const cfg = redisConfig();
  if (!cfg) throw new Error("Redis/KV is not configured");
  const response = await fetch(cfg.url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + cfg.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parts),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error("Redis command failed: " + String(payload.error || response.status));
  }
  return payload.result;
}

export async function pingRedis() {
  if (redisConfig()) return command(["PING"]);
  const db = await fallbackDatabase();
  await db.execute("SELECT 1");
  return "TURSO_FALLBACK";
}

export async function getJob(id) {
  if (redisConfig()) {
    const raw = await command(["GET", JOB_PREFIX + id]);
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }
  const db = await fallbackDatabase();
  const result = await db.execute({
    sql: "SELECT payload FROM storyloop_jobs WHERE id = ? AND expires_at > unixepoch()",
    args: [id],
  });
  const raw = result.rows[0]?.payload;
  return raw ? JSON.parse(String(raw)) : null;
}

export async function saveJob(job) {
  job.updatedAt = Date.now();
  if (redisConfig()) {
    await command(["SET", JOB_PREFIX + job.id, JSON.stringify(job), "EX", String(JOB_TTL_SECONDS)]);
    return job;
  }
  const db = await fallbackDatabase();
  await db.execute({
    sql: "INSERT INTO storyloop_jobs (id, payload, expires_at) VALUES (?, ?, unixepoch() + ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at",
    args: [job.id, JSON.stringify(job), JOB_TTL_SECONDS],
  });
  return job;
}

export async function createJobRecord(job) {
  if (redisConfig()) {
    const result = await command([
      "SET",
      JOB_PREFIX + job.id,
      JSON.stringify(job),
      "EX",
      String(JOB_TTL_SECONDS),
      "NX",
    ]);
    if (result !== "OK") throw new Error("Could not create unique job record");
    return job;
  }
  const db = await fallbackDatabase();
  try {
    await db.execute({
      sql: "INSERT INTO storyloop_jobs (id, payload, expires_at) VALUES (?, ?, unixepoch() + ?)",
      args: [job.id, JSON.stringify(job), JOB_TTL_SECONDS],
    });
  } catch (error) {
    if (/unique|constraint/i.test(String(error.message))) throw new Error("Could not create unique job record");
    throw error;
  }
  return job;
}

async function acquireDatabaseLock(name, token, ttlSeconds) {
  const db = await fallbackDatabase();
  const result = await db.execute({
    sql: "INSERT INTO storyloop_locks (lock_name, token, expires_at) VALUES (?, ?, unixepoch() + ?) ON CONFLICT(lock_name) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at WHERE storyloop_locks.expires_at < unixepoch()",
    args: [name, token, ttlSeconds],
  });
  return Number(result.rowsAffected || 0) === 1;
}

async function releaseDatabaseLock(name, token) {
  const db = await fallbackDatabase();
  const result = await db.execute({
    sql: "DELETE FROM storyloop_locks WHERE lock_name = ? AND token = ?",
    args: [name, token],
  });
  return Number(result.rowsAffected || 0);
}

export async function acquireJobLock(id, token, ttlSeconds = 180) {
  if (redisConfig()) {
    const result = await command(["SET", LOCK_PREFIX + id, token, "NX", "EX", String(ttlSeconds)]);
    return result === "OK";
  }
  return acquireDatabaseLock(LOCK_PREFIX + id, token, ttlSeconds);
}

export async function releaseJobLock(id, token) {
  if (redisConfig()) {
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    return command(["EVAL", script, "1", LOCK_PREFIX + id, token]);
  }
  return releaseDatabaseLock(LOCK_PREFIX + id, token);
}

const MOTION_KEY_PREFIX = "storyloop:motion-key:";

export async function acquireMotionKeyLease(index, token, ttlSeconds = 7200) {
  if (redisConfig()) {
    const result = await command(["SET", MOTION_KEY_PREFIX + String(index), token, "NX", "EX", String(ttlSeconds)]);
    return result === "OK";
  }
  return acquireDatabaseLock(MOTION_KEY_PREFIX + String(index), token, ttlSeconds);
}

export async function renewMotionKeyLease(index, token, ttlSeconds = 7200) {
  if (redisConfig()) {
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end";
    const result = await command(["EVAL", script, "1", MOTION_KEY_PREFIX + String(index), token, String(ttlSeconds)]);
    return Number(result) === 1;
  }
  const db = await fallbackDatabase();
  const result = await db.execute({
    sql: "UPDATE storyloop_locks SET expires_at = unixepoch() + ? WHERE lock_name = ? AND token = ? AND expires_at > unixepoch()",
    args: [ttlSeconds, MOTION_KEY_PREFIX + String(index), token],
  });
  return Number(result.rowsAffected || 0) === 1;
}

export async function releaseMotionKeyLease(index, token) {
  if (redisConfig()) {
    const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    return command(["EVAL", script, "1", MOTION_KEY_PREFIX + String(index), token]);
  }
  return releaseDatabaseLock(MOTION_KEY_PREFIX + String(index), token);
}
