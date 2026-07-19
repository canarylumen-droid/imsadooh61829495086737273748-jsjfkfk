import { connectMySql, ensureTables } from "@shared/lib/mysql.js";
import {
  getPendingSyncStates,
  claimMailboxForSync,
  completeMailboxSync,
  failMailboxSync,
  recoverStaleBusyState,
  upsertRecoveredLead,
  upsertRecoveryObjection,
} from "@shared/lib/mysql.js";
import { storage } from "@shared/lib/storage/storage.js";
import { analyzeRecoveryEmail } from "./agent.js";
import { checkDeliverability } from "./deliverability.js";
import { shouldFilterEmail } from "./filter.js";
import { fetchRecoveryEmails, type RecoveryEmail } from "./mailbox.js";
import { logRecoveryEvent } from "./events.js";

const EMAIL_PROVIDERS = new Set(["custom_email", "gmail", "outlook"]);

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export class LeadRecoveryWorker {
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;
  private lastDbWarningAt = 0;
  private dbRetryCount = 0;
  private mysqlSkipped = false;
  private readonly dbWarningIntervalMs = readInt("LEAD_RECOVERY_MONGO_WARNING_INTERVAL_MS", 300_000);

  async start() {
    this.running = true;
    console.log("[LeadRecoveryWorker] Started (event-driven mode — no polling)");

    // Process any pending sync requests that were queued while we were offline
    await this.runOnce();

    // Subscribe to sync-requested events via Redis Pub/Sub.
    // When the user clicks "Sync" in the UI, the API publishes an event
    // and the worker processes it immediately — no polling needed.
    try {
      const { subscribe } = await import('@services/event-bus/src/redis-pubsub.js');
      subscribe('lead-recovery:sync-requested', async (msg: any) => {
        const { tenantId, mailboxId } = msg || {};
        if (!tenantId) return;
        console.log(`[LeadRecoveryWorker] ⚡ Sync requested for tenant ${tenantId}`);
        await this.processState(String(tenantId), mailboxId ? String(mailboxId) : undefined);
      });
      console.log("[LeadRecoveryWorker] ✅ Subscribed to lead-recovery:sync-requested");
    } catch (err) {
      console.warn("[LeadRecoveryWorker] Redis Pub/Sub unavailable — will rely on manual triggers only");
    }
  }

  async stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
  }

  async runOnce() {
    if (!this.running || this.processing) return;
    if (this.mysqlSkipped) return;
    this.processing = true;
    try {
      const ready = await this.ensureDbReady();
      if (!ready) return;

      this.dbRetryCount = 0;

      const staleCutoff = new Date(Date.now() - 15 * 60 * 1000); // 15 min stale threshold
      const states = await getPendingSyncStates();
      for (const state of states) {
        // Stale detection: if isBusy is true but updatedAt is older than 15 min,
        // the worker likely crashed — reset isBusy so it can be picked up again.
        if (state.isBusy) {
          if (state.updatedAt && new Date(state.updatedAt).getTime() < staleCutoff.getTime()) {
            console.log(`[LeadRecoveryWorker] ⚠️ Recovering stale isBusy state for ${state.tenantId}/${state.mailboxId}`);
            await recoverStaleBusyState(state.id);
          } else {
            continue; // Still within grace period — skip
          }
        }
        await this.processState(String(state.tenantId), state.mailboxId ? String(state.mailboxId) : undefined);
      }
    } finally {
      this.processing = false;
    }
  }

  private async ensureDbReady(): Promise<boolean> {
    try {
      await connectMySql();
      await ensureTables();
      return true;
    } catch (error) {
      this.warnDbUnavailable(error);
      return false;
    }
  }

  private warnDbUnavailable(error: unknown): void {
    this.dbRetryCount++;
    if (this.dbRetryCount >= 3) {
      this.mysqlSkipped = true;
      console.error("[LeadRecoveryWorker] MySQL unavailable after 3 retries — permanently skipping DB work. Update MYSQL_HOST and related env vars to re-enable.");
      return;
    }

    const now = Date.now();
    if (now - this.lastDbWarningAt < this.dbWarningIntervalMs) return;

    this.lastDbWarningAt = now;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[LeadRecoveryWorker] MySQL unavailable (attempt ${this.dbRetryCount}/3); worker will retry`, {
      error: message,
      retryInMs: this.dbWarningIntervalMs,
    });
  }

  private async processState(tenantId: string, mailboxId?: string) {
    // SAFETY GUARD: Only run lead recovery for tenants with active campaigns.
    // This prevents unnecessary IMAP connections and AI analysis when
    // there are no campaigns running (consistent with outreach-engine pattern).
    try {
      const { db } = await import('@shared/lib/db/db.js');
      const { outreachCampaigns } = await import('@audnix/shared');
      const { eq, and } = await import('drizzle-orm');
      const activeCampaigns = await db.select({ id: outreachCampaigns.id })
        .from(outreachCampaigns)
        .where(and(eq(outreachCampaigns.userId, tenantId), eq(outreachCampaigns.status, 'active')))
        .limit(1);
      if (activeCampaigns.length === 0) {
        return; // No active campaigns — skip recovery for this tenant
      }
    } catch {
      return; // DB unavailable — skip gracefully
    }

    const integrations = await storage.getIntegrations(tenantId);
    const candidates = integrations.filter((integration) =>
      integration.connected &&
      EMAIL_PROVIDERS.has(integration.provider) &&
      (!mailboxId || integration.id === mailboxId)
    );

    for (const integration of candidates) {
      await this.processMailbox(tenantId, integration.id);
    }
  }

  private async processMailbox(tenantId: string, mailboxId: string) {
    const integration = await storage.getIntegrationById(mailboxId);
    if (!integration || integration.userId !== tenantId || !EMAIL_PROVIDERS.has(integration.provider)) return;

    const maxMessages = Number(process.env.LEAD_RECOVERY_MAX_MESSAGES_PER_MAILBOX || 500);
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    let claimedState: any;
    try {
      claimedState = await claimMailboxForSync(tenantId, mailboxId);
    } catch {
      console.warn(`[LeadRecovery] MySQL unavailable for claimMailboxForSync (${mailboxId}), skipping`);
      return;
    }

    if (!claimedState) return;

    try { await logRecoveryEvent(tenantId, "SyncStarted", { mailboxId, syncWindowDays: 90, readOnlySync: true }); } catch {}

    try {
      const emails = await fetchRecoveryEmails(integration, since, maxMessages);
      let analyzed = 0;
      let filtered = 0;

      for (const email of emails) {
        const filter = shouldFilterEmail(email);
        if (filter.filtered) {
          filtered += 1;
          try { await logRecoveryEvent(tenantId, "EmailFiltered", { mailboxId, uid: email.uid, reason: filter.reason }); } catch {}
          continue;
        }

        await this.analyzeAndStore(tenantId, integration, email);
        analyzed += 1;
      }

      try { await completeMailboxSync(tenantId, mailboxId); } catch {}
      try { await logRecoveryEvent(tenantId, "SyncCompleted", { mailboxId, fetched: emails.length, analyzed, filtered }); } catch {}
    } catch (error: any) {
      try { await failMailboxSync(tenantId, mailboxId); } catch {}
      try { await logRecoveryEvent(tenantId, "SyncFailed", { mailboxId, error: error.message }); } catch {}
    }
  }

  private async analyzeAndStore(tenantId: string, integration: NonNullable<Awaited<ReturnType<typeof storage.getIntegrationById>>>, email: RecoveryEmail) {
    const mailboxId = integration.id;
    const leadEmail = email.from || email.to[0];
    if (!leadEmail) return;

    // SAFETY GUARD: Skip leads that are already part of an active campaign.
    // Lead recovery must NOT interfere with leads currently being handled.
    try {
      const { db } = await import('@shared/lib/db/db.js');
      const { leads, campaignLeads, outreachCampaigns } = await import('@audnix/shared');
      const { eq, and } = await import('drizzle-orm');
      const inActiveCampaign = await db.select({ id: leads.id })
        .from(leads)
        .innerJoin(campaignLeads, eq(campaignLeads.leadId, leads.id))
        .innerJoin(outreachCampaigns, eq(outreachCampaigns.id, campaignLeads.campaignId))
        .where(and(
          eq(leads.email, leadEmail.toLowerCase()),
          eq(leads.userId, tenantId),
          eq(outreachCampaigns.status, 'active')
        ))
        .limit(1);
      if (inActiveCampaign.length > 0) {
        await logRecoveryEvent(tenantId, "SkippedInActiveCampaign", { mailboxId, email: leadEmail });
        return; // Lead is being handled by an active campaign — skip recovery
      }
    } catch {
      // DB unavailable — skip the guard gracefully
    }

    // Fetch full conversation history so the AI knows exactly where the conversation left off.
    // This provides context beyond just the latest email — e.g., previous replies, objections,
    // booking intent, etc. that were exchanged before the conversation went cold.
    let conversationContext = '';
    try {
      const { db } = await import('@shared/lib/db/db.js');
      const { leads: leadsTable, messages } = await import('@audnix/shared');
      const { eq, and, desc } = await import('drizzle-orm');
      const [leadRecord] = await db.select({ id: leadsTable.id })
        .from(leadsTable)
        .where(and(eq(leadsTable.email, leadEmail.toLowerCase()), eq(leadsTable.userId, tenantId)))
        .limit(1);
      if (leadRecord) {
        const threadMessages = await db.select({ direction: messages.direction, body: messages.body, createdAt: messages.createdAt })
          .from(messages)
          .where(eq(messages.leadId, leadRecord.id))
          .orderBy(desc(messages.createdAt))
          .limit(20);
        if (threadMessages.length > 0) {
          conversationContext = threadMessages.reverse().map(m =>
            `[${m.direction.toUpperCase()} at ${m.createdAt?.toISOString?.() || 'unknown'}]: ${(m.body || '').slice(0, 500)}`
          ).join('\n');
        }
      }
    } catch {
      // Non-critical — proceed without context if DB unavailable
    }

    // Enrich the email object with conversation history for the AI
    const enrichedEmail = {
      ...email,
      threadHistory: conversationContext || undefined,
    };

    const deliverabilityStatus = await checkDeliverability(leadEmail);
    await logRecoveryEvent(tenantId, "DeliverabilityChecked", { mailboxId, email: leadEmail, deliverabilityStatus });

    const analysis = await analyzeRecoveryEmail(tenantId, enrichedEmail);

    const sourceMessageId = email.messageId || `${mailboxId}:${email.uid}`;
    const lead = await upsertRecoveredLead(tenantId, mailboxId, leadEmail.toLowerCase(), {
      sourceMailboxProvider: integration.provider,
      sourceMailboxAccountType: integration.accountType ?? undefined,
      subject: email.subject,
      intent: analysis.intent,
      deliverabilityStatus,
      followUpDraft: analysis.followUpDraft,
      conversationSummary: `Latest inbound message in ${integration.accountType || integration.provider} stopped at: ${email.subject || "No subject"}`,
      lastMessageText: email.text.slice(0, 8000),
      lastMessageAt: email.date || new Date(),
      sourceMessageIds: [sourceMessageId],
      brainstormedObjections: analysis.brainstormedObjections,
    });

    if (!lead) return;

    await logRecoveryEvent(tenantId, "LeadAnalyzed", {
      mailboxId,
      leadId: String(lead.id),
      email: leadEmail,
      intent: analysis.intent,
    });

    for (const objection of analysis.brainstormedObjections) {
      await upsertRecoveryObjection(
        tenantId,
        objection.rule,
        objection.category,
        objection.evidence,
        lead.id
      );
      await logRecoveryEvent(tenantId, "ObjectionDiscovered", {
        leadId: String(lead.id),
        category: objection.category,
        rule: objection.rule,
      });
    }

    if (analysis.followUpDraft) {
      await logRecoveryEvent(tenantId, "DraftGenerated", { leadId: String(lead.id), source: "worker" });
    }
  }
}
