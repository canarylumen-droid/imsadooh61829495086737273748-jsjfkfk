import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { videoAssets, aiActionLogs, processedComments, videoMonitors } from '@audnix/shared';
import { eq, desc, and, sql, count } from 'drizzle-orm';
import { detectBuyingIntent, generateSalesmanDM } from '@services/brain-worker/src/ai-lib/specialized/video-comment-monitor.js';
import { InstagramProvider } from '@shared/lib/providers/instagram.js';

interface InstagramMediaItem {
  id: string;
  media_type: 'VIDEO' | 'IMAGE' | 'CAROUSEL_ALBUM';
  media_url?: string;
  thumbnail_url?: string;
  caption?: string;
  timestamp: string;
  permalink: string;
}

interface InstagramMediaResponse {
  data: InstagramMediaItem[];
}

const router = Router();

/**
 * Get user's Instagram reels with thumbnails and auto-extracted brand knowledge
 * GET /api/video-automation/reels
 */
router.get('/reels', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const integrations = await storage.getIntegrations(userId);
    const igIntegration = integrations.find(i => i.provider === 'instagram' && i.connected);

    if (!igIntegration) {
      res.json({ reels: [], message: 'Connect Instagram to see your reels' });
      return;
    }

    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    const meta = JSON.parse(decrypt(igIntegration.encryptedMeta)) as { pageId: string; accessToken: string };

    // Fetch reels with thumbnail URLs
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${meta.pageId}/media?fields=id,media_type,media_url,thumbnail_url,caption,timestamp,permalink&limit=30`,
      {
        headers: { Authorization: `Bearer ${meta.accessToken}` }
      }
    );

    if (!response.ok) {
      res.status(500).json({ error: 'Failed to fetch Instagram reels' });
      return;
    }

    const data = await response.json() as InstagramMediaResponse;
    const reels = data.data
      .filter((item) => item.media_type === 'VIDEO' || item.media_type === 'CAROUSEL_ALBUM')
      .map((item) => ({
        id: item.id,
        url: item.permalink,
        mediaUrl: item.media_url,
        thumbnailUrl: item.thumbnail_url || item.media_url,
        caption: item.caption || '',
        timestamp: item.timestamp,
        extractedKnowledge: item.caption ? extractBrandKnowledgeFromCaption(item.caption) : null
      }));

    res.json({ reels });
  } catch (error) {
    console.error('Error fetching reels:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch reels';
    res.status(500).json({ error: message });
  }
});

/**
 * AI extracts brand knowledge from video caption
 */
function extractBrandKnowledgeFromCaption(caption: string): string {
  // Simple extraction - can be enhanced with OpenAI later
  const lines = caption.split('\n').filter(line => line.trim().length > 0);
  return lines.slice(0, 3).join(' '); // First 3 lines as brand context
}

/**
 * Get user's Instagram videos for selection (deprecated - use /reels)
 * GET /api/video-automation/videos
 */
router.get('/videos', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const integrations = await storage.getIntegrations(userId);
    const igIntegration = integrations.find(i => i.provider === 'instagram' && i.connected);

    if (!igIntegration) {
      res.status(400).json({ error: 'Instagram not connected' });
      return;
    }

    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    const meta = JSON.parse(decrypt(igIntegration.encryptedMeta)) as { pageId: string; accessToken: string };

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${meta.pageId}/media?fields=id,media_type,media_url,caption,timestamp,permalink&limit=20`,
      {
        headers: { Authorization: `Bearer ${meta.accessToken}` }
      }
    );

    if (!response.ok) {
      res.status(500).json({ error: 'Failed to fetch Instagram videos' });
      return;
    }

    const data = await response.json() as InstagramMediaResponse;
    const videos = data.data
      .filter((item: InstagramMediaItem) => item.media_type === 'VIDEO' || item.media_type === 'CAROUSEL_ALBUM')
      .map((item: InstagramMediaItem) => ({
        id: item.id,
        url: item.permalink,
        mediaUrl: item.media_url,
        caption: item.caption || '',
        timestamp: item.timestamp
      }));

    res.json({ videos });
  } catch (error) {
    console.error('Error fetching videos:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch videos';
    res.status(500).json({ error: message });
  }
});

/**
 * Create new video monitor configuration
 * POST /api/video-automation/monitors
 */
