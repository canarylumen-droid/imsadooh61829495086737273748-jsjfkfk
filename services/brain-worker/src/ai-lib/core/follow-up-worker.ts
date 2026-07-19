import { db } from '@shared/lib/db/db.js';
import { followUpQueue, leads, messages, users, brandEmbeddings, integrations, contentLibrary } from '@audnix/shared';
import { eq, and, lte, asc, or, inArray, isNotNull } from 'drizzle-orm';
import { campaignLeads } from '@audnix/shared';
import { generateReply, generateEmailSubject } from './ai-service.js';
import { InstagramOAuth } from '@services/api-gateway/src/oauth/instagram.js';
import { sendInstagramMessage } from "@shared/lib/channels/instagram.js";

import { sendEmail } from "@shared/lib/channels/email.js";
import { executeCommentFollowUps } from '../analyzers/comment-detection.js';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { calendarBookings, notifications } from "@audnix/shared";
import { socketService } from "@shared/lib/realtime/socket-service.js";
import { availabilityService } from "@shared/lib/calendar/availability-service.js";
import { timezoneService } from "@shared/lib/calendar/timezone-service.js";
import { onScheduledTask } from '@services/event-bus/src/utils/eventScheduler.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import MultiChannelOrchestrator from '@shared/lib/multi-channel-orchestrator.js';
import DayAwareSequence from './day-aware-sequence.js';
import { getMessageScript, personalizeScript } from './message-scripts.js';
import { getBrandPersonalization, formatChannelMessage, getContextAwareSystemPrompt } from '../context/brand-personalization.js';
import { multiProviderEmailFailover } from '@services/email-service/src/email/multi-provider-failover.js';
import { decrypt, decryptToJSON } from '@shared/lib/crypto/encryption.js';
import { shouldAskForFollow } from "../follow-request-handler.js";
import { searchSimilarChunks, userHasChunks } from '../context/vector-rpc.js';
import { getLeadProfile } from '@shared/lib/calendar/lead-timezone-intelligence.js';
import type {
  BrandContext,
  ChannelType,
  LeadStatus,
  MessageDirection,
  ProviderType
} from '@shared/types.js';

interface FollowUpJob {
  id: string;
  userId: string;
  leadId: string;
  channel: string;
  context: Record<string, unknown>;
  retryCount: number;
}

interface LocalLead {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  channel: string;
  status: string;
  tags?: string[];
  preferred_name?: string;
  timezone?: string;
  metadata?: Record<string, unknown>;
  follow_up_count?: number;
  externalId?: string | null;
  lastMessageAt?: Date | null;
  warm?: boolean;
  createdAt?: Date;
  aiPaused?: boolean;
  sentiment?: string;
  updatedAt?: Date;
}

interface LocalMessage {
  body: string;
  direction: MessageDirection;
  createdAt: Date;
  role?: 'user' | 'assistant';
  created_at?: string;
}

export interface AIReplyResult {
  text: string;
  useVoice: boolean;
  blocked?: boolean;
  blockedReason?: string;
  detections?: any;
}

interface DatabaseMessage {
  body: string;
  direction: string;
  createdAt: Date;
}

interface BrandSnippetData {
  snippet: string;
  metadata?: Record<string, unknown>;
}

interface UserBrandData {
  company: string | null;
  replyTone: string | null;
  metadata: Record<string, unknown>;
}

interface FollowUpSchedule {
  channel: ChannelType;
  sequenceNumber: number;
  scheduledFor: Date;
}

type Lead = LocalLead;
type Message = LocalMessage;

export class FollowUpWorker {
  private isRunning: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private instagramOAuth: InstagramOAuth;

  constructor() {
    this.instagramOAuth = new InstagramOAuth();
    this.isRunning = false;
    this.processingInterval = null;
  }

