import { isAuthed, unauthorized } from '../../../lib/auth.js';
import { db } from '../../../lib/db.js';
import { encrypt, decrypt } from '../../../lib/crypto.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mask = (k) => (k.length > 8 ? `${k.slice(0, 3)}…${k.slice(-4)}` : '••••');

export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const r = await db.execute('SELECT * FROM api_keys ORDER BY id');
  return Response.json({
    keys: r.rows.map((k) => {
      let masked = '••••';
      try { masked = mask(decrypt(k.key_enc)); } catch {}
      return {
        id: k.id, provider: k.provider, masked, status: k.status, uses: k.uses,
        fail_count: k.fail_count, last_error: k.last_error, cooldown_until: k.cooldown_until,
      };
    }),
  });
}

// إضافة عدة مفاتيح: كل مفتاح في سطر
export async function POST(req) {
  if (!(await isAuthed())) return unauthorized();
  const { provider = 'agnes', keys = '' } = await req.json();
  const lines = [...new Set(String(keys).split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean))];
  let added = 0, skipped = 0;
  for (const key of lines) {
    const existing = await db.execute({ sql: 'SELECT key_enc FROM api_keys WHERE provider=?', args: [provider] });
    const dup = existing.rows.some((x) => { try { return decrypt(x.key_enc) === key; } catch { return false; } });
    if (dup) { skipped++; continue; }
    await db.execute({
      sql: 'INSERT INTO api_keys (provider, label, key_enc) VALUES (?, ?, ?)',
      args: [provider, `${provider}-${Date.now()}`, encrypt(key)],
    });
    added++;
  }
  return Response.json({ added, skipped });
}

export async function PATCH(req) {
  if (!(await isAuthed())) return unauthorized();
  const { id, action } = await req.json();
  if (action === 'enable') {
    await db.execute({ sql: "UPDATE api_keys SET status='active', cooldown_until=NULL, last_error=NULL WHERE id=?", args: [id] });
  } else if (action === 'disable') {
    await db.execute({ sql: "UPDATE api_keys SET status='disabled' WHERE id=?", args: [id] });
  } else {
    return Response.json({ error: 'bad action' }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(req) {
  if (!(await isAuthed())) return unauthorized();
  const id = new URL(req.url).searchParams.get('id');
  await db.execute({ sql: 'DELETE FROM api_keys WHERE id=?', args: [id] });
  return Response.json({ ok: true });
}
