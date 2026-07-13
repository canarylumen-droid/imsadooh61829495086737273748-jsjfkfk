/**
 * IMAP Redis Key Schema
 * Shared across email-worker and email-service to ensure lock synchronization.
 */

export const IMAP_KEYS = {
  /** Hash: { workerId, userId, host, status, connectedAt, lastHeartbeat } TTL 35m */
  active: (integrationId: string) => `imap:active:${integrationId}`,

  /** Set of integrationIds owned by this worker replica */
  workerSet: (workerId: string) => `imap:worker:${workerId}:integrations`,

  /** SortedSet: score=connectionCount, member=workerId */
  workerLoad: () => `imap:worker:load`,

  /** Hash: { state, failures, lastFailure, nextRetry } TTL 15m */
  circuit: (host: string) => `imap:circuit:${host}`,

  /** List of integrationIds that need reassignment after a worker crash */
  orphans: () => `imap:orphans`,

  /** String: ACTIVE | ORPHANED | NEEDS_REAUTH | PAUSED | DISABLED  TTL 7d */
  integrationState: (integrationId: string) => `imap:integration:${integrationId}:state`,
} as const;

export const IMAP_TTL = {
  /** 35 minutes — slightly longer than the 29-min proactive recycle window */
  active: 35 * 60,
  /** 15 minutes — circuit breaker cool-off period */
  circuit: 15 * 60,
  /** 7 days — integration state cache */
  state: 7 * 24 * 60 * 60,
} as const;

export const CIRCUIT_BREAKER = {
  /** Number of failures within the window before opening the circuit */
  FAILURE_THRESHOLD: 5,
  /** Rolling window in ms for counting failures */
  WINDOW_MS: 60_000,
  /** How long the circuit stays open before allowing a retry */
  COOL_OFF_MS: 15 * 60 * 1000,
} as const;
