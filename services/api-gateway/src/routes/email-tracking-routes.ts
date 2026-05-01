import { Router, Request, Response } from 'express';
import { recordEmailEvent, getEmailStats } from '@services/email-service/src/email/email-tracking.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { isValidUUID } from '@shared/lib/utils/validation.js';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';

const router = Router();

const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

router.get('/track/open/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    if (!token) {
      res.status(400).send('Invalid token');
      return;
    }

    await recordEmailEvent({
      type: 'open',
      messageId: token,
      timestamp: new Date(),
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_1X1_GIF.length.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.send(TRANSPARENT_1X1_GIF);
  } catch (error) {
    console.error('Error tracking email open:', error);
    res.set('Content-Type', 'image/gif');
    res.send(TRANSPARENT_1X1_GIF);
  }
});

router.get('/track/click/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const { url } = req.query;

    if (!token || !url || typeof url !== 'string') {
      res.status(400).send('Invalid request');
      return;
    }

    const decodedUrl = decodeURIComponent(url);

    // Validate URL format
    let isSafe = false;
    try {
      if (decodedUrl.startsWith('//')) {
        isSafe = false;
      } else if (decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://')) {
        isSafe = true;
      } else {
        isSafe = false;
      }
    } catch (e) {
      isSafe = false;
    }

    if (!isSafe) {
      res.status(400).send('Invalid redirect URL');
      return;
    }

    // SECURITY: Look up the stored target_url from the email_tracking table
    // and verify the requested URL was actually in the original email
    let redirectUrl = decodedUrl;
    let verified = false;
    try {
      const trackResult = await db.execute(sql`
        SELECT target_url FROM email_tracking WHERE token = ${token} LIMIT 1
      `);
      const storedTargetUrl = (trackResult.rows[0] as any)?.target_url;
      if (storedTargetUrl) {
        // target_url stores comma-separated URLs from the original email
        const allowedUrls = storedTargetUrl.split(',');
        if (allowedUrls.includes(decodedUrl)) {
          redirectUrl = decodedUrl; // URL is verified as part of original email
          verified = true;
        } else {
          // The requested URL was NOT in the original email - potential attack
          console.warn(`[Tracking] ⚠️ Blocked unverified redirect for token ${token}: ${decodedUrl}`);
          res.status(400).send('Invalid redirect URL');
          return;
        }
      }
    } catch (lookupErr) {
      console.error('[Tracking] Error looking up target_url:', lookupErr);
    }

    await recordEmailEvent({
      type: 'click',
      messageId: token,
      timestamp: new Date(),
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      linkUrl: redirectUrl,
    });

    if (!verified) {
      // Legacy email support: Use an interstitial HTML page for URLs that aren't verified by the DB.
      // This mitigates the Server-Side URL Redirect vulnerability.
      const safeUrl = String(redirectUrl).replace(/"/g, '&quot;');
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="1;url=${safeUrl}">
          <title>Redirecting...</title>
          <style>body { font-family: sans-serif; text-align: center; margin-top: 50px; }</style>
        </head>
        <body>
          <p>Redirecting you to <a href="${safeUrl}">${safeUrl}</a>...</p>
        </body>
        </html>
      `);
      return;
    }

    res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('Error tracking email click:', error);
    res.status(400).send('Invalid request');
  }
});

router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const days = parseInt(req.query.days as string) || 30;

    const stats = await getEmailStats(userId, days);

    res.json({
      success: true,
      stats,
      period: `${days} days`,
    });
  } catch (error) {
    console.error('Error getting email stats:', error);
    res.status(500).json({ error: 'Failed to get email stats' });
  }
});

router.get('/tracking/:leadId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId } = req.params;

    if (!isValidUUID(leadId)) {
      res.status(400).json({ error: 'Invalid lead ID format' });
      return;
    }

    const result = await db.execute(sql`
      SELECT 
        et.id,
        et.subject,
        et.recipient_email,
        et.sent_at,
        et.first_opened_at,
        et.first_clicked_at,
        et.open_count,
        et.click_count
      FROM email_tracking et
      WHERE et.user_id = ${userId}
      AND et.lead_id = ${leadId}
      ORDER BY et.sent_at DESC
      LIMIT 50
    `);

    res.json({
      success: true,
      emails: result.rows,
    });
  } catch (error) {
    console.error('Error getting lead email tracking:', error);
    res.status(500).json({ error: 'Failed to get tracking data' });
  }
});

export default router;
