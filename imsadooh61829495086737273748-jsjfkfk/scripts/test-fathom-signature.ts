import crypto from 'crypto';
import fetch from 'node-fetch';
import 'dotenv/config';

async function testFathomWebhook() {
  const secret = process.env.FATHOM_WEBHOOK_SECRET || 'whsec_test';
  const url = 'http://localhost:5000/api/webhook/fathom';
  
  const payload = {
    event: 'meeting.finished',
    data: {
      recording_id: 'mock-meeting-123',
      id: 'mock-meeting-123',
      title: 'Test Meeting',
      attendees: [{ name: 'Test User', email: 'test@example.com' }]
    }
  };
  
  const body = JSON.stringify(payload);
  const webhookId = crypto.randomBytes(16).toString('hex');
  const webhookTimestamp = Math.floor(Date.now() / 1000).toString();
  
  // Fathom uses Base64-encoded secret after whsec_ prefix
  const secretBytes = Buffer.from(secret.split('_')[1], 'base64');
  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;
  const signature = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  
  console.log('--- Sending Webhook with VALID signature (Fathom format) ---');
  const res1 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': `v1,${signature}`
    },
    body
  });
  console.log('Status:', res1.status);
  const data1 = await res1.json();
  console.log('Response:', data1);
  
  console.log('\n--- Sending Webhook with INVALID signature ---');
  const res2 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': 'v1,badsignature'
    },
    body
  });
  console.log('Status:', res2.status);
  try {
    const data2 = await res2.json();
    console.log('Response:', data2);
  } catch (e) {
    console.log('Response (text):', await res2.text());
  }
  
  console.log('\n--- Sending Webhook with STALE timestamp (replay attack test) ---');
  const staleTimestamp = Math.floor((Date.now() - 600000) / 1000).toString(); // 10 minutes ago
  const res3 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': staleTimestamp,
      'webhook-signature': `v1,${signature}`
    },
    body
  });
  console.log('Status:', res3.status);
  try {
    const data3 = await res3.json();
    console.log('Response:', data3);
  } catch (e) {
    console.log('Response (text):', await res3.text());
  }
}

testFathomWebhook().catch(console.error);
