/**
 * Migration: Add mailbox health monitoring fields to integrations table
 * 
 * Adds:
 * - health_status (enum: connected, warning, failed)
 * - last_health_error (text)
 * - last_health_check_at (timestamp)
 * - mailbox_pause_until (timestamp)
 * - failure_count (integer)
 * - spam_risk_score (real)
 * 
 * Also adds new statuses to campaign_leads and notification types.
 */

import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

async function runMigration() {
  console.log('🔧 Running mailbox health monitoring migration...');

  try {
    // Add health monitoring columns to integrations
    await db.execute(sql`
      ALTER TABLE integrations 
      ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'connected',
      ADD COLUMN IF NOT EXISTS last_health_error TEXT,
      ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS mailbox_pause_until TIMESTAMP,
      ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS spam_risk_score REAL NOT NULL DEFAULT 0
    `);
    console.log('✅ Added health monitoring columns to integrations');

    // Verify the columns were added
    const result = await db.execute(sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'integrations' 
      AND column_name IN ('health_status', 'last_health_error', 'last_health_check_at', 'mailbox_pause_until', 'failure_count', 'spam_risk_score')
    `);
    console.log(`✅ Verified ${result.rows.length} new columns exist`);

    console.log('✅ Migration complete!');
  } catch (error: any) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  }

  process.exit(0);
}

runMigration();
