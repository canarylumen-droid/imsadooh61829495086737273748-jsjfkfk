/**
 * Regional Business Norms & Cultural Intelligence
 * 
 * Provides cultural context and etiquette rules for different markets.
 * This ensures the AI doesn't just speak the language, but also "acts" 
 * according to local business expectations.
 */

export interface RegionalNorms {
  countryCode: string;
  tone: 'formal' | 'casual' | 'vibrant' | 'direct' | 'polite';
  addressStyle: 'first_name' | 'last_name' | 'honorific';
  etiquetteRules: string[];
}

const REGIONAL_MARKETS: Record<string, RegionalNorms> = {
  'US': {
    countryCode: 'US',
    tone: 'direct',
    addressStyle: 'first_name',
    etiquetteRules: [
      "Be direct and get to the point fast.",
      "Focus heavily on time-saving and ROI.",
      "Informal but professional is the standard."
    ]
  },
  'GB': {
    countryCode: 'GB',
    tone: 'polite',
    addressStyle: 'first_name',
    etiquetteRules: [
      "Use slightly more formal / polite language than the US.",
      "Avoid overly aggressive US-style 'hustle' talk.",
      "Build rapport before the hard pitch."
    ]
  },
  'DE': {
    countryCode: 'DE',
    tone: 'formal',
    addressStyle: 'last_name',
    etiquetteRules: [
      "Stricly use 'Sie' (formal) address unless explicitly invited to use 'du'.",
      "Be extremely precise with data and scheduling.",
      "No fluff. Focus on reliability and technical proof."
    ]
  },
  'ES': {
    countryCode: 'ES',
    tone: 'vibrant',
    addressStyle: 'first_name',
    etiquetteRules: [
      "Use high-energy, friendly language.",
      "Building a personal connection is crucial.",
      "Can be less direct than US/German counterparts."
    ]
  },
  'FR': {
    countryCode: 'FR',
    tone: 'polite',
    addressStyle: 'last_name',
    etiquetteRules: [
      "Use 'Vous' (formal) address at the start.",
      "Politeness is mandatory ('Bonjour' is never optional).",
      "Focus on quality and heritage."
    ]
  },
  'NG': {
    countryCode: 'NG',
    tone: 'polite',
    addressStyle: 'honorific',
    etiquetteRules: [
      "Highly respectful of titles and seniority.",
      "Rapport building via 'well wishes' is standard.",
      "Be persistent but extremely polite."
    ]
  },
  'AE': {
    countryCode: 'AE',
    tone: 'polite',
    addressStyle: 'first_name',
    etiquetteRules: [
      "Highly relationship-driven.",
      "Respect hierarchy and local traditions.",
      "Focus on mutual respect and long-term partnership."
    ]
  }
};

/**
 * Get cultural context for a specific country
 */
export function getRegionalNorms(countryCode: string | null): RegionalNorms {
  if (!countryCode) return REGIONAL_MARKETS['US'];
  return REGIONAL_MARKETS[countryCode.toUpperCase()] || REGIONAL_MARKETS['US'];
}

/**
 * Generate a prompt instruction string based on regional norms
 */
export function getRegionalInstruction(countryCode: string | null): string {
  const norms = getRegionalNorms(countryCode);
  return `
[REGIONAL ETIQUETTE — ${norms.countryCode}]:
- Overall Tone: ${norms.tone}
- Address Style: Use ${norms.addressStyle.replace('_', ' ')}.
- Cultural Rules:
${norms.etiquetteRules.map(r => `  * ${r}`).join('\n')}
`;
}
