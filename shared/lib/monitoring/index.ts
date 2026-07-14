/**
 * ─── MONITORING EXPORTS ─────────────────────────────────────────────────────────
 * Central re-exports for all SRE observability, fault-tolerance, and alerting.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export {
  createStructuredLogger,
  generateCorrelationId,
  type StructuredLogger,
} from './structured-logger.js';

export {
  CircuitBreaker,
  getCircuitBreaker,
  isTransientSMTPError,
  type CircuitBreakerConfig,
} from './circuit-breaker.js';

export {
  startHeartbeat,
  writeHeartbeat,
  HealthMonitor,
} from './health-heartbeat.js';

export {
  WorkerDiscoveryRegistry,
  type WorkerAssignment,
  type MailboxOwner,
} from './worker-discovery-registry.js';

export {
  MailboxReassignmentWatchdog,
  type OrphanedMailbox,
} from './mailbox-reassignment-watchdog.js';

export { startMemoryWatchdog } from './memory-watchdog.js';
