/**
 * Shared template variable replacement utility.
 * All campaign/outreach processors use this single implementation.
 */

export interface LeadTemplateContext {
  name?: string | null;
  company?: string | null;
  city?: string | null;
  metadata?: Record<string, any> | null;
}

const PLACEHOLDER_NAME = 'Unknown';

export function resolveTemplateVars(
  text: string,
  lead: LeadTemplateContext
): string {
  const rawName = lead.name?.trim();
  const cleanName = rawName === PLACEHOLDER_NAME ? undefined : rawName;
  const firstName = cleanName?.split(' ')[0] || 'there';
  const lastName = cleanName?.split(' ').slice(1).join(' ') || 'there';
  const fullName = cleanName || firstName;
  const company = lead.company?.trim() || 'your company';
  const meta = lead.metadata || {};
  const city = meta.city || lead.city || '';
  const industry = meta.industry || '';
  const niche = meta.niche || '';
  const website = meta.website || '';

  return text
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{lastName}}/g, lastName)
    .replace(/{{name}}/g, fullName)
    .replace(/{{lead_name}}/g, fullName)
    .replace(/{{company}}/g, company)
    .replace(/{{business_name}}/g, company)
    .replace(/{{city}}/g, city)
    .replace(/{{industry}}/g, industry)
    .replace(/{{niche}}/g, niche)
    .replace(/{{website}}/g, website);
}

export function resolveTemplateVarsWithSubject(
  body: string,
  subject: string,
  lead: LeadTemplateContext
): { body: string; subject: string } {
  return {
    body: resolveTemplateVars(body, lead),
    subject: resolveTemplateVars(subject, lead),
  };
}
