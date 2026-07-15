import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey } from '../middleware/auth.js';
import { db } from '@shared/lib/db/db.js';
import { automationRules, contentLibrary, aiActionLogs } from '@audnix/shared';
import { eq, and, desc } from 'drizzle-orm';

const router = Router();

function getCurrentUserId(req: Request): string | null {
  return req.session?.userId || null;
}

// ========== AUTOMATION RULES ==========

router.get('/rules', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    
    const rules = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.userId, userId))
      .orderBy(desc(automationRules.createdAt));
    
    const formattedRules = rules.map((r: any) => ({
      id: r.id,
      name: r.name,
      ruleType: r.ruleType || 'follow_up',
      channel: r.channel,
      isActive: r.isActive,
      minIntentScore: r.minIntentScore,
      minConfidence: Math.round((r.minConfidence || 0.6) * 100),
      cooldownMinutes: r.cooldownMinutes,
      allowedActions: r.allowedActions,
      createdAt: r.createdAt,
    }));
    
    res.json(formattedRules);
  } catch (error: any) {
    console.error('Error fetching automation rules:', error.message);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

router.post('/rules', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { 
      name,
      ruleType,
      channel, 
      minIntentScore, 
      maxIntentScore, 
      minConfidence,
      allowedActions,
      cooldownMinutes,
      maxActionsPerDay,
      escalateOnLowConfidence,
      requireHumanApproval
    } = req.body;
    
    if (!name || !channel) {
      res.status(400).json({ error: 'Name and channel required' });
      return;
    }
    
    const confidenceValue = minConfidence && minConfidence > 1 
      ? minConfidence / 100 
      : minConfidence ?? 0.6;
    
    const [rule] = await db
      .insert(automationRules)
      .values({
        userId,
        name,
        ruleType: ruleType || 'follow_up',
        channel,
        minIntentScore: minIntentScore ?? 50,
        maxIntentScore: maxIntentScore ?? 100,
        minConfidence: confidenceValue,
        allowedActions: allowedActions ?? ['reply'],
        cooldownMinutes: cooldownMinutes ?? 60,
        maxActionsPerDay: maxActionsPerDay ?? 10,
        escalateOnLowConfidence: escalateOnLowConfidence ?? true,
        requireHumanApproval: requireHumanApproval ?? false,
      })
      .returning();
    
    res.json({
      id: rule.id,
      name: rule.name,
      ruleType: rule.ruleType,
      channel: rule.channel,
      isActive: rule.isActive,
      minIntentScore: rule.minIntentScore,
      minConfidence: Math.round((rule.minConfidence || 0.6) * 100),
      cooldownMinutes: rule.cooldownMinutes,
      allowedActions: rule.allowedActions,
      createdAt: rule.createdAt,
    });
  } catch (error: any) {
    console.error('Error creating automation rule:', error.message);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

router.put('/rules/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { id } = req.params;
    const updates = req.body;
    
    const [rule] = await db
      .update(automationRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(automationRules.id, id as string), eq(automationRules.userId, userId)))
      .returning();
    
    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    
    res.json({ rule });
  } catch (error: any) {
    console.error('Error updating automation rule:', error.message);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

router.delete('/rules/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { id } = req.params;
    
    await db
      .delete(automationRules)
      .where(and(eq(automationRules.id, id as string), eq(automationRules.userId, userId)));
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting automation rule:', error.message);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// ========== CONTENT LIBRARY ==========

router.get('/content', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { type } = req.query;
    
    let query = db
      .select()
      .from(contentLibrary)
      .where(eq(contentLibrary.userId, userId))
      .orderBy(desc(contentLibrary.createdAt));
    
    const content = await query;
    
    const filtered = type 
      ? content.filter((c: any) => c.type === type)
      : content;
    
    const formattedContent = filtered.map((c: any) => ({
      id: c.id,
      contentType: c.type,
      name: c.name,
      content: c.content,
      intentTags: c.intentTags,
      channel: c.channelRestriction || 'all',
      isActive: c.isActive,
      usageCount: c.usageCount,
      createdAt: c.createdAt,
    }));
    
    res.json(formattedContent);
  } catch (error: any) {
    console.error('Error fetching content library:', error.message);
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

router.post('/content', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { 
      contentType,
      type, 
      name, 
      content,
      channel,
      intentTags,
      objectionTags,
      channelRestriction,
      linkedVideoId,
      linkedCtaLink
    } = req.body;
    
    const actualType = contentType || type;
    if (!actualType || !name || !content) {
      res.status(400).json({ error: 'Type, name, and content required' });
      return;
    }
    
    const [item] = await db
      .insert(contentLibrary)
      .values({
        userId,
        type: actualType,
        name,
        content,
        intentTags: intentTags ?? [],
        objectionTags: objectionTags ?? [],
        channelRestriction: channel || channelRestriction || 'all',
        linkedVideoId,
        linkedCtaLink,
      })
      .returning();
    
    res.json({
      id: item.id,
      contentType: item.type,
      name: item.name,
      content: item.content,
      intentTags: item.intentTags,
      channel: item.channelRestriction,
      isActive: item.isActive,
      usageCount: item.usageCount,
      createdAt: item.createdAt,
    });
  } catch (error: any) {
    console.error('Error creating content:', error.message);
    res.status(500).json({ error: 'Failed to create content' });
  }
});

router.put('/content/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { id } = req.params;
    const updates = req.body;
    
    const [item] = await db
      .update(contentLibrary)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(contentLibrary.id, id as string), eq(contentLibrary.userId, userId)))
      .returning();
    
    if (!item) {
      res.status(404).json({ error: 'Content not found' });
      return;
    }
    
    res.json({ item });
  } catch (error: any) {
    console.error('Error updating content:', error.message);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

router.delete('/content/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { id } = req.params;
    
    await db
      .delete(contentLibrary)
      .where(and(eq(contentLibrary.id, id as string), eq(contentLibrary.userId, userId)));
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting content:', error.message);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// ========== AI DECISIONS ==========

router.get('/decisions', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const decisions = await db
      .select()
      .from(aiActionLogs)
      .where(eq(aiActionLogs.userId, userId))
      .orderBy(desc(aiActionLogs.createdAt))
      .limit(limit);
    
    const formattedDecisions = decisions.map((d: any) => ({
      id: d.id,
      actionType: d.actionType,
      decision: d.decision,
      intentScore: d.intentScore,
      timingScore: d.timingScore,
      confidence: d.confidence,
      reasoning: d.reasoning,
      leadId: d.leadId,
      createdAt: d.createdAt,
    }));
    
    res.json(formattedDecisions);
  } catch (error: any) {
    console.error('Error fetching AI decisions:', error.message);
    res.status(500).json({ error: 'Failed to fetch decisions' });
  }
});

export default router;