router.post('/monitors', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { videoId, videoUrl, productLink, ctaText, metadata } = req.body as {
      videoId: string;
      videoUrl?: string;
      productLink: string;
      ctaText: string;
      metadata?: Record<string, unknown>;
    };

    if (!videoId || !productLink || !ctaText) {
      res.status(400).json({
        error: 'Missing required fields: videoId, productLink, ctaText'
      });
      return;
    }

    // Check for active subscription or valid trial
    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const isTrialExpired = user.plan === 'trial' && (!user.trialExpiresAt || new Date() > new Date(user.trialExpiresAt));

    if (isTrialExpired) {
      res.status(403).json({
        error: 'Trial expired - Upgrade to a paid plan to continue using Video Comment Automation'
      });
      return;
    }

    const monitor = await storage.createVideoMonitor({
      userId,
      videoId,
      videoUrl,
      productLink,
      ctaText,
      isActive: true,
      autoReplyEnabled: true,
      metadata: metadata || {}
    });

    res.json({
      success: true,
      monitor,
      message: 'AI is now monitoring comments on this video 24/7'
    });
  } catch (error) {
    console.error('Error creating video monitor:', error);
    const message = error instanceof Error ? error.message : 'Failed to create monitor';
    res.status(500).json({ error: message });
  }
});

/**
 * Get all video monitors for user
 * GET /api/video-automation/monitors
 */
router.get('/monitors', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const monitors = await storage.getVideoMonitors(userId);
    res.json({ monitors });
  } catch (error) {
    console.error('Error fetching monitors:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch monitors';
    res.status(500).json({ error: message });
  }
});

/**
 * Update video monitor
 * PATCH /api/video-automation/monitors/:id
 */
router.patch('/monitors/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req)!;
    const updates = req.body as Record<string, unknown>;

    // Check for active subscription or valid trial
    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const isTrialExpired = user.plan === 'trial' && (!user.trialExpiresAt || new Date() > new Date(user.trialExpiresAt));

    if (isTrialExpired) {
      res.status(403).json({
        error: 'Trial expired - Upgrade to a paid plan to continue using Video Comment Automation'
      });
      return;
    }

    // Validate productLink if provided
    if (updates.productLink && typeof updates.productLink === 'string') {
      const urlPattern = /^https?:\/\/.+/;
      if (!urlPattern.test(updates.productLink)) {
        res.status(400).json({ error: 'Invalid URL format for productLink' });
        return;
      }
    }

    const monitor = await storage.updateVideoMonitor(id as string, userId, updates);

    if (!monitor) {
      res.status(404).json({ error: 'Monitor not found' });
      return;
    }

    res.json({ success: true, monitor });
  } catch (error) {
    console.error('Error updating monitor:', error);
    const message = error instanceof Error ? error.message : 'Failed to update monitor';
    res.status(500).json({ error: message });
  }
});

/**
 * Delete video monitor
 * DELETE /api/video-automation/monitors/:id
 */
router.delete('/monitors/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = getCurrentUserId(req)!;

    // Check for active subscription or valid trial
    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const isTrialExpired = user.plan === 'trial' && (!user.trialExpiresAt || new Date() > new Date(user.trialExpiresAt));

    if (isTrialExpired) {
      res.status(403).json({
        error: 'Trial expired - Upgrade to a paid plan to continue using Video Comment Automation'
      });
      return;
    }

    await storage.deleteVideoMonitor(id as string, userId);
    res.json({ success: true, message: 'Monitor deleted' });
  } catch (error) {
    console.error('Error deleting monitor:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete monitor';
    res.status(500).json({ error: message });
  }
});

/**
 * Test comment intent detection
 * POST /api/video-automation/test-intent
 */
router.post('/test-intent', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { comment, videoContext } = req.body as { comment?: string; videoContext?: string };

    if (!comment) {
      res.status(400).json({ error: 'Comment text required' });
      return;
    }

    const intent = await detectBuyingIntent(comment, videoContext || '');

    res.json({
      intent,
      recommendation: intent.shouldDM
        ? `AI will DM this lead with personalized sales message`
        : `No action needed - ${intent.intentType}`
    });
  } catch (error) {
    console.error('Intent test error:', error);
    const message = error instanceof Error ? error.message : 'Intent detection failed';
    res.status(500).json({ error: message });
  }
});

/**
 * Get video assets for user
 * GET /api/video-automation/assets
 */
router.get('/assets', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const assets = await db
      .select()
      .from(videoAssets)
      .where(eq(videoAssets.userId, userId))
      .orderBy(desc(videoAssets.createdAt))
      .limit(50);

    res.json({ assets });
  } catch (error: any) {
    console.error('Error getting video assets:', error.message);
    res.status(500).json({ error: 'Failed to get assets' });
  }
});

/**
 * Sync video assets from Instagram
 * POST /api/video-automation/assets/sync
 */
