import { Router, Request, Response } from 'express';
import { verifyDomainDns } from '@services/email-service/src/email/dns-verification.js';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { sendError } from '@shared/lib/api/error-response.js';

const router = Router();

const verificationCache = new Map<string, { result: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
function pruneCache() {
  if (verificationCache.size > CACHE_MAX_ENTRIES) {
    const entries = [...verificationCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - CACHE_MAX_ENTRIES);
    for (const [key] of toDelete) verificationCache.delete(key);
  }
}

router.post('/verify', requireAuth, apiLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { domain, dkimSelector, force } = req.body;

    if (!domain || typeof domain !== 'string') {
      res.status(400).json({ error: 'Domain is required' });
      return;
    }

    let cleanDomain = domain.toLowerCase().trim();
    try {
      const url = new URL(cleanDomain.startsWith('http') ? cleanDomain : `https://${cleanDomain}`);
      cleanDomain = url.hostname;
    } catch (e) {
      // Fallback if not a full URL - safer split instead of regex
      cleanDomain = cleanDomain.split('/')[0];
    }

    const cacheKey = `${cleanDomain}:${dkimSelector || 'default'}`;
    const cached = verificationCache.get(cacheKey);
    if (cached && !force && Date.now() - cached.timestamp < CACHE_TTL) {
      res.json({
        success: true,
        cached: true,
        ...cached.result,
      });
      return;
    }

    const result = await verifyDomainDns(cleanDomain, dkimSelector, !!force);

    if (!force) {
      verificationCache.set(cacheKey, { result, timestamp: Date.now() });
      pruneCache();
    }

    const userId = getCurrentUserId(req);
    if (userId) {
      try {
        await db.execute(sql`
          INSERT INTO domain_verifications (id, user_id, domain, verification_result, created_at)
          VALUES (gen_random_uuid(), ${userId}, ${cleanDomain}, ${JSON.stringify(result)}::jsonb, NOW())
          ON CONFLICT (user_id, domain) 
          DO UPDATE SET verification_result = ${JSON.stringify(result)}::jsonb, created_at = NOW()
        `);
      } catch (dbError) {
        console.log('Domain verification table may not exist yet, skipping storage');
      }
    }

    res.json({
      success: true,
      cached: false,
      ...result,
    });
  } catch (error: any) {
    console.error('DNS verification error:', error);
    sendError(res, 500, 'Failed to verify domain DNS', error.message);
  }
});

router.get('/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.execute(sql`
      SELECT domain, verification_result, created_at
      FROM domain_verifications
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      verifications: result.rows,
    });
  } catch (error) {
    console.error('Error fetching verification history:', error);
    res.json({
      success: true,
      verifications: [],
    });
  }
});

export default router;
