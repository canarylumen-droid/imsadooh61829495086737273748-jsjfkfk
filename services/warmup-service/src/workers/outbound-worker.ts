/**
 * Outbound Worker
 * Processes warmup-outbound queue: pairing, LLM copy, SMTP send, record interaction.
 */

import { Worker } from 'bullmq';
import { createFreshConnection } from '@shared/lib/queues/redis-config.js';
import { db } from '../db/warmup-db.js';
import { eq, sql } from 'drizzle-orm';
import { warmupMailboxes, warmupThreads, warmupInteractions, integrations } from '@audnix/shared';
import { WARMUP_CONFIG, getRampLimit } from '../config/warmup-config.js';
import { pairingEngine } from '../lib/pairing-engine.js';
import { threadManager } from '../lib/thread-manager.js';
import { llmCopywriter } from '../lib/llm-copywriter.js';
import { smtpSender } from '../lib/smtp-sender.js';
import { imapStealth } from '../lib/imap-stealth.js';
import { warmupInboundQueue } from '../queues/warmup-queues.js';
import { seedFleetManager } from '../engine/seed-fleet-manager.js';
import { reputationRecovery } from '../engine/reputation-recovery.js';
import crypto from 'crypto';

function decryptWarmupSecret(ciphertext: string): string {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  const key = process.env.WARMUP_ENCRYPTION_KEY || 'default-insecure-key-change-in-production';
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) return ciphertext;
    const [ivHex, authTagHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return ciphertext;
  }
}

