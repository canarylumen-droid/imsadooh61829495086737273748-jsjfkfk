import 'dotenv/config';
import { db } from '@shared/lib/db/db.js';
import { users, leads, calendarEvents } from '@audnix/shared';
import { handleCalendlyWebhook } from '@services/api-gateway/src/webhooks/calendly-webhook.js';
import { eq } from 'drizzle-orm';

async function test() {
  console.log('Testing Calendly Webhook...');
  
  // 1. Get or create a test user
  const allUsers = await db.select().from(users).limit(1);
  const user = allUsers[0];
  if (!user) {
    console.log('No user found to test with.');
    process.exit(1);
  }

  const testEmail = 'calendly-test-123@example.com';
  
  // 2. Create a test lead for this user
  try {
      await db.insert(leads).values({
        userId: user.id,
        email: testEmail,
        name: 'Test Calendly Lead',
        status: 'contacted',
        channel: 'email'
      });
  } catch (e) {
      // Ignore if it already exists
  }
  
  // We need to make sure attempt 1 or attempt 2 finds the user.
  // We can temporarily set the user's calendlyUserUri if it's missing.
  if (!user.calendlyUserUri) {
    await db.update(users).set({ calendlyUserUri: 'https://api.calendly.com/users/test-user' }).where(eq(users.id, user.id));
  }
  
  // 3. Mock the Express Request and Response
  const req = {
    body: {
      resource: {
        event_type: 'invitee.created'
      },
      payload: {
        invitee: {
          email: testEmail,
          name: 'Test Calendly Lead'
        },
        scheduled_event: {
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + 3600000).toISOString(),
          uri: 'https://api.calendly.com/scheduled_events/test-event-123-' + Date.now(),
          name: 'Discovery Call',
          event_memberships: [
            { user: user.calendlyUserUri || 'https://api.calendly.com/users/test-user' }
          ]
        }
      }
    }
  } as any;
  
  let statusCode = 200;
  let responseData = null;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      responseData = data;
      return res;
    }
  } as any;
  
  console.log('Dispatching webhook...');
  await handleCalendlyWebhook(req, res);
  
  console.log(`Webhook responded with status ${statusCode}`);
  
  // 4. Verify the database state
  const updatedLeads = await db.select().from(leads).where(eq(leads.email, testEmail));
  const updatedLead = updatedLeads[0];
  
  console.log('Updated Lead Status:', updatedLead?.status);
  
  const bookings = await db.select().from(calendarEvents).where(eq(calendarEvents.externalId, req.body.payload.scheduled_event.uri));
  const booking = bookings[0];
  
  console.log('Created Booking:', booking?.id ? 'Success' : 'Missing');
  
  process.exit(0);
}

test().catch(console.error);
