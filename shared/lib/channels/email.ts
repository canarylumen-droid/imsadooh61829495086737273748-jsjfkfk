import { generateBrandedEmail, generateMeetingEmail, type BrandColors } from "@services/brain-worker/src/ai-lib/formatters/dm-formatter.js";
import { storage } from '@shared/lib/storage/storage.js';
import * as cheerio from 'cheerio';
import { type Integration } from '@audnix/shared';
import dns from 'dns';
import { existsSync } from 'fs';

const USE_RUST_BACKEND = process.env.NEW_EMAIL_BACKEND !== 'node';
const RUST_BINARY = process.env.RUST_EMAIL_SENDER_PATH || '/usr/local/bin/audnix-email-sender';
const RUST_IMAP_BINARY = process.env.RUST_IMAP_WORKER_PATH || '/usr/local/bin/audnix-imap-worker';

// Check common paths for Rust binary
const RUST_PATHS = [
  RUST_BINARY,
  '/usr/local/bin/audnix-email-sender',
  '/usr/bin/audnix-email-sender',
  'rust-email-sender/target/release/audnix-email-sender',
  './rust-email-sender/target/release/audnix-email-sender',
];
const RUST_IMAP_PATHS = [
  RUST_IMAP_BINARY,
  '/usr/local/bin/audnix-imap-worker',
  '/usr/bin/audnix-imap-worker',
  'rust-imap-worker/target/release/audnix-imap-worker',
  './rust-imap-worker/target/release/audnix-imap-worker',
];

let RUST_AVAILABLE = false;
let RUST_ACTUAL_PATH = '';
for (const p of RUST_PATHS) {
  try {
    if (existsSync(p)) {
      RUST_AVAILABLE = true;
      RUST_ACTUAL_PATH = p;
      break;
    }
  } catch {}
}
if (!RUST_AVAILABLE) {
  console.warn('[Email] Rust email sender binary not found — using NodeMailer fallback');
}

let RUST_IMAP_AVAILABLE = false;
let RUST_IMAP_ACTUAL_PATH = '';
for (const p of RUST_IMAP_PATHS) {
  try {
    if (existsSync(p)) {
      RUST_IMAP_AVAILABLE = true;
      RUST_IMAP_ACTUAL_PATH = p;
      break;
    }
  } catch {}
}
if (!RUST_IMAP_AVAILABLE) {
  console.warn('[Email] Rust IMAP worker binary not found — using Node.js IMAP fallback');
}


/**
 * Email messaging functions with branded templates using extracted PDF brand colors
 */

interface EmailConfig {
  smtp_host?: string;
  smtp_port?: number;
  imap_host?: string;
  imap_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  from_name?: string;
  oauth_token?: string;
  provider?: 'gmail' | 'outlook' | 'smtp' | 'custom';
}

interface EmailCredentials {
  accessToken: string;
  email: string;
}

interface ImportedEmail {
  from: string | undefined;
  to: string | undefined;
  subject: string | undefined;
  text: string | undefined;
  html: string | undefined;
  date: Date | undefined;
}

interface GmailMessage {
  id: string;
  threadId: string;
}

interface OutlookMessage {
  id: string;
  subject: string;
  receivedDateTime: string;
  from?: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
}

interface GmailApiResponse {
  messages?: GmailMessage[];
  error?: {
    message?: string;
  };
}

interface OutlookApiResponse {
  value?: OutlookMessage[];
  error?: {
    message?: string;
  };
}

interface GmailSendResponse {
  id?: string;
  threadId?: string;
  error?: {
    message?: string;
  };
}

interface OutlookSendResponse {
  error?: {
    message?: string;
  };
}

interface ParsedEmailAddress {
  text?: string;
}

interface ParsedEmail {
  from?: ParsedEmailAddress;
  to?: ParsedEmailAddress;
  subject?: string;
  text?: string;
  html?: string;
  date?: Date;
}

import { CircuitBreaker, isTransientSMTPError, getCircuitBreaker } from '@shared/lib/monitoring/circuit-breaker.js';
import { createStructuredLogger, generateCorrelationId } from '@shared/lib/monitoring/structured-logger.js';

/**
 * Auto-discover SMTP/IMAP settings based on email address
 */
export function autoDiscoverSettings(email: string): Partial<EmailConfig> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return {};

  const providers: Record<string, Partial<EmailConfig>> = {
    'gmail.com': {
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      provider: 'gmail'
    },
    'outlook.com': {
      smtp_host: 'smtp-mail.outlook.com',
      smtp_port: 587,
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      provider: 'outlook'
    },
    'hotmail.com': {
      smtp_host: 'smtp-mail.outlook.com',
      smtp_port: 587,
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      provider: 'outlook'
    },
    'yahoo.com': {
      smtp_host: 'smtp.mail.yahoo.com',
      smtp_port: 465,
      imap_host: 'imap.mail.yahoo.com',
      imap_port: 993,
      provider: 'smtp'
    },
    'icloud.com': {
      smtp_host: 'smtp.mail.me.com',
      smtp_port: 587,
      imap_host: 'imap.mail.me.com',
      imap_port: 993,
      provider: 'smtp'
    }
  };

  return providers[domain] || {};
}

// DELETED local tracking functions - moving to centralized lib/email/email-tracking.ts

/**
 * Global 50ms fallback: try Rust binary first via Redis queue.
 * If timeout >50ms or error, instantly switch to Node/TS implementation.
 */
async function withRustFallback<T>(
  operationName: string,
  redisTask: () => Promise<string>,
  nodeImpl: () => Promise<T>,
  timeoutMs: number = 3000
): Promise<T> {
  const useRust = USE_RUST_BACKEND && RUST_AVAILABLE;
  if (!useRust) return nodeImpl();

  try {
    const { getRedisClient } = await import('@shared/lib/redis/redis.js');
    const redis = await getRedisClient();
    if (!redis) throw new Error('Redis unavailable');

    const jobId = await redisTask();
    const pollStart = Date.now();
    while (Date.now() - pollStart < timeoutMs) {
      // Rust email sender pushes to "email-send-results" list (not keyed by jobId)
      // Pop all results looking for our jobId
      const result = await (redis as any).brPop('email-send-results', 0.1);
      if (result) {
        const parsed = JSON.parse(result[1]);
        if (parsed.job_id === jobId) {
          if (parsed.status === 'sent') return { messageId: parsed.job_id } as T;
          throw new Error(parsed.error || 'Rust send failed');
        }
        // Not our job — push back for another consumer
        await (redis as any).lPush('email-send-results', result[1]);
      }
    }
    throw new Error('timeout');
  } catch (err: any) {
    if (err.message === 'timeout' || err.message === 'Redis unavailable') {
      console.warn(`[Fallback] ${operationName}: Rust backend (>${timeoutMs}ms), switching to Node`);
    } else {
      console.warn(`[Fallback] ${operationName}: Rust error (${err.message}), switching to Node`);
    }
    return nodeImpl();
  }
}

