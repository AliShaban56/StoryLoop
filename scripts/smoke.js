import { getStoryImageKey, getMotionKeys } from "../lib/envKeys.js";
import * as agnes from "../lib/agnes.js";

const textKey = getStoryImageKey();
const motionKey = getMotionKeys()[0];
if (!process.env.FOX_REFERENCE_IMAGE_URL) {
  throw new Error("Set FOX_REFERENCE_IMAGE_URL before running the media smoke test");
}
if (!motionKey) {
  throw new Error("Set AGNES_API_KEY_2 before running the video smoke test");
}

const reply = await agnes.chat(textKey, [{ role: "user", content: "Reply with one word: ready" }]);
console.log("TEXT:", String(reply).slice(0, 100));

const image = await agnes.image(textKey,
  "A small friendly orange fox, keep the same identity as the supplied reference, cinematic 3D children animation, portrait 9:16",
  { referenceImageUrl: process.env.FOX_REFERENCE_IMAGE_URL });
if (!image.url) throw new Error("Image generation did not return a URL");
console.log("IMAGE URL:", image.url);

const created = await agnes.createVideo(motionKey,
  "The fox slowly turns its head and smiles; subtle natural camera push-in",
  image.url);
console.log("VIDEO ID:", created.videoId);
console.log("VIDEO MODEL:", created.model);
console.log("Smoke test passed. Video generation continues asynchronously.");
