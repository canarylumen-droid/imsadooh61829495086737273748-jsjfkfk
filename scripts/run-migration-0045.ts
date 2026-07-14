import fs from 'fs';
import pg from 'pg';
import 'dotenv/config';

async function forceApplySchema() {
  const fileContent = fs.readFileSync('migrations/0045_even_captain_universe.sql', 'utf8');

  // Skip the existing table/column errors if any pop up, but try to apply everything.
  // Actually, we can just split by "--> statement-breakpoint"
  const statements = fileContent.split('--> statement-breakpoint');

  // Let's use the DB connection manually
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`Connected to Neon database. Running ${statements.length} explicit schema updates...`);

    let successCount = 0;
    for (const stmt of statements) {
      if (!stmt.trim()) continue;
      
      try {
        await client.query(stmt);
        successCount++;
        // console.log('Successfully executed:', stmt.substring(0, 50).trim() + '...');
      } catch (e: any) {
        // Many might fail with 'relation already exists' or 'column already exists', which is OK!
        const isAlreadyExists = e.code === '42P07' || e.code === '42710' || e.message?.includes('already exists') || e.code === '42701';
        if (isAlreadyExists) {
            // Safe to ignore
        } else {
             // Let's log but continue so we get AS MUCH of the schema synced as possible
             console.error('Migration chunk failed. Code:', e.code, e.message);
        }
      }
    }
    
    console.log(`✅ Finished applying schema diff! ${successCount}/${statements.length} applied successfully.`);
  } catch (err) {
    console.error('Fatal connection error:', err);
  } finally {
    await client.end();
  }
}

forceApplySchema();
