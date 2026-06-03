/**
 * Warmup Service Configuration
 * All values are ENV-driven with sensible defaults.
 */

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

  // IMAP stealth
  HIDDEN_FOLDER_NAME: process.env.WARMUP_HIDDEN_FOLDER || '.Audnix-Warmup',
  IMAP_TIMEOUT_MS: parseInt(process.env.WARMUP_IMAP_TIMEOUT_MS || '15000', 10),

  // Scheduler intervals (ms)
  ENROLLMENT_SCAN_INTERVAL_MS: 5 * 60 * 1000,      // 5 min
  POOL_HEALTH_INTERVAL_MS: 5 * 60 * 1000,           // 5 min
  SPAM_RESCUE_INTERVAL_MS: 30 * 60 * 1000,          // 30 min
  THREAD_SCHEDULER_INTERVAL_MS: 60 * 1000,          // 1 min
  INBOX_SWEEP_INTERVAL_MS: 2 * 60 * 1000,           // 2 min

  // BullMQ
  OUTBOUND_QUEUE_NAME: 'warmup-outbound',
  INBOUND_QUEUE_NAME: 'warmup-inbound',
  OUTBOUND_CONCURRENCY: parseInt(process.env.WARMUP_OUTBOUND_CONCURRENCY || '5', 10),
  INBOUND_CONCURRENCY: parseInt(process.env.WARMUP_INBOUND_CONCURRENCY || '5', 10),

  // LLM
  LLM_MAX_TOKENS: 200,
  LLM_TEMPERATURE: 0.8,

  // Retry / backoff
  MAX_SEND_ATTEMPTS: 3,
  MAX_IMAP_ATTEMPTS: 3,
} as const;
