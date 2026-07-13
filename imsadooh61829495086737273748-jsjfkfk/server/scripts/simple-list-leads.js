import pg from 'pg';

async function listLeads() {
  const connectionString = "postgresql://neondb_owner:npg_y1WCRm9QsVJh@ep-wispy-frost-ahj6lqe0-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";
  const client = new pg.Client({ connectionString });
  
  try {
    await client.connect();
    console.log('✅ Connected to database');
    const res = await client.query('SELECT id, name, status, score, metadata FROM leads LIMIT 20;');
    console.log(`Leads: ${res.rows.length}`);
    res.rows.forEach(l => {
      console.log(` - [${l.id}] ${l.name} (${l.status}) - Score: ${l.score}`);
    });
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('Error listing leads:', error);
    process.exit(1);
  }
}

listLeads();
