/**
 * Autonomous Email Outreach Worker
 * 
 * Polls every 5 seconds for users with email integrations
 * and automatically sends AI-personalized cold outreach emails
 * to uncontacted leads with 2-4 minute delays.
 */

import { db } from '@shared/lib/db/db.js';
import { users, leads, messages, integrations, followUpQueue } from '@audnix/shared';
import { eq, and, or, isNull, ne, sql } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { sendEmail } from "@shared/lib/channels/email.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { createTrackedEmail } from "@services/email-service/src/email/email-tracking.js";
/**
 * Generate AI-powered cold outreach email based on lead metadata
 * Uses curiosity, FOMO, trust, and punchy triggers
 */
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { decryptToJSON } from "@shared/lib/crypto/encryption.js";

interface UserWithEmail {
  id: string;
  email: string;
  company: string | null;
  businessName: string | null;
}

interface PriorityLead {
  id: string;
  name: string;
  email: string;
  channel: string;
  status: string;
  metadata: Record<string, unknown>;
  userId: string;
  priority: 1 | 2 | 3; // 1: Reply, 2: Follow-up, 3: Initial
}

async function generateColdOutreachEmail(
  lead: PriorityLead,
  businessName: string,
  brandGuidelines?: string
): Promise<{ subject: string; body: string }> {
  const leadMetadata = lead.metadata || {};
  const leadCompany = (leadMetadata.company as string) || '';
  const leadIndustry = (leadMetadata.industry as string) || '';
  const leadRole = (leadMetadata.role as string) || '';
  const firstName = lead.name.split(' ')[0];

  const systemPrompt = "You are a cold email expert. Return only valid JSON.";
  const prompt = `You are an expert cold email copywriter. Generate a highly personalized cold outreach email.

LEAD INFO:
- Name: ${lead.name} (First name: ${firstName})
- Company: ${leadCompany || 'Unknown'}
- Industry: ${leadIndustry || 'B2B'}
- Role: ${leadRole || 'Decision Maker'}
- Email: ${lead.email}

YOUR BUSINESS:
- Name: ${businessName}
- Brand Materials & Offers: 
${brandGuidelines || "Offering: AI-powered sales automation and growth solutions."}

PSYCHOLOGICAL TRIGGERS TO USE:
1. **CURIOSITY** - Tease a benefit without revealing everything. Make them want to know more.
2. **FOMO** - Others are using this, limited spots, exclusive access
3. **TRUST** - Specific results, social proof, credibility markers
4. **PUNCHY** - Short sentences. Impactful. No fluff.

RULES:
- Subject line: 5-8 words max, create intrigue, no spam words
- First line: Pattern interrupt, NOT "I hope this email finds you well"
- Body: 3-4 short paragraphs max (2-3 sentences each)
- Focus on THEIR pain, not your product features
- End with a soft CTA - get the REPLY first, not the call
- NO links in first email
- Sound human, not salesy
- Use their first name naturally

Return strictly valid JSON only:
{
  "subject": "...",
  "body": "..."
}`;

  try {
    const { text } = await generateReply(systemPrompt, prompt, {
      jsonMode: true,
      temperature: 0.8,
      nga1Enforced: true
    });

    if (text) {
      const parsed = JSON.parse(text);
      return {
        subject: parsed.subject,
        body: parsed.body
      };
    }
  } catch (error) {
    console.error('[AutoOutreach] AI generation error:', error);
    throw new Error('AI generation failed - skipping outreach to avoid poor quality message');
  }

  throw new Error('AI generation returned empty text');
}

/**
 * Autonomous Outreach Worker Class
 */
export class AutonomousOutreachWorker {
  private isRunning: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private activeOutreachQueue: Map<string, boolean> = new Map(); // Track users being processed
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds
  private readonly MIN_DELAY_MS = 60000; // 1 minute
  private readonly MAX_DELAY_MS = 120000; // 2 minutes
  private readonly REPLY_DELAY_MS = 10000; // 10 seconds for replies

