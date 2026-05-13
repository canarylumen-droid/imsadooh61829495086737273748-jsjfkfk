import crypto from 'crypto';
import fetch from 'node-fetch';
import 'dotenv/config';

async function testFathomWebhook() {
  const secret = process.env.FATHOM_WEBHOOK_SECRET || 'test-secret';
  const url = 'http://localhost:5000/api/webhook/fathom';
  
  const payload = {
    event: 'meeting.finished',
    data: {
      id: 'mock-meeting-123',
      title: 'Test Meeting',
      attendees: [{ name: 'Test User', email: 'test@example.com' }]
    }
  };
  
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
  
  console.log('--- Sending Webhook with VALID signature ---');
  const res1 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-fathom-signature': signature
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
      'x-fathom-signature': 'bad-sig'
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
}

testFathomWebhook().catch(console.error);
