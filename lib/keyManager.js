import { getAgnesKeys } from "./envKeys.js";
import { isTransientProviderError } from "./agnes.js";

export class NoKeysError extends Error {}

export async function withKey(provider, fn, options) {
  if (provider !== "agnes") throw new NoKeysError("Unsupported provider: " + provider);
  const opts = options || {};
  const keys = (await getAgnesKeys()).filter((item) => !(opts.excludeIndexes || []).includes(item.index));
  const ordered = opts.preferredIndex
    ? keys.slice().sort((a, b) => (a.index === opts.preferredIndex ? -1 : b.index === opts.preferredIndex ? 1 : a.index - b.index))
    : keys;
  if (!ordered.length) throw new NoKeysError("No Agnes keys configured in StoryLoop");
  let lastError;
  for (const item of ordered.slice(0, opts.maxAttempts || ordered.length)) {
    try {
      return await fn(item.key, item.index);
    } catch (error) {
      lastError = error;
      if (isTransientProviderError(error)) throw error;
      if (error.status !== 401 && error.status !== 403 && error.status !== 429) throw error;
    }
  }
  throw lastError || new NoKeysError("No usable Agnes key");
}
