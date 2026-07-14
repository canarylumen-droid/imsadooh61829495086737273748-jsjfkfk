/**
 * MULTI-OBJECTION STATE MACHINE
 * ==============================
 * Cross-conversation intelligence layer for objection handling.
 *
 * Every time a lead objects, this machine:
 *   1. Records the objection with full context (text, category, hidden block, intensity)
 *   2. Classifies the lead's psychological PROFILE (fence-sitter, price-hunter, trust-seeker, etc.)
 *   3. Selects the next BEST TACTIC — never repeating something that already failed
 *   4. Escalates intensity level 0→4 across multiple objections
 *   5. Flags leads for human review at escalation level 4+
 *   6. Generates a rich system-prompt block so the AI knows EXACTLY what to do
 *
 * Scale design: all state lives in leads.metadata.objectionState (Postgres).
 * Functions are purely stateless — safe for millions of concurrent leads.
 */

import { db, withDbRetry } from '@shared/lib/db/db.js';
import { leads } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { getCustomObjections, type CustomObjection } from '@shared/lib/storage/custom-training-storage.js';

// Simple inline logger — keeps shared lib self-contained (no api-gateway dependency)
const log = {
  info:  (msg: string, meta?: object) => console.log(`[OSM] ${msg}`, meta || ''),
  error: (msg: string, meta?: object) => console.error(`[OSM] ${msg}`, meta || ''),
  warn:  (msg: string, meta?: object) => console.warn(`[OSM] ${msg}`, meta || ''),
};

// ─── Type Definitions ─────────────────────────────────────────────────────────

export type ObjectionCategory =
  | 'timing'       // "not now", "too busy", "come back later"
  | 'price'        // "too expensive", "can't afford", "need a discount"
  | 'trust'        // "I don't believe it works", "sounds too good"
  | 'authority'    // "need to check with team/boss/partner"
  | 'fit'          // "not for my industry", "doesn't apply to me"
  | 'competitor'   // "I already use X", "how are you different from Y"
  | 'risk'         // "what if it doesn't work", "scared to commit"
  | 'information'  // "I need more details before deciding"
  | 'generic';     // catch-all for vague soft-nos

export type LeadProfile =
  | 'fence-sitter'           // 3+ objections, different categories — needs commitment device
  | 'price-hunter'           // keeps coming back to price — ROI framing, not more discounts
  | 'authority-seeker'       // always needs to check with someone — include stakeholders
  | 'trust-seeker'           // needs proof, guarantees, case studies before committing
  | 'pauser'                 // timing objections repeatedly — needs urgency without pressure
  | 'competitor-evaluator'   // comparing tools — battle card + clear differentiation
  | 'sophisticated-objector' // logical, specific, analytical — needs data, not emotion
  | 'unknown';

export type TacticType =
  | 'reframe'            // shift their perspective — show why their concern is already solved
  | 'social_proof'       // specific client story: same concern → real results, 2 sentences
  | 'urgency'            // real, believable cost of waiting — tied to their niche
  | 'curiosity'          // drop one insight that makes them want to know more
  | 'stakeholder_invite' // "let's get your team on a quick call" — collaborative, not pressured
  | 'roi_calculator'     // show the math in their world — one deal pays for X months
  | 'guarantee'          // risk reversal — trial, money-back, performance guarantee
  | 'pilot_offer'        // "try it 2 weeks, no commitment, see real results"
  | 'competitor_battle'  // confident differentiation, not competitor-bashing
  | 'assumed_close'      // write as if they're already saying yes — natural next step
  | 'final_push';        // last message before backing off — scarcity + identity + stakes

export interface ObjectionAttempt {
  objectionText: string;         // exact quote (max 200 chars)
  category: ObjectionCategory;   // classified type
  hiddenObjection: string;       // the real psychological block beneath what they said
  intensity: number;             // 0-100 how strongly they pushed back
  tacticUsed: TacticType;        // what tactic we used in our response
  tacticSummary: string;         // brief description of the reply we sent
  sentAt: string;                // ISO date
  outcome: 'objected_again' | 'positive_shift' | 'converted' | 'ghosted' | 'pending';
}

