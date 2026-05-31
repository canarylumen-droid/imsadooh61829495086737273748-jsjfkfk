
import { db } from '@shared/lib/db/db.js';
import {
  outreachCampaigns,
  campaignLeads,
  leads,
  messages,
  integrations,
  campaignEmails,
  users,
  pendingPayments,
  type Integration
} from '@audnix/shared';
import { getPlanCapabilities } from '@audnix/shared/plan-utils.js';
import { eq, and, or, sql, lte, desc, ne, isNull, lt, notInArray, gt } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { sendEmail } from "@shared/lib/channels/email.js";
import { adjustCopyIfNecessary } from "../../../shared/lib/ai/copy-adjuster.js";
import { generateContextAwareMessage } from "@services/brain-worker/src/orchestrator/agents/universal-sales-agent-integrated.js";
import { getBrandContext } from "@services/brain-worker/src/ai-lib/context/brand-context.js";
import { generateExpertOutreach } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { MODELS } from "@services/brain-worker/src/ai-lib/utils/model-config.js";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { AuditTrailService } from "@shared/lib/monitoring/audit-trail-service.js";
import { sendInstagramOutreach } from "@shared/lib/providers/instagram.js";
import { decryptToJSON } from "@shared/lib/crypto/encryption.js";
import { hasRedis } from "@shared/lib/queues/redis-config.js";
import { mailboxHealthService } from "@services/email-service/src/email/mailbox-health-service.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { warmupService } from "@services/outreach-worker/src/outreach-lib/warmup-service.js";
import { ReputationGuard } from "@services/email-service/src/email/reputation-guard.js";
import { objectionService } from "@services/brain-worker/src/ai-lib/analyzers/objection-service.js";
import { mailboxHasPendingReply } from "@shared/lib/queues/campaign-queue.js";

export class OutreachEngine {
  private isRunning: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private readonly TICK_INTERVAL_MS = 60000; // Reduced to 1m for 24/7 autonomous deployment
  private activeUserProcessing: Set<string> = new Set();
  private readonly MAX_CONCURRENT_USERS = 5000;
  private userMailboxIndex: Map<string, number> = new Map(); // Tracks rotating mailbox index per user
  private consecutiveFailures: number = 0;
  private panicUntil: number = 0;
  private readonly MAX_BACKOFF_MS = 3600000; // 1 hour max backoff

  /**
   * Start the outreach engine
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🚀 Outreach Engine started (BullMQ Master Mode)');

    // Instead of local setInterval, we ensure a recurring job exists in BullMQ
    const { outreachQueue } = await import("@shared/lib/queues/outreach-queue.js");
    
    // Add a repeatable job that runs every 1 minute
    await outreachQueue.add('engine-tick', { type: 'tick' } as any, {
      repeat: {
        every: this.TICK_INTERVAL_MS,
      },
      jobId: 'outreach-engine-tick', // Constant ID to prevent duplicates
    });

    // Also run once immediately on startup
    this.tick();
  }

  /**
   * Stop the engine
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('🛑 Outreach Engine stopped');
  }

  /**
   * Single tick for serverless / manual trigger
   */
  async tick(): Promise<{ processed: number; errors: number }> {
    const results = { processed: 0, errors: 0 };
    if (!db) return results;

    if (quotaService.isRestricted()) {
      const remaining = Math.round(quotaService.getRemainingCooldownMs() / 60000);
      console.log(`[OutreachEngine] Skipping tick: Database quota restricted. Recovering in ~${remaining}m`);
      return results;
    }

    if (Date.now() < this.panicUntil) {
      const remaining = Math.round((this.panicUntil - Date.now()) / 60000);
      console.log(`[OutreachEngine] Skipping tick: PANIC MODE active. Backing off for another ~${remaining}m`);
      return results;
    }

    try {
      const { outreachQueue } = await import("@shared/lib/queues/outreach-queue.js");

      // 1. Find all users with active and connected email integrations
      const activeIntegrations = await db.select({
        id: integrations.id,
        userId: integrations.userId,
        provider: integrations.provider,
        encryptedMeta: integrations.encryptedMeta,
        warmupStatus: integrations.warmupStatus,
        autonomousMode: sql<boolean>`(${users.config}->>'autonomousMode')::boolean`
      }).from(integrations)
        .innerJoin(users, eq(integrations.userId, users.id))
        .where(
            notInArray(integrations.provider, ['google_calendar', 'calendly'])
        );

      // Create a map for quick user configuration lookup during tick()
      const uniqueUserMap = new Map<string, boolean>();
      for (const i of activeIntegrations) {
        uniqueUserMap.set(i.id, i.autonomousMode !== false);
      }

      for (const integration of activeIntegrations) {
        // System 9: Auto-Heal stuck/zombie leads for this user
        await this.autonomouslyHealZombieLeads(integration.userId);

        const isAutonomous = uniqueUserMap.get(integration.id) ?? true;
        
        if (outreachQueue) {
          // Enqueue ONLY autonomous tasks for the user.
          await outreachQueue.add(`outreach-autonomous-${integration.userId}` as any, { 
            userId: integration.userId, 
            integrationId: integration.id,
            type: 'autonomous',
            isAutonomous 
          }, {
            jobId: `outreach-autonomous-${integration.id}-${Math.floor(Date.now() / 60000)}`,
            removeOnComplete: true
          });
        } else {
          // Fallback to inline processing if Redis is disabled
          try {
            await this.processUserOutreach(integration.userId, integration as any, isAutonomous);
          } catch (err: any) {
             console.error(`[OutreachEngine] Fallback failed for user ${integration.userId}:`, err.message);
          }
        }
      }

      workerHealthMonitor.recordSuccess('outreach-engine');
      this.consecutiveFailures = 0;
      this.panicUntil = 0;
    } catch (error: any) {
      console.error('[OutreachEngine] Global tick error:', error);
      
      // Implement Exponential Backoff
      this.consecutiveFailures++;
      const backoffMs = Math.min(
        this.TICK_INTERVAL_MS * Math.pow(2, this.consecutiveFailures - 1),
        this.MAX_BACKOFF_MS
      );
      this.panicUntil = Date.now() + backoffMs;
      
      console.warn(`[OutreachEngine] 🚨 Panic Mode: ${this.consecutiveFailures} consecutive failures. Backing off for ${Math.round(backoffMs / 60000)}m`);

      quotaService.reportDbError(error);
      workerHealthMonitor.recordError('outreach-engine', error?.message || 'Unknown tick error');
      results.errors++;
    }

    return results;
  }

