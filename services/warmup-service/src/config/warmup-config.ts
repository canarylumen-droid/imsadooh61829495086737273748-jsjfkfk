export const WARMUP_CONFIG = {
  // Pool health thresholds
  GLOBAL_POOL_MINIMUM: parseInt(process.env.WARMUP_GLOBAL_MINIMUM || '5', 10),
  ENTERPRISE_POOL_MINIMUM: parseInt(process.env.WARMUP_ENTERPRISE_MINIMUM || '2', 10),
  ENTERPRISE_FLEET_THRESHOLD: parseInt(process.env.WARMUP_ENTERPRISE_FLEET_THRESHOLD || '20', 10),

  // Daily volume caps per mailbox
  DAILY_SENT_LIMIT: parseInt(process.env.WARMUP_DAILY_SENT_LIMIT || '20', 10),
  DAILY_RECEIVED_LIMIT: parseInt(process.env.WARMUP_DAILY_RECEIVED_LIMIT || '20', 10),

  // Threading
  MIN_MESSAGES_PER_THREAD: 2,
  MAX_MESSAGES_PER_THREAD: 3,
  MIN_THREAD_INTERVAL_HOURS: 4,
  MAX_THREAD_INTERVAL_HOURS: 12,

  // Send delays (seconds)
  MIN_SEND_DELAY_SECONDS: 30,
  MAX_SEND_DELAY_SECONDS: 90,

  // Reply expectation window (hours)
  MIN_REPLY_EXPECTATION_HOURS: 1,
  MAX_REPLY_EXPECTATION_HOURS: 4,

  HIDDEN_FOLDER_NAME: process.env.WARMUP_HIDDEN_FOLDER || '.Warmup-Archive',
  IMAP_TIMEOUT_MS: parseInt(process.env.WARMUP_IMAP_TIMEOUT_MS || '15000', 10),

  // Scheduler intervals (ms)
  ENROLLMENT_SCAN_INTERVAL_MS: 5 * 60 * 1000,
  POOL_HEALTH_INTERVAL_MS: 5 * 60 * 1000,
  SPAM_RESCUE_INTERVAL_MS: 30 * 60 * 1000,
  THREAD_SCHEDULER_INTERVAL_MS: 60 * 1000,
  INBOX_SWEEP_INTERVAL_MS: 2 * 60 * 1000,

  // BullMQ
  OUTBOUND_QUEUE_NAME: 'warmup-outbound',
  INBOUND_QUEUE_NAME: 'warmup-inbound',
  OUTBOUND_CONCURRENCY: parseInt(process.env.WARMUP_OUTBOUND_CONCURRENCY || '5', 10),
  INBOUND_CONCURRENCY: parseInt(process.env.WARMUP_INBOUND_CONCURRENCY || '5', 10),

  // Retry / backoff
  MAX_SEND_ATTEMPTS: 3,
  MAX_IMAP_ATTEMPTS: 3,

  // Ramp schedule — percentage of final DAILY_SENT_LIMIT
  // Gradually increase warmup volume to avoid ISP rate limiting and flagging.
  // Day 1-2:  10%   (e.g. 2/day if limit=20)
  // Day 3-5:  25%   (e.g. 5/day)
  // Day 6-10: 50%   (e.g. 10/day)
  // Day 11-14: 75%  (e.g. 15/day)
  // Day 15+:  100%  (full limit)
  RAMP_DAILY_PERCENTS: [
    { maxDays: 2, percent: 0.10 },
    { maxDays: 5, percent: 0.25 },
    { maxDays: 10, percent: 0.50 },
    { maxDays: 14, percent: 0.75 },
  ] as const,

  // Domain clustering
  DOMAIN_CLUSTER_SCAN_INTERVAL_MS: parseInt(process.env.WARMUP_DOMAIN_SCAN_INTERVAL || '300000', 10),
  ANCHOR_REBALANCE_INTERVAL_MS: parseInt(process.env.WARMUP_ANCHOR_REBALANCE_INTERVAL || '600000', 10),

  // Anchor / seed thresholds
  ANCHORS_PER_DOMAIN: parseInt(process.env.WARMUP_ANCHORS_PER_DOMAIN || '2', 10),
  MAX_MEMBERS_PER_ANCHOR: parseInt(process.env.WARMUP_MAX_MEMBERS_PER_ANCHOR || '50', 10),
  SEED_MAX_PARTNERS: parseInt(process.env.WARMUP_SEED_MAX_PARTNERS || '10', 10),
  SEED_DAILY_LIMIT: parseInt(process.env.WARMUP_SEED_DAILY_LIMIT || '400', 10),
  SEED_COOLDOWN_AFTER_EXHAUSTED_MS: 4 * 60 * 60 * 1000,

  // Pairing weights
  PAIRING_BASE_SCORE: 100,
  PAIRING_CROSS_PROVIDER_BONUS: 200,
  PAIRING_DIFFERENT_DOMAIN_BONUS: 80,
  PAIRING_VOLUME_BALANCE_BONUS: 30,
  PAIRING_THREAD_LIGHT_BONUS: 20,
  PAIRING_THREAD_HEAVY_PENALTY: -30,
  PAIRING_ORG_DIVERSITY_BONUS: 10,
  PAIRING_STALENESS_PENALTY_PER_HOUR: -5,
  PAIRING_MAX_STALENESS_PENALTY: -50,
  PAIRING_ANCHOR_PAIRING_BOOST: 100,

  // Platform seed provisioning
  PLATFORM_SEED_ENABLED: process.env.WARMUP_PLATFORM_SEEDS === 'true',
  SEED_PROVISIONING_STRATEGY: process.env.WARMUP_SEED_STRATEGY || 'least_loaded',

  // Warmup isolation — these markers are injected into warmup-only records
  // to guarantee they are NEVER picked up by campaign/outreach queries.
  WARMUP_SYSTEM_USER_ID: 'system',
  WARMUP_SOURCE_MARKER: 'warmup_seed',

  // ── Reputation Recovery / Dead IP Revival ──────────────────────────────────
  // When a mailbox has poor deliverability reputation, warmup volume is boosted
  // to "ring the IP back to life" by showing natural sending patterns to ISPs.
  //
  // Recovery tiers (based on integrations.reputationScore):
  //   critical (0-39)   → AGGRESSIVE: high warmup to flush out spam signals
  //   poor     (40-64)  → ELEVATED:  moderate boost to rebuild trust
  //   cautious (65-84)  → MODERATE:  light boost to maintain progress
  //   healthy  (85-100) → STANDARD:  normal warmup limits
  //
  // These override the base DAILY_SENT_LIMIT when reputation is degraded.

  // Maximum warmup emails per day during aggressive recovery (score < 40)
  RECOVERY_CRITICAL_WARMUP_LIMIT: parseInt(process.env.WARMUP_RECOVERY_CRITICAL_LIMIT || '40', 10),
  // Maximum warmup emails per day during poor recovery (score 40-64)
  RECOVERY_POOR_WARMUP_LIMIT: parseInt(process.env.WARMUP_RECOVERY_POOR_LIMIT || '30', 10),
  // Maximum warmup emails per day during cautious state (score 65-84)
  RECOVERY_CAUTIOUS_WARMUP_LIMIT: parseInt(process.env.WARMUP_RECOVERY_CAUTIOUS_LIMIT || '25', 10),

  // Reputation recovery scan interval (ms) — how often we check and adjust
  RECOVERY_SCAN_INTERVAL_MS: parseInt(process.env.WARMUP_RECOVERY_SCAN_INTERVAL || '300000', 10), // 5 min

  // Minimum consecutive clean days before stepping down a recovery tier
  RECOVERY_MIN_CLEAN_DAYS_CRITICAL: parseInt(process.env.WARMUP_RECOVERY_CLEAN_DAYS_CRITICAL || '3', 10),
  RECOVERY_MIN_CLEAN_DAYS_POOR: parseInt(process.env.WARMUP_RECOVERY_CLEAN_DAYS_POOR || '2', 10),

  // Maximum threads per mailbox during recovery (higher = more volume)
  RECOVERY_MAX_THREADS_CRITICAL: parseInt(process.env.WARMUP_RECOVERY_THREADS_CRITICAL || '6', 10),
  RECOVERY_MAX_THREADS_POOR: parseInt(process.env.WARMUP_RECOVERY_THREADS_POOR || '5', 10),
  RECOVERY_MAX_THREADS_CAUTIOUS: parseInt(process.env.WARMUP_RECOVERY_THREADS_CAUTIOUS || '4', 10),
};

/**
 * Get the warmup daily limit based on mailbox age (percentage-based ramp schedule)
 * Gradually increases volume to avoid ISP rate limiting and flagging.
 * Percentages of the final daily limit:
 *   Day 1-2:  10%   Day 3-5:  25%   Day 6-10: 50%   Day 11-14: 75%   Day 15+: 100%
 */
export function getRampLimit(createdAt: Date | null | undefined, baseLimit: number): number {
  if (!createdAt) return Math.max(1, Math.round(baseLimit * WARMUP_CONFIG.RAMP_DAILY_PERCENTS[0].percent));
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000);
  for (const stage of WARMUP_CONFIG.RAMP_DAILY_PERCENTS) {
    if (ageDays <= stage.maxDays) return Math.max(1, Math.round(baseLimit * stage.percent));
  }
  return baseLimit;
}