import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { connectMySql, getRecoveryPromptConfig, upsertRecoveryPromptConfig } from "@shared/lib/mysql.js";
import type { RecoveryEmail } from "./mailbox.js";

export type RecoveryIntent = "Converted" | "Ghosted" | "Not-Interested" | "Reply-Needed";

export interface AnalyzedLead {
  intent: RecoveryIntent;
  followUpDraft?: string;
  brainstormedObjections: Array<{
    category: string;
    rule: string;
    evidence?: string;
  }>;
}

export async function ensurePromptConfigFromEnv(): Promise<void> {
  const systemPrompt = process.env.LEAD_RECOVERY_SYSTEM_PROMPT;
  const userPromptTemplate = process.env.LEAD_RECOVERY_USER_PROMPT_TEMPLATE;

  if (!systemPrompt || !userPromptTemplate) return;

  await connectMySql();
  await upsertRecoveryPromptConfig(
    "email-lead-recovery",
    `${systemPrompt}\n\n## IDENTITY
You are a lead recovery specialist. You revive cold/dead conversations by writing hyper-personalized recovery drafts.

## MISSION
Analyze the prior conversation, the lead's last message, their objection or stopping point, and the source mailbox. Write a recovery email that re-engages the lead by addressing exactly where the conversation left off.

## 🔒 ANTI-HALLUCINATION RULES (STRICT)
1. ONLY use the prior conversation state, last message, and source mailbox provided. Do not invent details about the lead.
2. Do not assume why the lead went silent if the reason isn't stated. Hypothesize carefully.
3. The recovery draft must reference ONLY facts, objections, or interests actually present in the conversation history.

## HARD CONSTRAINTS
1. Lead Recovery is NOT normal outreach. Do NOT reuse a generic initial campaign sequence.
2. Reference the lead's exact objection, question, or stopping point. Show you remember the conversation.
3. Sound like a human following up on a real conversation — not a sequence resuming.
4. Keep it to 3-4 sentences. This is a re-engagement, not a full pitch.
5. Low pressure. The goal is to reopen the conversation, not close the deal immediately.`,
    userPromptTemplate
  );
}

function renderPrompt(template: string, email: RecoveryEmail): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const values: Record<string, string> = {
      from: email.from || "",
      subject: email.subject || "",
      body: email.text || "",
      date: email.date?.toISOString() || "",
      lastMessage: email.text || "",
      conversationSummary: `Latest inbound message from ${email.from || "unknown"} about "${email.subject || "no subject"}".`,
      threadHistory: email.threadHistory || "No prior conversation history available.",
    };
    return values[key] || "";
  });
}

function normalizeIntent(value: unknown): RecoveryIntent {
  if (value === "Converted" || value === "Ghosted" || value === "Not-Interested" || value === "Reply-Needed") {
    return value;
  }
  return "Reply-Needed";
}

export async function analyzeRecoveryEmail(tenantId: string, email: RecoveryEmail): Promise<AnalyzedLead> {
  await connectMySql();
  const promptConfig = await getRecoveryPromptConfig("email-lead-recovery");
  if (!promptConfig) {
    throw new Error("Missing RecoveryPromptConfig: email-lead-recovery");
  }

  const response = await generateReply(promptConfig.systemPrompt, renderPrompt(promptConfig.userPromptTemplate, email), {
    userId: tenantId,
    jsonMode: true,
    temperature: 0.2,
    maxTokens: 900,
    channel: "email",
  });

  const parsed = JSON.parse(response.text || "{}");
  const objections = Array.isArray(parsed.brainstormedObjections) ? parsed.brainstormedObjections : [];

  return {
    intent: normalizeIntent(parsed.intent),
    followUpDraft: typeof parsed.followUpDraft === "string" ? parsed.followUpDraft : undefined,
    brainstormedObjections: objections
      .filter((item: any) => item && typeof item.rule === "string" && typeof item.category === "string")
      .map((item: any) => ({
        category: String(item.category).slice(0, 80),
        rule: String(item.rule).slice(0, 500),
        evidence: typeof item.evidence === "string" ? item.evidence.slice(0, 500) : undefined,
      })),
  };
}
