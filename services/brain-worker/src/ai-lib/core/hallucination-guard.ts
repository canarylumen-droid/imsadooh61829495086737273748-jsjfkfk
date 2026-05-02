import { MODELS } from "../utils/model-config.js";
import { generateReply } from "./ai-service.js";

export interface HallucinationResult {
  isValid: boolean;
  reason?: string;
  cleanedText?: string;
}

/**
 * Hallucination Guard: Final verification layer for AI-generated outreach.
 * Blocks hallucinated links, technical TZs, and bot-like behavior.
 */
export class HallucinationGuard {
  private static BLOCKED_PHRASES = [
    "as an ai",
    "ai language model",
    "as a large language model",
    "i cannot provide",
    "my purpose is",
    "hope this email finds you well",
    "hope you are doing well",
    "please feel free to",
    "don't hesitate to",
    "reach out if you have any questions",
    "thank you for your time",
    "best regards",
    "sincerely"
  ];

  private static TIMEZONE_REGEX = /\b(UTC|GMT|PST|PDT|EST|EDT|CST|CDT|MST|MDT|Africa\/|America\/|Europe\/|Asia\/|Pacific\/)\b/i;

  /**
   * Run full verification suite on generated text
   */
  static async verify(text: string, context: { 
    userId: string;
    leadId: string;
    allowedLinks: string[];
    brandContext?: string;
  }): Promise<HallucinationResult> {
    
    // 1. Check for blocked "bot" phrases
    const lowerText = text.toLowerCase();
    for (const phrase of this.BLOCKED_PHRASES) {
      if (lowerText.includes(phrase)) {
        return { 
          isValid: false, 
          reason: `Bot-like phrase detected: "${phrase}"` 
        };
      }
    }

    // 2. Check for technical timezone exposure
    if (this.TIMEZONE_REGEX.test(text)) {
      return { 
        isValid: false, 
        reason: "Technical timezone name exposed (e.g. UTC, America/New_York)" 
      };
    }

    // 3. Link Validation (Hallucination Check)
    const urlRegex = /https?:\/\/[^\s/$.?#].[^\s]*/gi;
    const foundLinks = text.match(urlRegex) || [];
    
    for (const link of foundLinks) {
      const isAllowed = context.allowedLinks.some(allowed => 
        link.toLowerCase().includes(allowed.toLowerCase()) || 
        allowed.toLowerCase().includes(new URL(link).hostname.toLowerCase())
      );
      
      if (!isAllowed) {
        return { 
          isValid: false, 
          reason: `Hallucinated link detected: ${link}` 
        };
      }
    }

    // 4. LLM-based Fact Verification (Optional but powerful for High-Value leads)
    // For production, we keep this lightweight or run it asynchronously
    
    return { isValid: true, cleanedText: text };
  }

  /**
   * High-Fidelity Verification: Uses a fast model to check for contradictions
   */
  static async verifyAgainstGuidelines(text: string, guidelines: string): Promise<HallucinationResult> {
    const systemPrompt = `You are a strict compliance officer. Compare the [RESPONSE] against the [GUIDELINES].
If the response violates any guideline (especially tone, greetings, or prohibited topics), respond with JSON: {"valid": false, "reason": "..."}.
If it matches perfectly, respond: {"valid": true}.

[GUIDELINES]
${guidelines}

[RESPONSE]
${text}`;

    try {
      const result = await generateReply(systemPrompt, "Verify the response.", { 
        jsonMode: true, 
        model: MODELS.intent_classification, // Use a fast model
        temperature: 0.1 
      });
      
      const parsed = JSON.parse(result.text);
      return { isValid: parsed.valid, reason: parsed.reason };
    } catch (e) {
      // If verification fails, default to valid but log warning
      console.warn("[HallucinationGuard] Verification model failed, passing through.");
      return { isValid: true };
    }
  }
}
