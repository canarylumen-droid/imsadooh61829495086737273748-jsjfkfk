import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { leads, leadTimezoneProfiles, type Lead } from "@audnix/shared";
import { eq, and, sql, isNull, or } from 'drizzle-orm';
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { leadScoringEngine } from "@services/brain-worker/src/ai-lib/engines/lead-scoring-engine.js";
import pLimit from 'p-limit';

/**
 * Lead Enrichment Worker (Phase 3 - Production Hardened)
 *
 * Two-stage pipeline:
 * 1. Live Google Search via `google-it` — pulls real company news, size signals, and recent activity
 * 2. Gemini AI synthesis — processes raw search results into structured outreach intelligence
 *
 * Throughput: Processes up to 25 leads per cycle with 3-parallel concurrency cap.
 */
export class LeadEnrichmentWorker {
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes
  private readonly BATCH_SIZE = 200; // High-throughput batch for 50k+ bulk imports
  private readonly CONCURRENCY = 5; // Parallel enrichments without burning API quota

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🔍 Lead Enrichment Worker started (Production mode — Live Search + AI)');
    this.interval = setInterval(() => this.tick(), this.CHECK_INTERVAL_MS);
    // Stagger initial tick so it doesn't contend with boot
    setTimeout(() => this.tick(), 15000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('🛑 Lead Enrichment Worker stopped');
  }

