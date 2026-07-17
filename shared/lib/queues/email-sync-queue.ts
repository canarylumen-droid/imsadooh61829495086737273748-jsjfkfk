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

import { Queue, Worker, type Job } from 'bullmq';
import { createFreshConnection, getSharedRedisConnection, hasRedis } from './redis-config.js';
import { imapIdleManager } from '@services/email-service/src/email/imap-idle-manager.js';
import { emailSyncWorker } from '@services/email-service/src/email/email-sync-worker.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';
import { storage } from '@shared/lib/storage/storage.js';

// ─── Queue Definition ─────────────────────────────────────────────────────────

function createLazyQueue(name: string, opts?: any): Queue {
  let instance: Queue | null = null;
  return new Proxy({}, {
    get(target, prop) {
      if (prop === '__closeIfInitialized') {
        return async () => {
          if (instance) {
            await instance.close();
          }
        };
      }
      if (!instance) {
        if (!hasRedis) return undefined;
        instance = new Queue(name, {
          connection: getSharedRedisConnection(),
          ...opts,
        });
      }
      const value = Reflect.get(instance, prop);
      return typeof value === 'function' ? value.bind(instance) : value;
    }
  }) as any as Queue;
}

export const emailSyncQueue = createLazyQueue('email-sync-tasks', {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
    priority: 5, // Default mid-priority; reply detection uses 1, orphan reassignment uses 1
  },
});

// ─── Integration Cache (avoids DB hit per job) ──────────────────────────────

const integrationCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 30000;

