import { db } from '@shared/lib/db/db.js';
import { users, otpCodes, onboardingProfiles } from '../shared/schema.js';
import { eq, sql, and, like, isNull, or, lt } from 'drizzle-orm';

async function resetLimboUsers() {
  console.log('🔄 Starting limbo user reset process...\n');
  
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const limboUsers = await db
      .select()
      .from(users)
      .where(or(
        sql`${users.username} ~ '\\d{13}$'`,
        and(
          isNull(users.password),
          eq(users.plan, 'trial')
        ),
        and(
          eq(users.plan, 'trial'),
          lt(users.createdAt, twentyFourHoursAgo),
          sql`NOT EXISTS (
            SELECT 1 FROM onboarding_profiles op 
            WHERE op.user_id = ${users.id} AND op.completed = true
          )`
        )
      ));
    
    console.log(`📊 Found ${limboUsers.length} users in limbo state:\n`);
    
    for (const user of limboUsers) {
      console.log(`  - ${user.email} (username: ${user.username}, created: ${user.createdAt})`);
    }
    
    if (limboUsers.length === 0) {
      console.log('✅ No users in limbo state found!');
      return { success: true, usersReset: 0 };
    }
    
    console.log('\n🗑️  Cleaning up limbo users...\n');
    
    let deletedCount = 0;
    
    for (const user of limboUsers) {
      try {
        await db.delete(onboardingProfiles).where(eq(onboardingProfiles.userId, user.id));
        console.log(`  ✓ Deleted onboarding profile for ${user.email}`);
      } catch (err) {
      }
      
      await db.delete(users).where(eq(users.id, user.id));
      console.log(`  ✓ Deleted user: ${user.email}`);
      deletedCount++;
    }
    
    console.log(`\n🧹 Cleaning up expired OTP codes...`);
    
    const expiredOtps = await db
      .delete(otpCodes)
      .where(lt(otpCodes.expiresAt, now))
      .returning();
    
    console.log(`  ✓ Deleted ${expiredOtps.length} expired OTP codes`);
    
    console.log('\n✅ Limbo user reset complete!');
    console.log(`   - Users deleted: ${deletedCount}`);
    console.log(`   - Expired OTPs cleaned: ${expiredOtps.length}`);
    
    return {
      success: true,
      usersReset: deletedCount,
      otpsCleaned: expiredOtps.length
    };
    
  } catch (error) {
    console.error('❌ Error during limbo user reset:', error);
    return { success: false, error: String(error) };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetLimboUsers()
    .then(result => {
      console.log('\n📋 Final result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

export { resetLimboUsers };
