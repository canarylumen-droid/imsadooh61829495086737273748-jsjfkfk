import { db } from '@shared/lib/db/db.js';
import { warmupSeedAccounts, emailTracking } from '@audnix/shared';
import { eq, sql, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';

let mysql: any;

async function getSeedEmail(): Promise<string | null> {
  try {
    const rows = await db.select({ email: warmupSeedAccounts.email })
      .from(warmupSeedAccounts)
      .where(and(
        eq(warmupSeedAccounts.status, 'active'),
        sql`${warmupSeedAccounts.dailySentCount} < ${warmupSeedAccounts.dailyLimit}`
      ))
      .limit(1);
    return rows[0]?.email || null;
  } catch {
    try {
      if (!mysql) mysql = (await import('mysql2/promise')).default;
      const pool = mysql.createPool(process.env.DATABASE_URL || 'mysql://localhost:3306/audnix');
      const [rows] = await pool.query(
        `SELECT email FROM warmup_seed_accounts WHERE status = 'active' AND daily_sent_count < daily_limit LIMIT 1`
      );
      await pool.end();
      return (rows as any[])[0]?.email || null;
    } catch {
      return null;
    }
  }
}

export async function sendPlacementTestEmail(
  userId: string,
  integrationId: string,
  recipientEmail?: string
): Promise<void> {
  try {
    const seedEmail = recipientEmail || await getSeedEmail();
    if (!seedEmail) {
      console.log(`[PlacementTest] No seed available for placement test (integration ${integrationId})`);
      return;
    }

    const testId = randomUUID();
    const subject = `Placement Test ${testId.slice(0, 8)}`;
    const body = `This is an automated placement test from Audnix.\nTest ID: ${testId}\nSent at: ${new Date().toISOString()}`;

    const { sendEmail } = await import('./email.js');
    const result = await sendEmail(userId, seedEmail, body, subject, {
      integrationId,
      trackingId: testId,
      isTest: true,
    });

    console.log(`[PlacementTest] Test email sent from ${integrationId} to ${seedEmail} (tracking=${testId})`);

    try {
      await db.insert(emailTracking).values({
        id: testId,
        userId,
        integrationId,
        recipientEmail: seedEmail,
        subject,
        messageId: result.messageId,
        token: testId,
        placement: 'unknown',
        sentAt: new Date(),
        metadata: { type: 'placement_test', testId },
      } as any);
    } catch (err: any) {
      console.warn(`[PlacementTest] Failed to create tracking record: ${err.message}`);
    }
  } catch (err: any) {
    console.warn(`[PlacementTest] Failed for integration ${integrationId}: ${err.message}`);
  }
}
