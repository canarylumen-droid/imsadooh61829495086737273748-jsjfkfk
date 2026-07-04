import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getWarmupKey(): Buffer {
  const key = process.env.WARMUP_ENCRYPTION_KEY || 'default-insecure-key-change-in-production';
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptWarmupSecret(plaintext: string): string {
  const key = getWarmupKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptWarmupSecret(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext;
    const [ivHex, authTagHex, encrypted] = parts;
    const key = getWarmupKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return ciphertext;
  }
}
