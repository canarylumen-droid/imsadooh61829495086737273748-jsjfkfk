import { GmailOAuth } from '@services/api-gateway/src/oauth/gmail.js';
import dotenv from 'dotenv';
dotenv.config();

process.env.GOOGLE_CLIENT_ID = 'test-google-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
delete process.env.GMAIL_CLIENT_ID;
delete process.env.GMAIL_CLIENT_SECRET;

console.log('Testing GmailOAuth constructor with fallback...');
const gmail = new GmailOAuth();
console.log('Config:', (gmail as any).config);

if ((gmail as any).config.clientId === 'test-google-id' && (gmail as any).config.clientSecret === 'test-google-secret') {
  console.log('✅ Fallback successful');
} else {
  console.error('❌ Fallback failed');
}