  /**
   * Start the worker to process follow-up queue
   */
  start(): void {
    if (this.isRunning) {
      console.log('Follow-up worker is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting follow-up worker...');

    // Process queue every 1-2 minutes for high-volume throughput
    const delay = Math.floor(Math.random() * (2 - 1 + 1) + 1) * 60 * 1000;
    this.processingInterval = setInterval(async () => {
      try {
        await this.processQueue();
      } catch (error: any) {
        console.error('Follow-up worker error:', error);
        workerHealthMonitor.recordError('follow-up', error?.message || 'Unknown error');
      }
    }, delay);
    // Process immediately on start
    this.processQueue();
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.isRunning = false;
    console.log('Follow-up worker stopped');
  }

  /**
   * Process pending jobs in the queue
   */
  public async processQueue(): Promise<void> {
    if (process.env.GLOBAL_AI_PAUSE === 'true') {
      console.warn('[FollowUpWorker] 🛑 GLOBAL AI PAUSE ACTIVE. skipping queue.');
      return;
    }

    if (quotaService.isRestricted()) {
      console.log('[FollowUpWorker] Skipping queue: Database quota restricted');
      return;
    }

    try {
      if (!db) {
        return;
      }

      // Execute comment automation follow-ups first
      await executeCommentFollowUps();

      // Get pending jobs from Neon database
      // 11. Intelligence-Governed Proactive Automation Scanner
      try {
        const { AutomationRuleEngine } = await import("@shared/lib/automation/rule-engine.js");
        const { automationRules } = await import('@audnix/shared');
        const { or } = await import('drizzle-orm');
        
        const activeRules = await db
          .select({ userId: automationRules.userId })
          .from(automationRules)
          .where(
            and(
              eq(automationRules.isActive, true),
              or(
                eq(automationRules.ruleType, 're_engagement'),
                eq(automationRules.ruleType, 'follow_up')
              )
            )
          );
          
        const uniqueUsers = Array.from(new Set<string>(activeRules.map((r: any) => String(r.userId))));
        for (const userId of uniqueUsers) {
          await AutomationRuleEngine.processProactiveRules(userId);
          try {
            const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
            await clusterSync.notifyCalendarUpdated(userId);
          } catch (_) {}
        }
      } catch (autoErr) {
        console.error('[FollowUpWorker] Automation scan failed:', autoErr);
      }

      const jobs = await db
        .select()
        .from(followUpQueue)
        .where(
          and(
            eq(followUpQueue.status, 'pending'),
            lte(followUpQueue.scheduledAt, new Date())
          )
        )
        .orderBy(asc(followUpQueue.scheduledAt))
        .limit(100);

      if (!jobs || jobs.length === 0) {
        return;
      }


      console.log(`Processing ${jobs.length} follow-up jobs...`);

      // Scaling: Use controlled concurrency to avoid saturating OpenAI / Database
      const CONCURRENCY_LIMIT = 5;
      const results = [];

      for (let i = 0; i < jobs.length; i += CONCURRENCY_LIMIT) {
        const batch = jobs.slice(i, i + CONCURRENCY_LIMIT);
        const batchStartTime = Date.now();

        console.log(`🚀 Executing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} (${batch.length} jobs)`);

        const batchResults = await Promise.all(batch.map(async (job: typeof jobs[0]) => {
          const ctx = job.context as Record<string, unknown>;
          const typedJob: FollowUpJob = {
            id: job.id,
            userId: job.userId,
            leadId: job.leadId,
            channel: job.channel,
            context: ctx,
            retryCount: typeof ctx?.retryCount === 'number' ? ctx.retryCount : 0
          };
          return this.processJob(typedJob);
        }));

        results.push(...batchResults);
        console.log(`✅ Batch complete in ${Date.now() - batchStartTime}ms`);
      }
      const health = workerHealthMonitor.getHealthStatus();
      workerHealthMonitor.recordSuccess('follow-up-worker');
    } catch (error: any) {
      console.error('Queue processing error:', error);
      quotaService.reportDbError(error);
      workerHealthMonitor.recordError('follow-up-worker', error?.message || 'Unknown error');
    }
  }

  /**
   * Process a single follow-up job
   */
  private async processJob(job: FollowUpJob): Promise<void> {
    try {
      if (!db) {
        throw new Error('Database not configured');
      }

      // Mark job as processing
      await db
        .update(followUpQueue)
        .set({ status: 'processing' })
        .where(eq(followUpQueue.id, job.id));

      const user = await storage.getUserById(job.userId);
      // BUG A5 FIX: Night Watch now respects LEAD timezone, not just user timezone
      if (user && user.id) {
        const { availabilityService } = await import('@shared/lib/calendar/availability-service.js');
        const profile = await getLeadProfile(job.leadId);
        const leadTz = profile?.detectedTimezone || user.timezone || 'America/New_York';
        const isNight = await availabilityService.isCurrentlyNight(leadTz);
        if (isNight) {
          console.log(`[Follow-Up Worker] 🌙 Night detected for lead ${job.leadId} (${leadTz}). Delaying job until morning.`);
          const nextMorning = await availabilityService.getNextAvailableBusinessHour(leadTz);
          await db.update(followUpQueue).set({ status: 'pending', scheduledAt: nextMorning }).where(eq(followUpQueue.id, job.id));
          return;
        }
      }

      // Attempt to reserve the lead to prevent race conditions (Phase 13: Mutex Lock)
      const reserved = await storage.reserveLeadForAction(job.leadId, 'follow_up');
      if (!reserved) {
        console.log(`[FollowUpWorker] Lead ${job.leadId} is currently locked by another process. Skipping.`);
        // Mark job as pending again and delay it by 5 minutes to avoid a tight retry loop
        await db.update(followUpQueue)
          .set({ 
            status: 'pending',
            scheduledAt: new Date(Date.now() + 5 * 60 * 1000)
          })
          .where(eq(followUpQueue.id, job.id));
        return;
      }

      // Get lead details
      const leadResults = await db
        .select()
        .from(leads)
        .where(eq(leads.id, job.leadId))
        .limit(1);

      const dbLead = leadResults[0];
      if (!dbLead) {
        throw new Error('Lead not found');
      }

      // Convert database lead to local type
      const lead: Lead = {
        id: dbLead.id,
        name: dbLead.name,
        email: dbLead.email,
        phone: dbLead.phone,
        channel: dbLead.channel,
        status: dbLead.status,
        tags: dbLead.tags as string[],
        metadata: dbLead.metadata as Record<string, unknown>,
        externalId: dbLead.externalId,
        lastMessageAt: dbLead.lastMessageAt,
        warm: dbLead.warm,
        createdAt: dbLead.createdAt,
        aiPaused: dbLead.aiPaused,
        updatedAt: dbLead.updatedAt
      };

      // CHECK 1: Global Autonomous Mode
      // BUG A1/A2 FIX: We do NOT return early here if AI is OFF. 
      // We allow the job to proceed so it can generate the AI reply and save it as a DRAFT.
      const userResults = await db.select().from(users).where(eq(users.id, job.userId)).limit(1);
      const userDetail = userResults[0];
      const globalAutonomousMode = (userDetail?.config as any)?.autonomousMode !== false;

      // CHECK 2: Lead-level opt-out
      if (lead.aiPaused || 
          ['unsubscribed', 'bounced', 'qualified', 'converted', 'booked', 'warm'].includes(lead.status)) {
        console.log(`⏸️  Skipping follow-up for lead ${lead.name} (Status: ${lead.status}${lead.aiPaused ? ', AI paused' : ''})`);
        await db.update(followUpQueue).set({ status: 'completed', processedAt: new Date() }).where(eq(followUpQueue.id, job.id));
        return;
      }

      // CHECK 2.5: Integration-level Health & AI Mode
      const matchingIntegrations = await db.select()
        .from(integrations)
        .where(and(eq(integrations.userId, job.userId), eq(integrations.provider, job.channel as any)))
        .limit(1);
      
      const integration = matchingIntegrations[0];
      
      if (integration) {
        if (integration.aiAutonomousMode === false) {
           console.log(`[FOLLOW_UP] Integration Autonomous Mode is OFF for ${job.channel}. Reverting job to pending.`);
           // Advance scheduledAt by 1 hour to avoid infinite DB retry loop
           await db.update(followUpQueue)
             .set({ 
               status: 'pending',
               scheduledAt: new Date(Date.now() + 60 * 60 * 1000)
             })
             .where(eq(followUpQueue.id, job.id));
           return;
        }

        // 24/7 Autonomous Mode: We no longer pause follow-ups due to infrastructure cooldowns
      }

      // 3. Active Campaign Protection
      const activeCampaignLead = await db.select()
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.leadId, job.leadId),
            or(
              eq(campaignLeads.status, 'pending'),
              and(eq(campaignLeads.status, 'sent'), isNotNull(campaignLeads.nextActionAt))
            )
          )
        )
        .limit(1);

      if (activeCampaignLead.length > 0) {
        console.log(`[FOLLOW_UP] skipping autonomous follow-up - lead ${lead.name} is in an active campaign stage: ${activeCampaignLead[0].status}`);
        await db.update(followUpQueue).set({ status: 'completed', processedAt: new Date() }).where(eq(followUpQueue.id, job.id));
        return;
      }

      // 4. Gather Context
      const conversationHistory = await storage.getMessagesByLeadId(job.leadId);
      const brandContext = await this.getBrandContext(job.userId);

      // [NEW] Inject Calendar Context for AI Booking Specialist
      const calendarLink = userDetail?.calendarLink || (userDetail as any)?.defaultCtaLink || '';
      const isCalendlyConnected = !!(userDetail as any)?.calendlyAccessToken;
      const bookingContext = {
        calendarLink,
        isCalendlyConnected,
        calendlyUserUri: (userDetail as any)?.calendlyUserUri
      };

