import 'dotenv/config';
import { storage } from '@shared/lib/storage/storage.js';

async function listAll() {
  try {
    const users = await storage.getUsers();
    console.log(`Users: ${users.length}`);
    for (const user of users) {
      const leads = await storage.getLeads({ userId: user.id });
      console.log(`User: ${user.username} (${user.id}) - Leads: ${leads.length}`);
      for (const lead of leads) {
        console.log(`  - Lead: ${lead.name} (${lead.status}) Score: ${lead.score}`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

listAll();