  constructor() {
    this.isRunning = false;
    this.pollingInterval = null;
  }

  /**
   * Start the autonomous outreach worker (BullMQ Mode)
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[AutoOutreach] Worker is already running');
      return;
    }

    this.isRunning = true;
    console.log('✅ Autonomous outreach worker started (BullMQ Mode)');

    const { createWorker } = await import("@shared/lib/worker");

    // Register a worker to process outreach tasks
    createWorker('outreach-engine', async (job: any) => {
      if (job.name === 'engine-tick') {
        console.log('[BullMQ] Processing engine-tick...');
        await this.checkAndProcessUsers();
      } else if (job.name.startsWith('outreach-autonomous-')) {
        const { userId, integrationId, isAutonomous } = job.data;
        console.log(`[BullMQ] Processing autonomous outreach for user ${userId}...`);
        await this.processUserOutreach(userId, integrationId, isAutonomous);
      }
    }, {
      concurrency: 5, // Allow processing 5 users/tasks in parallel per node
    });

    // Initial check
    this.checkAndProcessUsers();
  }

  /**
   * Stop the autonomous outreach worker
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log('🛑 Autonomous outreach worker stopped');
  }

  // Placeholder to avoid breaking other parts while refactoring
  private async processUserOutreach(userId: string, integrationId: string, isAutonomous: boolean) {
    // This will call the logic in outreach-engine.ts or processLeadsWithPriority
    const leads = await this.getPrioritizedLeads(userId);
    if (leads.length > 0) {
      await this.processLeadsWithPriority(userId, leads);
    }
  }

  /**
   * Check for users with email integrations and process their leads
   */
  /**
   * Check for users with email integrations and process their leads
   */
  private async checkAndProcessUsers(): Promise<void> {
    if (!db) return;

    try {
      // Find users with connected email integrations
      // REMOVED: Global "autonomous_outreach_enabled" check.
      // We now rely on Lead-level "aiPaused" flag.
      const usersWithEmail = await db
        .select({
          userId: integrations.userId,
          metadata: users.metadata,
        })
        .from(integrations)
        .innerJoin(users, eq(integrations.userId, users.id))
        .where(
          and(
            eq(integrations.connected, true),
            or(
              eq(integrations.provider, 'custom_email'),
              eq(integrations.provider, 'gmail'),
              eq(integrations.provider, 'outlook')
            )
          )
        );

      if (usersWithEmail.length === 0) {
        return; // No users with email integrations
      }

      const uniqueUserIds = [...new Set(usersWithEmail.map((u: any) => u.userId))];

      for (const userId of uniqueUserIds) {
        if (this.activeOutreachQueue.has(userId as string)) continue;

        try {
          const leads = await this.getPrioritizedLeads(userId as string);
          if (leads.length > 0) {
            console.log(`[AutoOutreach] User ${userId} has ${leads.length} leads in priority queue`);
            this.activeOutreachQueue.set(userId as string, true);
            // Non-blocking processing
            this.processLeadsWithPriority(userId as string, leads).catch(err => {
                 console.error(`[AutoOutreach] Error in background process for user ${userId}:`, err);
                 this.activeOutreachQueue.delete(userId as string);
            });
          }
        } catch (innerErr) {
          console.error(`[AutoOutreach] Error processing user ${userId}:`, innerErr);
        }
      }

      workerHealthMonitor.recordSuccess('autonomous-outreach-worker');
    } catch (error: any) {
      console.error('[AutoOutreach] Error checking users:', error);
      workerHealthMonitor.recordError('autonomous-outreach-worker', error?.message || 'Unknown error');
    }
  }