  /**
   * Process outreach for a specific user (Batch mode)
   */
  public async processUserOutreach(userId: string, integration: Integration, isAutonomousExplicit?: boolean): Promise<void> {
    this.activeUserProcessing.add(userId);
    try {
      // --- FAULT TOLERANCE: Plan Expiry Check ---
      const isPlanActive = await mailboxHealthService.isPlanActive(userId);
      if (!isPlanActive) {
        console.warn(`[OutreachEngine] skipping user ${userId} - Plan expired/inactive`);
        return;
      }

      // --- GLOBAL AI ENGINE TOGGLE CHECK ---
      // Use explicit status if passed from tick(), otherwise fetch (fallback for direct calls)
      let isAutonomousMode = isAutonomousExplicit;
      if (isAutonomousMode === undefined) {
        const user = await storage.getUser(userId);
        isAutonomousMode = (user as any)?.config?.autonomousMode !== false;
      }

      // Hard check for system-wide restriction or manual override
      if (process.env.GLOBAL_AI_PAUSE === 'true') {
        console.warn(`[OutreachEngine] 🛑 GLOBAL AI PAUSE ACTIVE. Skipping user ${userId}.`);
        return;
      }

      if (!isAutonomousMode) {
        console.log(`[OutreachEngine] AI Engine is OFF for user ${userId}. Skipping autonomous follow-ups, but allowing active campaigns.`);
      }

      // --- PART 0: Inventory Distribution ---
      // Automatically distribute leads from the Inventory pool to mailboxes with capacity.
      // This ensures mailboxes are always "primed" even without an active campaign.
      const health = workerHealthMonitor.isSystemPaused();
      if (health.paused) {
        console.warn(`🛑 [OutreachEngine] System is in EMERGENCY BRAKE mode: ${health.reason}. Skipping tick.`);
        return;
      }

      // --- PART 0: Inventory Distribution ---
      try {
        const { distributeLeadsFromPool } = await import("./outreach-engine.js");
        await distributeLeadsFromPool(userId);
      } catch (distErr) {
        console.error('[OutreachEngine] Background lead distribution failed:', distErr);
      }

      // --- PART 1: Structured Campaigns ---
      const processedCampaign = await this.tickCampaigns(userId).catch(err => {
        console.error(`[OutreachEngine] tickCampaigns failed for ${userId}:`, err.message);
        return false;
      });
      if (processedCampaign) return;

      // --- PART 2: Autonomous AI Outreach ---
      // If no campaign was processed, check for individual "new" leads with AI enabled
      if (isAutonomousMode) {
        await this.tickAutonomousOutreach(userId).catch(err => {
          console.error(`[OutreachEngine] tickAutonomousOutreach failed for ${userId}:`, err.message);
        });
      }

      // --- PART 3: [PHASE 46] Self-Healing Reputation Sweep ---
      await this.selfHealMailboxDistribution(userId).catch(err => {
        console.error(`[OutreachEngine] selfHealMailboxDistribution failed for ${userId}:`, err.message);
      });

    } finally {
      // Emit stats refresh for instant KPI updates on dashboard
      wsSync.notifyStatsUpdated(userId);
      this.activeUserProcessing.delete(userId);
    }
  }

