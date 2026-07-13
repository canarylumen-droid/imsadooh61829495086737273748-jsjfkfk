import '../services/api-gateway/src/core/bootstrap.js';
import { db } from '../shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

async function deployEnterpriseIndexes() {
  console.log('🚀 Starting Enterprise Database Hardening (Skip Extensions)...');

  try {
    // 1. Brand Embeddings: Hybrid Search Optimization
    console.log('🧠 Optimizing RAG search (Stored TSVector + GIN Index)...');
    
    // Ensure column exists (idempotent)
    await db.execute(sql`
      ALTER TABLE brand_embeddings ADD COLUMN IF NOT EXISTS tsv tsvector;
    `);

    // Create GIN index on the TSVector column
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS brand_embeddings_tsv_gin_idx 
      ON brand_embeddings USING gin (tsv);
    `);

    // Create trigger to automatically update tsv on snippet changes
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION brand_embeddings_tsv_trigger() RETURNS trigger AS $$
      begin
        new.tsv := to_tsvector('english', new.snippet);
        return new;
      end
      $$ LANGUAGE plpgsql;
    `);

    await db.execute(sql`
      DROP TRIGGER IF EXISTS brand_embeddings_tsv_update ON brand_embeddings;
      CREATE TRIGGER brand_embeddings_tsv_update
      BEFORE INSERT OR UPDATE ON brand_embeddings
      FOR EACH ROW EXECUTE FUNCTION brand_embeddings_tsv_trigger();
    `);

    // Backfill existing rows
    await db.execute(sql`
      UPDATE brand_embeddings SET tsv = to_tsvector('english', snippet) WHERE tsv IS NULL;
    `);

    // 2. Leads Table: High-Performance Dashboard Queries
    console.log('📈 Optimizing Lead Management performance...');
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS leads_scaling_user_status_idx 
      ON leads (user_id, status, archived);
    `);
    
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS leads_scaling_email_lookup_idx 
      ON leads (user_id, email);
    `);

    // 3. Messages Table: Rapid Threading Lookup
    console.log('💬 Optimizing Message Threading...');
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_scaling_lead_user_idx 
      ON messages (lead_id, user_id, created_at DESC);
    `);

    console.log('✅ Phase 2: Database Performance Hardening COMPLETE.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database Hardening Failed:', err);
    process.exit(1);
  }
}

deployEnterpriseIndexes();
