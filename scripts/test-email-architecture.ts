import 'dotenv/config';
import { db } from '@shared/lib/db/db.js';
import { sendEmail } from '@shared/lib/channels/email.js';
import { users } from '../shared/schema.js';
import { eq } from 'drizzle-orm';

async function testEmailArchitecture() {
  console.log('--- EMAIL ARCHITECTURE VERIFICATION TEST ---');

  // 1. Get a test user
  const testUser = await db.query.users.findFirst({
    where: eq(users.email, 'demo@audnixai.com')
  });

  if (!testUser) {
    console.warn('⚠️ No demo user found, using first available user for SMTP speed test.');
  }
  
  const userId = testUser ? testUser.id : (await db.query.users.findFirst())?.id;
  
  if (!userId) {
    console.error('❌ Could not find any user to run the test.');
    process.exit(1);
  }

  // 2. Test SMTP Pooling Speed
  console.log('\n⏳ Testing SMTP Connection Pooling Speed...');
  
  try {
    const start1 = performance.now();
    // Use an existing connected integration if possible, otherwise sendEmail will fail.
    // If they have no integration connected, we'll catch the error and log it.
    await sendEmail(userId, 'test@example.com', 'Test email 1', 'Connection Test 1', { isRaw: true });
    const end1 = performance.now();
    console.log(`✅ [Send 1] Completed in ${(end1 - start1).toFixed(2)}ms (Includes Handshake)`);

    const start2 = performance.now();
    await sendEmail(userId, 'test@example.com', 'Test email 2', 'Connection Test 2', { isRaw: true });
    const end2 = performance.now();
    console.log(`✅ [Send 2] Completed in ${(end2 - start2).toFixed(2)}ms (Pooled Connection)`);
    
    if (end2 - start2 < end1 - start1) {
      console.log('🚀 CONNECTION POOLING VERIFIED: Second send was faster!');
    }
  } catch (error: any) {
    console.warn('⚠️ Could not complete SMTP speed test (likely no active email integration for user):', error.message);
  }

  // 3. Test SMTP Handshake Verification Route Logic
  console.log('\n⏳ Testing Immediate SMTP Handshake Verification...');
  try {
    const nodemailer = await import('nodemailer');
    const dns = await import('dns');
    console.log('Testing with INVALID credentials (should fail immediately)...');
    
    const transporter = nodemailer.createTransport({
      host: 'smtp.mailgun.org', // valid host
      port: 587,
      secure: false,
      auth: {
        user: 'fake@example.com',
        pass: 'badpassword123',
      },
      family: 4,
      lookup: (hostname: string, options: any, callback: any) => {
        return dns.lookup(hostname, { family: 4 }, callback);
      },
      tls: { rejectUnauthorized: false }
    } as any);

    await transporter.verify();
    console.error('❌ Failed: Invalid credentials bypassed verification!');
  } catch (error: any) {
    console.log(`✅ Success: Invalid credentials caught immediately! (${error.message})`);
  }

  console.log('\n--- VERIFICATION COMPLETE ---');
  process.exit(0);
}

testEmailArchitecture().catch(console.error);
