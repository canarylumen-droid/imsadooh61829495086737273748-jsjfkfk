import { detectLanguage, updateLeadLanguage, getLocalizedResponse, type LanguageDetection } from '../core/language-detector.js';
import { optimizeSalesLanguage } from '../formatters/sales-language-optimizer.js';

/**
 * Handles language detection and lead language updates.
 */
export async function handleLanguageDetection(leadId: string, text: string): Promise<LanguageDetection> {
  const languageDetection = detectLanguage(text);
  if (languageDetection.confidence > 0.6 && languageDetection.code !== 'en') {
    await updateLeadLanguage(leadId, languageDetection);
  }
  return languageDetection;
}

/**
 * Localizes and optimizes a response based on detected language.
 */
export async function localizeAndOptimize(text: string, language: LanguageDetection, context: 'objection' | 'product_info' | 'greeting' = 'greeting'): Promise<string> {
  const localized = await getLocalizedResponse(text, language, context);
  return optimizeSalesLanguage(localized);
}
