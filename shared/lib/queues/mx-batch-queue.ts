import { getRedisClient } from "@shared/lib/redis/redis.js";

const MX_BATCH_QUEUE = process.env.MX_BATCH_QUEUE || "mx-batch-queue";
const MX_BATCH_RESULT_QUEUE = process.env.MX_BATCH_RESULT_QUEUE || "mx-batch-results";
const MX_BATCH_TIMEOUT = parseInt(process.env.MX_BATCH_TIMEOUT || "15000", 10);

export interface MxBatchEntry {
  has_mx: boolean;
  mx_servers: string[];
  lookup_time_ms: number;
}

export interface MxBatchResult {
  batch_id: string;
  results: Record<string, MxBatchEntry>;
  error?: string;
}

export async function enqueueMxBatch(
  batchId: string,
  domains: string[]
): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) throw new Error("Redis not available");
  const job = JSON.stringify({ batch_id: batchId, domains });
  await redis.lPush(MX_BATCH_QUEUE, job);
}

export async function waitForMxBatchResult(
  batchId: string,
  timeoutMs: number = MX_BATCH_TIMEOUT
): Promise<Record<string, MxBatchEntry>> {
  const redis = await getRedisClient();
  if (!redis) throw new Error("Redis not available");

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await redis.brPop(MX_BATCH_RESULT_QUEUE, 1);
    if (result) {
      try {
        const data: MxBatchResult = JSON.parse(result[1]);
        if (data.batch_id === batchId) {
          return data.results;
        }
      } catch {
        // Invalid JSON, skip
      }
    }
  }
  throw new Error(`MX batch timeout for ${batchId} after ${timeoutMs}ms`);
}
