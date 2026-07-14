/**
 * Spam Rescue Worker — Task 3
 *
 * Runs every 6 hours. Scans the Spam/Junk folders of connected mailboxes
 * for emails from known leads and moves them back to the Inbox.
 * This prevents legitimate campaign replies from being lost.
 */

import { db } from '@shared/lib/db/db.js';
import { leads, messages, integrations } from '@audnix/shared';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { decrypt } from '@shared/lib/crypto/encryption.js';

const RESCUE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes — fast spam rescue

class SpamRescueWorker {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[SpamRescue] 🛡️ Starting spam rescue worker (6h interval)...');

    // Immediate first run, then every 6h
    this.runRescue().catch((err) => console.error('[SpamRescue] First run failed:', err.message));
    this.interval = setInterval(() => {
      this.runRescue().catch((err) => console.error('[SpamRescue] Run failed:', err.message));
    }, RESCUE_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('[SpamRescue] Stopped.');
  }

  async runRescue(): Promise<{ rescued: number; checked: number }> {
    if (!db) return { rescued: 0, checked: 0 };

    const activeMailboxes = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.connected, true),
          sql`provider IN ('gmail', 'outlook', 'custom_email')`
        )
      );

    if (activeMailboxes.length === 0) {
      return { rescued: 0, checked: 0 };
    }

    let totalRescued = 0;
    let totalChecked = 0;

    for (const mailbox of activeMailboxes) {
      try {
        const result = await this.rescueMailboxSpam(mailbox);
        totalRescued += result.rescued;
        totalChecked += result.checked;
      } catch (err: any) {
        console.warn(`[SpamRescue] Failed for ${mailbox.id}:`, err.message);
      }
    }

    if (totalRescued > 0) {
      console.log(`[SpamRescue] ✅ Rescued ${totalRescued} emails from spam across ${activeMailboxes.length} mailboxes`);
    }
    return { rescued: totalRescued, checked: totalChecked };
  }

  private async rescueMailboxSpam(mailbox: typeof integrations.$inferSelect): Promise<{ rescued: number; checked: number }> {
    let config: Record<string, any> = {};
    try {
      config = JSON.parse(await decrypt(mailbox.encryptedMeta));
    } catch {
      return { rescued: 0, checked: 0 };
    }

    const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
    const imapPort = config.imap_port || 993;
    const imapUser = config.smtp_user || config.user || config.email || '';
    const imapPass = config.smtp_pass || config.password || config.accessToken || '';

    if (!imapHost || !imapUser || !imapPass) return { rescued: 0, checked: 0 };

    // Get known lead emails for this user
    const userLeads = await db!
      .select({ email: leads.email })
      .from(leads)
      .where(eq(leads.userId, mailbox.userId));

    const leadEmails = new Set(userLeads.map((l) => l.email?.toLowerCase()).filter(Boolean));
    if (leadEmails.size === 0) return { rescued: 0, checked: 0 };

    const Imap = (await import('imap')).default;

    return new Promise((resolve) => {
      const imap = new Imap({
        user: imapUser,
        password: imapPass,
        host: imapHost,
        port: imapPort,
        tls: imapPort === 993,
        family: 4,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 15000,
        authTimeout: 15000,
        keepalive: false,
      } as any);

      const safeEnd = () => { try { if (imap.state !== 'disconnected') imap.end(); } catch {} };
      const spamFolderNames = ['Spam', 'Junk', 'Junk E-mail', '[Gmail]/Spam', 'Bulk Mail'];
      let rescued = 0;
      let checked = 0;

      function tryOpenSpam(index: number) {
        if (index >= spamFolderNames.length) {
          safeEnd();
          resolve({ rescued, checked });
          return;
        }

        imap.openBox(spamFolderNames[index], false, (err: any) => {
          if (err) {
            tryOpenSpam(index + 1);
            return;
          }

          // Search emails from the last 7 days in spam
          const sinceDate = new Date();
          sinceDate.setDate(sinceDate.getDate() - 7);

          imap.search([['SINCE', sinceDate]], (searchErr: any, results: number[]) => {
            if (searchErr || !results || results.length === 0) {
              safeEnd();
              resolve({ rescued, checked });
              return;
            }

            checked = results.length;
            const f = imap.fetch(results, { bodies: 'HEADER.FIELDS (FROM TO SUBJECT MESSAGE-ID DATE)' });
            const toMove: number[] = [];

            f.on('message', (msg: any) => {
              let header = '';
              msg.on('body', (stream: any) => {
                stream.on('data', (chunk: any) => { header += chunk.toString('ascii'); });
              });
              msg.once('end', () => {
                const fromMatch = header.match(/From:\s*([^\r\n]+)/i);
                const fromAddr = fromMatch ? fromMatch[1].toLowerCase() : '';
                // Extract email from "Name <email@domain.com>" or just "email@domain.com"
                const emailMatch = fromAddr.match(/<([^>]+)>/);
                const senderEmail = emailMatch ? emailMatch[1] : fromAddr;
                if (leadEmails.has(senderEmail)) {
                  const uid = (msg as any).uid;
                  if (uid) toMove.push(uid);
                }
              });
            });

            f.once('error', () => { safeEnd(); resolve({ rescued, checked }); });
            f.once('end', () => {
              if (toMove.length === 0) {
                safeEnd();
                resolve({ rescued, checked });
                return;
              }

              // Move rescued emails back to INBOX
              imap.move(toMove, 'INBOX', (moveErr: any) => {
                if (!moveErr) {
                  rescued = toMove.length;
                  console.log(`[SpamRescue] 📬 Rescued ${rescued} emails from spam for user ${mailbox.userId.slice(0, 8)}`);
                }
                safeEnd();
                resolve({ rescued, checked });
              });
            });
          });
        });
      }

      imap.once('ready', () => tryOpenSpam(0));
      imap.once('error', () => { safeEnd(); resolve({ rescued: 0, checked: 0 }); });

      try { imap.connect(); } catch { resolve({ rescued: 0, checked: 0 }); }
    });
  }

  /**
   * Best-effort: mark leads as 'replied' if we rescued their email from spam.
   * Uses the sender email extracted from headers.
   */
  private async updateRescuedLeadStatus(userId: string, uids: number[], sampleHeader: string): Promise<void> {
    if (!db || uids.length === 0) return;
    // This is a best-effort update — the real lead status sync happens in the inbound sweep.
    // We just log it here for telemetry.
    console.log(`[SpamRescue] 📬 Marked ${uids.length} rescued emails for user ${userId.slice(0, 8)}`);
  }
}

export const spamRescueWorker = new SpamRescueWorker();
