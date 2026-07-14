const pg = require('pg');

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

async function checkTables() {
    try {
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);

        console.log(`📊 TABLES IN DATABASE (${result.rows.length}):`);
        result.rows.forEach(row => console.log(`  ✓ ${row.table_name}`));

        // Count rows in content_library (seed data)
        const seedCheck = await pool.query(`SELECT COUNT(*) as count FROM content_library`);
        console.log(`\n📝 Seed data: ${seedCheck.rows[0].count} rows in content_library`);

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

checkTables();
