// @ts-nocheck
/**
 * seed-test-leads.ts
 *
 * Fast seeder: inserts N test leads for development/QA.
 * Uses @example.com addresses — no real emails, no real people.
 *
 * Usage:
 *   npx tsx scripts/seed-test-leads.ts --count 50 --userId <your-user-id>
 *   npx tsx scripts/seed-test-leads.ts --count 20 --domain yourtest.com --userId <id>
 *   npx tsx scripts/seed-test-leads.ts --clear --userId <your-user-id>
 */

import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const COUNT = parseInt(getArg('--count') || '25', 10);
const DOMAIN = getArg('--domain') || 'example.com';
const USER_ID = getArg('--userId');
const CLEAR = args.includes('--clear');

if (!USER_ID) { console.error('-- --userId is required'); process.exit(1); }

const FIRST = ['James','Maria','David','Sarah','Michael','Emma','Chris','Lisa','Robert','Angela','Kevin','Jennifer','Brian','Jessica','Eric','Amanda','Jason','Nicole','Steven','Stephanie'];
const LAST  = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Martinez','Anderson','Taylor','Thomas','Moore','Jackson','White','Harris','Clark','Lewis','Robinson'];
const COS   = ['Apex Digital','BlueSky Solutions','Vertex Systems','Nova Tech','Solaris Group','Pinnacle Partners','Horizon Media','Summit Analytics','Cascade Consulting','Orbit Software'];
const IND   = ['SaaS','E-commerce','Real Estate','Healthcare','Finance','Consulting','Marketing','Logistics'];

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function generateLeads(userId, count, domain) {
  const seen = new Set(); const result = [];
  for (let i = 0; i < count; i++) {
    const fn = rand(FIRST), ln = rand(LAST);
    let email = fn.toLowerCase() + '.' + ln.toLowerCase() + i + '@' + domain;
    if (seen.has(email)) email = fn.toLowerCase() + i + '@' + domain;
    seen.add(email);
    result.push({ userId, name: fn+' '+ln, email, company: rand(COS), channel: 'email', status: 'new', aiPaused: false, verified: false, score: Math.floor(Math.random()*40)+50, metadata: JSON.stringify({ industry: rand(IND), seeded: true, seeded_at: new Date().toISOString() }) });
  }
  return result;
}

async function main() {
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.error('DATABASE_URL not set'); process.exit(1); }
  const sql = postgres(cs, { max: 5 });

  if (CLEAR) {
    await sql`DELETE FROM leads WHERE user_id = ${USER_ID} AND (metadata->>'seeded')::boolean = true`;
    console.log('Cleared seeded leads.'); await sql.end(); return;
  }

  console.log(`Seeding ${COUNT} test leads (domain: @${DOMAIN})...`);
  const t = Date.now();
  const rows = generateLeads(USER_ID, COUNT, DOMAIN);
  const CHUNK = 100;
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    for (const r of chunk) {
      await sql`INSERT INTO leads (user_id, name, email, company, channel, status, ai_paused, verified, score, metadata) VALUES (${r.userId}, ${r.name}, ${r.email}, ${r.company}, ${r.channel}, ${r.status}, ${r.aiPaused}, ${r.verified}, ${r.score}, ${r.metadata}::jsonb) ON CONFLICT (email) DO NOTHING`;
    }
    done += chunk.length;
    process.stdout.write('\r  ' + done + '/' + COUNT + ' inserted...');
  }
  console.log('\nDone! ' + COUNT + ' leads in ' + ((Date.now()-t)/1000).toFixed(2) + 's');
  await sql.end();
}
main().catch(e => { console.error('Seeder failed:', e.message); process.exit(1); });
