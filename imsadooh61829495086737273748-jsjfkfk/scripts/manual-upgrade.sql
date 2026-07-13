
-- Run this in your database when someone pays
-- Replace 'user@email.com' with actual customer email from Stripe

-- Upgrade to Starter Plan
UPDATE users 
SET 
  plan = 'starter',
  stripe_customer_id = 'cus_xxxxx', -- from Stripe
  stripe_subscription_id = 'sub_xxxxx', -- from Stripe  
  trial_expires_at = NULL
WHERE email = 'user@email.com';

-- Add voice minutes from top-up
UPDATE users
SET voice_minutes_topup = voice_minutes_topup + 100
WHERE email = 'user@email.com';
