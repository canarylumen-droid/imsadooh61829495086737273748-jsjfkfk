import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getPdfBuffer, storePdfBuffer, deletePdfBuffer } from "../redis/brand-pdf-storage.js";

interface StorageConfig {
  bucketName?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string; // For R2 or other S3-compatible providers
}

class BlobStorage {
  private s3Client: S3Client | null = null;
  private bucketName: string | null = null;

  constructor() {
    const config: StorageConfig = {
      bucketName: process.env.S3_BUCKET_NAME,
      region: process.env.S3_REGION || 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      endpoint: process.env.S3_ENDPOINT,
    };

    if (config.bucketName && config.accessKeyId && config.secretAccessKey) {
      this.bucketName = config.bucketName;
      this.s3Client = new S3Client({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId!,
          secretAccessKey: config.secretAccessKey!,
        },
        endpoint: config.endpoint,
        forcePathStyle: !!config.endpoint, // Often required for R2/Custom S3
      });
      console.log(`[BlobStorage] ☁️ S3 storage initialized (Bucket: ${this.bucketName})`);
    } else {
      console.log("[BlobStorage] ⚡ Using Redis as primary blob storage (S3 not configured)");
    }
  }

  /**
   * Store a buffer (e.g., PDF) in the best available storage
   */
  async store(key: string, buffer: Buffer, contentType: string = "application/pdf"): Promise<string> {
    if (this.s3Client && this.bucketName) {
      try {
        await this.s3Client.send(new PutObjectCommand({
          Bucket: this.bucketName,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }));
        console.log(`[BlobStorage] ✅ Stored ${key} in S3`);
        return `s3://${this.bucketName}/${key}`;
      } catch (err) {
        console.error(`[BlobStorage] S3 store failed for ${key}, falling back to Redis:`, err);
      }
    }

    // Fallback to Redis (using existing logic)
    const redisKey = await storePdfBuffer(key.split(':')[0] || 'unknown', buffer);
    return redisKey || key;
  }

  /**
   * Retrieve a buffer from storage
   */
  async get(key: string): Promise<Buffer | null> {
    // If it's an S3 URI or we have S3 configured
    if (key.startsWith('s3://') || (this.s3Client && this.bucketName)) {
      const s3Key = key.startsWith('s3://') ? key.split('/').slice(3).join('/') : key;
      try {
        const response = await this.s3Client!.send(new GetObjectCommand({
          Bucket: this.bucketName!,
          Key: s3Key,
        }));

        if (!response.Body) return null;
        const bytes = await response.Body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (err) {
        if (!key.startsWith('s3://')) {
          console.warn(`[BlobStorage] S3 get failed for ${key}, trying Redis fallback`);
        } else {
          console.error(`[BlobStorage] S3 get failed for ${key}:`, err);
          return null;
        }
      }
    }

    // Default to Redis retrieval
    const userId = key.includes(':') ? key.split(':')[0] : key;
    return await getPdfBuffer(userId);
  }

  /**
   * Delete a buffer from storage
   */
  async delete(key: string): Promise<void> {
    if (this.s3Client && this.bucketName) {
      const s3Key = key.startsWith('s3://') ? key.split('/').slice(3).join('/') : key;
      try {
        await this.s3Client.send(new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
        }));
        console.log(`[BlobStorage] 🗑️ Deleted ${s3Key} from S3`);
      } catch (err) {
        console.error(`[BlobStorage] S3 delete failed for ${key}:`, err);
      }
    }

    const userId = key.includes(':') ? key.split(':')[0] : key;
    await deletePdfBuffer(userId);
  }
}

export const blobStorage = new BlobStorage();
