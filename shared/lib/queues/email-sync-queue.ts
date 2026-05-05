/**
 * Email Sync Queue
 *
 * Handles all IMAP-triggered background jobs.
 * Critical fix: adds the `process-new-mail` handler that was missing.
 *
 * Job types:
 *  - process-new-mail   → fetch envelope, save to DB, push to UI instantly via Socket.IO
 *  - historical         → sync last N emails for a mailbox
 *  - poll               → fallback poll for inactive integrations
 *  - discovery          → reconnect all missing IMAP connections
 */

import { Queue, Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from './redis-config.js';
import { imapIdleManager } from '@services/email-service/src/email/imap-idle-manager.js';
import { emailSyncWorker } from '@services/email-service/src/email/email-sync-worker.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { storage } from '@shared/lib/storage/storage.js';

// ─── Queue Definition ─────────────────────────────────────────────────────────

export const emailSyncQueue = hasRedis ? new Queue('email-sync-tasks', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
} as any) : null;

// ─── Worker ───────────────────────────────────────────────────────────────────

export const emailSyncWorkerModule = hasRedis ? new Worker(
  'email-sync-tasks',
  async (job: Job) => {
    const { type, integrationId, userId, count, limit } = job.data;

    switch (type) {
      // ── CRITICAL: New mail from IMAP EXISTS event ──────────────────────────
      case 'process-new-mail': {
        if (!integrationId || !userId) {
          console.warn('[EmailSyncQueue] process-new-mail job missing integrationId or userId');
          return;
        }

        console.log(`[EmailSyncQueue] 📬 process-new-mail for ${integrationId} (user ${userId}, count ${count})`);

        try {
          // Fetch the integration to build IMAP connection config
          const integration = await storage.getIntegrationById(integrationId);
          if (!integration || !integration.connected) {
            console.warn(`[EmailSyncQueue] Integration ${integrationId} not connected — skipping new-mail fetch`);
            return;
          }

          // Fetch only the newest messages (envelope only, no body — keeps this fast)
          // imapIdleManager handles IMAP session reuse
          const newMessages = await imapIdleManager.fetchNewMessages(userId, integrationId, count || 1);

          if (!newMessages || newMessages.length === 0) {
            // Even without a message, ping the UI to refresh (EXISTS may be a flag change)
            wsSync.notifyNewMail(userId, {
              integrationId,
              refresh: true,
              timestamp: new Date().toISOString(),
            });
            return;
          }

          // Save each new message to the DB and push to UI
          for (const msg of newMessages) {
            const saved = await storage.createEmailMessage({
              userId,
              integrationId,
              messageId: msg.messageId || `imap-${integrationId}-${msg.uid}`,
              subject: msg.subject || '(no subject)',
              from: msg.from || '',
              to: msg.to || '',
              body: msg.snippet || '',
              direction: 'inbound',
              provider: integration.provider as any,
              sentAt: msg.date ? new Date(msg.date) : new Date(),
              leadId: null,
              campaignId: null,
              metadata: {
                uid: msg.uid,
                integrationId,
                source: 'imap_idle',
              },
            }).catch((err: any) => {
              console.error(`[EmailSyncQueue] DB save failed for ${integrationId}:`, err.message);
              return null;
            });

            // Real-time push — immediate, no throttle (priority event)
            wsSync.notifyNewMail(userId, {
              integrationId,
              messageId: saved?.messageId || msg.messageId,
              subject: msg.subject,
              from: msg.from,
              snippet: msg.snippet,
              date: msg.date,
              isNew: true,
            });
          }

          console.log(`[EmailSyncQueue] ✅ New mail processed for ${integrationId}: ${newMessages.length} message(s)`);
        } catch (err: any) {
          console.error(`[EmailSyncQueue] process-new-mail failed for ${integrationId}:`, err.message);
          throw err; // Let BullMQ retry
        }
        break;
      }

      // ── Historical sync ────────────────────────────────────────────────────
      case 'historical': {
        console.log(`[EmailSyncQueue] historical sync for user ${userId}, integration ${integrationId}`);
        await imapIdleManager.syncHistoricalEmails(userId, integrationId, limit || 5000);
        break;
      }

      // ── Fallback poll (for integrations not in IDLE) ───────────────────────
      case 'poll': {
        const integration = await storage.getIntegration(userId, integrationId);
        if (integration) {
          await emailSyncWorker.syncUserEmails(userId, integration);
        }
        break;
      }

      // ── Discovery: reconnect missing IMAP sessions ─────────────────────────
      case 'discovery': {
        await imapIdleManager.syncConnections();
        break;
      }

      default:
        console.warn(`[EmailSyncQueue] Unknown job type: ${type}`);
    }
  },
  {
    connection: redisConnection as any,
    concurrency: 50, // High concurrency — each new-mail fetch is fast (envelope only)
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  } as any
) : null;

// ─── Event Logging ─────────────────────────────────────────────────────────────

if (emailSyncWorkerModule) {
  emailSyncWorkerModule.on('completed', (job) => {
    const { type, integrationId } = job.data;
    if (type === 'process-new-mail') {
      console.log(`[EmailSyncQueue] ✅ new-mail job ${job.id} completed for ${integrationId}`);
    }
  });

  emailSyncWorkerModule.on('failed', (job, err) => {
    console.error(`[EmailSyncQueue] ❌ Job ${job?.id} (${job?.data?.type}) failed:`, err.message);
  });

  console.log('✅ BullMQ Email Sync Worker initialized (concurrency: 50)');
} else {
  console.warn('⚠️  BullMQ Email Sync Worker disabled (No Redis)');
}
