/**
 * AI-Powered CSV Column Mapper
 * Automatically maps user CSV columns to the leads table schema using AI
 */

import { generateReply } from "../core/ai-service.js";
import { MODELS } from "./model-config.js";

// Target schema for leads table
export const LEADS_SCHEMA = {
    name: { description: "Full name of the lead/contact", required: true },
    email: { description: "Email address", required: false },
    phone: { description: "Phone/mobile number", required: false },
    company: { description: "Company/organization name", required: false },
    role: { description: "Job title or role (e.g. Founder, CEO)", required: false },
    bio: { description: "Brief background or specific info about the lead", required: false },
    channel: { description: "Communication channel (instagram/email)", required: false },
    reply_email: { description: "Alternative email address for replies", required: false },
    website: { description: "Website or domain URL", required: false },
    business_name: { description: "Registered business or store name", required: false },
    city: { description: "City or location for timezone and local intelligence", required: false },
    country: { description: "Country name", required: false },
    niche: { description: "Business niche or industry category (e.g. Plumbing, SaaS)", required: false },
    industry: { description: "Industry sector", required: false },
    revenue: { description: "Annual revenue or sales volume", required: false },
};

export type LeadColumnMapping = {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    role?: string;
    bio?: string;
    channel?: string;
    reply_email?: string;
    website?: string;
    business_name?: string;
    city?: string;
    country?: string;
    niche?: string;
    industry?: string;
    revenue?: string;
    notes?: string;
};

export interface MappingResult {
    mapping: LeadColumnMapping;
    confidence: number;
    unmappedColumns: string[];
}

// AI initialization removed in favor of unified ai-service

/**
 * Use AI to map CSV headers to leads schema
 */
export async function mapCSVColumnsToSchema(
    headers: string[],
    sampleRows: Record<string, string>[] = [],
    skipAI: boolean = false
): Promise<MappingResult> {
    const targetFields = Object.keys(LEADS_SCHEMA);

    // Auto-skip AI if no API keys are configured OR if they are placeholders
    const hasGemini = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith("AIza");
    const hasOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10;
    
    if (skipAI || (!hasGemini && !hasOpenAI)) {
        console.log('[CSV] Skipping AI mapping — using header-based matching (No valid API keys found or AI paused)');
        return fallbackMapping(headers);
    }

    // Build sample data context
    const sampleContext = sampleRows.slice(0, 3).map(row =>
        headers.map(h => `${h}: ${row[h] || ''}`).join(', ')
    ).join('\n');

    const prompt = `You are an elite data architect specialized in messy CSV ingestion. Your task is to accurately map foreign CSV headers to our standardized leads schema.

TARGET SCHEMA (Internal Fields):
${targetFields.map(f => `- ${f}: ${LEADS_SCHEMA[f as keyof typeof LEADS_SCHEMA].description}`).join('\n')}

IMPORT SOURCE HEADERS:
${headers.map(h => `- "${h}"`).join('\n')}

${sampleContext ? `REAL SAMPLE DATA FROM FILE (First 3 rows):\n${sampleContext}` : ''}

TASK:
Identify which user column corresponds to which target field. 
- Use the sample data to disambiguate (e.g., if a column is named "ID" but contains "john@doe.com", it's an email).
- If multiple columns could match (e.g., "First Name", "Last Name"), prioritize the one with full content.
- Be precise with "Company" vs "Name".

Return ONLY a JSON object:
{
  "mapping": { "name": "UserHeaderA", "email": "UserHeaderB", ... },
  "confidence": 0.0-1.0,
  "unmappedColumns": ["list of headers that don't match our schema"]
}

IMPORTANT: The "mapping" keys must be exactly from our TARGET SCHEMA. Values must be EXACT headers from the USER CSV.`;

    try {
        const response = await generateReply(
            "You are a data mapping expert.",
            prompt,
            {
                model: MODELS.intent_classification,
                jsonMode: true,
                temperature: 0.2,
                maxTokens: 500
            }
        );

        if (response.text) {
            const parsed = JSON.parse(response.text);
            return normalizeMapping(parsed, headers);
        }
    } catch (error) {
        console.warn(`[CSV] AI mapping failed (${error instanceof Error ? error.message : 'Unknown error'}), using robust fallback`);
        // Use local robust fallback instead of external one
        return fallbackMapping(headers);
    }

    // Fallback: use fuzzy matching
    return fallbackMapping(headers);
}

