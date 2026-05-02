import Imap from 'imap';
import { simpleParser } from 'mailparser';
import type { AddressObject } from 'mailparser';
import { Readable } from 'stream';
import { db } from '@shared/lib/db/db.js';
import { leads, bounceTracker } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { createLogger } from '@services/api-gateway/src/core/logger.js';

const log = createLogger('BOUNCE-MONITOR');

export class BounceMonitor {
  private imapConfig: any;
  private imap: Imap | null = null;
  private isRunning: boolean = false;

  constructor(config: any) {
    this.imapConfig = config;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    this.imap = new Imap({
      user: this.imapConfig.user,
      password: this.imapConfig.password,
      host: this.imapConfig.host,
      port: this.imapConfig.port || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    this.imap.once('ready', () => {
      this.isRunning = true;
      log.info(`[BounceMonitor] Connected to ${this.imapConfig.user}`);
      this.monitorInbox();
    });

    this.imap.once('error', (err: Error) => {
      log.error(`[BounceMonitor] Connection error`, { error: err.message });
      this.isRunning = false;
    });

    this.imap.once('end', () => {
      log.info(`[BounceMonitor] Connection ended`);
      this.isRunning = false;
    });

    this.imap.connect();
  }

  private monitorInbox(): void {
    if (!this.imap) return;

    this.imap.openBox('INBOX', false, (err, _box) => {
      if (err) {
        log.error(`[BounceMonitor] Failed to open INBOX`, { error: err.message });
        return;
      }

      log.info(`[BounceMonitor] Monitoring INBOX for bounces`);

      this.imap!.on('mail', (_numNewMsgs: number) => {
        this.fetchUnseen();
      });

      // Initial fetch on connect
      this.fetchUnseen();
    });
  }

  private fetchUnseen(): void {
    if (!this.imap) return;

    this.imap.search(['UNSEEN'], (err, results) => {
      if (err || !results || results.length === 0) return;

      const f = this.imap!.fetch(results, { bodies: '' });

      f.on('message', (msg, _seqno) => {
        const chunks: Buffer[] = [];

        msg.on('body', (stream: NodeJS.ReadableStream) => {
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', async () => {
            const buffer = Buffer.concat(chunks);
            const readable = Readable.from(buffer);
            try {
              const parsed = await simpleParser(readable as any);
              await this.processMessage(parsed, results[0]);
            } catch (parseErr) {
              log.warn('[BounceMonitor] Failed to parse email', { error: (parseErr as Error).message });
            }
          });
        });
      });

      f.once('error', (err: Error) => {
        log.error(`[BounceMonitor] Fetch error`, { error: err.message });
      });
    });
  }

  private async processMessage(parsed: any, uid: number): Promise<void> {
    const from = (parsed.from?.value?.[0]?.address || '').toLowerCase();
    const subject = (parsed.subject || '').toLowerCase();

    // Phase 36: Detect bounce by sender/subject heuristics
    const isBounce =
      from.includes('mailer-daemon') ||
      from.includes('postmaster') ||
      subject.includes('delivery status notification') ||
      subject.includes('undeliverable') ||
      subject.includes('returned to sender') ||
      subject.includes('failed delivery') ||
      subject.includes('mail delivery failed');

    if (isBounce) {
      log.info(`[BounceMonitor] Detected bounce from ${from} — subject: "${parsed.subject}"`);

      // Phase 37: Parse bounce details
      const rawBody = typeof parsed.text === 'string' ? parsed.text : '';
      const { originalRecipient, bounceType } = this.parseBounce(rawBody);

      if (originalRecipient) {
        await this.handleBounce(originalRecipient, bounceType, rawBody);

        // Mark as Seen so we don't reprocess
        this.imap?.addFlags(uid, ['\\Seen'], (flagErr) => {
          if (flagErr) log.warn('[BounceMonitor] Could not mark message as Seen', { error: flagErr.message });
        });
      }
    }
  }

  /**
   * Phase 37: Parse raw email body to extract original recipient and bounce type
   */
  public parseBounce(body: string): { originalRecipient: string | null; bounceType: 'hard' | 'soft' | 'spam' } {
    let originalRecipient: string | null = null;
    let bounceType: 'hard' | 'soft' | 'spam' = 'soft';

    // Try to extract intended recipient from delivery failure body
    const recipientPatterns = [
      /(?:to|delivery to|failed to deliver to|recipient)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      /(?:address|email)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    ];

    for (const pattern of recipientPatterns) {
      const match = body.match(pattern);
      if (match?.[1]) {
        const candidate = match[1].toLowerCase();
        if (!candidate.includes('mailer-daemon') && !candidate.includes('postmaster')) {
          originalRecipient = candidate;
          break;
        }
      }
    }

    // Fallback: grab first non-system email address
    if (!originalRecipient) {
      const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
      const allMatches = body.match(emailRegex) || [];
      for (const match of allMatches) {
        const lower = match.toLowerCase();
        if (!lower.includes('mailer-daemon') && !lower.includes('postmaster') && !lower.includes('noreply')) {
          originalRecipient = lower;
          break;
        }
      }
    }

    // Classify bounce type
    const lowerBody = body.toLowerCase();
    if (lowerBody.includes('spam') || lowerBody.includes('blocked') || lowerBody.includes('blacklisted')) {
      bounceType = 'spam';
    } else if (
      lowerBody.includes('550') ||
      lowerBody.includes('no such user') ||
      lowerBody.includes('does not exist') ||
      lowerBody.includes('invalid address') ||
      lowerBody.includes('rejected') ||
      lowerBody.includes('5.1.1')
    ) {
      bounceType = 'hard';
    } else {
      bounceType = 'soft';
    }

    return { originalRecipient, bounceType };
  }

  /**
   * Phase 38 & 39: Map bounced email to leads, update status, insert tracker record
   */
  private async handleBounce(recipient: string, bounceType: 'hard' | 'soft' | 'spam', rawBody: string): Promise<void> {
    log.info(`[BounceMonitor] Processing bounce for ${recipient} (${bounceType})`);

    try {
      // Find matching lead by email
      const leadMatches = await db.select().from(leads).where(eq(leads.email, recipient)).limit(1);
      const lead = leadMatches[0];

      if (!lead) {
        log.warn(`[BounceMonitor] No lead found for bounced address: ${recipient}`);
        return;
      }

      // Phase 38: Update lead status to 'bouncy'
      await db.update(leads)
        .set({
          status: 'bouncy',
          metadata: {
            ...(lead.metadata as object || {}),
            bounceType,
            bouncedAt: new Date().toISOString(),
            bounceSnippet: rawBody.substring(0, 300)
          }
        })
        .where(eq(leads.id, lead.id));

      log.info(`[BounceMonitor] Lead ${lead.id} (${recipient}) marked as bouncy`);

      // Phase 39: Insert into bounce_tracker
      await db.insert(bounceTracker).values({
        userId: lead.userId,
        leadId: lead.id,
        email: recipient,
        bounceType,
        metadata: {
          rawSnippet: rawBody.substring(0, 500),
          detectedAt: new Date().toISOString()
        }
      });

      log.info(`[BounceMonitor] Bounce record inserted for lead ${lead.id}`);
    } catch (err) {
      log.error(`[BounceMonitor] Error handling bounce for ${recipient}`, { error: (err as Error).message });
    }
  }

  public stop(): void {
    if (this.imap) {
      this.imap.end();
      this.isRunning = false;
    }
  }
}
