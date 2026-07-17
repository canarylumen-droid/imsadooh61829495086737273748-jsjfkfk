/**
 * Historical Email Backfill
 *
 * Enqueues a 'historical' BullMQ job for every connected email mailbox.
 * All new connections auto-trigger historical sync on first IMAP IDLE connect.
 *
 * Usage on EC2:
 *   cd /home/ubuntu/app && node --import tsx scripts/backfill-historical-emails.ts
 *
 * Requires DATABASE_URL in .env or environment.
 */

// Load .env before anything else touches process.env
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

import pg from 'pg';

async function backfill() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

  const pool = new pg.Pool({ connectionString: dbUrl });
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (i.user_id, i.id) i.user_id, i.id
     FROM integrations i
     WHERE i.provider IN ('custom_email','gmail','outlook')
       AND i.connected = true`
  );
  console.log(`Found ${rows.length} connected email integrations`);

  // Dynamic import ensures dotenv is loaded first for shared lib
  const { emailSyncQueue } = await import(
    resolve(dirname(fileURLToPath(import.meta.url)), '../shared/lib/queues/email-sync-queue.js')
  );

  let enqueued = 0;
  for (const row of rows) {
    const job = await emailSyncQueue.add('historical', {
      type: 'historical',
      userId: row.user_id,
      integrationId: row.id,
      limit: 5000,
    });
    console.log(`[${++enqueued}/${rows.length}] user=${row.user_id} int=${row.id} job=${job.id}`);
  }

  await pool.end();
  console.log(`\n✅ ${enqueued} historical sync jobs enqueued`);
  process.exit(0);
}

backfill().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
