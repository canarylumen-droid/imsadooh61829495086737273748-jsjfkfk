
import pg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pg;

// THE CORRECT DATABASE CONNECTION
// THE CORRECT DATABASE CONNECTION
const RAW_CONNECTION_STRING = 'postgresql://neondb_owner:npg_y1WCRm9QsVJh@ep-wispy-frost-ahj6lqe0-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// Normalize connection string for SSL compatibility
const dbUrl = new URL(RAW_CONNECTION_STRING);
dbUrl.searchParams.set('uselibpqcompat', 'true');
dbUrl.searchParams.set('sslmode', 'require');
const CONNECTION_STRING = dbUrl.toString();

async function checkData() {
    console.log('🔍 Checking row counts on ep-wispy-frost...');

    const pool = new Pool({
        connectionString: CONNECTION_STRING,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const queries = [
            { table: 'content_library', query: 'SELECT COUNT(*) FROM content_library' },
            { table: 'users', query: 'SELECT COUNT(*) FROM users' },
            { table: 'prospects', query: 'SELECT COUNT(*) FROM prospects' }
        ];

        for (const q of queries) {
            const res = await pool.query(q.query);
            console.log(`📊 ${q.table}: ${res.rows[0].count} rows`);

            if (q.table === 'content_library' && parseInt(res.rows[0].count) > 0) {
                console.log('   (Data exists! Here is a sample row):');
                const sample = await pool.query('SELECT type, name, content FROM content_library LIMIT 1');
                console.log('   ', sample.rows[0]);
            }
        }

    } catch (err) {
        console.error('❌ Check failed:', err);
    } finally {
        await pool.end();
    }
}

checkData();
