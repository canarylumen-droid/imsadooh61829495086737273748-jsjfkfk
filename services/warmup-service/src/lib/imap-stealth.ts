/**
 * IMAP Stealth
 * Hidden folder creation, inbox sweep, sent expunge.
 * Uses imapflow (same as email-service).
 */

import { ImapFlow } from 'imapflow';
import { db } from '../db/warmup-db.js';
import { eq, sql } from 'drizzle-orm';
import { warmupMailboxes, warmupInteractions } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import type { ImapCredentials, WarmupMailbox } from '../types/warmup-types.js';

interface CachedClient {
  client: ImapFlow;
  createdAt: number;
}

export class ImapStealth {
  private clients = new Map<string, CachedClient>();
  private readonly CONNECTION_TTL_MS = 5 * 60 * 1000; // 5 minutes

  async ensureHiddenFolder(mailbox: WarmupMailbox): Promise<string> {
    const client = await this.getClient(mailbox);
    const folderName = WARMUP_CONFIG.HIDDEN_FOLDER_NAME;

    try {
      await client.mailboxCreate(folderName);
    } catch (err: any) {
      if (!err.responseText?.includes('EXISTS')) throw err;
    }

    const list = await client.list();
    const existing = list.find(
      (f: any) => f.name === folderName || f.path === folderName
    );
    const actualPath = existing ? existing.path : folderName;

    await db
      .update(warmupMailboxes)
      .set({
        hiddenFolderPath: actualPath,
        hiddenFolderCreatedAt: new Date(),
      })
      .where(eq(warmupMailboxes.id, mailbox.id));

    return actualPath;
  }

