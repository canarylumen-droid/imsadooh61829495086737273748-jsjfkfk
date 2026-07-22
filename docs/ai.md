# AI & Intelligence

## Overview

The AI system provides intelligent features across the platform: reply generation, lead scoring, insights, enrichment, and autonomous decision-making. It uses multiple AI providers with fallback chains.

## AI Providers

| Provider | Purpose | Model | Timeout |
|---|---|---|---|
| Gemini | Primary AI (features, reply, enrichment) | gemini-2.0-flash | 30s |
| OpenAI | Fallback AI | gpt-4o-mini | 30s |
| Local | Lightweight tasks (caching, health checks) | N/A | 5s |

### Provider Selection
```typescript
async function callAI(prompt: string, options: AIConfig): Promise<AIResponse> {
  // Try Gemini first
  try {
    return await callGemini(prompt, options);
  } catch (geminiError) {
    console.warn('Gemini failed, falling back to OpenAI:', geminiError.message);
  }
  
  // Fallback to OpenAI
  try {
    return await callOpenAI(prompt, options);
  } catch (openAIError) {
    console.error('Both AI providers failed:', openAIError.message);
    throw new AIError('AI service unavailable');
  }
}
```

## Features

### 1. AI Reply Generation
- Context: full conversation thread + lead profile
- Prompt includes: brand voice guidelines, tone preference, response length
- Output: reply text (subject + body)
- Lead name included in reasoning output
- Used by: inbox compose area, recovery draft generation

### 2. AI Lead Enrichment
- Triggered on lead import (BullMQ `timezone-enrichment` job)
- Analyzes: email domain, company name, job title if available
- Outputs: timezone, geolocation, company size estimate
- Stored in `leads.metadata`

### 3. Lead Scoring
- Base score: calculated from engagement metrics
- AI-assisted adjustments for: sentiment, intent signals
- Score updated on every message interaction
- Decision engine uses score for follow-up timing

### 4. Activity Reasoning
```typescript
// decision-engine.ts
interface DecisionContext {
  lead: Lead;
  conversation: Message[];
  score: number;
  timing: number;
  intent: number;
}

interface Decision {
  action: 'follow_up' | 'wait' | 'escalate' | 'close';
  reasoning: string;  // Includes lead name
  confidence: number;
}
```

### 5. AI Insights
- Trends: lead growth, conversion growth over time
- Predictions: expected conversions, engagement forecasts
- Recommendations: actionable suggestions for improvement
- Top performers: best-performing mailboxes, campaigns
- Summary: natural language overview of account health

### 6. Knowledge Base (Brand Knowledge)
- PDF ingestion via `/api/admin/upload-brand-pdf`
- AI extracts brand voice, product info, tone guidelines
- Used in reply generation for consistent brand voice
- "Clear All" + per-PDF delete capabilities
- Real-time socket updates on change

### 7. Calendly Integration (AI Scheduling)
- AI suggests optimal meeting times based on lead engagement
- Creates Calendly scheduling links in emails
- Tracks meeting outcomes (showed, no-show, rescheduled)

## AI Response Status Management

### Status Overwrite Protection (Jul 19 fix)
```typescript
const ACTIVE_STATUSES = ['contacted', 'replied', 'warm', 'booked', 'converted'];
const aiStatus = await callAIForStatus(conversation);
if (ACTIVE_STATUSES.includes(currentStatus)) {
  // Don't downgrade active leads
  return;  // preserve existing status
}
// Only set 'new' if lead was truly 'new'
```

## Brand Knowledge Base

### Upload Flow
1. Admin uploads PDF via `/api/admin/upload-brand-pdf`
2. PDF text extracted and chunked
3. AI processes chunks for: brand voice, product features, tone, target audience
4. Stored in vector DB for retrieval
5. Used in AI reply prompt augmentation

### API
```
POST /api/admin/upload-brand-pdf  → Upload PDF
DELETE /api/admin/upload-brand-pdf → Clear all
DELETE /api/brand-pdf/cache/:id    → Delete specific PDF
```

## Rate Limiting & Cost Management

- Token usage tracked per user per day
- Daily AI budget: configurable (default $5/day)
- Fallback to simpler models when budget exceeded
- Cache common AI responses (template generation)

## Socket Events

| Event | Trigger | Effect |
|---|---|---|
| `insights_updated` | AI worker completes analysis | Refreshes AI insights page |
| `settings_updated` | Brand KB changes | Refreshes KB modal |
