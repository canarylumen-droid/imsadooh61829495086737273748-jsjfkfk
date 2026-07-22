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
import { decryptWarmupSecret } from './warmup-crypto.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';

interface CachedClient {
  client: ImapFlow;
  createdAt: number;
  lastUsedAt: number;
}

export class ImapStealth {
  private clients = new Map<string, CachedClient>();
  private readonly CONNECTION_TTL_MS = 5 * 60 * 1000;
  private readonly MAX_CONNECTIONS = parseInt(process.env.WARMUP_MAX_IMAP_CONNECTIONS || '50', 10);
  private readonly CONNECTION_SEMAPHORE_TIMEOUT_MS = 30000;
  private activeConnectionCount = 0;
  private connectionQueue: Array<{ resolve: () => void; reject: (err: Error) => void; createdAt: number }> = [];
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupStaleConnections(), Math.min(this.CONNECTION_TTL_MS, 60000));
  }

  private async acquireConnectionSlot(): Promise<void> {
    if (this.activeConnectionCount < this.MAX_CONNECTIONS) {
      this.activeConnectionCount++;
      return;
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, createdAt: Date.now() };
      this.connectionQueue.push(entry);
      setTimeout(() => {
        const idx = this.connectionQueue.indexOf(entry);
        if (idx !== -1) {
          this.connectionQueue.splice(idx, 1);
          reject(new Error(`[Warmup][IMAP] Connection slot timeout after ${this.CONNECTION_SEMAPHORE_TIMEOUT_MS}ms`));
        }
      }, this.CONNECTION_SEMAPHORE_TIMEOUT_MS);
    });
  }

  private releaseConnectionSlot(): void {
    if (this.connectionQueue.length > 0) {
      const next = this.connectionQueue.shift()!;
      if (Date.now() - next.createdAt < this.CONNECTION_SEMAPHORE_TIMEOUT_MS) {
        next.resolve();
        return;
      }
      this.releaseConnectionSlot();
    }
    this.activeConnectionCount = Math.max(0, this.activeConnectionCount - 1);
  }

  private async cleanupStaleConnections(): Promise<void> {
    const now = Date.now();
    let closed = 0;
    for (const [id, cached] of this.clients) {
      const expired = now - cached.createdAt > this.CONNECTION_TTL_MS;
      const idleTooLong = now - cached.lastUsedAt > Math.min(this.CONNECTION_TTL_MS, 120000);
      if (expired || idleTooLong || !cached.client.authenticated) {
        try { await cached.client.logout(); } catch {}
        this.clients.delete(id);
        this.releaseConnectionSlot();
        closed++;
      }
    }
    if (closed > 0) {
      console.log(`[Warmup][IMAP] Cleaned ${closed} stale connection(s), pool: ${this.clients.size}/${this.MAX_CONNECTIONS}`);
    }
  }

  async ensureHiddenFolder(mailbox: WarmupMailbox): Promise<string> {
    const client = await this.getClient(mailbox);
    const folderName = WARMUP_CONFIG.HIDDEN_FOLDER_NAME;

    try {
      await client.mailboxCreate(folderName);
    } catch (err: any) {
      const msg = (err.responseText || err.message || '').toLowerCase();
      if (msg.includes('exists') || msg.includes('already')) return folderName;
      throw err;
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

      const warmupMessages: Array<{ uid: number; messageId?: string; seen?: boolean }> = [];
      for await (const message of client.fetch(
        uids,
        { headers: ['X-Audnix-Warmup'], envelope: true, flags: true }
      )) {
        const headers = (message.headers as any)?.toString() || '';
        if (headers.includes('X-Audnix-Warmup: true')) {
          warmupMessages.push({
            uid: message.uid,
            messageId: message.envelope?.messageId,
            seen: message.flags?.includes('\\Seen') || false,
          });
        }
      }

      let movedCount = 0;
      let hadOpen = false;
      for (const msg of warmupMessages) {
        await client.messageMove(msg.uid.toString(), hiddenPath);
        movedCount++;
        await this.incrementDailyReceivedCount(mailbox.id);
        if (msg.messageId) {
          const updateData: any = { movedToHiddenFolder: true, placement: 'inbox' };
          if (msg.seen) {
            updateData.openedAt = new Date();
            hadOpen = true;
          }
          await db
            .update(warmupInteractions)
            .set(updateData)
            .where(eq(warmupInteractions.messageId, msg.messageId));
        }
      }

      // Fire socket events for real-time UI
      if (mailbox.userId && mailbox.userId !== 'system') {
        if (hadOpen) {
          clusterSync.notifyStatsUpdated(mailbox.userId).catch(() => {});
        }
        clusterSync.notifyWarmupUpdated(mailbox.userId, {
          mailboxId: mailbox.integrationId,
          status: 'active',
        }).catch(() => {});
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

      await client.messageDelete(uids, { uid: true });

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
      return 0;
    }

    try {
      const uids = await client.search({
        since: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      });
      if (!uids || uids.length === 0) return 0;

      const warmupMessages: Array<{ uid: number; messageId?: string; seen?: boolean }> = [];
      for await (const message of client.fetch(
        uids,
        { headers: ['X-Audnix-Warmup'], envelope: true, flags: true }
      )) {
        const headers = (message.headers as any)?.toString() || '';
        if (headers.includes('X-Audnix-Warmup: true')) {
          warmupMessages.push({
            uid: message.uid,
            messageId: message.envelope?.messageId,
            seen: message.flags?.includes('\\Seen') || false,
          });
        }
      }

      let rescuedCount = 0;
      let hadOpen = false;
      for (const msg of warmupMessages) {
        await client.messageMove(msg.uid.toString(), hiddenPath);
        try {
          await client.messageFlagsSet(msg.uid.toString(), ['\\NotJunk'], {
            uid: true,
          });
        } catch {
          // NotJunk flag may not be supported on all providers
        }
        rescuedCount++;
        await this.incrementDailyReceivedCount(mailbox.id);
        if (msg.messageId) {
          const updateData: any = { movedToHiddenFolder: true, placement: 'spam' };
          if (msg.seen) {
            updateData.openedAt = new Date();
            hadOpen = true;
          }
          await db
            .update(warmupInteractions)
            .set(updateData)
            .where(eq(warmupInteractions.messageId, msg.messageId));
        }
      }

      if (mailbox.userId && mailbox.userId !== 'system') {
        if (hadOpen) {
          clusterSync.notifyStatsUpdated(mailbox.userId).catch(() => {});
        }
        clusterSync.notifyWarmupUpdated(mailbox.userId, {
          mailboxId: mailbox.integrationId,
          status: 'active',
        }).catch(() => {});
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
      const isIdleTooLong = now - cached.lastUsedAt > Math.min(this.CONNECTION_TTL_MS, 120000);

      if (!isExpired && !isIdleTooLong) {
        cached.lastUsedAt = now;
        return cached.client;
      }

      try { await cached.client.logout(); } catch {}
      this.clients.delete(cacheKey);
      this.releaseConnectionSlot();
    }

    const creds = await this.extractImapCreds(mailbox);

    if (mailbox.provider === 'custom_email') {
      if (!creds.host) {
        throw new Error(`[Warmup][IMAP] Missing IMAP host for ${mailbox.email}`);
      }
      if (!creds.pass) {
        throw new Error(`[Warmup][IMAP] Missing IMAP password for ${mailbox.email}`);
      }
    }

    await this.acquireConnectionSlot();

    let client: ImapFlow;
    try {
      const auth: any = { user: creds.user, pass: creds.pass };
      if (creds.accessToken) {
        auth.accessToken = creds.accessToken;
      }

      client = new ImapFlow({
        host: creds.host,
        port: creds.port,
        secure: creds.secure,
        auth,
        logger: false,
        connectionTimeout: WARMUP_CONFIG.IMAP_TIMEOUT_MS,
        greetingTimeout: WARMUP_CONFIG.IMAP_TIMEOUT_MS,
      });

      await client.connect();
    } catch (err: any) {
      this.releaseConnectionSlot();
      throw err;
    }

    await db
      .update(warmupMailboxes)
      .set({
        metadata: sql`jsonb_set(COALESCE(${warmupMailboxes.metadata}, '{}'::jsonb), '{imapFailureCount}', '0'::jsonb)`,
      })
      .where(eq(warmupMailboxes.id, mailbox.id));

    this.clients.set(cacheKey, { client, createdAt: now, lastUsedAt: now });
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
      yahoo: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
      aol: { host: 'imap.aol.com', port: 993, secure: true },
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

    const rawPass = meta?.imapPass || meta?.imap_pass || meta?.smtpPass || meta?.smtp_pass || meta?.password || '';
    const creds: ImapCredentials & { accessToken?: string } = {
      host: d.host,
      port: d.port,
      secure,
      user: mailbox.email,
      pass: decryptWarmupSecret(rawPass),
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
      case 'yahoo':
        return 'Sent';
      case 'aol':
        return 'Sent';
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
      case 'yahoo':
        return 'Spam';
      case 'aol':
        return 'Spam';
      default:
        return 'Spam';
    }
  }

  async disconnectAll(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    for (const [id, cached] of this.clients) {
      try { await cached.client.logout(); } catch {}
      this.clients.delete(id);
      this.releaseConnectionSlot();
    }
    this.connectionQueue.length = 0;
    this.activeConnectionCount = 0;
  }
}

export const imapStealth = new ImapStealth();
