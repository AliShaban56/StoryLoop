import fs from 'node:fs/promises';
import { db } from '../lib/db.js';

const sql = await fs.readFile(new URL('../schema.sql', import.meta.url), 'utf8');
await db.executeMultiple(sql);
console.log('schema applied ✓');
