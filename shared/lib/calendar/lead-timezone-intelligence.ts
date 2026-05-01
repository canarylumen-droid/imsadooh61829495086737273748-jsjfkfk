import { db } from '@shared/lib/db/db.js';
import { storage } from '@shared/lib/storage/storage.js';
import { leadTimezoneProfiles, leads, users } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import type { LeadTimezoneProfile } from '@audnix/shared';

/**
 * Lead Timezone Intelligence Service
 *
 * Automatically infers a lead's timezone and preferred contact hours
 * from their city and niche — zero manual input required.
 *
 * This means the AI can say:
 *   "How does Thursday at 5pm your time work?"
 * without ever asking the lead to specify their timezone.
 */

// ─── City → IANA Timezone Map ────────────────────────────────────────────────
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
  // USA East
  new_york: 'America/New_York', miami: 'America/New_York',
  atlanta: 'America/New_York', boston: 'America/New_York',
  charlotte: 'America/New_York', philadelphia: 'America/New_York',
  washington: 'America/New_York',
  // USA Central
  chicago: 'America/Chicago', houston: 'America/Chicago',
  dallas: 'America/Chicago', san_antonio: 'America/Chicago',
  austin: 'America/Chicago',
  // USA Mountain
  denver: 'America/Denver', phoenix: 'America/Phoenix',
  // USA West
  los_angeles: 'America/Los_Angeles', san_francisco: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles', san_diego: 'America/Los_Angeles',
  las_vegas: 'America/Los_Angeles',
  // Canada
  toronto: 'America/Toronto', montreal: 'America/Toronto',
  vancouver: 'America/Vancouver',
  // Australia
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne',
  brisbane: 'Australia/Brisbane',
  // India
  mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', bangalore: 'Asia/Kolkata',
  // Europe
  paris: 'Europe/Paris', berlin: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam',
  madrid: 'Europe/Madrid', rome: 'Europe/Rome',
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
  // Trades
  plumber:       { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Plumber' },
  plumbing:      { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Plumbing' },
  electrician:   { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Electrician' },
  electrical:    { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Electrical' },
  hvac:          { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'HVAC' },
  contractor:    { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Contractor' },
  roofer:        { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Roofer' },
  roofing:       { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Roofing' },
  landscaping:   { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'trades', displayName: 'Landscaping' },
  
  // Healthcare
  dentist:       { start: 19, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Dental' },
  dentistry:     { start: 19, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Dentistry' },
  doctor:        { start: 19, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Medical' },
  medical:       { start: 19, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Medical' },
  clinic:        { start: 19, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Clinic' },
  chiropractor:  { start: 19, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'healthcare', displayName: 'Chiropractic' },
  pharmacy:      { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'healthcare', displayName: 'Pharmacy' },
  
  // Real Estate
  real_estate:   { start: 18, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'real_estate', displayName: 'Real Estate' },
  realtor:       { start: 18, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'real_estate', displayName: 'Real Estate' },
  mortgage:      { start: 18, end: 21, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'real_estate', displayName: 'Mortgage' },
  property:      { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], category: 'real_estate', displayName: 'Property' },
  
  // Food & Beverage
  restaurant:    { start: 14, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'food_beverage', displayName: 'Restaurant' },
  cafe:          { start: 14, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'food_beverage', displayName: 'Cafe' },
  bakery:        { start: 13, end: 16, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'food_beverage', displayName: 'Bakery' },
  catering:      { start: 14, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday'], category: 'food_beverage', displayName: 'Catering' },
  
  // Professional Services
  lawyer:        { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Legal' },
  attorney:      { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Legal' },
  accountant:    { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Accounting' },
  consultant:    { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Consulting' },
  insurance:     { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Insurance' },
  financial:     { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'professional_services', displayName: 'Financial' },
  
  // Tech / SaaS
  saas:          { start: 10, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'SaaS' },
  software:      { start: 10, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Software' },
  technology:    { start: 10, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Technology' },
  startup:       { start: 10, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Startup' },
  marketing:     { start: 10, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Marketing' },
  agency:        { start: 10, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'Agency' },
  ecommerce:     { start: 10, end: 14, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'technology', displayName: 'E-Commerce' },
  
  // Fitness / Wellness
  gym:           { start: 18, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'wellness', displayName: 'Fitness' },
  fitness:       { start: 18, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'wellness', displayName: 'Fitness' },
  personal_trainer: { start: 18, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'wellness', displayName: 'Personal Training' },
  coach:         { start: 17, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'wellness', displayName: 'Coaching' },
  yoga:          { start: 18, end: 20, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'wellness', displayName: 'Yoga' },
  
  // Retail
  retail:        { start: 13, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'retail', displayName: 'Retail' },
  salon:         { start: 13, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'retail', displayName: 'Salon' },
  barbershop:    { start: 13, end: 17, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'retail', displayName: 'Barbershop' },
  
  // Automotive
  auto_repair:   { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'automotive', displayName: 'Auto Repair' },
  car_dealer:    { start: 17, end: 19, days: ['Monday','Tuesday','Wednesday','Thursday','Friday'], category: 'automotive', displayName: 'Auto Sales' },
};

const DEFAULT_WINDOW: NicheWindow = {
  start: 10, end: 18,
  days: ['Monday','Tuesday','Wednesday','Thursday','Friday'],
  category: 'general',
  displayName: 'General Business',
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Maps a city name to an IANA timezone string.
 * @param city City name
 * @param fallback Default timezone if city mapping fails (defaults to UTC)
 */
export function inferTimezoneFromCity(city: string, fallback: string = 'UTC'): string {
  if (!city) return fallback;
  const key = city.toLowerCase().replace(/[\s\-]/g, '_');
  return CITY_TIMEZONE_MAP[key] || fallback;
}

/**
 * Returns the preferred contact window for a given niche keyword.
 * Scans niche text for any known niche keywords.
 */
export function inferPreferredWindowFromNiche(niche: string): NicheWindow {
  if (!niche) return DEFAULT_WINDOW;
  const lower = niche.toLowerCase();
  // Direct key match
  for (const [key, window] of Object.entries(NICHE_WINDOWS)) {
    if (lower.includes(key)) return window;
  }
  return DEFAULT_WINDOW;
}

/**
 * Format a time for natural-language booking copy.
 * e.g. 17 → "5pm", 9 → "9am", 13 → "1pm"
 */
export function formatLocalHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

/**
 * Determines if a given UTC date falls within the lead's preferred contact window.
 */
export function isWithinLeadPreferredWindow(
  utcDate: Date,
  profile: { detectedTimezone: string | null; preferredContactStart: number | null; preferredContactEnd: number | null; preferredDays: string[] | null },
  defaultTz: string = 'UTC'
): boolean {
  const tz = profile.detectedTimezone || defaultTz;
  const start = profile.preferredContactStart ?? 10;
  const end = profile.preferredContactEnd ?? 18;
  const days = profile.preferredDays || ['Monday','Tuesday','Wednesday','Thursday','Friday'];

  try {
    const localHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(utcDate),
      10
    );
    const localDay = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(utcDate);
    return localHour >= start && localHour < end && days.includes(localDay);
  } catch {
    return true; // fail open
  }
}

/**
 * Auto-populate or update a lead's timezone profile.
 * Called automatically on lead creation/import.
 */
export async function populateLeadProfile(
  leadId: string,
  userId: string,
  options: {
    city?: string | null;
    niche?: string | null;
    industry?: string | null;
    company?: string | null;
  } = {}
): Promise<void> {
  if (!db) return;

  const nicheInput = options.niche || options.industry || '';
  const cityInput = options.city || '';

  // Get user profile first to find their default timezone
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  const userTz = user?.timezone || 'UTC';

  const detectedTimezone = inferTimezoneFromCity(cityInput, userTz);
  const window = inferPreferredWindowFromNiche(nicheInput);
  const confidence = (cityInput ? 0.5 : 0) + (nicheInput ? 0.5 : 0);

  try {
    await db
      .insert(leadTimezoneProfiles)
      .values({
        leadId,
        userId,
        detectedTimezone,
        detectedCity: cityInput || null,
        niche: nicheInput || null,
        nicheCategory: window.category,
        preferredContactStart: window.start,
        preferredContactEnd: window.end,
        preferredDays: window.days,
        detectionConfidence: confidence,
        detectionSource: confidence > 0 ? 'city_niche_inference' : 'none',
        lastUpdatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: leadTimezoneProfiles.leadId,
        set: {
          detectedTimezone,
          detectedCity: cityInput || null,
          niche: nicheInput || null,
          nicheCategory: window.category,
          preferredContactStart: window.start,
          preferredContactEnd: window.end,
          preferredDays: window.days,
          detectionConfidence: confidence,
          detectionSource: confidence > 0 ? 'city_niche_inference' : 'none',
          lastUpdatedAt: new Date(),
        },
      });

    console.log(`[LeadTimezoneIntelligence] Profile set for lead ${leadId}: TZ=${detectedTimezone}, Window=${window.start}:00-${window.end}:00 (${window.category})`);
  } catch (err) {
    console.warn(`[LeadTimezoneIntelligence] Could not save profile for lead ${leadId}:`, err);
  }
}

/**
 * Retrieve the timezone profile for a lead (with smart fallback).
 */
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

/**
 * Update a lead's profile from context learned in conversation.
 * e.g. if lead says "I'm in Chicago" and we learn their niche is plumbing.
 */
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
    console.warn(`[LeadTimezoneIntelligence] Could not update profile for lead ${leadId}:`, err);
  }
}