/**
 * Normalize and validate the AI response
 */
function normalizeMapping(parsed: any, headers: string[]): MappingResult {
    const mapping: LeadColumnMapping = {};
    const mappedColumns = new Set<string>();

    // Handle different response formats
    const rawMapping = parsed.mapping || parsed;

    for (const [targetField, sourceColumn] of Object.entries(rawMapping)) {
        if (targetField in LEADS_SCHEMA && typeof sourceColumn === 'string') {
            // Verify the source column exists in headers (case-insensitive)
            const matchedHeader = headers.find(h =>
                h.toLowerCase() === sourceColumn.toLowerCase()
            );
            if (matchedHeader) {
                mapping[targetField as keyof LeadColumnMapping] = matchedHeader;
                mappedColumns.add(matchedHeader);
            }
        }
    }

    const unmappedColumns = headers.filter(h => !mappedColumns.has(h));

    return {
        mapping,
        confidence: parsed.confidence || 0.8,
        unmappedColumns
    };
}

/**
 * Fallback mapping using fuzzy string matching
 */
function fallbackMapping(headers: string[]): MappingResult {
    const mapping: LeadColumnMapping = {};
    const mappedColumns = new Set<string>();

    // Common variations for each field
    const patterns: Record<string, RegExp[]> = {
        name: [
            /^name$/i, /^full[_\s-]?name$/i, /^contact[_\s-]?name$/i,
            /^lead[_\s-]?name$/i, /^business[_\s-]?name$/i, /^client[_\s-]?name$/i,
            /^first[_\s-]?name$/i, /^person$/i, /^lead$/i, /^customer$/i,
            /^fname$/i, /^lname$/i, /^contact$/i, /^entity$/i, /^fullname$/i,
            /^prospective[_\s-]?name$/i, /^business$/i, /^company$/i
        ],
        email: [
            /^e?-?mail$/i, /^email[_\s-]?addr/i, /^contact[_\s-]?email$/i,
            /^e-?mail[_\s-]?address$/i, /^mail$/i, /^work[_\s-]?email$/i,
            /^primary[_\s-]?email$/i, /^email[_\s-]?(1|2)$/i, /^addr/i
        ],
        phone: [
            /^phone$/i, /^mobile$/i, /^cell$/i, /^tel/i, /^contact[_\s-]?number$/i,
            /^phone[_\s-]?number$/i, /^telephone$/i, /^whatsapp$/i, /^mobile[_\s-]?number$/i
        ],
        company: [
            /^company$/i, /^org/i, /^business$/i, /^employer$/i, /^firm$/i,
            /^account$/i, /^company[_\s-]?name$/i, /^organization$/i, /^corp/i
        ],
        role: [
            /^role$/i, /^title$/i, /^job[_\s-]?title$/i, /^position$/i, /^function$/i,
            /^occupation$/i, /^work[_\s-]?role$/i, /^designation$/i
        ],
        channel: [
            /^channel$/i, /^source$/i, /^platform$/i, /^medium$/i, /^origin$/i
        ],
        industry: [
            /^industry$/i, /^niche$/i, /^sector$/i, /^category$/i, /^market$/i, /^business[_\s-]?type$/i
        ],
        niche: [
            /^niche$/i, /^industry$/i, /^sector$/i, /^category$/i, /^market$/i, /^business[_\s-]?type$/i, /^specialty$/i
        ],
        city: [
            /^city$/i, /^town$/i, /^location$/i, /^municipality$/i, /^area$/i, /^suburb$/i, /^geo$/i
        ],
        country: [
            /^country$/i, /^nation$/i, /^region$/i
        ],
        website: [
            /^website$/i, /^url$/i, /^link$/i, /^site$/i, /^domain$/i, /^web[_\s-]?addr/i, /^home[_\s-]?page$/i
        ],
        business_name: [
            /^business[_\s-]?name$/i, /^store[_\s-]?name$/i, /^brand[_\s-]?name$/i, /^shop[_\s-]?name$/i
        ],
        revenue: [
            /^revenue$/i, /^annual[_\s-]?revenue$/i, /^sales[_\s-]?volume$/i, /^turnover$/i, /^income$/i
        ],
        notes: [
            /^notes$/i, /^description$/i, /^info$/i, /^comments$/i, /^about$/i,
            /^remarks$/i, /^feedback$/i, /^details$/i, /^extra$/i
        ],
        reply_email: [
            /^reply[_\s-]?email$/i, /^reply[_\s-]?to$/i, /^alt[_\s-]?email$/i,
            /^secondary[_\s-]?email$/i
        ]
    };

    for (const [field, regexes] of Object.entries(patterns)) {
        for (const header of headers) {
            if (mappedColumns.has(header)) continue;

            for (const regex of regexes) {
                if (regex.test(header)) {
                    mapping[field as keyof LeadColumnMapping] = header;
                    mappedColumns.add(header);
                    break;
                }
            }
            if (mapping[field as keyof LeadColumnMapping]) break;
        }
    }

    // If no 'name' was mapped, use 'company' as a fallback for lead name
    if (!mapping.name && mapping.company) {
        mapping.name = mapping.company;
    }

    const unmappedColumns = headers.filter(h => !mappedColumns.has(h));

    return {
        mapping,
        confidence: 0.6, // Lower confidence for fallback
        unmappedColumns
    };
}

