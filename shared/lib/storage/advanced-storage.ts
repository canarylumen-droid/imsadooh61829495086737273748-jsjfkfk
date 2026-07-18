import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getRedisClient } from '@shared/lib/redis/redis.js';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * AdvancedStorageService
 *
 * A unified file storage layer that cascades across:
 *   1. AWS S3 (or any S3-compatible API like Cloudflare R2) — primary
 *   2. Redis   — high-speed fallback/buffer using the existing redis client
 *   3. Local filesystem — last resort for development and degraded environments
 *
 * Required env vars for S3:
 *   S3_BUCKET_NAME, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 * Optional:
 *   S3_REGION (default us-east-1), S3_ENDPOINT (for R2 or MinIO)
 *
 * Redis TTL for buffered files: 30 days
 */

const REDIS_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const REDIS_KEY_PREFIX = 'file-buffer:';
const LOCAL_DIR = path.join(process.cwd(), 'public', 'uploads');

class AdvancedStorageService {
  private s3: S3Client | null = null;
  private bucketName: string | null = null;

  constructor() {
    const bucket = process.env.S3_BUCKET_NAME;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const region = process.env.S3_REGION || 'us-east-1';
    const endpoint = process.env.S3_ENDPOINT; // e.g. https://<account>.r2.cloudflarestorage.com

    if (bucket && accessKeyId && secretAccessKey) {
      this.bucketName = bucket;
      this.s3 = new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
      console.log(`[AdvancedStorage] ☁️  S3 ready (bucket: ${bucket}, region: ${region}${endpoint ? ', custom endpoint' : ''})`);
    } else {
      if (!(global as any).__s3_warned) {
        console.log('[AdvancedStorage] S3 not configured — using Redis/local fallback.');
        (global as any).__s3_warned = true;
      }
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Store a file buffer. Returns the canonical URL/key used for later retrieval.
   *
   * Priority: S3 → Redis (buffer) → local filesystem
   *
   * @param bucket   Logical bucket / folder name (e.g. "voice-notes", "brand-pdfs")
   * @param fileName File name within the bucket (e.g. "voice_abc_1234567890.mp3")
   * @param buffer   Raw file bytes
   * @param contentType  MIME type (e.g. "audio/mpeg", "application/pdf")
   */
  async upload(
    bucket: string,
    fileName: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    const key = this.buildKey(bucket, fileName);

    // 1 — Try S3 / R2
    if (this.s3 && this.bucketName) {
      try {
        await this.s3.send(new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }));
        console.log(`[AdvancedStorage] ✅ Uploaded to S3: ${key}`);
        return `s3://${this.bucketName}/${key}`;
      } catch (err: any) {
        console.error(`[AdvancedStorage] S3 upload failed for "${key}":`, err.message);
        // fall through to Redis
      }
    }

    // 2 — Redis buffer (store raw bytes as base64)
    try {
      const client = await getRedisClient();
      if (client) {
        const redisKey = `${REDIS_KEY_PREFIX}${key}`;
        await client.setEx(redisKey, REDIS_TTL_SECONDS, buffer.toString('base64'));
        console.log(`[AdvancedStorage] ⚡ Buffered in Redis: ${redisKey}`);
        // Fall through to also write to local so it can be served statically
      }
    } catch (err: any) {
      console.warn(`[AdvancedStorage] Redis buffer failed:`, err.message);
    }

    // 3 — Local filesystem (always executed as fallback / local dev)
    return this.uploadLocal(bucket, fileName, buffer);
  }

