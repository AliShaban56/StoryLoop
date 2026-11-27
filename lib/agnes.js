const BASE = (process.env.AGNES_API_BASE || "https://apihub.agnes-ai.com").replace(/\/+$/, "");

export function isTransientProviderError(error) {
  const status = Number(error && error.status);
  const message = String(error && error.message || "").toLowerCase();
  return status === 408 || status === 429 || status >= 500 ||
    message.includes("get_channel_failed") ||
    message.includes("upstream") ||
    message.includes("temporarily unavailable");
}

export async function request(path, options) {
  const opts = options || {};
  const response = await fetch(BASE + path, {
    method: opts.method || "GET",
    headers: {
      Authorization: "Bearer " + opts.key,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!response.ok) {
    const error = new Error("Agnes " + response.status + ": " + text.slice(0, 500));
    error.status = response.status;
    error.code = json.code || json.error?.code;
    throw error;
  }
  return json;
}

export async function chat(key, messages, model) {
  const data = await request("/v1/chat/completions", {
    method: "POST",
    key,
    body: {
      model: model || process.env.AGNES_TEXT_MODEL || "agnes-2.5-flash",
      messages,
      temperature: 0.8,
    },
  });
  return data.choices?.[0]?.message?.content || "";
}

export async function image(key, prompt, options) {
  const opts = options || {};
  const extraBody = { response_format: "url" };
  if (opts.referenceImageUrl) extraBody.image = [opts.referenceImageUrl];
  const data = await request("/v1/images/generations", {
    method: "POST",
    key,
    body: {
      model: process.env.AGNES_IMAGE_MODEL || "agnes-image-2.5-flash",
      prompt,
      size: opts.size || process.env.AGNES_IMAGE_SIZE || "1K",
      ratio: "9:16",
      extra_body: extraBody,
    },
  });
  const item = data.data?.[0];
  if (item?.url) return { url: item.url, raw: data };
  if (item?.b64_json) return { b64: item.b64_json, raw: data };
  const error = new Error("Agnes image response has no image URL or base64 output");
  error.status = 422;
  throw error;
}

function extractVideoId(data) {
  return data.video_id || data.videoId || data.id || data.data?.video_id || data.data?.videoId;
}

export async function createVideo(key, prompt, imageUrl) {
  const model = process.env.AGNES_VIDEO_MODEL || "agnes-video-2.5-flash";
  const data = await request("/v1/videos", {
    method: "POST",
    key,
    body: {
      model,
      mode: "keyframe",
      first_frame: imageUrl,
      prompt,
      seconds: "5",
      size: process.env.AGNES_VIDEO_SIZE || "720P",
      aspect_ratio: "9:16",
    },
  });
  const videoId = extractVideoId(data);
  if (!videoId) {
    const error = new Error("Agnes video create response did not include video_id");
    error.status = 422;
    throw error;
  }
  return { videoId, model, raw: data };
}

export async function pollVideo(key, videoId, model) {
  const query = "?video_id=" + encodeURIComponent(videoId) + "&model_name=" + encodeURIComponent(model);
  const data = await request("/agnesapi" + query, { key });
  const state = String(data.status || data.state || data.data?.status || "").toLowerCase();
  const url = data.url || data.video_url || data.videoUrl || data.metadata?.url ||
    data.data?.url || data.data?.video_url;
  if (["failed", "error", "cancelled", "canceled"].includes(state)) {
    const error = new Error("Agnes video task failed: " + JSON.stringify(data).slice(0, 300));
    error.permanent = true;
    throw error;
  }
  if (["completed", "succeeded", "success", "done", "finished"].includes(state) || (url && !state)) {
    if (!url) throw new Error("Agnes marked task completed without a video URL");
    return { done: true, url, raw: data };
  }
  return { done: false, state: state || "in_progress" };
}
