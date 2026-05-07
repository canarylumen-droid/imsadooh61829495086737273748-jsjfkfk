import { Worker, Job } from 'bullmq';
import { bullmqRedisConnection } from '@shared/lib/redis.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { embed } from '../src/ai-lib/core/ai-service.js';

/**
 * RAG WORKER
 * 
 * Processes semantic search requests from the ragQueue.
 * Converts queries to embeddings and performs vector similarity search in PostgreSQL.
 */
export class RagWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker('ragQueue', this.processJob.bind(this), {
      connection: bullmqRedisConnection,
      concurrency: 10, // RAG searches are relatively fast
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 }
    });

    this.worker.on('completed', (job) => {
      console.log(`[RagWorker] ✅ Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`[RagWorker] ❌ Job ${job?.id} failed:`, err);
    });

    console.log('[RagWorker] 🚀 RAG Worker initialized and listening on ragQueue');
  }

  /**
   * Process search jobs
   */
  private async processJob(job: Job) {
    const { action, query, userId, topK = 5 } = job.data;

    if (action === 'search') {
      if (!query || !userId) {
        console.warn('[RagWorker] Missing query or userId in search job');
        return [];
      }

      console.log(`[RagWorker] 🔍 Processing search for user ${userId}: "${query.substring(0, 50)}..."`);
      
      try {
        // 1. Generate embedding for the search query
        const queryVector = await embed(query);
        
        // 2. Perform vector similarity search in Neon/Postgres
        // We cast the text column to vector for the comparison
        // Formula: 1 - (A <=> B) converts cosine distance to cosine similarity
        const vectorJson = JSON.stringify(queryVector);
        
        const results = await db.execute(sql`
          SELECT 
            snippet as content,
            source as "fileName",
            version,
            1 - (embedding::vector <=> ${vectorJson}::vector) as similarity
          FROM brand_embeddings
          WHERE user_id = ${userId}
            AND embedding IS NOT NULL
            AND embedding != ''
          ORDER BY embedding::vector <=> ${vectorJson}::vector
          LIMIT ${topK}
        `);

        const formattedResults = results.rows.map((row: any) => ({
          content: row.content,
          similarity: Number(row.similarity || 0),
          fileName: row.fileName || 'unknown',
          version: Number(row.version || 1)
        }));

        console.log(`[RagWorker] Found ${formattedResults.length} relevant chunks for query`);
        return formattedResults;
      } catch (err: any) {
        console.error('[RagWorker] Database vector search failed:', err.message);
        
        // Fallback: If vector search fails (e.g. extension not loaded), do a basic ILIKE search
        try {
          const fallbackResults = await db.execute(sql`
            SELECT 
              snippet as content,
              source as "fileName",
              version,
              0.5 as similarity
            FROM brand_embeddings
            WHERE user_id = ${userId}
              AND snippet ILIKE ${'%' + query.split(' ')[0] + '%'}
            LIMIT ${topK}
          `);
          
          return fallbackResults.rows.map((row: any) => ({
            content: row.content,
            similarity: 0.5,
            fileName: row.fileName,
            version: row.version
          }));
        } catch (fallbackErr) {
          console.error('[RagWorker] Fallback search failed too');
          return [];
        }
      }
    }

    return [];
  }

  /**
   * Graceful shutdown
   */
  async stop() {
    console.log('[RagWorker] Stopping RAG worker...');
    await this.worker.close();
  }
}

// Singleton instance
export const ragWorker = new RagWorker();