/**
 * Send email via custom SMTP (for custom domain emails)
 */

const smtpPools = new Map<string, any>();
const dnsCache = new Map<string, { ip: string, expires: number }>();

async function resolveSmtpHost(hostname: string): Promise<string> {
  // If it's already an IP address, return it
  if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname)) return hostname;

  const now = Date.now();
  const cached = dnsCache.get(hostname);
  if (cached && cached.expires > now) return cached.ip;

  try {
    const dnsPromises = await import('dns/promises');
    const records = await dnsPromises.resolve4(hostname);
    if (records && records.length > 0) {
      dnsCache.set(hostname, { ip: records[0], expires: now + 5 * 60 * 1000 });
      return records[0];
    }
  } catch (err: any) {
    console.warn(`[CustomSMTP] DNS resolve4 failed for ${hostname}:`, err.message, `- falling back to hostname`);
  }
  return hostname;
}

// Keep connections warm and evict dead ones
setInterval(() => {
  smtpPools.forEach((pool, key) => {
    if (pool.isIdle && pool.isIdle()) {
      pool.verify().catch(() => {
        console.log(`[CustomSMTP] Evicting dead pool ${key} during health check`);
        try { pool.close(); } catch (e) { console.warn('[CustomSMTP] Failed to close pool:', (e as Error)?.message); }
        smtpPools.delete(key);
      });
    }
  });
}, 5 * 60 * 1000);

/**
 * Send email via custom SMTP (for custom domain emails)
 * Includes exponential backoff for transient failures
 */
async function sendCustomSMTP(
  userId: string,
  config: EmailConfig,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  trackingId?: string,
  integrationId?: string,
  inReplyTo?: string,
  references?: string,
  replyTo?: string,
  leadId?: string
): Promise<{ messageId: string }> {
  const nodemailer = await import('nodemailer');
  const dns = await import('dns');
  const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');

  const emailBody = body;

  const cacheKey = integrationId || `${config.smtp_host}:${parseInt(String(config.smtp_port)) || 587}:${config.smtp_user}`;

  // NOTE: We intentionally do NOT pre-resolve the hostname to an IP here.
  // Domains like mail.privatemail.com have their A-records pointing to Cloudflare CDN IPs
  // which do NOT serve SMTP traffic. nodemailer's built-in family:4 + lookup override below
  // correctly forces IPv4 while allowing proper SMTP-specific DNS resolution.
  const createTransporterPool = (forcedPort?: number, forcedSecure?: boolean) => {
    const transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 500,
      host: config.smtp_host,
      port: forcedPort || parseInt(String(config.smtp_port)) || 587,
      secure: forcedSecure !== undefined ? forcedSecure : (parseInt(String(config.smtp_port)) === 465),
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
      // Forced IPv4 at the library level for extra safety
      family: 4,
      lookup: (hostname: string, options: any, callback: any) => {
        return dns.lookup(hostname, { family: 4 }, callback);
      },
      tls: { 
        rejectUnauthorized: false,
        servername: config.smtp_host, // SNI must use the original hostname, not the IP
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 60000,
    } as any);

    transporter.on('error', (err: any) => {
      console.error(`[CustomSMTP] Pool error for ${cacheKey}:`, err.message);
      smtpPools.delete(cacheKey);
    });

    return transporter;
  };

  // Initialize pool if not cached; re-acquired per-attempt to pick up ENETUNREACH evictions
  if (!smtpPools.has(cacheKey)) {
    console.log(`[CustomSMTP] Creating new persistent connection pool for ${cacheKey} via ${config.smtp_host}:${config.smtp_port || 587}`);
    smtpPools.set(cacheKey, createTransporterPool());
  }

  const messageId = `<${import.meta.url ? (await import('crypto')).randomUUID() : Date.now() + Math.random()}@${config.smtp_user?.split('@')[1] || 'audnixai.com'}>`;

  const fromAddress = config.from_name
    ? `"${config.from_name}" <${config.smtp_user}>`
    : config.smtp_user;

  const correlationId = generateCorrelationId('smtp');
  const smtpLog = createStructuredLogger('SMTP', {
    correlationId,
    mailboxId: integrationId || config.smtp_user,
  });

  // Circuit breaker: identify provider from host
  const providerName = config.smtp_host?.split('.')[0] || 'unknown';
  const breaker = getCircuitBreaker(providerName);

  if (await breaker.isOpen()) {
    smtpLog.error('SMTP circuit breaker OPEN — skipping send', { provider: providerName, to });
    throw new Error(`SMTP circuit breaker OPEN for ${providerName}`);
  }

  const MAX_RETRIES = 3;
  let lastError: any = null;
  let currentForcedPort: number | undefined;
  let currentForcedSecure: boolean | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s (for all transient errors including 421/451)
        const delay = Math.pow(2, attempt) * 1000;
        smtpLog.warn('SMTP retry attempt', { attempt, to, delayMs: delay, provider: providerName });
        await new Promise(res => setTimeout(res, delay));
      }

      // Re-acquire each iteration — pool may have been evicted by ENETUNREACH handler
      let transporter = smtpPools.get(cacheKey);
      if (!transporter || (currentForcedPort && parseInt(String((transporter as any).options?.port)) !== parseInt(String(currentForcedPort)))) {
        smtpLog.info('SMTP re-creating connection pool', { cacheKey, attempt: attempt + 1, port: currentForcedPort });
        transporter = createTransporterPool(currentForcedPort, currentForcedSecure);
        smtpPools.set(cacheKey, transporter);
      }

      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        [isHtml ? 'html' : 'text']: emailBody,
        messageId: messageId.replace(/[<>]/g, ''), // nodemailer adds brackets
        ...(inReplyTo && { inReplyTo }),
        ...(references && { references }),
        ...(replyTo && { replyTo })
      });

      // If we reach here, it worked!
      smtpLog.info('SMTP send succeeded', { to, attempt: attempt + 1, messageId: info.messageId, provider: providerName });
      await breaker.recordSuccess();

      // Attempt to save to "Sent" folder via background IMAP connection
      // We DO NOT await this because it can be slow and shouldn't block the actual email delivery
      try {
        const rawMessage = createMimeMessage(fromAddress || '', to, subject, emailBody, isHtml, messageId, inReplyTo, references, replyTo, leadId);
        
        const backgroundAppend = async () => {
          try {
            if (integrationId) {
              await imapIdleManager.appendSentMessage(userId, integrationId, rawMessage, config);
            } else {
              const int = await storage.getIntegration(userId, 'custom_email');
              if (int) await imapIdleManager.appendSentMessage(userId, int.id, rawMessage, config);
            }
          } catch (err) {
            console.error(`[CustomSMTP/Background] ❌ Background Sent Folder sync failed:`, err);
          }
        };

        // Fire and forget
        backgroundAppend().catch(e => console.error('[CustomSMTP/Background] Primary failure:', e));
      } catch (error) {
        console.error(`[CustomSMTP] ❌ Failed to prepare background sync:`, error);
      }

      return { messageId: info.messageId }; // Exit function successfully
    } catch (error: any) {
      lastError = error;
      // ENETUNREACH: IPv6 route missing on Railway/cloud infra — treat as transient.
      // Evict the pool so the next retry builds a fresh IPv4-only connection.
      const isNetworkUnreachable = error.code === 'ENETUNREACH' || error.code === 'EHOSTUNREACH';
      const isTimeout = error.code === 'ETIMEDOUT' || error.message?.includes('timeout') || error.code === 'ECONNRESET';
      
      if (isNetworkUnreachable || isTimeout) {
        const diagnostic = isTimeout ? "Check if port 25/587 is blocked by your hosting provider (Railway often blocks port 25)." : "Check network connectivity.";
        console.warn(`[CustomSMTP] ⚠️ ${error.code || 'Timeout'} on attempt ${attempt + 1} — purging stale pool for ${cacheKey} and retrying... (${diagnostic})`);
        
        // Phase 25: True Port Cycling for robust failure recovery
        if (isTimeout) {
          const PORT_CYCLE: Record<number, number[]> = {
            465:  [465, 587, 2525],
            587:  [587, 465, 2525],
            2525: [2525, 465, 587],
          };
          const basePort = parseInt(String(config.smtp_port)) || 587;
          const cycle = PORT_CYCLE[basePort] || [587, 465, 2525];
          
          const currentIdx = currentForcedPort ? cycle.indexOf(parseInt(String(currentForcedPort))) : 0;
          if (currentIdx < cycle.length - 1) {
            currentForcedPort = cycle[currentIdx + 1];
            currentForcedSecure = parseInt(String(currentForcedPort)) === 465;
            console.info(`[CustomSMTP] 🛡️ Timeout detected. Attempting automatic failover to Port ${currentForcedPort} for next retry...`);
          }
        }

        try { smtpPools.get(cacheKey)?.close(); } catch (_) {}
        smtpPools.delete(cacheKey); 
      }

      if (attempt === MAX_RETRIES) {
        const errorDetail = error.code === 'ECONNRESET' ? 'Connection reset by SMTP server (check credentials/port)' :
          error.message?.includes('socket') ? 'SMTP socket closed unexpectedly (wrong port or TLS mode)' :
          error.code === 'ETIMEDOUT' ? 'Connection timed out (firewall blocking port)' :
          error.message;
        smtpLog.error('SMTP permanent failure after retries', { to, error: errorDetail, code: error.code, provider: providerName, host: config.smtp_host, port: currentForcedPort || config.smtp_port });
        if (isTimeout) smtpLog.error('SMTP tip: ensure port 587 (STARTTLS) or 465 (SSL) is open', { provider: providerName });
        if (isTransientSMTPError(error)) {
          await breaker.recordFailure();
        }
        throw new Error(errorDetail);
      }

      // Record transient failure for circuit breaker tracking on intermediate attempts too
      if (isTransientSMTPError(error)) {
        await breaker.recordFailure();
      }

      smtpLog.warn('SMTP transient failure', { to, attempt: attempt + 1, error: error.message, code: error.code, provider: providerName });
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to send email after retries');
}


