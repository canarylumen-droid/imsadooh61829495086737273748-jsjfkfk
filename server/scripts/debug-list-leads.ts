import 'dotenv/config';
import { storage } from '@shared/lib/storage/storage.js';

async function listLeads() {
  try {
    const users = await storage.getUsers();
    if (users.length === 0) {
      console.log('No users found.');
      return;
    }
    
    for (const user of users) {
      console.log(`User: ${user.username} (${user.id})`);
      const leads = await storage.getLeads({ userId: user.id });
      console.log(`Leads: ${leads.length}`);
      leads.forEach(l => {
        console.log(` - [${l.id}] ${l.name} (${l.status}) - Score: ${l.score}`);
      });
    }
    process.exit(0);
  } catch (error) {
    console.error('Error listing leads:', error);
    process.exit(1);
  }
}

listLeads();
