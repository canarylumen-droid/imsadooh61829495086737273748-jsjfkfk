import { getRedisClient } from '@shared/lib/redis/redis.js';

const PDF_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const REDIS_KEY_PREFIX = 'brand-pdf:';

/**
 * Store a PDF buffer in Redis.
 * Returns the Redis key to save in PostgreSQL.
 */
export async function storePdfBuffer(userId: string, buffer: Buffer): Promise<string | null> {
  const client = await getRedisClient();
  if (!client) {
    console.warn('[BrandPdfStorage] Redis unavailable, skipping binary storage');
    return null;
  }

  const key = `${REDIS_KEY_PREFIX}${userId}`;
  try {
    // Store as base64 string (Redis supports string values, not raw binary)
    await client.setEx(key, PDF_TTL_SECONDS, buffer.toString('base64'));
    console.log(`[BrandPdfStorage] ✅ PDF stored in Redis for user ${userId} (${(buffer.length / 1024).toFixed(1)} KB)`);
    return key;
  } catch (err) {
    console.error('[BrandPdfStorage] Failed to store PDF in Redis:', err);
    return null;
  }
}

/**
 * Retrieve a PDF buffer from Redis.
 * Returns null if not found or Redis is unavailable.
 */
export async function getPdfBuffer(userId: string): Promise<Buffer | null> {
  const client = await getRedisClient();
  if (!client) return null;

  const key = `${REDIS_KEY_PREFIX}${userId}`;
  try {
    const data = await client.get(key);
    if (!data) return null;
    return Buffer.from(data, 'base64');
  } catch (err) {
    console.error('[BrandPdfStorage] Failed to retrieve PDF from Redis:', err);
    return null;
  }
}

/**
 * Delete a user's stored PDF from Redis (e.g., on account delete or re-upload).
 */
export async function deletePdfBuffer(userId: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(`${REDIS_KEY_PREFIX}${userId}`);
    console.log(`[BrandPdfStorage] 🗑️ PDF deleted from Redis for user ${userId}`);
  } catch (err) {
    console.error('[BrandPdfStorage] Failed to delete PDF from Redis:', err);
  }
}

/**
 * Refresh the TTL on a stored PDF (called when user re-uses the cached version).
 */
export async function refreshPdfTtl(userId: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.expire(`${REDIS_KEY_PREFIX}${userId}`, PDF_TTL_SECONDS);
  } catch (err) {
    // Non-critical
  }
}

