/**
 * Inbound Sweep Worker — Task 3
 *
 * Runs every 15 minutes. Scans the INBOX of connected mailboxes for unread
 * emails from leads in active campaigns. Inserts any missed emails into the
 * `messages` table and triggers auto-reply scheduling if the email is a reply
 * to a campaign thread.
 */

import { db } from '@shared/lib/db/db.js';
import { leads, messages, campaignLeads, outreachCampaigns, integrations } from '@audnix/shared';
import { eq, and, or, sql, gte, desc } from 'drizzle-orm';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const LOOKBACK_HOURS = 2;

interface SweptEmail {
  uid: number;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  date: Date;
  messageId: string;
  inReplyTo?: string;
  references?: string;
}

class InboundSweepWorker {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[InboundSweep] 📥 Starting inbound sweep worker (15m interval)...');

    this.runSweep().catch((err) => console.error('[InboundSweep] First run failed:', err.message));
    this.interval = setInterval(() => {
      this.runSweep().catch((err) => console.error('[InboundSweep] Run failed:', err.message));
    }, SWEEP_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('[InboundSweep] Stopped.');
  }

  async runSweep(): Promise<{ imported: number; autoReplies: number; checked: number }> {
    if (!db) return { imported: 0, autoReplies: 0, checked: 0 };

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
      return { imported: 0, autoReplies: 0, checked: 0 };
    }

    let totalImported = 0;
    let totalAutoReplies = 0;
    let totalChecked = 0;

    for (const mailbox of activeMailboxes) {
      try {
        const result = await this.sweepMailbox(mailbox);
        totalImported += result.imported;
        totalAutoReplies += result.autoReplies;
        totalChecked += result.checked;
      } catch (err: any) {
        console.warn(`[InboundSweep] Failed for ${mailbox.id}:`, err.message);
      }
    }

