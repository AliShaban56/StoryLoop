import fs from 'node:fs/promises';
import path from 'node:path';
import { isAuthed, unauthorized } from '../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// كل "لمبة": state = ok | error | idle ، و detail نص قصير
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const lamps = [];

  const ek = process.env.ENCRYPTION_KEY;
  lamps.push({
    id: 'encryption',
    label: 'مفتاح التشفير',
    state: ek && ek.length === 64 ? 'ok' : 'error',
    detail: ek && ek.length === 64 ? 'جاهز' : 'ENCRYPTION_KEY لازم يكون 64 حرف hex',
  });

  let dbOk = false;
  try {
    const { db } = await import('../../../lib/db.js');
    await db.execute('SELECT 1');
    // تجهيز الجداول تلقائياً (آمن: IF NOT EXISTS)
    const sql = await fs.readFile(path.join(process.cwd(), 'schema.sql'), 'utf8');
    await db.executeMultiple(sql);
    dbOk = true;
    lamps.push({ id: 'turso', label: 'قاعدة البيانات (Turso)', state: 'ok', detail: 'متصلة والجداول جاهزة' });
  } catch (e) {
    lamps.push({ id: 'turso', label: 'قاعدة البيانات (Turso)', state: 'error', detail: String(e.message).slice(0, 140) });
  }

  if (dbOk) {
    const { db } = await import('../../../lib/db.js');
    const r = await db.execute("SELECT status, COUNT(*) c FROM api_keys WHERE provider='agnes' GROUP BY status");
    const n = Object.fromEntries(r.rows.map((x) => [x.status, Number(x.c)]));
    const active = n.active || 0;
    const total = Object.values(n).reduce((a, b) => a + b, 0);
    lamps.push({
      id: 'agnes_keys',
      label: 'مفاتيح Agnes',
      state: active > 0 ? 'ok' : total > 0 ? 'error' : 'idle',
      detail: total ? `${active} شغّال / ${n.cooling || 0} مستني / ${n.disabled || 0} موقوف` : 'مفيش مفاتيح، أضف من تحت',
    });
  }

  lamps.push({ id: 'storage', label: 'التخزين (R2)', state: 'idle', detail: 'لسه مش مربوط' });
  lamps.push({ id: 'metricool', label: 'النشر (Metricool)', state: 'idle', detail: 'لسه مش مربوط' });
  return Response.json({ lamps });
}
