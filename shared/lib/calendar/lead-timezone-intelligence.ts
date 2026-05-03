/**
 * Lead Timezone Intelligence Service
 *
 * Automatically infers a lead's timezone and preferred contact hours
 * from their city and niche — zero manual input required.
 */

import { db } from '@shared/lib/db/db.js';
import { leadTimezoneProfiles, leads, users, aiLearningPatterns } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import type { LeadTimezoneProfile } from '@audnix/shared';

// ─── City → IANA Timezone Map ────────────────────────────────────────────────
// Expanded with more global business hubs
const CITY_TIMEZONE_MAP: Record<string, string> = {
  // Nigeria
  lagos: 'Africa/Lagos', abuja: 'Africa/Lagos', kano: 'Africa/Lagos',
  ibadan: 'Africa/Lagos', port_harcourt: 'Africa/Lagos',
  // Ghana
  accra: 'Africa/Accra',
  // Kenya
  nairobi: 'Africa/Nairobi', mombasa: 'Africa/Nairobi',
  // South Africa
  johannesburg: 'Africa/Johannesburg', cape_town: 'Africa/Johannesburg',
  durban: 'Africa/Johannesburg',
  // UK
  london: 'Europe/London', manchester: 'Europe/London',
  birmingham: 'Europe/London', leeds: 'Europe/London',
  // UAE
  dubai: 'Asia/Dubai', abu_dhabi: 'Asia/Dubai',
  // USA East (EST/EDT)
  new_york: 'America/New_York', miami: 'America/New_York',
  atlanta: 'America/New_York', boston: 'America/New_York',
  charlotte: 'America/New_York', philadelphia: 'America/New_York',
  washington: 'America/New_York', orlando: 'America/New_York',
  // USA Central (CST/CDT)
  chicago: 'America/Chicago', houston: 'America/Chicago',
  dallas: 'America/Chicago', san_antonio: 'America/Chicago',
  austin: 'America/Chicago', nashville: 'America/Chicago',
  // USA Mountain (MST/MDT)
  denver: 'America/Denver', salt_lake_city: 'America/Denver',
  // USA Mountain (No DST)
  phoenix: 'America/Phoenix',
  // USA West (PST/PDT)
  los_angeles: 'America/Los_Angeles', san_francisco: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles', san_diego: 'America/Los_Angeles',
  las_vegas: 'America/Los_Angeles', portland: 'America/Los_Angeles',
  // Canada
  toronto: 'America/Toronto', montreal: 'America/Toronto',
  vancouver: 'America/Vancouver', ottawa: 'America/Toronto',
  // Australia
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne',
  brisbane: 'Australia/Brisbane', perth: 'Australia/Perth',
  // India
  mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', bangalore: 'Asia/Kolkata',
  // Europe
  paris: 'Europe/Paris', berlin: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam',
  madrid: 'Europe/Madrid', rome: 'Europe/Rome', brussels: 'Europe/Brussels',
  vienna: 'Europe/Vienna', stockholm: 'Europe/Stockholm',
  // Asia
  singapore: 'Asia/Singapore', hong_kong: 'Asia/Hong_Kong', tokyo: 'Asia/Tokyo',
  seoul: 'Asia/Seoul', shanghai: 'Asia/Shanghai', bangkok: 'Asia/Bangkok',
  // Saudi Arabia
  riyadh: 'Asia/Riyadh', jeddah: 'Asia/Riyadh',
  // Israel
  tel_aviv: 'Asia/Jerusalem', jerusalem: 'Asia/Jerusalem',
  // Turkey
  istanbul: 'Europe/Istanbul', ankara: 'Europe/Istanbul',
  // Egypt
  cairo: 'Africa/Cairo',
  // Morocco
  casablanca: 'Africa/Casablanca',
  // Ethiopia
  addis_ababa: 'Africa/Addis_Ababa',
  // Global / Other
  mexico_city: 'America/Mexico_City', sao_paulo: 'America/Sao_Paulo',
  buenos_aires: 'America/Argentina/Buenos_Aires',
  tel_aviv_yafo: 'Asia/Jerusalem',
};

