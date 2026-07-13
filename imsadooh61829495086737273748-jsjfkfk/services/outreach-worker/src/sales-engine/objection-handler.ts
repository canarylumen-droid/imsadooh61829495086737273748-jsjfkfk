/**
 * Sales Objection Handler - Analyzes prospect objections and suggests responses
 * Uses brand PDF context to personalize reframes and closing tactics
 * Includes competitor analysis and industry-specific strategies
 */

import {
  OBJECTIONS_DATABASE,
  getObjectionsByIndustry,
  getObjectionReframe,
  getSalesStrategy,
  Objection,
} from './objections-database.js';

export interface ObjectionAnalysis {
  matchedObjection: Objection | null;
  confidence: number;
  reframes: string[];
  questions: string[];
  stories: string[];
  closingTactics: string[];
  competitorInsight?: string;
  industryContext?: string;
  nextStep: string;
}

export class ObjectionHandler {
  /**
   * Analyze prospect objection and return comprehensive response strategy
   */
  static analyzeObjection(
    objectionText: string,
    userIndustry: string = 'all',
    brandContext: string = 'your brand'
  ): ObjectionAnalysis {
    const cleanText = objectionText.toLowerCase().trim();
    
    // Get objections for this industry
    const relevantObjections = getObjectionsByIndustry(userIndustry);
    
    // Score each objection for match
    const scoredObjections = relevantObjections.map(obj => ({
      objection: obj,
      score: this.calculateMatchScore(cleanText, obj.objection),
    }));
    
    // Sort by score and get best match
    scoredObjections.sort((a, b) => b.score - a.score);
    const bestMatch = scoredObjections[0];
    
    if (!bestMatch || bestMatch.score < 0.4) {
      return this.generateGenericResponse(objectionText);
    }
    
    const strategy = getSalesStrategy(bestMatch.objection.id);
    const reframes = getObjectionReframe(bestMatch.objection.id, brandContext);
    
    return {
      matchedObjection: bestMatch.objection,
      confidence: bestMatch.score,
      reframes,
      questions: strategy.questions,
      stories: strategy.stories,
      closingTactics: strategy.closingTactics,
      competitorInsight: bestMatch.objection.proComparison,
      industryContext: `This is common in ${userIndustry} sales`,
      nextStep: this.determineNextStep(bestMatch.objection.category),
    };
  }

  /**
   * Calculate similarity score between prospect text and objection
   */
  private static calculateMatchScore(prospectText: string, objectionPhrase: string): number {
    const objectionWords = objectionPhrase.toLowerCase().split(' ').filter(w => w.length > 2);
    const prospectWords = prospectText.split(' ');
    
    const matchedWords = objectionWords.filter(w => prospectText.includes(w));
    const score = matchedWords.length / objectionWords.length;
    
    return Math.min(1, score * (1 + (prospectText.includes(objectionPhrase.toLowerCase()) ? 0.5 : 0)));
  }

  /**
   * Generate response for objection not in database
   */
  private static generateGenericResponse(objectionText: string): ObjectionAnalysis {
    return {
      matchedObjection: null,
      confidence: 0,
      reframes: [
        'I understand your concern. Let\'s address it together.',
        'What specifically is the concern? Let\'s break it down.',
        'That\'s a fair point. Here\'s how we see it...',
      ],
      questions: [
        'What specifically is your main concern?',
        'Is it about the price, the setup, or how it works?',
        'If we solved [concern], would you move forward?',
      ],
      stories: [],
      closingTactics: [
        'Ask clarifying questions to understand root concern',
        'Acknowledge the concern as valid',
        'Reframe as opportunity, not obstacle',
      ],
      nextStep: 'Gather more information about the specific objection',
    };
  }

  /**
   * Determine next step based on objection category
   */
  private static determineNextStep(category: string): string {
    const nextSteps: Record<string, string> = {
      timing: 'Create urgency by showing competitor activity or time-sensitive opportunity',
      price: 'Show ROI calculation - how one deal pays for the tool',
      competitor: 'Differentiate on unique features and customer results',
      trust: 'Provide social proof, testimonials, or free trial to build confidence',
      authority: 'Share case studies from similar companies in their industry',
      fit: 'Customize solution to their specific use case',
      social: 'Address end-customer perception, position as enhancement not replacement',
      decision: 'Remove final barriers, clarify remaining concerns, assume close',
    };
    
    return nextSteps[category] || 'Address the objection and move toward close';
  }

  /**
   * Generate competitive intelligence based on objection
   */
  static analyzeCompetitorThreat(objectionText: string): {
    threat: string;
    opportunity: string;
    action: string;
  } {
    if (objectionText.toLowerCase().includes('competitor') || 
        objectionText.toLowerCase().includes('using') ||
        objectionText.toLowerCase().includes('tried')) {
      return {
        threat: 'Prospect may be comparing with competitor solution',
        opportunity: 'Differentiate on features, support, and results',
        action: 'Ask specific questions about competitor features, highlight what we do better',
      };
    }
    
    return {
      threat: 'Lost deal if not handled properly',
      opportunity: 'Convert objection into buying signal',
      action: 'Reframe objection as interest, move to close',
    };
  }

  /**
   * Generate conversation flow based on brand PDF context
   */
  static generateBrandedConversation(
    objectionText: string,
    brandName: string,
    industryVertical: string,
    brandStrength: string = 'innovative'
  ): {
    openingLine: string;
    questions: string[];
    closeStatement: string;
  } {
    return {
      openingLine: `I understand. Here's how ${brandName} ${brandStrength} companies in ${industryVertical} typically handle this...`,
      questions: [
        `What does your ideal solution look like?`,
        `If we showed you proof from similar ${industryVertical} companies, would that help?`,
        `Are you open to a quick test run to see real results?`,
      ],
      closeStatement: `Let's get you started today and prove this works for ${brandName}. We're confident you'll see results in week one.`,
    };
  }
}

export default ObjectionHandler;
