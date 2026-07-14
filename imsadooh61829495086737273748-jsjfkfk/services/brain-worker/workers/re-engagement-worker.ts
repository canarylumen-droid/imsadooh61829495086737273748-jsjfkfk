import { db } from '@shared/lib/db/db.js';
import { leads, users, messages } from "@audnix/shared";
import { eq, and, sql, lt, isNull, inArray } from "drizzle-orm";
import { storage } from '@shared/lib/storage/storage.js';
import { generateAIReply } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";
import { sendEmail } from "@shared/lib/channels/email.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";

/**
 * Phase 48: Autonomous Re-Engagement Worker
 * Targets Cold leads (>90 days since last activity) with value-add insights.
 * This is a "Long-Term Nurture" autonomous cycle.
 */
export class ReEngagementWorker {
  private isRunning: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private readonly TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Run once every 24 hours

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.interval = setInterval(() => this.tick(), this.TICK_INTERVAL_MS);
    console.log("🧊 Re-Engagement Worker initialized (Cycle: 24h)");
  }

  stop(): void {
    if (!this.isRunning) return;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log("🧊 Re-Engagement Worker stopped");
  }

  async tick(): Promise<void> {
    try {
      const health = workerHealthMonitor.isSystemPaused();
      if (health.paused) {
        console.warn(`🛑 [ReEngagementWorker] Skipping cycle - System in EMERGENCY BRAKE: ${health.reason}`);
        return;
      }

      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      
      // Find leads: Cold status or inactive for 90 days
      const targets = await db.select()
        .from(leads)
        .where(
          and(
            eq(leads.aiPaused, false),
            lt(leads.lastMessageAt, ninetyDaysAgo),
            inArray(leads.status, ['open', 'cold', 'contacted', 'nurturing', 'new', 'warm'] as any[]),
            sql`(${leads.metadata}->>'re_engagement_sent')::boolean IS NULL`
          )
        )
        .limit(30);

      for (const lead of targets) {
        // Phase 50 Fix: Multi-node race condition prevention
        const reserved = await storage.reserveLeadForAction(lead.id, 're-engagement-worker', 30000);
        if (!reserved) {
          console.log(`🧊 [Re-Engagement] Skipping lead ${lead.id} - Already reserved by another worker`);
          continue;
        }
        await this.processReEngagement(lead);
      }

      workerHealthMonitor.recordSuccess('re-engagement-worker');
    } catch (error: any) {
      console.error("[ReEngagementWorker] Tick error:", error);
      workerHealthMonitor.recordError('re-engagement-worker', error.message);
    }
  }

  private async processReEngagement(lead: any): Promise<void> {
    try {
      console.log(`🧊 [Re-Engagement] Reactivating cold lead: ${lead.email}`);
      
      const user = await storage.getUser(lead.userId);
      const history = await storage.getMessagesByLeadId(lead.id);

      // Value-Add Prompt: Focus on a new insight or case study
      const reEngagementPrompt = "REACTIVATION: This lead has been cold for 90 days. Share a new value-add insight or a recent success story that matches their sector. Do NOT offer a discount. Focus on 'Thinking of you because our latest partners just saw [X] results'. Keep it brief — one insight, one soft CTA.";

      const reply = await generateAIReply(lead, history, 'email', {
        businessName: user?.businessName || 'Audnix',
        brandVoice: 'Helpful strategic advisor',
        systemPromptSuffix: reEngagementPrompt
      });

      if (reply && !reply.blocked) {
        const ints = await storage.getIntegrations(lead.userId);
        const mailbox = ints.find(i => ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected);
        
        if (mailbox) {
          // --- REFINED THREADING LOGIC ---
          let inReplyTo: string | undefined = undefined;
          let references: string | undefined = undefined;
          let threadId: string | undefined = undefined;

          try {
            if (history.length > 0) {
              const lastMsg = history[0]; // history is usually desc
              const meta = (lastMsg.metadata as any) || {};
              inReplyTo = lastMsg.externalId || meta.externalId;
              threadId = meta.providerThreadId || meta.threadId;

              if (inReplyTo) {
                const prevRefs = meta.references || "";
                references = prevRefs ? `${prevRefs} ${inReplyTo}` : inReplyTo;
              }
            }
          } catch (threadErr) {
            console.warn(`[ReEngagementWorker] Threading failed for ${lead.id}:`, threadErr);
          }

          const subject = "Checking back in with some news...";
          const threadSubject = inReplyTo ? `Re: ${subject}` : subject;

          await sendEmail(lead.userId, lead.email, reply.text, threadSubject, {
            leadId: lead.id,
            integrationId: mailbox.id,
            inReplyTo,
            references,
            threadId
          });

          // Record message for history continuity
          await storage.createMessage({
            userId: lead.userId,
            leadId: lead.id,
            provider: 'email',
            direction: 'outbound',
            subject: threadSubject,
            body: reply.text,
            integrationId: mailbox.id,
            metadata: { 
              re_activation: true,
              inReplyTo,
              references,
              providerThreadId: threadId
            }
          });

          await storage.updateLead(lead.id, {
            status: 'contacted', // Moved back to active outreach — not 'replied' until lead actually responds
            metadata: {
              ...(lead.metadata as any || {}),
              re_engagement_sent: new Date().toISOString(),
              reactivated_at: new Date().toISOString()
            }
          });
        }
      }
    } catch (err) {
      console.error(`[ReEngagementWorker] Failed for lead ${lead.id}:`, err);
    }
  }
}

export const reEngagementWorker = new ReEngagementWorker();