      // 5. Generate AI Content
      const campaignDay = Math.floor(
        (Date.now() - (lead.createdAt?.getTime() || Date.now())) / (1000 * 60 * 60 * 24)
      );

      const suggestedBody = (job.context as any)?.suggestedBody;
      const customAutoReply = (job.context as any)?.customAutoReply;
      const isAutoReply = (job.context as any)?.isAutoReply === true;
      const intent = (job.context as any)?.intent || 'nurture';
      const reasoning = (job.context as any)?.reasoning || '';
      let aiReply = '';
      let suggestedSubject = (job.context as any)?.suggestedSubject;

      if (suggestedBody) {
        aiReply = suggestedBody;
      } else if (customAutoReply) {
        // Basic template substitution
        const rawLeadName = lead.name?.trim();
        const cleanName = rawLeadName === 'Unknown' ? undefined : rawLeadName;
        const firstName = cleanName?.split(' ')[0] || 'there';
        const lastName = cleanName?.split(' ').slice(1).join(' ') || 'there';
        const fullName = cleanName || firstName;
        const company = (lead as any).company?.trim() || (lead.metadata as any)?.company || 'your company';
        const meta = (lead as any).metadata || {};
        const city = meta.city || '';
        const industry = meta.industry || '';
        const niche = meta.niche || '';
        const website = meta.website || '';
        aiReply = customAutoReply
          .replace(/{{firstName}}/g, firstName)
          .replace(/{{lastName}}/g, lastName)
          .replace(/{{name}}/g, fullName)
          .replace(/{{lead_name}}/g, fullName)
          .replace(/{{company}}/g, company)
          .replace(/{{business_name}}/g, company)
          .replace(/{{city}}/g, city)
          .replace(/{{industry}}/g, industry)
          .replace(/{{niche}}/g, niche)
          .replace(/{{website}}/g, website);
      } else if (isAutoReply || intent === 'payment' || intent === 'booking') {
        const { generateAIReply } = await import('./conversation-ai.js');
        let intentInstruction = "";
        
        if (intent === 'payment') {
          // Payments are admin-only — redirect to booking instead
          try {
            const { availabilityService } = await import('@shared/lib/calendar/availability-service.js');
            const slots = await availabilityService.getSuggestedTimes(job.userId, 72);
            const slotsText = availabilityService.formatSlotsForAI(slots);
            intentInstruction = `\n\nCRITICAL TASK: This lead wants to move forward or discussed payment. You MUST redirect them to book a call to finalize details. Provide the calendar link and suggest available times: [${slotsText}].`;
          } catch (e) {
            intentInstruction = `\n\nCRITICAL TASK: This lead wants to move forward or discussed payment. You MUST provide the calendar link and encourage them to book a call to finalize.`;
          }
        } else if (intent === 'booking') {
          try {
            const { availabilityService } = await import('@shared/lib/calendar/availability-service.js');
            const slots = await availabilityService.getSuggestedTimes(job.userId, 72);
            const slotsText = availabilityService.formatSlotsForAI(slots);
            intentInstruction = `\n\nCRITICAL TASK: This lead is ready to book a call or demo. You MUST provide the calendar link and optionally suggest these available times: [${slotsText}]. Encourage them to pick a slot. Use the context: "${reasoning}".`;
          } catch (e) {
            intentInstruction = `\n\nCRITICAL TASK: This lead is ready to book a call or demo. You MUST provide the calendar link and encourage them to pick a slot. Use the context: "${reasoning}".`;
          }
        }

        const aiResult = await generateAIReply(
          lead as any,
          conversationHistory as any,
          job.channel as 'email' | 'instagram',
          {
            ...bookingContext,
            brandVoice: intentInstruction
          }
        );

        if (aiResult.blocked) {
          console.warn(`[FOLLOW_UP] AI blocked response for lead ${lead.id}. Reason: ${aiResult.blockedReason}`);
          
          if (aiResult.blockedReason === 'duplicate' || aiResult.blockedReason === 'ooo') {
            const delayDays = aiResult.blockedReason === 'ooo' ? 7 : 5;
            const nextScheduledAt = new Date();
            nextScheduledAt.setDate(nextScheduledAt.getDate() + delayDays);
            
            await db.update(followUpQueue)
              .set({ 
                status: 'pending', 
                scheduledAt: nextScheduledAt,
                context: { ...(job.context as any || {}), blocked_retry: true, reason: aiResult.blockedReason }
              })
              .where(eq(followUpQueue.id, job.id));
            
            console.log(`[FOLLOW_UP] 📅 Rescheduled job ${job.id} for ${delayDays} days later due to ${aiResult.blockedReason}.`);
            return;
          }

          // Other blocks (like 'booked') complete the job
          await db.update(followUpQueue).set({ status: 'completed', processedAt: new Date() }).where(eq(followUpQueue.id, job.id));
          return;
        }

        aiReply = aiResult.text || '';
      } else {
        // Generate AI reply with day-aware context and brand personalization
        const followUpResult = await this.generateFollowUpMessage(lead, conversationHistory, brandContext, campaignDay, lead.createdAt || new Date(), job.userId, bookingContext);
        
        if (followUpResult.action === 'pause') {
          console.log(`[FOLLOW_UP_WORKER] ⏸️ AI decided to pause outreach for lead ${lead.id}. Reason: ${followUpResult.reasoning}`);
          
          await db.update(leads).set({ aiPaused: true }).where(eq(leads.id, job.leadId));
          await db.update(followUpQueue).set({ status: 'completed', processedAt: new Date() }).where(eq(followUpQueue.id, job.id));

          try {
            const { aiActionLogs } = await import('@audnix/shared');
            await db.insert(aiActionLogs).values({
              userId: job.userId,
              leadId: job.leadId,
              actionType: 'follow_up',
              decision: 'skip',
              reasoning: followUpResult.reasoning,
              outcome: 'AI Paused outreach'
            });
          } catch (e) {
            console.error('[FOLLOW_UP_WORKER] Failed to log AI action:', e);
          }
          return;
        }

        if (followUpResult.action === 'schedule' && followUpResult.delayDays > 0) {
          console.log(`[FOLLOW_UP_WORKER] 📅 AI decided to delay follow up for lead ${lead.id} by ${followUpResult.delayDays} days. Reason: ${followUpResult.reasoning}`);
          
          const nextScheduledAt = new Date();
          nextScheduledAt.setDate(nextScheduledAt.getDate() + followUpResult.delayDays);
          
          await db.update(followUpQueue)
            .set({ 
              status: 'pending', 
              scheduledAt: nextScheduledAt,
              context: { ...(job.context as any || {}), reason: followUpResult.reasoning, suggestedBody: followUpResult.text, suggestedSubject: followUpResult.subject }
            })
            .where(eq(followUpQueue.id, job.id));

          try {
            const { aiActionLogs } = await import('@audnix/shared');
            await db.insert(aiActionLogs).values({
              userId: job.userId,
              leadId: job.leadId,
              actionType: 'follow_up',
              decision: 'wait',
              reasoning: followUpResult.reasoning,
              outcome: `Rescheduled for ${followUpResult.delayDays} days later`,
              metadata: { delayDays: followUpResult.delayDays }
            });
          } catch (e) {
            console.error('[FOLLOW_UP_WORKER] Failed to log AI action:', e);
          }
          return;
        }

        aiReply = followUpResult.text;
        suggestedSubject = followUpResult.subject || suggestedSubject;
      }

