import { ragQueue } from '@shared/lib/queue.js';
import { QueueEvents } from 'bullmq';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { createFreshConnection, hasRedis } from '@shared/lib/queues/redis-config.js';

let ragQueueEventsInstance: QueueEvents | null = null;

function getRagQueueEvents(): QueueEvents {
  if (!ragQueueEventsInstance) {
    if (!hasRedis) {
      throw new Error('❌ Redis is not configured for QueueEvents');
    }
    ragQueueEventsInstance = new QueueEvents('ragQueue', {
      connection: createFreshConnection() as any,
    });
  }
  return ragQueueEventsInstance;
}

const ragQueueEvents = new Proxy({}, {
  get(target, prop) {
    const instance = getRagQueueEvents();
    const value = Reflect.get(instance, prop);
    return typeof value === 'function' ? value.bind(instance) : value;
  }
}) as any as QueueEvents;

export async function searchSimilarChunks(
  query: string,
  userId: string,
  topK = 5
): Promise<{ content: string; similarity: number; fileName: string; version: number }[]> {
  try {
    console.log(`[VectorRPC] 🔍 Adding RAG search job for user ${userId} (TopK: ${topK})`);
    const job = await ragQueue.add('search', {
      action: 'search',
      query,
      userId,
      topK
    });

    console.log(`[VectorRPC] ⏳ Waiting for RAG job ${job.id}...`);
    const result = await job.waitUntilFinished(ragQueueEvents, 120000); // 120s timeout
    console.log(`[VectorRPC] ✅ RAG job ${job.id} completed. Found ${result?.length || 0} chunks.`);
    return result || [];
  } catch (error) {
    console.warn('[VectorRPC] ❌ Search failed or timed out via RAG worker:', error);
    return [];
  }
}

export async function userHasChunks(userId: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*) AS count FROM brand_embeddings WHERE user_id = ${userId} LIMIT 1
    `);
    return parseInt((result.rows[0] as any)?.count || '0') > 0;
  } catch {
    return false;
  }
}