export interface LeadObjectionState {
  version: 2;
  totalObjections: number;
  history: ObjectionAttempt[];
  categoriesRaised: ObjectionCategory[];
  exhaustedTactics: Record<string, TacticType[]>; // category → tactics already used
  escalationLevel: number;        // 0-4
  profileType: LeadProfile;
  profileConfidence: number;      // 0-1
  lastObjectionAt: string;
  flaggedForHumanReview: boolean;
  humanReviewReason?: string;
}

export interface ObjectionDecision {
  state: LeadObjectionState;
  nextTactic: TacticType;
  systemPromptBlock: string;     // ready to inject into the AI system prompt
  shouldFlagForHuman: boolean;
}

export interface UserBusinessContext {
  businessName?: string;
  coreOffer?: string;
  userIndustry?: string;
  leadNiche?: string;
  prioritizeCalls?: boolean;
}

// ─── State I/O ────────────────────────────────────────────────────────────────

const METADATA_KEY = 'objectionState';

/** Read the current objection state for a lead from Postgres metadata */
export async function getLeadObjectionState(leadId: string): Promise<LeadObjectionState> {
  const lead = await storage.getLeadById(leadId);
  const stored = (lead?.metadata as any)?.[METADATA_KEY];

  if (stored && stored.version === 2) {
    return stored as LeadObjectionState;
  }

  // Fresh state — first objection
  return {
    version: 2,
    totalObjections: 0,
    history: [],
    categoriesRaised: [],
    exhaustedTactics: {},
    escalationLevel: 0,
    profileType: 'unknown',
    profileConfidence: 0,
    lastObjectionAt: new Date().toISOString(),
    flaggedForHumanReview: false,
  };
}

/** Write updated objection state back to Postgres lead metadata */
export async function saveLeadObjectionState(
  leadId: string,
  userId: string,
  state: LeadObjectionState
): Promise<void> {
  try {
    const lead = await storage.getLeadById(leadId);
    if (!lead) return;

    await withDbRetry(() =>
      db.update(leads)
        .set({
          metadata: {
            ...(lead.metadata as Record<string, unknown> || {}),
            [METADATA_KEY]: state,
          }
        })
        .where(and(eq(leads.id, leadId), eq(leads.userId, userId)))
    );
  } catch (e: any) {
    log.error('[OSM] Failed to save objection state', { leadId, error: e.message });
  }
}

/** Update the outcome of the PREVIOUS attempt (called when lead replies again) */
export async function recordPreviousAttemptOutcome(
  leadId: string,
  userId: string,
  outcome: ObjectionAttempt['outcome']
): Promise<void> {
  const state = await getLeadObjectionState(leadId);
  if (state.history.length === 0) return;

  const last = state.history[state.history.length - 1];
  if (last.outcome === 'pending') {
    last.outcome = outcome;
    await saveLeadObjectionState(leadId, userId, state);
  }
}

// ─── Core Intelligence ────────────────────────────────────────────────────────

/**
 * Classify the lead's psychological objection profile based on their full history.
 * This drives which tactic priority list we use.
 */
export function classifyLeadProfile(history: ObjectionAttempt[]): {
  profile: LeadProfile;
  confidence: number;
} {
  if (history.length < 1) return { profile: 'unknown', confidence: 0 };

  const categories = history.map(h => h.category);
  const uniqueCategories = new Set(categories);
  const counts: Record<string, number> = {};
  for (const c of categories) counts[c] = (counts[c] || 0) + 1;

  // fence-sitter: 3+ objections across 3+ different categories
  if (history.length >= 3 && uniqueCategories.size >= 3) {
    return { profile: 'fence-sitter', confidence: 0.88 };
  }

  // price-hunter: 2+ price objections
  if ((counts['price'] || 0) >= 2) {
    return { profile: 'price-hunter', confidence: 0.92 };
  }

  // pauser: 2+ timing objections
  if ((counts['timing'] || 0) >= 2) {
    return { profile: 'pauser', confidence: 0.87 };
  }

  // authority-seeker: any authority objection
  if ((counts['authority'] || 0) >= 1) {
    return { profile: 'authority-seeker', confidence: 0.82 };
  }

  // trust-seeker: trust or risk objections
  if ((counts['trust'] || 0) + (counts['risk'] || 0) >= 1) {
    return { profile: 'trust-seeker', confidence: 0.78 };
  }

  // competitor-evaluator
  if ((counts['competitor'] || 0) >= 1) {
    return { profile: 'competitor-evaluator', confidence: 0.91 };
  }

  // sophisticated-objector: information objections with multiple exchanges
  if ((counts['information'] || 0) >= 1 && history.length >= 2) {
    return { profile: 'sophisticated-objector', confidence: 0.73 };
  }

  // Generic single objection — classify by that category
  if (history.length === 1) {
    const cat = history[0].category;
    const singleMap: Partial<Record<ObjectionCategory, LeadProfile>> = {
      price: 'price-hunter',
      timing: 'pauser',
      trust: 'trust-seeker',
      authority: 'authority-seeker',
      competitor: 'competitor-evaluator',
      information: 'sophisticated-objector',
    };
    return { profile: singleMap[cat] || 'unknown', confidence: 0.5 };
  }

  return { profile: 'unknown', confidence: 0.3 };
}

