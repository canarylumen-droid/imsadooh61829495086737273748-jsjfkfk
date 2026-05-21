import { storage } from '../storage.js';
import { scheduleInitialFollowUp } from './ai/follow-up-worker.js';
import OpenAI from 'openai';
import { MODELS } from './ai/model-config.js';
import { EmailVerifier } from './scraping/email-verifier.js';
import type { PDFProcessingResult } from '../../shared/types.js';
import * as pdf from 'pdf-parse';

const openaiKey = process.env.OPENAI_API_KEY;
const openai = openaiKey ? new OpenAI({
  apiKey: openaiKey,
}) : null;

if (!openaiKey) {
  console.error('❌ CRITICAL: OPENAI_API_KEY not set');
  console.error('📋 PDF analysis and AI features will be disabled');
}

/**
 * Process PDF file and extract lead information + offer details with AI
 */
export async function processPDF(
  fileBuffer: Buffer,
  userId: string,
  options?: {
    autoReachOut?: boolean;
    extractOffer?: boolean;
  }
): Promise<PDFProcessingResult> {
  try {
    // Handle large files (>10MB) with max buffer size
    const maxBufferSize = 50 * 1024 * 1024; // 50MB max
    if (fileBuffer.length > maxBufferSize) {
      return {
        success: false,
        leadsCreated: 0,
        error: `PDF too large (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB). Maximum size is 50MB.`
      };
    }

    // Use pdf-parse for reliable Node.js text extraction
    // Handle potential callability issues with different export formats
    const pdfParse = (pdf as any).default || pdf;
    const pdfData = await pdfParse(fileBuffer);
    const text = pdfData.text;

    // VALIDATION: Ensure we have some text
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        leadsCreated: 0,
        error: 'PDF parsing failed completely. Please try again.'
      };
    }

    // Extract offer/product information if requested
    let offerData;
    let brandData;
    if (options?.extractOffer) {
      const extractedData = await extractOfferAndBrandWithAI(text, userId);
      offerData = extractedData.offer;
      brandData = extractedData.brand;

      // Trigger automatic outreach for existing leads now that we have brand context
      try {
        const { triggerAutoOutreach } = await import('./sales-engine/outreach-engine.js');
        await triggerAutoOutreach(userId);
      } catch (outreachError) {
        console.warn('Failed to trigger auto-outreach after brand extraction:', outreachError);
      }
    }

    // Extract leads with AI
    let parsedLeads = await extractLeadsWithAI(text);

    if (parsedLeads.length === 0) {
      // Fallback to regex if AI fails
      parsedLeads = parseLeadsFromText(text);
    }

    if (parsedLeads.length === 0 && !offerData) {
      return {
        success: false,
        leadsCreated: 0,
        error: 'No valid lead data or offer information found in PDF'
      };
    }

    // Create leads in database with extracted contact info
    const verifier = new EmailVerifier();
    const createdLeads = [];
    for (const leadData of parsedLeads) {
      try {
        const leadChannel = leadData.email ? 'email' : 'instagram';

        let status = 'new';
        let verified = false;
        let recoveryTarget = leadData.email;
        let isRecovered = false;

        if (leadData.email) {
          let verification = await verifier.verify(leadData.email);
          if (verification.valid) {
            verified = true;
            status = 'hardened';
          } else {
            // Neural Recovery Path (Optional for PDF leads, but let's be consistent)
            if (leadData.company || leadData.name) {
              try {
                const { GoogleGenerativeAI } = await import("@google/generative-ai");
                const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
                const recoveryModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                const recoveryPrompt = `BUSINESS: ${leadData.company || leadData.name}\nEMAIL: ${leadData.email}\nDeliverability failed. Is there a more likely valid business email or domain for this business? Return ONLY the corrected email string or "NONE".`;
                const recoveryResult = await recoveryModel.generateContent(recoveryPrompt);
                const correctedEmail = recoveryResult.response.text().trim();

                if (correctedEmail !== 'NONE' && correctedEmail !== leadData.email && correctedEmail.includes('@')) {
                  const secondaryVerification = await verifier.verify(correctedEmail);
                  if (secondaryVerification.valid) {
                    recoveryTarget = correctedEmail;
                    verified = true;
                    isRecovered = true;
                    status = 'recovered';
                  }
                }
              } catch (e) { }
            }

            if (!verified) {
              status = 'bouncy';
            }
          }
        }

        const lead = await storage.createLead({
          userId,
          name: leadData.name,
          email: recoveryTarget || undefined,
          phone: leadData.phone,
          company: leadData.company,
          role: leadData.role,
          channel: leadChannel as 'email' | 'instagram',
          status: status as any,
          verified: verified,
          verifiedAt: verified ? new Date() : null,
          metadata: {
            source: 'pdf_import',
            pdf_extracted: true,
            has_email: !!leadData.email,
            has_phone: !!leadData.phone,
            deliverability: verified ? 'safe' : 'bouncy',
            is_recovered: isRecovered
          }
        });

        createdLeads.push({
          id: lead.id,
          name: lead.name,
          email: lead.email || undefined,
          phone: lead.phone || undefined,
          company: lead.metadata?.company || undefined
        });

        // Auto-schedule initial follow-up for imported leads
        try {
          await scheduleInitialFollowUp(userId, lead.id, leadChannel as 'email' | 'instagram' | 'manual');
        } catch (followUpError) {
          console.warn(`Failed to schedule follow-up for ${lead.name}:`, followUpError);
        }

        // Auto-reach out if enabled and offer data exists
        if (options?.autoReachOut && offerData && (leadData.email || leadData.phone)) {
          await autoReachOutToLead(userId, lead, offerData);
        }
      } catch (error) {
        console.error('Error creating lead:', error);
      }
    }

    return {
      success: true,
      leadsCreated: createdLeads.length,
      leads: createdLeads,
      offerExtracted: offerData,
      brandExtracted: brandData
    };
  } catch (error) {
    console.error('PDF processing error:', error);
    return {
      success: false,
      leadsCreated: 0,
      error: error instanceof Error ? error.message : 'Failed to process PDF'
    };
  }
}

