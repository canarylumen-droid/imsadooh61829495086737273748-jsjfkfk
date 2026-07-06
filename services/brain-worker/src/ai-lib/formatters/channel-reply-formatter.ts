import { generateReply } from "../core/ai-service.js";
import { MODELS } from "../utils/model-config.js";

const isAIConfigured = !!(process.env.Z_AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);

export interface FormattedReply {
  message: string;
  channel: "email" | "instagram";
  subject?: string;
  formatting: {
    useEmoji: false,
    maxLength: number;
    tone: string;
  };
}

export interface ChannelFormattingOptions {
  leadName: string;
  brandName?: string;
  replyContext?: string;
  urgency?: "critical" | "high" | "medium" | "low";
  hasObjection?: boolean;
  wantsToBook?: boolean;
}

export async function formatReplyForChannel(
  rawReply: string,
  channel: "email" | "instagram",
  options: ChannelFormattingOptions
): Promise<FormattedReply> {
  const firstName = options.leadName?.split(" ")[0] || "there";

  if (channel === "instagram") {
    return formatForInstagram(rawReply, firstName, options);
  } else {
    return formatForEmail(rawReply, firstName, options);
  }
}

async function formatForInstagram(
  rawReply: string,
  firstName: string,
  options: ChannelFormattingOptions
): Promise<FormattedReply> {
  const maxLength = 1000;

  if (!isAIConfigured) {
    return {
      message: formatInstagramFallback(rawReply, firstName, maxLength),
      channel: "instagram",
      formatting: {
        useEmoji: false,
        maxLength,
        tone: "casual-friendly",
      },
    };
  }

  try {
    const prompt = `Transform this sales reply into an Instagram DM format:

ORIGINAL REPLY:
${rawReply}

LEAD NAME: ${firstName}
CONTEXT: ${options.replyContext || "General sales conversation"}
${options.hasObjection ? "NOTE: Lead has an objection - address it confidently but not defensively" : ""}
${options.wantsToBook ? "NOTE: Lead wants to book - make it easy for them" : ""}

INSTAGRAM DM RULES:
1. Keep it SHORT - 2-3 sentences max (under 150 characters ideal)
2. Use casual, friendly tone - like texting a friend
3. NO emoji usage - keep it clean text only
4. No formal greetings ("Dear", "Hi there")
5. Use contractions (you're, don't, can't)
6. End with a question or clear next step
7. Sound human, not robotic
8. If booking, just drop the link naturally

BAD EXAMPLE: "Hello! I appreciate your interest in our services. Would you be available for a call to discuss further?"
GOOD EXAMPLE: "yo ${firstName}! that's exactly what we help with. quick q - when's a good time for a 10min chat?"

Return ONLY the formatted DM message, nothing else.`;

    const response = await generateReply(
      `## IDENTITY
You are an elite DM copywriter for B2B sales. You write Instagram DMs that feel like a text from a peer — short, personal, and impossible to ignore. Every DM moves the conversation toward a call or meeting.

## MISSION
Format a raw sales reply into a natural, human-sounding DM. The lead must feel like they're talking to a real person who gets their business.

## 🔒 ANTI-HALLUCINATION RULES
1. **CONTEXT ONLY**: Use only the provided reply, lead name, and context. Do not invent additional offers, features, or details.
2. **NO LINKS**: Never include URLs in the message body. Links are added separately by the system.
3. **NO FAKE PERSONALIZATION**: Do not invent details about the lead or their business. Use only what's provided.

## HARD CONSTRAINTS
1. MAX 2-3 sentences (under 150 characters ideal). Shorter always wins.
2. Casual, confident tone — like texting a peer, not emailing a client.
3. NO emoji usage. Clean text only.
4. No formal greetings ("Dear", "Hi there", "Hello").
5. Use contractions: you're, don't, can't, I'll, we're.
6. End with a question or clear next step. Make it easy to reply.
7. Sound human. Read it aloud — if it sounds stiff, rewrite.
8. If booking a call, suggest it naturally: "when's a good time for a quick chat?"

## ✅ GOOD EXAMPLE
"yo ${firstName}! that's exactly what we help with. quick q — when's a good time for a 10min chat?"

## ❌ BAD EXAMPLES
"Hello! I appreciate your interest in our services. Would you be available for a call to discuss further?"
"Hi there! Thank you for your comment. We would love to connect with you."

Return ONLY the formatted DM message, nothing else.`,
      prompt,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.8,
        maxTokens: 200,
      }
    );

    const formatted = response.text?.trim() || rawReply;

    return {
      message: formatted.substring(0, maxLength),
      channel: "instagram",
      formatting: {
        useEmoji: false,
        maxLength,
        tone: "casual-friendly",
      },
    };
  } catch (error) {
    console.error("Instagram formatting error:", error);
    return {
      message: formatInstagramFallback(rawReply, firstName, maxLength),
      channel: "instagram",
      formatting: {
        useEmoji: false,
        maxLength,
        tone: "casual-friendly",
      },
    };
  }
}

