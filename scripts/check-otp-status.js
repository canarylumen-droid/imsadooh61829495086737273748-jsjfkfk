import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

// Use environment variable if available, otherwise fallback (User can set this in their terminal if needed)
const CONNECTION_STRING = process.env.DATABASE_URL;

if (!CONNECTION_STRING) {
    console.error('❌ Error: DATABASE_URL is not defined. Please check your .env file or set variable.');
    process.exit(1);
}

// Normalize connection string for SSL compatibility
const dbUrl = new URL(CONNECTION_STRING);
dbUrl.searchParams.set('uselibpqcompat', 'true');
dbUrl.searchParams.set('sslmode', 'require');
const NORMALIZED_CONNECTION_STRING = dbUrl.toString();

async function checkData() {
    console.log('🔌 Connecting to database...');
    console.log(`   URL: ${CONNECTION_STRING.substring(0, 20)}...`);

    const pool = new Pool({
        connectionString: NORMALIZED_CONNECTION_STRING,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        console.log('✅ Connected successfully.');

        // 1. Check OTP Codes
        console.log('\n🔍 Checking OTP Codes (otp_codes table)...');
        try {
            const countRes = await client.query('SELECT COUNT(*) FROM otp_codes');
            console.log(`   Total Rows: ${countRes.rows[0].count}`);

            const recentRes = await client.query('SELECT id, email, code, created_at, verified, password_hash IS NOT NULL as has_hash FROM otp_codes ORDER BY created_at DESC LIMIT 5');

            if (recentRes.rows.length === 0) {
                console.log('   (No OTPs found)');
            } else {
                console.log('   Recent Entries:');
                recentRes.rows.forEach(row => {
                    console.log(`   - [${row.created_at.toISOString()}] ${row.email} | Code: ${row.code} | Verified: ${row.verified} | HasHash: ${row.has_hash}`);
                });
            }
        } catch (err) {
            console.error('   ❌ Error querying otp_codes:', err.message);
        }

        // 2. Check Users
        console.log('\n🔍 Checking Users (users table)...');
        try {
            const countRes = await client.query('SELECT COUNT(*) FROM users');
            console.log(`   Total Users: ${countRes.rows[0].count}`);

            const recentRes = await client.query('SELECT id, email, username, created_at FROM users ORDER BY created_at DESC LIMIT 5');

            if (recentRes.rows.length === 0) {
                console.log('   (No Users found)');
            } else {
                console.log('   Recent Users:');
                recentRes.rows.forEach(row => {
                    console.log(`   - [${row.created_at.toISOString()}] ${row.email} (${row.username})`);
                });
            }
        } catch (err) {
            console.error('   ❌ Error querying users:', err.message);
        }

        client.release();

    } catch (err) {
        console.error('❌ Connection failed:', err);
    } finally {
        await pool.end();
    }
}

checkData();
