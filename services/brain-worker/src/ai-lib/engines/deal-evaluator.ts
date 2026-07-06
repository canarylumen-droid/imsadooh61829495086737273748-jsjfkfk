import { storage } from '@shared/lib/storage/storage.js';
import { generateReply } from "../core/ai-service.js";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { RevenueIntelligence } from "./revenue-intelligence.js";

/**
 * Analyzes the conversation history of a lead to determine the deal's value
 * based on the offer discussed or generalized brand information.
 */
export async function evaluateLeadDealValue(userId: string, leadId: string): Promise<number> {
  try {
    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) return 0;

    const messages = await storage.getMessagesByLeadId(leadId);
    if (!messages || messages.length === 0) return 0;

    // Combine recent messages into a transcript for the AI
    const recentMessages = messages.slice(-20);
    const transcript = recentMessages.map(m => 
      `${m.direction === 'inbound' ? 'Lead' : 'Agent'}: ${m.body}`
    ).join('\n');

    // Retrieve brand knowledge to check for default pricing
    const user = await storage.getUserById(userId);
    const brandKnowledge = [
      user?.brandGuidelinePdfText,
      await storage.getBrandKnowledge(userId)
    ].filter(Boolean).join('\n---\n') || '';
    const brandMetadata = user?.metadata?.extracted_brand || {};
    
    // We want the AI to return just a number, representing the final estimated deal value in USD
    const systemPrompt = `## IDENTITY
You are a world-class revenue intelligence analyst. You extract finalized deal values from sales conversations with precision.

## MISSION
Analyze the conversation transcript to determine the FINAL agreed or most likely deal value in USD. This value drives critical business decisions — accuracy is paramount.

## 🔒 ANTI-HALLUCINATION RULES (STRICT)
1. ONLY extract monetary amounts EXPLICITLY mentioned in the conversation transcript.
2. If no monetary amount is mentioned, base your inference ONLY on the Brand's standard offers/pricing — never invent a price.
3. Do NOT invent currency conversion rates. Only convert if the original currency is explicitly stated.
4. If the transcript is ambiguous, set dealValue to 0 and note uncertainty in reasoning.
5. Never fabricate deal terms, packages, or pricing not present in the transcript or brand context.

## HARD CONSTRAINTS
1. Identify ALL explicit monetary amounts mentioned. List them mentally before deciding.
2. If multiple values appear, the FINAL agreed amount or latest confirmed offer takes priority.
3. Use Brand Context to understand standard pricing when the conversation mentions specific products/packages but not exact prices.
4. For non-USD currencies, convert logically using standard rates — but note the original currency in reasoning.
5. For price ranges, select the value most likely to be accepted based on negotiation dynamics (not the highest or lowest).
6. If no explicit agreement exists and brand context is limited, infer conservatively or set to 0.
7. The output MUST be valid JSON only.

## CONFIDENCE GUIDELINES
- 0.9-1.0: Explicit amount confirmed by both parties
- 0.7-0.9: Strong inference from context and pricing
- 0.4-0.7: Educated estimate based on limited data
- 0.0-0.3: Minimal data available — essentially guessing

Brand Context:
${brandKnowledge ? brandKnowledge.substring(0, 2000) : 'None'}

Brand Metadata:
${JSON.stringify(brandMetadata, null, 2)}
`;

const userPrompt = `Analyze the following negotiation conversation and determine the final deal value.

Lead Name: ${lead.name}
Lead Company: ${lead.company || 'Unknown'}

Conversation Transcript:
${transcript}

Return only the JSON output: {"dealValue": number, "currency": "USD", "reasoning": "...", "confidence": 0-1}`;

    const aiRes = await generateReply(systemPrompt, userPrompt, { 
      jsonMode: true, 
      temperature: 0.1,
      model: "sales-reasoning", // Use high-reasoning model for pipeline analysis
      nga1Enforced: true
    });
    
    let dealValue = 0;
    let reasoning = "Default prediction based on company size";

    if (aiRes && aiRes.text) {
      const parsed = JSON.parse(aiRes.text);
      dealValue = typeof parsed.dealValue === 'number' ? parsed.dealValue : 
                  typeof parsed.deal_value === 'number' ? parsed.deal_value : 
                  parseFloat(parsed.dealValue) || 0;
      reasoning = parsed.reasoning || reasoning;
    }

    // PHASE 45: Predictive Fallback Logic
    // If AI fails or deal is still nascent, use RevenueIntelligence for baseline attribution
    if (dealValue === 0) {
      dealValue = RevenueIntelligence.estimateDealValue(lead);
      console.log(`📊 [Pipeline] Using predictive attribution for lead ${leadId}: $${dealValue}`);
    }

    // Save or update the deal in the pipeline
    const existingDeals = await storage.getDeals(userId);
    const existingDeal = existingDeals.find((d: any) => d.leadId === leadId || d.lead_id === leadId);

    if (existingDeal) {
      // Update existing deal
      await storage.updateDeal(existingDeal.id, userId, { 
        value: dealValue,
        status: lead.status === 'converted' || lead.status === 'booked' ? 'closed_won' : (lead.status as any),
        aiAnalysis: { ...existingDeal.aiAnalysis, offerPrice: dealValue }
      });
    } else {
      // Create new deal
      await storage.createDeal({
        userId,
        leadId,
        brand: lead.company || lead.name || 'Unknown',
        channel: lead.channel,
        value: dealValue,
        status: lead.status === 'converted' || lead.status === 'booked' ? 'closed_won' : 'open',
        aiAnalysis: { offerPrice: dealValue }
      });
    }

    // Notify clients of the update
    wsSync.notifyDealsUpdated(userId);

    return dealValue;
  } catch (error) {
    console.error('[DealEvaluator] Error evaluating deal value for lead:', leadId, error);
    return 0;
  }
}




