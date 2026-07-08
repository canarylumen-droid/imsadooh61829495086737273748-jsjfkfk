import { connectMongo } from "@shared/lib/mongo.js";
import {
  LeadRecoveryObjection,
  LeadRecoveryState,
  RecoveredLead,
} from "@shared/lib/models/lead-recovery.js";
import { storage } from "@shared/lib/storage/storage.js";
import { analyzeRecoveryEmail, ensurePromptConfigFromEnv } from "./agent.js";
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
  private promptReady = false;
  private lastMongoWarningAt = 0;
  private mongoRetryCount = 0;
  private mongoSkipped = false;
  private readonly mongoWarningIntervalMs = readInt("LEAD_RECOVERY_MONGO_WARNING_INTERVAL_MS", 300_000);

  async start() {
    this.running = true;
    console.log("[LeadRecoveryWorker] Started");
    await this.runOnce();
    const pollMs = Number(process.env.LEAD_RECOVERY_WORKER_POLL_MS || 5 * 60 * 1000);
    this.interval = setInterval(() => {
      this.runOnce().catch((error) => console.error("[LeadRecoveryWorker] Cycle failed", error));
    }, pollMs);
  }

  async stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
  }

  async runOnce() {
    if (!this.running || this.processing) return;
    if (this.mongoSkipped) return;
    this.processing = true;
    try {
      const ready = await this.ensureMongoReady();
      if (!ready) return;

      this.mongoRetryCount = 0;

      const states = await LeadRecoveryState.find({
        isActive: true,
        syncRequestedAt: { $ne: null },
        $expr: {
          $or: [
            { $eq: ["$lastSyncAt", null] },
            { $gt: ["$syncRequestedAt", "$lastSyncAt"] },
          ],
        },
      }).lean();
      for (const state of states) {
        if (state.isBusy) continue;
        await this.processState(String(state.tenantId), state.mailboxId ? String(state.mailboxId) : undefined);
      }
    } finally {
      this.processing = false;
    }
  }

  private async ensureMongoReady(): Promise<boolean> {
    try {
      await connectMongo();
      if (!this.promptReady) {
        await ensurePromptConfigFromEnv();
        this.promptReady = true;
      }
      return true;
    } catch (error) {
      this.warnMongoUnavailable(error);
      return false;
    }
  }

  private warnMongoUnavailable(error: unknown): void {
    this.mongoRetryCount++;
    if (this.mongoRetryCount >= 3) {
      this.mongoSkipped = true;
      console.error("[LeadRecoveryWorker] MongoDB unavailable after 3 retries — permanently skipping MongoDB work. Update MONGODB_URI or MONGO_URL in .env to re-enable.");
      return;
    }

    const now = Date.now();
    if (now - this.lastMongoWarningAt < this.mongoWarningIntervalMs) return;

    this.lastMongoWarningAt = now;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[LeadRecoveryWorker] MongoDB unavailable (attempt ${this.mongoRetryCount}/3); worker will retry`, {
      error: message,
      retryInMs: this.mongoWarningIntervalMs,
    });
  }

  private async processState(tenantId: string, mailboxId?: string) {
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

    const claimedState = await LeadRecoveryState.findOneAndUpdate(
      {
        tenantId,
        mailboxId,
        isActive: true,
        isBusy: { $ne: true },
        syncRequestedAt: { $ne: null },
        $expr: {
          $or: [
            { $eq: ["$lastSyncAt", null] },
            { $gt: ["$syncRequestedAt", "$lastSyncAt"] },
          ],
        },
      },
      { isBusy: true, syncStatus: "syncing" },
      { new: true }
    ).lean();

    if (!claimedState) return;

    await logRecoveryEvent(tenantId, "SyncStarted", { mailboxId, syncWindowDays: 90, readOnlySync: true });

    try {
      const emails = await fetchRecoveryEmails(integration, since, maxMessages);
      let analyzed = 0;
      let filtered = 0;

      for (const email of emails) {
        const filter = shouldFilterEmail(email);
        if (filter.filtered) {
          filtered += 1;
          await logRecoveryEvent(tenantId, "EmailFiltered", { mailboxId, uid: email.uid, reason: filter.reason });
          continue;
        }

        await this.analyzeAndStore(tenantId, integration, email);
        analyzed += 1;
      }

      await LeadRecoveryState.updateOne(
        { tenantId, mailboxId },
        { isBusy: false, availableAt: null, lastSyncAt: new Date(), syncStatus: "completed" },
        { upsert: true }
      );
      await logRecoveryEvent(tenantId, "SyncCompleted", { mailboxId, fetched: emails.length, analyzed, filtered });
    } catch (error: any) {
      await LeadRecoveryState.updateOne(
        { tenantId, mailboxId },
        { isBusy: false, syncStatus: "failed", availableAt: new Date(Date.now() + 60 * 60 * 1000) },
        { upsert: true }
      );
      await logRecoveryEvent(tenantId, "SyncFailed", { mailboxId, error: error.message });
    }
  }

  private async analyzeAndStore(tenantId: string, integration: NonNullable<Awaited<ReturnType<typeof storage.getIntegrationById>>>, email: RecoveryEmail) {
    const mailboxId = integration.id;
    const leadEmail = email.from || email.to[0];
    if (!leadEmail) return;

    const deliverabilityStatus = await checkDeliverability(leadEmail);
    await logRecoveryEvent(tenantId, "DeliverabilityChecked", { mailboxId, email: leadEmail, deliverabilityStatus });

    const analysis = await analyzeRecoveryEmail(tenantId, email);

    const sourceMessageId = email.messageId || `${mailboxId}:${email.uid}`;
    const lead = await RecoveredLead.findOneAndUpdate(
      { tenantId, mailboxId, email: leadEmail.toLowerCase() },
      {
        $set: {
          tenantId,
          mailboxId,
          sourceMailboxSnapshot: {
            provider: integration.provider,
            accountType: integration.accountType,
          },
          email: leadEmail.toLowerCase(),
          subject: email.subject,
          intent: analysis.intent,
          deliverabilityStatus,
          followUpDraft: analysis.followUpDraft,
          conversationSummary: `Latest inbound message in ${integration.accountType || integration.provider} stopped at: ${email.subject || "No subject"}`,
          lastMessageText: email.text.slice(0, 8000),
          lastMessageAt: email.date || new Date(),
        },
        $addToSet: {
          sourceMessageIds: sourceMessageId,
          brainstormedObjections: { $each: analysis.brainstormedObjections },
        },
      },
      { upsert: true, new: true }
    );

    await logRecoveryEvent(tenantId, "LeadAnalyzed", {
      mailboxId,
      leadId: String(lead._id),
      email: leadEmail,
      intent: analysis.intent,
    });

    for (const objection of analysis.brainstormedObjections) {
      await LeadRecoveryObjection.updateOne(
        { tenantId, rule: objection.rule },
        {
          $setOnInsert: {
            tenantId,
            category: objection.category,
            rule: objection.rule,
            evidence: objection.evidence,
            sourceLeadId: lead._id,
            createdBy: "ai",
          },
        },
        { upsert: true }
      );
      await logRecoveryEvent(tenantId, "ObjectionDiscovered", {
        leadId: String(lead._id),
        category: objection.category,
        rule: objection.rule,
      });
    }

    if (analysis.followUpDraft) {
      await logRecoveryEvent(tenantId, "DraftGenerated", { leadId: String(lead._id), source: "worker" });
    }
  }
}
