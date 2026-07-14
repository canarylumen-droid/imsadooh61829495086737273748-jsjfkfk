import { storage } from '@shared/lib/storage/storage.js';
import type { Lead, Message } from '@audnix/shared';

export interface PriceObjectionResult {
  detected: boolean;
  severity: 'low' | 'medium' | 'high';
  keywords: string[];
  suggestedDiscount: number;
  response: string;
}

interface NegotiationHistory {
  discountsOffered: number[];
  acceptedDiscount?: number;
  finalPrice?: number;
  stage: number; // 0: None, 1: Initial Hook, 2: Manager Escalation, 3: Last Chance
}

const PRICE_OBJECTION_KEYWORDS = {
  high: ['too expensive', 'too much', 'can\'t afford', 'out of budget', 'overpriced', 'rip off'],
  medium: ['expensive', 'pricey', 'costly', 'high price', 'a lot of money'],
  low: ['cheaper', 'discount', 'deal', 'promo', 'sale', 'lower price', 'best price']
};

/**
 * Detect price objections in message
 */
export async function detectPriceObjection(message: string): Promise<PriceObjectionResult> {
  const lowerMessage = message.toLowerCase();
  let severity: 'low' | 'medium' | 'high' = 'low';
  const foundKeywords: string[] = [];

  // Check high severity first
  for (const keyword of PRICE_OBJECTION_KEYWORDS.high) {
    if (lowerMessage.includes(keyword)) {
      severity = 'high';
      foundKeywords.push(keyword);
    }
  }

  // Check medium severity
  if (severity !== 'high') {
    for (const keyword of PRICE_OBJECTION_KEYWORDS.medium) {
      if (lowerMessage.includes(keyword)) {
        severity = 'medium';
        foundKeywords.push(keyword);
      }
    }
  }

  // Check low severity
  if (severity === 'low') {
    for (const keyword of PRICE_OBJECTION_KEYWORDS.low) {
      if (lowerMessage.includes(keyword)) {
        foundKeywords.push(keyword);
      }
    }
  }

  const detected = foundKeywords.length > 0;

  return {
    detected,
    severity,
    keywords: foundKeywords,
    suggestedDiscount: await calculateOptimalDiscount(severity, null),
    response: await generateNegotiationResponse(severity, null)
  };
}

/**
 * Calculate optimal discount based on lead score, objection severity, and current negotiation stage.
 */
export async function calculateOptimalDiscount(
  severity: 'low' | 'medium' | 'high',
  leadId: string | null
): Promise<number> {
  let baseDiscount = 0;
  let stage = 1;

  if (leadId) {
    const history = await getNegotiationHistory(leadId);
    stage = (history.stage || 0) + 1;
  }

  // --- PHASE 41: TIERED STAGING LOGIC ---
  switch (stage) {
    case 1: // Initial Hook
      baseDiscount = severity === 'high' ? 10 : 5;
      break;
    case 2: // Manager Escalation
      baseDiscount = severity === 'high' ? 18 : 12;
      break;
    case 3: // Last Chance
    default:
      baseDiscount = 25; // Hard cap
      break;
  }

  // Adjust based on lead score for "VIP" leads
  if (leadId) {
    const lead = await storage.getLeadById(leadId);
    if (lead?.score && lead.score >= 85) {
      baseDiscount += 3; // Give high-value leads a tiny bit more to close the deal
    }
  }

  return Math.min(Math.max(baseDiscount, 5), 25); // Cap between 5-25%
}

/**
 * Generate negotiation response with stage-aware psychology
 */
export async function generateNegotiationResponse(
  severity: 'low' | 'medium' | 'high',
  leadId: string | null
): Promise<string> {
  const discount = await calculateOptimalDiscount(severity, leadId);
  const history = leadId ? await getNegotiationHistory(leadId) : { stage: 0 };
  const stage = (history.stage || 0) + 1;

  const responses = {
    1: [ // Stage 1: Peer-to-Peer Friendly deal
      `I totally understand. I can offer you a ${discount}% "welcome" discount to get you started today! 🎉`,
      `Fair point! I actually have a ${discount}% off promo running this week. Would that help? 💰`,
      `I hear you. How about I give you ${discount}% off for your first 3 months to make it work? 🚀`
    ],
    2: [ // Stage 2: Manager Escalation
      `I checked with my manager, and since we'd love to work with you, I got approval for a ${discount}% discount. Does that bridge the gap? 🛡️`,
      `Understandable. I've been given an exception to offer ${discount}% off for ${severity === 'high' ? 'VIP' : 'highly engaged'} leads. Ready to roll?`,
      `I really want to make this work for you. I've secured a ${discount}% discount—this is the highest I can go without a partner sign-off. 💪`
    ],
    3: [ // Stage 3: The Final "Last Chance"
      `I've gone all the way to my CEO on this. I can offer a final ${discount}% discount, but I have to prioritize this for leads ready to start now. Are you in? 🏁`,
      `This is genuinely the best I can do. I can lock in ${discount}% off for you, but only if we finalize the booking today. Shall we?`,
      `I've pushed this as far as possible! I can offer ${discount}% off one-time. After this, I'll have to pass the spot to the next lead in line. ⏳`
    ]
  };

  const options = responses[stage as keyof typeof responses] || responses[1];
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Track negotiation history
 */
async function getNegotiationHistory(leadId: string): Promise<NegotiationHistory> {
  const lead = await storage.getLeadById(leadId);
  if (!lead?.metadata?.negotiationHistory) {
    return { discountsOffered: [], stage: 0 };
  }
  return lead.metadata.negotiationHistory as NegotiationHistory;
}

/**
 * Save negotiation attempt
 */
export async function saveNegotiationAttempt(
  leadId: string,
  discountOffered: number,
  accepted: boolean = false
): Promise<void> {
  const lead = await storage.getLeadById(leadId);
  if (!lead) return;

  const history = await getNegotiationHistory(leadId);
  history.discountsOffered.push(discountOffered);
  history.stage = (history.stage || 0) + 1;

  if (accepted) {
    history.acceptedDiscount = discountOffered;
  }

  await storage.updateLead(leadId, {
    metadata: {
      ...lead.metadata,
      negotiationHistory: history,
      lastNegotiation: new Date().toISOString()
    }
  });
}

/**
 * Learn optimal discount from successful conversions
 */
export async function learnOptimalDiscount(userId: string): Promise<number> {
  const leads = await storage.getLeads({ userId, limit: 1000 });
  const convertedLeads = leads.filter(l => l.status === 'converted');

  const acceptedDiscounts = convertedLeads
    .map(l => l.metadata?.negotiationHistory?.acceptedDiscount)
    .filter(d => d !== undefined) as number[];

  if (acceptedDiscounts.length === 0) return 10; // Default 10%

  // Calculate average successful discount
  const avgDiscount = acceptedDiscounts.reduce((sum, d) => sum + d, 0) / acceptedDiscounts.length;
  return Math.round(avgDiscount);
}



