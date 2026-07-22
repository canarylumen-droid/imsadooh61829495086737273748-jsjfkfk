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
  const [integrations, states] = await Promise.all([
    withTimeout(storage.getIntegrations(tenantId), 25000, []),
    withTimeout(getLeadRecoveryStates(tenantId), 25000, []),
  ]);

  const mailboxes = integrations.filter(
    (integration) => EMAIL_PROVIDERS.has(integration.provider) && integration.connected
  );

  const mailboxIds = mailboxes.map((m) => m.id);
  const campaignStatus = mailboxIds.length > 0
    ? await withTimeout(
        checkMailboxCampaignStatus(tenantId, mailboxIds).catch(() => new Map()),
        25000,
        new Map()
      )
    : new Map();

  const stateByMailbox = new Map(states.map((state) => [state.mailboxId, state]));
  const emptyCs = { isBusy: false, availableAt: null as Date | null, activeCampaignIds: [] as string[] };

  return mailboxes.map((mailbox) => {
    const state = stateByMailbox.get(mailbox.id);
    const cs = campaignStatus.get(mailbox.id) || emptyCs;
    return {
      id: mailbox.id,
      provider: mailbox.provider,
      accountType: mailbox.accountType,
      healthStatus: mailbox.healthStatus,
      reputationScore: mailbox.reputationScore,
      isBusy: cs.isBusy,
      availableAt: cs.availableAt?.toISOString() || null,
      activeCampaignIds: cs.activeCampaignIds,
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

  const statuses = await checkMailboxCampaignStatus(
    tenantId,
    selectedMailboxes.map((m) => m.id)
  ).catch(() => new Map());

  const available = selectedMailboxes.filter((mb) => !statuses.get(mb.id)?.isBusy);
  if (available.length === 0) {
    return res.status(409).json({
      error: "All selected mailboxes are busy with active campaigns",
      message: "Wait for campaigns to finish or pause them before activating Lead Recovery.",
    });
  }

  for (const mailbox of available) {
    await upsertRecoveryState(tenantId, mailbox.id, {
      isActive: true,
      isBusy: false,
      availableAt: null,
      syncStatus: "idle",
    });
  }

  const skipped = selectedMailboxes.length - available.length;
  recoveryEvents.emitRecovery({
    tenantId,
    action: "RecoveryActivated",
    payload: {
      mailboxIds: available.map((mailbox) => mailbox.id),
      skippedMailboxes: skipped,
    },
  });

  res.json({
    success: true,
    activatedMailboxes: available.length,
    skippedMailboxes: skipped,
    message: skipped > 0
      ? `${skipped} mailbox${skipped === 1 ? "" : "es"} skipped — busy with active campaigns`
      : undefined,
  });
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

  const mailboxBusy = lead.mailboxId
    ? await checkMailboxCampaignStatus(tenantId, [lead.mailboxId])
        .then((m) => m.get(lead.mailboxId!)?.isBusy ?? false)
        .catch(() => false)
    : false;

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
    mailboxBusy,
    sendMailboxId: lead.mailboxId,
    sendMailbox: sourceMailbox
      ? {
          id: sourceMailbox.id,
          provider: sourceMailbox.provider,
          accountType: sourceMailbox.accountType,
        }
      : null,
    message: mailboxBusy
      ? "This mailbox has active campaign activity. The draft is saved but sending is delayed until campaigns finish."
      : undefined,
  });
});