/**
 * Select the next best tactic for this objection.
 * Never repeats a tactic that was already used for this category.
 * Escalation level overrides at levels 3-4.
 */
export function selectNextTactic(
  state: LeadObjectionState,
  currentCategory: ObjectionCategory
): TacticType {
  const used = new Set(state.exhaustedTactics[currentCategory] || []);
  const level = state.escalationLevel;
  const profile = state.profileType;

  // Hard escalation overrides
  if (level >= 4) return 'final_push';
  if (level === 3 && !used.has('assumed_close')) return 'assumed_close';
  if (level === 3) return 'final_push';

  // Profile-specific tactic priority lists (ordered: best first)
  const PROFILE_TACTICS: Record<LeadProfile, TacticType[]> = {
    'fence-sitter':           ['social_proof', 'pilot_offer', 'roi_calculator', 'urgency', 'guarantee', 'assumed_close', 'final_push'],
    'price-hunter':           ['roi_calculator', 'guarantee', 'pilot_offer', 'social_proof', 'reframe', 'urgency', 'final_push'],
    'authority-seeker':       ['stakeholder_invite', 'social_proof', 'pilot_offer', 'guarantee', 'roi_calculator', 'assumed_close', 'final_push'],
    'trust-seeker':           ['social_proof', 'guarantee', 'pilot_offer', 'roi_calculator', 'reframe', 'urgency', 'final_push'],
    'pauser':                 ['curiosity', 'reframe', 'urgency', 'roi_calculator', 'pilot_offer', 'social_proof', 'final_push'],
    'competitor-evaluator':   ['competitor_battle', 'social_proof', 'roi_calculator', 'guarantee', 'pilot_offer', 'reframe', 'final_push'],
    'sophisticated-objector': ['roi_calculator', 'social_proof', 'competitor_battle', 'guarantee', 'reframe', 'pilot_offer', 'final_push'],
    'unknown':                ['reframe', 'social_proof', 'curiosity', 'pilot_offer', 'urgency', 'roi_calculator', 'final_push'],
  };

  const priorities = PROFILE_TACTICS[profile] || PROFILE_TACTICS['unknown'];

  // Return first unused tactic from priority list
  for (const tactic of priorities) {
    if (!used.has(tactic)) return tactic;
  }

  // All tactics exhausted — final push
  return 'final_push';
}

/**
 * Process an incoming objection — update state, select tactic, return decision.
 * This is the MAIN entry point called when an objection is detected.
 */
/**
 * Check if the inbound objection matches any user-defined custom objections.
 * Uses substring matching and keyword overlap calculation for high precision.
 */
export function findMatchingCustomObjection(
  objectionText: string,
  customObjections: CustomObjection[]
): CustomObjection | null {
  if (customObjections.length === 0) return null;
  const lowerText = objectionText.toLowerCase();

  let bestMatch: CustomObjection | null = null;
  let maxOverlap = 0;

  for (const co of customObjections) {
    const pattern = co.objection.toLowerCase();
    
    // Substring match
    if (lowerText.includes(pattern)) {
      return co;
    }

    // Keyword overlap matching
    const keywords = pattern.split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) continue;
    
    let overlap = 0;
    for (const kw of keywords) {
      if (lowerText.includes(kw)) {
        overlap++;
      }
    }

    if (overlap > maxOverlap && overlap >= Math.ceil(keywords.length * 0.6)) {
      maxOverlap = overlap;
      bestMatch = co;
    }
  }

  return bestMatch;
}

