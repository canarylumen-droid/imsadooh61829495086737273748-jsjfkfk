import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import {
  getCustomObjections,
  saveCustomObjections,
  getCustomKnowledge,
  saveCustomKnowledge,
  CustomObjectionSchema,
  CustomKnowledgeSchema
} from '@shared/lib/storage/custom-training-storage.js';
import { z } from 'zod';
import { generateReply } from '@services/brain-worker/src/ai-lib/core/ai-service.js';
import { objectionService } from '@services/brain-worker/src/ai-lib/analyzers/objection-service.js';

const router = Router();

// GET /api/custom-training/objections
router.get('/objections', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const objections = await getCustomObjections(userId);
    res.json(objections);
  } catch (err) {
    console.error('[CustomTrainingRoutes] Failed to fetch custom objections:', err);
    res.status(500).json({ error: 'Failed to fetch custom objections' });
  }
});

// POST /api/custom-training/objections
router.post('/objections', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = Array.isArray(req.body) ? req.body : req.body?.objections;
    const parsed = z.array(CustomObjectionSchema).parse(body);
    
    // Save and verify the save worked
    await saveCustomObjections(userId, parsed);
    
    // Verify by reading back
    const verified = await getCustomObjections(userId);
    if (verified.length !== parsed.length) {
      console.error('[CustomTrainingRoutes] Save verification failed - expected', parsed.length, 'got', verified.length);
      res.status(500).json({ error: 'Failed to verify saved objections. Storage may be unavailable.' });
      return;
    }

    res.json({ success: true, message: 'Custom objections saved successfully', objections: parsed });
  } catch (err) {
    console.error('[CustomTrainingRoutes] Failed to save custom objections:', err);
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid custom objections format', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to save custom objections' });
    }
  }
});

// GET /api/custom-training/knowledge
router.get('/knowledge', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const knowledge = await getCustomKnowledge(userId);
    res.json(knowledge);
  } catch (err) {
    console.error('[CustomTrainingRoutes] Failed to fetch custom knowledge:', err);
    res.status(500).json({ error: 'Failed to fetch custom knowledge' });
  }
});

// POST /api/custom-training/knowledge
router.post('/knowledge', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Validate the incoming body against CustomKnowledgeSchema
    const parsed = CustomKnowledgeSchema.parse(req.body);
    await saveCustomKnowledge(userId, parsed);

    // Verify by reading back
    const verified = await getCustomKnowledge(userId);
    if (JSON.stringify(verified) !== JSON.stringify(parsed)) {
      console.error('[CustomTrainingRoutes] Knowledge save verification failed');
      res.status(500).json({ error: 'Failed to verify saved knowledge. Storage may be unavailable.' });
      return;
    }

    res.json({ success: true, message: 'Custom knowledge base saved successfully', knowledge: parsed });
  } catch (err) {
    console.error('[CustomTrainingRoutes] Failed to save custom knowledge:', err);
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid custom knowledge format', details: err.errors });
    } else {
      res.status(500).json({ error: 'Failed to save custom knowledge' });
    }
  }
});

// POST /api/custom-training/simulate
router.post('/simulate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message field is required' });
      return;
    }

    // 1. Fetch custom objections and custom knowledge base in parallel
    const [objections, knowledge] = await Promise.all([
      getCustomObjections(userId),
      getCustomKnowledge(userId)
    ]);

    // 2. Objection Matching (simple matching for debug info)
    const matchedRules = objections.filter(rule => 
      message.toLowerCase().includes(rule.objection.toLowerCase()) ||
      rule.objection.toLowerCase().includes(message.toLowerCase())
    );

    // 3. Format prompt context
    const customObjectionsContext = await objectionService.formatCustomObjectionsForPrompt(userId);
    
    let customKnowledgeContext = '';
    if (knowledge && (knowledge.businessName || knowledge.brandVoice || knowledge.coreOffer || knowledge.customInstructions || (knowledge.faqs && knowledge.faqs.length > 0))) {
      customKnowledgeContext = `
### CUSTOM USER TRAINING KNOWLEDGE BASE (High Priority)
Business Name: ${knowledge.businessName || "N/A"}
Brand Voice / Tone: ${knowledge.brandVoice || "N/A"}
Core Offer Details: ${knowledge.coreOffer || "N/A"}
Custom Instructions: ${knowledge.customInstructions || "N/A"}
${knowledge.faqs && knowledge.faqs.length > 0 ? `Frequently Asked Questions:\n${knowledge.faqs.map((f: any) => `- Q: "${f.question}"\n  A: "${f.answer}"`).join('\n')}` : ''}
`;
    }

    const systemPrompt = `
You are Audnix AI, a sales assistant agent. Your goal is to reply to the prospect message.
You must carefully apply the following custom training data and objection handling instructions provided by the user.

${customKnowledgeContext}

${customObjectionsContext}

Always prioritize the custom training guidelines, tone of voice, core offers, and objection handling instructions above.
`;

    // 4. Generate reply using the unified generateReply
    const result = await generateReply(systemPrompt, `Prospect message: "${message}"`);

    res.json({
      reply: result.text,
      debug: {
        matchedObjections: matchedRules.map(r => r.objection),
        customKnowledgeApplied: !!customKnowledgeContext,
        systemPrompt: systemPrompt
      }
    });

  } catch (err) {
    console.error('[CustomTrainingRoutes] Simulation failed:', err);
    res.status(500).json({ error: 'Failed to simulate response' });
  }
});

export default router;
