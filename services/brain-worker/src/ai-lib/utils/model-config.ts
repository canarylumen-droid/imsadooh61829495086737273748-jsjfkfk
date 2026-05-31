/**
 * Centralized AI Model Configuration
 * Ensures consistency across the entire application
 */

// GenAI Models - Use stable name for maximum compatibility with v1/v1beta
export const GENAI_STABLE_MODEL = "gemini-1.5-flash";

// OpenAI Models
export const OPENAI_INTELLIGENCE_MODEL = "gpt-4o";     // Flagship for complex sales reasoning
export const OPENAI_FAST_MODEL = "gpt-4o-mini";        // Fast/Cheap for simple classification/tasks

// Z-AI (GLM) Models — use glm-4-flash to avoid legacy glm-4 400 errors
export const Z_AI_STABLE_MODEL = "glm-4-flash";             // Standard GLM-4 (mapped to flash)
export const Z_AI_FAST_MODEL = "glm-4-flash";               // Flash version

// DeepSeek Models (OpenAI-compatible via api.deepseek.com)
// Note: deepseek-chat/deepseek-reasoner are deprecated aliases (removal: 2026/07/24)
export const DEEPSEEK_CHAT_MODEL = "deepseek-v4-flash";     // Most cost-effective (chat + reasoning)
export const DEEPSEEK_REASON_MODEL = "deepseek-v4-pro";     // Premium reasoning tasks

// Failover Priority: DeepSeek -> Gemini -> ZAI (GLM) -> OpenAI
// DeepSeek = primary (cost-effective), Gemini = speed fallback,
// ZAI = GLM fallback (subscription exhausted), OpenAI = last resort (most expensive)
export const LLM_FAILOVER_ORDER: Array<'deepseek' | 'genai' | 'zai' | 'openai'> = ['deepseek', 'genai', 'zai', 'openai'];

// Default active models based on service
// Priority: DeepSeek -> Gemini -> ZAI (GLM) -> OpenAI
export const MODELS = {
    sales_reasoning: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : (process.env.GEMINI_API_KEY ? GENAI_STABLE_MODEL : (process.env.ZAI_API_KEY ? Z_AI_STABLE_MODEL : OPENAI_INTELLIGENCE_MODEL)),
    intent_classification: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : (process.env.GEMINI_API_KEY ? GENAI_STABLE_MODEL : (process.env.ZAI_API_KEY ? Z_AI_FAST_MODEL : OPENAI_FAST_MODEL)),
    content_generation: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : GENAI_STABLE_MODEL,
    lead_intelligence: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : (process.env.GEMINI_API_KEY ? GENAI_STABLE_MODEL : OPENAI_FAST_MODEL),
    voice_assistant: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : (process.env.GEMINI_API_KEY ? GENAI_STABLE_MODEL : OPENAI_FAST_MODEL),
    objection_handling: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : (process.env.GEMINI_API_KEY ? GENAI_STABLE_MODEL : OPENAI_FAST_MODEL),
    grammar_check: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : (process.env.ZAI_API_KEY ? Z_AI_FAST_MODEL : OPENAI_FAST_MODEL),
    outreach_generation: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : GENAI_STABLE_MODEL,
    intelligence_synthesis: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_CHAT_MODEL : (process.env.GEMINI_API_KEY ? GENAI_STABLE_MODEL : OPENAI_FAST_MODEL),
};
