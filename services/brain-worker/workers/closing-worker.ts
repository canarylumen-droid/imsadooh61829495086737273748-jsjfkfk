import { db } from '@shared/lib/db/db.js';
import { leads, messages, users } from "@audnix/shared";
import { eq, and, or, gte, sql, lt, desc } from "drizzle-orm";
import { storage } from '@shared/lib/storage/storage.js';
import { generateAIReply } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";
import { sendEmail } from "@shared/lib/channels/email.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";

/**
 * Phase 44: Autonomous Closing Worker
 * Targeted at leads with Score A (>85) that are stalled for 48+ hours.
 * Sends a high-urgency, persistent closing message to push for a booking.
 */
export class ClosingWorker {
  private isRunning: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private readonly TICK_INTERVAL_MS = 30 * 60 * 1000; // Run every 30 minutes

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.interval = setInterval(() => this.tick(), this.TICK_INTERVAL_MS);
    console.log("🏙️ Closing Worker started (targeting high-value stalls)");
  }

  async tick(): Promise<void> {
    try {
      const health = workerHealthMonitor.isSystemPaused();
      if (health.paused) {
        console.warn(`🛑 [ClosingWorker] Skipping cycle - System in EMERGENCY BRAKE: ${health.reason}`);
        return;
      }

      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      
      // 1. Find leads: Score A, Stalled for 48h, Replied or Open status
      const stalledLeads = await db.select({
        lead: leads,
        lastMessage: messages
      })
      .from(leads)
      .leftJoin(messages, eq(leads.id, messages.leadId))
      .where(
        and(
          gte(leads.score, 85), // Category A: any lead scoring 85+ (high-value)
          or(eq(leads.status, 'replied'), eq(leads.status, 'contacted')),
          eq(leads.aiPaused, false),
          sql`(${leads.metadata}->>'last_closing_nudge')::boolean IS NULL`,
          lt(messages.createdAt, fortyEightHoursAgo)
        )
      )
      .orderBy(desc(messages.createdAt))
      .limit(20);

      for (const row of stalledLeads) {
        const lead = row.lead;
        const lastMsg = row.lastMessage;
        
        // Safety: Only nudge if the LAST message was from US (waiting for them)
        if (lastMsg && lastMsg.direction === 'outbound') {
          await this.sendClosingNudge(lead);
        }
      }

      workerHealthMonitor.recordSuccess('closing-worker');
    } catch (error: any) {
      console.error("[ClosingWorker] Tick error:", error);
      workerHealthMonitor.recordError('closing-worker', error.message);
    }
  }

  private async sendClosingNudge(lead: any): Promise<void> {
    try {
      console.log(`🎯 [ClosingWorker] Sending high-urgency nudge to high-value lead: ${lead.email}`);
      
      const userId = lead.userId;
      const user = await storage.getUser(userId);
      const history = await storage.getMessagesByLeadId(lead.id);

      // Trigger a specific "Closing" variation via generateAIReply
      // We'll inject a command into the conversation history context
      const closingPrompt = "STALL DETECTION: This lead is high-value but hasn't replied in 48h. Send a high-urgency, scarcity-based closing nudge. Be professional but firm. Mention we are finalizing spots for the week. Create urgency without sounding desperate. One clear call-to-action only.";

      const reply = await generateAIReply(lead, history, 'email', {
        businessName: user?.businessName || 'Audnix',
        brandVoice: 'High-urgency closing advisor',
        systemPromptSuffix: closingPrompt
      });

      if (reply && !reply.blocked) {
        // Find an active mailbox for this user
        const ints = await storage.getIntegrations(userId);
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
            console.warn(`[ClosingWorker] Threading failed for ${lead.id}:`, threadErr);
          }

          const subject = "One final thing...";
          const threadSubject = inReplyTo ? `Re: ${subject}` : subject;

          await sendEmail(userId, lead.email, reply.text, threadSubject, {
            leadId: lead.id,
            integrationId: mailbox.id,
            inReplyTo,
            references,
            threadId
          });

          // Record message for history continuity
          await storage.createMessage({
            userId,
            leadId: lead.id,
            provider: 'email',
            direction: 'outbound',
            subject: threadSubject,
            body: reply.text,
            integrationId: mailbox.id,
            metadata: { 
              closing_nudge: true,
              inReplyTo,
              references,
              providerThreadId: threadId
            }
          });

          // Mark as nudged
          await storage.updateLead(lead.id, {
            metadata: {
              ...(lead.metadata as any || {}),
              last_closing_nudge: new Date().toISOString(),
              closing_nudge_sent: true
            }
          });
        }
      }
    } catch (err) {
      console.error(`[ClosingWorker] Failed to nudge lead ${lead.id}:`, err);
    }
  }
}

export const closingWorker = new ClosingWorker();