export function createOutboundWorker(): Worker {
  return new Worker(
    WARMUP_CONFIG.OUTBOUND_QUEUE_NAME,
    async (job) => {
      const { threadId, interactionType } = job.data;
      if (!threadId) throw new Error('Missing threadId in outbound job');

      const thread = await db
        .select()
        .from(warmupThreads)
        .where(eq(warmupThreads.id, threadId))
        .limit(1);

      if (!thread[0] || thread[0].status === 'completed') return;

      const sender = await db
        .select()
        .from(warmupMailboxes)
        .where(eq(warmupMailboxes.id, thread[0].senderMailboxId))
        .limit(1);
      const recipient = await db
        .select()
        .from(warmupMailboxes)
        .where(eq(warmupMailboxes.id, thread[0].recipientMailboxId))
        .limit(1);

      if (!sender[0] || !recipient[0]) return;

      // Daily cap check — seeds use their own dailyLimit, others use integration warmupLimit
      let dynamicLimit = WARMUP_CONFIG.DAILY_SENT_LIMIT;
      if (sender[0].anchorRole === 'seed') {
        dynamicLimit = sender[0].dailyLimit ?? WARMUP_CONFIG.SEED_DAILY_LIMIT;
      } else if (sender[0].integrationId) {
        const [integrationRow] = await db
          .select({ warmupLimit: integrations.warmupLimit })
          .from(integrations)
          .where(eq(integrations.id, sender[0].integrationId))
          .limit(1);
        dynamicLimit = integrationRow?.warmupLimit ?? WARMUP_CONFIG.DAILY_SENT_LIMIT;
      }

      // Apply percentage-based ramp schedule for non-seed mailboxes
      if (sender[0].anchorRole !== 'seed') {
        dynamicLimit = getRampLimit(sender[0].createdAt, dynamicLimit);
      }

      // Apply reputation recovery boost — dead IPs get higher warmup volume
      const effectiveLimit = reputationRecovery.getEffectiveLimit(sender[0], dynamicLimit);

      if (sender[0].dailySentCount >= effectiveLimit) {
        // Don't pause mailboxes in recovery mode — let them keep warming
        if (!reputationRecovery.isInRecovery(sender[0])) {
          await db
            .update(warmupMailboxes)
            .set({ status: 'paused', pauseReason: 'daily_limit_reached' })
            .where(eq(warmupMailboxes.id, sender[0].id));
        }
        return;
      }

      // Generate copy
      const previousMessages = await db
        .select()
        .from(warmupInteractions)
        .where(eq(warmupInteractions.threadId, threadId))
        .orderBy(warmupInteractions.createdAt);

      const context = {
        threadId,
        subject: thread[0].subject,
        previousMessages: previousMessages.map((m: any) => ({
          direction: m.direction as any,
          body: m.body,
          sentAt: m.sentAt,
        })),
        volleyNumber: thread[0].messageCount + 1,
      };

      const body = llmCopywriter.generateReply(context);

      const messageId = threadManager.generateMessageId();
      const priorityOptions = ['', '', '', '1 (Highest)', '3 (Normal)', '5 (Lowest)'];
      const importanceOptions = ['', '', 'high', 'normal', 'low'];
      const msPriorityOptions = ['', '', 'High', 'Normal', 'Low'];
      const chosenPriority = priorityOptions[Math.floor(Math.random() * priorityOptions.length)];
      const headers: Record<string, string> = {};
      if (chosenPriority) {
        headers['X-Priority'] = chosenPriority;
      }
      if (importanceOptions[Math.floor(Math.random() * importanceOptions.length)]) {
        headers['Importance'] = importanceOptions[Math.floor(Math.random() * importanceOptions.length)];
      }
      if (msPriorityOptions[Math.floor(Math.random() * msPriorityOptions.length)] && Math.random() > 0.5) {
        headers['X-MSMail-Priority'] = msPriorityOptions[Math.floor(Math.random() * msPriorityOptions.length)];
      }
      // Rarely add Message-ID header override — normally leave it to the MTA
      if (Math.random() > 0.8) {
        headers['Message-ID'] = messageId;
      }

      if (thread[0].lastMessageId) {
        headers['In-Reply-To'] = thread[0].lastMessageId;
        headers['References'] = [
          ...(thread[0].references || []),
          thread[0].lastMessageId,
        ].join(' ');
      }

      const meta = sender[0].metadata as any;
      const host = meta?.smtpHost || meta?.smtp_host || getDefaultSmtpHost(sender[0].provider);
      const port = meta?.smtpPort || meta?.smtp_port || 587;
      const rawPass = meta?.smtpPass || meta?.smtp_pass || meta?.password || '';
      const pass = decryptWarmupSecret(rawPass);

      if (sender[0].provider === 'custom_email') {
        if (!host) {
          throw new Error(`[Warmup][Outbound] Missing SMTP host for ${sender[0].email}`);
        }
        if (!pass) {
          throw new Error(`[Warmup][Outbound] Missing SMTP password for ${sender[0].email}`);
        }
      }

      let secure = meta?.smtpSecure ?? false;
      if (sender[0].provider === 'custom_email') {
        secure = parseInt(String(port)) === 465;
      }

      const credentials = {
        host,
        port,
        user: meta?.smtpUser || meta?.smtp_user || meta?.user || sender[0].email,
        pass,
        secure,
        provider: sender[0].provider,
        userId: sender[0].userId,
      };

      // Send
      const result = await smtpSender.send({
        from: sender[0].email,
        to: recipient[0].email,
        subject: thread[0].subject,
        body,
        messageId,
        headers,
        credentials,
      });

      // Record interaction
      const [interaction] = await db
        .insert(warmupInteractions)
        .values({
          threadId: thread[0].id,
          direction: 'outbound',
          fromMailboxId: sender[0].id,
          toMailboxId: recipient[0].id,
          subject: thread[0].subject,
          body,
          messageId,
          inReplyTo: thread[0].lastMessageId,
          references: thread[0].lastMessageId
            ? [...(thread[0].references || []), thread[0].lastMessageId]
            : [],
          status: result.success ? 'sent' : 'failed',
          errorMessage: result.error || null,
          sentAt: new Date(),
        })
        .returning();

      // Only advance thread, increment daily count, and queue reply if send succeeded
      if (result.success) {
        await threadManager.advanceThread(
          threadId,
          messageId,
          'outbound',
          sender[0].id,
          recipient[0].id
        );
        await db
          .update(warmupMailboxes)
          .set({
            dailySentCount: sql`${warmupMailboxes.dailySentCount} + 1`,
          })
          .where(eq(warmupMailboxes.id, sender[0].id));

        if (sender[0].anchorRole === 'seed') {
          seedFleetManager.incrementSeedSentCount(sender[0].id).catch(err => console.warn('[Warmup][Outbound] Seed sent count increment failed:', err.message));
          resetSeedFailureCount(sender[0].id);
        }

        // Queue inbound expect-reply
        const replyDelay =
          Math.floor(
            Math.random() *
              (WARMUP_CONFIG.MAX_REPLY_EXPECTATION_HOURS -
                WARMUP_CONFIG.MIN_REPLY_EXPECTATION_HOURS +
                1)
          ) +
          WARMUP_CONFIG.MIN_REPLY_EXPECTATION_HOURS;

        await warmupInboundQueue.add(
          'expect-reply',
          {
            threadId,
            recipientMailboxId: recipient[0].id,
            expectedMessageId: messageId,
          },
          { delay: replyDelay * 60 * 60 * 1000 }
        );

        // Synchronous sent-folder expunge — runs immediately after SMTP 250 OK.
        // Retries up to 3 times with 1.5s backoff if the message hasn't appeared
        // in the Sent folder yet (some providers have sub-second indexing delay).
        // Target: < 800ms from SMTP success to IMAP EXPUNGE.
        expungeSentSync(sender[0], messageId).catch((err: any) => {
          console.warn(`[Warmup][Outbound] Sent-folder expunge failed for ${messageId}:`, err.message);
        });
      }

      // Mark non-seed failures as bounced for reputation recovery tracking
      if (!result.success && sender[0].anchorRole !== 'seed') {
        await db
          .update(warmupInteractions)
          .set({ status: 'bounced', errorMessage: result.error || 'SMTP delivery failed' })
          .where(eq(warmupInteractions.id, interaction.id));
      }

      if (!result.success && sender[0].anchorRole === 'seed') {
        const isRateLimit = result.error?.toLowerCase().includes('rate limit')
          || result.error?.toLowerCase().includes('too many')
          || result.error?.toLowerCase().includes('try again later');

        if (isRateLimit) {
          const cooldownMin = 5 + Math.floor(Math.random() * 10);
          console.warn(`[Warmup][Outbound] Seed ${sender[0].email} rate-limited — cooling for ${cooldownMin}m`);
          await db
            .update(warmupMailboxes)
            .set({
              status: 'paused',
              pauseReason: 'daily_limit_reached',
              metadata: sql`jsonb_set(${warmupMailboxes.metadata}, '{seedFailCount}', '0'::jsonb)`,
            })
            .where(eq(warmupMailboxes.id, sender[0].id));
        } else {
          const failCount = (sender[0].metadata as any)?.seedFailCount || 0;
          const newFailCount = failCount + 1;
          await db
            .update(warmupMailboxes)
            .set({
              metadata: sql`jsonb_set(${warmupMailboxes.metadata}, '{seedFailCount}', ${newFailCount}::text::jsonb)`,
            })
            .where(eq(warmupMailboxes.id, sender[0].id));

          if (newFailCount >= 3) {
            console.warn(`[Warmup][Outbound] Seed ${sender[0].email} failed ${newFailCount}x — triggering seed replacement`);
            seedFleetManager.handleSeedFailure(sender[0].id).catch(err => console.warn('[Warmup][Outbound] Seed failure handler failed:', err.message));
          }
        }
      }

      return { success: result.success, interactionId: interaction?.id };
    },
    { connection: createFreshConnection() as any, concurrency: WARMUP_CONFIG.OUTBOUND_CONCURRENCY }
  );
}