  /**
   * Get all leads requiring action, prioritized by engagement level
   */
  private async getPrioritizedLeads(userId: string): Promise<PriorityLead[]> {
    if (!db) return [];

    try {
      const allLeads: PriorityLead[] = [];

      // 1. Priority 1: Replied leads (Needs AI Reply)
      const repliedLeads = await db.select().from(leads).where(
        and(
          eq(leads.userId, userId),
          eq(leads.status, 'replied'),
          eq(leads.aiPaused, false)
        )
      ).limit(20);

      repliedLeads.forEach((l: any) => {
        allLeads.push({
          ...l,
          email: l.email as string,
          channel: l.channel as string,
          priority: 1,
          metadata: l.metadata as any
        });
      });

      // 2. Priority 2: Leads needing follow-ups (Status 'open'/'warm', no activity for 2 days)
      const followUpLeads = await db.select().from(leads).where(
        and(
          eq(leads.userId, userId),
          or(eq(leads.status, 'open'), eq(leads.status, 'warm')),
          eq(leads.aiPaused, false),
          sql`${leads.lastMessageAt} < ${new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)}`
        )
      ).limit(20);

      followUpLeads.forEach((l: any) => {
        allLeads.push({
          ...l,
          email: l.email as string,
          channel: l.channel as string,
          priority: 2,
          metadata: l.metadata as any
        });
      });

      // 3. Priority 3: Initial outreach ('new' status)
      const initialLeads = await db.select().from(leads).where(
        and(
          eq(leads.userId, userId),
          eq(leads.status, 'new'),
          eq(leads.aiPaused, false)
        )
      ).limit(20);

      initialLeads.forEach((l: any) => {
        allLeads.push({
          ...l,
          email: l.email as string,
          channel: l.channel as string,
          priority: 3,
          metadata: l.metadata as any
        });
      });

      // Sort by priority (1 is highest)
      return allLeads.sort((a, b) => a.priority - b.priority);
    } catch (error) {
      console.error('[AutoOutreach] Error fetching prioritized leads:', error);
      return [];
    }
  }

  /**
   * Process leads with priority sorting and dynamic volume caps (Soft Limit)
   */
  private async processLeadsWithPriority(userId: string, leads: PriorityLead[]): Promise<void> {
    try {
      // Get user info for branding
      const user = await storage.getUserById(userId);
      const businessName = user?.company || user?.businessName || 'Our Team';

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];

        // 1. CHECK VOLUME CAPS & SOFT LIMITS
        const integrations = await storage.getIntegrations(userId);
        const mailbox = integrations.find(i => i.id === (lead.metadata as any)?.integrationId) || integrations.find(i => i.connected);
        
        if (!mailbox) continue;

        const isGmailOrOutlook = mailbox.provider === 'gmail' || mailbox.provider === 'outlook';
        const limit = isGmailOrOutlook ? 500 : 2500;
        const mailboxMeta = decryptToJSON(mailbox.encryptedMeta) || {};
        const todaySent = (mailboxMeta as any).dailySentCount || 0;
        
        /**
         * ADVANCED GMAIL BUFFERING (Phase 13)
         * - Hard cap: 500 (Gmail/Outlook)
         * - Initial Outreach (Priority 3) Cap: 350 (Buffer of 150 for replies)
         * - Replies (Priority 1/2) keep going until Hard Cap
         */
        const isPriority3 = lead.priority === 3;
        const remainingBuffer = limit - todaySent;
        const bufferThreshold = isGmailOrOutlook ? 150 : 0; 

        if (todaySent >= limit) {
          console.log(`[AutoOutreach] 🛑 Hard cap reached for mailbox ${mailboxMeta.email || mailbox.id} (${todaySent}/${limit}). Skipping ALL sends.`);
          continue;
        }

        if (isPriority3 && remainingBuffer <= bufferThreshold) {
          console.log(`[AutoOutreach] ⏸️  Buffer threshold (150) reached for Gmail/Outlook outreach. Skipping Priority 3 send.`);
          continue;
        }

        // [PHASE 47] 4-Tier Health Graceful Throttling
        const healthLevel = (mailbox as any).healthLevel || 'healthy';
        const gracefulLimit = (mailbox as any).gracefulDailyLimit;

        if (healthLevel === 'critical') {
           console.log(`[AutoOutreach] 🛑 CRITICAL HEALTH for ${mailbox.id}. Blocking Priority 3 outreach for recovery.`);
           if (isPriority3) continue; // Only block initial outreach on critical, allow replies if possible (replies handled elsewhere)
        }

        if (gracefulLimit !== null && gracefulLimit !== undefined && isPriority3) {
           if (todaySent >= gracefulLimit) {
              console.log(`[AutoOutreach] 🛡️ GRACEFUL THROTTLE: Mailbox ${mailbox.id} capped at ${gracefulLimit} due to ${healthLevel} state.`);
              continue;
           }
        }

          try {
            await this.sendPriorityActionToLead(userId, lead, businessName);

            // HUMANIZATION LOGIC: 
            // 1. Replies (Priority 1) -> 10s delay (Fast but not instant)
            // 2. Outreach (Priority 2/3) -> 1-2 minute delay
            if (i < leads.length - 1) {
              const isReply = lead.priority === 1;
              const delay = isReply 
                ? this.REPLY_DELAY_MS 
                : (this.MIN_DELAY_MS + Math.random() * (this.MAX_DELAY_MS - this.MIN_DELAY_MS));
              
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (error) {
          console.error(`[AutoOutreach] Failed to process ${lead.email}:`, error);
        }
      }
    } finally {
      this.activeOutreachQueue.delete(userId);
    }
  }

