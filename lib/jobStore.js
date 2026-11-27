const JOB_PREFIX = "storyloop:job:";
const LOCK_PREFIX = "storyloop:lock:";
const JOB_TTL_SECONDS = 60 * 60 * 24 * 14;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN are required");
  return { url: url.replace(/\/+$/, ""), token };
}

async function command(parts) {
  const cfg = redisConfig();
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
  return command(["PING"]);
}

export async function getJob(id) {
  const raw = await command(["GET", JOB_PREFIX + id]);
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export async function saveJob(job) {
  job.updatedAt = Date.now();
  await command(["SET", JOB_PREFIX + job.id, JSON.stringify(job), "EX", String(JOB_TTL_SECONDS)]);
  return job;
}

export async function createJobRecord(job) {
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

export async function acquireJobLock(id, token, ttlSeconds = 180) {
  const result = await command(["SET", LOCK_PREFIX + id, token, "NX", "EX", String(ttlSeconds)]);
  return result === "OK";
}

export async function releaseJobLock(id, token) {
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  return command(["EVAL", script, "1", LOCK_PREFIX + id, token]);
}
