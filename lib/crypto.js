import crypto from 'node:crypto';

function getKey() {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex chars (generate: openssl rand -hex 32)');
  }
  return Buffer.from(k, 'hex');
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload) {
  const [iv, tag, enc] = payload.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