  /**
   * Logic for structured campaigns.
   * When BullMQ is available, campaign processing is handled by dedicated
   * per-mailbox workers in campaign-queue.ts — this method is skipped.
   * When Redis is unavailable, this runs inline as a fallback.
   */
  public async tickCampaigns(userId: string): Promise<boolean> {
    // When BullMQ is active, campaign processing is fully autonomous via campaign-queue.ts
    // Each mailbox has its own repeatable job — no need for polling here.
    if (hasRedis) return false;

    // --- FALLBACK: Inline processing when Redis is unavailable ---
    
    // --- LEVEL 20: AUTONOMOUS SALES PRIORITY PAUSE ---
    // If there is ANY checkout link queued or pending dispatch, we hard-pause standard campaigns.
    // This protects daily sending limits from clashing with highly valuable payment links.
    try {
      const userResultForPause = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const isUserAutonomous = (userResultForPause[0]?.config as any)?.autonomousMode !== false;

      if (isUserAutonomous) {
        const activeCheckouts = await db.select({ id: pendingPayments.id })
          .from(pendingPayments)
          .where(
            and(
              eq(pendingPayments.userId, userId),
              eq(pendingPayments.status, 'pending'),
              or(
                isNull(pendingPayments.expiresAt),
                gt(pendingPayments.expiresAt, new Date())
              )
            )
          ).limit(1);

        if (activeCheckouts.length > 0) {
          console.log(`⏸️ [Priority Schedule] Pausing campaigns for ${userId}. Active checkout links detected!`);
          return false;
        }
      }
    } catch (e) {
      console.error("[Priority Schedule] Error checking priority:", e);
    }

    // Find active campaigns for this user
    const campaigns = await db
      .select()
      .from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.userId, userId), eq(outreachCampaigns.status, 'active')));

    if (campaigns.length === 0) return false;

    // Pick campaign to process (rotate by updatedAt)
    const sortedCampaigns = campaigns.sort((a: any, b: any) =>
      new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );

    const now = new Date();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    let campaign = null;
    for (const c of sortedCampaigns) {
      // 24/7 MODE: Ignoring weekend exclusion flags
      campaign = c;
      break;
    }

    if (!campaign) return false;

    // Get up to 2000 leads to process in batches
    const nextLeadsResult = await db.select({
      campaignLead: campaignLeads,
      lead: leads
    })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .where(
        and(
          eq(campaignLeads.campaignId, campaign.id),
          or(
            // Logic for normal pending outreach/follow-up
            and(
              or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'sent')),
              or(isNull(campaignLeads.nextActionAt), lte(campaignLeads.nextActionAt, new Date())),
              eq(leads.aiPaused, false),
              ne(leads.status, 'replied'),
              ne(leads.status, 'booked'),
              ne(leads.status, 'converted'),
              ne(leads.status, 'not_interested')
            ),
            // Logic for Auto-Reply Trigger
            and(
              eq(campaignLeads.status, 'replied'),
              sql`${campaignLeads.metadata}->>'pendingAutoReply' = 'true'`,
              lte(campaignLeads.nextActionAt, new Date())
            )
          )
        )
      )
      .for('update', { skipLocked: true }) // CRITICAL: Multi-pod safety
      .orderBy(
        // Priority 1: Auto-Replies (highest)
        sql`CASE WHEN ${campaignLeads.metadata}->>'pendingAutoReply' = 'true' THEN 0 ELSE 1 END`,
        // Priority 2: Follow-ups (higher than new outreach)
        sql`CASE WHEN ${campaignLeads.currentStep} > 1 THEN 0 ELSE 1 END`,
        // Then by scheduled time
        campaignLeads.nextActionAt
      )
      .limit(2000);

    if (nextLeadsResult.length === 0) {
      // (Optional skip check logic remains same)
      return false;
    }

    // Enterprise Scaling: Calculate batch size based on available mailboxes
    const activeMailboxes = await this.getAvailableMailboxes(userId);
    const MAX_SENDS_PER_TICK = Math.max(10, activeMailboxes.length * 5); // 5 sends per mailbox per minute tick
    let sentInThisTick = 0;

    for (const row of nextLeadsResult) {
      if (sentInThisTick >= MAX_SENDS_PER_TICK) break;

      const leadEntry = (row as any).campaignLead || row;
      const lead = (row as any).lead || row;

      if (!lead || (!lead.email && lead.channel === 'email')) continue;

      // GET THE ASSIGNED MAILBOX FOR THIS LEAD
      const integrationId = leadEntry.integrationId;
      if (!integrationId) continue; // Should have been assigned during launch

      const integration = await storage.getIntegrationById(integrationId);
      if (!integration || !integration.connected) continue;

      const isHighPriority = leadEntry.currentStep >= 1 || leadEntry.metadata?.pendingAutoReply === true;
      const isUnmeteredReply = leadEntry.metadata?.pendingAutoReply === true;
      const isReady = await this.isMailboxReadyToSend(userId, integration, campaign, isHighPriority, isUnmeteredReply);
      if (!isReady) continue;

      // Process delivery
      try {
        if (lead.channel === 'instagram') {
          await this.deliverCampaignInstagram(userId, campaign, lead, leadEntry);
          sentInThisTick++;
        } else {
          await this.deliverCampaignEmail(userId, campaign, lead, leadEntry, integration.id);
          sentInThisTick++;
        }
      } catch (err) {
        console.error(`[OutreachEngine] Campaign delivery failed for ${lead.email || lead.id}:`, err);
      }
    }
    return sentInThisTick > 0;
  }

  /**
   * Logic for autonomous AI outreach (replacing outreach-worker.ts)
   */
  public async tickAutonomousOutreach(userId: string): Promise<void> {
    // We check readiness per lead

    // Get leads with status 'new', channel 'email', and AI explicitly enabled
    // Autonomous outreach MUST NOT start automatically just because a lead is 'new'
    const userLeads = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.userId, userId),
          eq(leads.status, 'new'),
          or(eq(leads.channel, 'email'), eq(leads.channel, 'instagram')),
          eq(leads.aiPaused, false),
          // Strictly honor AI Outreach Consent - Leads must explicitly opt-in
          sql`(${leads.metadata}->>'ai_outreach_consent')::boolean = true`
        )
      )
      .limit(50); // Increased batch for autonomous outreach scalability

    let sentInThisTick = 0;
    const MAX_AUTONOMOUS_PER_TICK = 50; // Increased for 50k+ lead bulk catch-up

    for (const lead of userLeads) {
      if (sentInThisTick >= MAX_AUTONOMOUS_PER_TICK) break;
      if (!lead.email) continue;

      // Safety: Double check if already contacted
      const alreadyContacted = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'outbound')))
        .limit(1);

      if (alreadyContacted.length > 0) {
        continue;
      }

      // Check readiness and get a mailbox
      const mailbox = await this.getNextAvailableMailbox(userId);
      if (!mailbox) {
        continue;
      }

      // Process autonomous outreach
      try {
        if (lead.channel === 'instagram') {
          await this.deliverAutonomousInstagram(userId, lead);
          sentInThisTick++;
        } else {
          await this.deliverAutonomousOutreach(userId, lead, mailbox.id);
          sentInThisTick++;
        }
      } catch (err) {
        console.error(`[OutreachEngine] Autonomous outreach failed for ${lead.email || lead.id}:`, err);
      }
    }
  }

  /**
   * Public helper to get allowed mailboxes for a user based on their plan
   */
  public async getAvailableMailboxes(userId: string): Promise<Integration[]> {
    const allInts = await storage.getIntegrations(userId);
    const mailboxes = allInts.filter(i =>
      ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected
    );

    const user = await storage.getUser(userId);
    const planId = (user as any)?.subscriptionTier || (user as any)?.subscriptionPlan || 'starter';
    const capabilities = getPlanCapabilities(planId.toLowerCase());

    const limit = capabilities.mailboxLimit === -1 ? Infinity : capabilities.mailboxLimit;

    return mailboxes.slice(0, limit).sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Selection of the next mailbox using round-robin rotation, respecting limits
   */
  private async getNextAvailableMailbox(userId: string, campaign?: any): Promise<Integration | undefined> {
    const allInts = await storage.getIntegrations(userId);
    const mailboxes = allInts.filter(i =>
      ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected
    );

    if (mailboxes.length === 0) {
      console.warn(`[OutreachEngine] No connected email mailboxes found for user ${userId}`);
      return undefined;
    }

    // Plan-based limit check
    let activeMailboxes = await this.getAvailableMailboxes(userId);
    if (activeMailboxes.length === 0) return undefined;

    // Filter by campaign config if user specifically selected mailboxes
    const allowedMailboxIds = campaign?.config?.mailboxIds;
    if (Array.isArray(allowedMailboxIds) && allowedMailboxIds.length > 0) {
      activeMailboxes = activeMailboxes.filter(mb => allowedMailboxIds.includes(mb.id));
      if (activeMailboxes.length === 0) return undefined;
    }

    // Get start index for rotation
    let startIndex = this.userMailboxIndex.get(userId) || 0;
    if (startIndex >= activeMailboxes.length) startIndex = 0;

    // Try each mailbox starting from index
    for (let i = 0; i < activeMailboxes.length; i++) {
      const idx = (startIndex + i) % activeMailboxes.length;
      const mailbox = activeMailboxes[idx];

      // PHASE 46: Strictly avoid mailboxes with reputation < 65
      const reputation = mailbox.reputationScore ?? null;
      if (reputation !== null && reputation < 65 && mailbox.warmupStatus !== 'active') {
        continue;
      }

      if (await this.isMailboxReadyToSend(userId, mailbox, campaign)) {
        // Update rotation index for next time
        this.userMailboxIndex.set(userId, (idx + 1) % activeMailboxes.length);
        return mailbox;
      }
    }

    return undefined;
  }

  /**
   * Checks daily limits and mandatory randomized delays for a specific mailbox
   */
  private async isMailboxReadyToSend(userId: string, integration: Integration, campaign?: any, isHighPriority: boolean = false, isUnmeteredReply: boolean = false): Promise<boolean> {
    if (isUnmeteredReply) {
      console.log(`[OutreachEngine] ⚡ Unmetered Reply override active: bypassing limits for ${integration.id}`);
      return true;
    }

    const meta = decryptToJSON(integration.encryptedMeta) || {};
    
    const user = await storage.getUser(userId);
    const tier = (user?.subscriptionTier || user?.plan || 'starter').toLowerCase();
    const isEnterprise = tier === 'enterprise';

    // Default safe limits by provider type
    let defaultLimit = isEnterprise ? 500 : 50;
    if (integration.provider === 'custom_email') defaultLimit = isEnterprise ? 500 : 250;
    else if (integration.provider === 'outlook') defaultLimit = isEnterprise ? 500 : 50;
    else if (integration.provider === 'gmail') defaultLimit = isEnterprise ? 500 : 50;

    // Single source of truth: integrations.dailyLimit DB column
    // (written by Reputation Monitor + Autonomous Scaler)
    let mailboxDailyLimit = (integration as any).dailyLimit && Number((integration as any).dailyLimit) > 0
      ? Number((integration as any).dailyLimit)
      : defaultLimit;
    
    // Override with campaign-specific limit if provided
    if (campaign?.config?.mailboxLimits && campaign.config.mailboxLimits[integration.id]) {
      mailboxDailyLimit = Number(campaign.config.mailboxLimits[integration.id]);
    }

    /**
     * ADVANCED GMAIL/OUTLOOK BUFFERING & ENTERPRISE SCALING
     * - Hard cap: mailboxDailyLimit (50 for non-enterprise, 500 for enterprise)
     * - Initial Outreach (Priority 3) Buffer: 150 (enforces gap before hard limit)
     */
    const isGmailOrOutlook = ['gmail', 'outlook'].includes(integration.provider);
    const bufferThreshold = (isGmailOrOutlook && !isEnterprise) ? 150 : 0;
    const hardLimit = mailboxDailyLimit;
    
    // High Priority (Follow-ups/Auto-Replies) can reach the hard limit.
    // Initial Outreach must stop at hardLimit - bufferThreshold.
    // NOTE: Buffer threshold is ENFORCED to prevent initial outreach from consuming all daily slots.
    const baseEffectiveLimit = isHighPriority ? hardLimit : Math.max(0, hardLimit - bufferThreshold);

    // --- Autonomous Adaptive Reputation Limits ---
    let effectiveLimit = baseEffectiveLimit;
    
    // --- Neural Brain Smart Capping ---
    if (!isEnterprise) {
      const createdAt = new Date((integration as any).createdAt || Date.now());
      const isWarmed = (Date.now() - createdAt.getTime()) > (14 * 24 * 60 * 60 * 1000);
      
      // NEURAL BRAIN CAP: 60/day max for non-enterprise (overrides user setting)
      const smartCap = isWarmed ? 60 : 45; // Deterministic: no Math.random in limit calc
      effectiveLimit = Math.min(effectiveLimit, smartCap);
      console.log(`[OutreachEngine] 🧠 NEURAL BRAIN: Mailbox ${integration.id.slice(-8)} capped at ${effectiveLimit} (Warmed: ${isWarmed})`);
    }
    
    // --- EMERGENCY SUSPENSION CHECK: Instagram ---
    if (integration.provider === 'instagram' && process.env.SUSPEND_INSTAGRAM === 'true') {
        console.warn(`[OutreachEngine] 🛑 Instagram outreach is EMERGENCY SUSPENDED via system config. Skipping integration ${integration.id}.`);
        return false;
    }

    // --- PRIORITY PAUSE: Yield to pending auto-replies ---
    // If a lead just replied and an auto-reply is scheduled, we pause batch sending 
    // to avoid double-send collisions and ensure the AI reply lands first.
    if (!isHighPriority) {
      const hasReplyPending = await mailboxHasPendingReply(integration.id);
      if (hasReplyPending) {
        console.log(`[OutreachEngine] ⏳ Priority Pause: Mailbox ${integration.id.slice(-8)} has a pending auto-reply. Yielding.`);
        return false;
      }
    }

    // Apply Warmup Service limits
    if (integration.provider !== 'instagram') {
      const warmup = warmupService.getWarmupStatus(integration, hardLimit);
      if (warmup.isWarmingUp && warmup.dailyLimit < effectiveLimit) {
        effectiveLimit = warmup.dailyLimit;
        console.log(`[OutreachEngine] 🛡️ WARMUP LIMIT: Mailbox ${integration.id} (${integration.provider}) capped at ${effectiveLimit} - ${warmup.reason}`);
      }
    }

    if (integration.provider !== 'instagram') {
      try {
        // [PHASE 18] REAL-TIME SAFETY INTERLOCK
        // Pre-flight check domain safety against blacklists/DNS records
        const emailStr = meta.user || meta.email || (integration as any).email || '';
        const domain = emailStr.includes('@') ? emailStr.split('@')[1] : '';
        
        if (domain) {
          const safety = await ReputationGuard.checkSafety(userId, integration.id, domain);
          if (!safety.isSafe) {
            // Log and notify why the mailbox was blocked in real-time
            console.warn(`[OutreachEngine] 🛡️ SAFETY INTERLOCK: Skipping mailbox ${integration.id} - ${safety.reason}`);
            return false; // Skip this mailbox from sending
          }
        }
        
        // Fetch real-time health for this specific integration/mailbox
        const domainVerifications = await storage.getDomainVerifications(userId, 10);
        let activeVerifications = domainVerifications;
        if (integration.encryptedMeta) {
           const meta = decryptToJSON(integration.encryptedMeta) || {};
           const email = meta.user || meta.email || '';
           if (email && email.includes('@')) {
               const d = email.split('@')[1];
               activeVerifications = activeVerifications.filter(v => v.domain === d);
           }
        }
        
        // Deduplicate the same way the dashboard does
        const uniqueVerifications = new Map();
        for (const v of activeVerifications) {
          if (!uniqueVerifications.has(v.domain)) {
            uniqueVerifications.set(v.domain, v);
          }
        }
        activeVerifications = Array.from(uniqueVerifications.values());
        
        const unverifiedDomains = activeVerifications.filter(v => {
          const result = v.verification_result as any;
          return result && result.overallStatus !== 'excellent' && result.overallStatus !== 'good';
        }).length;
        
        // [PHASE 47] 4-Tier Health Graceful Throttling (Advisory Only)
        const healthLevel = (integration as any).healthLevel || 'healthy';
        const gracefulLimit = (integration as any).gracefulDailyLimit;

        if (gracefulLimit !== null && gracefulLimit !== undefined) {
           effectiveLimit = Math.min(effectiveLimit, gracefulLimit);
           console.log(`[OutreachEngine] 🛡️ GRACEFUL THROTTLE: Mailbox ${integration.id} capped at ${effectiveLimit} due to ${healthLevel} state.`);
        }
        
        // --- PRIORITY PAUSE: Yield to pending auto-replies ---
        const reputationScore = integration.reputationScore ?? null;
        if (reputationScore !== null && reputationScore < 40) {
           effectiveLimit = Math.min(5, effectiveLimit);
           console.log(`[OutreachEngine] ⚠️ LOW REPUTATION (${reputationScore}) for ${integration.id}. Strict volume reduction applied.`);
        }
      } catch (err) {
        console.error(`[OutreachEngine] Error assessing domain health for limit adaptation:`, err);
      }
    }

    const channel = integration.provider === 'instagram' ? 'instagram' : 'email';

    // Calculate safe dynamic rate for non-stop delivery over 24 hours
    let finalMailboxLimit = mailboxDailyLimit;

    // 24/7 MODE: Peak Hour Analysis removed. Operating at safe constant frequency.
    const isPeakHour = true; // Always active
    
    // Adaptive frequency: 24/7 consistent pace 
    const targetSendsPerHour = Math.min(Math.max(1, Math.ceil(mailboxDailyLimit / 24)) * 2, isHighPriority ? 100 : 50);

    // 1. Cooldown check (using integrationId if available)
    const lastSentResult = await db.execute(sql`
        SELECT created_at FROM messages 
        WHERE user_id = ${userId} 
        AND direction = 'outbound' 
        AND (metadata->>'integrationId' = ${integration.id} OR (provider = ${integration.provider} AND metadata->>'integrationId' IS NULL))
        ORDER BY created_at DESC LIMIT 1
    `);

    if (lastSentResult.rows.length > 0) {
      const lastSentAt = new Date(lastSentResult.rows[0].created_at as string).getTime();
      let minDelayMs = 30000;

      if (channel === 'instagram') {
        minDelayMs = (5 + Math.random() * 5) * 60 * 1000;
      } else {
        // Dynamic delay spacing based on targetSendsPerHour to distribute evenly across the hour
        const baseDelayMs = (60 * 60 * 1000) / (targetSendsPerHour || 1);
        // Add +/- 15% random jitter to avoid predictable bot patterns
        minDelayMs = baseDelayMs * 0.85 + (Math.random() * baseDelayMs * 0.3);
      }

      if (Date.now() - lastSentAt < minDelayMs) {
        return false;
      }
    }

    // 2. Hourly Rate Limit Check (safety constraint)
    const sentLastHourResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM messages 
      WHERE user_id = ${userId} 
      AND direction = 'outbound'
      AND (metadata->>'integrationId' = ${integration.id} OR metadata->>'integration_id' = ${integration.id})
      AND created_at >= NOW() - INTERVAL '1 hour'
    `);

    if (Number(sentLastHourResult.rows[0].count) >= targetSendsPerHour) {
      return false; // Wait for next slot
    }

    // 3. Global/User AI Engine Toggle
    try {
      const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (userResult[0]) {
        const config = (userResult[0].config as any) || {};
        // Default to ON (true) unless explicitly set to false
        const isAutonomousMode = config.autonomousMode !== false;
        
        if (!isAutonomousMode && !campaign) {
          console.log(`[OutreachEngine] AI Engine is OFF for user ${userId}. Skipping autonomous outreach.`);
          return false;
        }
      }
    } catch (e) {
      console.error('[OutreachEngine] Error checking AI Engine toggle:', e);
    }

    // 4. Daily Limit Hit Check
    const sentTodayResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM messages 
      WHERE user_id = ${userId} 
      AND direction = 'outbound'
      AND (metadata->>'integrationId' = ${integration.id} OR metadata->>'integration_id' = ${integration.id})
      AND created_at >= CURRENT_DATE::timestamp
    `);
    const sentToday = Number(sentTodayResult.rows[0].count);

    if (sentToday >= effectiveLimit) {
      return false;
    }

    // Also respect campaign-specific limit if provided
    if (campaign?.config?.dailyLimit) {
      const campaignSentToday = await db.execute(sql`
            SELECT COUNT(*) as count FROM messages 
            WHERE user_id = ${userId} 
            AND metadata->>'campaignId' = ${campaign.id}
            AND direction = 'outbound'
            AND created_at >= CURRENT_DATE::timestamp
        `);
      if (Number(campaignSentToday.rows[0].count) >= campaign.config.dailyLimit) return false;
    }

    return true;
  }

  /**
   * Helper to deliver campaign email
   */
  private async deliverCampaignEmail(userId: string, campaign: any, lead: any, leadEntry: any, integrationId: string): Promise<void> {
    // SYSTEM 8: Cluster Safety Lock
    const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
    const lockKey = `outreach:lock:${lead.id}`;
    const lockAcquired = await acquireLock(lockKey, 600); // 10-minute lock (Phase 7: extended to prevent double-sends on slow AI/SMTP)
    
    if (!lockAcquired) {
      console.log(`[Safety] Lead ${lead.id} is already being processed by another worker. Skipping.`);
      return;
    }

    try {
      console.log(`[OutreachEngine] Delivering campaign "${campaign.name}" step ${leadEntry.currentStep} to ${lead.email} using mailbox ${integrationId}`);

    // Generate content
    const template = campaign.template as any;
    let subject = template?.initial?.subject || template?.subject || "Contacting you";
    let body = template?.initial?.body || template?.body;

    // --- AUTO-REPLY LOGIC ---
    if (leadEntry.metadata?.pendingAutoReply) {
      body = template?.autoReply?.body || template?.autoReplyBody;
      if (!body) throw new Error('Auto-reply body missing in campaign template');
      subject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
    } else if (leadEntry.currentStep > 0) {
      const followups = template?.followups || [];
      const fuConfig = followups[leadEntry.currentStep - 1];
      if (fuConfig) {
        body = fuConfig.body;
        const fuSubject = fuConfig.subject || subject;
        subject = fuSubject.toLowerCase().startsWith('re:') ? fuSubject : `Re: ${fuSubject}`;

        // Phase 5: AI Dynamic Copy Adjustment
        const user = await storage.getUser(userId);
        if ((campaign.config as any)?.aiAdjustCopy && (user as any)?.aiAdjustCopyEnabled !== false) {
           try {
             const adjustment = await adjustCopyIfNecessary({
               userId,
               leadId: lead.id,
               originalBody: body,
               originalSubject: subject,
             });
             if (adjustment.adjusted) {
               body = adjustment.body;
             }
           } catch (adjErr) {
             console.error(`[OutreachEngine] AI Copy Adjustment failed for lead ${lead.id}:`, adjErr);
           }
        }
      } else if (leadEntry.currentStep > template?.followups?.length) {
        // SYSTEM 12: Dynamic AI Follow-up (Post-Template)
        const { DynamicFollowUpEngine } = await import('@services/brain-worker/src/ai-lib/core/dynamic-followup.js');
        const brandContext = await getBrandContext(userId);
        const threadMessages = await storage.getMessagesByLeadId(lead.id);
        const history = threadMessages.map(m => `${m.direction.toUpperCase()}: ${m.body}`).join('\n');
        
        const dynamicResult = await DynamicFollowUpEngine.generate({
          leadName: lead.name || 'there',
          companyName: lead.company || 'your company',
          industry: (lead.metadata as any)?.industry,
          history,
          brandContext: typeof brandContext === 'string' ? brandContext : JSON.stringify(brandContext),
          stepNumber: leadEntry.currentStep
        });
        
        subject = dynamicResult.subject;
        body = dynamicResult.body;
      }
    } else {
      const campaignConfig = (campaign.config as any) || {};

      if (campaignConfig.highVolumeMode) {
        const brandContext = await getBrandContext(userId);
        const baseBody = body || template?.initial?.body || template?.body || "";
        const firstName = lead.name?.trim().split(" ")[0] || "there";
        const company = lead.company?.trim() || "your company";

        const result = await generateReply(
          "You are an efficient outbound email copywriter. Improve the following outreach email body but keep it concise, clear, and under 120 words.",
          `BRAND CONTEXT:\n${typeof brandContext === "string" ? brandContext : JSON.stringify(brandContext)}\n\nLEAD:\nName: ${lead.name || firstName}\nCompany: ${company}\n\nORIGINAL BODY:\n${baseBody}`,
          {
            model: MODELS.outreach_generation,
            maxTokens: 400,
            temperature: 0.7,
            nga1Enforced: true,
            isEmailBody: true,
            userId
          }
        );

        if (result.text && result.text.trim()) {
          body = result.text.trim();
        }
      } else {
        // For initial step, use Context-Aware stateful generation
        const brandContext = await getBrandContext(userId);
        const threadMessages = await storage.getMessagesByLeadId(lead.id);

        const contextAwareResult = await generateContextAwareMessage(
          lead,
          brandContext,
          [], // Testimonials can be added here
          threadMessages
        );

        subject = contextAwareResult.subject || subject;
        body = contextAwareResult.message;

        // PHASE 43: Store A/B variant for tracking
        if (contextAwareResult.intelligence.variant) {
          await storage.updateLead(lead.id, {
            metadata: {
              ...(lead.metadata as any || {}),
              outreach_variant: contextAwareResult.intelligence.variant
            }
          });
        }
      }
    }

    // Variable replacement fallback (Expanded for safety)
    const firstName = lead.name?.trim().split(' ')[0] || 'there';
    const company = lead.company?.trim() || 'your company';
    body = body
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{lead_name}}/g, lead.name?.trim() || firstName)
      .replace(/{{company}}/g, company)
      .replace(/{{business_name}}/g, company);

    // Subject variable replacement
    subject = subject
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{lead_name}}/g, lead.name?.trim() || firstName);

    // SYSTEM 8: Duplicate Send Guard
    const { DuplicateSendGuard } = await import('@shared/lib/guards/duplicate-send-guard.js');
    const dupCheck = await DuplicateSendGuard.isDuplicate(lead.id, subject, body);
    if (dupCheck.isDuplicate) {
      console.warn(`[OutreachEngine] 🛑 DUPLICATE BLOCKED for lead ${lead.id}: ${dupCheck.reason}`);
      await db.update(campaignLeads)
        .set({ status: 'failed', error: `[Duplicate Guard] ${dupCheck.reason}` })
        .where(eq(campaignLeads.id, leadEntry.id));
      return;
    }

    // Generate a proper trackingId if not already present
    const trackingId = Math.random().toString(36).substring(2, 11);

    // [PHASE 60] ADVANCED REAL-TIME EMAIL VERIFICATION (DeBounce-style)
    try {
      const { verifyEmailAddress } = await import("@services/email-service/src/email/email-address-verification.js");
      const verification = await verifyEmailAddress(lead.email);
      
      if (!verification.isValid) {
        console.warn(`[OutreachEngine] 🛡️ REJECTED lead ${lead.email}: ${verification.reason} (Score: ${verification.score})`);
        
        // Mark as bouncy and failed
        await db.update(leads)
          .set({ status: 'bouncy', metadata: { ...(lead.metadata as any || {}), bounce_reason: verification.reason, verification_score: verification.score } })
          .where(eq(leads.id, lead.id));
          
        await db.update(campaignLeads)
          .set({ status: 'failed', error: `[Pre-flight Verification Failed] ${verification.reason}` })
          .where(eq(campaignLeads.id, leadEntry.id));
          
        return; // Stop here
      }
    } catch (verifErr) {
      console.error("[OutreachEngine] Verification service error (skipping for safety):", verifErr);
    }

    // --- REFINED THREADING LOGIC ---
    let inReplyTo: string | undefined = undefined;
    let references: string | undefined = undefined;
    let threadId: string | undefined = undefined;

    try {
      // Determine if this is a priority reply (auto-reply, or responding to an already engaged lead)
      const isPriorityReply = !!leadEntry.metadata?.pendingAutoReply || lead.status === 'replied' || lead.status === 'interested';

      try {
        const lastMessages = await db.select()
          .from(messages)
          .where(eq(messages.leadId, lead.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        if (lastMessages.length > 0) {
          const lastMsg = lastMessages[0];
          const meta = (lastMsg.metadata as any) || {};
          
          inReplyTo = lastMsg.externalId || meta.externalId;
          threadId = meta.providerThreadId || meta.threadId;

          if (inReplyTo) {
            const prevRefs = meta.references || "";
            references = prevRefs ? `${prevRefs} ${inReplyTo}` : inReplyTo;
          }
        }
      } catch (threadErr) {
        console.warn(`[OutreachEngine] Failed to fetch threading headers for lead ${lead.id}:`, threadErr);
      }

      await sendEmail(userId, lead.email, body, subject, {
        isRaw: true,
        isHtml: true, // Force HTML for tracking pixel/links
        trackingId: campaign.config?.isManual ? undefined : trackingId,
        campaignId: campaign.id,
        leadId: lead.id,
        integrationId, // Use the rotated mailbox
        allowedIntegrationIds: campaign.config?.mailboxIds,
        isPriorityReply,
        inReplyTo,
        references,
        threadId,
        replyTo: campaign.config?.replyTo
      });
    } catch (sendError: any) {
      const errorMsg = sendError.message || 'Unknown send error';
      console.error(`[OutreachEngine] ❌ Send failed for ${lead.email} via ${integrationId}: ${errorMsg}`);

      // Phase 3 Fix: Rate-Limit Backoff — never hard-fail on a 429 / throttle signal
      const isRateLimit = sendError.status === 429 ||
        /rate.?limit|too many|throttl|quota.*exceeded|daily.*limit/i.test(errorMsg);

      if (isRateLimit) {
        // Exponential retry: back off 30 minutes and try again — DO NOT mark as failed
        const backoffAt = new Date(Date.now() + 30 * 60 * 1000);
        await db.update(campaignLeads)
          .set({
            status: 'pending',
            nextActionAt: backoffAt,
            error: `[Rate-limit backoff] ${errorMsg}`,
            retryCount: sql`${campaignLeads.retryCount} + 1`
          })
          .where(eq(campaignLeads.id, leadEntry.id));
        console.warn(`[OutreachEngine] ⏳ Rate-limited on ${lead.email}. Backing off 30m (retry ${(leadEntry.retryCount || 0) + 1}).`);
      } else if (mailboxHealthService.isMailboxError(errorMsg)) {
        const integration = await storage.getIntegrationById(integrationId);
        if (integration) {
          await mailboxHealthService.handleMailboxFailure(integration, errorMsg);
        }

        // Re-queue the lead so another mailbox can pick it up
        await db.update(campaignLeads)
          .set({ integrationId: null, status: 'queued', error: errorMsg })
          .where(eq(campaignLeads.id, leadEntry.id));
        console.warn(`[OutreachEngine] 🔄 Lead ${lead.email} re-queued after mailbox failure`);
      } else {
        // Hard non-recoverable error (e.g. invalid recipient) — mark as failed
        await db.update(campaignLeads)
          .set({ status: 'failed', error: errorMsg })
          .where(eq(campaignLeads.id, leadEntry.id));
      }
      return; // Stop processing this lead
    }

    // Update lead with integrationId if not already set, to ensure future replies/tracking stay with this mailbox
    if (!lead.integrationId) {
      await db.update(leads)
        .set({ integrationId, updatedAt: new Date() })
        .where(eq(leads.id, lead.id));
    }

    // Recording and state updates
    await storage.createMessage({
      userId,
      leadId: lead.id,
      provider: 'email',
      direction: 'outbound',
      subject,
      body,
      trackingId,
      metadata: { 
        campaignId: campaign.id, 
        step: leadEntry.currentStep, 
        integrationId,
        inReplyTo,
        references,
        providerThreadId: threadId
      }
    });

    // Detailed campaign tracking
    await db.insert(campaignEmails).values({
      campaignId: campaign.id,
      leadId: lead.id,
      userId: userId,
      messageId: trackingId,
      subject,
      body,
      stepIndex: leadEntry.currentStep,
      status: 'sent'
    });

    // Update campaign lead status
    const isAutoReply = !!leadEntry.metadata?.pendingAutoReply;
    const newMetadata = { ...(leadEntry.metadata || {}) };
    if (isAutoReply) delete newMetadata.pendingAutoReply;

    // Track initial send date for relative follow-up scheduling
    if (leadEntry.currentStep === 0 && !isAutoReply && !newMetadata.initialSentAt) {
      newMetadata.initialSentAt = new Date().toISOString();
    }

    const nextStep = isAutoReply ? leadEntry.currentStep : leadEntry.currentStep + 1;
    const followupsArr = (campaign.template as any)?.followups || [];
    const hasMore = nextStep <= followupsArr.length;
    let nextActionAt = null;

    if (hasMore && !isAutoReply) {
      const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
      if (newMetadata.initialSentAt) {
        nextActionAt = new Date(newMetadata.initialSentAt);
        nextActionAt.setDate(nextActionAt.getDate() + delayDays);
      } else {
        nextActionAt = new Date();
        nextActionAt.setDate(nextActionAt.getDate() + delayDays);
      }
    }

    await db.update(campaignLeads)
      .set({
        status: isAutoReply ? 'replied' : 'sent',
        currentStep: nextStep,
        nextActionAt: nextActionAt,
        sentAt: new Date(),
        error: null,
        metadata: newMetadata
      })
      .where(eq(campaignLeads.id, leadEntry.id));

    // Update campaign stats atomically
    // Using jsonb_set with a relative increment is atomic in Postgres
    await db.update(outreachCampaigns)
      .set({
        stats: sql`jsonb_set(
          COALESCE(stats, '{"sent":0,"total":0,"replied":0,"bounced":0}'::jsonb), 
          '{sent}', 
          (COALESCE((stats->>'sent')::int, 0) + 1)::text::jsonb
        )`,
        updatedAt: new Date()
      })
      .where(eq(outreachCampaigns.id, campaign.id));

    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'campaign_sent' });
    wsSync.notifyCampaignStatsUpdated(userId, campaign.id);
    wsSync.notifyInsightsUpdated(userId);
    } finally {
      const { releaseLock } = await import('@shared/lib/redis/redis.js');
      await releaseLock(lockKey);
    }
  }

  /**
   * System 9: Self-Healing Logic
   * Finds leads that have been "Locked" for too long and resets them.
   */
  private async autonomouslyHealZombieLeads(userId: string): Promise<void> {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // Reset stuck campaign leads (join through leads table to filter by userId)
    await db.execute(sql`
      UPDATE campaign_leads cl
      SET status = 'pending', error = '[Auto-Heal] Reset stuck processing state'
      FROM leads l
      WHERE cl.lead_id = l.id
        AND l.user_id = ${userId}
        AND cl.status = 'processing'
        AND cl.next_action_at < ${fifteenMinutesAgo.toISOString()}::timestamp
    `);

    // Reset stuck autonomous leads
    await db.execute(sql`
      UPDATE leads 
      SET metadata = metadata - 'processing_lock_at' - 'processing_worker'
      WHERE user_id = ${userId}
      AND (metadata->>'processing_lock_at')::timestamp < ${fifteenMinutesAgo.toISOString()}::timestamp
    `);
  }

  /**
   * Helper to deliver autonomous outreach
   */
  private async deliverAutonomousOutreach(userId: string, lead: any, integrationId: string): Promise<void> {
    console.log(`[OutreachEngine] Delivering autonomous outreach to ${lead.email} via ${integrationId}`);

    const user = await storage.getUser(userId);
    const businessName = user?.company || user?.businessName || 'Our Team';
    const brandContext = await getBrandContext(userId);
    const threadMessages = await storage.getMessagesByLeadId(lead.id);

    const aiResult = await generateContextAwareMessage(
      lead,
      brandContext,
      [],
      threadMessages
    );

    const subject = (lead.metadata as any)?.outreach_subject || aiResult.subject || `Question for ${lead.name}`;
    const body = aiResult.message;
    const trackingId = Math.random().toString(36).substring(2, 11);

    // PHASE 43: Store A/B variant
    if (aiResult.intelligence.variant) {
      await storage.updateLead(lead.id, {
        metadata: { ...(lead.metadata as any || {}), lastHookVariant: aiResult.intelligence.variant }
      });
    }

    // PHASE 55: Optimization - Shift to Optimal Hour
    const optimalHour = (lead.metadata as any)?.optimalHour || 10; // Default to 10am
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(optimalHour, Math.floor(Math.random() * 60), 0, 0);
    
    // If the optimal time has passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    console.log(`🕒 [OutreachEngine] Scheduling initial outreach for ${lead.name} at ${nextRun.toLocaleTimeString()} (Optimal Hour: ${optimalHour})`);

    await this.deliverOutreach({
      lead,
      userId,
      subject: subject,
      body: body,
      channel: lead.channel,
      scheduledAt: nextRun,
      integrationId
    });
  }

  /**
   * Helper to deliver autonomous Instagram outreach
   */
  private async deliverOutreach(params: {
    lead: any;
    userId: string;
    subject: string;
    body: string;
    channel: string;
    scheduledAt?: Date;
    integrationId?: string;
  }) {
    const { lead, userId, subject, body, channel, scheduledAt, integrationId } = params;

    // [PHASE 90] CLUSTER SAFETY: Prevent race conditions in horizontal scaling
    const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
    const lockKey = `outreach:lock:${lead.id}`;
    const lockAcquired = await acquireLock(lockKey, 600); // 10-minute lock (Phase 7: extended for autonomous outreach path)
    
    if (!lockAcquired) {
      console.log(`[Safety] Lead ${lead.id} is already being processed by another worker node. Skipping.`);
      return;
    }
    
    if (scheduledAt && scheduledAt > new Date()) {
      await storage.updateLead(lead.id, {
        metadata: { ...(lead.metadata as any || {}), scheduledAt: scheduledAt.toISOString() }
      });
      return;
    }

    try {
      if (channel === 'instagram') {
        await sendInstagramOutreach(userId, (lead.metadata as any)?.instagramId || lead.externalId, body);
      } else {
        // [PHASE 60] ADVANCED REAL-TIME EMAIL VERIFICATION (DeBounce-style)
        const { verifyEmailAddress } = await import("@services/email-service/src/email/email-address-verification.js");
        const verification = await verifyEmailAddress(lead.email);
        
        if (!verification.isValid) {
          console.warn(`[OutreachEngine] 🛡️ REJECTED autonomous lead ${lead.email}: ${verification.reason}`);
          await db.update(leads)
            .set({ status: 'bouncy', metadata: { ...(lead.metadata as any || {}), bounce_reason: verification.reason } })
            .where(eq(leads.id, lead.id));
          return;
        }

        await sendEmail(userId, lead.email, body, subject, {
          isRaw: true,
          isHtml: true,
          leadId: lead.id,
          integrationId
        });
      }
    } catch (sendError: any) {
      const errorMsg = sendError.message || 'Unknown send error';
      console.error(`[OutreachEngine] ❌ Autonomous send failed for ${lead.email || lead.id}: ${errorMsg}`);
      return;
    } finally {
      const { releaseLock } = await import('@shared/lib/redis/redis.js');
      await releaseLock(lockKey);
    }

    await storage.createMessage({
      userId,
      leadId: lead.id,
      provider: channel as "email" | "instagram" | "gmail" | "system",
      direction: 'outbound',
      subject,
      body,
      metadata: { autonomous: true, integrationId }
    });

    await storage.updateLead(lead.id, {
      status: 'open',
      lastMessageAt: new Date(),
      metadata: {
        ...(lead.metadata as Record<string, any>),
        outreach_sent: true,
        outreach_at: new Date().toISOString()
      }
    });

    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'autonomous_sent' });
    wsSync.notifyInsightsUpdated(userId);
  }

  /**
   * Helper to deliver campaign Instagram message
   */
  private async deliverCampaignInstagram(userId: string, campaign: any, lead: any, leadEntry: any): Promise<void> {
    const instagramId = (lead.metadata as any)?.instagramId || lead.externalId;
    if (!instagramId) {
      throw new Error(`No Instagram ID found for lead ${lead.id}`);
    }

    console.log(`[OutreachEngine] Delivering IG campaign "${campaign.name}" step ${leadEntry.currentStep} to ${lead.name}`);

    // Generate content
    const aiContent = await generateExpertOutreach(lead, userId);
    let body = aiContent.body;

    if (leadEntry.currentStep > 0) {
      const followups = (campaign.template as any)?.followups || [];
      const fuConfig = followups[leadEntry.currentStep - 1];
      if (fuConfig) {
        body = fuConfig.body;
        // Phase 5: AI Dynamic Copy Adjustment
        if (campaign.config?.aiAdjustCopy) {
           try {
             const recentInbound = await db.select().from(messages).where(and(eq(messages.leadId, lead.id), eq(messages.direction, 'inbound'))).orderBy(desc(messages.createdAt)).limit(1);
             if (recentInbound.length > 0) {
                const { generateReply } = await import("@services/brain-worker/src/ai-lib/core/ai-service.js");
                const adjusted = await generateReply(
                   `STRICT GUARDRAIL: Only rewrite the planned message if the lead's reply contradicts or requires a direct acknowledgment (e.g., negative response, specific question, different intent). If the lead's reply is just a simple acknowledgment or doesn't necessitate changing the core message, return the original message exactly as is. DO NOT hallucinate a completely new follow-up or skip to a different topic. ONLY adjust the provided message: "${body}" to incorporate context from the lead's reply: "${recentInbound[0].body}". Keep it concise, professional, and matching the original tone.`,
                   "Rewrite the follow-up.",
                   { temperature: 0.7, nga1Enforced: true }
                );
                if (adjusted && adjusted.text) {
                   body = adjusted.text;
                   console.log(`[OutreachEngine] AI Adjusted Instagram follow-up copy for lead ${lead.id}`);
                }
             }
           } catch (adjErr) {
             console.error(`[OutreachEngine] AI Copy Adjustment failed for lead ${lead.id}:`, adjErr);
           }
        }
      }
    }

    // Variable replacement
    const firstName = lead.name?.trim().split(' ')[0] || 'there';
    body = body.replace(/{{firstName}}/g, firstName).replace(/{{lead_name}}/g, lead.name?.trim() || firstName);

    // Send Instagram DM
    await sendInstagramOutreach(userId, instagramId, body);

    // Recording and state updates
    await storage.createMessage({
      userId,
      leadId: lead.id,
      provider: 'instagram',
      direction: 'outbound',
      body,
      metadata: { campaignId: campaign.id, step: leadEntry.currentStep }
    });

    // Update campaign lead status
    const nextStep = leadEntry.currentStep + 1;
    const followupsArr = (campaign.template as any)?.followups || [];
    const hasMore = nextStep <= followupsArr.length;
    let nextActionAt = null;

    if (hasMore) {
      const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
      nextActionAt = new Date();
      nextActionAt.setDate(nextActionAt.getDate() + delayDays);
    }

    await db.update(campaignLeads)
      .set({
        status: 'sent',
        currentStep: nextStep,
        nextActionAt: nextActionAt,
        sentAt: new Date(),
        error: null
      })
      .where(eq(campaignLeads.id, leadEntry.id));

    // Update stats atomically
    await db.update(outreachCampaigns)
      .set({
        stats: sql`jsonb_set(
          COALESCE(stats, '{"sent":0,"total":0,"replied":0,"bounced":0}'::jsonb), 
          '{sent}', 
          (COALESCE((stats->>'sent')::int, 0) + 1)::text::jsonb
        )`,
        updatedAt: new Date()
      })
      .where(eq(outreachCampaigns.id, campaign.id));

    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'campaign_sent' });
    wsSync.notifyCampaignStatsUpdated(userId, campaign.id);
    wsSync.notifyInsightsUpdated(userId);
  }

  /**
   * Helper to deliver autonomous Instagram outreach
   */
  private async deliverAutonomousInstagram(userId: string, lead: any): Promise<void> {
    const instagramId = (lead.metadata as any)?.instagramId || lead.externalId;
    if (!instagramId) return;

    console.log(`[OutreachEngine] Delivering autonomous IG outreach to ${lead.name}`);

    const aiContent = await generateExpertOutreach(lead, userId);


    await storage.createMessage({
      userId,
      leadId: lead.id,
      provider: 'instagram',
      direction: 'outbound',
      body: aiContent.body,
      metadata: { autonomous: true }
    });

    await storage.updateLead(lead.id, {
      status: 'open',
      lastMessageAt: new Date(),
      metadata: {
        ...(lead.metadata as Record<string, any>),
        outreach_sent: true,
        outreach_at: new Date().toISOString()
      }
    });

    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'autonomous_sent' });
    wsSync.notifyStatsUpdated(userId);
    wsSync.notifyInsightsUpdated(userId);
  }

  /**
   * Phase 46: Self-Healing Redistribution
   * Re-assigns leads from unhealthy or paused mailboxes to healthy ones.
   */
  private async selfHealMailboxDistribution(userId: string): Promise<void> {
    const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
    const lockKey = `self-healing:user:${userId}`;
    const lockAcquired = await acquireLock(lockKey, 300); // 5-minute lock
    
    if (!lockAcquired) return;

    try {
      const integrationsList = await storage.getIntegrations(userId);
      const unhealthyMailboxes = integrationsList.filter(i => 
        ['gmail', 'outlook', 'custom_email'].includes(i.provider) && 
        (i.warmupStatus === 'paused' || (i.reputationScore !== null && i.reputationScore < 65))
      );

      if (unhealthyMailboxes.length === 0) return;

      const healthyMailboxes = integrationsList.filter(i => 
        ['gmail', 'outlook', 'custom_email'].includes(i.provider) && 
        i.connected && 
        i.warmupStatus !== 'paused' && 
        (i.reputationScore === null || i.reputationScore >= 75)
      );

      if (healthyMailboxes.length === 0) {
        console.warn(`[Self-Healing] No healthy mailboxes available for redistribution for user ${userId}`);
        return;
      }

      for (const unhealthy of unhealthyMailboxes) {
        // Find leads assigned to this unhealthy mailbox
        const leadsToHeal = await db.select()
          .from(leads)
          .where(and(
            eq(leads.userId, userId),
            eq(leads.status, 'new'),
            sql`${leads.metadata}->>'integrationId' = ${unhealthy.id}`
          ))
          .limit(50);

        if (leadsToHeal.length === 0) continue;

        console.log(`🛡️ [Self-Healing] Redistributing ${leadsToHeal.length} leads from unhealthy mailbox ${unhealthy.id}`);

        for (let i = 0; i < leadsToHeal.length; i++) {
          const targetMailbox = healthyMailboxes[i % healthyMailboxes.length];
          await storage.updateLead(leadsToHeal[i].id, {
            metadata: {
              ...(leadsToHeal[i].metadata as any || {}),
              integrationId: targetMailbox.id,
              healedAt: new Date().toISOString(),
              previousIntegrationId: unhealthy.id
            }
          });
        }
      }
    } catch (error) {
      console.error("[Self-Healing] Redistribution error:", error);
    } finally {
      await releaseLock(lockKey);
    }
  }

  /**
   * System 10: Process a specific BullMQ job (Priority/Standard)
   */
  public async processJob(job: any): Promise<void> {
    const { userId, leadId, integrationId, isAutonomous } = job.data;
    if (!userId || !leadId) return;

    console.log(`🚀 [Priority Processor] Processing ${job.name} for lead ${leadId}`);
    
    // Fetch integration if not provided
    let targetIntegration = integrationId;
    if (!targetIntegration) {
      const lead = await storage.getLeadById(leadId);
      targetIntegration = lead?.integrationId;
    }

    const integration = await storage.getIntegrationById(targetIntegration || '');
    if (integration) {
      await this.processUserOutreach(userId, integration as any, isAutonomous);
    }
  }

  /**
   * System 11: Global SLA Pulse Sweep
   * Scans for leads that need a "High-Status" check-in after 14 days of silence.
   */
  public async performGlobalPulseSweep(): Promise<void> {
    console.log("🌊 [Pulse Sweep] Starting global 12-hour background sweep...");
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    
    // Find leads in 'sent' status who haven't moved in 14 days
    const staleLeads = await db.select().from(leads).where(and(
      eq(leads.status, 'cold'),
      lte(leads.updatedAt, fourteenDaysAgo)
    ));

    console.log(`🌊 [Pulse Sweep] Found ${staleLeads.length} stale leads. Triggering High-Status resurrections.`);

    for (const lead of staleLeads) {
      // Push back to the front of the queue for a Bespoke AI Pulse
      await db.update(leads)
        .set({ status: 'new', updatedAt: new Date() })
        .where(eq(leads.id, lead.id));
    }
  }
}

