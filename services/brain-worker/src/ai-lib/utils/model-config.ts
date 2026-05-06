/**
 * Centralized AI Model Configuration
 * Ensures consistency across the entire application
 */

// GenAI Models - Use -latest or -002 for better compatibility with v1beta
export const GENAI_STABLE_MODEL = "gemini-1.5-flash-latest";

// OpenAI Models
export const OPENAI_INTELLIGENCE_MODEL = "gpt-4o";     // Flagship for complex sales reasoning
export const OPENAI_FAST_MODEL = "gpt-4o-mini";        // Fast/Cheap for simple classification/tasks

// Z-AI (GLM) Models — use glm-4-plus or glm-4 for better availability
export const Z_AI_STABLE_MODEL = "glm-4-plus";        // Standard GLM-4 Plus
export const Z_AI_FAST_MODEL = "glm-4-flash";         // Flash version

// Failover Priority: OpenAI -> GLM -> Gemini
export const LLM_FAILOVER_ORDER: Array<'openai' | 'zai' | 'genai'> = ['openai', 'zai', 'genai'];

// Default active models based on service
export const MODELS = {
    sales_reasoning: process.env.OPENAI_API_KEY ? OPENAI_INTELLIGENCE_MODEL : (process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : GENAI_STABLE_MODEL),
    intent_classification: process.env.OPENAI_API_KEY ? OPENAI_FAST_MODEL : (process.env.ZAI_API_KEY ? Z_AI_FAST_MODEL : GENAI_STABLE_MODEL),
    content_generation: GENAI_STABLE_MODEL, // Always use flash for content to save cost
    lead_intelligence: OPENAI_FAST_MODEL,
    voice_assistant: OPENAI_FAST_MODEL,
    objection_handling: OPENAI_FAST_MODEL,
    grammar_check: Z_AI_FAST_MODEL,
    outreach_generation: GENAI_STABLE_MODEL,
    intelligence_synthesis: OPENAI_FAST_MODEL,
};
