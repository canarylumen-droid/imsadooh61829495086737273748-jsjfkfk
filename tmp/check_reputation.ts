
import { db } from './server/db.js';
import { integrations } from './shared/schema.js';
import { eq, sql } from 'drizzle-orm';

async function checkReputation() {
  try {
    const results = await db.select({
      id: integrations.id,
      provider: integrations.provider,
      reputationScore: integrations.reputationScore,
      warmupStatus: integrations.warmupStatus,
      dailyLimit: integrations.dailyLimit,
      email: sql`encrypted_meta->>'user'` // Optional if email is in meta
    })
    .from(integrations)
    .where(eq(integrations.connected, true));

    console.log('--- Mailbox Reputation Report ---');
    if (results.length === 0) {
      console.log('No connected mailboxes found.');
    } else {
      results.forEach(m => {
        const score = m.reputationScore ?? null;
        const displayScore = score !== null ? score : 'Unscored';
        let status = score !== null ? 'Excellent 🟢' : 'Unknown ⚪';
        if (score !== null && score < 40) status = 'Critical 🔴 (Paused)';
        else if (score !== null && score < 70) status = 'Warning 🟠 (Throttled)';
        
        console.log(`- Provider: ${m.provider}`);
        console.log(`  Score: ${displayScore}${score !== null ? '/100' : ''}`);
        console.log(`  Status: ${status}`);
        console.log(`  Daily Limit: ${m.dailyLimit}`);
        console.log('----------------------------');
      });
    }
  } catch (error) {
    console.error('Error checking reputation:', error);
  } finally {
    process.exit(0);
  }
}

checkReputation();
