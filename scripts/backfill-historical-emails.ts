/**
 * Historical Email Backfill
 *
 * For ALL connected mailboxes, triggers a full IMAP sync of past emails
 * (up to 5000 per mailbox) so existing users see their full conversation
 * history in the inbox.
 *
 * Usage:
 *   npx tsx scripts/backfill-historical-emails.ts
 *
 * This script should be run ONCE on EC2 after deploying the Jul 17 changes.
 * It will:
 *   1. Find all connected IMAP integrations
 *   2. Enqueue a 'historical' job for each one via BullMQ
 *   3. Log progress as each mailbox syncs
 *
 * New connections going forward will auto-trigger historical sync
 * on first IMAP IDLE connect (5 min discovery cycle).
 */
import { storage } from '@shared/lib/storage/storage.js';
import { emailSyncQueue } from '@shared/lib/queues/email-sync-queue.js';

async function backfillAllUsers() {
  const users = await storage.getAllUsers?.() || [];
  console.log(`Found ${users.length} users`);

  let totalEnqueued = 0;
  for (const user of users) {
    const integrations = await storage.getIntegrations(user.id);
    const emailInts = integrations.filter((i: any) =>
      ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected
    );

    for (const int of emailInts) {
      const job = await emailSyncQueue.add('historical', {
        type: 'historical',
        userId: user.id,
        integrationId: int.id,
        limit: 5000,
      });
      console.log(`[Backfill] Enqueued historical sync for user ${user.id} / ${int.provider}:${int.id} (job ${job.id})`);
      totalEnqueued++;
    }
  }
  console.log(`\n✅ Done. ${totalEnqueued} historical sync jobs enqueued.`);
  process.exit(0);
}

backfillAllUsers().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