export async function processObjection(params: {
  leadId: string;
  userId: string;
  leadName: string;
  objectionText: string;
  category: ObjectionCategory;
  hiddenObjection: string;
  intensity: number;
  businessContext?: UserBusinessContext;
}): Promise<ObjectionDecision> {
  const { leadId, userId, leadName, objectionText, category, hiddenObjection, intensity, businessContext } = params;

  // 1. Load custom objections to see if they override the detected category
  const customObjections = await getCustomObjections(userId).catch(() => []);
  const matchingCustom = findMatchingCustomObjection(objectionText, customObjections);

  // Map custom objection category to state machine category if matched
  const categoryMap: Record<string, ObjectionCategory> = {
    timing: 'timing',
    price: 'price',
    trust: 'trust',
    authority: 'authority',
    fit: 'fit',
    competitor: 'competitor',
    decision: 'authority',
    general: 'generic'
  };

  let finalCategory = category;
  if (matchingCustom && matchingCustom.category) {
    const mapped = categoryMap[matchingCustom.category];
    if (mapped) {
      finalCategory = mapped;
    }
  }

  // 2. Load current state
  const state = await getLeadObjectionState(leadId);

  // 3. If there's a previous pending attempt, mark it as objected_again
  if (state.history.length > 0) {
    const last = state.history[state.history.length - 1];
    if (last.outcome === 'pending') {
      last.outcome = 'objected_again';
    }
  }

  // 4. Update state with this new objection
  state.totalObjections++;
  if (!state.categoriesRaised.includes(finalCategory)) {
    state.categoriesRaised.push(finalCategory);
  }
  state.escalationLevel = Math.min(state.totalObjections - 1, 4);
  state.lastObjectionAt = new Date().toISOString();

  // 5. Reclassify profile based on updated history
  const { profile, confidence } = classifyLeadProfile(state.history);
  state.profileType = profile;
  state.profileConfidence = confidence;

  // 6. Select next tactic
  const nextTactic = selectNextTactic(state, finalCategory);

  // 7. Record this attempt as pending (outcome filled in later)
  const attempt: ObjectionAttempt = {
    objectionText: objectionText.substring(0, 200),
    category: finalCategory,
    hiddenObjection,
    intensity,
    tacticUsed: nextTactic,
    tacticSummary: '', // filled in after reply is generated
    sentAt: new Date().toISOString(),
    outcome: 'pending',
  };
  state.history.push(attempt);

  // 8. Mark tactic as exhausted for this category
  if (!state.exhaustedTactics[finalCategory]) state.exhaustedTactics[finalCategory] = [];
  if (!state.exhaustedTactics[finalCategory].includes(nextTactic)) {
    state.exhaustedTactics[finalCategory].push(nextTactic);
  }

  // 9. Check if we should flag for human review
  const shouldFlagForHuman = state.escalationLevel >= 4 || state.totalObjections >= 5;
  if (shouldFlagForHuman && !state.flaggedForHumanReview) {
    state.flaggedForHumanReview = true;
    state.humanReviewReason = `Lead has objected ${state.totalObjections} times. Profile: ${profile}. All major tactics exhausted.`;
  }

  // 10. Save updated state
  await saveLeadObjectionState(leadId, userId, state);

  // 11. Build system prompt block
  const systemPromptBlock = buildSystemPromptBlock(
    state,
    {
      currentCategory: finalCategory,
      currentHiddenObjection: hiddenObjection,
      nextTactic,
      leadName,
    },
    matchingCustom,
    businessContext
  );

  log.info(`[OSM] Objection #${state.totalObjections} processed for lead ${leadId}`, {
    category: finalCategory,
    profile,
    tactic: nextTactic,
    escalationLevel: state.escalationLevel,
    flaggedForHuman: shouldFlagForHuman,
    customMatch: !!matchingCustom,
  });

  return { state, nextTactic, systemPromptBlock, shouldFlagForHuman };
}