  async tick(): Promise<void> {
    if (this.isProcessing) return;

    const health = workerHealthMonitor.isSystemPaused();
    if (health.paused) {
      console.warn(`🛑 [LeadEnrichment] Skipping cycle - System in EMERGENCY BRAKE: ${health.reason}`);
      return;
    }

    if (quotaService.isRestricted()) return;

    this.isProcessing = true;

    try {
      const leadsToEnrich = await db
        .select()
        .from(leads)
        .where(
          and(
            or(
              eq(leads.status, 'new'),
              eq(leads.status, 'open')
            ),
            or(
              isNull(sql`leads.metadata->'enriched'`),
              eq(sql`leads.metadata->>'enriched'`, 'false'),
              eq(sql`leads.metadata->>'enrichment_failed'`, 'false')
            )
          )
        )
        .limit(this.BATCH_SIZE);

      if (leadsToEnrich.length === 0) return;

      console.log(`🔍 [LeadEnrichment] Processing ${leadsToEnrich.length} leads with ${this.CONCURRENCY} parallel workers...`);

      // p-limit caps concurrency to avoid API rate limits
      const limit = pLimit(this.CONCURRENCY);
      await Promise.all(leadsToEnrich.map(lead => limit(() => this.enrichLead(lead))));

      workerHealthMonitor.recordSuccess('lead-enrichment-worker');
      console.log(`✅ [LeadEnrichment] Batch complete.`);
    } catch (error: any) {
      console.error('[LeadEnrichmentWorker] Tick error:', error);
      workerHealthMonitor.recordError('lead-enrichment-worker', error?.message || 'Unknown error');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Stage 1: Live Google Search
   * Pulls real, current intelligence on the lead's company.
   */
  private async searchCompanyIntelligence(leadName: string, company: string, email?: string): Promise<string[]> {
    try {
      // google-it is already in package.json
      const googleIt = (await import('google-it') as any).default;

      const domain = email?.includes('@') ? email.split('@')[1] : null;
      const query = company && company !== 'Unknown'
        ? `${company} company size funding news 2024 2025`
        : domain
          ? `${domain} company business`
          : `${leadName} professional company`;

      const results = await googleIt({ query, limit: 5, disableConsole: true })
        .catch(() => []);

      return (results as any[]).map((r: any) => r.snippet || r.title || '').filter(Boolean);
    } catch (err: any) {
      // google-it can fail due to rate limits — gracefully degrade to AI-only
      console.warn(`[LeadEnrichment] Google search failed for ${company}: ${err.message}`);
      return [];
    }
  }

  /**
   * Stage 2: AI Synthesis
   * Uses Gemini to synthesize search results + lead data into structured intelligence.
   */
  private async synthesizeIntelligence(lead: any, searchSnippets: string[]): Promise<any> {
    const { generateReply } = await import("@services/brain-worker/src/ai-lib/core/ai-service.js");
    const { MODELS, GENAI_STABLE_MODEL } = await import("@services/brain-worker/src/ai-lib/utils/model-config.js");

    const snippetsContext = searchSnippets.length > 0
      ? `\nReal-time search results about their company:\n${searchSnippets.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';

    const systemPrompt = `## IDENTITY
You are a world-class B2B sales intelligence analyst. You synthesize raw lead data and search results into actionable sales intelligence.

## MISSION
Analyze the provided lead data and web search snippets to build a comprehensive business profile. Identify the lead's likely pain points, buying signals, and optimal contact strategy.

## 🔒 ANTI-HALLUCINATION RULES (STRICT)
1. Base EVERY field on actual data from the lead bio or search snippets. Do NOT invent company details.
2. If data is insufficient to determine a field, set it to null — do not guess or fabricate.
3. "researchInsights" must be directly derived from the snippets or bio. Not generic assumptions.
4. "suggestedAngle" must be a concrete pitch angle based on what you actually know about them.
5. "painPoints" must be inferred from their niche, bio, or search data — not generic industry pain points.
6. "confidence" must honestly reflect how much reliable data you have.

## HARD CONSTRAINTS
1. Return ONLY valid JSON. No commentary, no explanation, no markdown.
2. All fields must use the exact keys specified below.
3. "companySize" must be one of the exact enum values or null.
4. "detectedTimezone" must be a valid IANA timezone string or null.
5. Be conservative — when in doubt, set a field to null rather than guessing.`;
    const userPrompt = `Lead Data:
- Bio: ${lead.bio || 'Not provided'}
- Niche/Industry: ${lead.niche || lead.metadata?.niche || 'Unknown'}
- City/Location: ${lead.city || lead.metadata?.city || 'Unknown'}${snippetsContext}

Return ONLY this JSON structure:
{
  "companySize": "1-10" | "11-50" | "51-200" | "201-500" | "500+" | null,
  "industry": "string or null",
  "researchInsights": ["insight1", "insight2", "insight3"],
  "suggestedAngle": "one sentence pitch angle",
  "website": "domain.com or null",
  "buyingSignals": ["signal1", "signal2"],
  "painPoints": ["pain1", "pain2"],
  "detectedTimezone": "IANA timezone string (e.g. America/New_York) or null",
  "businessPersona": "Short description of business owner type based on niche",
  "optimalContactTime": { "start": 9, "end": 17, "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
  "confidence": 0.0 to 1.0
}`;

    const res = await generateReply(systemPrompt, userPrompt, {
      jsonMode: true,
      model: MODELS.intelligence_synthesis || GENAI_STABLE_MODEL,
      temperature: 0.2
    });

    try {
      return JSON.parse(res.text);
    } catch (err) {
      console.error("[LeadEnrichment] AI returned invalid JSON:", res.text.substring(0, 100));
      throw new Error('AI returned no valid JSON');
    }
  }

  /**
   * Main enrichment pipeline for a single lead
   */
  async enrichLead(lead: any): Promise<void> {
    try {
      // Stage 1: Live search
      const snippets = await this.searchCompanyIntelligence(
        lead.name || '',
        lead.company || 'Unknown',
        lead.email
      );

      // Stage 2: AI synthesis (with real search context)
      const data = await this.synthesizeIntelligence(lead, snippets);

      const updatedMetadata = {
        ...lead.metadata,
        enriched: true,
        enrichedAt: new Date().toISOString(),
        enrichmentSource: snippets.length > 0 ? 'google+gemini' : 'gemini-only',
        companySize: data.companySize,
        industry: data.industry || lead.metadata?.industry,
        insights: data.researchInsights,
        suggestedAngle: data.suggestedAngle,
        website: data.website,
        buyingSignals: data.buyingSignals || [],
        painPoints: data.painPoints || [],
        detectedTimezone: data.detectedTimezone,
        businessPersona: data.businessPersona,
        optimalContactTime: data.optimalContactTime
      };

      await storage.updateLead(lead.id, {
        metadata: updatedMetadata,
        company: lead.company || data.website || null,
        timezone: data.detectedTimezone || lead.timezone,
        updatedAt: new Date()
      });

      // Sync to specialized timezone profiles table for high-precision outreach
      if (data.detectedTimezone || data.optimalContactTime) {
        try {
          await db.insert(leadTimezoneProfiles).values({
            leadId: lead.id,
            userId: lead.userId,
            detectedTimezone: data.detectedTimezone,
            detectedCity: lead.city || lead.metadata?.city || null,
            niche: lead.niche || lead.metadata?.niche || data.industry || null,
            preferredContactStart: data.optimalContactTime?.start || 10,
            preferredContactEnd: data.optimalContactTime?.end || 18,
            preferredDays: data.optimalContactTime?.days || ["Monday","Tuesday","Wednesday","Thursday","Friday"],
            detectionConfidence: data.confidence || 0.5,
            detectionSource: 'city_niche_inference'
          }).onConflictDoUpdate({
            target: [leadTimezoneProfiles.leadId],
            set: {
              detectedTimezone: data.detectedTimezone,
              lastUpdatedAt: new Date()
            }
          });
        } catch (err) {
          console.warn(`[LeadEnrichment] Could not sync TZ profile: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      // Trigger lead scoring immediately after enrichment
      await leadScoringEngine.updateAndNotify(lead.id);

      console.log(`✅ Enriched & scored: ${lead.name} (${data.industry || 'Unknown industry'}, source: ${updatedMetadata.enrichmentSource})`);

    } catch (error: any) {
      console.error(`❌ Failed to enrich lead ${lead.id} (${lead.name}): ${error.message}`);
      // Mark as failed with specific error so we don't retry forever
      await storage.updateLead(lead.id, {
        metadata: {
          ...lead.metadata,
          enrichment_failed: true,
          enriched: true,
          enrichmentError: error.message,
          enrichedAt: new Date().toISOString()
        }
      });
    }
  }
}

export const leadEnrichmentWorker = new LeadEnrichmentWorker();






