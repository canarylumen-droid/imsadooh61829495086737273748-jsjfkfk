import { Router } from "express";
import { connectMongo, hasMongoUri } from "@shared/lib/mongo.js";
import {
  LeadRecoveryObjection,
  LeadRecoveryState,
  RecoveredLead,
  RecoveryEventLog,
  RecoveryPromptConfig,
} from "@shared/lib/models/lead-recovery.js";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuthOrApiKey } from "../middleware/auth.js";
import { requireProPlan } from "../middleware/plan.js";
import { recoveryEvents } from "../lib/events.js";
import { checkMailboxCampaignStatus } from "../services/lead-recovery-mailbox.js";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";

const router = Router();
const EMAIL_PROVIDERS = new Set(["custom_email", "gmail", "outlook"]);
const SKIP_WARNING =
  "If you skip this now, you may not be able to activate Lead Recovery until this campaign is finished and mailboxes are free again. However, we will notify you when the campaign completes so you can activate it then.";

router.use(requireAuthOrApiKey, requireProPlan);

router.use(async (_req, res, next) => {
  if (!hasMongoUri()) {
    return res.status(503).json({
      error: "MongoDB unavailable",
      message: "MONGODB_URI is required before Lead Recovery can be used.",
    });
  }

  try {
    await connectMongo();
    next();
  } catch (error: any) {
    res.status(503).json({ error: "MongoDB connection failed", message: error.message });
  }
});

function tenantIdFrom(req: Express.Request): string {
  return req.user?.id || req.session?.userId || "";
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    if (!(key in values) || values[key] === "") {
      console.warn(`[LeadRecovery] Unresolved template variable: {{${key}}}`);
    }
    return values[key] || "";
  });
}

async function getMailboxDetails(tenantId: string) {
  const integrations = await storage.getIntegrations(tenantId);
  const mailboxes = integrations.filter((integration) => EMAIL_PROVIDERS.has(integration.provider) && integration.connected);
  const states = await LeadRecoveryState.find({ tenantId }).lean();
  const stateByMailbox = new Map(states.map((state) => [state.mailboxId, state]));

  return Promise.all(
    mailboxes.map(async (mailbox) => {
      const status = await checkMailboxCampaignStatus(tenantId, mailbox.id);
      const state = stateByMailbox.get(mailbox.id);
      return {
        id: mailbox.id,
        provider: mailbox.provider,
        accountType: mailbox.accountType,
        healthStatus: mailbox.healthStatus,
        reputationScore: mailbox.reputationScore,
        isBusy: status.isBusy,
        availableAt: status.availableAt?.toISOString() || null,
        activeCampaignIds: status.activeCampaignIds,
        isRecoveryActive: Boolean(state?.isActive),
        lastSyncAt: state?.lastSyncAt?.toISOString?.() || null,
        syncRequestedAt: state?.syncRequestedAt?.toISOString?.() || null,
        syncStatus: state?.syncStatus || "idle",
      };
    })
  );
}

async function getConnectedEmailMailboxes(tenantId: string) {
  const integrations = await storage.getIntegrations(tenantId);
  return integrations.filter((integration) => EMAIL_PROVIDERS.has(integration.provider) && integration.connected);
}

router.get("/status", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const mailboxDetails = await getMailboxDetails(tenantId);
  const hasAvailableMailbox = mailboxDetails.some((mailbox) => !mailbox.isBusy);
  const state = await LeadRecoveryState.findOne({ tenantId, isActive: true }).sort({ updatedAt: -1 }).lean();
  const promptConfigured = Boolean(await RecoveryPromptConfig.exists({ name: "email-lead-recovery" }));
  const firstAvailableAt = mailboxDetails
    .map((mailbox) => mailbox.availableAt)
    .filter(Boolean)
    .sort()[0] || null;

  recoveryEvents.emitRecovery({
    tenantId,
    action: "MailboxStatusChecked",
    payload: { hasAvailableMailbox, mailboxCount: mailboxDetails.length },
  });

  res.json({
    isActive: Boolean(state?.isActive),
    hasAvailableMailbox,
    availableAt: hasAvailableMailbox ? null : firstAvailableAt,
    mailboxDetails,
    skipWarning: SKIP_WARNING,
    promptConfigured,
  });
});

