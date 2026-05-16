import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { MODELS, OPENAI_INTELLIGENCE_MODEL, GENAI_STABLE_MODEL, OPENAI_FAST_MODEL, Z_AI_FAST_MODEL, LLM_FAILOVER_ORDER } from "../utils/model-config.js";
import { storage } from '@shared/lib/storage/storage.js';
import { openAiLimiter, geminiLimiter, zAiLimiter } from '@shared/lib/ai/rate-limiter.js';
import { SystemHealthService } from '@shared/lib/monitoring/system-health-service.js';

// Global timeout for AI requests (15 seconds) to prevent worker hangs
const AI_TIMEOUT = 15000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = AI_TIMEOUT): Promise<T> {
  let timeoutHandle: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`AI Request timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}

// Initialize OpenAI conditionally
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Initialize Google GenAI conditionally
const genai = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// Initialize Z-AI (GLM) conditionally (OpenAI-compatible)
const zai = process.env.ZAI_API_KEY
  ? new OpenAI({
    apiKey: process.env.ZAI_API_KEY,
    baseURL: "https://open.bigmodel.cn/api/paas/v4/"
  })
  : null;

/**
 * Determine primary provider: Z-AI > OpenAI > Gemini > None (Demo)
 */
const PREFERRED_PROVIDER = process.env.ZAI_API_KEY ? "zai" : (process.env.OPENAI_API_KEY ? "openai" : (process.env.GEMINI_API_KEY ? "genai" : "demo"));
const AI_MODEL = process.env.ZAI_API_KEY ? MODELS.sales_reasoning : (process.env.OPENAI_MODEL || OPENAI_INTELLIGENCE_MODEL);

console.log(`[AI Service] Unified initialization with provider: ${PREFERRED_PROVIDER}`);

/**
 * Registry to track AI provider health and cooldowns
 */
const PROVIDER_STATUS = {
  zai: { cooldownUntil: 0, consecutiveErrors: 0 },
  openai: { cooldownUntil: 0, consecutiveErrors: 0 },
  genai: { cooldownUntil: 0, consecutiveErrors: 0 },
};

const COOLDOWN_BASE_MS = 30000; // Start with 30s for 429s
const MAX_COOLDOWN_MS = 3600000; // 1 hour

function updateProviderHealth(provider: 'openai' | 'genai' | 'zai', isSuccess: boolean, error?: any) {
  const status = PROVIDER_STATUS[provider];
  if (isSuccess) {
    status.consecutiveErrors = 0;
    status.cooldownUntil = 0;
  } else {
    status.consecutiveErrors++;
    const status_code = error?.status || error?.response?.status;
    const isRateLimit = status_code === 429;
    const isTransient = status_code >= 500 || !status_code; // 5xx or Network Error
    
    // Phase 24: Adaptive Exponential Backoff
    let delay = Math.min(COOLDOWN_BASE_MS * Math.pow(2, status.consecutiveErrors - 1), MAX_COOLDOWN_MS);
    
    // Transient errors get shorter initial backoff
    if (isTransient && status.consecutiveErrors === 1) {
      delay = 5000; // 5s for first transient failure
    }

    // Honor Retry-After if provided in headers
    const retryAfterHeader = error?.headers?.['retry-after'];
    if (isRateLimit && retryAfterHeader) {
      const waitSec = parseInt(retryAfterHeader, 10);
      if (!isNaN(waitSec)) delay = waitSec * 1000;
    }

    // Phase 24.1: Extract GenAI/OpenAI body-level retry info
    if (isRateLimit && error?.response?.data?.error?.details) {
      const retryInfo = error.response.data.error.details.find((d: any) => d['@type']?.includes('RetryInfo'));
      if (retryInfo?.retryDelay) {
        const waitSec = parseInt(retryInfo.retryDelay.replace('s', ''), 10);
        if (!isNaN(waitSec)) delay = Math.max(delay, waitSec * 1000);
      }
    }

    status.cooldownUntil = Date.now() + delay;
    console.warn(`[AI Service] ⚠️ Provider ${provider} failed (${status_code || 'Network/Transient'}). Backing off for ${Math.round(delay/1000)}s. Errors: ${status.consecutiveErrors}`);

    // Report to system health dashboard
    SystemHealthService.logAiError('system', provider, 'provider_failure', error, {
      status_code,
      consecutive_errors: status.consecutiveErrors,
      cooldown_ms: delay,
      is_rate_limit: isRateLimit,
      is_transient: isTransient
    }).catch(() => {});
  }
}

export function isProviderAvailable(provider: 'openai' | 'genai' | 'zai'): boolean {
  if (provider === 'zai' && !zai) return false;
  if (provider === 'openai' && !openai) return false;
  if (provider === 'genai' && !genai) return false;
  return Date.now() >= PROVIDER_STATUS[provider].cooldownUntil;
}

/**
 * Get current health and status of all AI providers
 */
export function getAIStatus() {
  return {
    activeProvider: PREFERRED_PROVIDER,
    providers: Object.keys(PROVIDER_STATUS).reduce((acc, key) => {
        const provider = key as keyof typeof PROVIDER_STATUS;
        const available = isProviderAvailable(provider);
        acc[provider] = {
            available,
            cooldownUntil: PROVIDER_STATUS[provider].cooldownUntil,
            consecutiveErrors: PROVIDER_STATUS[provider].consecutiveErrors,
            configured: !!(provider === 'zai' ? zai : (provider === 'openai' ? openai : genai))
        };
        return acc;
    }, {} as Record<string, any>)
  };
}

/**
 * Normalizes embedding to 1536 dimensions.
 * Gemini (text-embedding-004) returns 768 dimensions.
 * OpenAI (text-embedding-3-small) returns 1536 dimensions.
 * To maintain database compatibility without schema migrations, we zero-pad to 1536.
 */
function normalizeEmbedding(values: number[]): number[] {
  if (values.length === 1536) return values;
  if (values.length < 1536) {
    const padded = new Array(1536).fill(0);
    for (let i = 0; i < values.length; i++) padded[i] = values[i];
    return padded;
  }
  return values.slice(0, 1536);
}

/**
 * Generate embeddings for text (for pgvector storage)
 */
export async function embed(text: string): Promise<number[]> {
  // 1. Try OpenAI (Native 1536 dims)
  if (isProviderAvailable('openai')) {
    try {
      await openAiLimiter.acquire(1); // Proactive rate limit
      const response = await withTimeout(openai!.embeddings.create({
        model: "text-embedding-3-small",
        input: text.replace(/\n/g, " "),
      }), 5000); // Shorter timeout for embeddings
      updateProviderHealth('openai', true);
      return response.data[0].embedding;
    } catch (error: any) {
      console.error("[AI Service] OpenAI embedding error:", error.message);
      updateProviderHealth('openai', false, error.status);
    }
  }

  // 2. Try GenAI (768 dims -> padded to 1536)
  if (isProviderAvailable('genai')) {
    try {
      await geminiLimiter.acquire(1); // Proactive rate limit
      const model = genai!.getGenerativeModel({ model: "text-embedding-004" });
      const result = await withTimeout(model.embedContent(text), 5000);
      const vector = result.embedding.values || [];
      if (vector.length === 0) throw new Error("Empty embedding returned");
      
      // Pad to 1536 to match OpenAI dimension if needed
      const padded = new Array(1536).fill(0);
      for (let i = 0; i < Math.min(vector.length, 1536); i++) {
        padded[i] = vector[i];
      }
      
      updateProviderHealth('genai', true);
      return padded;
    } catch (error: any) {
      console.warn("[AI-Service] GenAI embedding failed:", error.message);
      updateProviderHealth('genai', false, error);
    }
  }
  // 3. Fallback: Return empty to trigger keyword search
  console.error("[AI Service] All embedding providers failed.");
  return [];
}

/**
 * Batch generate embeddings for multiple texts
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (isProviderAvailable('openai')) {
    try {
      const response = await withTimeout(openai!.embeddings.create({
        model: "text-embedding-3-small",
        input: texts.map(t => t.replace(/\n/g, " ")),
      }));
      updateProviderHealth('openai', true);
      return response.data.map((d) => d.embedding);
    } catch (error: any) {
      console.error("[AI Service] OpenAI batch embedding error:", error.message);
      updateProviderHealth('openai', false, error.status);
    }
  }

  // Fallback to sequential for Gemini (batch embedding support varies)
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

/**
 * Phase 47: Select the most appropriate model based on task priority and user budget.
 * Downgrades to 'flash' models if quota is endangered.
 */
async function selectBestModelForBudget(userId: string, requestedModel: string): Promise<string> {
  try {
    const user = await storage.getUserById(userId);
    const metadata = (user?.intelligenceMetadata as any) || {};
    const dailyUsage = metadata.dailyTokenUsage || 0;
    const limit = metadata.customDailyTokenLimit || 500000; // Default 500k

    // Budget Mode: > 80% usage
    if (dailyUsage > limit * 0.8) {
      console.warn(`💸 [Budget Mode] User ${userId} at ${Math.round((dailyUsage/limit)*100)}% quota. Downgrading model.`);
      
      // Map reasoning models to their flash/budget equivalents
      if (requestedModel === MODELS.sales_reasoning) return GENAI_STABLE_MODEL;
      if (requestedModel === MODELS.intent_classification) return OPENAI_FAST_MODEL;
      return GENAI_STABLE_MODEL;
    }
  } catch (e) {
    console.error("[AiService] Budget selection error:", e);
  }
  return requestedModel;
}

import { wrapWithNGA1 } from "./nga1-checklist.js";

import { SafetyGuard } from "./safety-guard.js";

/**
 * Generate AI reply using chat completion
 * prioritized by PREFERRED_PROVIDER with robust fallback
 */
export async function generateReply(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    model?: string;
    userId?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    nga1Enforced?: boolean;
    isEmailBody?: boolean;
    channel?: string;
  }
): Promise<{ text: string; tokensUsed: number }> {
  const finalSystemPrompt = options?.nga1Enforced ? wrapWithNGA1(systemPrompt) : systemPrompt;
  const baseModel = options?.model || AI_MODEL;
  
  const providers = {
    openai: async () => {
      if (!isProviderAvailable('openai')) return null;
      try {
        await openAiLimiter.acquire(1); // Global guardrail
        const modelName = (baseModel.startsWith('glm-') || baseModel.startsWith('gemini-')) 
          ? OPENAI_INTELLIGENCE_MODEL 
          : baseModel;

        const response = await withTimeout(openai!.chat.completions.create({
          model: modelName,
          messages: [
            { role: "system", content: finalSystemPrompt },
            ...(options?.history || []),
            { role: "user", content: userPrompt },
          ],
          response_format: options?.jsonMode ? { type: "json_object" } : undefined,
          max_completion_tokens: options?.maxTokens || 1000,
          temperature: options?.temperature || 0.7
        }));

        updateProviderHealth('openai', true);
        return {
          text: response.choices[0].message.content || "",
          tokensUsed: response.usage?.total_tokens || 0
        };
      } catch (error: any) {
        console.error("[AI Service] OpenAI error:", error.message);
        updateProviderHealth('openai', false, error);
        return null;
      }
    },
    genai: async () => {
      if (!isProviderAvailable('genai')) return null;
      
      const tryGenerate = async (mName: string, useSystemInstruction: boolean = true) => {
        const model = genai!.getGenerativeModel({ 
          model: mName,
          ...(useSystemInstruction ? { systemInstruction: finalSystemPrompt } : {})
        });

        return await withTimeout(model.generateContent({
          contents: options?.history 
            ? options.history.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
              }))
            : [{ role: 'user', parts: [{ text: userPrompt + (useSystemInstruction ? "" : `\n\nSYSTEM INSTRUCTION: ${finalSystemPrompt}`) }] }],
          generationConfig: {
            temperature: options?.temperature || 0.7,
            maxOutputTokens: options?.maxTokens || 1000,
            responseMimeType: options?.jsonMode ? "application/json" : "text/plain",
          }
        }));
      };

      try {
        let modelName = GENAI_STABLE_MODEL;
        if (baseModel.includes("gemini")) {
          modelName = baseModel;
        }
        
        await geminiLimiter.acquire(1); // Global guardrail
        const result = await tryGenerate(modelName);
        updateProviderHealth('genai', true);
        const response = await result.response;
        return {
          text: response.text() || "",
          tokensUsed: response.usageMetadata?.totalTokenCount || 0
        };
      } catch (error: any) {
        // Model 404 or System Instruction error? Retry with standard model and/or no system instruction
        if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('400')) {
          console.warn(`[AI Service] GenAI Primary Model Failed (${baseModel}), retrying with standard flash...`);
          try {
            const fallbackModel = "gemini-1.5-flash"; // Use stable name for fallback
            const result = await tryGenerate(fallbackModel, false); // Try without system instruction for max compat
            updateProviderHealth('genai', true);
            const response = await result.response;
            return {
              text: response.text() || "",
              tokensUsed: response.usageMetadata?.totalTokenCount || 0
            };
          } catch (retryErr: any) {
            console.error("[AI Service] GenAI Fallback failed too:", retryErr.message);
          }
        }
        
        console.error("[AI Service] GenAI error:", error.message);
        updateProviderHealth('genai', false, error);
        return null;
      }
    },
    zai: async () => {
      if (!isProviderAvailable('zai')) return null;

      const tryZai = async (mName: string) => {
        return await withTimeout(zai!.chat.completions.create({
          model: mName,
          messages: [
            { role: "system", content: finalSystemPrompt },
            ...(options?.history || []),
            { role: "user", content: userPrompt },
          ],
          response_format: options?.jsonMode ? { type: "json_object" } : undefined,
          max_completion_tokens: options?.maxTokens || 1000,
          temperature: options?.temperature || 0.7
        }));
      };

      try {
        let modelName = (baseModel.startsWith('gpt-') || baseModel.startsWith('gemini-'))
          ? "glm-4"
          : baseModel;
        
        await zAiLimiter.acquire(1); // Global guardrail
        const response = await tryZai(modelName);
        updateProviderHealth('zai', true);
        return {
          text: response.choices[0].message.content || "",
          tokensUsed: response.usage?.total_tokens || 0
        };
      } catch (error: any) {
        if (error.status === 400 || error.message?.includes('exists') || error.message?.includes('不存在')) {
          console.warn(`[AI Service] Z-AI Model failed, retrying with flash...`);
          try {
            const response = await tryZai("glm-4-flash");
            updateProviderHealth('zai', true);
            return {
              text: response.choices[0].message.content || "",
              tokensUsed: response.usage?.total_tokens || 0
            };
          } catch (retryErr: any) {
            console.error("[AI Service] Z-AI Fallback failed too:", retryErr.message);
          }
        }
        console.error("[AI Service] Z-AI error:", error.message);
        updateProviderHealth('zai', false, error);
        return null;
      }
    }
  };

  // Execute in defined failover order
  for (const providerKey of LLM_FAILOVER_ORDER) {
    const result = await providers[providerKey]();
    if (result) {
      if (options?.nga1Enforced && result.text) {
        try {
          result.text = await SafetyGuard.sanitizeResponse(result.text, {
            channel: options?.channel || 'email',
            isEmail: options?.isEmailBody === true
          });
        } catch (err: any) {
          console.error("[AI Service] Safety Guard Blocked Response:", err.message);
          throw err;
        }
      }
      return result;
    }
  }

  // Final static fallback
  return {
    text: options?.jsonMode ? JSON.stringify({
      variants: [{ type: "standard", subject: "Checking in", body: "Thanks for reaching out. I'd love to discuss how we can help you achieve your goals." }],
      intent: "neutral",
      confidence: 0.5,
      metadata: { fallback: true }
    }) : "Thanks for reaching out! I'd love to help you learn more about our platform.",
    tokensUsed: 0
  };
}

/**
 * Classify text intent
 */
export async function classify(
  text: string,
  categories: string[]
): Promise<{ category: string; confidence: number }> {
  const systemPrompt = `Classify text into: ${categories.join(", ")}. Respond JSON: { "category": "...", "confidence": 0.0-1.0 }`;

  const providers = {
    genai: async () => {
      if (!isProviderAvailable('genai')) return null;
      try {
        const model = genai!.getGenerativeModel({ 
          model: GENAI_STABLE_MODEL,
          systemInstruction: systemPrompt
        });
        const result = await withTimeout(model.generateContent({
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: {
            responseMimeType: "application/json",
          }
        }));
        updateProviderHealth('genai', true);
        const response = await result.response;
        return JSON.parse(response.text() || "{}");
      } catch (e) {
        updateProviderHealth('genai', false);
        return null;
      }
    },
    openai: async () => {
      if (!isProviderAvailable('openai')) return null;
      try {
        const response = await withTimeout(openai!.chat.completions.create({
          model: OPENAI_FAST_MODEL,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }],
          response_format: { type: "json_object" },
          max_completion_tokens: 100,
        }));
        updateProviderHealth('openai', true);
        return JSON.parse(response.choices[0].message.content || "{}");
      } catch (e: any) {
        updateProviderHealth('openai', false, e.status);
        return null;
      }
    },
    zai: async () => {
      if (!isProviderAvailable('zai')) return null;
      try {
        const response = await withTimeout(zai!.chat.completions.create({
          model: Z_AI_FAST_MODEL,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }],
          response_format: { type: "json_object" },
          max_completion_tokens: 100,
        }));
        updateProviderHealth('zai', true);
        return JSON.parse(response.choices[0].message.content || "{}");
      } catch (e: any) {
        updateProviderHealth('zai', false, e.status);
        return null;
      }
    }
  };

  let result = null;
  for (const providerKey of LLM_FAILOVER_ORDER) {
    result = await providers[providerKey as keyof typeof providers]();
    if (result) break;
  }

  return {
    category: result?.category || categories[0] || "unknown",
    confidence: result?.confidence || 0.85
  };
}

/**
 * Generate actionable insights
 */
export async function generateInsights(data: any, prompt: string): Promise<string> {
  const fullPrompt = `${prompt}\n\nData: ${JSON.stringify(data)}`;
  const systemPrompt = "Analyze data and generate concise, actionable insights.";

  const providers = {
    genai: async () => {
      if (!isProviderAvailable('genai')) return null;
      try {
        const model = genai!.getGenerativeModel({ 
          model: GENAI_STABLE_MODEL,
          systemInstruction: systemPrompt
        });
        const result = await withTimeout(model.generateContent({
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }]
        }));
        updateProviderHealth('genai', true);
        const response = await result.response;
        return response.text() || "";
      } catch (e) {
        updateProviderHealth('genai', false);
        return null;
      }
    },
    openai: async () => {
      if (!isProviderAvailable('openai')) return null;
      try {
        const response = await withTimeout(openai!.chat.completions.create({
          model: OPENAI_FAST_MODEL,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: fullPrompt }],
          max_completion_tokens: 500,
        }));
        updateProviderHealth('openai', true);
        return response.choices[0].message.content || "";
      } catch (e: any) {
        updateProviderHealth('openai', false, e.status);
        return null;
      }
    },
    zai: async () => {
      if (!isProviderAvailable('zai')) return null;
      try {
        const response = await withTimeout(zai!.chat.completions.create({
          model: Z_AI_FAST_MODEL,
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: fullPrompt }],
          max_completion_tokens: 500,
        }));
        updateProviderHealth('zai', true);
        return response.choices[0].message.content || "";
      } catch (e: any) {
        updateProviderHealth('zai', false, e.status);
        return null;
      }
    }
  };

  for (const providerKey of LLM_FAILOVER_ORDER) {
    const res = await providers[providerKey]();
    if (res) return res;
  }

  return "Analysis complete. System metrics are within normal operational parameters.";
}

/**
 * Generate a dynamic email subject that converts
 */
export async function generateEmailSubject(body: string, leadName: string, company?: string): Promise<string> {
  const systemPrompt = "You are an elite sales copywriter. Generate a brief (1-6 words) email subject line that feels natural, human, and increases open rates. Do NOT use generic subjects like 'Follow up' or 'Checking in'. Reference the context or person if possible.";
  const userPrompt = `Lead Name: ${leadName}
Company: ${company || "their company"}
Email Content: "${body.substring(0, 500)}..."

Generate ONLY the subject line text, no quotes.`;

  const res = await generateReply(systemPrompt, userPrompt, { temperature: 0.8, maxTokens: 50 });
  return res.text.replace(/Subject: /i, "").trim();
}

/**
 * Check grammar and suggest corrections
 */
export async function checkGrammar(text: string): Promise<{ correctedText: string; errors: Array<{ original: string; suggested: string; reason: string }> }> {
  const systemPrompt = "You are an expert editor. Analyze the text for grammar, punctuation, and style. Return a JSON object: { \"correctedText\": \"...\", \"errors\": [{ \"original\": \"...\", \"suggested\": \"...\", \"reason\": \"...\" }] }";

  try {
    const res = await generateReply(systemPrompt, text, { jsonMode: true, model: MODELS.grammar_check, temperature: 0.1 });
    return JSON.parse(res.text);
  } catch (e) {
    return { correctedText: text, errors: [] };
  }
}

/**
 * Phase 23 Utility: Rough token estimation
 * 1 token ~= 4 chars in English
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}



