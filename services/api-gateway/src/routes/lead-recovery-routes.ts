import { Router } from "express";
import {
  connectMySql,
  hasMySqlUri,
  getMySqlPool,
  getLeadRecoveryStates,
  getActiveLeadRecoveryState,
  getRecoveryStats,
  promptConfigExists,
  upsertRecoveryState,
  deactivateAllRecoveryStates,
  getRecoveredLeads,
  getRecoveryEventLogs,
  getRecoveryPromptConfig,
  upsertRecoveryPromptConfig,
  getRecoveredLeadById,
  upsertRecoveredLead,
  upsertRecoveryObjection,
} from "@shared/lib/mysql.js";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuthOrApiKey } from "../middleware/auth.js";
import { requireProPlan } from "../middleware/plan.js";
import { recoveryEvents } from "../lib/events.js";
import { checkMailboxCampaignStatus } from "../services/lead-recovery-mailbox.js";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";

const router = Router();
const EMAIL_PROVIDERS = new Set(["custom_email", "gmail", "outlook"]);
const SKIP_WARNING =
  "Lead Recovery works alongside your active campaigns. Mailboxes are scanned in read-only mode and will not interfere with campaign delivery.";

router.use(requireAuthOrApiKey, requireProPlan);

router.use(async (_req, _res, next) => {
  if (hasMySqlUri()) {
    try {
      await connectMySql();
    } catch {
      // MySQL unavailable — routes will return empty/fallback data
    }
  }
  next();
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

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function getMailboxDetails(tenantId: string) {
  const emptyCampaignStatus = { isBusy: false, availableAt: null as Date | null, activeCampaignIds: [] as string[] };

  const [integrations, states, campaignStatus] = await Promise.all([
    withTimeout(storage.getIntegrations(tenantId), 25000, []),
    withTimeout(getLeadRecoveryStates(tenantId), 25000, []),
    withTimeout(
      checkMailboxCampaignStatus(tenantId, "").catch(() => emptyCampaignStatus),
      25000,
      emptyCampaignStatus
    ),
  ]);

  const mailboxes = integrations.filter(
    (integration) => EMAIL_PROVIDERS.has(integration.provider) && integration.connected
  );
  const stateByMailbox = new Map(states.map((state) => [state.mailboxId, state]));

  return mailboxes.map((mailbox) => {
    const state = stateByMailbox.get(mailbox.id);
    return {
      id: mailbox.id,
      provider: mailbox.provider,
      accountType: mailbox.accountType,
      healthStatus: mailbox.healthStatus,
      reputationScore: mailbox.reputationScore,
      isBusy: campaignStatus.isBusy,
      availableAt: campaignStatus.availableAt?.toISOString() || null,
      activeCampaignIds: campaignStatus.activeCampaignIds,
      isRecoveryActive: Boolean(state?.isActive),
      lastSyncAt: state?.lastSyncAt?.toISOString?.() || null,
      syncRequestedAt: state?.syncRequestedAt?.toISOString?.() || null,
      syncStatus: state?.syncStatus || "idle",
      errorMessage: state?.errorMessage || null,
    };
  });
}

async function getConnectedEmailMailboxes(tenantId: string) {
  const integrations = await storage.getIntegrations(tenantId);
  return integrations.filter(
    (integration) => EMAIL_PROVIDERS.has(integration.provider) && integration.connected
  );
}

router.get("/status", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const mailboxDetails = await getMailboxDetails(tenantId);
  const hasAvailableMailbox = mailboxDetails.some((mailbox) => !mailbox.isBusy);
  const state = await getActiveLeadRecoveryState(tenantId);
  const promptConfigured = await promptConfigExists("email-lead-recovery");
  const firstAvailableAt =
    mailboxDetails
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
  const selectedMailboxes = mailboxId
    ? mailboxes.filter((mailbox) => mailbox.id === mailboxId)
    : mailboxes;

  if (selectedMailboxes.length === 0) {
    return res.status(400).json({ error: "No connected email mailbox is available." });
  }

  for (const mailbox of selectedMailboxes) {
    await upsertRecoveryState(tenantId, mailbox.id, {
      isActive: true,
      isBusy: false,
      availableAt: null,
      syncStatus: "idle",
    });
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
  const selectedMailboxes = mailboxId
    ? mailboxes.filter((mailbox) => mailbox.id === mailboxId)
    : mailboxes;
  const syncRequestedAt = new Date();

  if (selectedMailboxes.length === 0) {
    return res.status(400).json({ error: "No connected email mailbox is available for sync." });
  }

  for (const mailbox of selectedMailboxes) {
    await upsertRecoveryState(tenantId, mailbox.id, {
      isActive: true,
      isBusy: false,
      availableAt: null,
      syncRequestedAt,
      syncStatus: "queued",
      errorMessage: null,
    });
  }

  try {
    const { publish } = await import("@services/event-bus/src/redis-pubsub.js");
    for (const mb of selectedMailboxes) {
      await publish("lead-recovery:sync-requested", { tenantId, mailboxId: mb.id }).catch(() => {});
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

  res.json({
    success: true,
    queuedMailboxes: selectedMailboxes.length,
    message: "Lead Recovery sync queued for the worker.",
  });
});

router.post("/deactivate", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  if (!hasMySqlUri() || !getMySqlPool()) {
    return res.status(503).json({ error: "Lead recovery database is not available" });
  }
  await deactivateAllRecoveryStates(tenantId);
  recoveryEvents.emitRecovery({ tenantId, action: "RecoveryDeactivated" });
  res.json({ success: true });
});

router.get("/leads", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const limit = Math.min(Number(req.query.limit || 100), 250);
  const mailboxId = typeof req.query.mailboxId === "string" ? req.query.mailboxId : undefined;
  const leads = await getRecoveredLeads(tenantId, limit, mailboxId);
  res.json({ leads });
});

router.get("/stats", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const stats = await getRecoveryStats(tenantId);
  res.json(stats);
});

router.get("/events", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const mailboxId = typeof req.query.mailboxId === "string" ? req.query.mailboxId : undefined;
  const events = await getRecoveryEventLogs(tenantId, limit, mailboxId);
  res.json({ events });
});

