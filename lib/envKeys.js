const MAX_KEYS = 100;

export function getAgnesKeys() {
  const keys = [];
  for (let index = 1; index <= MAX_KEYS; index += 1) {
    const value = process.env["AGNES_API_KEY_" + index];
    if (typeof value === "string" && value.trim()) {
      keys.push({ index, key: value.trim() });
    }
  }
  return keys;
}

export function getStoryImageKey() {
  const first = getAgnesKeys().find((item) => item.index === 1);
  if (!first) throw new Error("AGNES_API_KEY_1 is required for story and image generation");
  return first.key;
}

export function getMotionKeys() {
  return getAgnesKeys().filter((item) => item.index !== 1);
}

export function maskSecret(value) {
  if (!value) return "غير مضبوط";
  if (value.length <= 8) return "••••";
  return value.slice(0, 3) + "…" + value.slice(-4);
}

export function getKeySummary() {
  return getAgnesKeys().map((item) => ({
    index: item.index,
    role: item.index === 1 ? "story-images" : "motion",
    masked: maskSecret(item.key),
  }));
}