/** Update the tactic summary in the last history entry after reply is sent */
export async function recordTacticSent(
  leadId: string,
  userId: string,
  tacticSummary: string
): Promise<void> {
  const state = await getLeadObjectionState(leadId);
  if (state.history.length === 0) return;

  const last = state.history[state.history.length - 1];
  last.tacticSummary = tacticSummary.substring(0, 200);
  await saveLeadObjectionState(leadId, userId, state);
}

// ─── System Prompt Block Builder ──────────────────────────────────────────────

export function getTacticInstructions(tactic: TacticType, ctx?: UserBusinessContext): string {
  const bizName = ctx?.businessName || "our platform";
  const offer = ctx?.coreOffer || "our solution";
  const userInd = ctx?.userIndustry || "our industry";
  const niche = ctx?.leadNiche || "your industry";
  const prioritizeCalls = ctx?.prioritizeCalls !== false;

  const instructions: Record<TacticType, string> = {
    reframe: prioritizeCalls
      ? `REFRAME — Shift their perspective completely. Show them why their concern is already solved by ${bizName}'s ${offer} in the context of the ${niche} industry. DO NOT quote pricing or offer discounts. Insist that the best way to address this is a quick 10-minute call to see how it fits their workflow. End with one question inviting them to book a call.`
      : `REFRAME — Shift their perspective completely. Show them why their concern is already solved by ${bizName}'s ${offer} in the ${niche} space. Be confident and direct. Don't apologize. One powerful reframe, then one closing question.`,

    social_proof: `SOCIAL PROOF — Tell a SHORT, SPECIFIC story of a real similar client in the ${niche} industry who had the EXACT same hesitation about ${offer} but saw outstanding results. 2 sentences MAX. Then ask ONE sharp question that makes them imagine the same result for themselves.`,

    urgency: `URGENCY — Create a believable, specific cost of waiting. Connect it to what's happening in ${niche} right now. NOT fake scarcity. Something like: "While you're thinking, other ${niche} businesses are already using ${bizName} to stay ahead." Then ask one question.`,

    curiosity: `CURIOSITY — Don't push. Drop ONE specific, surprising market insight about ${niche} or how ${offer} solves a hidden bottleneck for them. Just one sentence. Then one question. No pitch. No pressure. Just make them curious.`,

    stakeholder_invite: `STAKEHOLDER INCLUDE — Bring their team/boss/partner INTO the conversation instead of waiting for permission. "Why don't we get your team on a quick 10-minute call — I can walk everyone through how ${bizName} integrates with your workflow and answer questions live." Collaborative, not pushy.`,

    roi_calculator: prioritizeCalls
      ? `ROI FRAMING — Show the high-level ROI potential in ${niche}'s world. DO NOT negotiate price, quote specific prices, or adjust pricing. Instead, insist they join a brief call to see the ROI model and look at a custom plan. End by inviting them to a quick 10-minute call to run their specific numbers.`
      : `ROI FRAMING — Show the math in ${niche}'s world. "If ${bizName} brings you just one extra deal or client per week, you're looking at significant returns by end of month. The investment in ${offer} pays for itself from day one." Then ask: "Does that math make sense for you?"`,

    guarantee: prioritizeCalls
      ? `RISK REVERSAL — Remove their risk entirely. A hesitant person needs to feel safe, not sold. Mention that our terms, trials, or performance-based options of ${offer} are designed to protect them, but DO NOT negotiate terms or quote prices here. Insist they join a brief call to discuss how we guarantee results for their business. End by asking for a quick call to map out a low-risk option.`
      : `RISK REVERSAL — Remove their risk entirely. A hesitant person needs to feel safe, not sold. Mention the trial period, money-back option, or performance-based terms of ${offer}. End with: "You don't actually risk anything by trying ${bizName}." Then make it easy: "Want to kick off the trial this week?"`,

    pilot_offer: prioritizeCalls
      ? `PILOT OFFER — Offer a low-barrier, no-commitment pilot of ${offer} to see results first, but DO NOT quote pilot pricing or make custom price adjustments. Insist they join a brief call to customize and activate the pilot. End by asking if they have 10 minutes to set up the pilot parameters on a call.`
      : `PILOT OFFER — Dramatically lower the barrier. "Let's not do the full onboarding yet — start with a 2-week pilot of ${offer}, no commitment. You'll see real results in your pipeline before you decide anything." Then: "Want to start Monday?" Simple, low-stakes, high-appeal.`,

    competitor_battle: `DIFFERENTIATION — Address the competitor directly and confidently. DON'T bash them — just be specific about what separates ${bizName} in the ${userInd} space. Lead with one capability of ${offer} they don't have, then one result proof point. End with: "Worth a quick comparison before you decide?"`,

    assumed_close: `ASSUMED CLOSE — Write as if they're already saying yes to ${bizName} and the only question is logistics. "So should we kick this off this week or next week? — I want to make sure you get priority onboarding for ${offer}." Make saying yes feel like the natural next step.`,

    final_push: prioritizeCalls
      ? `FINAL PUSH — This is your last message before you back off entirely. Make it count. Be direct and respectful. Under no circumstances quote pricing, adjust pricing, or negotiate. Respectfully state that if they'd like to explore how ${bizName} can work for them in the ${niche} space, booking a call is the only option. Ask one simple question to see if they'd like to book a call, otherwise respect their space.`
      : `FINAL PUSH — This is your last message before you back off entirely. Make it count. Be direct and respectful. Something like: "I don't want to waste your time or mine — so I'll be straight: I genuinely think ${bizName} will work for you in the ${niche} space, but if it's not the right fit, that's okay too. Just let me know either way and I'll respect it." Then give them ONE clear, easy decision to make.`,
  };

  return instructions[tactic];
}