  /**
   * Performs a strategic audit of the user's dashboard performance
   * and adjusts AI behavior/templates if underperforming.
   */
  private async performStrategicAudit(userId: string): Promise<string | null> {
    try {
      const { storage } = await import('@shared/lib/storage/storage.js');
      const stats = await storage.getDashboardStats(userId);
      
      // Industry standards (Approximate)
      const MIN_REPLY_RATE = 2.0; // 2% 
      const MIN_OPEN_RATE = 25.0; // 25%

      const isUnderperforming = 
        (stats.responseRate < MIN_REPLY_RATE && stats.totalLeads > 50) ||
        (stats.openRate < MIN_OPEN_RATE && stats.totalMessages > 50);

      if (isUnderperforming) {
        console.log(`[StrategicAudit] 🧠 User ${userId} is underperforming (Reply: ${stats.responseRate.toFixed(2)}%, Open: ${stats.openRate.toFixed(2)}%). Adjusting strategy...`);
        
        const systemPrompt = "You are the Audnix Strategic AI Observer. Your goal is to improve sales performance.";
        const auditPrompt = `
AUDNIX AGENT REPORT:
- Reply Rate: ${stats.responseRate.toFixed(2)}% (Target: >2%)
- Open Rate: ${stats.openRate.toFixed(2)}% (Target: >25%)
- Total Leads: ${stats.totalLeads}
- Converted: ${stats.convertedLeads}

STRATEGIC DECISION:
The current outreach is underperforming. Based on the data, what should we change?
Focus on one of: 'Urgency', 'Clarity', 'Soft CTA', or 'Social Proof'.
Provide a 1-sentence strategic directive for the outreach generation.
`;

        const { text } = await generateReply(systemPrompt, auditPrompt, {
          temperature: 0.7,
          maxTokens: 100,
          nga1Enforced: true
        });

        return text.trim();
      }
      
      return null;
    } catch (error) {
      console.error('[StrategicAudit] Audit failed:', error);
      return null;
    }
  }

