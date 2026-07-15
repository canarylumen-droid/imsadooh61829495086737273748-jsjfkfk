/**
 * Autonomous Email Outreach Worker
 * 
 * Polls every 5 seconds for users with email integrations
 * and automatically sends AI-personalized cold outreach emails
 * to uncontacted leads with 2-4 minute delays.
 */

import { db } from '@shared/lib/db/db.js';
import { users, leads, messages, integrations, followUpQueue, outreachCampaigns, campaignLeads, campaignEmails } from '@audnix/shared';
import { eq, and, or, isNull, ne, sql } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { clusterSync } from "@shared/lib/realtime/redis-pubsub.js";
import { sendEmail } from "@shared/lib/channels/email.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
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

  const systemPrompt = `## IDENTITY
You are a world-class cold email copywriter. You write emails that get replies from busy decision-makers.

## MISSION
Generate a highly personalized cold outreach email based on lead intelligence and brand context. Every email must feel hand-written, not templated.

## 🔒 ANTI-HALLUCINATION RULES (STRICT)
1. ONLY use the lead info and brand guidelines provided. Do not invent company details, pain points, or needs.
2. Do not claim specific results, metrics, or case studies not present in the brand materials.
3. No fake social proof ("other companies love us", "join 1000+ customers") unless explicitly provided.

## HARD CONSTRAINTS
1. Subject line: 5-8 words max, create intrigue, no spam words.
2. First line: Pattern interrupt. NOT "I hope this email finds you well", NOT "My name is X".
3. Body: 3-4 short paragraphs max (2-3 sentences each). Scannable.
4. Focus on THEIR pain, not your product features. Show you understand their world.
5. End with a soft CTA — get the REPLY first, not the call booking.
6. NO links in first email. First email is about earning the reply.
7. Sound human, not salesy. Like a peer sending a useful observation.
8. Use their first name naturally (once, in the flow).
9. Return ONLY valid JSON. No explanation.

## OUTPUT FORMAT (JSON ONLY)
{
  "subject": "intriguing subject line (5-8 words)",
  "body": "email body (3-4 short paragraphs, pattern-interrupt opening, soft CTA)"
}`;
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
 * Start the autonomous outreach worker (Passive Mode)
 * 
 * NOTE: This worker no longer self-triggers on engine-tick or at startup.
 * Autonomous outreach is exclusively driven by the OutreachEngine.
 * This class only handles explicitly dispatched autonomous jobs.
 */
async start(): Promise<void> {
  if (this.isRunning) {
    console.log('[AutoOutreach] Worker is already running');
    return;
  }

  this.isRunning = true;
  console.log('✅ Autonomous outreach worker started (Passive Mode — no auto-send)');

  const { createWorker } = await import("@shared/lib/worker");

  // Only handle explicitly dispatched autonomous outreach jobs.
  // engine-tick is intentionally NOT handled here to prevent double-sends
  // (the OutreachEngine + outreach-worker/index.ts worker handles ticks).
  createWorker('outreach-engine', async (job: any) => {
    if (job.name.startsWith('outreach-autonomous-')) {
      const { userId, integrationId, isAutonomous } = job.data;

      // SAFETY GUARD: Never process users without active campaigns,
      // regardless of autonomous mode flag. The campaign must exist.
      const userHasActiveCampaigns = await this.checkUserHasActiveCampaigns(userId);
      if (!userHasActiveCampaigns) {
        console.log(`[AutoOutreach] Skipping user ${userId}: no active campaigns found`);
        return;
      }

      console.log(`[BullMQ] Processing autonomous outreach for user ${userId}...`);
      await this.processUserOutreach(userId, integrationId, isAutonomous);
    }
  }, {
    concurrency: 5,
  });
}

/**
 * Check if a user has any active outreach campaigns
 */