    if (totalImported > 0) {
      console.log(`[InboundSweep] ✅ Imported ${totalImported} emails, triggered ${totalAutoReplies} auto-replies across ${activeMailboxes.length} mailboxes`);
    }
    return { imported: totalImported, autoReplies: totalAutoReplies, checked: totalChecked };
  }

  private async sweepMailbox(mailbox: typeof integrations.$inferSelect): Promise<{ imported: number; autoReplies: number; checked: number }> {
    let config: Record<string, any> = {};
    try {
      config = JSON.parse(await decrypt(mailbox.encryptedMeta));
    } catch {
      return { imported: 0, autoReplies: 0, checked: 0 };
    }

    const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
    const imapPort = config.imap_port || 993;
    const imapUser = config.smtp_user || config.user || config.email || '';
    const imapPass = config.smtp_pass || config.password || config.accessToken || '';

    if (!imapHost || !imapUser || !imapPass) return { imported: 0, autoReplies: 0, checked: 0 };

    // Get active campaign leads for this user
    const activeLeads = await db!
      .select({
        leadId: campaignLeads.leadId,
        campaignId: campaignLeads.campaignId,
        campaignLeadId: campaignLeads.id,
        email: leads.email,
        status: campaignLeads.status,
      })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
      .where(
        and(
          eq(outreachCampaigns.userId, mailbox.userId),
          eq(outreachCampaigns.status, 'active'),
          or(eq(campaignLeads.status, 'sent'), eq(campaignLeads.status, 'replied'))
        )
      );

    if (activeLeads.length === 0) return { imported: 0, autoReplies: 0, checked: 0 };

    const leadEmailMap = new Map<string, typeof activeLeads[0]>();
    for (const al of activeLeads) {
      if (al.email) leadEmailMap.set(al.email.toLowerCase(), al);
    }

    const Imap = (await import('imap')).default;
    const { simpleParser } = await import('mailparser');

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
      const sinceDate = new Date();
      sinceDate.setHours(sinceDate.getHours() - LOOKBACK_HOURS);

      let imported = 0;
      let autoReplies = 0;
      let checked = 0;

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err: any) => {
          if (err) {
            safeEnd();
            resolve({ imported, autoReplies, checked });
            return;
          }

          imap.search([['SINCE', sinceDate], ['UNSEEN']], (searchErr: any, results: number[]) => {
            if (searchErr || !results || results.length === 0) {
              safeEnd();
              resolve({ imported, autoReplies, checked });
              return;
            }

            checked = results.length;
            const f = imap.fetch(results, { bodies: '' });
            const emailsToProcess: SweptEmail[] = [];

            f.on('message', (msg: any) => {
              let raw = '';
              msg.on('body', (stream: any) => {
                stream.on('data', (chunk: any) => { raw += chunk.toString('utf8'); });
              });
              msg.once('end', () => {
                simpleParser(raw, (parseErr: any, parsed: any) => {
                  if (parseErr) return;
                  const fromAddr = parsed.from?.text || '';
                  const emailMatch = fromAddr.match(/<([^>]+)>/);
                  const senderEmail = (emailMatch ? emailMatch[1] : fromAddr).toLowerCase().trim();

                  if (leadEmailMap.has(senderEmail)) {
                    emailsToProcess.push({
                      uid: (msg as any).uid,
                      from: senderEmail,
                      to: parsed.to?.text || '',
                      subject: parsed.subject || '',
                      text: parsed.text || '',
                      html: parsed.html || '',
                      date: parsed.date || new Date(),
                      messageId: parsed.messageId || '',
                      inReplyTo: parsed.inReplyTo,
                      references: Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references,
                    });
                  }
                });
              });
            });

            f.once('error', () => { safeEnd(); resolve({ imported, autoReplies, checked }); });
            f.once('end', async () => {
              safeEnd();

              for (const email of emailsToProcess) {
                try {
                  const leadInfo = leadEmailMap.get(email.from)!;

                  // Check if already in messages table
                  const existing = await db!.select({ id: messages.id })
                    .from(messages)
                    .where(
                      and(
                        eq(messages.leadId, leadInfo.leadId),
                        eq(messages.userId, mailbox.userId),
                        eq(messages.direction, 'inbound'),
                        sql`${messages.externalId} = ${email.messageId} OR (
                          ${messages.subject} = ${email.subject}
                          AND ${messages.createdAt} > ${new Date(Date.now() - 24 * 60 * 60 * 1000)}
                        )`
                      )
                    )
                    .limit(1);

                  if (existing.length > 0) continue;

                  // Insert into messages
                  await db!.insert(messages).values({
                    userId: mailbox.userId,
                    leadId: leadInfo.leadId,
                    provider: 'email',
                    direction: 'inbound',
                    subject: email.subject,
                    body: email.text || email.html || '',
                    externalId: email.messageId,
                    integrationId: mailbox.id,
                    isRead: false,
                    isWarmup: false,
                    metadata: {
                      from: email.from,
                      to: email.to,
                      inReplyTo: email.inReplyTo,
                      references: email.references,
                      sweptAt: new Date().toISOString(),
                    },
                    createdAt: email.date,
                  } as any);

                  imported++;

                  // Update lead status to 'replied' if first reply
                  if (leadInfo.status === 'sent') {
                    await db!.update(campaignLeads)
                      .set({ status: 'replied', updatedAt: new Date() })
                      .where(eq(campaignLeads.id, leadInfo.campaignLeadId));

                    await db!.update(leads)
                      .set({ status: 'replied', updatedAt: new Date() })
                      .where(eq(leads.id, leadInfo.leadId));
                  }

                  // Trigger auto-reply or ConversationAI
                  try {
                    const [campaign] = await db!.select()
                      .from(outreachCampaigns)
                      .where(and(eq(outreachCampaigns.id, leadInfo.campaignId), eq(outreachCampaigns.status, 'active')))
                      .limit(1);

                    if (!campaign) {
                      // Campaign is not active — skip auto-reply entirely
                      wsSync.notifyLeadsUpdated(mailbox.userId, { leadId: leadInfo.leadId, action: 'inbound_swept' });
                      return;
                    }

                    const hasAutoReply = campaign ? !!(campaign.template as any)?.autoReplyBody : false;
                    const isFirstReply = leadInfo.status === 'sent';

                    if (hasAutoReply && isFirstReply) {
                      // Campaign auto-reply template for first-time replies
                      const { campaignQueueManager } = await import('@shared/lib/queues/campaign-queue.js');
                      await campaignQueueManager.scheduleAutoReply(
                        leadInfo.campaignId,
                        mailbox.userId,
                        leadInfo.campaignLeadId,
                        mailbox.id,
                        leadInfo.leadId
                      );
                      autoReplies++;
                    } else {
                      // AI takes over for:
                      //   - First reply when no auto-reply template exists
                      //   - All subsequent replies (ongoing conversations)
                      try {
                        const { enqueuePriorityReply } = await import('@shared/lib/queues/outreach-queue.js');
                        await enqueuePriorityReply({
                          userId: mailbox.userId,
                          leadId: leadInfo.leadId,
                          type: 'autonomous_reply',
                          isAutonomous: true,
                        });
                        console.log(`[InboundSweep] ⚡ Enqueued ConversationAI reply for lead ${leadInfo.leadId}`);
                      } catch (convErr) {
                        console.warn('[InboundSweep] ConversationAI scheduling failed:', (convErr as Error).message);
                      }
                    }
                  } catch (arErr) {
                    console.warn('[InboundSweep] Auto-reply scheduling failed:', (arErr as Error).message);
                  }

                  wsSync.notifyLeadsUpdated(mailbox.userId, { leadId: leadInfo.leadId, action: 'inbound_swept' });
                } catch (procErr: any) {
                  console.warn('[InboundSweep] Failed to process swept email:', procErr.message);
                }
              }

              resolve({ imported, autoReplies, checked });
            });
          });
        });
      });

      imap.once('error', () => { safeEnd(); resolve({ imported: 0, autoReplies: 0, checked: 0 }); });
      try { imap.connect(); } catch { resolve({ imported: 0, autoReplies: 0, checked: 0 }); }
    });
  }
}

export const inboundSweepWorker = new InboundSweepWorker();