router.post('/assets/sync', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const integrations = await storage.getIntegrations(userId);
    const igIntegration = integrations.find(i => i.provider === 'instagram' && i.connected);

    if (!igIntegration) {
      res.status(400).json({ error: 'Instagram not connected' });
      return;
    }

    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    const meta = JSON.parse(decrypt(igIntegration.encryptedMeta)) as { pageId: string; accessToken: string };

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${meta.pageId}/media?fields=id,media_type,media_url,thumbnail_url,caption,timestamp,permalink&limit=30`,
      { headers: { Authorization: `Bearer ${meta.accessToken}` } }
    );

    if (!response.ok) {
      res.status(500).json({ error: 'Failed to fetch from Instagram' });
      return;
    }

    const data = await response.json() as InstagramMediaResponse;
    const videos = data.data.filter(item => item.media_type === 'VIDEO' || item.media_type === 'CAROUSEL_ALBUM');

    let synced = 0;
    for (const video of videos) {
      const existing = await db
        .select()
        .from(videoAssets)
        .where(and(eq(videoAssets.userId, userId), eq(videoAssets.externalId, video.id)))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(videoAssets).values({
          userId,
          platform: 'instagram',
          externalId: video.id,
          videoUrl: video.permalink,
          thumbnailUrl: video.thumbnail_url || video.media_url,
          caption: video.caption || null,
          enabled: true,
        });
        synced++;
      }
    }

    res.json({ success: true, synced, total: videos.length });
  } catch (error: any) {
    console.error('Error syncing video assets:', error.message);
    res.status(500).json({ error: 'Failed to sync' });
  }
});

/**
 * Update video asset with AI context
 * PATCH /api/video-automation/assets/:id
 */
router.patch('/assets/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { id } = req.params;
    const { purpose, ctaLink, aiContext, enabled } = req.body;

    const [updated] = await db
      .update(videoAssets)
      .set({
        ...(purpose !== undefined && { purpose }),
        ...(ctaLink !== undefined && { ctaLink }),
        ...(aiContext !== undefined && { aiContext }),
        ...(enabled !== undefined && { enabled }),
        updatedAt: new Date(),
      })
      .where(and(eq(videoAssets.id, id as string), eq(videoAssets.userId, userId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.json({ asset: updated });
  } catch (error: any) {
    console.error('Error updating video asset:', error.message);
    res.status(500).json({ error: 'Failed to update' });
  }
});

/**
 * Get single video asset
 * GET /api/video-automation/assets/:id
 */
router.get('/assets/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { id } = req.params;

    const [asset] = await db
      .select()
      .from(videoAssets)
      .where(and(eq(videoAssets.id, id as string), eq(videoAssets.userId, userId)))
      .limit(1);

    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.json({ asset });
  } catch (error: any) {
    console.error('Error getting video asset:', error.message);
    res.status(500).json({ error: 'Failed to get asset' });
  }
});

/**
 * Get AI action logs for video
 * GET /api/video-automation/ai-logs
 */
router.get('/ai-logs', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const logs = await db
      .select()
      .from(aiActionLogs)
      .where(and(
        eq(aiActionLogs.userId, userId),
        eq(aiActionLogs.actionType, 'video_sent')
      ))
      .orderBy(desc(aiActionLogs.createdAt))
      .limit(20);

    res.json({ logs });
  } catch (error: any) {
    console.error('Error getting AI logs:', error.message);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

/**
 * Get video automation stats including intent accuracy
 * GET /api/video-automation/stats
 */
router.get('/stats', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    // Get user's video monitors
    const monitors = await db
      .select({ id: videoMonitors.id })
      .from(videoMonitors)
      .where(eq(videoMonitors.userId, userId));

    const monitorIds = monitors.map(m => m.id);

    if (monitorIds.length === 0) {
      res.json({
        intentAccuracy: null,
        totalProcessed: 0,
        dmsSent: 0,
        ignored: 0,
        failed: 0,
        impactLevel: 'none'
      });
      return;
    }

    // Count processed comments by status
    const stats = await db
      .select({
        status: processedComments.status,
        count: count()
      })
      .from(processedComments)
      .where(sql`${processedComments.videoMonitorId} = ANY(${monitorIds})`)
      .groupBy(processedComments.status);

    const dmsSent = stats.find(s => s.status === 'dm_sent')?.count || 0;
    const ignored = stats.find(s => s.status === 'ignored')?.count || 0;
    const failed = stats.find(s => s.status === 'failed')?.count || 0;
    const totalProcessed = dmsSent + ignored + failed;

    // Intent accuracy = DMs sent / (DMs sent + ignored) - failed are errors, not intent misses
    const intentPool = dmsSent + ignored;
    const intentAccuracy = intentPool > 0 ? Math.round((dmsSent / intentPool) * 100) : null;

    // Impact level based on DM success rate
    let impactLevel: 'none' | 'low' | 'medium' | 'high' = 'none';
    if (totalProcessed > 0) {
      const successRate = dmsSent / totalProcessed;
      if (successRate >= 0.7) impactLevel = 'high';
      else if (successRate >= 0.4) impactLevel = 'medium';
      else impactLevel = 'low';
    }

    res.json({
      intentAccuracy,
      totalProcessed,
      dmsSent,
      ignored,
      failed,
      impactLevel
    });
  } catch (error: any) {
    console.error('Error getting video automation stats:', error.message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