private async checkUserHasActiveCampaigns(userId: string): Promise<boolean> {
  try {
    const { outreachCampaigns } = await import('@audnix/shared');
    const { eq, and } = await import('drizzle-orm');
    const result = await db.select({ id: outreachCampaigns.id })
      .from(outreachCampaigns)
      .where(and(
        eq(outreachCampaigns.userId, userId),
        eq(outreachCampaigns.status, 'active')
      ))
      .limit(1);
    return result.length > 0;
  } catch {
    return false;
  }
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

        // SAFETY GUARD: Skip users who have no active campaigns
        // This prevents automatic sending when no campaign was started
        const hasActiveCampaigns = await this.checkUserHasActiveCampaigns(userId as string);
        if (!hasActiveCampaigns) {
          console.log(`[AutoOutreach] Skipping user ${userId}: no active campaigns found`);
          continue;
        }

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
          or(eq(leads.status, 'contacted'), eq(leads.status, 'warm')),
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
          eq(leads.aiPaused, false),
          // Strictly honor AI Outreach Consent — leads must explicitly opt-in
          sql`(${leads.metadata}->>'ai_outreach_consent')::boolean = true`
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
        ((stats.responseRate ?? 0) < MIN_REPLY_RATE && stats.totalLeads > 50) ||
        ((stats.openRate ?? 0) < MIN_OPEN_RATE && stats.totalMessages > 50);

      if (isUnderperforming) {
        console.log(`[StrategicAudit] 🧠 User ${userId} is underperforming (Reply: ${(stats.responseRate ?? 0).toFixed(2)}%, Open: ${(stats.openRate ?? 0).toFixed(2)}%). Adjusting strategy...`);
        
        const systemPrompt = `## IDENTITY
You are the Audnix Strategic AI Observer — a sales performance analyst that turns data into actionable strategy.

## MISSION
Analyze outreach performance metrics and recommend ONE specific strategic change to improve results.

## 🔒 ANTI-HALLUCINATION RULES
1. Base your recommendation SOLELY on the metrics provided. Do not reference external benchmarks or industry data.
2. Do not claim specific improvement projections ("this will double your reply rate").
3. Focus on what the data actually shows — not what you assume.

## HARD CONSTRAINTS
1. Choose ONE focus area: 'Urgency', 'Clarity', 'Soft CTA', or 'Social Proof'.
2. Provide exactly ONE sentence as your strategic directive.
3. The directive must be specific and actionable — not generic advice.
4. Output ONLY the strategic directive sentence. No labels, no formatting, no explanation.`;
        const auditPrompt = `
AUDNIX AGENT REPORT:
- Reply Rate: ${(stats.responseRate ?? 0).toFixed(2)}% (Target: >2%)
- Open Rate: ${(stats.openRate ?? 0).toFixed(2)}% (Target: >25%)
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

    // ── MAILER DAEMON / BOUNCE ADDRESS SUPPRESSION ──────────────────────────
    // Never send to Mailer Daemon, noreply, postmaster, or abuse addresses.
    const SUPPRESSED_PATTERNS = [
      /mailer[-_]?daemon/i,
      /^(noreply|no-reply|postmaster|abuse|bounce|return-path|bounces\+)/i,
      /^(mail-noreply|auto-reply|automailer|donotreply)/i,
    ];
    const emailLower = (lead.email || '').toLowerCase();
    const localPart = emailLower.split('@')[0] || '';
    if (SUPPRESSED_PATTERNS.some(p => p.test(emailLower) || p.test(localPart))) {
      console.log(`[AutoOutreach] 🚫 Suppressed send to bounce/daemon address: ${lead.email}. Pausing AI for this lead.`);
      await storage.updateLead(lead.id, {
        aiPaused: true,
        metadata: {
          ...(lead.metadata || {} as any),
          suppressed: true,
          suppressedAt: new Date().toISOString(),
          suppressionReason: 'mailer_daemon_bounce_address',
        }
      });
      return;
    }

    const user = await storage.getUserById(userId);
    const brandGuidelines = user?.brandGuidelinePdfText || (user?.metadata as any)?.brandContext || "";
    const calendarLink = (user as any)?.calendarLink || (user as any)?.calendlyLink || "";
    
    // Determine Action Type using Stateful Context-Aware Agent
    const { getBrandContext } = await import("@services/brain-worker/src/ai-lib/context/brand-context.js");
    const { generateContextAwareMessage } = await import("@services/brain-worker/src/orchestrator/agents/universal-sales-agent-integrated.js");
    const { sanitizeEmailBody, sanitizeEmailSubject } = await import("@services/brain-worker/src/ai-lib/analyzers/ai-sanitizer.js");
    const { resolveTemplateVars } = await import('@shared/lib/template-variables.js');
    const brandContext = await getBrandContext(userId);
    const threadMessages = await storage.getMessagesByLeadId(lead.id);
    let emailContent: { subject: string, body: string } = { subject: '', body: '' };
    
    // ── LOOK UP CAMPAIGN TEMPLATE FIRST ────────────────────────────────────
    // If this lead belongs to an active campaign, use the campaign template
    // instead of generating new AI copy. This prevents wrong/duplicate copy.
    let campaignTemplate: any = null;
    try {
      const campaignLeadRows = await db.select({ 
        campaignId: campaignLeads.campaignId,
        currentStep: campaignLeads.currentStep
      })
        .from(campaignLeads)
        .where(eq(campaignLeads.leadId, lead.id))
        .limit(1);
      
      if (campaignLeadRows.length > 0) {
        const [campaignRow] = await db.select({ template: outreachCampaigns.template, config: outreachCampaigns.config })
          .from(outreachCampaigns)
          .where(eq(outreachCampaigns.id, campaignLeadRows[0].campaignId))
          .limit(1);
        
        if (campaignRow?.template) {
          campaignTemplate = campaignRow.template;
          const step = campaignLeadRows[0].currentStep;
          const followups = (campaignTemplate as any)?.followups || [];
          
          if (step > 0 && followups[step - 1]) {
            // Use follow-up template
            const resolvedBody = followups[step - 1].body || (campaignTemplate as any)?.body || '';
            const resolvedSubject = followups[step - 1].subject || (campaignTemplate as any)?.subject || `Following up`;
            console.log(`[AutoOutreach] 📋 Using campaign follow-up template step ${step} for ${lead.email}`);
            
            // Get sender context for template vars
            const integrationsList = await storage.getIntegrations(userId);
            const mailboxForTemplate = integrationsList.find((i: any) => i.id === (lead.metadata as any)?.integrationId)
              || integrationsList.find((i: any) => i.connected && ['custom_email', 'gmail', 'outlook'].includes(i.provider));
            const senderContextForTemplate = {
              name: (mailboxForTemplate as any)?.name || user?.name || user?.businessName || businessName,
              email: (mailboxForTemplate as any)?.email || user?.email || '',
            };
            
            emailContent = {
              subject: resolveTemplateVars(resolvedSubject, lead, senderContextForTemplate),
              body: resolveTemplateVars(resolvedBody, lead, senderContextForTemplate),
            };
            
            if (emailContent.body && emailContent.body.trim().length > 10) {
              // Skip AI generation below — use template directly
              campaignTemplate = 'USED'; // marker
            }
          } else if (!(campaignTemplate as any)?.followups || (campaignTemplate as any).followups.length === 0) {
            // No follow-ups defined, use initial template
            const resolvedBody = (campaignTemplate as any)?.initial?.body || (campaignTemplate as any)?.body || '';
            const resolvedSubject = (campaignTemplate as any)?.initial?.subject || (campaignTemplate as any)?.subject || `Question for ${lead.name}`;
            
            const integrationsList = await storage.getIntegrations(userId);
            const mailboxForTemplate = integrationsList.find((i: any) => i.id === (lead.metadata as any)?.integrationId)
              || integrationsList.find((i: any) => i.connected && ['custom_email', 'gmail', 'outlook'].includes(i.provider));
            const senderContextForTemplate = {
              name: (mailboxForTemplate as any)?.name || user?.name || user?.businessName || businessName,
              email: (mailboxForTemplate as any)?.email || user?.email || '',
            };
            
            emailContent = {
              subject: resolveTemplateVars(resolvedSubject, lead, senderContextForTemplate),
              body: resolveTemplateVars(resolvedBody, lead, senderContextForTemplate),
            };
            
            if (emailContent.body && emailContent.body.trim().length > 10) {
              campaignTemplate = 'USED';
            }
          }
        }
      }
    } catch (templateErr) {
      console.warn(`[AutoOutreach] Campaign template lookup failed, falling back to AI:`, templateErr);
    }

    // ── AI GENERATION (only if no campaign template was used) ──────────────
    if (campaignTemplate !== 'USED') {
      console.log(`[AutoOutreach] 🧠 Generating Priority ${lead.priority} Context-Aware response for ${lead.email}...`);
      
      const aiResult = await generateContextAwareMessage(
        lead as any,
        brandContext,
        [], // Testimonials
        threadMessages
      );

      // ── SANITIZE AI OUTPUT ──────────────────────────────────────────────
      // Strip JSON reasoning leaks, then resolve {{senderName}} / {{firstName}} etc.
      const rawSubject = (lead.metadata as any)?.outreach_subject || aiResult.subject || `Question for ${lead.name}`;
      const rawBody = aiResult.message || '';

      const cleanBody = sanitizeEmailBody(rawBody);
      const cleanSubject = sanitizeEmailSubject(rawSubject) || rawSubject;

      if (!cleanBody || cleanBody.trim().length < 10) {
        console.error(`[AutoOutreach] ❌ Email body empty after AI sanitization for ${lead.email}. Skipping send to avoid sending garbage.`);
        return;
      }

      const integrationsList = await storage.getIntegrations(userId);
      const mailbox = integrationsList.find((i: any) => i.id === (lead.metadata as any)?.integrationId)
        || integrationsList.find((i: any) => i.connected && ['custom_email', 'gmail', 'outlook'].includes(i.provider));
      const senderContext = {
        name: (mailbox as any)?.name || user?.name || user?.businessName || businessName,
        email: (mailbox as any)?.email || user?.email || '',
      };

      const resolvedBody = resolveTemplateVars(cleanBody, lead, senderContext);
      const resolvedSubject = resolveTemplateVars(cleanSubject, lead, senderContext);

      emailContent = {
        subject: resolvedSubject,
        body: resolvedBody,
      };
    }

    // Generate a tracking token (sendEmail will create the DB record after successful send)
    const trackingToken = `auto_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Build threading headers from last message for proper reply tracking
    let inReplyTo: string | undefined;
    let references: string | undefined;
    try {
      const { messages } = await import('@audnix/shared');
      const { eq, desc } = await import('drizzle-orm');
      const lastMessages = await db.select()
        .from(messages)
        .where(eq(messages.leadId, lead.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      if (lastMessages.length > 0) {
        const lastMsg = lastMessages[0];
        const meta = (lastMsg.metadata as any) || {};
        inReplyTo = lastMsg.externalId || meta.externalId;
        if (inReplyTo) {
          const prevRefs = meta.references || "";
          references = prevRefs ? `${prevRefs} ${inReplyTo}` : inReplyTo;
        }
      }
    } catch (threadErr) {
      console.warn(`[AutoOutreach] Failed to fetch threading headers:`, threadErr);
    }

    // Send the email (sendEmail will create tracking record after successful delivery)
    await sendEmail(
      userId,
      lead.email,
      emailContent.body,
      emailContent.subject,
      { 
        isHtml: true,
        trackingId: trackingToken,
        leadId: lead.id,
        inReplyTo,
        references,
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
      status: 'contacted',
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

    // Send real-time WebSocket updates via Redis pub/sub (cross-process safe)
    await clusterSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'outreach_sent' });
    await clusterSync.notifyMessagesUpdated(userId, { leadId: lead.id });
    await clusterSync.notifyActivityUpdated(userId, { type: 'outreach_sent', leadName: lead.name });
    await clusterSync.notifyStatsUpdated(userId, { source: 'outreach_worker' });
  }
}

// Export singleton instance
export const autonomousOutreachWorker = new AutonomousOutreachWorker();