export const outreachEngine = new OutreachEngine();

/**
 * Triggers automatic outreach for all leads with 'new' or 'hardened' status
 * that haven't been contacted yet.
 */
export async function triggerAutoOutreach(userId: string): Promise<void> {
  try {
    const { scheduleInitialFollowUp } = await import("@services/brain-worker/src/ai-lib/core/follow-up-worker.js");

    const [newLeads, hardenedLeads] = await Promise.all([
      storage.getLeads({ userId, status: 'new' }),
      storage.getLeads({ userId, status: 'hardened' })
    ]);

    const allLeads = [...newLeads, ...hardenedLeads];
    console.log(`[AutoOutreach] Found ${allLeads.length} leads for user ${userId} to trigger outreach.`);

    for (const lead of allLeads) {
      if (!lead.aiPaused) {
        await scheduleInitialFollowUp(userId, lead.id, lead.channel);
      }
    }
  } catch (error) {
    console.error('[AutoOutreach] Error triggering auto-outreach:', error);
  }
}

/**
 * Distributes leads from the global Lead Inventory pool to available mailboxes.
 */
export async function distributeLeadsFromPool(userId: string, targetIntegrationId?: string): Promise<void> {
  // Phase 7: Guard — userId must be valid before any queries run
  if (!userId || typeof userId !== 'string') {
    console.warn('[LeadPool] distributeLeadsFromPool called with invalid userId. Aborting.');
    return;
  }

  try {
    console.log(`[LeadPool] Starting professional distribution for user ${userId}`);

    // Phase 7 Guard: Only distribute if user has at least one active campaign.
    // Prevents wasting DB queries and incorrectly assigning leads when there is
    // nothing to process (e.g. on a fresh mailbox connect with no campaign).
    const activeCampaigns = await db
      .select({ id: outreachCampaigns.id })
      .from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.userId, userId), eq(outreachCampaigns.status, 'active')))
      .limit(1);

    if (activeCampaigns.length === 0) {
      console.log(`[LeadPool] No active campaigns for user ${userId}. Skipping pool distribution.`);
      return;
    }

    const integrationsList = await storage.getIntegrations(userId);
    const activeMailboxes = integrationsList.filter(i => i.connected);

    if (activeMailboxes.length === 0) {
      console.log(`[LeadPool] No active mailboxes found for user ${userId}.`);
      return;
    }

    const inventoryLeads = await db.select()
      .from(leads)
      .where(and(eq(leads.userId, userId), isNull(leads.integrationId)));

    if (inventoryLeads.length === 0) return;

    let poolIndex = 0;
    let totalDistributed = 0;

    for (const mb of activeMailboxes) {
      if (poolIndex >= inventoryLeads.length) break;
      if (targetIntegrationId && mb.id !== targetIntegrationId) continue;

      const lead = inventoryLeads[poolIndex];
      await storage.updateLead(lead.id, { integrationId: mb.id });
      poolIndex++;
      totalDistributed++;
    }

    console.log(`[LeadPool] Distributed ${totalDistributed} leads.`);
  } catch (error) {
    console.error('[LeadPool] Error distributing leads:', error);
  }
}







