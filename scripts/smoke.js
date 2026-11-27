// اختبار سريع: صورة واحدة + مقطع واحد، ويطبع الـ raw response
// عشان نتأكد من أسماء الحقول قبل التشغيل اليومي.
import { withKey } from '../lib/keyManager.js';
import * as agnes from '../lib/agnes.js';

const img = await withKey('agnes', (k) =>
  agnes.image(k, 'A cute small fox in a magical forest, soft 3D children illustration, vertical composition'),
);
console.log('IMAGE RAW:', JSON.stringify(img.raw, null, 2).slice(0, 800));

const ref = img.url || `data:image/png;base64,${img.b64}`;
const vid = await withKey('agnes', (k) => agnes.video(k, 'The fox slowly turns its head and smiles, gentle camera push-in', ref));
console.log('VIDEO RAW:', JSON.stringify(vid.raw, null, 2).slice(0, 800));
console.log('VIDEO URL:', vid.url);
