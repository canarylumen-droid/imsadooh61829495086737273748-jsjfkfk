import { ragQueue } from '@shared/lib/queue.js';
import { QueueEvents } from 'bullmq';
import { bullmqRedisConnection } from '@shared/lib/redis.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

const ragQueueEvents = new QueueEvents('ragQueue', { connection: bullmqRedisConnection });

export async function searchSimilarChunks(
  query: string,
  userId: string,
  topK = 5
): Promise<{ content: string; similarity: number; fileName: string; version: number }[]> {
  try {
    const job = await ragQueue.add('search', {
      action: 'search',
      query,
      userId,
      topK
    });

    const result = await job.waitUntilFinished(ragQueueEvents, 10000); // 10s timeout
    return result || [];
  } catch (error) {
    console.warn('[VectorRPC] Search failed via RAG worker:', error);
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
