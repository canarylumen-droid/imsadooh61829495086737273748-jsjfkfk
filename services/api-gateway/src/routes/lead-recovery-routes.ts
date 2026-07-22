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

let mySqlConnected = false;
router.use((_req, _res, next) => {
  if (hasMySqlUri() && !mySqlConnected) {
    mySqlConnected = true;
    connectMySql().catch(() => { mySqlConnected = false; });
  }
  next();
});

function tenantIdFrom(req: Express.Request): string {
  return req.user?.id || req.session?.userId || "";
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

const RECOVERY_DRAFT_SYSTEM_PROMPT = `You are a lead recovery specialist. Your only job: write a short, personalized follow-up email to re-engage a cold lead.

## RULES
1. This is a real past conversation — do NOT write a generic first-touch email.
2. Reference exactly where the conversation left off: the lead's last question, objection, or stopping point.
3. Do not invent facts about the lead or your prior relationship. Use ONLY the context provided.
4. Keep it 3–4 sentences. Low pressure. The goal is to reopen the conversation, not close.
5. Do NOT apologize for following up. Be natural, direct, and human.
6. Match the sender's voice from the original conversation (formal vs casual based on context).
7. If the lead went silent after a specific question, reference it and offer a simpler next step.

## OUTPUT
Return JSON: { "followUpDraft": "the email body text" }`;

router.post("/recover/:leadId", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const lead = await getRecoveredLeadById(req.params.leadId, tenantId);
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const sourceMailbox = lead.mailboxId
    ? await storage.getIntegrationById(String(lead.mailboxId))
    : null;

  const objections = Array.isArray(lead.brainstormedObjections)
    ? lead.brainstormedObjections.map((o: any) => `- ${o.category}: ${o.rule}`).join("\n")
    : "None recorded";

  const context = [
    `Lead email: ${lead.email}`,
    `Last subject: ${lead.subject || "(none)"}`,
    `Intent: ${lead.intent}`,
    `Deliverability: ${lead.deliverabilityStatus}`,
    `Source mailbox: ${sourceMailbox?.accountType || sourceMailbox?.provider || "(unknown)"}`,
    `Source mailbox provider: ${sourceMailbox?.provider || "(unknown)"}`,
    `Last message at: ${lead.lastMessageAt ? new Date(lead.lastMessageAt).toLocaleString() : "(unknown)"}`,
    ``,
    lead.conversationSummary
      ? `Conversation summary:\n${lead.conversationSummary}`
      : "Conversation summary: (none available)",
    ``,
    lead.lastMessageText
      ? `Lead's last message:\n"""\n${lead.lastMessageText}\n"""`
      : "Lead's last message: (none available)",
    ``,
    `Known objections:\n${objections}`,
  ].join("\n");

  const aiResult = await generateReply(RECOVERY_DRAFT_SYSTEM_PROMPT, context, {
    userId: tenantId,
    jsonMode: true,
    temperature: 0.3,
    maxTokens: 900,
    channel: "email",
    isEmailBody: true,
  });

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
    payload: { leadId: lead.id },
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
