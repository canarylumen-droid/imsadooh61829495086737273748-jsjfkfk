import 'dotenv/config';
import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function check() {
  console.log('--- Table: users ---');
  const res1 = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'`);
  console.log(JSON.stringify(res1.rows, null, 2));

  console.log('\n--- Table: onboarding_profiles ---');
  const res2 = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'onboarding_profiles'`);
  console.log(JSON.stringify(res2.rows, null, 2));
}

check().catch(console.error);
