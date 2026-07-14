// @ts-nocheck
import 'dotenv/config';
import { GmailOAuth } from '@services/api-gateway/src/oauth/gmail.js';
import { OutlookOAuth } from '../server/lib/oauth/outlook.ts';
import { db } from '@shared/lib/db/db.js';
import { oauthAccounts, users } from '../shared/schema.js';
import { eq, and } from 'drizzle-orm';

// Enable MOCK_OAUTH for this process
process.env.MOCK_OAUTH = 'true';

async function testOAuthMock() {
  console.log('🚀 Starting OAuth Mock Verification...\n');

  // 1. Setup - Find a test user
  const [testUser] = await db.select().from(users).limit(1);
  if (!testUser) {
    console.error('❌ No user found for testing.');
    process.exit(1);
  }
  const userId = testUser.id;
  console.log(`👤 Using user: ${testUser.email}`);

  // --- GMAIL TEST ---
  console.log('\n📧 Testing Gmail OAuth (Mock)...');
  const gmail = new GmailOAuth();
  
  // A. Exchange Code
  const gmailTokens = await gmail.exchangeCodeForToken('mock-code');
  console.log('✅ Google token exchange mocked.');

  // B. Get Profile
  const gmailProfile = await gmail.getUserProfile(gmailTokens.access_token);
  console.log(`✅ Google profile mocked: ${gmailProfile.email}`);

  // C. Save Token (Real logic, testing encryption/DB)
  await gmail.saveToken(userId, gmailTokens, gmailProfile);
  console.log('✅ Gmail token saved to DB (encrypted).');

  // D. Refresh Token
  const refreshedGmailToken = await gmail.getValidToken(userId, gmailProfile.email);
  if (refreshedGmailToken === 'mock-google-refreshed-access-token') {
    console.log('✅ Gmail token refresh logic verified.');
  } else {
    console.error(`❌ Gmail refresh FAILED. Got: ${refreshedGmailToken}`);
  }

  // --- OUTLOOK TEST ---
  console.log('\n📧 Testing Outlook OAuth (Mock)...');
  const outlook = new OutlookOAuth();

  // A. Exchange Code
  const outlookTokens = await outlook.exchangeCodeForToken('mock-code');
  console.log('✅ Outlook token exchange mocked.');

  // B. Get Profile
  const outlookProfile = await outlook.getUserProfile(outlookTokens.access_token);
  console.log(`✅ Outlook profile mocked: ${outlookProfile.mail}`);

  // C. Refresh Token (Mocking the storage interaction)
  // (Note: Outlook uses a slightly different storage pattern in the provider, testing refresh specifically)
  const refreshedOutlookToken = await outlook.refreshAccessToken(outlookTokens.refresh_token!);
  if (refreshedOutlookToken.access_token === 'mock-outlook-refreshed-access-token') {
    console.log('✅ Outlook token refresh logic verified.');
  } else {
    console.error(`❌ Outlook refresh FAILED. Got: ${refreshedOutlookToken.access_token}`);
  }

  // --- CLEANUP ---
  console.log('\n🧹 Cleaning up mock accounts...');
  await db.delete(oauthAccounts).where(and(
    eq(oauthAccounts.userId, userId),
    eq(oauthAccounts.accessToken, 'encrypted_mock-google-access-token') // This won't match exactly due to random salt in encrypt()
  ));
  // Better cleanup: delete by providerAccountId
  await db.delete(oauthAccounts).where(and(
    eq(oauthAccounts.userId, userId),
    eq(oauthAccounts.providerAccountId, gmailProfile.email)
  ));
  console.log('✅ Mock Gmail account removed.');

  console.log('\n✨ OAUTH MOCK VERIFICATION COMPLETE ✨');
  process.exit(0);
}

testOAuthMock().catch(err => {
  console.error('❌ OAUTH TEST ERROR:', err);
  process.exit(1);
});
