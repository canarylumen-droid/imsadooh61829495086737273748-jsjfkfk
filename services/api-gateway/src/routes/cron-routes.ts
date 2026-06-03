import { Router, Request, Response } from 'express';
import { outreachEngine } from "@services/outreach-worker/workers/outreach-engine.js";
import { emailSyncWorker } from '@services/email-service/src/email/email-sync-worker.js';
import { followUpWorker } from '@services/brain-worker/src/ai-lib/core/follow-up-worker.js';
import { dailyCheckpoint } from '@shared/lib/queues/daily-checkpoint.js';

const router = Router();

/**
 * GET /api/cron/tick
 * Triggered by Vercel Cron or manual monitor
 */
router.get('/tick', async (req: Request, res: Response) => {
    // Security check: CRON_SECRET must be set and Bearer token must match
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        console.error('[Cron] CRON_SECRET env var is not set — cron endpoint disabled.');
        return res.status(503).json({ error: 'Cron secret not configured' });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[Cron] Unauthorized attempt to trigger tick');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[Cron] Received tick request. Starting engine steps...');

    try {
        // 1. Daily Checkpoint: pull today's tasks from PostgreSQL into BullMQ
        const checkpointResult = await dailyCheckpoint.runCheckpoint();

        // 2. Trigger Outreach Engine (enqueues BullMQ jobs)
        const outreachResult = await outreachEngine.tick();

        // 3. Trigger Email Sync (periodic check for Gmail/Outlook)
        await emailSyncWorker.syncAllUserEmails();

        // 4. Trigger Follow-up check (processes pending jobs)
        await followUpWorker.processQueue();

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            checkpoint: checkpointResult,
            outreach: outreachResult,
        });
    } catch (error: any) {
        console.error('[Cron] Tick failed:', error);
        res.status(500).json({ error: 'Tick execution failed', details: error.message });
    }
});

export default router;

