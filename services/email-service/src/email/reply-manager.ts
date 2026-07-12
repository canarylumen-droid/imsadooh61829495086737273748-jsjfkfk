import { db } from '@shared/lib/db/db.js';
import { eq, and, sql, desc } from 'drizzle-orm';
import { leads, campaignLeads, messages, campaignEmails, integrations, outreachCampaigns } from '@audnix/shared';
import { sendEmail } from '@shared/lib/channels/email.js';
import { generateAiReply } from './ai-reply-generator.js';
import { recordIncomingReply, resolvePendingReply } from './mailbox-coordinator.js';

const PIVOT_AFTER_REPLIES = 5;
const MIN_REPLY_DELAY_MS = 120000;
const MAX_REPLY_DELAY_MS = 240000;
const DEDUP_WINDOW_MS = 3600000;

interface PendingReply {
  leadId: string;
  userId: string;
  integrationId: string;
  campaignId: string;
  campaignLeadId: string;
  originalMessage: string;
  previousMessages: Array<{ subject: string; body: string; direction: 'outbound' | 'inbound' }>;
  leadEmail: string;
  leadName: string;
  company: string;
}

export class ReplyManager {
  private replyCounts = new Map<string, number>();
  private recentReplies = new Set<string>();

  async handleIncomingEmail(
    leadEmail: string,
    subject: string,
    body: string,
    userId: string,
    integrationId: string
  ): Promise<void> {
    if (!leadEmail || !userId) return;

    const lead = await db
      .select({ id: leads.id, name: leads.name, company: leads.company, status: leads.status })
      .from(leads)
      .where(and(eq(leads.email, leadEmail), eq(leads.userId, userId)))
      .limit(1);

    if (!lead[0]) return;
    const leadStatus = lead[0].status as string;
    if (leadStatus === 'unsubscribed' || leadStatus === 'bounced') return;

    const activeCampaigns = await db
      .select({
        campaignId: campaignLeads.campaignId,
        campaignLeadId: campaignLeads.id,
        campaignName: outreachCampaigns.name,
      })
      .from(campaignLeads)
      .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
      .where(
        and(
          eq(campaignLeads.leadId, lead[0].id),
          eq(outreachCampaigns.userId, userId),
          eq(outreachCampaigns.status, 'active')
        )
      )
      .limit(1);

    if (!activeCampaigns[0]) return;

    const { campaignId, campaignLeadId, campaignName } = activeCampaigns[0];

    const rawMessages = await db
      .select({ subject: messages.subject, body: messages.body, direction: messages.direction })
      .from(messages)
      .where(and(eq(messages.leadId, lead[0].id), eq(messages.userId, userId)))
      .orderBy(messages.createdAt)
      .limit(10);

    const previousMessages = rawMessages.map(m => ({
      subject: m.subject ?? '',
      body: m.body ?? '',
      direction: m.direction as 'outbound' | 'inbound',
    }));

    const key = `${lead[0].id}:${campaignId}`;
    const bodyHash = body.substring(0, 100);
    const dedupKey = `${key}:${bodyHash}`;

    if (this.recentReplies.has(dedupKey)) {
      console.log(`[ReplyManager] ⏭️ Duplicate reply detected for ${leadEmail} — skipping (already replied to this message)`);
      return;
    }

    const replyCount = this.replyCounts.get(key) || 0;
    const shouldPivot = replyCount >= PIVOT_AFTER_REPLIES;

    this.recentReplies.add(dedupKey);
    setTimeout(() => this.recentReplies.delete(dedupKey), DEDUP_WINDOW_MS);

    recordIncomingReply(integrationId);
    this.replyCounts.set(key, replyCount + 1);

    // ── REPLY STATUS UPDATE ────────────────────────────────────────────
    // Update lead status to 'replied' and notify UI/KPIs
    try {
      await db.update(leads)
        .set({ status: 'replied', updatedAt: new Date() })
        .where(eq(leads.id, lead[0].id));

      await db.update(campaignLeads)
        .set({ status: 'replied', repliedAt: new Date() })
        .where(eq(campaignLeads.leadId, lead[0].id));

      // Update campaign_emails for the last sent email to replied
      await db.update(campaignEmails)
        .set({ status: 'replied' })
        .where(and(
          eq(campaignEmails.campaignId, campaignId),
          eq(campaignEmails.leadId, lead[0].id),
          eq(campaignEmails.status, 'sent')
        ));

      // Notify UI updates
      const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
      wsSync.notifyLeadsUpdated(userId, { leadId: lead[0].id, status: 'replied', action: 'replied' });
      wsSync.notifyMessagesUpdated(userId, { leadId: lead[0].id, direction: 'inbound' });
      wsSync.notifyStatsUpdated(userId, { integrationId, type: 'reply' });
      wsSync.notifyCampaignStatsUpdated(userId, campaignId);
    } catch (err) {
      console.error(`[ReplyManager] Failed to update reply status:`, err);
    }

    const pending: PendingReply = {
      leadId: lead[0].id,
      userId,
      integrationId,
      campaignId,
      campaignLeadId,
      originalMessage: body,
      previousMessages,
      leadEmail,
      leadName: lead[0].name || 'there',
      company: lead[0].company || 'your company',
    };

    const delay = MIN_REPLY_DELAY_MS + Math.random() * (MAX_REPLY_DELAY_MS - MIN_REPLY_DELAY_MS);
    setTimeout(() => this.sendReply(pending), delay);

    console.log(`[ReplyManager] 📨 Queued reply for ${leadEmail} in ${Math.round(delay / 1000)}s (reply #${replyCount + 1})`);
  }

  private async sendReply(pending: PendingReply): Promise<void> {
    try {
      const key = `${pending.leadId}:${pending.campaignId}`;
      const replyCount = this.replyCounts.get(key) || 1;

      const body = await generateAiReply({
        leadEmail: pending.leadEmail,
        leadName: pending.leadName,
        company: pending.company,
        campaignContext: '',
        originalMessage: pending.originalMessage,
        previousMessages: pending.previousMessages,
        userId: pending.userId,
        replyCount,
      });

      await sendEmail(pending.userId, pending.leadEmail, body, 'Re: Your message', {
        isRaw: true,
        isHtml: false,
        integrationId: pending.integrationId,
        campaignId: pending.campaignId,
        leadId: pending.leadId,
        isPriorityReply: true,
      });

      resolvePendingReply(pending.integrationId);

      console.log(`[ReplyManager] ✅ Auto-reply sent to ${pending.leadEmail}`);
    } catch (err: any) {
      console.error(`[ReplyManager] ❌ Failed to send reply to ${pending.leadEmail}:`, err.message);
    }
  }

  resetCounts(): void {
    this.replyCounts.clear();
  }
}

export const replyManager = new ReplyManager();