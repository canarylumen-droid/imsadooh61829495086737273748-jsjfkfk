import { generateReply } from "../core/ai-service.js";
import { MODELS } from "./model-config.js";

export interface ParsedEmailBody {
    name: string;
    email: string;
    company?: string;
    job_title?: string;
    intent: string;
    summary: string;
    urgency: 'low' | 'medium' | 'high';
    sentiment: 'positive' | 'neutral' | 'negative';
}

/**
 * Parses raw email body into structured JSON using AI
 */
export async function parseEmailBody(body: string): Promise<ParsedEmailBody> {
    const prompt = `
    Extract structured lead information from the following email body. 
    Return ONLY a JSON object with the following fields:
    - name: Full name of the sender
    - email: Email address of the sender
    - company: Company name (if mentioned)
    - job_title: Job title (if mentioned)
    - intent: Brief description of why they are reaching out
    - summary: A 1-sentence summary of the message
    - urgency: One of: low, medium, high
    - sentiment: One of: positive, neutral, negative

    Email Body:
    """
    ${body}
    """
  `;

    try {
        const response = await generateReply(
            "You are a structured data extractor.",
            prompt,
            {
                model: MODELS.lead_intelligence,
                jsonMode: true
            }
        );
        const text = response.text || "";

        // Clean up response text to ensure it's valid JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Failed to extract JSON from AI response");
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error("Error parsing email body with AI:", error);
        throw new Error("AI parsing failed: " + (error instanceof Error ? error.message : "Unknown error"));
    }
}

