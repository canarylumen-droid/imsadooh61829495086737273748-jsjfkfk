import pg from 'pg';
const { Client } = pg;

async function main() {
  const conn = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!conn) { console.error('No DATABASE_URL'); process.exit(1); }
  const c = new Client({ connectionString: conn });
  await c.connect();

  const { rows: tables } = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
  console.log('Tables (' + tables.length + '):');
  for (const r of tables) console.log('  - ' + r.table_name);

  if (tables.find(t => t.table_name === 'leads')) {
    const { rows: cols } = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND table_schema='public' ORDER BY ordinal_position");
    console.log('\nLeads columns (' + cols.length + '):');
    for (const r of cols) console.log('  - ' + r.column_name);

    const { rows: indexes } = await c.query("SELECT indexname FROM pg_indexes WHERE tablename='leads' AND schemaname='public' ORDER BY indexname");
    console.log('\nLeads indexes (' + indexes.length + '):');
    for (const r of indexes) console.log('  - ' + r.indexname);
  }

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
