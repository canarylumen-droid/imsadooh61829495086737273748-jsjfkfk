import { config } from 'dotenv';
config();
import { db } from '@shared/lib/db/db.js';
import { leads, users, bounceTracker } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { BounceMonitor } from '@services/email-service/src/email/bounce-monitor.js';

async function runTest() {
  console.log('🧪 Starting End-to-End Bounce Verification Test...');

  // Create mock user
  const [user] = await db.insert(users).values({
    email: `test-bounce-${Date.now()}@example.com`,
    password: 'mockpassword',
    company: 'Bounce Tester Inc',
  }).returning();

  // Create mock lead
  const targetEmail = `bouncing-lead-${Date.now()}@example.com`;
  const [lead] = await db.insert(leads).values({
    userId: user.id,
    name: 'Bouncy Lead',
    channel: 'email',
    email: targetEmail,
    status: 'pending',
  }).returning();

  console.log(`✅ Created mock lead: ${targetEmail} (Status: ${lead.status})`);

  // Simulate a raw bounce email from a mailer daemon
  const rawBounceEmail = `
Return-Path: <>
Delivered-To: postmaster@audnix.com
Received: from mail-sor-f41.google.com
From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
To: test-sender@audnix.com
Subject: Delivery Status Notification (Failure)
Date: Wed, 01 May 2026 12:00:00 +0000

The response from the remote server was:
550 5.1.1 The email account that you tried to reach does not exist.

----- Original message -----
X-Original-To: ${targetEmail}
To: ${targetEmail}
Subject: Following up on your inquiry
`;

  console.log('🤖 Simulating IMAP push to BounceMonitor...');
  
  const monitor = new BounceMonitor();
  
  // We use a mock buffer
  const mailBuffer = Buffer.from(rawBounceEmail);
  
  // Expose the processMessage method directly for testing if private
  // If private, we can cast to any
  await (monitor as any).processMessage(mailBuffer);

  // Check the leads table
  const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
  
  console.log(`\n📊 Lead Status after bounce: ${updatedLead.status}`);
  if (updatedLead.status === 'bouncy') {
    console.log('✅ Lead successfully marked as bouncy!');
  } else {
    console.warn('⚠️ Lead status was not updated to bouncy.');
  }

  // Check bounce tracker
  const trackers = await db.select().from(bounceTracker).where(eq(bounceTracker.leadId, lead.id));
  
  if (trackers.length > 0) {
    console.log(`✅ Bounce Tracker record created: Type = ${trackers[0].bounceType}, Category = ${trackers[0].bounceCategory}`);
  } else {
    console.warn('⚠️ No Bounce Tracker record found.');
  }

  console.log('\n🏁 Test complete.');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
