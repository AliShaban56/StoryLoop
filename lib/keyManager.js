import { db, now } from './db.js';
import { decrypt } from './crypto.js';
import { classify } from './classify.js';

export class NoKeysError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pickKey(provider) {
  const r = await db.execute({
    sql: `SELECT id, key_enc FROM api_keys
          WHERE provider = ? AND status != 'disabled'
            AND (cooldown_until IS NULL OR cooldown_until <= ?)
          ORDER BY uses ASC, id ASC LIMIT 1`,
    args: [provider, now()],
  });
  return r.rows[0] || null;
}

async function earliestAvailableAt(provider) {
  const r = await db.execute({
    sql: `SELECT MIN(COALESCE(cooldown_until, 0)) AS t FROM api_keys
          WHERE provider = ? AND status != 'disabled'`,
    args: [provider],
  });
  const t = r.rows[0]?.t;
  return t === null || t === undefined ? null : Number(t);
}

/**
 * ينفّذ fn(apiKey) بمفتاح متاح. لو فشل بسبب المفتاح (limit/quota/auth/شبكة)
 * يحط المفتاح في cooldown وبيكرر بمفتاح تاني تلقائياً من غير ما العملية تقف.
 * لو كل المفاتيح في cooldown بيستنى (لحد maxWaitSec) ثم يكمل.
 */
export async function withKey(provider, fn, { maxWaitSec = 900, maxAttempts = 60 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const row = await pickKey(provider);

    if (!row) {
      const t = await earliestAvailableAt(provider);
      if (t === null) throw new NoKeysError(`No usable "${provider}" keys. Add keys first.`);
      const wait = Math.max(1, t - now() + 1);
      if (wait > maxWaitSec) {
        throw new NoKeysError(`All "${provider}" keys are cooling down for ${wait}s (> ${maxWaitSec}s).`);
      }
      console.log(`[keys] all keys busy, waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }

    try {
      const result = await fn(decrypt(row.key_enc));
      await db.execute({
        sql: `UPDATE api_keys SET uses = uses + 1, status = 'active', cooldown_until = NULL, last_error = NULL WHERE id = ?`,
        args: [row.id],
      });
      return result;
    } catch (err) {
      const c = classify(err);
      if (!c) throw err; // مش ذنب المفتاح
      console.warn(`[keys] key #${row.id} -> ${c.status} (${c.reason}): ${String(err.message).slice(0, 160)}`);
      await db.execute({
        sql: `UPDATE api_keys SET status = ?, cooldown_until = ?, fail_count = fail_count + 1, last_error = ? WHERE id = ?`,
        args: [c.status, c.cooldownSec ? now() + c.cooldownSec : null, String(err.message).slice(0, 300), row.id],
      });
    }
  }
  throw new NoKeysError(`Gave up after ${maxAttempts} attempts for "${provider}".`);
}