export function getProfileContext(profile: LeadProfile, ctx?: UserBusinessContext): string {
  const bizName = ctx?.businessName || "our platform";
  const offer = ctx?.coreOffer || "our solution";
  const niche = ctx?.leadNiche || "your industry";
  const prioritizeCalls = ctx?.prioritizeCalls !== false;

  const profiles: Record<LeadProfile, string> = {
    'fence-sitter': prioritizeCalls
      ? `Profile: FENCE-SITTER — This lead IS interested in ${bizName} but can't pull the trigger. They're not saying no to the product — they're saying no to COMMITTING. DO NOT negotiate price or offer discounts. Insist they jump on a quick call to talk details and address their questions directly.`
      : `Profile: FENCE-SITTER — This lead IS interested in ${bizName} but can't pull the trigger. They're not saying no to the product — they're saying no to COMMITTING. Don't discount further. Don't give more info. Give them a LOW-RISK commitment device that makes saying yes feel small and reversible.`,

    'price-hunter': prioritizeCalls
      ? `Profile: PRICE-HUNTER — They keep coming back to the cost of ${offer}. Under no circumstances negotiate price or offer discounts here. Insist that custom pricing and ROI calculations require a brief 10-minute discovery call. Pivot the conversation entirely to booking a call to get their custom numbers.`
      : `Profile: PRICE-HUNTER — They keep coming back to the cost of ${offer}. More discounts won't help. Pivot to ROI framing: the cost of NOT doing this vs. the cost of doing it. Make the math obvious in the ${niche} industry.`,

    'authority-seeker': `Profile: AUTHORITY-SEEKER — They're interested in ${offer} but don't have decision-making power alone. Stop waiting for permission — help them sell it internally. Offer a group call. Make them the hero to their boss.`,

    'trust-seeker': `Profile: TRUST-SEEKER — They're skeptical about ${bizName}'s capabilities. They need to SEE it work before they believe it. Give them proof: a case study, a guarantee, or a no-commitment trial.`,

    'pauser': `Profile: PAUSER — They always have a timing objection. "Not now" is their comfort zone. Create a real cost to waiting in their niche — not fake urgency. Show them what's moving in ${niche} right now while they're pausing.`,

    'competitor-evaluator': `Profile: COMPETITOR-EVALUATOR — They're comparing ${bizName} with other options. Be clear, confident, and specific about what makes you different. One capability they don't have elsewhere.`,

    'sophisticated-objector': `Profile: SOPHISTICATED-OBJECTOR — This lead is analytical. They ask specific questions and want real answers, not sales speak. Give them data on ${offer}. Be direct. Treat them like an intelligent peer.`,

    'unknown': `Profile: UNKNOWN — Early stage, limited pattern data. Use a balanced approach — acknowledge their concern, add value, create a low-pressure path forward.`,
  };

  return profiles[profile];
}

