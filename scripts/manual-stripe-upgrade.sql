
-- Manual Stripe Payment Processing (No Webhooks)
-- Run this after confirming payment in Stripe Dashboard

-- Step 1: Find the user by email (from Stripe payment)
SELECT id, email, plan, stripe_customer_id FROM users 
WHERE email = 'customer@example.com'; -- Replace with actual email

-- Step 2: Upgrade to paid plan
UPDATE users 
SET 
  plan = 'starter', -- Change to 'pro' or 'enterprise' based on payment
  stripe_customer_id = 'cus_xxxxx', -- From Stripe Dashboard
  stripe_subscription_id = 'sub_xxxxx', -- From Stripe Dashboard (if subscription)
  trial_expires_at = NULL, -- Clear trial
  voice_minutes_plan = 100, -- Starter plan minutes
  updated_at = NOW()
WHERE email = 'customer@example.com';

-- Step 3: Add voice minutes to balance
UPDATE users 
SET voice_minutes_topup = voice_minutes_topup + 100
WHERE email = 'customer@example.com';

-- Step 4: Create success notification
INSERT INTO notifications (user_id, type, title, message, action_url, created_at)
SELECT 
  id,
  'system',
  'Payment Successful - Welcome to Starter Plan!',
  'Your payment was processed. You now have access to 2,500 leads and 100 voice minutes.',
  '/dashboard',
  NOW()
FROM users WHERE email = 'customer@example.com';

-- Step 5: Verify upgrade worked
SELECT email, plan, stripe_customer_id, voice_minutes_plan, voice_minutes_topup
FROM users WHERE email = 'customer@example.com';