function resetSeedFailureCount(mailboxId: string): void {
  db.update(warmupMailboxes)
    .set({ metadata: sql`jsonb_set(${warmupMailboxes.metadata}, '{seedFailCount}', '0'::jsonb)` })
    .where(eq(warmupMailboxes.id, mailboxId))
    .catch(err => console.warn('[Warmup][Outbound] Seed failure count reset failed:', err.message));
}

function getDefaultSmtpHost(provider: string): string {
  switch (provider) {
    case 'gmail':
      return 'smtp.gmail.com';
    case 'outlook':
      return 'smtp.office365.com';
    case 'custom_email':
      console.warn(`[Warmup][Outbound] custom_email integration missing smtpHost in metadata — cannot send via SMTP`);
      return '';
    default:
      console.warn(`[Warmup][Outbound] Unknown provider "${provider}" — cannot determine SMTP host`);
      return '';
  }
}

async function expungeSentSync(
  mailbox: any,
  messageId: string,
  attempt: number = 1
): Promise<void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;
  const OPERATION_TIMEOUT_MS = 10000;

  try {
    const result = await Promise.race([
      imapStealth.expungeSentWarmup(mailbox, messageId),
      new Promise<false>((_, reject) =>
        setTimeout(() => reject(new Error('IMAP expunge timed out')), OPERATION_TIMEOUT_MS)
      ),
    ]);
    if (!result && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return expungeSentSync(mailbox, messageId, attempt + 1);
    }
    if (result) {
      console.log(`[Warmup][Outbound] Sent-folder expunged for ${messageId} (attempt ${attempt})`);
    }
  } catch (err: any) {
    if (attempt < MAX_RETRIES && !err.message?.includes('timed out')) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return expungeSentSync(mailbox, messageId, attempt + 1);
    }
    console.warn(`[Warmup][Outbound] Sent-folder expunge failed for ${messageId}:`, err.message);
  }
}