router.get("/prompt-config/:name", async (req, res) => {
  const prompt = await getRecoveryPromptConfig(req.params.name);
  if (!prompt) return res.status(404).json({ error: "Prompt configuration not found" });
  res.json({ prompt });
});

router.put("/prompt-config/:name", async (req, res) => {
  const { systemPrompt, userPromptTemplate } = req.body || {};
  if (typeof systemPrompt !== "string" || typeof userPromptTemplate !== "string") {
    return res.status(400).json({ error: "systemPrompt and userPromptTemplate are required" });
  }

  await upsertRecoveryPromptConfig(req.params.name, systemPrompt, userPromptTemplate);
  const prompt = await getRecoveryPromptConfig(req.params.name);

  res.json({ success: true, prompt });
});

router.post("/recover/:leadId", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const lead = await getRecoveredLeadById(req.params.leadId, tenantId);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const prompt = await getRecoveryPromptConfig("email-lead-recovery");
  if (!prompt) {
    return res.status(409).json({
      error: "Prompt configuration missing",
      message:
        "Create a RecoveryPromptConfig named email-lead-recovery before generating recovery drafts.",
    });
  }

  const sourceMailbox = lead.mailboxId
    ? await storage.getIntegrationById(String(lead.mailboxId))
    : null;
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

  await upsertRecoveredLead(tenantId, lead.mailboxId, lead.email, { followUpDraft: draft });

  recoveryEvents.emitRecovery({
    tenantId,
    action: "DraftGenerated",
    payload: { leadId: lead.id, promptConfig: prompt.name },
  });

  res.json({
    success: true,
    draft,
    lead,
    sendMailboxId: lead.mailboxId,
    sendMailbox: sourceMailbox
      ? {
          id: sourceMailbox.id,
          provider: sourceMailbox.provider,
          accountType: sourceMailbox.accountType,
        }
      : null,
  });
});

router.post("/brainstorm-sync", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
  const leads = await getRecoveredLeads(tenantId, 999);
  const filteredLeads = leadIds.length
    ? leads.filter((lead) => leadIds.includes(lead.id))
    : leads;
  let synced = 0;

  for (const lead of filteredLeads) {
    const objections = lead.brainstormedObjections || [];
    let updated = false;
    for (const objection of objections) {
      if ((objection as any).synced_at) continue;
      await upsertRecoveryObjection(
        tenantId,
        objection.rule,
        objection.category,
        objection.evidence,
        lead.id,
        "ai"
      );
      (objection as any).synced_at = new Date().toISOString();
      synced += 1;
      updated = true;
      recoveryEvents.emitRecovery({
        tenantId,
        action: "ObjectionDiscovered",
        payload: { leadId: lead.id, category: objection.category, rule: objection.rule },
      });
    }
    if (updated) {
      await upsertRecoveredLead(tenantId, lead.mailboxId, lead.email, {
        brainstormedObjections: objections,
      });
    }
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
  const state = await getActiveLeadRecoveryState(tenantId);
  res.json({
    shouldSuggest: !state,
    isActive: Boolean(state),
    warning: SKIP_WARNING,
  });
});

export default router;