/**
 * Import emails from custom IMAP server
 */
export async function importCustomEmails(
  config: EmailConfig,
  limit: number = 50,
  timeoutMs: number = 120000,
  mailbox: string = 'INBOX'
): Promise<ImportedEmail[]> {
  const Imap = (await import('imap')).default;
  const { simpleParser } = await import('mailparser');

  const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
  const imapPort = config.imap_port || 993;

  if (!imapHost) {
    throw new Error('IMAP host not configured. Please provide explicit IMAP settings.');
  }

  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        let timeoutHandle: NodeJS.Timeout | null = null;
        let completed = false;
        let connectionEnded = false;

        const imap = new Imap({
          user: config.smtp_user!,
          password: config.smtp_pass!,
          host: imapHost,
          port: imapPort,
          tls: imapPort === 993,
          // Force IPv4 to avoid EDNS / EAI_AGAIN DNS failures in cloud environments
          family: 4,
          tlsOptions: { rejectUnauthorized: false },
          connTimeout: 45000, // Increased to 45s
          authTimeout: 45000, // Increased to 45s
          keepalive: false,   // Disable keepalive for one-off fetch
          debug: (msg: string) => {
            if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) return;
            // console.log(`[IMAP DEBUG] ${msg}`); // Uncomment for debugging
          }
        } as any);

        const safeEnd = () => {
          try {
            if (imap.state !== 'disconnected') imap.end();
          } catch (err) {
            // Ignore
          }
        };

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
        };

        const emails: ImportedEmail[] = [];

        const startFetch = (targetBox: any) => {
          if (!targetBox || !targetBox.messages || targetBox.messages.total === 0) {
            safeEnd();
            return;
          }
          const total = targetBox.messages.total;
          const fetchRange = total <= limit ? `1:${total}` : `${total - limit + 1}:${total}`;
          const fetch = imap.seq.fetch(fetchRange, { bodies: '', struct: true });

          fetch.on('message', (msg: any) => {
            msg.on('body', (stream: NodeJS.ReadableStream) => {
              simpleParser(stream as any, (parseErr: Error | null, parsed: any) => {
                if (!parseErr && parsed) {
                  emails.push({
                    from: parsed.from?.text,
                    to: parsed.to?.text,
                    subject: parsed.subject,
                    text: parsed.text,
                    html: parsed.html,
                    date: parsed.date
                  });
                }
              });
            });
          });

          fetch.once('error', (err: Error) => {
            cleanup();
            safeEnd();
            reject(new Error(`Failed to fetch emails: ${err.message}`));
          });

          fetch.once('end', () => {
            safeEnd();
          });
        };

        imap.once('ready', () => {
          // @ts-ignore
          imap.openBox(mailbox, true, async (err: Error | null, box: any) => {
            if (err) {
              // If folder not found, try with INBOX. prefix
              if (!mailbox.startsWith('INBOX.') && err.message.toLowerCase().includes('nonexistent')) {
                const prefixedMailbox = `INBOX.${mailbox}`;
                console.log(`[IMAP] Folder ${mailbox} not found, retrying with ${prefixedMailbox}`);
                imap.openBox(prefixedMailbox, true, (err3, box3) => {
                  if (!err3) {
                    startFetch(box3);
                  } else {
                    handleOpenError(err); // Original error
                  }
                });
                return;
              }
              handleOpenError(err);
            } else {
              startFetch(box);
            }
          });

          async function handleOpenError(handleErr: Error) {
            if (mailbox === 'Sent' || mailbox === 'Sent Items') {
              try {
                const boxes: any = await new Promise((res, rej) => imap.getBoxes((e, b) => e ? rej(e) : res(b)));
                const sentPatterns = ['sent', 'sent items', 'sent mail', 'sent messages', '[gmail]/sent mail', 'sent-mail'];

                const findBox = (obj: any, prefix = ''): string | null => {
                  for (const key in obj) {
                    const fullName = prefix + key;
                    if (sentPatterns.includes(key.toLowerCase())) return fullName;
                    if (obj[key].children) {
                      const found = findBox(obj[key].children, fullName + (obj[key].delimiter || '/'));
                      if (found) return found;
                    }
                  }
                  return null;
                };

                const discoveredSent = findBox(boxes);
                if (discoveredSent) {
                  console.log(`[IMAP] Discovered Sent folder: ${discoveredSent}`);
                  imap.openBox(discoveredSent, true, (err2, box2) => {
                    if (err2) {
                      cleanup(); safeEnd();
                      reject(new Error(`Failed to open discovered box ${discoveredSent}: ${err2.message}`));
                    } else {
                      startFetch(box2);
                    }
                  });
                  return;
                }
              } catch (e) {
                console.warn('[IMAP] Sent discovery failed', e);
              }
            }
            cleanup();
            safeEnd();
            reject(new Error(`Failed to open ${mailbox}: ${handleErr.message}`));
          }
        });

        imap.once('error', (err: Error) => {
          if (!completed) {
            cleanup();
            // Don't safeEnd here necessarily, as error might have closed it
            connectionEnded = true;

            let errorMessage = `IMAP connection error: ${err.message}`;
            if (err.message.toLowerCase().includes('enotfound') || err.message.toLowerCase().includes('not found')) {
              errorMessage = `IMAP Host not found: "${config.imap_host}". Please check the hostname and try again.`;
            } else if (err.message.toLowerCase().includes('etimedout') || err.message.toLowerCase().includes('timeout')) {
              errorMessage = `Connection to IMAP server timed out. Check your firewall settings or port ${imapPort}.`;
            } else if (err.message.toLowerCase().includes('econnrefused')) {
              errorMessage = `IMAP Connection refused by the server. Verify your port ${imapPort} and SSL settings.`;
            }
            reject(new Error(errorMessage));
          }
        });

        imap.once('end', () => {
          if (!completed) {
            cleanup();
            connectionEnded = true;
            resolve(emails);
          }
        });

        imap.connect();
      });
    } catch (error: any) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const isTimeout = error.message.includes('tim') || error.message.includes('TIM'); // catch timeout, ETIMEDOUT, etc.

      if (!isLastAttempt && (isTimeout || error.message.includes('ECONNRESET') || error.message.includes('socket hang up'))) {
        console.warn(`[IMAP] Attempt ${attempt} failed for ${config.smtp_user}: ${error.message}. Retrying in ${BASE_DELAY * attempt}ms...`);
        await new Promise(res => setTimeout(res, BASE_DELAY * attempt));
        continue;
      }

      // If we're out of retries or it's a fatal error, rethrow or return empty based on policy
      if (isLastAttempt) {
        console.error(`[IMAP] All ${MAX_RETRIES} attempts failed for ${config.smtp_user}: ${error.message}`);
        // We resolve empty to avoid crashing the worker, but log the error
        return [];
      }
      throw error; // Propagate other errors
    }
  }
  return [];
}

