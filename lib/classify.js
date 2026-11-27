// Provider availability failures are transient. They never mean an API key is invalid.
export function classify(error) {
  const status = Number(error && error.status);
  const message = String(error && error.message || "").toLowerCase();
  if (message.includes("get_channel_failed") || status >= 500 || status === 408 || status === 429) {
    return { kind: "transient", reason: "provider_unavailable", disableKey: false };
  }
  if (status === 401 || status === 403) {
    return { kind: "key_rejected", reason: "authentication", disableKey: false };
  }
  return null;
}
