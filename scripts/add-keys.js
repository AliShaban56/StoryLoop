// إضافة عدة مفاتيح مرة واحدة (مفتاح في كل سطر) لحد ما لوحة التحكم تجهز:
//   node scripts/add-keys.js agnes < keys.txt
// المفاتيح بتتشفّر قبل التخزين.
import fs from 'node:fs';
import { db } from '../lib/db.js';
import { encrypt } from '../lib/crypto.js';

const provider = process.argv[2] || 'agnes';
const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

let added = 0;
for (const [i, key] of lines.entries()) {
  try {
    await db.execute({
      sql: 'INSERT INTO api_keys (provider, label, key_enc) VALUES (?, ?, ?)',
      args: [provider, `${provider}-${Date.now()}-${i + 1}`, encrypt(key)],
    });
    added++;
  } catch (e) {
    console.warn(`skip line ${i + 1}: ${e.message}`);
  }
}
console.log(`added ${added}/${lines.length} keys for "${provider}"`);
