import 'dotenv/config';
import { storage } from '@shared/lib/storage/storage.js';
import { nanoid } from 'nanoid';

async function setup() {
  try {
    console.log('🚀 Setting up test data for AI verification...');
    
    // 1. Create a test user
    const username = `testuser_${nanoid(5)}`;
    const user = await storage.createUser({
      username,
      email: `${username}@example.com`,
      password: 'password123'
    });
    console.log(`✅ Created user: ${user.username} (${user.id})`);

    // 2. Create a test lead
    const lead = await storage.createLead({
      userId: user.id,
      name: 'John Doe',
      email: 'john@example.com',
      channel: 'email',
      status: 'new',
      metadata: {
        company: 'Doe Inc',
        industry: 'Tech'
      }
    });
    console.log(`✅ Created lead: ${lead.id}`);

    // 3. Mock some intelligence data (predictions) to verify pipeline value
    await storage.updateLead(lead.id, {
      metadata: {
        ...lead.metadata,
        intelligence: {
          predictions: {
            predictedAmount: 5000,
            confidence: 85
          },
          intent: {
            intentLevel: 'high',
            intentScore: 90
          }
        }
      }
    });
    console.log(`✅ Seeded intelligence metadata for lead: ${lead.id}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

setup();
