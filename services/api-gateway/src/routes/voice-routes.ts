import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey } from '../middleware/auth.js';
import { voiceAI } from '@services/brain-worker/src/ai-lib/specialized/voice-ai-service.js';
import { uploadVoice } from '@shared/lib/storage/file-upload.js';
import type { User } from '@audnix/shared';
import type { PlanType } from '@shared/types.js';

const router = Router();

const planLimits: Record<PlanType, number> = {
  trial: 5,
  starter: 100,
  pro: 400,
  enterprise: 1000
};

/**
 * Upload voice samples and clone user's voice
 * POST /api/voice/clone
 */
router.post('/clone', requireAuthOrApiKey, uploadVoice.array('voice_samples', 3), async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as User;
    const userId = user.id;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No voice samples uploaded. Please upload 1-3 audio files.' });
      return;
    }

    const audioBuffers = files.map(file => file.buffer);

    const result = await voiceAI.cloneUserVoice(userId, audioBuffers);

    if (!result.success) {
      res.status(500).json({ error: result.error || 'Failed to clone voice' });
      return;
    }

    res.json({
      message: 'Voice cloned successfully! Your AI will now use your voice for voice notes.',
      voiceId: result.voiceId
    });
  } catch (error: unknown) {
    console.error('Voice clone upload error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload and clone voice';
    res.status(500).json({ error: message });
  }
});

/**
 * Generate and send voice note to a specific lead
 * POST /api/voice/send/:leadId
 */
router.post('/send/:leadId', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as User;
    const userId = user.id;
    const { leadId } = req.params;

    const result = await voiceAI.generateAndSendVoiceNote(userId, leadId as string);

    if (!result.success) {
      res.status(400).json({ error: result.error || 'Failed to send voice note' });
      return;
    }

    res.json({
      message: 'Voice note sent successfully!',
      audioUrl: result.audioUrl,
      secondsUsed: result.secondsUsed
    });
  } catch (error: unknown) {
    console.error('Voice send error:', error);
    const message = error instanceof Error ? error.message : 'Failed to send voice note';
    res.status(500).json({ error: message });
  }
});

/**
 * Batch send voice notes to all warm leads
 * POST /api/voice/send-to-warm-leads
 */
router.post('/send-to-warm-leads', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as User;
    const userId = user.id;

    const results = await voiceAI.sendVoiceNotesToWarmLeads(userId);

    res.json({
      message: `Processed ${results.processed} leads, sent ${results.sent} voice notes`,
      results
    });
  } catch (error: unknown) {
    console.error('Batch voice send error:', error);
    const message = error instanceof Error ? error.message : 'Failed to send voice notes';
    res.status(500).json({ error: message });
  }
});

/**
 * Check voice usage and limits (in minutes)
 * GET /api/voice/usage
 */
router.get('/usage', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as User;

    const userPlan = (user.plan || 'trial') as PlanType;
    const planMinutes = planLimits[userPlan] || 0;
    const topupMinutes = user.voiceMinutesTopup || 0;
    const usedMinutes = user.voiceMinutesUsed || 0;
    const totalBalance = planMinutes + topupMinutes - usedMinutes;
    const remaining = Math.max(0, totalBalance);
    const totalLimit = planMinutes + topupMinutes;
    const percentage = totalLimit > 0 ? Math.round((usedMinutes / totalLimit) * 100) : 0;

    res.json({
      plan: user.plan,
      planMinutes,
      topupMinutes,
      totalLimit,
      used: usedMinutes,
      remaining,
      percentage,
      locked: remaining <= 0,
      message: remaining === 0 ? 'All voice minutes used. Top up to continue sending voice notes.' : undefined
    });
  } catch (error: unknown) {
    console.error('Voice usage check error:', error);
    res.status(500).json({ error: 'Failed to check voice usage' });
  }
});

export default router;


