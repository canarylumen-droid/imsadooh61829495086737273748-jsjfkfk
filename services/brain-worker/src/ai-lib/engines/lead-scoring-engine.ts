import type { Lead, Message } from '@audnix/shared';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

export type LeadScoreCategory = 'A' | 'B' | 'C' | 'D';

export interface LeadScoreResult {
  score: number;
  category: LeadScoreCategory;
  reasons: string[];
}

/**
 * AI Lead Scoring Engine (Phase 3 - Production Calibrated)
 *
 * Heuristic model scoring 0-100 across four dimensions:
 * 1. Firmographic (30pts) — Company size, industry fit
 * 2. Interaction Depth (25pts) — Message count, reply velocity
 * 3. Intent Signals (35pts) — Buying signals, objections, sentiment
 * 4. Enrichment Quality (10pts) — How confident we are in the data
 *
 * Categories: A ≥ 80 | B ≥ 60 | C ≥ 40 | D < 40
 */
export class LeadScoringEngine {

  /**
   * Calculate a comprehensive score for a lead
   */
  async calculateScore(lead: any, messages: any[], intent?: any): Promise<LeadScoreResult> {
    let score = 0;
    const reasons: string[] = [];
    const metadata = lead.metadata || {};

    // ━━━ 1. FIRMOGRAPHIC (30 pts) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const companySize = metadata.companySize || 'Unknown';

    const companySizeScore: Record<string, number> = {
      '500+': 30,
      '201-500': 25,
      '51-200': 18,
      '11-50': 12,
      '1-10': 6,
    };

    if (companySizeScore[companySize] !== undefined) {
      score += companySizeScore[companySize];
      reasons.push(`Company size: ${companySize} employees (+${companySizeScore[companySize]})`);
    }

    const industry = (metadata.industry || '').toLowerCase();
    const highFitIndustries = ['saas', 'software', 'tech', 'fintech', 'ai', 'cloud', 'cybersecurity', 'ecommerce', 'marketing'];
    const medFitIndustries = ['consulting', 'agency', 'media', 'healthcare tech', 'real estate tech', 'logistics'];

    if (highFitIndustries.some(i => industry.includes(i))) {
      score += 10;
      reasons.push(`High-fit industry (${metadata.industry})`);
    } else if (medFitIndustries.some(i => industry.includes(i))) {
      score += 5;
      reasons.push(`Moderate-fit industry (${metadata.industry})`);
    }

    // ━━━ 2. INTERACTION DEPTH (25 pts) ━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const inbound = messages.filter((m: any) => m.direction === 'inbound');
    const msgCount = inbound.length;

    if (msgCount >= 5) {
      score += 25;
      reasons.push('Deeply engaged (5+ replies)');
    } else if (msgCount >= 3) {
      score += 18;
      reasons.push('Engaged (3+ replies)');
    } else if (msgCount >= 1) {
      score += 8;
      reasons.push('Initial engagement (1-2 replies)');
    }

    // Reply velocity signal — answered within 24h = warm lead
    if (messages.length >= 2) {
      const outbound = messages.filter((m: any) => m.direction === 'outbound');
      const firstOutbound = outbound[0];
      const firstInbound = inbound[0];
      if (firstOutbound && firstInbound) {
        const replyHours = (new Date(firstInbound.createdAt).getTime() - new Date(firstOutbound.createdAt).getTime()) / 3600000;
        if (replyHours < 2) { score += 7; reasons.push('Lightning reply (<2h)'); }
        else if (replyHours < 24) { score += 4; reasons.push('Fast reply (<24h)'); }
      }
    }

    // ━━━ 3. INTENT & SENTIMENT (35 pts) ━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (intent) {
      if (intent.readyToBuy) {
        score += 35;
        reasons.push('Explicit "Ready to Buy" signal');
      } else if (intent.wantsToSchedule) {
        score += 25;
        reasons.push('Wants to schedule a demo');
      } else if (intent.isInterested) {
        score += 15;
        reasons.push('Expressed positive interest');
      }

      if (intent.hasObjection) {
        score -= 5;
        reasons.push('Has active objections');
      }

      if (intent.sentiment === 'positive') {
        score += 5;
      } else if (intent.sentiment === 'negative') {
        score -= 15;
        reasons.push('Negative sentiment detected');
      }
    }

