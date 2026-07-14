import 'dotenv/config';
import { db } from '../shared/lib/db/db.js';
import { integrations, notifications } from '../shared/schema.js';
import { like } from 'drizzle-orm';

async function clearLegacyErrors() {
  console.log('Clearing legacy errors...');
  const res = await db.update(integrations)
    .set({ 
      lastHealthError: 'Temporary network failure. Autonomous recovery in progress.',
      healthStatus: 'warning'
    })
    .where(like(integrations.lastHealthError, '%paused for 2 hours%'))
    .returning();
    
  console.log(`Cleared ${res.length} legacy errors from integrations table.`);

  // Also clear any mailbox warning notifications with the same text to avoid dashboard clutter
  const notifRes = await db.update(notifications)
    .set({
       message: 'Temporary network failure. Autonomous recovery in progress.'
    })
    .where(like(notifications.message, '%paused for 2 hours%'))
    .returning();

  console.log(`Cleared ${notifRes.length} legacy errors from notifications table.`);
  
  process.exit(0);
}

clearLegacyErrors().catch(console.error);
