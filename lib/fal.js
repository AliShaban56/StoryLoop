const API = "https://queue.fal.run";

function headers() {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY is not configured");
  return { Authorization: "Key " + key, "Content-Type": "application/json" };
}

function modelPath() {
  return process.env.FAL_I2V_MODEL || "fal-ai/kling-video/v3/standard/image-to-video";
}

async function readJson(response) {
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { raw: body }; }
  if (!response.ok) {
    const error = new Error("fal.ai " + response.status + ": " + body.slice(0, 300));
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function submitVideo(prompt, imageUrl) {
  const model = modelPath();
  const response = await fetch(API + "/" + model, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt,
      start_image_url: imageUrl,
      duration: "5",
      generate_audio: false,
      enable_safety_checker: true,
    }),
  });
  const data = await readJson(response);
  const requestId = data.request_id || data.requestId;
  if (!requestId) throw new Error("fal.ai response did not include request_id");
  return {
    provider: "fal",
    model,
    requestId,
    statusUrl: data.status_url || (API + "/" + model + "/requests/" + requestId + "/status"),
    responseUrl: data.response_url || (API + "/" + model + "/requests/" + requestId),
  };
}

export async function pollVideo(task) {
  const response = await fetch(task.statusUrl, { headers: headers(), cache: "no-store" });
  const status = await readJson(response);
  const state = String(status.status || status.state || "").toUpperCase();
  if (state === "FAILED" || state === "CANCELLED") {
    const error = new Error("fal.ai task failed: " + JSON.stringify(status).slice(0, 240));
    error.permanent = true;
    throw error;
  }
  if (state !== "COMPLETED" && state !== "SUCCEEDED") return { done: false, state };
  const resultResponse = await fetch(task.responseUrl, { headers: headers(), cache: "no-store" });
  const result = await readJson(resultResponse);
  const url = result.video?.url || result.video_url || result.url || result.data?.video?.url;
  if (!url) throw new Error("fal.ai completed without a video URL");
  return { done: true, url, raw: result };
}
