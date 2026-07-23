/**
 * Inbound Worker
 * Processes warmup-inbound queue: expect-reply, expunge-sent, inbox-sweep, spam-rescue.
 */

import { Worker } from 'bullmq';
import { createFreshConnection } from '@shared/lib/queues/redis-config';
import { db } from '../db/warmup-db.js';
import { eq, and } from 'drizzle-orm';
import { warmupMailboxes, warmupThreads, warmupInteractions } from '@audnix/shared';
import { WARMUP_CONFIG, getRampLimit } from '../config/warmup-config.js';
import { imapStealth } from '../lib/imap-stealth.js';
import { withImapTimeout } from '../lib/watchdog.js';
import { llmCopywriter } from '../lib/llm-copywriter.js';
import { smtpSender } from '../lib/smtp-sender.js';
import { threadManager } from '../lib/thread-manager.js';
import { warmupOutboundQueue } from '../queues/warmup-queues.js';

export function createInboundWorker(): Worker {
  return new Worker(
    WARMUP_CONFIG.INBOUND_QUEUE_NAME,
    async (job) => {
      const { name, data } = job;

      switch (name) {
        case 'expect-reply':
          return await handleExpectReply(data);
        case 'expunge-sent':
          return await handleExpungeSent(data);
        case 'inbox-sweep':
          return await handleInboxSweep(data);
        case 'spam-rescue':
          return await handleSpamRescue(data);
        default:
          console.warn(`[Warmup][Inbound] Unknown job type: ${name}`);
      }
    },
    { connection: createFreshConnection() as any, concurrency: WARMUP_CONFIG.INBOUND_CONCURRENCY }
  );
}

async function handleExpectReply(data: any) {
  const { threadId, recipientMailboxId, expectedMessageId } = data;

  // Check if the email was received by the user (inbox sweep or spam rescue)
  const existingInteraction = await db
    .select()
    .from(warmupInteractions)
    .where(
      and(
        eq(warmupInteractions.messageId, expectedMessageId),
        eq(warmupInteractions.movedToHiddenFolder, true)
      )
    )
    .limit(1);

  if (existingInteraction[0]) {
    console.log(`[Warmup][Inbound] Message ${expectedMessageId} received — open tracking`);
  } else {
    const mailbox = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, recipientMailboxId))
      .limit(1);

    if (!mailbox[0]) return;

    let found = await withImapTimeout(
      () => imapStealth.sweepInboxToHidden(mailbox[0]),
      mailbox[0].id,
      'expect-reply'
    );

    if (!found) {
      found = await withImapTimeout(
        () => imapStealth.rescueSpamFolder(mailbox[0]),
        mailbox[0].id,
        'expect-reply'
      );
    }

    if (!found) return;
  }

  // Re-check interaction for open tracking flag (sweep may have set openedAt)
  const interaction = await db
    .select()
    .from(warmupInteractions)
    .where(eq(warmupInteractions.messageId, expectedMessageId))
    .limit(1);

  if ((interaction[0] as any)?.openedAt) {
    console.log(`[Warmup][Inbound] ✅ Warmup email ${expectedMessageId} was opened!`);
    // Fire socket event for real-time UI update
    const thread = await db
      .select()
      .from(warmupThreads)
      .where(eq(warmupThreads.id, threadId))
      .limit(1);
    if (thread[0]) {
      const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
      const mailbox = await db
        .select()
        .from(warmupMailboxes)
        .where(eq(warmupMailboxes.id, thread[0].senderMailboxId))
        .limit(1);
      if (mailbox[0]) {
        clusterSync.notifyStatsUpdated(mailbox[0].userId).catch(() => {});
        clusterSync.notifyWarmupUpdated(mailbox[0].userId, { mailboxId: mailbox[0].integrationId, status: 'active' }).catch(() => {});
      }
    }
  }

  // Thread advances naturally via outbound worker sends.
  // No direction flipping or queueing here — the seed drives all volleys.
}

async function handleExpungeSent(data: any) {
  const { mailboxId, messageId } = data;

  const mailbox = await db
    .select()
    .from(warmupMailboxes)
    .where(eq(warmupMailboxes.id, mailboxId))
    .limit(1);

  if (!mailbox[0]) return;

  await withImapTimeout(
    () => imapStealth.expungeSentWarmup(mailbox[0], messageId),
    mailbox[0].id,
    'expunge-sent'
  );
}

async function handleInboxSweep(data: any) {
  const { mailboxId } = data;

  const mailbox = await db
    .select()
    .from(warmupMailboxes)
    .where(eq(warmupMailboxes.id, mailboxId))
    .limit(1);

  if (!mailbox[0]) return;

  const moved = await withImapTimeout(
    () => imapStealth.sweepInboxToHidden(mailbox[0]),
    mailbox[0].id,
    'inbox-sweep'
  );

  if (moved && moved > 0) {
    console.log(
      `[Warmup][Inbound] Moved ${moved} warmup email(s) to hidden folder for ${mailbox[0].email}`
    );
  }
}

async function handleSpamRescue(data: any) {
  // Batch job: rescue all active mailboxes
  const mailboxes = await db
    .select()
    .from(warmupMailboxes)
    .where(eq(warmupMailboxes.status, 'active'));

  let totalRescued = 0;
  for (const mb of mailboxes) {
    const rescued = await withImapTimeout(
      () => imapStealth.rescueSpamFolder(mb),
      mb.id,
      'spam-rescue'
    );
    if (rescued) totalRescued += rescued;
  }

  if (totalRescued > 0) {
    console.log(
      `[Warmup][Inbound] Rescued ${totalRescued} warmup email(s) from spam folders`
    );
  }
}