async function formatForEmail(
  rawReply: string,
  firstName: string,
  options: ChannelFormattingOptions
): Promise<FormattedReply> {
  const maxLength = 2000;

  if (!isAIConfigured) {
    return {
      message: formatEmailFallback(rawReply, firstName, maxLength),
      channel: "email",
      subject: generateEmailSubject(rawReply, options),
      formatting: {
        useEmoji: false,
        maxLength,
        tone: "professional-warm",
      },
    };
  }

  try {
    const prompt = `Transform this sales reply into a professional email format:

ORIGINAL REPLY:
${rawReply}

LEAD NAME: ${firstName}
BRAND: ${options.brandName || "Our team"}
CONTEXT: ${options.replyContext || "Sales follow-up"}
${options.hasObjection ? "NOTE: Address the objection professionally" : ""}
${options.wantsToBook ? "NOTE: Lead is ready - include clear call-to-action" : ""}

EMAIL FORMATTING RULES:
1. Keep it CONCISE - 3-5 short paragraphs max
2. Professional but warm tone - not stiff or corporate
3. NO emojis under any circumstances.
4. Clear paragraph breaks for readability
5. Use contractions to sound human
6. End with ONE clear call-to-action
7. Don't over-explain or be wordy
8. Address them by first name only

STRUCTURE:
- Hook (1 sentence - acknowledge their message/situation)
- Value (1-2 sentences - key point)
- Action (1 sentence - what to do next)

BAD: Long, formal, corporate-speak emails
GOOD: Short, punchy, value-focused emails

Return ONLY the email body (no subject line, no signature).`;

    const response = await generateReply(
      `## IDENTITY
You are an elite B2B email copywriter. You write emails that get replies — short, human, and impossible to ignore. You strip away corporate fluff and write like a busy executive communicating with a peer.

## MISSION
Format the raw sales reply into a polished email that sounds human, drives the conversation forward, and gets a response.

## 🔒 ANTI-HALLUCINATION RULES
1. **USE GIVEN CONTEXT ONLY**: Only use the lead name, brand name, and context provided. Do not invent facts about the lead or the product.
2. **NO FAKE OFFERS**: Do not add pricing, features, or offers that aren't in the original reply.
3. **NO INVENTED REFERENCES**: Never reference conversations or details not in the provided context.

## HARD CONSTRAINTS
1. CONCISE: 3-5 short paragraphs max. Most should be 1-2 sentences.
2. Professional but warm — not stiff or corporate. Write like a human.
3. NO emojis under any circumstances. Keep it clean.
4. Use contractions (you're, don't, can't, we'll) to sound natural.
5. End with ONE clear call-to-action or next step. Make it obvious what to do.
6. Don't over-explain. If you can say it in 5 words instead of 10, use 5.
7. Address them by first name only (once, naturally).

## STRUCTURE
- **Hook** (1 sentence): Acknowledge their message. Show you read it.
- **Value** (1-2 sentences): Key point or offer. Why they should care.
- **Action** (1 sentence): Clear next step. Make replying easy.

## ✅ GOOD EXAMPLE
"${firstName} — makes sense. Most [industry] teams feel that way before they see it in action.
We just wrapped a similar deployment for [comparable company]. They saw [result] in under 2 weeks.
Want me to show you the same playbook? 10 min, no pitch."

## ❌ BAD EXAMPLES
"Dear ${firstName}, I hope this message finds you well. We are writing to express our interest in partnering with you. Our comprehensive suite of solutions includes..."
"Hello! We appreciate your interest. Please let us know if you have any questions."

Return ONLY the email body (no subject line, no signature).`,
      prompt,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.7,
        maxTokens: 400,
      }
    );

    const formatted = response.text?.trim() || rawReply;

    return {
      message: formatted.substring(0, maxLength),
      channel: "email",
      subject: generateEmailSubject(formatted, options),
      formatting: {
        useEmoji: false,
        maxLength,
        tone: "professional-warm",
      },
    };
  } catch (error) {
    console.error("Email formatting error:", error);
    return {
      message: formatEmailFallback(rawReply, firstName, maxLength),
      channel: "email",
      subject: generateEmailSubject(rawReply, options),
      formatting: {
        useEmoji: false,
        maxLength,
        tone: "professional-warm",
      },
    };
  }
}