const ESCALATION_CONTEXT: Record<number, string> = {
  0: `Escalation: LEVEL 0 — First objection. Be understanding. One clean reframe + one question. Don't push too hard.`,
  1: `Escalation: LEVEL 1 — Second objection. They're holding back. Step up your story and specificity. Match their energy.`,
  2: `Escalation: LEVEL 2 — Third objection. They're persistent. Use a higher-value tactic. Be more direct. Create a real reason to move now.`,
  3: `Escalation: LEVEL 3 — FOURTH OBJECTION. This is HIGH-STAKES. One sharp assumed close or final push. Write with full conviction.`,
  4: `Escalation: LEVEL 4 — FIFTH+ OBJECTION. This is your last shot. Be real with them. Direct, respectful, no fluff. Make one clear ask and back off.`,
};

function buildSystemPromptBlock(
  state: LeadObjectionState,
  current: {
    currentCategory: ObjectionCategory;
    currentHiddenObjection: string;
    nextTactic: TacticType;
    leadName: string;
  },
  matchingCustom: CustomObjection | null,
  businessContext?: UserBusinessContext
): string {
  const { currentCategory, currentHiddenObjection, nextTactic, leadName } = current;

  // Only show last 5 attempts to keep prompt tight
  const historyLines = state.history.slice(-5, -1).map((h, i) =>
    `  #${i + 1} [${h.category}]: "${h.objectionText.substring(0, 70)}..." → Tactic: ${h.tacticUsed} → Result: ${h.outcome}`
  ).join('\n') || '  (This is their first objection)';

  const exhaustedForCurrent = (state.exhaustedTactics[currentCategory] || [])
    .filter(t => t !== nextTactic)
    .join(', ') || 'none';

  const level = Math.min(state.escalationLevel, 4);

  let customTacticBlock = '';
  if (matchingCustom) {
    customTacticBlock = `
[⭐ CRITICAL USER-DEFINED INSTRUCTION OVERRIDE]
The user has trained you with a specific instruction for handling: "${matchingCustom.objection}"
Preferred Response / Handling Instruction: "${matchingCustom.response}"

YOU MUST PRIORITIZE THIS INSTRUCTION above any other tactic guidelines. Adopt the suggested phrasing and angles.
`;
  }

  return `
[⚡ OBJECTION STATE MACHINE — PRIORITY INTELLIGENCE — READ THIS FIRST]

${leadName} has objected ${state.totalObjections} time(s) total. 

OBJECTION HISTORY (previous attempts):
${historyLines}

CURRENT OBJECTION #${state.totalObjections}:
  What they said: "${currentCategory}"
  What they REALLY mean (hidden block): "${currentHiddenObjection}"
  Intensity: ${state.history[state.history.length - 1]?.intensity || 50}/100
${customTacticBlock}
${getProfileContext(state.profileType, businessContext)}

${ESCALATION_CONTEXT[level]}

TACTICS ALREADY USED FOR [${currentCategory}] objections (DO NOT REPEAT THESE): ${exhaustedForCurrent}

YOUR ASSIGNED TACTIC FOR THIS REPLY: ${nextTactic.toUpperCase().replace('_', ' ')}
${getTacticInstructions(nextTactic, businessContext)}

NON-NEGOTIABLE RULES FOR THIS REPLY:
1. NEVER repeat a reframe, story, or angle already used with this lead
2. Make it feel like YOU remember this conversation — because you do
3. Reference their previous objection pattern naturally if it helps ("I noticed you've mentioned timing a couple times...")  
4. Sound like a REAL sales rep who's been in this conversation — not an AI regenerating a template
5. Keep it SHORT. DMs: max 3 sentences. Email: max 2 short paragraphs.
6. End with ONE specific, easy-to-answer question or action — never multiple asks
7. No "I understand", no "That's a great point", no corporate filler
${state.escalationLevel >= 3 ? '8. HIGH STAKES REPLY: Write with full confidence and conviction. This matters.' : ''}
${state.flaggedForHumanReview ? '9. HUMAN REVIEW FLAG: After this message, escalate to human rep for follow-up.' : ''}
`.trim();
}

