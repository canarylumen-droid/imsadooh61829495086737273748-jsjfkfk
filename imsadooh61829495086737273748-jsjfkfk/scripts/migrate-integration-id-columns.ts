/**
 * Migration: Add integration_id columns to campaign_emails and follow_up_queue
 *
 * Adds:
 * - campaign_emails.integration_id (uuid, FK → integrations, ON DELETE SET NULL)
 * - follow_up_queue.integration_id (uuid, FK → integrations, ON DELETE SET NULL)
 * - Indexes for reputation monitor and fleet auditor queries
 *
 * Backfills existing rows from metadata JSONB / joined campaign_leads.
 */

import 'dotenv/config';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

async function runMigration() {
  console.log('🔧 Running integration_id column migration...');

  try {
    // ── 1. campaign_emails ──────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE campaign_emails
      ADD COLUMN IF NOT EXISTS integration_id UUID
      REFERENCES integrations(id) ON DELETE SET NULL
    `);
    console.log('✅ Added integration_id to campaign_emails');

    // Backfill from metadata JSONB (existing pattern in codebase)
    const ceBackfill = await db.execute(sql`
      UPDATE campaign_emails
      SET integration_id = (metadata->>'integrationId')::uuid
      WHERE integration_id IS NULL
        AND metadata->>'integrationId' IS NOT NULL
    `);
    console.log(`✅ Backfilled ${ceBackfill.rowCount || 0} campaign_emails rows`);

    // Create index
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS ce_integration_status_sent_at_idx
      ON campaign_emails (integration_id, status, sent_at)
    `);
    console.log('✅ Created ce_integration_status_sent_at_idx');

    // ── 2. follow_up_queue ──────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE follow_up_queue
      ADD COLUMN IF NOT EXISTS integration_id UUID
      REFERENCES integrations(id) ON DELETE SET NULL
    `);
    console.log('✅ Added integration_id to follow_up_queue');

    // Backfill from campaign_leads via lead_id join
    const fuBackfill = await db.execute(sql`
      UPDATE follow_up_queue fuq
      SET integration_id = cl.integration_id
      FROM campaign_leads cl
      WHERE fuq.integration_id IS NULL
        AND fuq.lead_id = cl.lead_id
        AND cl.integration_id IS NOT NULL
    `);
    console.log(`✅ Backfilled ${fuBackfill.rowCount || 0} follow_up_queue rows`);

    // Create index
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS follow_up_integration_status_idx
      ON follow_up_queue (integration_id, status)
    `);
    console.log('✅ Created follow_up_integration_status_idx');

    // ── 3. Verify ───────────────────────────────────────────────────────────
    const ceCols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'campaign_emails'
      AND column_name = 'integration_id'
    `);
    const fuCols = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'follow_up_queue'
      AND column_name = 'integration_id'
    `);
    console.log(`✅ Verified: campaign_emails.integration_id = ${ceCols.rows.length > 0 ? 'EXISTS' : 'MISSING'}`);
    console.log(`✅ Verified: follow_up_queue.integration_id = ${fuCols.rows.length > 0 ? 'EXISTS' : 'MISSING'}`);

    console.log('✅ Migration complete!');
  } catch (error: any) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

runMigration();
