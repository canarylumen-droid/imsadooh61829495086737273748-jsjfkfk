import { pgTable, text, real, boolean } from 'drizzle-orm/pg-core';

export const seedResults = pgTable('seed_results', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),
  testId: text('test_id').notNull(),
  seedAccountRef: text('seed_account_ref').notNull(),
  provider: text('provider').notNull().default('other'),
  folderFound: text('folder_found'),
  checkedAt: text('checked_at'),
  createdAt: text('created_at').notNull().default(''),
});

export const reputationSnapshots = pgTable('reputation_snapshots', {
  id: text('id').primaryKey(),
  domain: text('domain').notNull(),
  source: text('source').notNull(),
  spamRate: real('spam_rate'),
  ipReputation: text('ip_reputation'),
  blacklisted: boolean('blacklisted'),
  checkedAt: text('checked_at').notNull().default(''),
});
