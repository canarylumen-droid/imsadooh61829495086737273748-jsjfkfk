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

  // Fast path: check DB for the expected interaction marked as received
  // (inbox-sweep may have already moved the email to hidden folder)
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
    console.log(`[Warmup][Inbound] Message ${expectedMessageId} already received and swept — proceeding`);
  } else {
    // Fallback: poll IMAP inbox for the expected reply
    const mailbox = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, recipientMailboxId))
      .limit(1);

    if (!mailbox[0]) return;

    // First try INBOX sweep
    let found = await withImapTimeout(
      () => imapStealth.sweepInboxToHidden(mailbox[0]),
      mailbox[0].id,
      'expect-reply'
    );

    // If INBOX sweep didn't find it, try Spam folder (Gmail/Outlook often filters warmup)
    if (!found) {
      found = await withImapTimeout(
        () => imapStealth.rescueSpamFolder(mailbox[0]),
        mailbox[0].id,
        'expect-reply'
      );
    }

    if (!found) {
      // Wait longer — the scheduler will clean up stalled threads
      return;
    }
  }

  // If the thread is still active and we found the reply, queue the next outbound
  const thread = await db
    .select()
    .from(warmupThreads)
    .where(eq(warmupThreads.id, threadId))
    .limit(1);

  if (thread[0] && thread[0].status === 'active') {
    // The recipient is now the sender for the next volley
    // But first check the recipient hasn't hit its daily sent limit
    const recipientMb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, recipientMailboxId))
      .limit(1);

    if (!recipientMb[0]) return;

    // Seeds are internal platform accounts — no daily limit enforcement
    // User mailboxes use the ramp-adjusted daily limit
    const recipientLimit = recipientMb[0].anchorRole === 'seed'
      ? (recipientMb[0].dailyLimit ?? WARMUP_CONFIG.SEED_DAILY_LIMIT)
      : getRampLimit(recipientMb[0].createdAt, WARMUP_CONFIG.DAILY_SENT_LIMIT);

    if (recipientMb[0].dailySentCount < recipientLimit) {
      await warmupOutboundQueue.add(
        'send-reply',
        {
          threadId,
          // The "reply" direction flips — recipient becomes sender
          senderMailboxId: recipientMailboxId,
          recipientMailboxId: thread[0].senderMailboxId,
        },
        {
          delay:
            (WARMUP_CONFIG.MIN_REPLY_EXPECTATION_MINUTES +
              Math.floor(
                Math.random() *
                  (WARMUP_CONFIG.MAX_REPLY_EXPECTATION_MINUTES -
                    WARMUP_CONFIG.MIN_REPLY_EXPECTATION_MINUTES +
                    1)
              )) *
              60 *
              1000,
        }
      );
    } else {
      console.log(
        `[Warmup][Inbound] Skipping reply for ${recipientMailboxId} — daily sent limit reached`
      );
    }
  }
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
