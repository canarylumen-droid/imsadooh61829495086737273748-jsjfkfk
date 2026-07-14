-- Add payment approval system (manual admin approvals, no API keys needed)
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'none' CHECK (payment_status IN ('none', 'pending', 'approved', 'rejected'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_amount real DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_plan text DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_date timestamp DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_approved_date timestamp DEFAULT NULL;

-- Create index for fast filtering
CREATE INDEX IF NOT EXISTS idx_users_payment_status ON users(payment_status);
CREATE INDEX IF NOT EXISTS idx_users_pending_payment_date ON users(pending_payment_date DESC);

-- Add admin action log table
CREATE TABLE IF NOT EXISTS admin_payment_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('approved', 'rejected')),
  plan text NOT NULL,
  amount real NOT NULL,
  reason text,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_payment_approvals_user ON admin_payment_approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_payment_approvals_date ON admin_payment_approvals(created_at DESC);
