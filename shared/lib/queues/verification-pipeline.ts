import { Queue, Worker, Job } from 'bullmq';
import { hasRedis, redisConnection } from './redis-config.js';
import { db } from '@shared/lib/db/db.js';
import { leads, campaignLeads } from '@audnix/shared';
import { sql } from 'drizzle-orm';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import * as dns from 'dns/promises';

/**
 * HIGH-SPEED LEAD IMPORT & PRE-FLIGHT VERIFICATION
 * Processes 100k+ leads with high concurrency, utilizing regex, MX checks, and atomic DB deduplication.
 */

export interface VerificationJobData {
  userId: string;
  campaignId: string;
  batch: Array<{ email: string; firstName?: string; lastName?: string; company?: string }>;
  batchIndex: number;
  totalBatches: number;
}

export const verificationQueue = hasRedis ? new Queue<VerificationJobData>('lead-verification-queue', {
  connection: redisConnection as any,
  defaultJobOptions: { attempts: 2, removeOnComplete: true }
}) : null;

// Progress tracker in memory (In production, use Redis hashes for distributed state)
const progressCache = new Map<string, { total: number, processed: number, valid: number, failed: number }>();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function checkMXRecord(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    return records && records.length > 0;
  } catch (e) {
    return false;
  }
}

export const startVerificationWorker = () => {
  if (!hasRedis) return;

  const worker = new Worker<VerificationJobData>(
    'lead-verification-queue',
    async (job: Job<VerificationJobData>) => {
      const { userId, campaignId, batch, batchIndex, totalBatches } = job.data;
      const progressKey = `${userId}:${campaignId}`;
      
      if (!progressCache.has(progressKey)) {
        // Estimate total if not tracking
        progressCache.set(progressKey, { total: totalBatches * batch.length, processed: 0, valid: 0, failed: 0 });
      }
      
      const stats = progressCache.get(progressKey)!;

      const validLeads = [];
      const failedLeads = [];

      // 1 & 2: Syntax and MX Verification
      for (const lead of batch) {
        if (!lead.email || !emailRegex.test(lead.email)) {
          failedLeads.push(lead);
          continue;
        }

        const domain = lead.email.split('@')[1];
        const hasMX = await checkMXRecord(domain);
        
        if (hasMX) {
          validLeads.push(lead);
        } else {
          failedLeads.push(lead);
        }
      }

      stats.processed += batch.length;
      stats.valid += validLeads.length;
      stats.failed += failedLeads.length;

      // 3. Atomic DB Insertion with ON CONFLICT deduplication
      if (validLeads.length > 0 && db) {
        try {
          // Insert into global leads table
          const insertedLeads = await db.execute(sql`
            INSERT INTO leads (user_id, email, first_name, last_name, company, status, created_at, updated_at)
            VALUES ${sql.join(validLeads.map(l => sql`(${userId}, ${l.email}, ${l.firstName || ''}, ${l.lastName || ''}, ${l.company || ''}, 'new', NOW(), NOW())`), sql`, `)}
            ON CONFLICT (user_id, email) DO UPDATE SET updated_at = NOW()
            RETURNING id;
          `);

          // Insert into campaign_leads as pending for distribution
          if (insertedLeads.rows.length > 0) {
            await db.execute(sql`
              INSERT INTO campaign_leads (campaign_id, lead_id, status, created_at, updated_at)
              VALUES ${sql.join(insertedLeads.rows.map(row => sql`(${campaignId}, ${row.id}, 'pending', NOW(), NOW())`), sql`, `)}
              ON CONFLICT (campaign_id, lead_id) DO NOTHING;
            `);
          }
        } catch (dbErr) {
          console.error(`[VerificationPipeline] DB Insert Error:`, dbErr);
        }
      }

      // Non-blocking WebSocket progress broadcast
      wsSync.broadcastToUser(userId, { type: 'import_progress', payload: {
        campaignId,
        total: stats.total,
        processed: stats.processed,
        valid: stats.valid,
        failed: stats.failed,
        percentage: Math.round((stats.processed / stats.total) * 100)
      }});

      // Cleanup cache if done
      if (stats.processed >= stats.total) {
        progressCache.delete(progressKey);
        wsSync.broadcastToUser(userId, { type: 'import_complete', payload: { campaignId, valid: stats.valid }});
      }

      return { processed: batch.length, valid: validLeads.length };
    },
    {
      connection: redisConnection as any,
      concurrency: 50 // 50 concurrent validation workers
    }
  );

  console.log('[VerificationPipeline] 🚀 High-Speed Lead Verification Worker Started (Concurrency: 50)');
};