      // DEEP TRACKING: Generate unique ID for engagement detection
      const { TrackingEngine } = await import('@services/email-service/src/email/tracking-engine.js');
      const trackingId = TrackingEngine.generateTrackingId();

      // Prepend disclaimer for legal compliance (UI use only)
      let disclaimerPrefix = '';
      try {
        const { prependDisclaimerToMessage } = await import("../formatters/disclaimer-generator.js");
        const disclaimerResult = prependDisclaimerToMessage(
          aiReply,
          job.channel as 'email' | 'voice',
          brandContext?.businessName || 'Audnix'
        );
        disclaimerPrefix = disclaimerResult.disclaimerPrefix;
      } catch (disclaimerError) {
        console.warn('Failed to add disclaimer context:', disclaimerError);
      }

      console.log(`[FOLLOW_UP_WORKER] Final reply for ${lead.email} via ${job.channel}. Length: ${aiReply.length}. Source: ${customAutoReply ? 'Custom Template' : 'AI'}`);

      // Send the message
      const sendOptions: any = {
        leadId: lead.id,
        trackingId: trackingId,
        isMeetingInvite: intent === 'booking'
      };

      if (intent === 'payment') {
        // Admin handles payments — redirect to booking call
        sendOptions.buttonText = 'Book a Call';
        sendOptions.buttonUrl = calendarLink;
      } else if (intent === 'booking') {
        sendOptions.buttonText = 'Book a Time';
        sendOptions.buttonUrl = calendarLink;
      }

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
        console.log(`[FOLLOW_UP_WORKER] 🚫 Suppressed follow-up to bounce/daemon address: ${lead.email}. Pausing AI.`);
        await storage.updateLead(lead.id, {
          aiPaused: true,
          metadata: {
            ...((lead.metadata as any) || {}),
            suppressed: true,
            suppressedAt: new Date().toISOString(),
            suppressionReason: 'mailer_daemon_bounce_address',
          }
        });
        await db.update(followUpQueue).set({ status: 'completed', processedAt: new Date() }).where(eq(followUpQueue.id, job.id));
        return;
      }

      // --- PHASE 33: DRAFT VS SEND VERIFICATION LAYER ---
      const isAutonomous = globalAutonomousMode;
      let sent = false;

      if (isAutonomous) {
        sent = await this.sendMessage(job.userId, lead, aiReply, job.channel, {
          ...sendOptions,
          subject: suggestedSubject || undefined
        });
        console.log(`[FOLLOW_UP_WORKER] Message sent result: ${sent}`);
      } else {
        console.log(`[FOLLOW_UP_WORKER] User is NOT in autonomous mode. Message saved as DRAFT.`);
        sent = true; // We pretend it sent so it saves in the DB as a message
      }
      
      // Log the SEND action
      try {
        const { aiActionLogs } = await import('@audnix/shared');
        await db.insert(aiActionLogs).values({
          userId: job.userId,
          leadId: job.leadId,
          actionType: 'follow_up',
          decision: 'act',
          reasoning: 'Autonomous outreach dispatch triggered',
          outcome: isAutonomous ? 'Message sent' : 'Saved as draft'
        });
      } catch (e) {
        console.error('[FOLLOW_UP_WORKER] Failed to log AI action:', e);
      }

      if (sent) {
        // Save message to database with tracking ID
        const savedMessage = await this.saveMessage(job.userId, job.leadId, aiReply, 'assistant', {
          aiGenerated: true,
          disclaimer: disclaimerPrefix,
          channel: job.channel,
          trackingId: trackingId,
          intent: intent
        });




        // UPDATE: Log to audit trail
        try {
          const { AuditTrailService } = await import('@shared/lib/monitoring/audit-trail-service.js');
          await AuditTrailService.logAiMessageSent(
            job.userId,
            job.leadId,
            savedMessage?.id || '',
            job.channel,
            aiReply,
            ((lead.metadata as Record<string, unknown>)?.follow_up_count as number || 0) + 1
          );
        } catch (auditError) {
          console.error('Failed to log audit trail:', auditError);
        }

        // Update lead status and follow-up count
        await db
          .update(leads)
          .set({
            status: 'replied',
            metadata: {
              ...(lead.metadata || {}),
              follow_up_count: ((lead.metadata as Record<string, unknown>)?.follow_up_count as number || 0) + 1
            },
            lastMessageAt: new Date() // Update last message time
          })
          .where(eq(leads.id, job.leadId));

        // Mark job as completed
        await db
          .update(followUpQueue)
          .set({
            status: 'completed',
            processedAt: new Date()
          })
          .where(eq(followUpQueue.id, job.id));

        console.log(`Follow-up sent successfully for lead ${lead.name}`);

        // Schedule next follow-up if needed
        await this.scheduleNextFollowUp(job.userId, job.leadId, lead);
      } else {
        throw new Error('Failed to send message');
      }
    } catch (error) {

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error processing job ${job.id}:`, error);

      // Update job with error
      if (db) {
        // If email is not connected, mark as failed immediately to prevent infinite retry loops
        const shouldFailImmediately = errorMessage.includes('Email not connected') || errorMessage.includes('credentials missing');
        
        await db
          .update(followUpQueue)
          .set({
            status: (job.retryCount >= 3 || shouldFailImmediately) ? 'failed' : 'pending',
            errorMessage: errorMessage,
            scheduledAt: shouldFailImmediately ? null : new Date(Date.now() + 5 * 60 * 1000)
          })
          .where(eq(followUpQueue.id, job.id));
          
        if (shouldFailImmediately) {
          console.warn(`🛑 [FOLLOW_UP] Marking job ${job.id} as FAILED because email is not connected for user ${job.userId}.`);
        }
      }
    }
  }

  /**
   * Generate AI follow-up message with day-aware context and brand personalization
   */
  async generateFollowUpMessage(
    lead: Lead,
    history: Message[],
    brandContext: BrandContext,
    campaignDay: number = 0,
    campaignDayCreated: Date = new Date(),
    userId?: string,
    bookingContext?: { calendarLink: string; isCalendlyConnected: boolean }
  ): Promise<{ text: string; action: string; delayDays: number; reasoning: string; subject: string }> {
    // Get message script for this stage
    const script = getMessageScript(lead.channel as 'email' | 'instagram', campaignDay);

    // Get brand personalization
    let personalizationContext = null;
    if (userId) {
      personalizationContext = await getBrandPersonalization(userId);
    }

    // Fetch relevant content library items for this lead/channel
    let contentLibraryItems: Array<{ name: string; content: string; contentType: string }> = [];
    if (userId && db) {
      try {
        const contentItems = await db
          .select({
            name: contentLibrary.name,
            content: contentLibrary.content,
            contentType: contentLibrary.type,
            channelRestriction: contentLibrary.channelRestriction,
            intentTags: contentLibrary.intentTags,
          })
          .from(contentLibrary)
          .where(eq(contentLibrary.userId, userId));

        // Filter to relevant items: match channel or "all", prefer reply_template type
        contentLibraryItems = contentItems
          .filter((item: any) => {
            const matchesChannel = !item.channelRestriction ||
              item.channelRestriction === 'all' ||
              item.channelRestriction === lead.channel;
            return matchesChannel && item.contentType === 'reply_template';
          })
          .slice(0, 5) // Limit to avoid overwhelming
          .map((item: any) => ({
            name: item.name,
            content: item.content,
            contentType: item.contentType,
          }));
      } catch (contentError) {
        console.warn('Content library fetch failed (non-critical):', contentError);
      }
    }

    // Use day-aware sequence for context-aware prompt
    const metadata = lead.metadata as Record<string, any>;
    const dayAwareContext = {
      campaignDay,
      previousMessages: history.map((msg: Message) => ({
        sentAt: msg.createdAt,
        body: msg.body,
      })),
      leadEngagement: this.assessLeadTemperature(lead, history),
      leadName: metadata?.preferred_name || lead.name.split(' ')[0],
      brandName: brandContext.businessName || 'Your Business',
      userSenderName: personalizationContext?.senderName || brandContext.senderName,
    };

    // Build system prompt with brand context
    let systemPrompt = DayAwareSequence.buildSystemPrompt(dayAwareContext);
    if (personalizationContext) {
      systemPrompt = getContextAwareSystemPrompt(personalizationContext, lead.channel);
    }

    const userPrompt = this.buildFollowUpPrompt(lead, history, brandContext, script ?? undefined, contentLibraryItems, bookingContext);

    const result = await generateReply(systemPrompt, userPrompt, {
      temperature: 0.7,
      maxTokens: 400,
      jsonMode: true
    });

    let action = 'send';
    let delayDays = 0;
    let reasoning = 'Generated reply';
    let finalMessage = '';
    let subject = '';

    try {
      const parsed = JSON.parse(result.text || "{}");
      action = parsed.action || 'send';
      delayDays = parsed.delayDays || 0;
      reasoning = parsed.reasoning || reasoning;
      finalMessage = parsed.body || result.text;
      subject = parsed.subject || '';
    } catch (e) {
      finalMessage = result.text || '';
    }

    // Sanitize AI output — strip JSON reasoning, leaked placeholders
    const { sanitizeEmailBody } = await import('../analyzers/ai-sanitizer.js');
    finalMessage = sanitizeEmailBody(finalMessage);

    // Format with brand personalization
    if (personalizationContext) {
      finalMessage = await formatChannelMessage(finalMessage, lead.channel as 'email' | 'instagram', userId || '', lead.channel === 'email');
    }

    return { text: finalMessage, action, delayDays, reasoning, subject };
  }

  /**
   * Build follow-up prompt with context and message script
   */
  private buildFollowUpPrompt(
    lead: Lead, 
    history: Message[], 
    brandContext: BrandContext, 
    script?: { tone?: string; structure?: string }, 
    contentLibraryItems?: Array<{ name: string; content: string; contentType: string }>,
    bookingContext?: { calendarLink: string; isCalendlyConnected: boolean }
  ): string {
    const metadata = lead.metadata as Record<string, any>;
    const firstName = metadata?.preferred_name || lead.name.split(' ')[0];
    const channelContext = this.getChannelContext(lead.channel);

    // Include message script guidelines if available
    let scriptGuidance = '';
    if (script) {
      scriptGuidance = `
SCRIPT GUIDANCE (use as reference, not required):
- Tone: ${script.tone || 'professional'}
- Structure: ${script.structure || 'conversational'}`;
    }

    // --- PHASE 29: INTENT SIGNAL PROCESSING ---
    const engagementScore = ((lead.metadata as any)?.behavior_pattern?.engagementScore as number) || 0;
    const lastAnalysis = (lead.metadata as any)?.lastAnalysis;
    
    let intelligenceGuidance = '';
    if (lastAnalysis) {
      if (lastAnalysis.competitorMentioned) {
        intelligenceGuidance += `\n- COMPETITOR ALERT: The lead mentioned ${lastAnalysis.competitorName || 'a competitor'}. You MUST acknowledge this and highlight why ${brandContext.businessName} is better (e.g. better AI, voice cloning, multi-channel).`;
      }
      if (lastAnalysis.hasObjection) {
        if (lastAnalysis.objectionCategory === 'price') {
           intelligenceGuidance += `\n- PRICE OBJECTION DETECTED: The lead is concerned about cost. You have approval to offer a discount if needed. Suggested: "${lastAnalysis.priceNegotiationResponse || 'Offer a small introductory discount'}".`;
        } else {
           intelligenceGuidance += `\n- OBJECTION DETECTED: ${lastAnalysis.objectionCategory || 'General'}. Address this concern head-on with value.`;
        }
      }
    }

    const intentGuidance = `
LEAD INTENT & SIGNALS:
- Current Sentiment: ${lead.sentiment || 'neutral'}
- Engagement Score: ${engagementScore}${intelligenceGuidance}
(Adjust your follow-up tone: softer for negative/cold, direct/call-to-action for positive/hot).`;

    // Build conversation history string
    const historyStr = history
      .slice(-5) // Last 5 messages
      .map((msg: Message) => `${msg.direction === 'inbound' ? 'Lead' : 'You'}: ${msg.body}`)
      .join('\n');

    // Determine follow-up number
    const followUpNumber = ((lead.metadata as Record<string, unknown>)?.follow_up_count as number || 0) + 1;

    // Determine email subject for email channel
    let emailSubject = '';
    if (lead.channel === 'email') {
      emailSubject = `Regarding Your Inquiry with ${brandContext.businessName}`;
      // Basic subject line generation based on content (can be improved)
      if (historyStr.length > 0) {
        const firstLine = historyStr.split('\n')[0];
        if (firstLine.length < 50) {
          emailSubject = firstLine;
        } else {
          emailSubject = firstLine.substring(0, 50) + '...';
        }
      }
    }

    // CHECK: Should we ask for a follow?
    // We pass this as a constraint to the AI prompt
    let growthHackInstruction = "";
    // Note: shouldAskForFollow is async, but we can't easily wait here without refactoring buildFollowUpPrompt to async.
    // Instead, we'll assume the caller passes this info or we just add a generic instruction for Instagram
    if (lead.channel === 'instagram') {
      growthHackInstruction = "11. If the user seems happy or engaged, ask them to follow our page for more updates.\n";
    }

    // CONTENT LIBRARY SECTION: Include relevant templates for AI reference
    let contentLibrarySection = '';
    if (contentLibraryItems && contentLibraryItems.length > 0) {
      const templatesStr = contentLibraryItems
        .slice(0, 3) // Limit to 3 to avoid context overload
        .map((item, i) => `${i + 1}. [${item.contentType}] "${item.name}": ${item.content.substring(0, 200)}${item.content.length > 200 ? '...' : ''}`)
        .join('\n');
      contentLibrarySection = `
SAVED CONTENT TEMPLATES (use these as inspiration or adapt them):
${templatesStr}
`;
    }

    // BRAND PAIN HOOKS: Inject extracted value propositions and pain points
    let painHooksSection = '';
    if (brandContext.brandSnippets && brandContext.brandSnippets.length > 0) {
      painHooksSection = `
VALUE PROPS & PAIN HOOKS:
${brandContext.brandSnippets.map(s => `- ${s}`).join('\n')}
`;
    }

    return `You are an AI assistant helping with lead follow-ups for ${brandContext.businessName || 'a business'}.

BRAND INFORMATION:
- Business Name: ${brandContext.businessName || 'Your Business'}
- Brand Colors: ${brandContext.brandColors || '#000000'} (Use these for email styling)
- Brand Voice: ${brandContext.voiceRules || '- Be friendly and professional\n- Keep messages concise\n- Focus on value'}
${painHooksSection}
${contentLibrarySection}
LEAD INFORMATION:
- Name: ${firstName}
- Channel: ${lead.channel}
- Status: ${lead.status}
- Follow-up #: ${followUpNumber}
- Tags: ${lead.tags?.join(', ') || 'none'}

CONVERSATION HISTORY:
${historyStr || 'This is the first message'}

${bookingContext?.calendarLink ? `BOOKING PROTOCOL (AI Specialist Mode):
- IF the lead expresses interest, asks for a call/meeting/demo, or asks for more info: ACTIVELY PROVIDE this link: ${bookingContext.calendarLink}
- Connection Type: ${bookingContext.isCalendlyConnected ? 'Calendly (Real-time Sync)' : 'Static Link'}
- Strategy: Use a soft approach first ("Would you be open to a quick chat? I can send over my booking link"), but if they say yes, send the link immediately.
- Priority: If they ask for a time, give the Link instead of trying to manually coordinate.` : ''}

${channelContext}${scriptGuidance}
${intentGuidance}

RULES:
1. ALWAYS address the lead by their first name (${firstName})
2. For email, generate a subject line using brand info and conversation context. Example: "Subject: ${emailSubject}"
3. Keep message under 200 for Instagram. Emails can be longer but concise.
4. Be conversational and human-like.
5. If this is follow-up #1, introduce yourself briefly.
6. If this is follow-up #3+, consider being more direct or offering something specific.
7. Never mention you're an AI.
8. End with a soft call-to-action or question.
9. Match the tone to the channel (Instagram: casual, Email: professional). NO emojis for any channel.
${growthHackInstruction}
Generate a strategic decision and response.
You can choose to:
1. send: Send the message now.
2. schedule: Delay sending by a specific number of days.
3. pause: Stop outreach for this lead.

Return ONLY a valid JSON object matching this structure:
{
  "action": "send" | "schedule" | "pause",
  "delayDays": number (only if action is schedule, e.g. 14),
  "reasoning": "Why you chose this action based on lead behavior",
  "subject": "Email subject (if channel is email)",
  "body": "The actual message content to send or draft"
}`;
  }

  /**
   * Get channel-specific context
   */
  private getChannelContext(channel: string): string {
    switch (channel) {
      case 'instagram':
        return 'CHANNEL: Instagram DM - Be casual, keep it brief. DO NOT use emojis.';

      case 'email':
        return 'CHANNEL: Email - More formal, can be slightly longer, include subject line and professional branding';
      default:
        return '';
    }
  }

  /**
   * Get conversation history for a lead
   */
  private async getConversationHistory(leadId: string): Promise<Message[]> {
    if (!db) return [];

    const messageHistory = await db
      .select({
        body: messages.body,
        direction: messages.direction,
        createdAt: messages.createdAt,
        externalId: messages.externalId,
        subject: messages.subject,
        metadata: messages.metadata
      })
      .from(messages)
      .where(eq(messages.leadId, leadId))
      .orderBy(asc(messages.createdAt))
      .limit(20); // Fetch more for better context and threading references

    return messageHistory.map((msg: any): any => ({
      body: msg.body,
      direction: msg.direction as MessageDirection,
      createdAt: msg.createdAt,
      role: msg.direction === 'inbound' ? 'user' : 'assistant',
      created_at: msg.createdAt.toISOString(),
      metadata: {
        ...(msg.metadata || {}),
        subject: msg.subject || msg.metadata?.subject,
        externalId: msg.externalId || msg.metadata?.externalId
      }
    }));
  }

  /**
   * Get brand context for a user — now enriched with semantic PDF chunks
   */
  private async getBrandContext(userId: string): Promise<BrandContext> {
    if (!db) {
      return {
        businessName: 'Your Business',
        voiceRules: 'Be friendly and professional',
        brandColors: '#007bff',
        brandSnippets: []
      };
    }

    // Get brand embeddings for brand knowledge
    const brandData = await db
      .select({ snippet: brandEmbeddings.snippet, metadata: brandEmbeddings.metadata })
      .from(brandEmbeddings)
      .where(eq(brandEmbeddings.userId, userId))
      .limit(5);

    // Get user settings
    const userResults = await db
      .select({
        company: users.company,
        replyTone: users.replyTone,
        metadata: users.metadata
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const user = userResults[0] as UserBrandData | undefined;

    // Extract brand colors from user metadata, or use default
    const userMetadata = user?.metadata as Record<string, unknown> | null;
    const brandColors = (userMetadata?.brandColors as string) || '#007bff';

    // Phase 2: Pull semantic chunks from vector store (from user's Brand PDF)
    let vectorSnippets: string[] = [];
    try {
      if (await userHasChunks(userId)) {
        const chunks = await searchSimilarChunks('brand offer objection tone pricing', userId, 4);
        vectorSnippets = chunks
          .filter(c => c.similarity > 0.4)
          .map(c => c.content.substring(0, 400));
        if (vectorSnippets.length > 0) {
          console.log(`[FollowUpWorker] 🧠 Injecting ${vectorSnippets.length} brand knowledge chunks for user ${userId}`);
        }
      } else {
        console.log(`[FollowUpWorker] 💡 No Brand PDF found for user ${userId}. Tip: Upload a Brand PDF to improve AI reply quality.`);
      }
    } catch (vecError) {
      console.warn('[FollowUpWorker] Vector search failed (non-critical):', (vecError as Error).message);
    }

    const existingSnippets = brandData?.map((d: any) => d.snippet) || [];

    return {
      businessName: user?.company || 'Your Business',
      voiceRules: user?.replyTone ? `Be ${user.replyTone}` : 'Be professional',
      brandColors: brandColors,
      brandSnippets: [...existingSnippets, ...vectorSnippets]
    };
  }

  /**
   * Send message through appropriate channel
   */
  private async sendMessage(
    userId: string,
    lead: Lead,
    content: string,
    preferredChannel: string,
    options: any = {}
  ): Promise<boolean> {
    const channels = this.getChannelPriority(preferredChannel, lead);

    for (const channel of channels) {
      try {
        switch (channel) {
          case 'instagram':
            if (lead.externalId) {
              const tokenData = await this.instagramOAuth.getValidToken(userId);
              if (tokenData) {
                const instagramAccountId = await this.getInstagramAccountId(userId);
                if (instagramAccountId) {
                  await sendInstagramMessage(tokenData, instagramAccountId, lead.externalId, content);
                  return true;
                }
              }
            }
            break;

          case 'email':
            if (lead.email) {
              // Get previous messages to find original subject and externalId for threading
              const history = await this.getConversationHistory(lead.id);
              let subject = options.subject || 'Follow-up';
              let inReplyTo: string | undefined = undefined;
              let references: string | undefined = undefined;

              // --- REFINED THREADING LOGIC ---
              // Find the absolute most recent message to reply to
              const lastMessage = history.length > 0 ? (history[history.length - 1] as any) : null;
              const providerThreadId = lastMessage?.metadata?.providerThreadId || (lead.metadata as any)?.providerThreadId;

              if (lastMessage && lastMessage.metadata) {
                // 1. Threading Headers
                if (lastMessage.metadata.externalId) {
                  inReplyTo = lastMessage.metadata.externalId;
                  
                  // Construct References (Parent + its own references)
                  const prevReferences = lastMessage.metadata.references || "";
                  references = prevReferences ? `${prevReferences} ${inReplyTo}` : inReplyTo;
                  
                  console.log(`[FOLLOW_UP] 🧵 Threading reply to message ${inReplyTo} in thread ${providerThreadId}`);
                }

                // 2. Subject Preservation
                if (!options.subject && lastMessage.metadata.subject) {
                  const origSub = lastMessage.metadata.subject;
                  subject = origSub.toLowerCase().startsWith('re:') ? origSub : `Re: ${origSub}`;
                }
              }

              if (!options.subject && !subject) {
                // No existing thread or subject found? Generate one that converts!
                subject = await generateEmailSubject(content, lead.name, (lead.metadata as any)?.company);
                console.log(`[FOLLOW_UP] 🧪 Generated converting subject: "${subject}" for ${lead.email}`);
              }

              await sendEmail(userId, lead.email, content, subject, { 
                ...options, 
                inReplyTo, 
                references, 
                threadId: providerThreadId 
              });
              return true;
            }
            break;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to send via ${channel}:`, error);
        
        // --- PHASE 52: AUTONOMOUS FAILURE ADVISORY ---
        // Route through health service to apply non-blocking advisory/throttling
        try {
          const { mailboxHealthService } = await import("@services/email-service/src/email/mailbox-health-service.js");
          const matchingIntegrations = await db.select()
            .from(integrations)
            .where(and(eq(integrations.userId, userId), eq(integrations.provider, channel as any)))
            .limit(1);
          
          if (matchingIntegrations[0]) {
            await mailboxHealthService.handleMailboxFailure(matchingIntegrations[0], errorMessage);
          }
        } catch (healthErr) {
          console.error('[FollowUpWorker] Failed to report health advisory:', healthErr);
        }

        throw error;
      }
    }

    return false;
  }

  /**
   * Get channel priority for sending
   */
  private getChannelPriority(preferred: string, lead: Lead): string[] {
    const channels = [preferred];

    // Add fallback channels
    if (preferred !== 'email' && lead.email) channels.push('email');
    if (preferred !== 'instagram' && lead.externalId) channels.push('instagram');

    return channels;
  }

  /**
   * Get Instagram business account ID for a user
   */
  private async getInstagramAccountId(userId: string): Promise<string | null> {
    if (!db) return null;

    try {
      const userIntegrations = await db
        .select()
        .from(integrations)
        .where(and(
          eq(integrations.userId, userId),
          eq(integrations.provider, 'instagram'),
          eq(integrations.connected, true)
        ))
        .limit(1);

      const integration = userIntegrations[0];
      if (!integration || !integration.encryptedMeta) {
        return null;
      }

      try {
        const meta = decryptToJSON<{ userId?: string; instagramBusinessAccountId?: string; pageId?: string }>(integration.encryptedMeta);
        return meta.userId || meta.instagramBusinessAccountId || meta.pageId || null;
      } catch (e) {
        console.error('[FOLLOW_UP] Failed to decrypt integration meta:', e);
        return null;
      }
    } catch (error) {
      console.error('Error fetching Instagram account ID:', error);
      return null;
    }
  }

  /**
   * Save message to database
   */
  private async saveMessage(
    userId: string,
    leadId: string,
    content: string,
    role: 'user' | 'assistant',
    metadata: Record<string, any> = {}
  ): Promise<any> {
    try {
      return await storage.createMessage({
        userId,
        leadId,
        body: content,
        direction: role === 'user' ? 'inbound' : 'outbound',
        provider: (metadata.channel as ProviderType) || 'instagram',
        trackingId: metadata.trackingId || null,
        metadata
      });
    } catch (error) {
      console.error('Error saving follow-up message:', error);
      return undefined;
    }
  }

  /**
   * Schedule next follow-up with multi-channel orchestration and day-aware timing
   * 
   * Human-like timing:
   * - Email: Day 1 (24h), Day 2 (48h), Day 5, Day 7
   * - Instagram: Day 5, Day 8 (failover if email failed)
   */
  private async scheduleNextFollowUp(
    userId: string,
    leadId: string,
    lead: Lead
  ): Promise<void> {
    if (!db) return;

    // --- PHASE 27 & 34: BULLMQ STATE & CLASH CHECK ---
    const pendingJobs = await db.select().from(followUpQueue).where(
      and(
        eq(followUpQueue.leadId, leadId),
        eq(followUpQueue.status, 'pending')
      )
    ).limit(1);

    if (pendingJobs.length > 0) {
      console.log(`[FOLLOW_UP_WORKER] ⚠️ Clash prevented: Lead ${lead.name} already has a pending follow-up scheduled.`);
      return;
    }

    // Standard sequence relative to lead creation: Day 3, Day 7
    const followUpCount = (lead.metadata as Record<string, unknown>)?.follow_up_count as number || 0;

    let nextDayMarker = 0;
    if (followUpCount === 1) {
      nextDayMarker = 7; // Previously sent Day 3, next is Day 7
    } else if (followUpCount >= 2) {
      // PERSISTENT: Continue sequence even after initial campaign
      // Gradually increase delays: 14, 30, 60, 90...
      const progression = [14, 30, 60, 90, 120, 180, 240, 365];
      const progIndex = Math.min(progression.length - 1, followUpCount - 2);
      nextDayMarker = progression[progIndex];
      console.log(`[FOLLOW_UP] Lead ${lead.name} in persistent nurturing stage. Step: ${followUpCount}. Delay: Day ${nextDayMarker}`);
    } else {
      nextDayMarker = 3;
    }

    const creationTime = lead.createdAt?.getTime() || Date.now();
    let scheduledAt = new Date(creationTime + nextDayMarker * 24 * 60 * 60 * 1000);

    // --- GLOBAL EDGE CONSISTENCY (PHASE 35) ---
    // Fetch lead's timezone profile to ensure we land in their local morning
    try {
      const profile = await getLeadProfile(leadId);
      if (profile?.detectedTimezone) {
        // Schedule for 10:00 AM local time on the target day
        scheduledAt = timezoneService.getScheduledWindow(nextDayMarker, profile.detectedTimezone, 10);
        console.log(`[FOLLOW_UP] Precision scheduled for ${lead.name} at 10am ${profile.detectedTimezone}`);
      }
    } catch (tzErr) {
      console.warn(`[FOLLOW_UP] Timezone adjustment failed for lead ${leadId}:`, tzErr);
    }

    // Safety: ensure we don't schedule in the past
    if (scheduledAt.getTime() < Date.now()) {
      scheduledAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now if already past
    }

    console.log(`📅 Scheduling follow-up ${followUpCount + 1} for lead ${lead.name} at ${scheduledAt.toISOString()} (Day ${nextDayMarker})`);

    await db.insert(followUpQueue).values({
      userId,
      leadId,
      channel: lead.channel as "email" | "instagram",
      scheduledAt: scheduledAt,
      context: {
        follow_up_number: followUpCount + 1,
        campaign_day: nextDayMarker,
        scheduled_relative_to: 'creation'
      }
    });
  }


  /**
   * Assess lead temperature based on engagement patterns
   */
  private assessLeadTemperature(lead: Lead, messageHistory: Message[]): 'hot' | 'warm' | 'cold' {
    // Hot lead indicators
    const recentMessages = messageHistory.filter((m: Message) => {
      const hoursSince = (Date.now() - new Date(m.createdAt).getTime()) / (1000 * 60 * 60);
      return hoursSince < 24;
    });

    const inboundInLast24h = recentMessages.filter((m: Message) => m.direction === 'inbound').length;
    const metadata = lead.metadata as Record<string, unknown> | undefined;
    const behaviorPattern = metadata?.behavior_pattern as Record<string, unknown> | undefined;
    const engagementScore = (behaviorPattern?.engagementScore as number) || 0;

    // HOT: Recent activity + high engagement
    if (inboundInLast24h >= 2 || engagementScore > 70) {
      return 'hot';
    }

    // WARM: Some recent activity or medium engagement
    if (inboundInLast24h >= 1 || (engagementScore > 40 && lead.warm)) {
      return 'warm';
    }

    // COLD: Low activity or declining engagement
    return 'cold';
  }

  /**
   * Get follow-up delay based on follow-up count and lead temperature
   * STRATEGIC GAPS (1, 3, 7):
   * - Follow-up 1: Day 1 (24 hours)
   * - Follow-up 2: Day 3 (72 hours)
   * - Follow-up 3: Day 7 (168 hours)
   */
  private getFollowUpDelay(followUpCount: number, temperature: 'hot' | 'warm' | 'cold'): number {
    const dayInMs = 24 * 60 * 60 * 1000;

    // Strategic sequence map: follow_up_count -> delay from previous
    const sequenceMap: Record<number, number> = {
      0: 24 * dayInMs,    // Day 1
      1: 48 * dayInMs,    // Day 3 (24 + 48 = 72)
      2: 96 * dayInMs,    // Day 7 (72 + 96 = 168)
    };

    let baseDelay = sequenceMap[followUpCount] || 168 * dayInMs;

    // Adjust based on lead temperature
    if (temperature === 'hot') {
      baseDelay *= 0.8; // Accelerate hot leads by 20%
    } else if (temperature === 'cold') {
      baseDelay *= 1.5; // Decelerate cold leads
    }

    const jitter = baseDelay * (Math.random() * 0.2 - 0.1); // +/- 10%
    return Math.max(1000 * 60 * 60, baseDelay + jitter);
  }

  /**
   * Get randomization window based on lead temperature
   */
  private getRandomizationWindow(temperature: 'hot' | 'warm' | 'cold'): number {
    // Hot leads: ±10% variance (stay responsive)
    if (temperature === 'hot') {
      return Math.random() * 0.2 - 0.1;
    }

    // Warm leads: ±20% variance (natural timing)
    if (temperature === 'warm') {
      return Math.random() * 0.4 - 0.2;
    }

    // Cold leads: ±30% variance (more unpredictable, human-like)
    return Math.random() * 0.6 - 0.3;
  }
}