  /**
   * Download file bytes. Tries S3 → Redis → local.
   */
  async download(key: string): Promise<Buffer | null> {
    // If the key is a full S3 URI, fetch directly
    if (key.startsWith('s3://') && this.s3 && this.bucketName) {
      const s3Key = key.replace(`s3://${this.bucketName}/`, '');
      try {
        const resp = await this.s3.send(new GetObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
        }));
        if (resp.Body) {
          const bytes = await (resp.Body as any).transformToByteArray();
          return Buffer.from(bytes);
        }
      } catch (err: any) {
        console.error(`[AdvancedStorage] S3 download failed for "${key}":`, err.message);
      }
      return null;
    }

    // Try Redis
    try {
      const client = await getRedisClient();
      if (client) {
        const redisKey = `${REDIS_KEY_PREFIX}${key}`;
        const data = await client.get(redisKey);
        if (data) return Buffer.from(data, 'base64');
      }
    } catch (_) { /* non-fatal */ }

    // Try local
    try {
      const localPath = path.join(LOCAL_DIR, key);
      return await fs.readFile(localPath);
    } catch (_) {
      return null;
    }
  }

  /**
   * Generate a pre-signed URL for direct S3 access (e.g. serving audio files).
   * Falls back to the public local URL if S3 is not configured.
   */
  async getPublicUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (key.startsWith('s3://') && this.s3 && this.bucketName) {
      const s3Key = key.replace(`s3://${this.bucketName}/`, '');
      try {
        const cmd = new GetObjectCommand({ Bucket: this.bucketName, Key: s3Key });
        return await getSignedUrl(this.s3, cmd, { expiresIn: expiresInSeconds });
      } catch (err: any) {
        console.error('[AdvancedStorage] Pre-sign failed:', err.message);
      }
    }
    // If pre-sign failed on an S3 URI, return the raw s3:// URI so the caller can fall back
    if (key.startsWith('s3://')) return key;
    // For local / Redis-buffered files, return the static serving path
    const localKey = key.replace(`s3://${this.bucketName ?? 'unknown'}/`, '');
    return `/uploads/${localKey}`;
  }

  /**
   * Delete a file from all tiers where it might exist.
   */
  async delete(key: string): Promise<void> {
    const normalKey = key.startsWith('s3://')
      ? key.replace(`s3://${this.bucketName}/`, '')
      : key;

    // S3
    if (this.s3 && this.bucketName && key.startsWith('s3://')) {
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: normalKey }));
        console.log(`[AdvancedStorage] 🗑️  Deleted from S3: ${normalKey}`);
      } catch (err: any) {
        console.warn('[AdvancedStorage] S3 delete failed:', err.message);
      }
    }

    // Redis
    try {
      const client = await getRedisClient();
      if (client) await client.del(`${REDIS_KEY_PREFIX}${normalKey}`);
    } catch (_) { /* non-fatal */ }

    // Local
    try {
      await fs.unlink(path.join(LOCAL_DIR, normalKey));
    } catch (_) { /* may not exist */ }
  }

  /**
   * Check whether a key exists in S3 without downloading it.
   */
  async exists(key: string): Promise<boolean> {
    if (!this.s3 || !this.bucketName || !key.startsWith('s3://')) return false;
    const s3Key = key.replace(`s3://${this.bucketName}/`, '');
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: s3Key }));
      return true;
    } catch (_) {
      return false;
    }
  }

  // ─── Internal Helpers ──────────────────────────────────────────────────────

  /** Build a consistent key: `<bucket>/<fileName>` with path-traversal protection */
  private buildKey(bucket: string, fileName: string): string {
    const safeBucket = path.basename(bucket);
    const safeFile = fileName.replace(/\.\./g, '').replace(/^\/+/, '');
    return `${safeBucket}/${safeFile}`;
  }

  private async uploadLocal(bucket: string, fileName: string, buffer: Buffer): Promise<string> {
    const dir = path.join(LOCAL_DIR, path.basename(bucket));
    const filePath = path.join(dir, fileName.replace(/\.\./g, '').replace(/^\/+/, ''));

    // Path traversal guard
    if (!filePath.startsWith(dir)) {
      throw new Error('[AdvancedStorage] Path traversal detected in local upload');
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    const publicUrl = `/uploads/${path.basename(bucket)}/${fileName}`;
    console.log(`[AdvancedStorage] 📁 Saved locally: ${publicUrl}`);
    return publicUrl;
  }
}

export const advancedStorage = new AdvancedStorageService();

