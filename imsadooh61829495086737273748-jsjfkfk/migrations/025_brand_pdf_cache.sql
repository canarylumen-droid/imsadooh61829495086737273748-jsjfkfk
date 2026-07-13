-- Brand PDF Cache Migration
-- Stores extracted PDF content and analysis in PostgreSQL for fast retrieval
-- Supports 5-10 MB PDF files via BYTEA storage

CREATE TABLE IF NOT EXISTS brand_pdf_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_hash TEXT NOT NULL,
  pdf_content BYTEA,
  extracted_text TEXT,
  brand_context JSONB NOT NULL DEFAULT '{}',
  analysis_score INTEGER DEFAULT 0,
  analysis_items JSONB DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, file_hash)
);

CREATE INDEX IF NOT EXISTS idx_brand_pdf_cache_user_id ON brand_pdf_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_brand_pdf_cache_file_hash ON brand_pdf_cache(file_hash);

COMMENT ON TABLE brand_pdf_cache IS 'Caches brand PDF uploads and AI-extracted context for fast retrieval';
COMMENT ON COLUMN brand_pdf_cache.pdf_content IS 'Raw PDF bytes for re-analysis if needed (up to 10MB)';
COMMENT ON COLUMN brand_pdf_cache.extracted_text IS 'Plain text extracted from PDF';
COMMENT ON COLUMN brand_pdf_cache.brand_context IS 'AI-analyzed brand context JSON';
