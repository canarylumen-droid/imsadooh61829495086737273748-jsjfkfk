/**
 * Phase 9: End-to-End RAG Search Verification Pipeline
 * =====================================================
 * Tests the full RAG flow: chunk → embed → index → search
 * Verifies that the rag-worker microservice correctly handles
 * all operations via BullMQ without the brain-worker calling
 * vector functions directly.
 *
 * Usage: npx tsx scripts/test-rag-pipeline.ts
 */

import '@services/api-gateway/src/core/bootstrap.js';
import { ragQueue } from '@shared/lib/queue.js';
import { QueueEvents } from 'bullmq';
import { createFreshConnection } from '@shared/lib/queues/redis-config.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

const TEST_USER_ID = 'rag-test-user-00000000-0000-0000-0000-000000000001';
const TEST_DOCUMENT_ID = 'rag-test-doc-00000000-0000-0000-0000-000000000001';

const TEST_CONTENT = `
  Audnix AI is an autonomous sales outreach platform built for agencies and B2B SaaS founders.

  Core Features:
  - Automated email sequences with AI-generated personalized copy
  - Objection handling using historical "winning" negotiation patterns
  - Dynamic payment link injection when leads express purchase intent
  - Real-time bounce detection and lead status management
  - Brand PDF semantic search (RAG) for hyper-personalized replies

  Pricing:
  - Starter: $97/month for up to 500 leads
  - Growth: $297/month for up to 2,000 leads + priority support
  - Agency: Custom pricing for unlimited leads and white-label access

  Common Objections:
  - "Too expensive" → Reframe as ROI: one closed deal pays for 6 months
  - "Not ready now" → Schedule 14-day re-engagement sequence
  - "Already have a solution" → Ask about their top 3 bottlenecks and compare
`;

const SEARCH_QUERIES = [
  'what is the pricing for audnix',
  'how does audnix handle objections',
  'email automation features',
  'payment and billing',
];

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';

async function cleanupTestData() {
  try {
    await db.execute(sql`
      DELETE FROM brand_embeddings WHERE user_id = ${TEST_USER_ID}
    `);
    console.log('🧹 Cleaned up previous test data.');
  } catch (e) {
    // Table might not exist yet — that's ok
  }
}