// ─── Utility: Classify objection from raw text (fast, no AI call) ─────────────

const OBJECTION_SIGNALS: Record<ObjectionCategory, string[]> = {
  timing:     ['not now', 'too busy', 'come back', 'later', 'next month', 'next quarter', 'bad timing', 'wrong time', 'not the right time', 'let me get back', 'maybe later'],
  price:      ['too expensive', 'too much', "can't afford", 'out of budget', 'overpriced', 'cheaper', 'discount', 'lower price', 'costly', 'pricey', 'high price'],
  trust:      ["doesn't work", 'not sure it works', 'sounds too good', 'skeptical', "don't believe", 'prove it', 'seen these before', 'works for others'],
  authority:  ['check with', 'talk to', 'my team', 'my boss', 'my partner', 'partner needs to', 'need approval', 'run it by', 'get sign off'],
  fit:        ['not for me', "doesn't apply", 'my industry', 'not relevant', 'different situation', 'not what i need', "doesn't fit"],
  competitor: ['already use', 'currently using', 'have a tool', 'use apollo', 'use instantly', 'use hubspot', 'use x', 'already have something'],
  risk:       ["what if it doesn't", 'scared', 'worried', 'risky', 'what if i', 'no guarantee', 'risk', 'commitment'],
  information:['more details', 'more info', 'send me', 'learn more', 'tell me more', 'what exactly', 'how does it', 'before i decide'],
  generic:    ['not interested', 'no thanks', 'maybe', "i'll think", 'let me think', 'not sure', 'hmm'],
};

/**
 * Fast keyword-based classifier — no AI call required, used for quick pre-classification.
 * The hidden objection is then filled by the AI in the main generation flow.
 */
export function classifyObjectionFromText(text: string): {
  category: ObjectionCategory;
  confidence: number;
} {
  const lower = text.toLowerCase();
  const scores: Partial<Record<ObjectionCategory, number>> = {};

  for (const [category, signals] of Object.entries(OBJECTION_SIGNALS) as [ObjectionCategory, string[]][]) {
    let score = 0;
    for (const signal of signals) {
      if (lower.includes(signal)) score++;
    }
    if (score > 0) scores[category] = score;
  }

  if (Object.keys(scores).length === 0) {
    return { category: 'generic', confidence: 0.5 };
  }

  // Pick highest scoring category
  const best = Object.entries(scores).sort(([, a], [, b]) => b - a)[0];
  const maxPossible = OBJECTION_SIGNALS[best[0] as ObjectionCategory].length;
  const confidence = Math.min(0.95, 0.5 + (best[1] / maxPossible) * 0.5);

  return { category: best[0] as ObjectionCategory, confidence };
}

/**
 * Estimate objection intensity from message text (0-100).
 * Used to calibrate response energy — a mild "maybe later" needs less firepower than
 * an aggressive "this is way too expensive and I'm not interested".
 */
export function estimateObjectionIntensity(text: string): number {
  const lower = text.toLowerCase();
  let score = 30; // baseline

  // Strong negative signals
  const strongSignals = ['never', 'absolutely not', 'no way', 'stop emailing', 'remove me', "don't contact", 'ridiculous', 'scam'];
  const mediumSignals = ['not interested', 'too expensive', 'definitely not', 'pass', "won't work", 'not for us'];
  const mildSignals = ['maybe', 'not sure', 'let me think', "i'll consider", 'hmm', 'perhaps'];

  for (const s of strongSignals) if (lower.includes(s)) score += 30;
  for (const s of mediumSignals) if (lower.includes(s)) score += 20;
  for (const s of mildSignals) if (lower.includes(s)) score += 10;

  // Exclamation marks = more intensity
  const exclamations = (text.match(/!/g) || []).length;
  score += Math.min(exclamations * 5, 20);

  return Math.min(score, 100);
}
