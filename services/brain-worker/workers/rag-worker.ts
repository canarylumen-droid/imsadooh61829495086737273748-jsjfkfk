import { Worker, Job } from 'bullmq';
import { createFreshConnection } from '@shared/lib/queues/redis-config.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { embed } from '../src/ai-lib/core/ai-service.js';
import { SystemHealthService } from '@shared/lib/monitoring/system-health-service.js';

/**
 * Enterprise RAG WORKER
 * 
 * Implements HYBRID SEARCH (Vector + Keyword) for maximum brand fidelity.
 */
export class RagWorker {
  private worker: Worker;

  constructor() {
    this.worker = new Worker('ragQueue', this.processJob.bind(this), {
      connection: createFreshConnection() as any,
      concurrency: 10,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 }
    });

    console.log('[RagWorker] 🚀 Enterprise Hybrid RAG Search Online');
  }

  private async processJob(job: Job) {
    const { action, query, userId, topK = 7 } = job.data;

    if (action === 'search') {
      if (!query || !userId) return [];
      
      try {
        // 1. Generate embedding for Semantic Search
        const queryVector = await embed(query);
        const vectorJson = JSON.stringify(queryVector);

        // 2. Perform HYBRID SEARCH using optimized TSVector column
        const results = await db.execute(sql`
          WITH vector_matches AS (
            SELECT 
              id,
              snippet as content,
              source as "fileName",
              1 - (embedding::vector <=> ${vectorJson}::vector) as vector_score
            FROM brand_embeddings
            WHERE user_id = ${userId}
              AND embedding IS NOT NULL
              AND embedding != ''
            ORDER BY embedding::vector <=> ${vectorJson}::vector
            LIMIT 20
          ),
          text_matches AS (
            SELECT 
              id,
              snippet as content,
              source as "fileName",
              ts_rank(tsv, plainto_tsquery('english', ${query})) as text_score
            FROM brand_embeddings
            WHERE user_id = ${userId}
              AND tsv @@ plainto_tsquery('english', ${query})
            LIMIT 20
          )
          SELECT 
            COALESCE(v.content, t.content) as content,
            COALESCE(v."fileName", t."fileName") as "fileName",
            (COALESCE(v.vector_score, 0) * 0.7) + (COALESCE(t.text_score, 0) * 0.3) as rank_score
          FROM vector_matches v
          FULL OUTER JOIN text_matches t ON v.id = t.id
          ORDER BY rank_score DESC
          LIMIT ${topK}
        `);

        return results.rows.map((row: any) => ({
          content: row.content,
          similarity: Number(row.rank_score || 0),
          fileName: row.fileName || 'unknown'
        }));

      } catch (err: any) {
        console.error('[RagWorker] Hybrid search failed:', err.message);
        
        // Report to health service
        await SystemHealthService.log({
          userId,
          service: 'rag',
          level: 'warn',
          event: 'search_failure',
          message: err.message,
          details: { query, action: 'search' }
        }).catch(err => console.error('[RAG Worker] Failed to log search failure:', err));

        // Fallback to simple vector search
        const queryVector = await embed(query);
        const vectorJson = JSON.stringify(queryVector);
        const results = await db.execute(sql`
           SELECT snippet as content, source as "fileName", 1 - (embedding::vector <=> ${vectorJson}::vector) as similarity
           FROM brand_embeddings WHERE user_id = ${userId}
           ORDER BY embedding::vector <=> ${vectorJson}::vector LIMIT ${topK}
        `);
        return results.rows;
      }
    }

    if (action === 'index') {
      const { content, fileName, documentId, metadata = {} } = job.data;
      if (!content || !userId) return { success: false, error: 'Missing content or userId' };

      console.log(`[RagWorker] 📥 Indexing document "${fileName}" for user ${userId}...`);

      try {
        // 1. Clear existing embeddings for this document
        if (metadata.clearPrevious !== false) {
          await db.execute(sql`DELETE FROM brand_embeddings WHERE user_id = ${userId} AND document_id = ${documentId}`);
        }

        // 2. Split content into manageable chunks
        const chunkSize = 1000;
        const overlap = 200;
        const chunks: string[] = [];
        
        for (let i = 0; i < content.length; i += (chunkSize - overlap)) {
          chunks.push(content.substring(i, i + chunkSize));
          if (i + chunkSize >= content.length) break;
        }

        // 3. Generate embeddings and save
        const batchSize = 5;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const currentBatch = chunks.slice(i, i + batchSize);
          await Promise.all(currentBatch.map(async (chunk) => {
            const vector = await embed(chunk);
            const vectorJson = JSON.stringify(vector);

            await db.execute(sql`
              INSERT INTO brand_embeddings (user_id, source, snippet, embedding, document_id, version)
              VALUES (${userId}, ${fileName || 'uploaded_pdf'}, ${chunk}, ${vectorJson}, ${documentId}, 1)
            `);
          }));
          
          job.updateProgress(Math.round(((i + currentBatch.length) / chunks.length) * 100));
        }

        return { success: true, chunksProcessed: chunks.length };
      } catch (err: any) {
        console.error('[RagWorker] Indexing failed:', err.message);
        
        await SystemHealthService.log({
          userId,
          service: 'rag',
          level: 'error',
          event: 'indexing_failure',
          message: err.message,
          details: { fileName, documentId }
        }).catch(err => console.error('[RAG Worker] Failed to log indexing failure:', err));

        throw err;
      }
    }

    if (action === 'clear') {
      if (!userId) return { success: false };
      console.log(`[RagWorker] 🗑️ Clearing all brand knowledge for user ${userId}`);
      await db.execute(sql`DELETE FROM brand_embeddings WHERE user_id = ${userId}`);
      return { success: true };
    }
    return [];
  }

  async stop() {
    await this.worker.close();
  }
}

export const ragWorker = new RagWorker();