/**
 * Get brand colors from user's extracted PDF data
 */
async function getUserBrandColors(userId: string): Promise<BrandColors | undefined> {
  try {
    const user = await storage.getUser(userId);
    if (!user) return undefined;

    const metadata = user.metadata as Record<string, unknown> | undefined;
    if (!metadata) return undefined;

    // Check for brand colors from PDF extraction (stored in brand_colors or extracted_brand)
    const brandColors = metadata.brand_colors as Record<string, string> | undefined;
    const extractedBrand = metadata.extracted_brand as { colors?: Record<string, string> } | undefined;

    // Priority: explicit brand_colors > extracted_brand.colors
    const colors = brandColors || extractedBrand?.colors;

    if (colors && (colors.primary || colors.accent || colors.secondary)) {
      return {
        primary: colors.primary || colors.accent || '#3B82F6',
        accent: colors.accent || colors.secondary || colors.primary || '#10B981',
      };
    }

    return undefined;
  } catch (error) {
    console.error('Error fetching brand colors:', error);
    return undefined;
  }
}

// Re-adding missing interface due to previous edit error
export interface EmailOptions {
  isRaw?: boolean; // If true, sends content as-is without branded wrapper
  trackingId?: string;
  brandColors?: BrandColors;
  businessName?: string;
  physicalAddress?: string;
  buttonUrl?: string;
  buttonText?: string;
  isMeetingInvite?: boolean;
  isHtml?: boolean;
  campaignId?: string;
  leadId?: string;
  integrationId?: string;
  allowedIntegrationIds?: string[];
  isPriorityReply?: boolean; // If true, bypasses daily limits and restrictions
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  replyTo?: string;
  /** When true, this is a test/verification send — never processed as a lead reply */
  isTest?: boolean;
}

