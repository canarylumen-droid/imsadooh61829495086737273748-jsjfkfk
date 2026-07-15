import { Router, Request, Response } from 'express';
import { recordEmailEvent, getEmailStats } from '@services/email-service/src/email/email-tracking.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { isValidUUID } from '@shared/lib/utils/validation.js';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';

const router = Router();

const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Stealth tracking routes — short paths that look like URL shorteners or
// image redirects, not obvious tracking endpoints. Email security scanners
// flag /api/email-tracking/track/open/{token} as a known tracking pattern.
// /t/{token} blends in as a generic short URL (like t.co, bit.ly, etc.)
// These are mounted at root level (separate from the /api/email-tracking prefix)
// so the pixel URL is just {baseUrl}/t/{token}, not {baseUrl}/api/email-tracking/t/{token}.

const stealthRouter = Router();

stealthRouter.get('/t/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    if (!token) {
      res.set('Content-Type', 'image/gif');
      res.send(TRANSPARENT_1X1_GIF);
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

stealthRouter.get('/c/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const { url } = req.query;

    if (!token || !url || typeof url !== 'string') {
      res.status(400).send('Invalid request');
      return;
    }

    const decodedUrl = decodeURIComponent(url);

    // Basic URL safety check
    let isSafe = false;
    try {
      isSafe = decodedUrl.startsWith('http://') || decodedUrl.startsWith('https://');
    } catch {
      isSafe = false;
    }

    if (!isSafe) {
      res.status(400).send('Invalid redirect URL');
      return;
    }

    await recordEmailEvent({
      type: 'click',
      messageId: token,
      timestamp: new Date(),
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      linkUrl: decodedUrl,
    });

    res.redirect(302, decodedUrl);
  } catch (error) {
    console.error('Error tracking email click:', error);
    res.status(400).send('Invalid request');
  }
});

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
      const row = trackResult.rows[0] as any;
      const storedTargetUrl = row?.target_url;
      if (storedTargetUrl) {
        // target_url stores comma-separated URLs from the original email
        const allowedUrls = storedTargetUrl.split(',');
        if (allowedUrls.includes(decodedUrl)) {
          redirectUrl = decodedUrl;
          verified = true;
        } else {
          // The requested URL was NOT in the original email - potential attack
          console.warn(`[Tracking] ⚠️ Blocked unverified redirect for token ${token}: ${decodedUrl}`);
          res.status(400).send('Invalid redirect URL');
          return;
        }
      } else {
        // No stored target_url (e.g., older tracking record or plain-text email).
        // We still allow the redirect but mark as unverified for stats.
        console.log(`[Tracking] No stored target_url for token ${token} — allowing redirect (legacy/plain-text email)`);
        verified = true; // Allow the redirect, just without URL verification
      }
    } catch (lookupErr) {
      console.error('[Tracking] Error looking up target_url:', lookupErr);
      // On DB error, still allow redirect to avoid breaking user experience
      verified = true;
    }

    await recordEmailEvent({
      type: 'click',
      messageId: token,
      timestamp: new Date(),
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      linkUrl: redirectUrl,
    });

    res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('Error tracking email click:', error);
    res.status(400).send('Invalid request');
  }
});

router.get('/stats', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
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

router.get('/tracking/:leadId', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
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

export { stealthRouter };
export default router;