function formatInstagramFallback(text: string, firstName: string, maxLength: number): string {
  let formatted = text
    .replace(/^(Hi|Hello|Dear|Hey)\s+\w+[,!.]\s*/i, "")
    .replace(/Best regards,?\s*\w*\s*$/i, "")
    .replace(/Thank you for your interest\.?\s*/gi, "")
    .trim();

  if (formatted.length > maxLength) {
    formatted = formatted.substring(0, maxLength - 3) + "...";
  }

  formatted = formatted.replace(/\. /g, "! ");

  if (!formatted.includes("?") && !formatted.includes("!")) {
    formatted += ".";
  }

  return formatted;
}

function formatEmailFallback(text: string, firstName: string, maxLength: number): string {
  let formatted = text;

  if (!formatted.toLowerCase().startsWith("hi ") && !formatted.toLowerCase().startsWith("hey ")) {
    formatted = `${firstName},\n\n${formatted}`;
  }

  if (formatted.length > maxLength) {
    formatted = formatted.substring(0, maxLength - 3) + "...";
  }

  return formatted;
}

function generateEmailSubject(content: string, options: ChannelFormattingOptions): string {
  const firstName = options.leadName?.split(" ")[0] || "";

  if (options.wantsToBook) {
    return `Quick chat, ${firstName}?`;
  }

  if (options.hasObjection) {
    return `Re: Your question`;
  }

  if (options.urgency === "critical" || options.urgency === "high") {
    return `${firstName} - quick update`;
  }

  const contentLower = content.toLowerCase();
  if (contentLower.includes("pricing") || contentLower.includes("cost")) {
    return `${firstName} - pricing details`;
  }

  if (contentLower.includes("meeting") || contentLower.includes("call")) {
    return `Let's connect, ${firstName}`;
  }

  return `${firstName} - following up`;
}

export function getChannelGuidelines(channel: "email" | "instagram"): string {
  if (channel === "instagram") {
    return `
INSTAGRAM DM GUIDELINES:
- Max 1000 characters (ideal: under 200)
- Casual, conversational tone
- NO emojis under any circumstances.
- No formal greetings
- Quick responses expected
- Use contractions
- End with question or CTA
    `.trim();
  }

  return `
EMAIL GUIDELINES:
- Max 2000 characters (ideal: 300-500)
- Professional but warm tone
- No emojis
- Clear paragraph structure
- Proper greeting with first name
- One clear call-to-action
- Short paragraphs (2-3 sentences)
  `.trim();
}

