/*
 * Day-aware email sequence generation
 * 
 * The AI should know:
 * - What day of the campaign it is (Day 0, 1, 2, 5, 7)
 * - What was said in previous emails
 * - Whether they opened/clicked the previous email
 * - Their engagement level (hot/warm/cold)
 * 
 * This allows personalized, context-aware follow-ups that feel human
 */

export interface DayAwareContext {
  campaignDay: number;
  previousMessages: Array<{
    sentAt: Date;
    body: string;
    opened?: boolean;
    clicked?: boolean;
  }>;
  leadEngagement: 'hot' | 'warm' | 'cold';
  leadName: string;
  brandName: string;
  userSenderName?: string;
  lastReplyTime?: Date;
}

export class DayAwareSequence {
  static readonly DayAwareAutomationRules: Record<number, { action: string, prompt: string }> = {
    1: {
      action: "Send Disruptive Observation",
      prompt: "Focus on the 'Day 1' psychological shock. Challenge their current industry roadmap. Peer-to-peer authority only. No fluff."
    },
    3: {
      action: "Curiosity Gap Follow-up",
      prompt: "Day 3: Call out a specific nuance about their role (Founder/CEO/Agency Owner) and how it maps to the breakthrough. Focus on what they are currently missing."
    },
    7: {
      action: "Strategic Archive Theory",
      prompt: "Day 7 (Final): Present a provocative 'Archive Theory' - if efficiency isn't a priority for their industry operations right now, that's okay, but they are missing X. Use professional FOMO."
    }
  };

  /**
   * Generate "Psychological Clickbait" subject lines
   */
  static generateSubjectLine(context: DayAwareContext): string {
    const { campaignDay, leadName, brandName, leadEngagement } = context;

    const subjects: Record<number, Record<string, string[]>> = {
      0: {
        hot: [`Question about ${brandName} implementation`, `The gap in ${leadName}'s workflow`, `Observation about your roadmap`],
        warm: [`Thought on ${brandName} for you`, `Quick efficiency win?`, `One missing detail...`],
        cold: [`Is this relevant?`, `Specific insight for ${leadName}`, `Strategic observation`],
      },
      1: {
        hot: [`One more thing on the observation...`, `Re: My previous note`, `Forgot this detail, ${leadName}`],
        warm: [`Quick correction`, `Thought of this today`, `Another angle on ${brandName}`],
        cold: [`Correction`, `Further thought`, `Re: ${leadName}`],
      },
      5: {
        hot: [`Is ${brandName} still a priority?`, `Closing the loop on the gap`, `Final thought on ${leadName}'s roadmap`],
        warm: [`Moving on?`, `Quick check`, `Optimization update`],
        cold: [`Archive warning`, `Status?`, `Final note`],
      }
    };

    const subjectsForDay = subjects[campaignDay] || subjects[0];
    const subjectsForEngagement = subjectsForDay[leadEngagement] || subjectsForDay['cold'];
    return subjectsForEngagement[Math.floor(Math.random() * subjectsForEngagement.length)];
  }

  /**
   * Elite Strategic Templates
   */
  static generateEmailBody(context: DayAwareContext): string {
    const { campaignDay, leadName, brandName, leadEngagement, previousMessages } = context;
    const lastMessage = previousMessages[previousMessages.length - 1];

    switch (campaignDay) {
      case 0:
        return `Hey ${leadName},\n\nI noticed a specific friction point in how ${brandName} is being utilized in your niche. Most teams miss the 20% shift that drives 80% of the result.\n\nI have a theory on how this maps to your current roadmap. Is efficiency a focus this quarter?\n\nBest,\n[Your Name]`;
      case 1:
        return `${leadName},\n\nFollowing up on my previous note. One thing I didn't mention: the speed of implementation for the ${brandName} breakthrough is exactly where the competitive edge lies.\n\nWorth a 2-minute sync to see if there's a fit?\n\nBest,\n[Your Name]`;
      default:
        return `Hey ${leadName}, reaching out one last time regarding the ${brandName} optimization. If this isn't a priority, I'll close the loop here.\n\nOtherwise, let's chat.`;
    }
  }

  /**
   * Build modern Elite System Prompt
   */
  static buildSystemPrompt(context: DayAwareContext): string {
    return `You are an elite high-ticket sales copywriter (Think Joe Sugarman + Chris Voss). 
    Your objective is to generate a REPLY by creating a "Curiosity Gap" or "Strategic Disruption".

    CAMPAIGN INTEL:
    - Day: ${context.campaignDay} (Progression: 0=Touch 1, 7=Final)
    - Lead: ${context.leadName}
    - Engagement: ${context.leadEngagement}
    - Last Message Context: ${context.previousMessages[context.previousMessages.length - 1]?.body || 'First touch'}

    COPYWRITING DIRECTIVES:
    1. NO GENERIC FLUFF: No "Hope you are well" or "Checking in". Start with a disruptive observation.
    2. THE CURIOSITY GAP: Don't explain the "How". Focus on the "Significant Transformation".
    3. BRAND AUTHENTICITY: You represent ${context.brandName}. Speak with high-authority, peer-to-peer confidence.
    4. LENGTH: 3-4 punchy sentences max.
    5. CTA: Use "Low-Friction" questions. (e.g. "Does this map to your roadmap?" vs "Call me").
    6. VARIATION: If day > 0, reference a "new angle" not mentioned previously.

    Generate the follow-up now. High-contrast, plain text style.`;
  }
}

export default DayAwareSequence;
