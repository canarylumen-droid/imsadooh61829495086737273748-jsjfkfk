/**
 * Centralized AI Model Configuration
 * Ensures consistency across the entire application
 */

// GenAI Models - Use 2.0 Flash for latest capabilities
export const GENAI_STABLE_MODEL = "gemini-2.0-flash";

// OpenAI Models
export const OPENAI_INTELLIGENCE_MODEL = "gpt-4o";     // Flagship for complex sales reasoning
export const OPENAI_FAST_MODEL = "gpt-4o-mini";        // Fast/Cheap for simple classification/tasks

// Z-AI (GLM) Models
export const Z_AI_STABLE_MODEL = "glm-4-0520";       // Use versioned GLM-4 for stability
export const Z_AI_LATEST_MODEL = "glm-4-0520";        // Stable GLM-4-0520 (User's 4.6 equivalent)
export const Z_AI_FAST_MODEL = "glm-4-flash";         // Ultra-fast GLM-4-Flash

// Default active models based on service
export const MODELS = {
    sales_reasoning: process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : OPENAI_INTELLIGENCE_MODEL,
    intent_classification: process.env.ZAI_API_KEY ? Z_AI_FAST_MODEL : OPENAI_FAST_MODEL,
    content_generation: process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : GENAI_STABLE_MODEL,
    lead_intelligence: process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : OPENAI_INTELLIGENCE_MODEL,
    voice_assistant: OPENAI_FAST_MODEL,
    objection_handling: process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : OPENAI_INTELLIGENCE_MODEL,
    grammar_check: Z_AI_FAST_MODEL,
    outreach_generation: process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : GENAI_STABLE_MODEL,
    intelligence_synthesis: process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : OPENAI_INTELLIGENCE_MODEL,
};
