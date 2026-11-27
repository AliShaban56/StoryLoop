import crypto from "node:crypto";

const MAX_KEYS = 100;
let schemaPromise;

function encryptionKey() {
  const secret = process.env.KEYS_ENCRYPTION_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.ADMIN_PASSWORD ||
    process.env.TURSO_AUTH_TOKEN;
  if (!secret || secret.length < 12) {
    throw new Error("Set a stable KEYS_ENCRYPTION_SECRET or ENCRYPTION_KEY before saving provider keys");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

async function getDatabase() {
  const { db } = await import("./db.js");
  if (!schemaPromise) {
    schemaPromise = db.execute(`
      CREATE TABLE IF NOT EXISTS provider_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        key_index INTEGER NOT NULL,
        encrypted_secret TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(provider, key_index)
      )
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
  return db;
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  });
}

function decryptSecret(value) {
  const payload = JSON.parse(value);
  if (payload.v !== 1) throw new Error("Unsupported encrypted provider key version");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value) {
  if (!value) return "غير مضبوط";
  if (value.length <= 8) return "••••";
  return value.slice(0, 3) + "…" + value.slice(-4);
}

export async function getAgnesKeys() {
  const db = await getDatabase();
  const stored = await db.execute({
    sql: "SELECT key_index, encrypted_secret FROM provider_keys WHERE provider = 'agnes' ORDER BY key_index",
    args: [],
  });
  const byIndex = new Map();

  // Environment keys remain as a migration-compatible fallback. Saved dashboard keys take priority.
  for (let index = 1; index <= MAX_KEYS; index += 1) {
    const value = process.env["AGNES_API_KEY_" + index];
    if (typeof value === "string" && value.trim()) {
      byIndex.set(index, { index, key: value.trim(), source: "environment" });
    }
  }

  for (const row of stored.rows) {
    const index = Number(row.key_index);
    byIndex.set(index, {
      index,
      key: decryptSecret(String(row.encrypted_secret)),
      source: "database",
    });
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

export async function getStoryImageKey() {
  const first = (await getAgnesKeys()).find((item) => item.index === 1);
  if (!first) throw new Error("Add Agnes key number 1 in the StoryLoop key manager");
  return first.key;
}

export async function getMotionKeys() {
  return (await getAgnesKeys()).filter((item) => item.index !== 1);
}

export async function getKeySummary() {
  return (await getAgnesKeys()).map((item) => ({
    index: item.index,
    role: item.index === 1 ? "story-images" : "motion",
    source: item.source,
    masked: maskSecret(item.key),
  }));
}

export async function saveAgnesKey(index, value) {
  const keyIndex = Number(index);
  const secret = String(value || "").trim();
  if (!Number.isInteger(keyIndex) || keyIndex < 1 || keyIndex > MAX_KEYS) {
    throw new Error("Key slot must be a number between 1 and " + MAX_KEYS);
  }
  if (secret.length < 8 || secret.length > 4096) {
    throw new Error("The Agnes API key value looks invalid");
  }
  const db = await getDatabase();
  const encrypted = encryptSecret(secret);
  await db.execute({
    sql: "INSERT INTO provider_keys (provider, key_index, encrypted_secret, updated_at) VALUES ('agnes', ?, ?, unixepoch()) ON CONFLICT(provider, key_index) DO UPDATE SET encrypted_secret = excluded.encrypted_secret, updated_at = unixepoch()",
    args: [keyIndex, encrypted],
  });
  return { index: keyIndex, masked: maskSecret(secret), source: "database" };
}

export async function deleteAgnesKey(index) {
  const keyIndex = Number(index);
  if (!Number.isInteger(keyIndex) || keyIndex < 1 || keyIndex > MAX_KEYS) {
    throw new Error("Key slot must be a number between 1 and " + MAX_KEYS);
  }
  const db = await getDatabase();
  await db.execute({
    sql: "DELETE FROM provider_keys WHERE provider = 'agnes' AND key_index = ?",
    args: [keyIndex],
  });
  return { index: keyIndex };
}
