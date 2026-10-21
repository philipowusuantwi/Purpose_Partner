import crypto from 'node:crypto';
import { secret } from '../auth.js';

// AES-256-GCM encryption for sensitive fields at rest (phone numbers, Ghana Card numbers and
// images, reference contact details). The key is derived from PP_SECRET.
const key = () => crypto.createHash('sha256').update(`purpose-partner-field-key:${secret()}`).digest();

export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload) {
  const [iv, tag, ct] = payload.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** Keyed hash for lookups on sensitive values (duplicate phone or Ghana Card detection). */
export const blindIndex = (s) => crypto.createHmac('sha256', `purpose-partner-index:${secret()}`).update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const otpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