router.post("/activate", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const mailboxId = typeof req.body?.mailboxId === "string" ? req.body.mailboxId : undefined;
  const mailboxes = await getConnectedEmailMailboxes(tenantId);
  const selectedMailboxes = mailboxId ? mailboxes.filter((mailbox) => mailbox.id === mailboxId) : mailboxes;

  if (selectedMailboxes.length === 0) {
    return res.status(400).json({ error: "No connected email mailbox is available." });
  }

  for (const mailbox of selectedMailboxes) {
    await LeadRecoveryState.updateOne(
      { tenantId, mailboxId: mailbox.id },
      {
        tenantId,
        mailboxId: mailbox.id,
        isActive: true,
        isBusy: false,
        availableAt: null,
        syncStatus: "idle",
      },
      { upsert: true }
    );
  }

  recoveryEvents.emitRecovery({
    tenantId,
    action: "RecoveryActivated",
    payload: {
      mailboxIds: selectedMailboxes.map((mailbox) => mailbox.id),
      syncStartsOnlyAfterUserClicksSync: true,
    },
  });

  res.json({ success: true, activatedMailboxes: selectedMailboxes.length });
});

router.post("/sync", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const mailboxId = typeof req.body?.mailboxId === "string" ? req.body.mailboxId : undefined;
  const mailboxes = await getConnectedEmailMailboxes(tenantId);
  const selectedMailboxes = mailboxId ? mailboxes.filter((mailbox) => mailbox.id === mailboxId) : mailboxes;
  const syncRequestedAt = new Date();

  if (selectedMailboxes.length === 0) {
    return res.status(400).json({ error: "No connected email mailbox is available for sync." });
  }

  for (const mailbox of selectedMailboxes) {
    await LeadRecoveryState.updateOne(
      { tenantId, mailboxId: mailbox.id },
      {
        tenantId,
        mailboxId: mailbox.id,
        isActive: true,
        isBusy: false,
        availableAt: null,
        syncRequestedAt,
        syncStatus: "queued",
      },
      { upsert: true }
    );
  }

  // Notify the lead-recovery-worker via Redis Pub/Sub (event-driven, no polling needed)
  try {
    const { publish } = await import('@services/event-bus/src/redis-pubsub.js');
    for (const mb of selectedMailboxes) {
      await publish('lead-recovery:sync-requested', { tenantId, mailboxId: mb.id }).catch(() => {});
    }
  } catch {
    // Redis unavailable — worker will pick up on restart
  }

  recoveryEvents.emitRecovery({
    tenantId,
    action: "SyncStarted",
    payload: {
      mailboxIds: selectedMailboxes.map((mailbox) => mailbox.id),
      syncWindowDays: 90,
      requestedBy: "user",
      readOnlySync: true,
    },
  });

  res.json({ success: true, queuedMailboxes: selectedMailboxes.length, message: "Lead Recovery sync queued for the worker." });
});

router.post("/deactivate", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  await LeadRecoveryState.updateMany({ tenantId }, { isActive: false });
  recoveryEvents.emitRecovery({ tenantId, action: "RecoveryDeactivated" });
  res.json({ success: true });
});

router.get("/leads", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const limit = Math.min(Number(req.query.limit || 100), 250);
  const leads = await RecoveredLead.find({ tenantId }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ leads });
});

router.get("/events", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const events = await RecoveryEventLog.find({ tenantId }).sort({ timestamp: -1 }).limit(limit).lean();
  res.json({ events });
});

router.get("/prompt-config/:name", async (req, res) => {
  const prompt = await RecoveryPromptConfig.findOne({ name: req.params.name }).lean();
  if (!prompt) return res.status(404).json({ error: "Prompt configuration not found" });
  res.json({ prompt });
});

