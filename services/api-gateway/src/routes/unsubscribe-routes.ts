import { Router } from 'express';
import { db } from '@shared/lib/db/db.js';
import { leads, campaignLeads } from '@audnix/shared';
import { eq, or, and } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Unsubscribe API is operational. Use GET /api/unsubscribe/:leadId or GET /api/unsubscribe?email=<email> to unsubscribe.' });
});

/**
 * Helper: Unsubscribe a lead by ID or email.
 * Returns the lead if found and updated, null otherwise.
 */
async function unsubscribeLead(leadId?: string, email?: string): Promise<any> {
  let lead: any = null;
  
  if (leadId) {
    const rows = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    lead = rows[0];
  } else if (email) {
    const rows = await db.select().from(leads).where(eq(leads.email, email.toLowerCase().trim())).limit(1);
    lead = rows[0];
  }

  if (!lead) return null;
  if (lead.status === 'unsubscribed') return { alreadyUnsubscribed: true, lead };

  // Update lead status to unsubscribed
  await storage.updateLead(lead.id, { 
    status: 'unsubscribed', 
    aiPaused: true,
    metadata: { 
      ...lead.metadata, 
      unsubscribedAt: new Date().toISOString(),
      unsubscribeSource: 'public_link'
    } 
  });

  // Also unsubscribe from any active campaigns
  try {
    await db.update(campaignLeads)
      .set({ 
        status: 'unsubscribed' as any,
        metadata: { 
          ...(campaignLeads as any).metadata,
          unsubscribedAt: new Date().toISOString()
        }
      })
      .where(and(
        eq(campaignLeads.leadId, lead.id),
        or(
          eq(campaignLeads.status, 'pending'),
          eq(campaignLeads.status, 'queued'),
          eq(campaignLeads.status, 'sent')
        )
      ));
  } catch (err) {
    console.warn('[Unsubscribe] Failed to unsubscribe from campaigns:', err);
  }

  // Notify user via Redis pub/sub (cross-process safe)
  await clusterSync.notifyLeadsUpdated(lead.userId, { leadId: lead.id, status: 'unsubscribed' });

  return { alreadyUnsubscribed: false, lead };
}

/**
 * GET /api/unsubscribe/:leadId
 * Public unsubscribe link for outreach emails. Supports:
 * - /api/unsubscribe/:leadId (by ID)
 * - /api/unsubscribe?email=<email> (by email, 1-click)
 */
router.get('/:leadIdOrEmail?', async (req, res) => {
  try {
    const { leadIdOrEmail } = req.params;
    const emailParam = req.query.email as string | undefined;
    
    // Determine lookup method
    let leadId: string | undefined;
    let email: string | undefined;
    
    if (leadIdOrEmail && leadIdOrEmail.includes('@')) {
      // Passed an email in the path
      email = leadIdOrEmail;
    } else if (leadIdOrEmail && leadIdOrEmail.length > 0) {
      leadId = leadIdOrEmail;
    } else if (emailParam) {
      email = emailParam;
    } else {
      return res.status(400).json({ 
        error: 'Missing lead identifier',
        message: 'Provide a lead ID in the path or an email as query parameter'
      });
    }

    const result = await unsubscribeLead(leadId, email);

    if (!result) {
      // Lead not found — show confirmation anyway (don't reveal if email exists)
      const displayEmail = email || leadId;
      return res.status(200).send(buildUnsubscribePage(
        'Already Removed',
        `The address <strong>${escapeHtml(displayEmail || '')}</strong> is not in our outreach list.`,
        '✅'
      ));
    }

    if (result.alreadyUnsubscribed) {
      const displayName = result.lead.name || result.lead.email;
      return res.status(200).send(buildUnsubscribePage(
        'Already Unsubscribed',
        `You're already removed from <strong>${escapeHtml(displayName)}</strong>'s outreach list.`,
        '✅'
      ));
    }

    const displayName = result.lead.name || 'our';
    res.status(200).send(buildUnsubscribePage(
      'Unsubscribed',
      `You've been removed from <strong>${escapeHtml(displayName)}</strong>'s outreach list. No more automated messages.`,
      '✅'
    ));
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    res.status(500).send(buildUnsubscribePage('Something went wrong', 'Please try again later or contact support.', '❌'));
  }
});

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildUnsubscribePage(title: string, message: string, icon: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 50%, #0a0a1a 100%);
          color: #fff;
          padding: 24px;
        }
        .container {
          max-width: 420px;
          width: 100%;
          text-align: center;
          animation: fadeInUp 0.6s ease-out;
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes drawCheck {
          to { stroke-dashoffset: 0; }
        }
        .icon-wrap {
          width: 72px;
          height: 72px;
          margin: 0 auto 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.04));
          border: 2px solid rgba(34, 197, 94, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .icon-wrap svg {
          width: 32px;
          height: 32px;
          stroke: #22c55e;
          stroke-width: 2.5;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .icon-wrap path {
          stroke-dasharray: 50;
          stroke-dashoffset: 50;
          animation: drawCheck 0.5s ease-out 0.3s forwards;
        }
        h1 {
          font-size: 22px;
          font-weight: 700;
          margin-bottom: 8px;
          letter-spacing: -0.01em;
        }
        .message {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.55);
          line-height: 1.6;
          margin-bottom: 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon-wrap">
          <svg viewBox="0 0 24 24">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h1>${title}</h1>
        <p class="message">${message}</p>
      </div>
    </body>
    </html>
  `;
}

export default router;