  async sweepInboxToHidden(mailbox: WarmupMailbox): Promise<number> {
    const client = await this.getClient(mailbox);
    const hiddenPath =
      mailbox.hiddenFolderPath || (await this.ensureHiddenFolder(mailbox));

    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({
        since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      });
      if (!uids || uids.length === 0) return 0;

      let movedCount = 0;
      for (const uid of uids) {
        const message = await client.fetchOne(uid.toString(), {
          envelope: true,
          headers: true,
        });
        if (!message) continue;
        const headers = (message.headers as any)?.toString() || '';

        if (headers.includes('X-Audnix-Warmup: true')) {
          await client.messageMove(uid.toString(), hiddenPath);
          movedCount++;

          // Track that this mailbox received a warmup email
          await this.incrementDailyReceivedCount(mailbox.id);

          if (message.envelope?.messageId) {
            await db
              .update(warmupInteractions)
              .set({ movedToHiddenFolder: true })
              .where(
                eq(
                  warmupInteractions.messageId,
                  message.envelope.messageId
                )
              );
          }
        }
      }
      return movedCount;
    } finally {
      lock.release();
    }
  }

  async expungeSentWarmup(
    mailbox: WarmupMailbox,
    messageId: string
  ): Promise<boolean> {
    const client = await this.getClient(mailbox);
    const sentFolder = this.resolveSentFolder(mailbox.provider);

    const lock = await client.getMailboxLock(sentFolder);
    try {
      const uids = await client.search({
        header: { 'message-id': messageId },
      });

      if (!uids || uids.length === 0) return false;

      for (const uid of uids) {
        await client.messageFlagsSet(uid.toString(), ['\\Deleted'], {
          uid: true,
        });
      }

      await (client as any).expunge();

      await db
        .update(warmupInteractions)
        .set({ expungedFromSent: true, status: 'expunged' })
        .where(eq(warmupInteractions.messageId, messageId));

      return true;
    } finally {
      lock.release();
    }
  }

  async rescueSpamFolder(mailbox: WarmupMailbox): Promise<number> {
    const client = await this.getClient(mailbox);
    const spamFolder = this.resolveSpamFolder(mailbox.provider);
    const hiddenPath =
      mailbox.hiddenFolderPath || (await this.ensureHiddenFolder(mailbox));

    let lock;
    try {
      lock = await client.getMailboxLock(spamFolder);
    } catch {
      // Spam folder may not exist
      return 0;
    }

    try {
      const uids = await client.search({
        since: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      if (!uids || uids.length === 0) return 0;

      let rescuedCount = 0;
      for (const uid of uids) {
        const msg = await client.fetchOne(uid.toString(), {
          envelope: true,
          headers: true,
        });
        if (!msg) continue;
        const headers = (msg.headers as any)?.toString() || '';

        if (headers.includes('X-Audnix-Warmup: true')) {
          await client.messageMove(uid.toString(), hiddenPath);
          try {
            await client.messageFlagsSet(uid.toString(), ['\\NotJunk'], {
              uid: true,
            });
          } catch {
            // NotJunk flag may not be supported on all providers
          }
          rescuedCount++;

          // Track that this mailbox received a warmup email (from spam rescue)
          await this.incrementDailyReceivedCount(mailbox.id);
        }
      }
      return rescuedCount;
    } finally {
      lock.release();
    }
  }

  private async getClient(mailbox: WarmupMailbox): Promise<ImapFlow> {
    const cacheKey = mailbox.id;
    const now = Date.now();

    if (this.clients.has(cacheKey)) {
      const cached = this.clients.get(cacheKey)!;
      const isExpired = now - cached.createdAt > this.CONNECTION_TTL_MS;
      const isHealthy = cached.client.authenticated;

      if (!isExpired && isHealthy) {
        return cached.client;
      }

      // Stale or disconnected — clean up
      try { await cached.client.logout(); } catch {}
      this.clients.delete(cacheKey);
    }

    const creds = await this.extractImapCreds(mailbox);

    // Credential validation for custom_email
    if (mailbox.provider === 'custom_email') {
      if (!creds.host) {
        throw new Error(`[Warmup][IMAP] Missing IMAP host for ${mailbox.email}`);
      }
      if (!creds.pass) {
        throw new Error(`[Warmup][IMAP] Missing IMAP password for ${mailbox.email}`);
      }
    }

    const auth: any = { user: creds.user, pass: creds.pass };
    if (creds.accessToken) {
      auth.accessToken = creds.accessToken;
    }

    const client = new ImapFlow({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth,
      logger: false,
      connectionTimeout: WARMUP_CONFIG.IMAP_TIMEOUT_MS,
      greetingTimeout: WARMUP_CONFIG.IMAP_TIMEOUT_MS,
    });

    await client.connect();

    // Reset IMAP failure counter on successful connection
    await db
      .update(warmupMailboxes)
      .set({
        metadata: sql`${warmupMailboxes.metadata} || ${JSON.stringify({ imapFailureCount: 0 })}`,
      })
      .where(eq(warmupMailboxes.id, mailbox.id));

    this.clients.set(cacheKey, { client, createdAt: now });
    return client;
  }

  private async incrementDailyReceivedCount(mailboxId: string): Promise<void> {
    try {
      await db
        .update(warmupMailboxes)
        .set({
          dailyReceivedCount: sql`${warmupMailboxes.dailyReceivedCount} + 1`,
        })
        .where(eq(warmupMailboxes.id, mailboxId));
    } catch (err: any) {
      console.warn(`[Warmup][IMAP] Failed to increment dailyReceivedCount:`, err.message);
    }
  }

  private async extractImapCreds(mailbox: WarmupMailbox): Promise<ImapCredentials & { accessToken?: string }> {
    const meta = mailbox.metadata as any;
    const defaults: Record<string, { host: string; port: number; secure: boolean }> = {
      gmail: { host: 'imap.gmail.com', port: 993, secure: true },
      outlook: { host: 'outlook.office365.com', port: 993, secure: true },
      custom_email: { host: meta?.imapHost || meta?.imap_host || '', port: meta?.imapPort || meta?.imap_port || 993, secure: true },
    };
    if (mailbox.provider === 'custom_email' && !(meta?.imapHost || meta?.imap_host)) {
      console.warn(`[Warmup][IMAP] custom_email integration missing imapHost in metadata — cannot connect to IMAP`);
    }

    const d = defaults[mailbox.provider] || defaults.custom_email;

    // Infer secure flag from port for custom_email
    let secure = d.secure;
    if (mailbox.provider === 'custom_email') {
      secure = d.port === 993 || d.port === 995; // Standard SSL ports
      // Port 143 typically uses STARTTLS (secure: false in ImapFlow)
    }

    const creds: ImapCredentials & { accessToken?: string } = {
      host: d.host,
      port: d.port,
      secure,
      user: mailbox.email,
      // Prefer dedicated IMAP password, fall back to SMTP password.
      // Some providers use different credentials for IMAP vs SMTP.
      pass: meta?.imapPass || meta?.imap_pass || meta?.smtpPass || meta?.smtp_pass || meta?.password || '',
    };

    // OAuth for Gmail / Outlook
    if (mailbox.provider === 'gmail' || mailbox.provider === 'outlook') {
      try {
        let accessToken: string | null = null;
        if (mailbox.provider === 'gmail') {
          const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
          const gmailOAuth = new GmailOAuth();
          accessToken = await gmailOAuth.getValidToken(mailbox.userId, mailbox.email);
        } else if (mailbox.provider === 'outlook') {
          const { OutlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');
          const outlookOAuth = new OutlookOAuth();
          accessToken = await outlookOAuth.getValidToken(mailbox.userId);
        }
        if (accessToken) {
          creds.accessToken = accessToken;
        }
      } catch (err: any) {
        console.warn(`[Warmup][IMAP] OAuth failed for ${mailbox.provider} ${mailbox.email}:`, err.message);
      }
    }

    return creds;
  }

  private resolveSentFolder(provider: string): string {
    switch (provider) {
      case 'gmail':
        return '[Gmail]/Sent Mail';
      case 'outlook':
        return 'Sent Items';
      default:
        return 'Sent';
    }
  }

  private resolveSpamFolder(provider: string): string {
    switch (provider) {
      case 'gmail':
        return '[Gmail]/Spam';
      case 'outlook':
        return 'Junk Email';
      default:
        return 'Spam';
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [id, cached] of this.clients) {
      try { await cached.client.logout(); } catch {}
      this.clients.delete(id);
    }
  }
}

export const imapStealth = new ImapStealth();
