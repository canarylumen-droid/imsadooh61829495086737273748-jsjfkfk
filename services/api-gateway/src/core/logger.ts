/**
 * ─── STRUCTURED LOGGER ────────────────────────────────────────────────────────
 * 
 * Tagged structured logger for all microservices.
 * Each service tags its logs with its name so Railway log streams are readable.
 * 
 * Usage:
 *   import { createLogger } from "./logger.js";
 *   const log = createLogger('EMAIL-SYNC');
 *   log.info('IMAP connected', { integrationId: '...' });
 * 
 * Output:
 *   2026-04-26T18:00:00Z [EMAIL-SYNC] INFO  IMAP connected {"integrationId":"..."}
 * ─────────────────────────────────────────────────────────────────────────────
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  data?: any;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

function formatEntry(entry: LogEntry): string {
  const dataStr = entry.data
    ? ' ' + JSON.stringify(entry.data, null, 0)
    : '';
  return `${entry.timestamp} [${entry.service}] ${entry.level.toUpperCase().padEnd(5)} ${entry.message}${dataStr}`;
}

function emit(service: string, level: LogLevel, message: string, data?: any) {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    service,
    level,
    message,
    data,
  };

  const formatted = formatEntry(entry);

  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export interface ServiceLogger {
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
  /** Log agent reasoning for auditable behavior */
  reasoning(message: string, data?: any): void;
  /** Create a child logger with an additional sub-context tag */
  child(subContext: string): ServiceLogger;
}

/**
 * Create a structured logger for a named service.
 * @param serviceName - e.g. 'EMAIL-SYNC', 'AI-AGENT', 'ORCHESTRATOR'
 */
export function createLogger(serviceName: string): ServiceLogger {
  const logger: ServiceLogger = {
    debug: (msg, data) => emit(serviceName, 'debug', msg, data),
    info:  (msg, data) => emit(serviceName, 'info',  msg, data),
    warn:  (msg, data) => emit(serviceName, 'warn',  msg, data),
    error: (msg, data) => emit(serviceName, 'error', msg, data),
    reasoning: (msg, data) => {
      // reasoning is like info but specifically for AI thought process
      emit(serviceName, 'info' as any, `🧠 [REASONING] ${msg}`, data);
      
      // Optionally dispatch to audit queue if available (dynamic import to avoid circular dependency)
      try {
        import('./queues.js').then(({ auditQueue }) => {
          if (auditQueue) {
            auditQueue.add('log-reasoning', {
              service: serviceName,
              message: msg,
              data,
              timestamp: new Date().toISOString()
            }).catch(() => {});
          }
        });
      } catch (e) {}
    },
    child: (sub) => createLogger(`${serviceName}:${sub}`),
  };
  return logger;
}

/** Root system logger for bootstrap/core */
export const systemLog = createLogger('SYSTEM');