    // Buying signals from enrichment
    const buyingSignals: string[] = metadata.buyingSignals || [];
    if (buyingSignals.length >= 2) {
      score += 10;
      reasons.push(`${buyingSignals.length} buying signals detected from research`);
    } else if (buyingSignals.length === 1) {
      score += 5;
      reasons.push('1 buying signal detected');
    }

    // ━━━ 4. ENRICHMENT QUALITY BONUS (10 pts) ━━━━━━━━━━━━━━━━━━━━
    if (metadata.enrichmentSource === 'google+gemini') {
      score += 10;
      reasons.push('Live-verified company data (Google + AI)');
    } else if (metadata.enriched) {
      score += 5;
      reasons.push('AI-enriched profile');
    }

    // ━━━ CALIBRATION & NORMALIZATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const finalScore = Math.max(0, Math.min(100, score));

    let category: LeadScoreCategory = 'D';
    if (finalScore >= 80) category = 'A';
    else if (finalScore >= 60) category = 'B';
    else if (finalScore >= 40) category = 'C';

    return { score: finalScore, category, reasons };
  }

  /**
   * Update lead score in database and notify the user for category promotions
   */
  async updateAndNotify(leadId: string): Promise<void> {
    const lead = await storage.getLeadById(leadId);
    if (!lead) return;

    const messages = await storage.getMessages(leadId);
    const lastIntent = (lead.metadata as any)?.lastIntent;

    const result = await this.calculateScore(lead, messages, lastIntent);
    const previousCategory = (lead.metadata as any)?.scoreCategory;

    try {
      await storage.updateLead(leadId, {
        score: result.score,
        metadata: {
          ...lead.metadata,
          scoreCategory: result.category,
          scoreReasons: result.reasons,
          lastScoredAt: new Date().toISOString()
        }
      });
    } catch (err) {
      console.error('[LeadScoring] Failed to update lead score:', err);
    }

    // Notify user on any category promotion (D→C, C→B, B→A)
    const categoryRank: Record<LeadScoreCategory, number> = { D: 0, C: 1, B: 2, A: 3 };
    const isPromotion = previousCategory && categoryRank[result.category] > categoryRank[previousCategory as LeadScoreCategory];

    if (result.category === 'A' && (!previousCategory || previousCategory !== 'A')) {
      try {
        await storage.createNotification({
          userId: lead.userId,
          type: 'conversion',
          title: '🔥 High-Value Lead!',
          message: `${lead.name} from ${lead.company || 'their company'} just scored ${result.score}/100 — Category A!`,
          metadata: { leadId, score: result.score, category: 'A', reasons: result.reasons }
        });
      } catch (err) {
        console.error('[LeadScoring] Failed to create notification:', err);
      }
      try {
        wsSync.notifyStatsUpdated(lead.userId);
      } catch (err) {
        console.error('[LeadScoring] Failed to notify stats updated:', err);
      }
    } else if (isPromotion) {
      try {
        await storage.createNotification({
          userId: lead.userId,
          type: 'lead_status_change',
          title: `📈 Lead Upgraded to Category ${result.category}`,
          message: `${lead.name} moved from ${previousCategory} → ${result.category} (${result.score}/100)`,
          metadata: { leadId, score: result.score, category: result.category }
        });
      } catch (err) {
        console.error('[LeadScoring] Failed to create upgrade notification:', err);
      }
    }
  }
}

export const leadScoringEngine = new LeadScoringEngine();