async function getCachedIntegration(integrationId: string): Promise<any | null> {
  const cached = integrationCache.get(integrationId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const data = await storage.getIntegrationById(integrationId);
  if (data) integrationCache.set(integrationId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let emailSyncWorkerModule: Worker | null = null;

export function startEmailSyncWorker() {
  if (!emailSyncWorkerModule && hasRedis) {
    emailSyncWorkerModule = new Worker(
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
              const integration = await getCachedIntegration(integrationId);
              if (!integration || !integration.connected) {
                console.warn(`[EmailSyncQueue] Integration ${integrationId} not connected — skipping new-mail fetch`);
                return;
              }

              // Fetch only the newest messages (envelope only, no body — keeps this fast)
              // imapIdleManager handles IMAP session reuse
              const newMessages = await imapIdleManager.fetchNewMessages(userId, integrationId, count || 1);

              if (!newMessages || newMessages.length === 0) {
                // Even without a message, ping the UI to refresh (EXISTS may be a flag change)
                await clusterSync.notifyNewMail(userId, {
                  integrationId,
                  refresh: true,
                  timestamp: new Date().toISOString(),
                });
                return;
              }

              // Save each new message to the DB and push to UI
              for (const msg of newMessages) {
                // ── TEST-EMAIL SELF-LOOP GUARD ─────────────────────────────────────
                // If the inbound sender IS the user's own mailbox address it's a bounce
                // or auto-reply from a test send. Skip saving to DB; only ping the UI.
                const senderAddr = (msg.from || '').toLowerCase().trim().replace(/.*<([^>]+)>.*/, '$1');
                let ownAddr = (integration.email || integration.accountType || '').toLowerCase().trim();
                if (!ownAddr && integration.encryptedMeta) {
                  try {
                    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
                    const meta = JSON.parse(decrypt(integration.encryptedMeta));
                    ownAddr = (meta.smtp_user || meta.smtpUser || meta.user || meta.email || '').toLowerCase().trim();
                  } catch { /* non-critical */ }
                }
                if (ownAddr && senderAddr === ownAddr) {
                  await clusterSync.notifyNewMail(userId, {
                    integrationId,
                    messageId: msg.messageId,
                    subject: msg.subject,
                    from: msg.from,
                    snippet: msg.snippet,
                    date: msg.date,
                    isNew: false, // not a real lead reply
                  });
                  continue;
                }
                // [NEW] Warmup Seed Interception
                const { warmupSeedAccounts } = await import('@audnix/shared');
                const { db } = await import('@shared/lib/db/db.js');
                const { eq } = await import('drizzle-orm');
                const [seedAccount] = await db.select().from(warmupSeedAccounts).where(eq(warmupSeedAccounts.email, senderAddr));
                const isWarmupSeed = !!seedAccount;

                let lead = null;
                if (!isWarmupSeed) {
                  lead = await storage.findLeadBySenderAndIntegration(senderAddr, integrationId);
                }

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
                  leadId: lead?.id || null,
                  campaignId: null,
                  metadata: {
                    uid: msg.uid,
                    integrationId,
                    source: isWarmupSeed ? 'warmup_seed' : 'imap_idle',
                  },
                  ...(isWarmupSeed ? { isWarmup: true } : {})
                }).catch((err: any) => {
                  console.error(`[EmailSyncQueue] DB save failed for ${integrationId}:`, err.message);
                  return null;
                });

                if (lead) {
                  console.log(`[EmailSyncQueue] 📨 Found matching lead ${lead.id} for inbound email. Creating message to trigger auto-reply.`);
                  try {
                    await storage.createMessage({
                      userId,
                      leadId: lead.id,
                      direction: 'inbound',
                      body: msg.snippet || '',
                    });

                    // Update lead status to 'replied' and notify UI
                    try {
                      const { db } = await import('@shared/lib/db/db.js');
                      const { leads, campaignLeads, campaignEmails } = await import('@audnix/shared');
                      const { eq, and } = await import('drizzle-orm');

                      await db.update(leads)
                        .set({ status: 'replied', updatedAt: new Date() })
                        .where(eq(leads.id, lead.id));

                      await db.update(campaignLeads)
                        .set({ status: 'replied', repliedAt: new Date() })
                        .where(eq(campaignLeads.leadId, lead.id));

                      await db.update(campaignEmails)
                        .set({ status: 'replied' })
                        .where(and(
                          eq(campaignEmails.leadId, lead.id),
                          eq(campaignEmails.status, 'sent')
                        ));
                    } catch (dbErr: any) {
                      console.warn(`[EmailSyncQueue] Failed to update reply status for lead ${lead.id}:`, dbErr.message);
                    }

                    // Fire socket events for real-time UI update
                    await clusterSync.notifyLeadsUpdated(userId, {
                      leadId: lead.id,
                      status: 'replied',
                      action: 'replied',
                    });
                    await clusterSync.notifyMessagesUpdated(userId, {
                      leadId: lead.id,
                      direction: 'inbound',
                    });
                    await clusterSync.notifyStatsUpdated(userId, {
                      integrationId,
                      type: 'reply',
                    });
                    await clusterSync.notifyStatsCacheInvalidate(userId);

                    // Immediately fast-track an AI reply — don't wait for tick
                    try {
                      const { enqueuePriorityReply } = await import('@shared/lib/queues/outreach-queue.js');
                      await enqueuePriorityReply({ userId, leadId: lead.id, type: 'autonomous_reply', isAutonomous: true });
                      console.log(`⚡ [EmailSyncQueue] Fast-track priority reply enqueued for lead ${lead.id}`);
                    } catch (replyErr: any) {
                      console.warn(`[EmailSyncQueue] Failed to enqueue priority reply:`, replyErr.message);
                    }
                  } catch(e: any) {
                    console.error(`[EmailSyncQueue] Failed to create message for lead ${lead.id}:`, e.message);
                  }
                }

                // Real-time push — after DB updates so UI gets accurate data
                await clusterSync.notifyNewMail(userId, {
                  integrationId,
                  messageId: saved?.messageId || msg.messageId,
                  subject: msg.subject,
                  from: msg.from,
                  snippet: msg.snippet,
                  date: msg.date,
                  isNew: !!lead,
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

          // ── Watchdog: reassign orphaned mailbox from dead worker ─────────────────
          case 'discovery-orphan': {
            const { integrationId: orphanId, reason, deadTaskId } = job.data;
            console.log(`[EmailSyncQueue] 🔍 Reassigning orphan mailbox ${orphanId} (dead worker: ${deadTaskId}, reason: ${reason})`);
            await imapIdleManager.syncConnections();
            break;
          }

          // ── Priority: reply detected via IMAP IDLE → fast-track AI processing ────
          case 'reply-detected': {
            const { integrationId: replyIntegrationId, userId: replyUserId } = job.data;
            console.log(`[EmailSyncQueue] ⚡ Priority reply-detected job for ${replyIntegrationId}`);
            // The actual AI reply logic is already triggered in fetchNewEmails via enqueuePriorityReply.
            // This job serves as a BullMQ-tracked high-priority marker for observability.
            break;
          }

          default:
            console.warn(`[EmailSyncQueue] Unknown job type: ${type}`);
        }
      },
      {
        connection: createFreshConnection(),
        concurrency: 50, // High concurrency — each new-mail fetch is fast (envelope only)
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      } as any
    );

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
  }
  return emailSyncWorkerModule;
}
