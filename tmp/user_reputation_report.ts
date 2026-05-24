
import { db } from './server/db.js';
import { integrations, users } from './shared/schema.js';
import { eq, sql, desc } from 'drizzle-orm';

async function getReputationInfo() {
  try {
    // 1. Get the most recently active user (assuming this is the one we want)
    const activeUsers = await db.select().from(users).orderBy(desc(users.id)).limit(1);
    if (activeUsers.length === 0) {
      console.log('No users found in database.');
      return;
    }
    const user = activeUsers[0];
    console.log(`Checking reputation for user: ${user.email} (ID: ${user.id})`);

    // 2. Get their connected integrations
    const mailboxes = await db.select({
      id: integrations.id,
      provider: integrations.provider,
      reputationScore: integrations.reputationScore,
      warmupStatus: integrations.warmupStatus,
      dailyLimit: integrations.dailyLimit,
      email: sql`encrypted_meta->>'user'`
    })
    .from(integrations)
    .where(eq(integrations.userId, user.id));

    console.log('\n--- Domain Reputation Report ---');
    if (mailboxes.length === 0) {
      console.log('No mailboxes connected for this user.');
    } else {
      mailboxes.forEach(m => {
        const score = m.reputationScore ?? null;
        let healthColor = '⚪ Unknown';
        let recommendation = 'Reputation has not been calculated yet. Monitor sends carefully.';
        
        if (score !== null) {
          healthColor = '🟢 Excellent';
          recommendation = 'Keep sending at current volume.';
          
          if (score < 40) {
            healthColor = '🔴 Critical';
            recommendation = 'IMMEDIATE ACTION REQUIRED: Pause outreach and start a 14-day warmup cycle at low volume (5-10 emails/day).';
          } else if (score < 70) {
            healthColor = '🟠 Caution';
            recommendation = 'ACTION ADVISED: Reduce sending volume by 50% and monitor bounce rates closely for the next 72 hours.';
          } else if (score < 90) {
            healthColor = '🟡 Good';
            recommendation = 'Maintain volume but avoid dramatic spikes in daily send limits.';
          }
        }

        console.log(`- Mailbox: ${m.email || m.provider} (${m.id})`);
        console.log(`  Health: ${healthColor}`);
        console.log(`  Score: ${score !== null ? score + '/100' : 'Unscored'}`);
        console.log(`  Status: ${m.warmupStatus || 'active'}`);
        console.log(`  Daily Limit: ${m.dailyLimit}`);
        console.log(`  Recommendation: ${recommendation}`);
        console.log('----------------------------');
      });
    }
  } catch (error) {
    console.error('Error fetching reputation info:', error);
  } finally {
    process.exit(0);
  }
}

getReputationInfo();