// Create singleton instance
export const followUpWorker = new FollowUpWorker();

/**
 * Schedule initial follow-up for newly imported leads
 * This is called from CSV/PDF import to ensure all leads get systematic outreach
 */
export async function scheduleInitialFollowUp(
  userId: string,
  leadId: string,
  channel: 'email' | 'instagram' | 'linkedin' | 'voice' | 'sms' | 'whatsapp' | 'manual'
): Promise<boolean> {
  if (!db) return false;

  try {
    const followUpChannel = channel === 'manual' ? 'email' : channel;

    // Strictly Day 3 Relative to Lead Creation
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    const creationTime = lead?.createdAt?.getTime() || Date.now();

    // Day 3 = 72 hours
    const scheduledAt = new Date(creationTime + 3 * 24 * 60 * 60 * 1000);

    // If Day 3 is already past, wait 1 hour for safety
    if (scheduledAt.getTime() < Date.now()) {
      scheduledAt.setTime(Date.now() + 60 * 60 * 1000);
    }

    await db.insert(followUpQueue).values({
      userId,
      leadId,
      channel: followUpChannel as "email" | "instagram",
      scheduledAt: scheduledAt,
      context: {
        follow_up_number: 1,
        source: 'import',
        temperature: 'warm',
        campaign_day: 3,
        sequence_number: 1,
        initial_outreach: true,
        scheduled_relative_to: 'creation'
      }
    });

    console.log(`📅 Scheduled initial Day 3 follow-up for lead ${leadId} at ${scheduledAt.toISOString()}`);
    return true;
  } catch (error) {
    console.error('Error scheduling initial follow-up:', error);
    return false;
  }
}





