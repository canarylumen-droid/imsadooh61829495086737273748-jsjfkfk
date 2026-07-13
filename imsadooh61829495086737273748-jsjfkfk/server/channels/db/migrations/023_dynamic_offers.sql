-- Migration 023: Dynamic Offer details in users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "offer_description" text;
