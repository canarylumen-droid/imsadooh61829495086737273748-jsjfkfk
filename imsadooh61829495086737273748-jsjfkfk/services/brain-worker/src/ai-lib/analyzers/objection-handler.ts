export interface RebuttalPlaybook {
  category: string;
  rebuttal: string;
  contextAdvice: string;
}

export const OBJECTION_PLAYBOOKS: Record<string, RebuttalPlaybook> = {
  price: {
    category: "Price / Budget",
    rebuttal: "Focus on ROI and the 'Level 5' efficiency gains. Suggest a shorter trial or a lower-tier entry point rather than a discount. Leverage the 'Pay as you Scale' argument.",
    contextAdvice: "The lead is worried about cost. Mention how the AI agent pays for itself by automating 40+ hours of SDR work per week and replacing expensive seat-based licensing."
  },
  competitor: {
    category: "Competition",
    rebuttal: "Highlight Audnix's unique real-time availability sync and deep 'Expert SDR' autonomy (Agents that actually think, not just templates). Focus on the 'All-in-One' nature (Instagram + Email + Video).",
    contextAdvice: "Lead mentioned another tool. Focus on our 99.9% deliverability and integrated calendar scheduling which separates us from 'bulk sender' tools."
  },
  timing: {
    category: "Bad Timing / Busy",
    rebuttal: "Acknowledge the busy season. Propose a brief 5-minute 'value-only' sync for 2 weeks from now. Alternatively, offer to set up their engine in 'Silent Mode' so it's ready for them when they return.",
    contextAdvice: "Lead is traveling or in a crunch. Respect the space but offer a frictionless onboarding for later."
  },
  not_interested: {
    category: "General Disinterest",
    rebuttal: "Pivot to a feedback request. Ask: 'Is it the timing, the tech, or just not a priority right now?' This often uncovers hidden objections.",
    contextAdvice: "Low intent. Use this to disqualify or find a pivot point."
  }
};

class ObjectionService {
  /**
   * Determine if a summary contains a specific objection and return the playbook
   */
  getPlaybookForSummary(summary: string): RebuttalPlaybook | null {
    const text = summary.toLowerCase();
    
    if (text.includes('expensive') || text.includes('budget') || text.includes('price') || text.includes('cost')) {
      return OBJECTION_PLAYBOOKS.price;
    }
    
    if (text.includes('using') || text.includes('already have') || text.includes('competitor') || text.includes('apollo') || text.includes('instantly')) {
      return OBJECTION_PLAYBOOKS.competitor;
    }
    
    if (text.includes('busy') || text.includes('next month') || text.includes('travel') || text.includes('quarter')) {
      return OBJECTION_PLAYBOOKS.timing;
    }

    if (text.includes('not interested') || text.includes('remove') || text.includes('unsubscribe')) {
      return OBJECTION_PLAYBOOKS.not_interested;
    }

    return null;
  }

  /**
   * Format the playbook for the AI System Prompt
   */
  formatPlaybookForAI(playbook: RebuttalPlaybook | null): string {
    if (!playbook) return "No specific objection detected. Use standard closing logic.";
    
    return `
DETECTED OBJECTION: ${playbook.category}
REBUTTAL STRATEGY: ${playbook.rebuttal}
ADVICE: ${playbook.contextAdvice}
    `.trim();
  }
}

export const objectionService = new ObjectionService();
