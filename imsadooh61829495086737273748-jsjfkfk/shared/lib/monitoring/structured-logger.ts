/**
 * ─── STRUCTURED LOGGER WITH CORRELATION CONTEXT ───────────────────────────────
 *
 * Wraps the existing createLogger to inject:
 *  - mailboxId    — tracks which mailbox/integration is active
 *  - podId        — ECS task ID / Railway replica ID / K8s pod name
 *  - correlationId — request/job trace ID for end-to-end observability
 *
 * All logs are emitted as JSON so they can be ingested by CloudWatch, Datadog,
 * or any unified log sink.
 *
 * Usage:
 *   import { createStructuredLogger } from '@shared/lib/monitoring/structured-logger.js';
 *   const log = createStructuredLogger('EMAIL-SYNC', { mailboxId: 'abc123', correlationId: 'req-42' });
 *   log.info('SMTP connected', { provider: 'gmail', latencyMs: 45 });
 *
 * Output:
 *   {"timestamp":"2026-05-29T...","service":"EMAIL-SYNC","mailboxId":"abc123","podId":"task-001","correlationId":"req-42","level":"INFO","message":"SMTP connected","data":{"provider":"gmail","latencyMs":45}}
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger, ServiceLogger } from '@services/api-gateway/src/core/logger.js';

interface LoggerContext {
  mailboxId?: string;
  podId?: string;
  correlationId?: string;
  userId?: string;
  campaignId?: string;
}

function getPodId(): string {
  // AWS ECS Fargate
  if (process.env.ECS_CONTAINER_METADATA_URI_V4 || process.env.ECS_CONTAINER_METADATA_URI) {
    return process.env.ECS_TASK_ID || 'ecs-unknown';
  }
  // Railway
  if (process.env.RAILWAY_REPLICA_ID) {
    return process.env.RAILWAY_REPLICA_ID;
  }
  // Kubernetes
  if (process.env.HOSTNAME) {
    return process.env.HOSTNAME;
  }
  return 'local';
}

export interface StructuredLogger extends ServiceLogger {
  withContext(ctx: LoggerContext): StructuredLogger;
}

export function createStructuredLogger(
  serviceName: string,
  baseContext?: LoggerContext
): StructuredLogger {
  const podId = getPodId();
  const ctx: LoggerContext = { podId, ...baseContext };
  const baseLogger = createLogger(serviceName);

  function emit(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any) {
    const entry = {
      timestamp: new Date().toISOString(),
      service: serviceName,
      podId: ctx.podId,
      ...(ctx.mailboxId && { mailboxId: ctx.mailboxId }),
      ...(ctx.correlationId && { correlationId: ctx.correlationId }),
      ...(ctx.userId && { userId: ctx.userId }),
      ...(ctx.campaignId && { campaignId: ctx.campaignId }),
      level: level.toUpperCase(),
      message,
      ...(data && { data }),
    };

    const json = JSON.stringify(entry);

    if (level === 'error') {
      console.error(json);
    } else if (level === 'warn') {
      console.warn(json);
    } else {
      console.log(json);
    }
  }

  const logger: StructuredLogger = {
    debug: (msg, data) => emit('debug', msg, data),
    info:  (msg, data) => emit('info',  msg, data),
    warn:  (msg, data) => emit('warn',  msg, data),
    error: (msg, data) => emit('error', msg, data),
    reasoning: baseLogger.reasoning,
    child: (sub) => createStructuredLogger(`${serviceName}:${sub}`, ctx),
    withContext: (newCtx) => createStructuredLogger(serviceName, { ...ctx, ...newCtx }),
  };

  return logger;
}

/** Generate a unique correlation ID for tracing requests/jobs */
export function generateCorrelationId(prefix?: string): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return prefix ? `${prefix}-${id}` : id;
}
