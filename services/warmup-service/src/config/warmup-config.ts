export const WARMUP_CONFIG = {
  // Pool health thresholds
  GLOBAL_POOL_MINIMUM: parseInt(process.env.WARMUP_GLOBAL_MINIMUM || '5', 10),
  ENTERPRISE_POOL_MINIMUM: parseInt(process.env.WARMUP_ENTERPRISE_MINIMUM || '2', 10),
  ENTERPRISE_FLEET_THRESHOLD: parseInt(process.env.WARMUP_ENTERPRISE_FLEET_THRESHOLD || '20', 10),

  // Daily volume caps per mailbox
  // MAX 15/day per mailbox for warmup (soft ceiling). Hard ceiling = mailbox cap_limit * 0.25, capped at 15.
  DAILY_SENT_LIMIT: parseInt(process.env.WARMUP_DAILY_SENT_LIMIT || '15', 10),
  DAILY_RECEIVED_LIMIT: parseInt(process.env.WARMUP_DAILY_RECEIVED_LIMIT || '15', 10),

  // Warmup hourly rate limit — max 2 warmup emails per mailbox per hour
  MAX_WARMUP_PER_HOUR: parseInt(process.env.WARMUP_MAX_PER_HOUR || '2', 10),

  // Warmup cap percent — percentage of mailbox cap_limit used when no campaign active
  // e.g. 25% of 50 = 12-13 emails (range 10-15 acceptable). Never exceeds DAILY_SENT_LIMIT (15).
  WARMUP_CAP_PERCENT: parseFloat(process.env.WARMUP_CAP_PERCENT || '0.25'),

  // Minimum warmup per mailbox per day (even when campaign is active)
  MIN_WARMUP_PER_DAY: parseInt(process.env.WARMUP_MIN_PER_DAY || '3', 10),

  // Reply volleys per warmup send — for each outbound warmup email, generate this many replies back
  REPLIES_PER_SEND: parseInt(process.env.WARMUP_REPLIES_PER_SEND || '3', 10),

  // Reply chain timing (seconds between replies in the chain)
  REPLY_CHAIN_MIN_DELAY_SECONDS: parseInt(process.env.WARMUP_CHAIN_MIN_DELAY || '180', 10),
  REPLY_CHAIN_MAX_DELAY_SECONDS: parseInt(process.env.WARMUP_CHAIN_MAX_DELAY || '360', 10),

  // Threading
  MIN_MESSAGES_PER_THREAD: 3,
  MAX_MESSAGES_PER_THREAD: 6,
  MIN_THREAD_INTERVAL_HOURS: 2,
  MAX_THREAD_INTERVAL_HOURS: 8,

  // Send delays (seconds)
  MIN_SEND_DELAY_SECONDS: 30,
  MAX_SEND_DELAY_SECONDS: 90,

  // Per-mailbox stagger when creating threads (minutes)
  // Spreads out seed email arrival from 500+ mailboxes to avoid spike.
  // Total delay = random(PER_THREAD_STAGGER_MAX_MINUTES) + random(MIN_SEND_DELAY_SECONDS..MAX_SEND_DELAY_SECONDS)
  PER_THREAD_STAGGER_MAX_MINUTES: parseInt(process.env.WARMUP_THREAD_STAGGER_MINUTES || '30', 10),

  // Reply expectation (minutes)
  // Seeds reply fast (1-5min). User mailboxes get their own pacing via ramp limits.
  MIN_REPLY_EXPECTATION_MINUTES: parseInt(process.env.WARMUP_MIN_REPLY_EXPECTATION_MINUTES || '1', 10),
  MAX_REPLY_EXPECTATION_MINUTES: parseInt(process.env.WARMUP_MAX_REPLY_EXPECTATION_MINUTES || '5', 10),

  // Seed-to-user reply pacing (minutes)
  // After each seed email, the next reply is delayed by this range.
  // Progressively increases: reply 1 = 5-10min, reply 2 = 8-18min, reply 3 = 12-28min
  SEED_REPLY_MIN_DELAY_MINUTES: 5,
  SEED_REPLY_MAX_DELAY_MINUTES: 15,

  HIDDEN_FOLDER_NAME: process.env.WARMUP_HIDDEN_FOLDER || '.Warmup-Archive',
  IMAP_TIMEOUT_MS: parseInt(process.env.WARMUP_IMAP_TIMEOUT_MS || '15000', 10),

  // Scheduler intervals (ms)
  ENROLLMENT_SCAN_INTERVAL_MS: 5 * 60 * 1000,
  POOL_HEALTH_INTERVAL_MS: 5 * 60 * 1000,
  SPAM_RESCUE_INTERVAL_MS: 30 * 60 * 1000,
  THREAD_SCHEDULER_INTERVAL_MS: 60 * 1000,
  INBOX_SWEEP_INTERVAL_MS: 5 * 60 * 1000,

  // BullMQ
  OUTBOUND_QUEUE_NAME: 'warmup-outbound',
  INBOUND_QUEUE_NAME: 'warmup-inbound',
  OUTBOUND_CONCURRENCY: parseInt(process.env.WARMUP_OUTBOUND_CONCURRENCY || '5', 10),
  INBOUND_CONCURRENCY: parseInt(process.env.WARMUP_INBOUND_CONCURRENCY || '5', 10),

  // Retry / backoff
  MAX_SEND_ATTEMPTS: 3,
  MAX_IMAP_ATTEMPTS: 3,

  // Ramp schedule — percentage of final daily warmup target
  // Gradually increase warmup volume to avoid ISP rate limiting and flagging.
  // Day 1-2:   20%   (e.g. ~3/day if target=15)
  // Day 3-5:   40%   (e.g. ~6/day)
  // Day 6-10:  60%   (e.g. ~9/day)
  // Day 11-14: 80%   (e.g. ~12/day)
  // Day 15+:   100%  (full target 15/day)
  RAMP_DAILY_PERCENTS: [
    { maxDays: 2, percent: 0.20 },
    { maxDays: 5, percent: 0.40 },
    { maxDays: 10, percent: 0.60 },
    { maxDays: 14, percent: 0.80 },
  ] as const,

  // Domain clustering
  DOMAIN_CLUSTER_SCAN_INTERVAL_MS: parseInt(process.env.WARMUP_DOMAIN_SCAN_INTERVAL || '300000', 10),
  ANCHOR_REBALANCE_INTERVAL_MS: parseInt(process.env.WARMUP_ANCHOR_REBALANCE_INTERVAL || '600000', 10),

  // Anchor / seed thresholds
  ANCHORS_PER_DOMAIN: parseInt(process.env.WARMUP_ANCHORS_PER_DOMAIN || '2', 10),
  MAX_MEMBERS_PER_ANCHOR: parseInt(process.env.WARMUP_MAX_MEMBERS_PER_ANCHOR || '50', 10),
  SEED_MAX_PARTNERS: parseInt(process.env.WARMUP_SEED_MAX_PARTNERS || '10', 10),
  SEED_DAILY_LIMIT: parseInt(process.env.WARMUP_SEED_DAILY_LIMIT || '400', 10),
  SEED_COOLDOWN_AFTER_EXHAUSTED_MS: 2 * 60 * 60 * 1000,

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