  /**
   * Performs the actual outreach action (Initial, Follow-up, or Reply)
   */
  private async sendPriorityActionToLead(
    userId: string,
    lead: PriorityLead,
    businessName: string
  ): Promise<void> {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const user = await storage.getUserById(userId);
    const brandGuidelines = user?.brandGuidelinePdfText || (user?.metadata as any)?.brandContext || "";
    const calendarLink = (user as any)?.calendarLink || (user as any)?.calendlyLink || "";
    
    // Determine Action Type using Stateful Context-Aware Agent
    const { getBrandContext } = await import("@services/brain-worker/src/ai-lib/context/brand-context.js");
    const { generateContextAwareMessage } = await import("@services/brain-worker/src/orchestrator/agents/universal-sales-agent-integrated.js");
    const brandContext = await getBrandContext(userId);
    const threadMessages = await storage.getMessagesByLeadId(lead.id);
    let emailContent: { subject: string, body: string };
    
    console.log(`[AutoOutreach] 🧠 Generating Priority ${lead.priority} Context-Aware response for ${lead.email}...`);
    
    const aiResult = await generateContextAwareMessage(
      lead as any,
      brandContext,
      [], // Testimonials
      threadMessages
    );

    emailContent = {
      subject: (lead.metadata as any)?.outreach_subject || aiResult.subject || `Question for ${lead.name}`,
      body: aiResult.message
    };

    // Generate tracking token
    const { token } = await createTrackedEmail({
      userId,
      leadId: lead.id,
      recipientEmail: lead.email,
      subject: emailContent.subject,
      sentAt: new Date(),
      messageId: `auto_${Date.now()}`
    });

    // Send the email
    await sendEmail(
      userId,
      lead.email,
      emailContent.body,
      emailContent.subject,
      { 
        isHtml: true,
        trackingId: token,
        leadId: lead.id
      }
    );

    console.log(`[AutoOutreach] ✅ Priority ${lead.priority} Action completed for ${lead.email}`);

    // Record last outreach activity in user metadata for the dashboard
    try {
      const user = await storage.getUserById(userId);
      const metadata = user?.metadata || {};
      await storage.updateUser(userId, {
        metadata: {
          ...metadata,
          last_outreach_activity: new Date().toISOString()
        }
      });
    } catch (metaErr) {
      console.warn(`[AutoOutreach] Failed to update user last_outreach_activity:`, metaErr);
    }

    // Save message to database
    await storage.createMessage({
      leadId: lead.id,
      userId: userId,
      provider: 'email',
      direction: 'outbound',
      body: emailContent.body,
      integrationId: (lead as any).integrationId || null,
      metadata: {
        subject: emailContent.subject,
        ai_generated: true,
        outreach_type: 'cold_email',
        sent_at: new Date().toISOString(),
        integrationId: (lead as any).integrationId || null,
        integration_id: (lead as any).integrationId || null
      }
    });

    // Update lead status and metadata
    await storage.updateLead(lead.id, {
      status: 'open',
      lastMessageAt: new Date(),
      metadata: {
        ...lead.metadata,
        outreach_sent: true,
        outreach_sent_at: new Date().toISOString(),
        outreach_subject: emailContent.subject
      }
    });

    // Schedule 6-hour follow-up
    const followUpTime = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
    await storage.createFollowUp({
      userId: userId,
      leadId: lead.id,
      channel: 'email',
      scheduledAt: followUpTime,
      status: 'pending',
      context: {
        type: 'first_followup',
        originalSubject: emailContent.subject
      }
    });

    // Create notification for UI
    await storage.createNotification({
      userId: userId,
      type: 'insight',
      title: '📧 Outreach Sent',
      message: `Cold email sent to ${lead.name} (${lead.email})`,
      metadata: {
        leadId: lead.id,
        leadName: lead.name,
        subject: emailContent.subject,
        activityType: 'outreach_sent'
      }
    });

    // Send real-time WebSocket updates
    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'outreach_sent' });
    wsSync.notifyMessagesUpdated(userId, { leadId: lead.id });
    wsSync.notifyActivityUpdated(userId, { type: 'outreach_sent', leadName: lead.name });
    // Also notify stats update for real-time dashboard KPIs
    wsSync.broadcastToUser(userId, { type: 'stats_updated', payload: { source: 'outreach_worker' } });
  }
}

// Export singleton instance
export const autonomousOutreachWorker = new AutonomousOutreachWorker();







