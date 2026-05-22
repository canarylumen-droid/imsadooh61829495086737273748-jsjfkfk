import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { RecoveryPromptConfig } from "@shared/lib/models/lead-recovery.js";
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

  await RecoveryPromptConfig.updateOne(
      { name: "email-lead-recovery" },
      {
        $setOnInsert: {
          name: "email-lead-recovery",
          systemPrompt: `${systemPrompt}\n\nLead Recovery is not normal outreach. Do not reuse a generic initial campaign sequence. Use the prior conversation state, the last message, the source mailbox, and the lead's exact objection or stopping point to write a personalized recovery draft.`,
          userPromptTemplate,
          updatedAt: new Date(),
        },
      },
    { upsert: true }
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
  const promptConfig = await RecoveryPromptConfig.findOne({ name: "email-lead-recovery" }).lean();
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
