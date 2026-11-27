import { createStoryJob, processJobUntilReady } from "../lib/pipeline.js";

const count = Math.max(1, Number(process.env.VIDEOS_PER_DAY || 2));
const themes = [
  "قصة دافئة عن الثعلب الذي يتعلم الصدق والشجاعة",
  "مغامرة للثعلب عن التعاون ومساعدة الأصدقاء",
  "حكاية مشوقة عن الثعلب وقيمة الوفاء",
];

for (let index = 0; index < count; index += 1) {
  const job = await createStoryJob({ theme: themes[index % themes.length] });
  console.log("[daily] started job " + job.id + " (" + (index + 1) + "/" + count + ")");
  const result = await processJobUntilReady(job.id, { maxMinutes: 175 });
  console.log("[daily] job " + result.id + " ready for ordered assembly");
}