router.put("/prompt-config/:name", async (req, res) => {
  const { systemPrompt, userPromptTemplate } = req.body || {};
  if (typeof systemPrompt !== "string" || typeof userPromptTemplate !== "string") {
    return res.status(400).json({ error: "systemPrompt and userPromptTemplate are required" });
  }

  const prompt = await RecoveryPromptConfig.findOneAndUpdate(
    { name: req.params.name },
    { name: req.params.name, systemPrompt, userPromptTemplate, updatedAt: new Date() },
    { upsert: true, new: true }
  ).lean();

  res.json({ success: true, prompt });
});

router.post("/recover/:leadId", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const lead = await RecoveredLead.findOne({ _id: req.params.leadId, tenantId });
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const prompt = await RecoveryPromptConfig.findOne({ name: "email-lead-recovery" }).lean();
  if (!prompt) {
    return res.status(409).json({
      error: "Prompt configuration missing",
      message: "Create a RecoveryPromptConfig named email-lead-recovery before generating recovery drafts.",
    });
  }

  const sourceMailbox = lead.mailboxId ? await storage.getIntegrationById(String(lead.mailboxId)) : null;
  const renderedPrompt = renderTemplate(prompt.userPromptTemplate, {
    email: lead.email,
    subject: lead.subject || "",
    intent: lead.intent,
    deliverabilityStatus: lead.deliverabilityStatus,
    mailbox: sourceMailbox?.accountType || sourceMailbox?.provider || "",
    conversationSummary: lead.conversationSummary || "",
    lastMessage: lead.lastMessageText || "",
  });

  const aiResult = await generateReply(
    `${prompt.systemPrompt}\n\nThis is Lead Recovery, not a normal outreach campaign. Generate a personalized recovery reply using the exact prior conversation state. Do not reuse generic initial outreach copy.`,
    renderedPrompt,
    {
      userId: tenantId,
      jsonMode: true,
      temperature: 0.3,
      maxTokens: 900,
      channel: "email",
      isEmailBody: true,
    }
  );

  let draft = aiResult.text;
  try {
    const parsed = JSON.parse(aiResult.text || "{}");
    draft = parsed.followUpDraft || parsed.draft || aiResult.text;
  } catch {
    draft = aiResult.text;
  }

  lead.followUpDraft = draft;
  await lead.save();

  recoveryEvents.emitRecovery({
    tenantId,
    action: "DraftGenerated",
    payload: { leadId: String(lead._id), promptConfig: prompt.name },
  });

  res.json({
    success: true,
    draft,
    lead,
    sendMailboxId: lead.mailboxId,
    sendMailbox: sourceMailbox ? {
      id: sourceMailbox.id,
      provider: sourceMailbox.provider,
      accountType: sourceMailbox.accountType,
    } : null,
  });
});

router.post("/brainstorm-sync", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
  const query = leadIds.length ? { tenantId, _id: { $in: leadIds } } : { tenantId };
  const leads = await RecoveredLead.find(query);
  let synced = 0;

  for (const lead of leads) {
    for (const objection of lead.brainstormedObjections || []) {
      if (objection.syncedAt) continue;
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
      objection.syncedAt = new Date();
      synced += 1;
      recoveryEvents.emitRecovery({
        tenantId,
        action: "ObjectionDiscovered",
        payload: { leadId: String(lead._id), category: objection.category, rule: objection.rule },
      });
    }
    await lead.save();
  }

  recoveryEvents.emitRecovery({
    tenantId,
    action: "BrainstormSyncCompleted",
    payload: { synced },
  });

  res.json({ success: true, synced });
});

router.get("/preflight", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const state = await LeadRecoveryState.findOne({ tenantId, isActive: true }).lean();
  res.json({
    shouldSuggest: !state,
    isActive: Boolean(state),
    warning: SKIP_WARNING,
  });
});

export default router;
