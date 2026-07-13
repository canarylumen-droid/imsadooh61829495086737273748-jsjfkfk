/**
 * Safely extracts JSON from an LLM response string.
 * LLMs often wrap JSON in markdown blocks like ```json ... ```.
 * This utility strips those blocks to ensure JSON.parse doesn't crash with SyntaxError.
 */
export function extractJson<T = any>(text: string): T {
  if (!text || typeof text !== 'string') {
    throw new Error('Input text must be a string');
  }

  let cleanedText = text.trim();

  // Strip markdown JSON wrapping
  if (cleanedText.startsWith('```json')) {
    cleanedText = cleanedText.substring(7);
  } else if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.substring(3);
  }

  if (cleanedText.endsWith('```')) {
    cleanedText = cleanedText.substring(0, cleanedText.length - 3);
  }

  cleanedText = cleanedText.trim();

  try {
    return JSON.parse(cleanedText) as T;
  } catch (error) {
    console.error('Failed to parse JSON string:', cleanedText.substring(0, 500) + '...');
    throw new Error(`Invalid JSON returned from AI: ${(error as Error).message}`);
  }
}