// ─── Niche → Preferred Contact Window ────────────────────────────────────────
export interface NicheWindow {
  start: number;          // 0-23 local hour
  end: number;            // 0-23 local hour
  days: string[];
  category: string;
  displayName: string;
}

const NICHE_WINDOWS: Record<string, NicheWindow> = {
  // Trades (Early starts, finish early/mid-afternoon)
  plumber:       { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Plumber' },
  plumbing:      { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Plumbing' },
  electrician:   { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Electrician' },
  electrical:    { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Electrical' },
  hvac:          { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'HVAC' },
  contractor:    { start: 7, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Contractor' },
  roofer:        { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Roofer' },
  roofing:       { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Roofing' },
  landscaping:   { start: 7, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Landscaping' },
  
  // Healthcare (Lunch break or after hours)
  dentist:       { start: 12, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Dental' },
  dentistry:     { start: 12, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Dentistry' },
  doctor:        { start: 13, end: 15, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Medical' },
  medical:       { start: 13, end: 15, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Medical' },
  clinic:        { start: 13, end: 15, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Clinic' },
  
  // Real Estate (Active late afternoon/evening and weekends)
  real_estate:   { start: 16, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'real_estate', displayName: 'Real Estate' },
  realtor:       { start: 16, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'real_estate', displayName: 'Real Estate' },
  
  // Food & Beverage (Avoid peak meal times)
  restaurant:    { start: 14, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'food_beverage', displayName: 'Restaurant' },
  cafe:          { start: 14, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'food_beverage', displayName: 'Cafe' },
  
  // Professional Services (Standard business hours)
  lawyer:        { start: 9, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Legal' },
  accountant:    { start: 9, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Accounting' },
  consultant:    { start: 9, end: 18, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Consulting' },
  
  // Tech / SaaS (Mid-day is best)
  saas:          { start: 10, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'SaaS' },
  software:      { start: 10, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Software' },
  marketing:     { start: 10, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Marketing' },
  agency:        { start: 10, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Agency' },
  
  // Lifestyle & Wellness (Varies)
  gym:           { start: 6, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'lifestyle', displayName: 'Gym' },
  fitness:       { start: 6, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'lifestyle', displayName: 'Fitness' },
  salon:         { start: 10, end: 18, days: ['Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'lifestyle', displayName: 'Salon' },
  beauty:        { start: 10, end: 18, days: ['Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'lifestyle', displayName: 'Beauty' },
  spa:           { start: 10, end: 19, days: ['Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'], category: 'lifestyle', displayName: 'Spa' },

  // E-commerce & Retail
  ecommerce:     { start: 11, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'retail', displayName: 'E-commerce' },
  retail:        { start: 11, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'retail', displayName: 'Retail' },
  shopify:       { start: 11, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'retail', displayName: 'Shopify' },

  // Logistics & Supply Chain
  trucking:      { start: 6, end: 15, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'logistics', displayName: 'Trucking' },
  logistics:     { start: 8, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'logistics', displayName: 'Logistics' },
};

const DEFAULT_WINDOW: NicheWindow = {
  start: 9, end: 18,
  days: ['Monday','Tuesday','Wednesday','Thursday','Friday'],
  category: 'general',
  displayName: 'General Business',
};

// ─── Public API ────────────────────────────────────────────────────────────────

export function inferTimezoneFromCity(city: string, fallback: string = 'UTC'): string {
  if (!city) return fallback;
  const key = city.toLowerCase().trim().replace(/[\s\-]/g, '_');
  return CITY_TIMEZONE_MAP[key] || fallback;
}

export function inferPreferredWindowFromNiche(niche: string): NicheWindow {
  if (!niche) return DEFAULT_WINDOW;
  const lower = niche.toLowerCase();
  for (const [key, window] of Object.entries(NICHE_WINDOWS)) {
    if (lower.includes(key)) return window;
  }
  return DEFAULT_WINDOW;
}

/**
 * Autonomously retrieves the best contact window for a niche.
 * Prioritizes learned patterns from episodic memory over hardcoded defaults.
 */
export async function getDynamicNicheWindow(niche: string, userId: string): Promise<NicheWindow> {
  try {
    const patternKey = `niche_timing:${niche.toLowerCase()}`;
    const [learned] = await db.select()
      .from(aiLearningPatterns)
      .where(and(
        eq(aiLearningPatterns.userId, userId),
        eq(aiLearningPatterns.patternKey, patternKey)
      ))
      .limit(1);

    if (learned && (learned.metadata as any)?.window) {
      console.log(`[Timezone] 🧠 Using learned window for ${niche}: ${(learned.metadata as any).window.displayName}`);
      return (learned.metadata as any).window as NicheWindow;
    }
  } catch (err) {
    console.warn('[Timezone] Failed to fetch learned window, falling back to defaults:', err);
  }

  return NICHE_WINDOWS[niche.toLowerCase()] || DEFAULT_WINDOW;
}

/**
 * Checks if the current local time for a lead is within their business engagement window.
 * Now de-hardcoded: Uses dynamic windows derived from collective intelligence.
 */
export async function isWithinLeadPreferredWindow(
  utcDate: Date,
  profile: { detectedTimezone: string | null; preferredContactStart: number | null; preferredContactEnd: number | null; preferredDays: string[] | null; niche?: string | null },
  userId: string, // Required for dynamic lookup
  defaultTz: string = 'UTC'
): Promise<boolean> {
  const tz = profile.detectedTimezone || defaultTz;
  
  // 1. Dynamic Niche Check
  const window = await getDynamicNicheWindow(profile.niche || 'unknown', userId);
  
  const start = profile.preferredContactStart ?? window.start;
  const end = profile.preferredContactEnd ?? window.end;
  const days = profile.preferredDays || window.days;

  try {
    const localTime = new Intl.DateTimeFormat('en-US', { 
      timeZone: tz, 
      hour: 'numeric', 
      hourCycle: 'h23',
      weekday: 'long'
    }).formatToParts(utcDate);
    
    const localHour = parseInt(localTime.find(p => p.type === 'hour')?.value || '12', 10);
    const localDay = localTime.find(p => p.type === 'weekday')?.value || 'Monday';

    return localHour >= start && localHour < end && days.includes(localDay as any);
  } catch {
    return true; // Fail open
  }
}

/**
 * Advanced population using AI fallback for ambiguous leads.
 */
export async function populateLeadProfile(
  leadId: string,
  userId: string,
  options: {
    city?: string | null;
    niche?: string | null;
    company?: string | null;
    bio?: string | null;
    useAI?: boolean;
  } = {}
): Promise<void> {
  if (!db) return;

  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  const userTz = user?.timezone || 'UTC';

  // Scoped scanning: try multiple keys for city/location
  const cityInput = options.city || null;
  const nicheInput = options.niche || null;

  let detectedTimezone = inferTimezoneFromCity(cityInput || '', userTz);
  let window = inferPreferredWindowFromNiche(nicheInput || '');
  let confidence = (cityInput && CITY_TIMEZONE_MAP[cityInput.toLowerCase().replace(/[\s\-]/g, '_')]) ? 0.9 : 0.2;
  let source: "city_niche_inference" | "none" | "email_context" | "manual" = detectedTimezone !== userTz ? "city_niche_inference" : "none";

  // Phase 1.1: AI Fallback
  if (options.useAI && confidence < 0.5 && process.env.GEMINI_API_KEY) {
    try {
      const { generateReply } = await import('@services/brain-worker/src/ai-lib/core/ai-service.js');
      const aiResponse = await generateReply(
        'You are a timezone inference expert. Return only valid JSON.',
        `Infer the most likely IANA timezone and business niche for this lead based on available data.
Lead Data:
- City/Location: ${cityInput || 'Unknown'}
- Company: ${options.company || 'Unknown'}
- Niche: ${nicheInput || 'Unknown'}
- Bio: ${options.bio || 'None'}

User Context:
- User Timezone: ${userTz} (Use as anchor for disambiguation)

Rules:
1. Return a valid IANA timezone string (e.g. "America/Chicago").
2. If city is provided, prioritize it.
3. If city name is ambiguous (e.g. "Portland"), use User Context or Bio to disambiguate.
4. Confidence: 0.9 if certain, 0.4 if guess.

Return JSON: { "timezone": "string", "niche": "string", "confidence": number }`,
        { jsonMode: true, nga1Enforced: true }
      );

      const aiResult = JSON.parse(aiResponse.text || '{}');
      if (aiResult && aiResult.confidence > confidence) {
        detectedTimezone = aiResult.timezone;
        window = inferPreferredWindowFromNiche(aiResult.niche);
        confidence = aiResult.confidence;
        source = 'city_niche_inference';
      }
    } catch (err) {
      console.warn(`[TimezoneAI] Fallback failed for lead ${leadId}:`, err);
    }
  }

  try {
    await db
      .insert(leadTimezoneProfiles)
      .values({
        leadId,
        userId,
        detectedTimezone,
        detectedCity: options.city || null,
        niche: options.niche || null,
        nicheCategory: window.category,
        preferredContactStart: window.start,
        preferredContactEnd: window.end,
        preferredDays: window.days,
        detectionConfidence: confidence,
        detectionSource: source,
        lastUpdatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: leadTimezoneProfiles.leadId,
        set: {
          detectedTimezone,
          detectedCity: options.city || null,
          niche: options.niche || null,
          nicheCategory: window.category,
          preferredContactStart: window.start,
          preferredContactEnd: window.end,
          preferredDays: window.days,
          detectionConfidence: confidence,
          detectionSource: source,
          lastUpdatedAt: new Date(),
        },
      });

    console.log(`[Timezone] Lead ${leadId} profile updated: ${detectedTimezone} (${window.category})`);
  } catch (err) {
    console.warn(`[Timezone] DB update failed for lead ${leadId}:`, err);
  }
}

export async function getLeadProfile(leadId: string): Promise<LeadTimezoneProfile | null> {
  if (!db) return null;
  try {
    const [profile] = await db
      .select()
      .from(leadTimezoneProfiles)
      .where(eq(leadTimezoneProfiles.leadId, leadId))
      .limit(1);
    return profile || null;
  } catch {
    return null;
  }
}

export async function updateLeadProfileFromContext(
  leadId: string,
  updates: {
    city?: string;
    niche?: string;
    timezone?: string;
  }
): Promise<void> {
  if (!db || !Object.keys(updates).length) return;

  const tz = updates.timezone || (updates.city ? inferTimezoneFromCity(updates.city) : undefined);
  const window = updates.niche ? inferPreferredWindowFromNiche(updates.niche) : null;

  try {
    await db
      .update(leadTimezoneProfiles)
      .set({
        ...(tz && { detectedTimezone: tz }),
        ...(updates.city && { detectedCity: updates.city }),
        ...(updates.niche && { niche: updates.niche }),
        ...(window && {
          nicheCategory: window.category,
          preferredContactStart: window.start,
          preferredContactEnd: window.end,
          preferredDays: window.days,
        }),
        detectionSource: 'email_context',
        detectionConfidence: 0.9,
        lastUpdatedAt: new Date(),
      })
      .where(eq(leadTimezoneProfiles.leadId, leadId));
  } catch (err) {
    console.warn(`[Timezone] Context update failed for lead ${leadId}:`, err);
  }
}
