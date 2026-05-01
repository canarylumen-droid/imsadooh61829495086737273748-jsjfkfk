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
    const systemPrompt = `You are an elite revenue intelligence analyst specializing in extracting finalized commercial deal values from negotiation conversations.

Your task is to analyze a conversation transcript and determine the FINAL agreed or most likely deal value in USD.

Follow these strict rules:

1. Identify explicit monetary amounts mentioned in the conversation.
2. If multiple values appear, prioritize the FINAL agreed amount or the latest confirmed offer.
3. Use the Brand Context and Brand Metadata below to understand standard pricing if the conversation is ambiguous but mentions specific products/packages.
4. If the deal is discussed in a currency other than USD, convert it logically to USD.
5. If a price range is mentioned, select the value that appears most likely to be accepted based on negotiation intent (interest level, urgency).
6. If no explicit agreement exists, infer the most probable value based on the Brand's standard offers.
- The output MUST be valid JSON.

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
      model: "sales-reasoning" // Use high-reasoning model for pipeline analysis
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