/**
 * Extract a lead record using the mapping
 */
export function extractLeadFromRow(
    row: Record<string, string>,
    mapping: LeadColumnMapping
): { name?: string; email?: string; phone?: string; company?: string; channel?: string; role?: string; bio?: string; replyEmail?: string; website?: string; businessName?: string; city?: string; country?: string; niche?: string; industry?: string; revenue?: string } {
    let email = mapping.email ? row[mapping.email]?.trim() : undefined;
    
    // Fallback: If no email was mapped, search all columns for an email pattern
    if (!email) {
        for (const value of Object.values(row)) {
            if (typeof value === 'string' && value.includes('@') && value.includes('.')) {
                // Heuristic for email: must contains @ and . and no spaces
                const trimmed = value.trim();
                if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                    email = trimmed;
                    break;
                }
            }
        }
    }

    return {
        name: mapping.name ? row[mapping.name]?.trim() : undefined,
        email,
        phone: mapping.phone ? row[mapping.phone]?.trim() : undefined,
        company: mapping.company ? row[mapping.company]?.trim() : undefined,
        role: mapping.role ? row[mapping.role]?.trim() : undefined,
        bio: mapping.bio ? row[mapping.bio]?.trim() : (mapping.notes ? row[mapping.notes]?.trim() : undefined),
        channel: mapping.channel ? row[mapping.channel]?.trim() : undefined,
        replyEmail: mapping.reply_email ? row[mapping.reply_email]?.trim() : undefined,
        website: mapping.website ? row[mapping.website]?.trim() : undefined,
        businessName: mapping.business_name ? row[mapping.business_name]?.trim() : undefined,
        city: mapping.city ? row[mapping.city]?.trim() : undefined,
        country: mapping.country ? row[mapping.country]?.trim() : undefined,
        niche: mapping.niche ? row[mapping.niche]?.trim() : undefined,
        industry: mapping.industry ? row[mapping.industry]?.trim() : undefined,
        revenue: mapping.revenue ? row[mapping.revenue]?.trim() : undefined,
    };
}

/**
 * Extract all unmapped columns as metadata (industry, notes, etc.)
 * This preserves any extra details the user included in their CSV
 */
export function extractExtraFieldsAsMetadata(
    row: Record<string, string>,
    mapping: LeadColumnMapping
): Record<string, string> {
    const mappedColumns = new Set(Object.values(mapping).filter(Boolean));
    const metadata: Record<string, string> = {};

    for (const [column, value] of Object.entries(row)) {
        if (!mappedColumns.has(column) && value?.trim()) {
            const trimmedValue = value.trim();
            // Convert column name to snake_case for metadata key
            const key = column.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
            if (key) {
                metadata[key] = trimmedValue;
                
                // Identify link types for the UI
                if (trimmedValue.includes('google.com/maps') || trimmedValue.includes('goo.gl/maps')) {
                    metadata[`${key}_type`] = 'google_maps';
                } else if (trimmedValue.includes('linkedin.com/')) {
                    metadata[`${key}_type`] = 'linkedin';
                } else if (trimmedValue.includes('instagram.com/')) {
                    metadata[`${key}_type`] = 'instagram';
                } else if (trimmedValue.includes('twitter.com/') || trimmedValue.includes('x.com/')) {
                    metadata[`${key}_type`] = 'twitter';
                } else if (/^https?:\/\//i.test(trimmedValue)) {
                    metadata[`${key}_type`] = 'website';
                }
            }
        }
    }

    return metadata;
}