router.post("/send/:leadId", async (req, res) => {
  const tenantId = tenantIdFrom(req);
  const lead = await getRecoveredLeadById(req.params.leadId, tenantId);
  if (!lead) return res.status(404).json({ error: "Recovery lead not found" });
  if (!lead.followUpDraft) return res.status(400).json({ error: "No recovery draft generated yet. Click Recover first." });

  const draft = lead.followUpDraft;
  const recipientEmail = lead.email;
  if (!recipientEmail) return res.status(400).json({ error: "Lead has no email address" });

  try {
    const { db } = await import('@shared/lib/db/db.js');
    const { leads, messages } = await import('@audnix/shared');
    const { eq, and, desc } = await import('drizzle-orm');

    // Find or create the lead in the main PG leads table so it appears in inbox
    let [pgLead] = await db.select().from(leads)
      .where(and(eq(leads.email, recipientEmail.toLowerCase()), eq(leads.userId, tenantId)))
      .limit(1);

    if (!pgLead) {
      const [newLead] = await db.insert(leads).values({
        email: recipientEmail.toLowerCase(),
        userId: tenantId,
        status: 'recovered',
        name: recipientEmail.split('@')[0] || 'Recovered Lead',
        channel: 'email',
        integrationId: lead.mailboxId || null,
        metadata: { source: 'lead_recovery', recoveredAt: new Date().toISOString() },
        createdAt: new Date(),
        lastMessageAt: new Date(),
      }).returning();
      pgLead = newLead;
    }

    const pgLeadId = pgLead.id;

    // Determine subject: use lead subject or generate one
    let emailSubject: string;
    const existingSubject = lead.subject;
    if (existingSubject && !existingSubject.includes('{{')) {
      emailSubject = existingSubject.replace(/^Re:\s*/i, 'Re: ');
    } else {
      try {
        const { generateEmailSubject } = await import('@services/brain-worker/src/ai-lib/core/ai-service.js');
        emailSubject = await generateEmailSubject(draft, recipientEmail);
      } catch {
        emailSubject = `Re: Following up`;
      }
    }

    // Resolve threading — find the last inbound message's externalId for In-Reply-To
    const sourceMsgIds = lead.sourceMessageIds;
    let inReplyTo: string | undefined;
    let references: string | undefined;
    try {
      const history = await db.select({ externalId: messages.externalId, metadata: messages.metadata })
        .from(messages)
        .where(eq(messages.leadId, pgLeadId))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      if (history.length > 0 && history[0].externalId) {
        inReplyTo = history[0].externalId;
        const meta = (history[0].metadata as any) || {};
        const prevRefs = meta.references || "";
        references = prevRefs ? `${prevRefs} ${inReplyTo}` : inReplyTo;
      }
    } catch {
      // Fallback: use first sourceMessageId from recovered lead
      if (sourceMsgIds && Array.isArray(sourceMsgIds) && sourceMsgIds.length > 0) {
        inReplyTo = sourceMsgIds[0];
      }
    }

    // Send via sendEmail which handles threading via inReplyTo
    const { sendEmail } = await import('@shared/lib/channels/email.js');
    const { generateTrackingToken } = await import('@services/email-service/src/email/email-tracking.js');
    const trackingId = generateTrackingToken();

    const sendResult = await sendEmail(tenantId, recipientEmail, draft, emailSubject, {
      isRaw: true,
      isHtml: true,
      trackingId,
      leadId: pgLeadId,
      integrationId: lead.mailboxId || undefined,
      inReplyTo,
      references,
      isPriorityReply: true, // Bypass daily limits — this is a recovery re-engagement
    });

    const externalMessageId = (sendResult as any)?.messageId || (sendResult as any)?.id;
    const integrationId = (sendResult as any)?.integrationId;

    // Create the message record in PG
    const [message] = await db.insert(messages).values({
      leadId: pgLeadId,
      userId: tenantId,
      provider: 'email',
      direction: 'outbound',
      body: draft,
      subject: emailSubject,
      trackingId,
      externalId: externalMessageId,
      integrationId: integrationId || (lead.mailboxId || null),
      metadata: {
        manual: true,
        sentAt: new Date(),
        trackingId,
        externalId: externalMessageId,
        inReplyTo,
        references,
        source: 'lead_recovery',
      },
      createdAt: new Date(),
    }).returning();

    // Update PG lead status
    await db.update(leads).set({
      status: 'contacted',
      lastMessageAt: new Date(),
      score: Math.min(100, ((pgLead as any).score || 0) + 2),
    }).where(eq(leads.id, pgLeadId));

    // Sent status is tracked via the RecoverySent event log below

    // Socket notifications
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    const { invalidateStatsCache } = await import('./dashboard-routes.js');
    invalidateStatsCache(tenantId);
    wsSync.notifyMessagesUpdated(tenantId, { leadId: pgLeadId, message });
    wsSync.notifyLeadsUpdated(tenantId, { type: 'lead_updated', lead: { id: pgLeadId, status: 'contacted', lastMessageAt: new Date().toISOString() } });
    wsSync.notifyEmailSent(tenantId, { leadId: pgLeadId, messageId: message.id, subject: message.subject || undefined });

    recoveryEvents.emitRecovery({
      tenantId,
      action: "RecoverySent",
      payload: { leadId: lead.id, pgLeadId, email: recipientEmail, externalMessageId },
    });

    res.json({
      success: true,
      message: "Recovery draft sent as a reply to the original thread.",
      leadId: pgLeadId,
      messageRecord: message,
    });
  } catch (error: any) {
    console.error("[LeadRecovery] Send error:", error);
    res.status(500).json({ error: error.message || "Failed to send recovery email" });
  }
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