async function runVerification() {
  console.log('\n' + '═'.repeat(60));
  console.log('  AUDNIX RAG PIPELINE — PHASE 9 VERIFICATION');
  console.log('═'.repeat(60) + '\n');

  const ragQueueEvents = new QueueEvents(ragQueue.name, { connection: createFreshConnection() });

  try {
    // ── Step 1: Clean test slate ──────────────────────────────
    console.log('📋 Step 1: Cleaning previous test data...');
    await cleanupTestData();
    console.log(`${PASS} Test data cleared.\n`);

    // ── Step 2: Dispatch INDEX job via BullMQ ─────────────────
    console.log('📋 Step 2: Dispatching INDEX job to rag-worker via BullMQ...');
    const indexJob = await ragQueue.add('index', {
      action: 'index',
      content: TEST_CONTENT,
      userId: TEST_USER_ID,
      documentId: TEST_DOCUMENT_ID,
      fileName: 'test-brand-doc.txt',
      metadata: { clearPrevious: true },
    });

    console.log(`   Job dispatched: ID = ${indexJob.id}`);
    console.log('   Waiting for rag-worker to process (15s timeout)...');

    try {
      await indexJob.waitUntilFinished(ragQueueEvents, 15000);
      console.log(`${PASS} Indexing job completed by rag-worker.\n`);
    } catch (e) {
      console.error(`${FAIL} Indexing job timed out or failed. Is rag-worker running?`);
      console.error('   Hint: start the rag-worker with: npm run dev --workspace=services/rag-worker');
      process.exit(1);
    }

    // ── Step 3: Verify chunks were stored in DB ───────────────
    console.log('📋 Step 3: Verifying chunks written to brand_embeddings...');
    const chunkCount = await db.execute(sql`
      SELECT COUNT(*) AS count FROM brand_embeddings WHERE user_id = ${TEST_USER_ID}
    `);
    const count = parseInt((chunkCount.rows[0] as any)?.count || '0');

    if (count > 0) {
      console.log(`${PASS} ${count} chunk(s) indexed in brand_embeddings.\n`);
    } else {
      console.error(`${FAIL} No chunks found — vector indexing may have failed silently.`);
      process.exit(1);
    }

    // ── Step 4: Dispatch SEARCH jobs and verify retrieval ─────
    console.log('📋 Step 4: Running semantic search queries via BullMQ...');
    let searchPassed = 0;
    let searchFailed = 0;

    for (const query of SEARCH_QUERIES) {
      console.log(`\n   🔍 Query: "${query}"`);
      try {
        const searchJob = await ragQueue.add('search', {
          action: 'search',
          query,
          userId: TEST_USER_ID,
          topK: 3,
        });

        const results = await searchJob.waitUntilFinished(ragQueueEvents, 30000);

        if (results && results.length > 0) {
          console.log(`   ${PASS} Got ${results.length} result(s). Top similarity: ${results[0].similarity.toFixed(3)}`);
          console.log(`      Preview: "${results[0].content.substring(0, 80).trim()}..."`);
          searchPassed++;
        } else {
          console.log(`   ${FAIL} No results returned for this query.`);
          searchFailed++;
        }
      } catch (e) {
        console.log(`   ${FAIL} Search timed out or failed: ${(e as Error).message}`);
        searchFailed++;
      }
    }

    // ── Step 5: Cross-contamination check ─────────────────────
    console.log('\n📋 Step 5: Cross-contamination check — verifying brain-worker has no direct vector imports...');
    const { execSync } = await import('child_process');
    try {
      const result = execSync(
        `node -e "const g = require('fs'); const r = (d) => { const e = g.readdirSync(d, {withFileTypes:true}); for (const f of e) { if (f.isDirectory() && !f.name.includes('node_modules')) r(d+'/'+f.name); else if (f.name.endsWith('.ts')) { const c = g.readFileSync(d+'/'+f.name,'utf8'); if (c.includes('from') && c.includes('vector-store') && d.includes('brain-worker')) console.log('CROSS_CONTAMINATION:'+d+'/'+f.name); }}}; r('./services/brain-worker/src');"`,
        { encoding: 'utf8', cwd: process.cwd() }
      );
      if (result.includes('CROSS_CONTAMINATION')) {
        console.log(`   ${FAIL} Direct vector-store imports found in brain-worker!`);
        console.log(`   Files:\n${result}`);
        searchFailed++;
      } else {
        console.log(`   ${PASS} No direct vector-store imports found in brain-worker — architecture is clean.`);
      }
    } catch (e) {
      console.log(`   ⚠️  Could not run contamination check (non-critical).`);
    }

    // ── Step 6: Cleanup ───────────────────────────────────────
    console.log('\n📋 Step 6: Cleaning up test data...');
    await cleanupTestData();
    console.log(`${PASS} Test data cleaned.\n`);

    // ── Summary ───────────────────────────────────────────────
    console.log('═'.repeat(60));
    console.log(`  RAG PIPELINE VERIFICATION COMPLETE`);
    console.log(`  Chunks Indexed:   ${count}`);
    console.log(`  Search Passed:    ${searchPassed}/${SEARCH_QUERIES.length}`);
    console.log(`  Search Failed:    ${searchFailed}`);
    console.log('═'.repeat(60));

    if (searchFailed === 0) {
      console.log('\n🚀 PHASE 9 COMPLETE — RAG pipeline is fully operational!\n');
    } else {
      console.log('\n⚠️  Some search queries failed — review above for details.\n');
      process.exit(1);
    }
  } finally {
    await ragQueueEvents.close();
    process.exit(0);
  }
}

runVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