/**
 * Send email using appropriate provider with optional branding
 * Priority: custom_email (user's SMTP) > gmail > outlook
 */
export async function sendEmail(
  userId: string,
  recipientEmail: string,
  content: string,
  subject: string,
  options: EmailOptions = {}
): Promise<{ messageId: string; integrationId: string }> {
  // ── CROSS-MAILBOX GUARD ────────────────────────────────────────────
  // If the lead exists under a different mailbox, refuse to send from another
  if (options.leadId && options.integrationId) {
    try {
      const leadData = await storage.getLeadById(options.leadId);
      if (leadData && leadData.integrationId && leadData.integrationId !== options.integrationId) {
        throw new Error(
          `This lead is assigned to mailbox ${leadData.integrationId.slice(-8)}. ` +
          `Switch to that mailbox to send messages to this lead.`
        );
      }
    } catch (e: any) {
      if (e.message?.includes('assigned to mailbox')) throw e;
    }
  }

  // 1. Fetch Integration (Specific or Fallback)
  let integration: Integration | undefined;
  if (options.integrationId) {
    integration = await storage.getIntegrationById(options.integrationId);
  }

  // 1.1. Robust Fallback: If requested integration is disconnected or missing, find ANY working one for this user
  if (!integration || !integration.connected) {
    const integrations = await storage.getIntegrations(userId);
    const fallback = integrations.find(i =>
      ['custom_email', 'gmail', 'outlook'].includes(i.provider) &&
      i.connected &&
      (!options.allowedIntegrationIds?.length || options.allowedIntegrationIds.includes(i.id))
    );
    
    if (fallback) {
      if (integration) console.warn(`[EmailService] Integration ${integration.id} is disconnected. Falling back to ${fallback.id}.`);
      integration = fallback;
    }
  }

  if (!integration) {
    throw new Error('Email not connected. Please connect your business email in Settings.');
  }

  // 1.3. Pre-send bounce check — skip if this email has hard-bounced or been marked spam
  if (recipientEmail && !options.isPriorityReply) {
    try {
      const { bounceHandler } = await import('@services/email-service/src/email/bounce-handler.js');
      const shouldSkip = await bounceHandler.shouldSkipBounceEmail(recipientEmail, userId);
      if (shouldSkip) {
        console.warn(`[EmailService] Skipping ${recipientEmail} — previously bounced or spam-flagged`);
        throw new Error(`Email ${recipientEmail} is on the bounce/suppression list.`);
      }
    } catch (skipErr: any) {
      if (skipErr.message.includes('suppression list')) throw skipErr;
      // If bounce handler import fails, continue sending (non-critical)
    }
  }

  // 1.2. Infrastructure-level pause check removed for 24/7 autonomous deployment

  // 1.5. Check Daily Sending Limits (Gmail: 500, Custom: 2500)
  try {
    const { db } = await import('@shared/lib/db/db.js');
    const { messages } = await import('@audnix/shared');
    const { eq, and, sql } = await import('drizzle-orm');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [sentToday] = await db.select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(
        eq(messages.userId, userId),
        eq(messages.integrationId, integration.id),
        eq(messages.direction, 'outbound'),
        sql`${messages.createdAt} >= ${today.toISOString()}`
      ));
    
    // Fetch user Tier to enforce dynamic limits
    const user = await storage.getUser(userId);
    const tier = (user?.subscriptionTier || user?.plan || 'starter').toLowerCase();
    const isEnterprise = tier === 'enterprise';
    
    // NEW HARDENED LIMITS:
    // Gmail/Outlook: Non-Enterprise = 50/day, Enterprise = 1000/day
    // Custom SMTP: 2500/day
    let dailyLimit = 2500;
    
    if (integration.provider === 'gmail' || integration.provider === 'outlook') {
      dailyLimit = isEnterprise ? 1000 : 50;
    }

    const currentSent = Number(sentToday?.count || 0);
    
    if (currentSent >= dailyLimit && !options.isPriorityReply) {
      console.warn(`[EmailService] 🛑 Daily limit reached for ${integration.provider} (${currentSent}/${dailyLimit}). Skipping send to ${recipientEmail}.`);
      throw new Error(`Daily sending limit reached (${dailyLimit}).`);
    } else if (currentSent >= dailyLimit && options.isPriorityReply) {
      console.log(`[EmailService] 🚀 Priority reply allowed to bypass daily limit for ${integration.provider} (${currentSent}/${dailyLimit}).`);
    }
  } catch (limitErr: any) {
    if (limitErr.message.includes('limit reached')) throw limitErr;
    console.error("[EmailService] Limit check failed, continuing anyway:", limitErr);
  }

  // Tracking Setup
  const trackingId = options.trackingId || (await (await import('@services/email-service/src/email/email-tracking.js')).generateTrackingToken());
  const brandColors = options.brandColors || await getUserBrandColors(userId);
  const user = await storage.getUser(userId);
  const businessName = options.businessName || user?.businessName || user?.company || 'Our Team';
  const physicalAddress = options.physicalAddress || (user?.metadata as any)?.physicalAddress || (user?.metadata as any)?.businessAddress;

  // --- PART 1: Custom SMTP ---
  if (integration.provider === 'custom_email') {
    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    if (!integration.encryptedMeta) throw new Error('Email credentials missing');
    const credentials = JSON.parse(await decrypt(integration.encryptedMeta)) as EmailConfig;
    const senderDomain = credentials.smtp_user?.includes('@') ? credentials.smtp_user.split('@')[1] : null;

    const unsubscribeUrl = options.leadId 
      ? `${senderDomain ? `https://${senderDomain}` : (process.env.PUBLIC_URL || 'https://audnixai.com')}/api/unsubscribe/${options.leadId}`
      : undefined;

    let emailBody = content;
    if (!options.isRaw) {
      if (options.buttonUrl && options.buttonText) {
        emailBody = options.isMeetingInvite
          ? generateMeetingEmail(content, options.buttonUrl, brandColors, businessName, unsubscribeUrl, physicalAddress)
          : generateBrandedEmail(content, { text: options.buttonText, url: options.buttonUrl }, brandColors, businessName, unsubscribeUrl, physicalAddress);
      } else {
        emailBody = generateBrandedEmail(content, { text: 'View Details', url: senderDomain ? `https://${senderDomain}` : 'https://audnixai.com' }, brandColors, businessName, unsubscribeUrl, physicalAddress);
      }
    }

    const { injectTrackingIntoEmail, createTrackedEmail } = await import('@services/email-service/src/email/email-tracking.js');
    const trackingResult = await injectTrackingIntoEmail(emailBody, trackingId, senderDomain || undefined);
    emailBody = trackingResult.html;
    const firstUrl = trackingResult.urls.length > 0 ? trackingResult.urls.join(',') : null;

    if (integration.id) {
      try {
        const redis = await import('@shared/lib/redis/redis.js').then(m => m.getRedisClient());
        if (redis) {
          const paused = await redis.get(`rep:paused:${integration.id}`);
          if (paused === 'true') {
            console.warn(`[Email] Mailbox ${integration.id.slice(-8)} is below reputation threshold but sending anyway (warmup mode).`);
          }
        }
      } catch { /* non-critical */ }
    }

    const result = await withRustFallback(
      'send-custom-smtp',
      async () => {
        const { getRedisClient } = await import('@shared/lib/redis/redis.js');
        const redis = await getRedisClient();
        if (!redis) throw new Error('Redis unavailable');
        const jobId = crypto.randomUUID();
        await (redis as any).lPush('email-send-queue', JSON.stringify({
          id: jobId,
          recipient: recipientEmail,
          from: credentials.smtp_user,
          subject,
          body: emailBody,
          smtp_host: credentials.smtp_host,
          smtp_port: credentials.smtp_port,
          smtp_user: credentials.smtp_user,
          smtp_pass: credentials.smtp_pass,
          campaign_id: options.campaignId || null,
          mailbox_id: integration.id || null,
          lead_id: options.leadId || null,
          created_at: new Date().toISOString(),
          retry_count: 0,
          max_retries: 3,
        }));
        return jobId;
      },
      () => sendCustomSMTP(
        userId,
        credentials,
        recipientEmail,
        subject,
        emailBody,
        true,
        trackingId,
        integration.id,
        options.inReplyTo,
        options.references,
        options.replyTo,
        options.leadId
      )
    );

    // Only create tracking record AFTER successful send, so sentAt reflects
    // actual delivery time and we don't record sends that never happened.
    if (!options.isTest) {
      await createTrackedEmail({
        userId,
        leadId: options.leadId || undefined,
        integrationId: integration.id,
        recipientEmail,
        senderEmail: credentials.smtp_user,
        subject,
        sentAt: new Date(),
        messageId: trackingId,
        targetUrl: firstUrl || undefined
      });
    }

    if (result?.messageId && !options.isTest) {
      await storage.createEmailMessage({
        userId,
        leadId: options.leadId || null,
        campaignId: options.campaignId || null,
        messageId: result.messageId,
        subject,
        from: credentials.smtp_user || '',
        to: recipientEmail,
        body: emailBody,
        direction: 'outbound',
        provider: 'custom_email',
        sentAt: new Date(),
        targetUrl: firstUrl,
        metadata: { trackingId, integrationId: integration.id, ...(options.isTest ? { isTest: true } : {}) }
      });
      // Fire-and-forget: update placement to 'delivered' (SMTP 250 = MTA accepted)
      updateSendPlacement({
        trackingId,
        userId,
        integrationId: integration.id,
        recipientEmail,
        placement: 'delivered',
        provider: 'custom_email',
        source: 'smtp_response'
      }).catch(e => console.warn('[Placement] Failed to update deliverability (custom SMTP):', e?.message));
    }
    return { ...result, integrationId: integration.id };
  }

  // --- PART 2: OAuth (Gmail/Outlook) ---
  const { generateEmailSubject } = await import('./email-subject-generator.js');
  const emailSubject = subject || await generateEmailSubject(userId, content);
  const oauthSenderDomain = integration.accountType?.includes('@') ? integration.accountType.split('@')[1] : null;

  const unsubscribeUrl = options.leadId 
    ? `${oauthSenderDomain ? `https://${oauthSenderDomain}` : (process.env.PUBLIC_URL || 'https://audnixai.com')}/api/unsubscribe/${options.leadId}`
    : undefined;

  let emailBody = content;

  if (!options.isRaw) {
    if (options.buttonUrl && options.buttonText) {
      if (options.isMeetingInvite) {
        emailBody = generateMeetingEmail(
          content,
          options.buttonUrl,
          brandColors,
          businessName,
          unsubscribeUrl,
          physicalAddress
        );
      } else {
        emailBody = generateBrandedEmail(
          content,
          { text: options.buttonText, url: options.buttonUrl },
          brandColors,
          businessName,
          unsubscribeUrl,
          physicalAddress
        );
      }
      options.isHtml = true;
    } else {
      emailBody = generateBrandedEmail(content, { text: 'View Details', url: oauthSenderDomain ? `https://${oauthSenderDomain}` : 'https://audnixai.com' }, brandColors, businessName, unsubscribeUrl, physicalAddress);
      options.isHtml = true;
    }
  } else {
    options.isHtml = true;
  }

  // Apply tracking pixel and link wrapping for OAuth providers
  const { injectTrackingIntoEmail, createTrackedEmail } = await import('@services/email-service/src/email/email-tracking.js');
  const trackingResult = await injectTrackingIntoEmail(emailBody, trackingId, oauthSenderDomain || undefined);
  emailBody = trackingResult.html;
  const firstUrl = trackingResult.urls.length > 0 ? trackingResult.urls.join(',') : null;

  const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
  const { OutlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');

  let accessToken: string | null = null;
  let fromEmail: string | undefined;

  if (integration.provider === 'gmail') {
    const gmailOAuth = new GmailOAuth();
    fromEmail = integration.accountType || undefined;
    accessToken = await gmailOAuth.getValidToken(userId, fromEmail);
  } else if (integration.provider === 'outlook') {
    const outlookOAuth = new OutlookOAuth();
    accessToken = await outlookOAuth.getValidToken(userId);
    fromEmail = integration.accountType || undefined;
  }

  if (!accessToken) {
    throw new Error('Invalid email credentials or token expired');
  }

  const credentials = {
    accessToken,
    email: fromEmail || ''
  };

  const { MailboxHealthMonitor } = await import('@shared/lib/monitoring/health-monitor.js');

  try {
    let result;
    if (integration.provider === 'gmail') {
      result = await sendGmailMessage(
        credentials,
        recipientEmail,
        emailSubject,
        emailBody,
        options.isHtml,
        trackingId,
        options.inReplyTo,
        options.references,
        options.threadId,
        options.replyTo,
        options.leadId
      );
      if (result && result.messageId && !options.isTest) {
        // Create tracking record AFTER successful send (not before)
        await createTrackedEmail({
          userId,
          leadId: options.leadId || undefined,
          integrationId: integration.id,
          recipientEmail,
          senderEmail: credentials.email,
          subject: emailSubject,
          sentAt: new Date(),
          messageId: trackingId,
          targetUrl: firstUrl || undefined
        });
        await storage.createEmailMessage({
          userId,
          leadId: options.leadId || null,
          campaignId: options.campaignId || null,
          messageId: result.messageId,
          subject: emailSubject,
          from: credentials.email || '',
          to: recipientEmail,
          body: emailBody,
          direction: 'outbound',
          provider: 'gmail',
          sentAt: new Date(),
          targetUrl: firstUrl,
          metadata: { trackingId, integrationId: integration.id, ...(options.isTest ? { isTest: true } : {}) }
        });
        // Fire-and-forget: optimistic 'delivered' (Gmail API accepted)
        updateSendPlacement({
          trackingId,
          userId,
          integrationId: integration.id,
          recipientEmail,
          placement: 'delivered',
          provider: 'gmail',
          source: 'gmail_api'
        }).catch(e => console.warn('[Placement] Failed to update deliverability (Gmail):', e?.message));
      }
    } else if (integration.provider === 'outlook') {
      result = await sendOutlookMessage(
        credentials,
        recipientEmail,
        emailSubject,
        emailBody,
        options.isHtml,
        trackingId,
        options.inReplyTo,
        options.references,
        options.replyTo
      );
      // Outlook/Microsoft Graph returns HTTP 202 with no messageId — generate one
      const outlookMessageId = result?.messageId || `outlook-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      if (!options.isTest) {
        // Create tracking record AFTER successful send (not before)
        await createTrackedEmail({
          userId,
          leadId: options.leadId || undefined,
          integrationId: integration.id,
          recipientEmail,
          senderEmail: credentials.email,
          subject: emailSubject,
          sentAt: new Date(),
          messageId: trackingId,
          targetUrl: firstUrl || undefined
        });
        await storage.createEmailMessage({
          userId,
          leadId: options.leadId || null,
          campaignId: options.campaignId || null,
          messageId: outlookMessageId,
          subject: emailSubject,
          from: credentials.email || '',
          to: recipientEmail,
          body: emailBody,
          direction: 'outbound',
          provider: 'outlook',
          sentAt: new Date(),
          targetUrl: firstUrl,
          metadata: { trackingId, integrationId: integration.id, ...(options.isTest ? { isTest: true } : {}) }
        });
        // Fire-and-forget: optimistic 'delivered' (Outlook API accepted)
        updateSendPlacement({
          trackingId,
          userId,
          integrationId: integration.id,
          recipientEmail,
          placement: 'delivered',
          provider: 'outlook',
          source: 'outlook_api'
        }).catch(e => console.warn('[Placement] Failed to update deliverability (Outlook):', e?.message));
      }
    } else {
      throw new Error(`Unsupported email provider: ${integration.provider}`);
    }

    // Success: Reset health monitor
    await MailboxHealthMonitor.recordSuccess(integration.id);
    return { ...result, integrationId: integration.id };

  } catch (error: any) {
    // Failure: Record in health monitor
    console.error(`[EmailService] Send failure for ${integration.id}:`, error.message);
    await MailboxHealthMonitor.recordFailure(integration.id, error.message);
    throw error;
  }
}

/**
 * Send email via Gmail API
 */
async function sendGmailMessage(
  credentials: EmailCredentials,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  trackingId?: string,
  inReplyTo?: string,
  references?: string,
  threadId?: string,
  replyTo?: string,
  leadId?: string
): Promise<{ messageId: string }> {
  const emailBody = body;

  const message = createMimeMessage(credentials.email, to, subject, emailBody, isHtml, undefined, inReplyTo, references, replyTo, leadId);
  const encodedMessage = Buffer.from(message).toString('base64url');

  const bodyData: any = {
    raw: encodedMessage
  };

  if (threadId) {
    bodyData.threadId = threadId;
  }

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyData)
  });

  const data = await response.json() as GmailSendResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to send Gmail');
  }

  return { messageId: data.id || '' };
}

/**
 * Send email via Outlook/Microsoft Graph API
 */
async function sendOutlookMessage(
  credentials: EmailCredentials,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  trackingId?: string,
  inReplyTo?: string,
  references?: string,
  replyTo?: string
): Promise<{ messageId: string }> {
  const emailBody = body;

  const bodyData: any = {
    message: {
      subject: subject,
      body: {
        contentType: isHtml ? 'HTML' : 'Text',
        content: emailBody
      },
      toRecipients: [
        {
          emailAddress: {
            address: to
          }
        }
      ]
    },
    saveToSentItems: true
  };

  const internetMessageHeaders: Array<{ name: string; value: string }> = [];
  if (inReplyTo) {
    internetMessageHeaders.push(
      {
        name: "In-Reply-To",
        value: inReplyTo
      }
    );
    if (references) {
      internetMessageHeaders.push({
        name: "References",
        value: references
      });
    }
  }
  if (replyTo) {
    internetMessageHeaders.push({
      name: "Reply-To",
      value: replyTo
    });
  }
  if (internetMessageHeaders.length > 0) {
    bodyData.message.internetMessageHeaders = internetMessageHeaders;
  }

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyData)
  });

  if (!response.ok) {
    const data = await response.json() as OutlookSendResponse;
    throw new Error(data.error?.message || 'Failed to send Outlook email');
  }

  // Outlook doesn't return the message ID in the sendMail response (202 Accepted)
  // We return null/empty and rely on IMAP sync for the ID if needed later
  return { messageId: '' };
}

/**
 * Create MIME message for Gmail with HTML support
 */
function createMimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  messageId?: string,
  inReplyTo?: string,
  references?: string,
  replyTo?: string,
  leadId?: string,
  trackingId?: string
): string {
  const boundary = '----=_Part_' + Date.now();

  // Extract sender domain for unsubscribe URL and Message-ID
  const senderDomain = from.includes('@') ? from.split('@')[1] : null;
  const appUrl = senderDomain ? `https://${senderDomain}` : (process.env.PUBLIC_URL || 'https://audnixai.com');
  const unsubscribeUrl = leadId ? `${appUrl}/api/unsubscribe/${leadId}` : '';
  const unsubscribeEmail = `unsubscribe@${senderDomain}`;

  const stripHtml = (html: string): string => {
    if (!html) return '';
    try {
      const $ = cheerio.load(html);

      // Remove dangerous tags
      $('script, style, iframe, object, embed, link').remove();

      // Get text content
      let text = $.text();

      return text.replace(/\s+/g, ' ').trim();
    } catch (e) {
      // Fallback for environment issues, though cheerio should work
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  };

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `Date: ${new Date().toUTCString()}`,
    messageId ? `Message-ID: ${messageId}` : `Message-ID: <${Date.now()}@${senderDomain}>`,
    // List-Unsubscribe: web URL (Gmail/Outlook native button) + mailto fallback (RFC compliance)
    leadId
      ? `List-Unsubscribe: <${unsubscribeUrl}>, <mailto:${unsubscribeEmail}?subject=unsubscribe>`
      : `List-Unsubscribe: <mailto:${unsubscribeEmail}?subject=unsubscribe>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
  ];

  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    headers.push(`References: ${references}`);
  }
  if (replyTo) {
    headers.push(`Reply-To: ${replyTo}`);
  }
  // Add custom tracking ID header for IMAP Sent-folder placement detection
  const headerTrackingId = trackingId || messageId;
  if (headerTrackingId) {
    headers.push(`X-Audnix-Id: ${headerTrackingId}`);
  }
  const parts = [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    isHtml ? stripHtml(body) : body,
    ''
  ];

  if (isHtml) {
    // Wrap in proper <html> tags if not already present (fixes mail-tester HTML_MIME_NO_HTML_TAG penalty)
    let htmlBody = body;
    if (!/<html[\s>]/i.test(htmlBody)) {
      htmlBody = `<html><head><meta charset="utf-8"></head><body>${htmlBody}</body></html>`;
    }
    parts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlBody,
      ''
    );
  }

  parts.push(`--${boundary}--`);

  return parts.join('\r\n');
}

/**
 * Get email inbox messages
 */
export async function getEmailInbox(
  userId: string,
  limit: number = 20
): Promise<GmailMessage[] | OutlookMessage[]> {
  const integrations = await storage.getIntegrations(userId);
  const emailIntegration = integrations.find(i =>
    ['gmail', 'outlook'].includes(i.provider) && i.connected
  );

  if (!emailIntegration) {
    throw new Error('Email not connected');
  }

  const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
  const { OutlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');

  let accessToken: string | null = null;
  let emailAddress: string | undefined = emailIntegration.accountType || undefined;

  if (emailIntegration.provider === 'gmail') {
    const gmailOAuth = new GmailOAuth();
    accessToken = await gmailOAuth.getValidToken(userId);
  } else if (emailIntegration.provider === 'outlook') {
    const outlookOAuth = new OutlookOAuth();
    accessToken = await outlookOAuth.getValidToken(userId);
  }

  if (!accessToken) {
    throw new Error('Invalid email credentials');
  }

  if (emailIntegration.provider === 'gmail') {
    return await getGmailInbox({ accessToken, email: emailAddress || '' }, limit);
  } else if (emailIntegration.provider === 'outlook') {
    return await getOutlookInbox({ accessToken, email: emailAddress || '' }, limit);
  }

  return [];
}

/**
 * Get Gmail inbox
 */
async function getGmailInbox(credentials: { accessToken: string, email: string }, limit: number): Promise<GmailMessage[]> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}`, {
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`
    }
  });

  const data = await response.json() as GmailApiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to get Gmail inbox');
  }

  return data.messages || [];
}

/**
 * Get Outlook inbox
 */
async function getOutlookInbox(credentials: { accessToken: string, email: string }, limit: number): Promise<OutlookMessage[]> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?$top=${limit}&$orderby=receivedDateTime desc`, {
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`
    }
  });

  const data = await response.json() as OutlookApiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to get Outlook inbox');
  }

  return data.value || [];
}

/**
 * Send internal system notifications (e.g. mailbox failures)
 * using a dedicated high-deliverability account.
 */
export async function sendSystemEmail(
  to: string,
  subject: string,
  content: string
): Promise<boolean> {
  const host = process.env.SYSTEM_SMTP_HOST;
  const port = parseInt(process.env.SYSTEM_SMTP_PORT || '587');
  const user = process.env.SYSTEM_SMTP_USER;
  const pass = process.env.SYSTEM_SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[Email] SYSTEM_SMTP credentials missing - skipping system email alert');
    return false;
  }

  try {
    const { createTransport } = await import('nodemailer');
    const transporter = createTransport({
      host,
      port,
      secure: parseInt(String(port)) === 465,
      auth: { user, pass },
      // Force IPv4 — production environment has no IPv6 route
      family: 4,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    } as any);

    await transporter.sendMail({
      from: `"Audnix AI Support" <${user}>`,
      to,
      subject,
      html: content
    });

    console.log(`[Email] ✅ System email alert sent to ${to}`);
    return true;
  } catch (err: any) {
    console.error('[Email] ❌ Failed to send system email:', err.message);
    return false;
  }
}

/**
 * Update email_tracking.placement and fire deliverability_updated socket event.
 * Called fire-and-forget after every successful send.
 */
async function updateSendPlacement(opts: {
  trackingId: string;
  userId: string;
  integrationId?: string;
  recipientEmail: string;
  placement: string;
  provider: string;
  source: string;
}): Promise<void> {
  try {
    const { db } = await import('@shared/lib/db/db.js');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`
      UPDATE email_tracking
      SET placement = ${opts.placement},
          placement_updated_at = NOW()
      WHERE token = ${opts.trackingId}
        AND (placement IS NULL OR placement = 'unknown')
    `);
    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
    await Promise.all([
      clusterSync.notifyDeliverabilityUpdated(opts.userId, {
        integrationId: opts.integrationId,
        placement: opts.placement,
        source: opts.source,
        email: opts.recipientEmail
      }),
      clusterSync.notifyStatsUpdated(opts.userId, {
        integrationId: opts.integrationId,
        type: 'send'
      }),
      clusterSync.notifyStatsCacheInvalidate(opts.userId)
    ]);
  } catch (err) {
    console.warn('[Placement] updateSendPlacement error:', (err as Error)?.message);
  }
}



