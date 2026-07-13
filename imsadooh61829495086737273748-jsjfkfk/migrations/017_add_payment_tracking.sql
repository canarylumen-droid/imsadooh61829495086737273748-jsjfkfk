-- Add payment tracking fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_plan TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_amount REAL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_date TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_approved_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id TEXT;

-- Create payment tracking table
CREATE TABLE IF NOT EXISTS payment_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  stripe_session_id TEXT,
  subscription_id TEXT,
  approved_by_admin_id UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_payment_approvals_status ON payment_approvals(status);
CREATE INDEX IF NOT EXISTS idx_payment_approvals_user_id ON payment_approvals(user_id);
