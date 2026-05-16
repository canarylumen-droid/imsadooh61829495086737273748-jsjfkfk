import 'dotenv/config';
import { db } from './shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

async function test() {
  try {
    const result = await db.execute(sql`SELECT 1 as one`);
    console.log('Result:', result.rows);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
