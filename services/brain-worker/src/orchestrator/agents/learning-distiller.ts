import { generateReply } from '../../ai-lib/core/ai-service.js';
import { MODELS } from '../../ai-lib/utils/model-config.js';

export interface DistillationResult {
  type: 'success' | 'failure' | 'neutral';
  strength: number; // 0-10
  insight: string;
  patternKey: string;
  suggestedAction?: string;
}

/**
 * LearningDistiller Agent
 * Autonomously converts raw conversation data and status changes into 
 * actionable intelligence patterns.
 */
export class LearningDistiller {
  async distillEpisode(
    transcript: string, 
    oldStatus: string, 
    newStatus: string, 
    context: string
  ): Promise<DistillationResult> {
    const prompt = `You are the Audnix Learning Distiller. Your job is to analyze a transition in a sales conversation and extract the "Lesson Learned" to update our autonomous outreach engine.

[CONVERSATION TRANSCRIPT]
${transcript}

[TRANSITION]
From Status: ${oldStatus}
To Status: ${newStatus}
Action Taken: ${context}

[TASK]
Analyze why this transition happened. 
1. Was the outreach effective? (Success/Failure/Neutral)
2. What is the core lesson? (e.g., "Lead responded well to the case study", "Lead felt pressured by the booking link")
3. How strong is this lesson? (0-10)
4. What is the pattern key for this? (Format: action:category - e.g., "outreach:aggressive", "followup:value-add")

Return ONLY a JSON object:
{
  "type": "success" | "failure" | "neutral",
  "strength": number,
  "insight": "1-sentence markdown insight",
  "patternKey": "action:category",
  "suggestedAction": "optional next step"
}`;

    try {
      const response = await generateReply(
        "You are the Audnix Learning Distiller. Extract 'Lessons Learned' as JSON.",
        prompt,
        {
          temperature: 0.2,
          model: MODELS.sales_reasoning, // Fallback to sales_reasoning if intelligence is missing
          nga1Enforced: true
        }
      );

      // Clean the response in case of markdown blocks
      const cleanJson = (response.text || '').replace(/```json|```/g, '').trim();
      return JSON.parse(cleanJson) as DistillationResult;
    } catch (err) {
      console.error('[LearningDistiller] Failed to distill episode:', err);
      // Fallback to neutral result
      return {
        type: newStatus === 'converted' || newStatus === 'booked' ? 'success' : (newStatus === 'not_interested' ? 'failure' : 'neutral'),
        strength: 1,
        insight: `Status changed from ${oldStatus} to ${newStatus}`,
        patternKey: 'system:status_change'
      };
    }
  }
}

export const learningDistiller = new LearningDistiller();