/**
 * Extract colors from PDF text using advanced regex patterns
 */
function extractColorsFromText(text: string): {
  primary?: string;
  secondary?: string;
  accent?: string;
  all: string[];
} {
  const colors: string[] = [];

  // Extract hex colors (#RRGGBB or #RGB)
  const hexPattern = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g;
  const hexMatches = text.match(hexPattern) || [];
  colors.push(...hexMatches);

  // Extract RGB/RGBA colors
  const rgbPattern = /rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)/gi;
  let rgbMatch;
  while ((rgbMatch = rgbPattern.exec(text)) !== null) {
    const r = parseInt(rgbMatch[1]);
    const g = parseInt(rgbMatch[2]);
    const b = parseInt(rgbMatch[3]);
    // Convert RGB to hex
    const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    colors.push(hex.toUpperCase());
  }

  // Extract named colors in brand context
  const colorNames = [
    'navy', 'blue', 'coral', 'teal', 'purple', 'violet', 'indigo',
    'green', 'emerald', 'red', 'crimson', 'orange', 'amber', 'yellow',
    'gold', 'pink', 'rose', 'magenta', 'cyan', 'turquoise', 'lime',
    'mint', 'sage', 'olive', 'maroon', 'burgundy', 'plum', 'lavender'
  ];

  const brandColorPattern = new RegExp(
    `(?:brand|primary|secondary|accent|main)\\s*(?:color|colour)?\\s*:?\\s*(${colorNames.join('|')})`,
    'gi'
  );
  const namedMatches = text.match(brandColorPattern) || [];
  colors.push(...namedMatches.map(m => m.split(/[:\s]+/).pop()!));

  // Remove duplicates and normalize
  const uniqueColors = [...new Set(colors.map(c => c.toUpperCase()))];

  // Try to identify primary, secondary, accent from context
  let primary, secondary, accent;

  const primaryMatch = text.match(/primary\s*(?:color|colour)?[:\s]*([#\w]+)/i);
  if (primaryMatch) primary = primaryMatch[1];

  const secondaryMatch = text.match(/secondary\s*(?:color|colour)?[:\s]*([#\w]+)/i);
  if (secondaryMatch) secondary = secondaryMatch[1];

  const accentMatch = text.match(/accent\s*(?:color|colour)?[:\s]*([#\w]+)/i);
  if (accentMatch) accent = accentMatch[1];

  // Fallback: assign first 3 unique colors
  if (!primary && uniqueColors.length > 0) primary = uniqueColors[0];
  if (!secondary && uniqueColors.length > 1) secondary = uniqueColors[1];
  if (!accent && uniqueColors.length > 2) accent = uniqueColors[2];

  return {
    primary,
    secondary,
    accent,
    all: uniqueColors
  };
}

/**
 * Extract offer/product information AND brand colors/identity from PDF using AI + regex
 */
async function extractOfferAndBrandWithAI(text: string, userId: string): Promise<{
  offer: any;
  brand: any;
}> {
  // First, extract colors using regex (works without OpenAI)
  const extractedColors = extractColorsFromText(text);

  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ OpenAI API key not configured - using regex-based brand extraction only');
    // Return regex-based colors if OpenAI not available
    return {
      offer: null,
      brand: {
        colors: {
          primary: extractedColors.primary,
          secondary: extractedColors.secondary,
          accent: extractedColors.accent
        },
        allColors: extractedColors.all
      }
    };
  }

  try {
    if (!openai) {
      throw new Error("OpenAI not initialized");
    }
    const response = await openai.chat.completions.create({
      model: MODELS.lead_intelligence,
      messages: [{
        role: 'system',
        content: `You are an elite brand and product analyst. Extract exhaustive product/service and brand identity data from this document. 

Return JSON with two primary objects:

1. "offer": Extract product name, comprehensive description, pricing models, all features mentioned, key benefits, call-to-action text, support/contact emails, and any website/product links.
2. "brand": Extract ALL brand colors (prioritize hex codes, then RGB, then names), company name (be precise, check headers/footers), tagline, website URL, and visual identity description.

For company name, look for:
- "Company Name: [Name]"
- "Business: [Name]"
- Headers, copyright notices, or logo alt-text patterns.

For colors, scan the text for:
- Hex patterns like #FFFFFF or #FFF.
- RGB/RGBA strings.
- Explicit mentions like "Our primary color is..." or "Brand palette: ...".

Return valid JSON with these fields. Be thorough - missing data reduces sales accuracy.`
      }, {
        role: 'user',
        content: text.substring(0, 12000)
      }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1200
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    console.log('✅ Brand analysis complete via OpenAI');

    // Merge AI-extracted colors with regex-extracted colors for maximum coverage
    const aiColors = result.brand?.colors || {};
    const mergedColors = {
      primary: aiColors.primary || extractedColors.primary,
      secondary: aiColors.secondary || extractedColors.secondary,
      accent: aiColors.accent || extractedColors.accent,
      allColors: [
        ...(aiColors.allColors || []),
        ...extractedColors.all
      ].filter((v, i, a) => a.indexOf(v) === i) // Remove duplicates
    };

    result.brand = {
      ...result.brand,
      colors: mergedColors
    };

    // Store both offer and brand in user's profile and settings for future auto-responses
    if (result.offer?.productName || result.brand?.companyName) {
      await storage.updateUser(userId, {
        metadata: {
          extracted_offer: result.offer || {},
          extracted_brand: result.brand || {},
          brand_colors: mergedColors,
          extraction_source: 'pdf_import',
          extraction_updated_at: new Date().toISOString()
        }
      });

      // Synchronize with user_settings brand_context for the Command Center
      try {
        const { db } = await import('../db.js');
        const { sql } = await import('drizzle-orm');
        await db.execute(sql`
          UPDATE user_settings 
          SET brand_context = ${JSON.stringify(result.brand || {})}::jsonb,
              updated_at = NOW()
          WHERE user_id = ${userId}
        `);
      } catch (settingsError) {
        console.warn('Failed to sync brand_context to user_settings:', settingsError);
      }
    }

    return {
      offer: result.offer || null,
      brand: result.brand || null
    };
  } catch (error: any) {
    console.error('❌ Brand/Offer extraction error:', error?.message || error);
    console.error('📋 Falling back to regex-based brand extraction');
    // Return regex-based extraction as fallback
    return {
      offer: null,
      brand: {
        colors: {
          primary: extractedColors.primary,
          secondary: extractedColors.secondary,
          accent: extractedColors.accent
        },
        allColors: extractedColors.all
      }
    };
  }
}

/**
 * Auto-reach out to leads via email with offer info and brand colors
 */
async function autoReachOutToLead(
  userId: string,
  lead: any,
  offerData: any
): Promise<void> {
  try {
    const { sendEmail } = await import('./channels/email.js');

    // Get user's extracted brand data
    const user = await storage.getUserById(userId);
    const brandData = user?.metadata?.extracted_brand || {};
    const brandColors = brandData.colors || {};

    const message = `Hey ${lead.name}! I noticed you might be interested in ${offerData.productName}. ${offerData.description}

${offerData.features?.slice(0, 3).map((f: string) => `✓ ${f}`).join('\n')}

${offerData.price ? `Investment: ${offerData.price}` : ''}
${offerData.link ? `Learn more: ${offerData.link}` : ''}
${offerData.supportEmail ? `\nQuestions? Reach us at ${offerData.supportEmail}` : ''}

Would you like to discuss how this can help you?`;

    // Try email first if available
    if (lead.email) {
      try {
        await sendEmail(
          userId,
          lead.email,
          message,
          `${offerData.productName} - Exclusive Offer`,
          {
            buttonText: offerData.cta || 'Get Started',
            buttonUrl: offerData.link || brandData.website || '#',
            businessName: brandData.companyName || 'Your Business',
            brandColors: {
              primary: brandColors.primary,
              accent: brandColors.accent || brandColors.secondary
            }
          }
        );

        await storage.createMessage({
          leadId: lead.id,
          userId,
          provider: 'email',
          direction: 'outbound',
          body: message,
          metadata: {
            auto_outreach: true,
            source: 'pdf_extraction'
          }
        });
      } catch (error) {
        console.error('Email outreach failed:', error);
      }
    }

    // Phone reach-out not currently supported as system focus is Instagram & Email
    if (lead.phone) {
      console.log(`[Reachout] Skipping phone outreach for ${lead.phone} - Phone mesh inactive.`);
    }
  } catch (error) {
    console.error('Auto-reach out error:', error);
  }
}

/**
 * Extract leads using OpenAI for better accuracy
 */
async function extractLeadsWithAI(text: string): Promise<Array<{
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
}>> {
  if (!process.env.OPENAI_API_KEY) {
    return [];
  }

  try {
    if (!openai) {
      throw new Error("OpenAI not initialized");
    }
    const response = await openai.chat.completions.create({
      model: MODELS.lead_intelligence,
      messages: [{
        role: 'system',
        content: `You are a world-class lead data extraction engine. Your task is to identify and extract every single lead and contact point from the source text.

RULES:
1. "name": Extract full human names. If only a username is found, use it.
2. "role": Identify their position (e.g. CEO, Founder, Agency Owner, CMO). Be specific.
3. "company": Identify the business name associated with the contact.
4. "email": Extract valid email addresses.
5. "phone": Extract phone numbers, cleaning them of non-numeric chars but preserving '+' if present.
6. "channel": Determine if the lead is best contacted via "email" or "instagram".

PRECISION GUIDELINES:
- Look for "To:", "Attn:", "From:", "CEO:", or signatures.
- Avoid mixing up company names with human names.
- If multiple contacts exist for one company, create separate lead entries.

Return a JSON object with a "leads" array. 
Example Output: { "leads": [{ "name": "...", "role": "...", "email": "...", "company": "...", "phone": "...", "channel": "..." }] }

Be aggressive - if it looks like a lead, include it.`
      }, {
        role: 'user',
        content: text.substring(0, 10000)
      }],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1000
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    return result.leads || [];
  } catch (error) {
    console.error('AI lead extraction failed:', error);
    return [];
  }
}

/**
 * Parse leads from text using advanced regex patterns (fallback)
 */
function parseLeadsFromText(text: string): Array<{
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
}> {
  const leads: Array<{
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    role?: string;
  }> = [];

  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
  const nameRegex = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\b/g;
  const companyRegex = /\b([A-Z][A-Za-z0-9\s&]+(?:Inc|LLC|Corp|Ltd|Limited|Co|Company|Group|Solutions|Technologies)\.?)\b/g;

  const emailMap = new Map<string, string>();
  const phoneMap = new Map<string, string>();
  const companyMap = new Map<string, string>();

  for (const line of lines) {
    const lineEmail = line.match(emailRegex)?.[0];
    const lineName = line.match(nameRegex)?.[0];
    const linePhone = line.match(phoneRegex)?.[0];
    const lineCompany = line.match(companyRegex)?.[0];

    if (lineName) {
      if (lineEmail) emailMap.set(lineName, lineEmail);
      if (linePhone) phoneMap.set(lineName, linePhone.replace(/\D/g, ''));
      if (lineCompany) companyMap.set(lineName, lineCompany);
    }
  }

  const names = text.match(nameRegex) || [];
  const uniqueNames = new Set(names);

  for (const name of uniqueNames) {
    leads.push({
      name,
      email: emailMap.get(name),
      phone: phoneMap.get(name),
      company: companyMap.get(name)
    });
  }

  if (leads.length === 0) {
    const emails = text.match(emailRegex) || [];
    for (const email of emails) {
      const namePart = email.split('@')[0].replace(/[._-]/g, ' ');
      const capitalizedName = namePart.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      leads.push({ name: capitalizedName, email });
    }
  }

  return leads;
}

/**
 * Export leads to CSV format
 */
export async function exportLeadsToCSV(userId: string): Promise<string> {
  const leads = await storage.getLeads({ userId, limit: 10000 });

  const headers = ['Name', 'Email', 'Phone', 'Company', 'Channel', 'Status', 'Score', 'Created At'];
  const rows = leads.map(lead => [
    lead.name,
    lead.email || '',
    lead.phone || '',
    lead.metadata?.company || '',
    lead.channel,
    lead.status,
    lead.score || 0,
    new Date(lead.createdAt).toISOString()
  ]);

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n');

  return csv;
}
