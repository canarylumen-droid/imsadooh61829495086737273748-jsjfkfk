/**
 * Outbound Worker
 * Processes warmup-outbound queue: pairing, LLM copy, SMTP send, record interaction.
 */

import { Worker } from 'bullmq';
import { createFreshConnection } from '@shared/lib/queues/redis-config.js';
import { db } from '../db/warmup-db.js';
import { eq, sql } from 'drizzle-orm';
import { warmupMailboxes, warmupThreads, warmupInteractions, integrations } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import { pairingEngine } from '../lib/pairing-engine.js';
import { threadManager } from '../lib/thread-manager.js';
import { llmCopywriter } from '../lib/llm-copywriter.js';
import { smtpSender } from '../lib/smtp-sender.js';
import { imapStealth } from '../lib/imap-stealth.js';
import { warmupInboundQueue } from '../queues/warmup-queues.js';

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

      // Daily cap check against dynamic warmup limit from integrations
      const [integrationRow] = await db
        .select({ warmupLimit: integrations.warmupLimit })
        .from(integrations)
        .where(eq(integrations.id, sender[0].integrationId))
        .limit(1);
      const dynamicLimit = integrationRow?.warmupLimit ?? 5;

      if (sender[0].dailySentCount >= dynamicLimit) {
        await db
          .update(warmupMailboxes)
          .set({ status: 'paused', pauseReason: 'daily_limit_reached' })
          .where(eq(warmupMailboxes.id, sender[0].id));
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

      const body = await llmCopywriter.generateReply(context);

      // Build headers
      const messageId = threadManager.generateMessageId();
      const headers: Record<string, string> = {
        'X-Audnix-Warmup': 'true',
        'X-Audnix-Warmup-Thread': threadId,
      };

      if (thread[0].lastMessageId) {
        headers['In-Reply-To'] = thread[0].lastMessageId;
        headers['References'] = [
          ...(thread[0].references || []),
          thread[0].lastMessageId,
        ].join(' ');
      }

      // Extract SMTP credentials
      const meta = sender[0].metadata as any;
      const host = meta?.smtpHost || meta?.smtp_host || getDefaultSmtpHost(sender[0].provider);
      const port = meta?.smtpPort || meta?.smtp_port || 587;
      const pass = meta?.smtpPass || meta?.smtp_pass || meta?.password || '';

      // Credential validation for custom_email
      if (sender[0].provider === 'custom_email') {
        if (!host) {
          throw new Error(`[Warmup][Outbound] Missing SMTP host for ${sender[0].email}`);
        }
        if (!pass) {
          throw new Error(`[Warmup][Outbound] Missing SMTP password for ${sender[0].email}`);
        }
      }

      // Infer secure flag from port for custom_email
      let secure = meta?.smtpSecure ?? false;
      if (sender[0].provider === 'custom_email') {
        secure = port === 465; // SSL/TLS
        // Port 587, 25, 2525 use STARTTLS (secure: false)
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

      return { success: result.success, interactionId: interaction?.id };
    },
    { connection: createFreshConnection(), concurrency: WARMUP_CONFIG.OUTBOUND_CONCURRENCY }
  );
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

/**
 * Synchronously expunge a warmup email from the Sent folder immediately after
 * SMTP delivery. Retries up to 3 times with 1.5s backoff if the message hasn't
 * appeared in the Sent folder yet (some providers have sub-second indexing delay).
 *
 * Target: < 800ms from SMTP 250 OK to IMAP EXPUNGE.
 * Replaces the previous 5-second delayed BullMQ job approach.
 */
async function expungeSentSync(
  mailbox: any,
  messageId: string,
  attempt: number = 1
): Promise<void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;

  try {
    const success = await imapStealth.expungeSentWarmup(mailbox, messageId);
    if (!success && attempt < MAX_RETRIES) {
      // Message not yet indexed in Sent folder — retry after short delay
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return expungeSentSync(mailbox, messageId, attempt + 1);
    }
    if (success) {
      console.log(`[Warmup][Outbound] ✅ Sent-folder expunged for ${messageId} (attempt ${attempt})`);
    }
  } catch (err: any) {
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return expungeSentSync(mailbox, messageId, attempt + 1);
    }
    throw err;
  }
}
