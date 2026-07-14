/**
 * Watchdog
 * 15s IMAP timeout wrapper + hung-job requeue logic.
 */

import { db } from '../db/warmup-db.js';
import { eq, sql } from 'drizzle-orm';
import { warmupMailboxes } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';

const MAX_IMAP_FAILURES_BEFORE_PAUSE = 3;

export async function withImapTimeout<T>(
  fn: () => Promise<T>,
  mailboxId: string,
  context: string
): Promise<T | null> {
  return Promise.race([
    fn(),
    new Promise<null>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `IMAP timeout: ${context} exceeded ${WARMUP_CONFIG.IMAP_TIMEOUT_MS}ms`
            )
          ),
        WARMUP_CONFIG.IMAP_TIMEOUT_MS
      )
    ),
  ]).catch(async (err: any) => {
    console.error(
      `[Warmup][Watchdog] Mailbox ${mailboxId} ${context} failed:`,
      err.message
    );

    // 3-strike policy: increment failure count in metadata, only pause after
    // repeated failures. This avoids pausing a mailbox for a single transient
    // network blip while still protecting against persistent broken connections.
    const mb = await db
      .select({ metadata: warmupMailboxes.metadata })
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, mailboxId))
      .limit(1);

    if (mb[0]) {
      const meta = (mb[0].metadata || {}) as any;
      const failures = (meta.imapFailureCount || 0) + 1;

      if (failures >= MAX_IMAP_FAILURES_BEFORE_PAUSE) {
        await db
          .update(warmupMailboxes)
          .set({
            status: 'paused',
            pauseReason: 'imap_error',
            metadata: sql`${warmupMailboxes.metadata} || ${JSON.stringify({ imapFailureCount: failures, lastImapError: err.message, lastImapErrorAt: new Date().toISOString() })}`,
            updatedAt: new Date(),
          })
          .where(eq(warmupMailboxes.id, mailboxId));
        console.warn(
          `[Warmup][Watchdog] Mailbox ${mailboxId} paused after ${failures} consecutive IMAP failures.`
        );
      } else {
        await db
          .update(warmupMailboxes)
          .set({
            metadata: sql`${warmupMailboxes.metadata} || ${JSON.stringify({ imapFailureCount: failures, lastImapError: err.message, lastImapErrorAt: new Date().toISOString() })}`,
            updatedAt: new Date(),
          })
          .where(eq(warmupMailboxes.id, mailboxId));
        console.warn(
          `[Warmup][Watchdog] Mailbox ${mailboxId} IMAP failure ${failures}/${MAX_IMAP_FAILURES_BEFORE_PAUSE} — not pausing yet.`
        );
      }
    }

    return null;
  }) as Promise<T | null>;
}
