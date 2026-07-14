-- Admin Analytics Tables
-- Create tables to track revenue, user activity, and system metrics

-- Revenue tracking table
CREATE TABLE IF NOT EXISTS revenue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('subscription_created', 'subscription_renewed', 'topup_purchased', 'subscription_upgraded', 'subscription_downgraded')),
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_payment_intent_id TEXT,
  plan TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- User activity log
CREATE TABLE IF NOT EXISTS user_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- System metrics (for tracking daily/monthly aggregates)
CREATE TABLE IF NOT EXISTS system_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL UNIQUE,
  total_users INTEGER DEFAULT 0,
  active_users INTEGER DEFAULT 0,
  new_users INTEGER DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,
  mrr DECIMAL(10,2) DEFAULT 0,
  leads_created INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_revenue_events_user_id ON revenue_events(user_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_created_at ON revenue_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_metrics_date ON system_metrics(metric_date DESC);

-- Create view for MRR calculation
CREATE OR REPLACE VIEW admin_mrr AS
SELECT 
  DATE_TRUNC('month', created_at) as month,
  SUM(CASE 
    WHEN plan = 'starter' THEN 49
    WHEN plan = 'pro' THEN 199
    WHEN plan = 'enterprise' THEN 499
    ELSE 0
  END) as mrr
FROM users
WHERE stripe_subscription_id IS NOT NULL
  AND plan != 'trial'
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;
