-- Payment sessions for Stripe verification (Option 2: Checkout Session)
CREATE TABLE IF NOT EXISTS payment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session_id text NOT NULL UNIQUE,
  stripe_customer_id text,
  plan text NOT NULL,
  amount real NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled')),
  payment_intent_id text,
  subscription_id text,
  verified_at timestamp,
  expires_at timestamp NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT NOW(),
  updated_at timestamp NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_payment_sessions_user ON payment_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_stripe_session ON payment_sessions(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_verified ON payment_sessions(verified_at);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_subscription ON payment_sessions(subscription_id);

-- User plan tracking (for analytics)
CREATE TABLE IF NOT EXISTS user_plan_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_plan text,
  new_plan text NOT NULL,
  payment_session_id uuid REFERENCES payment_sessions(id) ON DELETE SET NULL,
  approved_by_admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_plan_history_user ON user_plan_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plan_history_date ON user_plan_history(created_at DESC);
