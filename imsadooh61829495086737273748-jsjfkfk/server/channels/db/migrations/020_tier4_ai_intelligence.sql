-- TIER 4: AI INTELLIGENCE FEATURES
-- Intent Detection, Smart Replies, Objection Recognition, Deal Prediction, Churn Scoring

-- Lead Intent Detection
CREATE TABLE IF NOT EXISTS lead_intent (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL UNIQUE,
  intent_level VARCHAR(50), -- high, medium, low, not_interested
  intent_score DECIMAL(5, 2), -- 0-100
  intent_signals JSONB, -- { keywords: [], sentiment: positive/neutral/negative, urgency: high/medium/low }
  buyer_stage VARCHAR(50), -- awareness, consideration, decision, not_qualified
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Smart Reply Suggestions
CREATE TABLE IF NOT EXISTS smart_reply_suggestions (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL,
  last_message_from_lead TEXT,
  suggested_replies JSONB, -- [{ reply_text, confidence, reasoning }]
  best_reply_selected VARCHAR(1000),
  reply_sent BOOLEAN DEFAULT FALSE,
  lead_response TEXT,
  effectiveness_score INT, -- 0-100, based on lead's reaction
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Objection Patterns
CREATE TABLE IF NOT EXISTS objection_patterns (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  objection_type VARCHAR(100), -- price, timeline, already_using, not_convinced, etc.
  objection_text TEXT,
  ai_response TEXT,
  lead_response TEXT,
  converted BOOLEAN, -- did this response lead to conversion?
  effectiveness_score DECIMAL(5, 2), -- 0-100
  frequency INT DEFAULT 1, -- how many times seen
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Objection-Lead Mapping (track which objections each lead has)
CREATE TABLE IF NOT EXISTS lead_objections (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL,
  objection_id INT NOT NULL,
  objection_type VARCHAR(100),
  objection_text TEXT,
  response_suggested TEXT,
  response_sent BOOLEAN DEFAULT FALSE,
  lead_response TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (objection_id) REFERENCES objection_patterns(id) ON DELETE CASCADE
);

-- Deal Amount Prediction
CREATE TABLE IF NOT EXISTS deal_predictions (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL UNIQUE,
  predicted_deal_amount DECIMAL(12, 2),
  confidence_score DECIMAL(5, 2), -- 0-100
  prediction_factors JSONB, -- { company_size: 0.3, industry: 0.25, engagement: 0.2, timeline: 0.15, budget: 0.1 }
  expected_close_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Churn Risk Scoring
CREATE TABLE IF NOT EXISTS churn_risk_scores (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL UNIQUE,
  churn_risk_level VARCHAR(50), -- high, medium, low, no_risk
  risk_score DECIMAL(5, 2), -- 0-100
  risk_indicators JSONB, -- { last_engagement: days_ago, email_opened: false, replies: count, sentiment: declining, etc. }
  recommended_action TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- Competitor Mention Alerts
CREATE TABLE IF NOT EXISTS competitor_mentions (
  id SERIAL PRIMARY KEY,
  lead_id UUID NOT NULL,
  competitor_name VARCHAR(255),
  mention_context TEXT,
  message_id VARCHAR(255),
  alert_sent BOOLEAN DEFAULT FALSE,
  action_taken TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

-- AI Learning Patterns (track what works)
CREATE TABLE IF NOT EXISTS ai_learning_patterns (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  pattern_type VARCHAR(100), -- message_type, tone, industry, stage
  pattern_value VARCHAR(255),
  success_count INT DEFAULT 0,
  total_count INT DEFAULT 0,
  success_rate DECIMAL(5, 2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create Indexes
CREATE INDEX idx_lead_intent_lead_id ON lead_intent(lead_id);
CREATE INDEX idx_lead_intent_score ON lead_intent(intent_score);
CREATE INDEX idx_smart_reply_lead_id ON smart_reply_suggestions(lead_id);
CREATE INDEX idx_objection_patterns_user_id ON objection_patterns(user_id);
CREATE INDEX idx_objection_patterns_effectiveness ON objection_patterns(effectiveness_score);
CREATE INDEX idx_lead_objections_lead_id ON lead_objections(lead_id);
CREATE INDEX idx_deal_predictions_lead_id ON deal_predictions(lead_id);
CREATE INDEX idx_churn_risk_lead_id ON churn_risk_scores(lead_id);
CREATE INDEX idx_churn_risk_level ON churn_risk_scores(churn_risk_level);
CREATE INDEX idx_competitor_mentions_lead_id ON competitor_mentions(lead_id);
CREATE INDEX idx_ai_learning_patterns_user_id ON ai_learning_patterns(user_id);
