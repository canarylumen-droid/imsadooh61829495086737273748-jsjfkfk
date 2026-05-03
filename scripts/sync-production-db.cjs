#!/usr/bin/env node
/**
 * Database Sync Script
 * Run this to trigger migrations on your production database
 * 
 * Usage:
 *   node scripts/sync-production-db.js
 * 
 * Or via curl:
 *   curl -X POST https://www.audnixai.com/api/admin/run-migrations
 */

const https = require('https');

const PRODUCTION_URL = 'https://www.audnixai.com';

async function syncDatabase() {
    console.log('🔄 Syncing production database...\n');

    // First, check current status
    console.log('📊 Checking database status...');

    try {
        const statusRes = await fetch(`${PRODUCTION_URL}/api/admin/db-status`);
        const status = await statusRes.json();

        console.log('\nCurrent Database State:');
        console.log(`  Tables: ${status.tables?.length || 0}`);
        console.log(`  Users: ${status.rowCounts?.users ?? 'N/A'}`);
        console.log(`  Content Library: ${status.rowCounts?.content_library ?? 'N/A'}`);
        console.log(`  Leads: ${status.rowCounts?.leads ?? 'N/A'}`);
        console.log(`  Database: ${status.databaseUrl || 'Unknown'}`);

        // Run migrations
        console.log('\n📦 Running migrations...');

        const migrateRes = await fetch(`${PRODUCTION_URL}/api/admin/run-migrations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await migrateRes.json();

        if (result.success) {
            console.log('\n✅ Migrations complete!');
            console.log('\nResults:');
            result.results?.forEach(r => {
                const icon = r.status === 'success' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌';
                console.log(`  ${icon} ${r.file}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
            });
        } else {
            console.error('❌ Migration failed:', result.error);
        }

        // Check status again
        console.log('\n📊 Final database status...');
        const finalStatus = await (await fetch(`${PRODUCTION_URL}/api/admin/db-status`)).json();

        console.log('\nFinal Database State:');
        console.log(`  Tables: ${finalStatus.tables?.length || 0}`);
        console.log(`  Users: ${finalStatus.rowCounts?.users ?? 'N/A'}`);
        console.log(`  Content Library: ${finalStatus.rowCounts?.content_library ?? 'N/A'}`);
        console.log(`  Leads: ${finalStatus.rowCounts?.leads ?? 'N/A'}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n💡 Make sure Vercel has deployed the latest code first.');
    }
}

syncDatabase();
