/**
 * Thread Manager
 * Creates, advances, and closes warmup conversation threads.
 */

import { db } from '../db/warmup-db.js';
import { eq, and, sql } from 'drizzle-orm';
import { warmupThreads, warmupInteractions, warmupMailboxes } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import { randomUUID } from 'crypto';
import type { WarmupMailbox } from '../types/warmup-types.js';

const SUBJECT_TEMPLATES = [
  'Quick question about your workflow',
  'Following up on our last conversation',
  'Just checking in',
  'Thought you might find this useful',
  'Quick scheduling note',
  'Hey, wanted to run something by you',
  'Small follow-up from earlier',
  'Can I get your quick take on this?',
  'Checking in on this',
  'Circling back on this',
  'A quick thought',
  'Wanted to share something',
  'What do you think about this?',
  'A quick ask',
  'Quick question for you',
  'Looking for your input',
  'Appreciate your perspective',
  'Had a thought I wanted to share',
  'Hope you are having a good week',
  'Wanted to touch base',
  'A quick note',
  'Touching base on this',
  'A few thoughts to share',
  'Would love your feedback',
  'Curious about your take',
  'Hope this finds you well',
  'Following up on a previous note',
  'An idea I wanted to run by you',
  'Have a quick minute?',
  'Thinking about this more',
  'A question for you',
  'Wanted to see what you think',
  'Small update on my end',
  'Hope all is well',
  'Been meaning to ask',
  'A quick check-in',
  'Revisiting an earlier idea',
  'Just a friendly ping',
  'Looking ahead to next steps',
  'A quick thought on this',
  'Had an idea I wanted to share',
  'Here is an update',
  'Quick heads up',
  'A small favor to ask',
  'Appreciate any guidance',
  'Wanted to follow up properly',
  'Hope your week is going well',
  'A quick question on timing',
  'Checking in on priorities',
  'A thought on our last chat',
];

function pickSubject(sender: WarmupMailbox): string {
  const meta = (sender as any).metadata || {};
  const userSubjects: string[] = meta.userSubjects || [];
  if (userSubjects.length > 0) {
    return userSubjects[Math.floor(Math.random() * userSubjects.length)];
  }
  return SUBJECT_TEMPLATES[Math.floor(Math.random() * SUBJECT_TEMPLATES.length)];
}

export class ThreadManager {
  async createThread(sender: WarmupMailbox, recipient: WarmupMailbox) {
    const subject = pickSubject(sender);
    const maxMessages = this.randomBetween(
      WARMUP_CONFIG.MIN_MESSAGES_PER_THREAD,
      WARMUP_CONFIG.MAX_MESSAGES_PER_THREAD
    );

    const [thread] = await db
      .insert(warmupThreads)
      .values({
        senderMailboxId: sender.id,
        recipientMailboxId: recipient.id,
        status: 'active',
        messageCount: 0,
        maxMessages,
        subject,
        nextSendAt: new Date(
          Date.now() + this.randomBetween(30, 90) * 1000
        ),
      })
      .returning();

    // Update active thread IDs on both mailboxes
    await this.addActiveThread(sender.id, thread.id);
    await this.addActiveThread(recipient.id, thread.id);

    console.log(
      `[Warmup][Thread] Created thread ${thread.id}: ${sender.email} → ${recipient.email} (${maxMessages} volleys)`
    );
    return thread;
  }

  async advanceThread(
    threadId: string,
    messageId: string,
    direction: 'outbound' | 'inbound',
    fromMailboxId: string,
    toMailboxId: string
  ) {
    const thread = await db
      .select()
      .from(warmupThreads)
      .where(eq(warmupThreads.id, threadId))
      .limit(1);

    if (!thread[0] || thread[0].status === 'completed') return null;

    const newCount = thread[0].messageCount + 1;
    const isComplete = newCount >= thread[0].maxMessages;

    await db
      .update(warmupThreads)
      .set({
        messageCount: newCount,
        lastMessageId: messageId,
        references: thread[0].lastMessageId
          ? sql`${warmupThreads.references} || to_jsonb(${thread[0].lastMessageId}::text)`
          : warmupThreads.references,
        status: isComplete ? 'completed' : 'active',
        lastInteractionAt: new Date(),
        nextSendAt: isComplete
          ? null
          : new Date(
              Date.now() +
                this.randomBetween(2, 6) * 60 * 60 * 1000
            ),
      })
      .where(eq(warmupThreads.id, threadId));

    if (isComplete) {
      await this.removeActiveThread(thread[0].senderMailboxId, threadId);
      await this.removeActiveThread(thread[0].recipientMailboxId, threadId);
    }

    return { ...thread[0], messageCount: newCount, status: isComplete ? 'completed' : 'active' };
  }

  private async addActiveThread(mailboxId: string, threadId: string) {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, mailboxId))
      .limit(1);

    if (mb[0]) {
      const ids = new Set([...(mb[0].activeThreadIds || []), threadId]);
      await db
        .update(warmupMailboxes)
        .set({ activeThreadIds: Array.from(ids) })
        .where(eq(warmupMailboxes.id, mailboxId));
    }
  }

  private async removeActiveThread(mailboxId: string, threadId: string) {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, mailboxId))
      .limit(1);

    if (mb[0]) {
      const ids = (mb[0].activeThreadIds || []).filter((id: any) => id !== threadId);
      await db
        .update(warmupMailboxes)
        .set({ activeThreadIds: ids })
        .where(eq(warmupMailboxes.id, mailboxId));
    }
  }

  generateMessageId(): string {
    const domains = [
      'mail.example.com', 'correspondence.net', 'messages.local',
      'outboundmail.com', 'post.delivery', 'mail-transfer.net',
      'relaypost.org', 'dispatchmail.net',
    ];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    return `<${randomUUID()}@${domain}>`;
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

export const threadManager = new ThreadManager();
