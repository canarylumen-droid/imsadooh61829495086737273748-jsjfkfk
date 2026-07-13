-- TIER 1: CORE LEAD MANAGEMENT FEATURES
-- Lead Scoring, Tags, Custom Fields, Timeline, Company Enrichment

-- Lead Scores (1-100)
CREATE TABLE IF NOT EXISTS lead_scores (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL UNIQUE,
  score INT CHECK (score >= 0 AND score <= 100),
  engagement_score INT,
  company_score INT,
  industry_score INT,
  velocity_score INT,
  details JSONB, -- { engagement_level, reply_count, open_rate, etc. }
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Lead Tags
CREATE TABLE IF NOT EXISTS lead_tags (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  tag_name VARCHAR(100) NOT NULL,
  color VARCHAR(10),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, tag_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Lead-Tag Junction
CREATE TABLE IF NOT EXISTS lead_tag_mapping (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL,
  tag_id INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(lead_id, tag_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES lead_tags(id) ON DELETE CASCADE
);

-- Custom Lead Fields
CREATE TABLE IF NOT EXISTS lead_custom_fields (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  field_name VARCHAR(200) NOT NULL,
  field_type VARCHAR(50), -- text, number, date, dropdown, boolean
  field_options JSONB, -- for dropdowns: ["option1", "option2"]
  required BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, field_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Custom Field Values per Lead
CREATE TABLE IF NOT EXISTS lead_custom_field_values (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL,
  field_id INT NOT NULL,
  field_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(lead_id, field_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (field_id) REFERENCES lead_custom_fields(id) ON DELETE CASCADE
);

-- Lead Activity Timeline
CREATE TABLE IF NOT EXISTS lead_timeline (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL,
  action_type VARCHAR(100), -- email_sent, email_opened, email_replied, call_logged, status_changed, tag_added, note_added
  action_data JSONB, -- { old_value, new_value, metadata }
  actor_id UUID, -- who did this action
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Company Enrichment Data
CREATE TABLE IF NOT EXISTS lead_company_enrichment (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL UNIQUE,
  company_name VARCHAR(255),
  company_size VARCHAR(50), -- 1-10, 11-50, 51-200, 201-500, 500+
  industry VARCHAR(100),
  industry_category VARCHAR(50),
  revenue_estimate VARCHAR(50), -- $0-1M, $1-10M, $10-50M, $50M+
  founding_year INT,
  website VARCHAR(255),
  headquarters_location VARCHAR(200),
  phone VARCHAR(20),
  linkedin_company_url VARCHAR(255),
  employee_count INT,
  tech_stack JSONB, -- [tools, platforms]
  recent_news JSONB, -- [{title, url, date}]
  competitor_list JSONB, -- [competitor names]
  enriched_at TIMESTAMP,
  source VARCHAR(100), -- clearbit, hunter, manual, etc.
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Lead Segments (Dynamic)
CREATE TABLE IF NOT EXISTS lead_segments (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  segment_name VARCHAR(200) NOT NULL,
  segment_criteria JSONB, -- { score_min, score_max, tags: [], industries: [] }
  description TEXT,
  lead_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- BANT Qualification Data
CREATE TABLE IF NOT EXISTS lead_bant (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL UNIQUE,
  budget_status VARCHAR(50), -- unknown, has_budget, no_budget
  budget_amount DECIMAL(12, 2),
  authority_status VARCHAR(50), -- unknown, decision_maker, influencer, not_involved
  authority_level VARCHAR(100), -- C-level, Director, Manager, etc.
  need_status VARCHAR(50), -- unknown, has_need, no_need
  need_description TEXT,
  timeline_status VARCHAR(50), -- unknown, immediate, this_quarter, this_year, no_timeline
  timeline_date DATE,
  qualification_score INT, -- 0-100 based on BANT
  qualified_at TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Lead Deduplication Log
CREATE TABLE IF NOT EXISTS lead_deduplication (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  primary_lead_id UUID NOT NULL,
  duplicate_lead_id UUID NOT NULL,
  match_score DECIMAL(5, 2), -- 0-100 confidence
  match_fields JSONB, -- which fields matched: ["email", "company"]
  merged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (primary_lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (duplicate_lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Create Indexes
CREATE INDEX idx_lead_scores_lead_id ON lead_scores(lead_id);
CREATE INDEX idx_lead_scores_score ON lead_scores(score);
CREATE INDEX idx_lead_tags_user_id ON lead_tags(user_id);
CREATE INDEX idx_lead_tag_mapping_lead_id ON lead_tag_mapping(lead_id);
CREATE INDEX idx_lead_custom_fields_user_id ON lead_custom_fields(user_id);
CREATE INDEX idx_lead_timeline_lead_id ON lead_timeline(lead_id);
CREATE INDEX idx_lead_timeline_created_at ON lead_timeline(created_at);
CREATE INDEX idx_lead_company_enrichment_lead_id ON lead_company_enrichment(lead_id);
CREATE INDEX idx_lead_segments_user_id ON lead_segments(user_id);
CREATE INDEX idx_lead_bant_lead_id ON lead_bant(lead_id);
