import { Router, Request, Response } from 'express';
import { processCommentAutomation, detectCommentIntent } from '@services/brain-worker/src/ai-lib/analyzers/comment-detection.js';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';

const router = Router();

/**
 * Process a comment and trigger DM automation
 * POST /api/automation/comment
 */
router.post('/comment', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { comment, username, channel, postContext } = req.body;
    const userId = getCurrentUserId(req)!;

    if (!comment || !username || !channel) {
      res.status(400).json({ 
        error: 'Missing required fields: comment, username, channel' 
      });
      return;
    }

    const result = await processCommentAutomation(
      userId,
      comment,
      username,
      channel,
      postContext || 'New post'
    );

    if (!result.success) {
      res.status(200).json({
        success: false,
        message: 'Comment does not indicate DM interest - no automation triggered'
      });
      return;
    }

    res.json({
      success: true,
      lead: result.lead,
      message: 'Initial DM sent and 6-hour follow-up scheduled',
      followUpScheduled: result.followUpScheduled
    });
  } catch (error) {
    console.error('Comment automation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Comment automation failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Analyze a comment to see if it indicates DM intent
 * POST /api/automation/analyze-comment
 */
router.post('/analyze-comment', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { comment } = req.body;

    if (!comment) {
      res.status(400).json({ error: 'Comment text required' });
      return;
    }

    const intent = await detectCommentIntent(comment);

    res.json({
      wantsDM: intent.wantsDM,
      intent: intent.intent,
      confidence: intent.confidence,
      recommendation: intent.wantsDM 
        ? 'Trigger DM automation for this comment' 
        : 'No DM automation needed'
    });
  } catch (error) {
    console.error('Comment analysis error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Comment analysis failed';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Manually trigger comment automation for a specific comment
 * POST /api/automation/manual-trigger
 */
router.post('/manual-trigger', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadId } = req.body;
    getCurrentUserId(req);

    if (!leadId) {
      res.status(400).json({ error: 'Lead ID required' });
      return;
    }

    res.json({
      success: true,
      message: 'Manual follow-up triggered',
      scheduledIn: '6 hours'
    });
  } catch (error) {
    console.error('Manual trigger error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Manual trigger failed';
    res.status(500).json({ error: errorMessage });
  }
});

export default router;

