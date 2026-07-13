import { storage } from '@shared/lib/storage/storage.js';
import type { Lead } from "@audnix/shared";

/**
 * Phase 42: Revenue Intelligence Service
 * Calculates potential ROI based on lead firmographics and enrichment data.
 */
export class RevenueIntelligence {
  /**
   * Generates a strategic ROI pitch for the lead
   */
  static async getROIPitch(lead: Lead): Promise<string> {
    const metadata = (lead.metadata as any) || {};
    const companySize = metadata.companySize || "your business";
    const industry = metadata.industry || "your industry";
    
    // Heuristic ROI Calculation
    // Base: Audnix saves ~2 hours per day per outreach seat
    // base savings = $50/hr (average sales op cost)
    let seatEstimate = 1;
    if (typeof companySize === 'string') {
      if (companySize.includes('50-200')) seatEstimate = 5;
      else if (companySize.includes('201-500')) seatEstimate = 12;
      else if (companySize.includes('500+')) seatEstimate = 25;
      else if (companySize.includes('11-50')) seatEstimate = 2;
    } else if (typeof companySize === 'number') {
      seatEstimate = Math.max(1, Math.floor(companySize / 20));
    }

    const monthlyHoursSaved = seatEstimate * 2 * 22; // 2hrs/day * 22 days/mo
    const monthlyFinancialImpact = monthlyHoursSaved * 50;

    const pitches = [
      `Based on your team size at ${lead.company || 'your company'}, our typical ${industry} partners reclaim about ${monthlyHoursSaved} hours of manual outreach every month.`,
      `Efficiency is key—for a company of your scale, Audnix usually drives a ${monthlyFinancialImpact.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} monthly impact by automating high-intent discovery.`,
      `The ROI is straightforward for ${industry}: moving from manual to Audnix-led outreach typically results in a ${seatEstimate * 3}x increase in meeting volume without adding headcount.`
    ];

    return pitches[Math.floor(Math.random() * pitches.length)];
  }

  /**
   * Helper to determine estimated annual deal value for pipeline attribution
   */
  static estimateDealValue(lead: Lead): number {
    const metadata = (lead.metadata as any) || {};
    const size = metadata.companySize || "";

    if (size.includes('500+')) return 12000; // Enterprise
    if (size.includes('201-500')) return 7500; // Mid-Market
    if (size.includes('50-200')) return 4800; // Growth
    if (size.includes('11-50')) return 2400; // Pro
    return 1200; // Starter
  }
}



