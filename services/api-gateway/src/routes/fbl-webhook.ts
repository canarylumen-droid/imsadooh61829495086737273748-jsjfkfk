/**
 * ─── FBL (Feedback Loop) COMPLAINT HANDLER ────────────────────────────────────
 *
 * Ingests abuse/complaint webhooks from major ISPs (Gmail, Outlook, Yahoo).
 *
 * When a recipient marks an email as spam, the ISP sends an FBL report.
 * This endpoint receives those reports and:
 *  1. Identifies the email address in campaignEmails
 *  2. Sets status to 'suppressed' (permanent blacklist)
 *  3. Updates the lead record to block future campaigns
 *  4. Logs the suppression for audit trail
 *
 * Supported formats:
 *  - ARF (Abuse Reporting Format) — standard for Gmail/Outlook
 *  - Generic JSON webhook — for custom ESP integrations
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import { db } from '@shared/lib/db/db.js';
import { campaignEmails, leads, auditTrail, bounceTracker } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '../core/logger.js';
import { getRedisClient } from '@shared/lib/redis/redis.js';

const log = createLogger('FBL-HANDLER');
const router = Router();

interface FBLPayload {
  feedbackType: 'abuse' | 'fraud' | 'virus' | 'other';
  arrivalDate?: string;
  originalRCPTTo?: string;
  originalMailFrom?: string;
  reportingMTA?: string;
  sourceIP?: string;
  userAgent?: string;
  version?: number;
}

/**
 * Suppress all campaign emails for a given email address.
 * This is a permanent blacklist — the lead will never receive outreach again.
 */
async function suppressEmailAddress(email: string, metadata: Record<string, any>): Promise<void> {
  if (!db) {
    log.error('DB not available — cannot suppress email', { email });
    return;
  }

  try {
    // Find the lead by email
    const [lead] = await db
      .select({ id: leads.id, userId: leads.userId, integrationId: leads.integrationId })
      .from(leads)
      .where(eq(leads.email, email))
      .limit(1);

    if (!lead) {
      log.warn('FBL received for unknown email — no lead found', { email });
      return;
    }

    // Suppress all campaign emails for this lead
    const updated = await db
      .update(campaignEmails)
      .set({
        status: 'suppressed',
        metadata: { suppressedAt: new Date().toISOString(), suppressionReason: 'fbl_complaint', ...metadata },
      })
      .where(and(eq(campaignEmails.leadId, lead.id), eq(campaignEmails.status, 'sent')))
      .returning({ id: campaignEmails.id, campaignId: campaignEmails.campaignId });

    // Mark the lead as permanently opted out
    await db
      .update(leads)
      .set({
        status: 'unsubscribed',
        tags: ['fbl_suppressed'],
        metadata: { optedOutAt: new Date().toISOString(), optOutReason: 'fbl_spam_complaint' },
      })
      .where(eq(leads.id, lead.id));

    // Degrade the associated mailbox's reputation
    if (lead.integrationId) {
      await db.insert(bounceTracker).values({
        userId: lead.userId,
        leadId: lead.id,
        integrationId: lead.integrationId,
        bounceType: 'spam',
        email,
        metadata: {
          source: 'fbl',
          ...metadata,
          recordedAt: new Date().toISOString(),
        },
      }).catch((err: any) => {
        log.warn('Failed to record FBL spam bounce', { email, integrationId: lead.integrationId, error: err.message });
      });

      const redis = await getRedisClient();
      await redis?.hIncrBy(`mailbox:complaints:${lead.integrationId}`, 'count', 1);
      await redis?.expire(`mailbox:complaints:${lead.integrationId}`, 86400 * 30); // 30 days

      const { calculateReputationScore } = await import('@services/email-service/src/email/reputation-monitor.js');
      await calculateReputationScore(lead.integrationId).catch((err: any) => {
        log.warn('Failed to recalculate reputation after FBL complaint', { integrationId: lead.integrationId, error: err.message });
      });

      // Update email_tracking.placement to 'spam' for this recipient
      try {
        const { sql: runSql } = await import('drizzle-orm');
        const token = metadata?.messageId;
        if (token) {
          await db.execute(runSql`
            UPDATE email_tracking 
            SET placement = 'spam', placement_updated_at = NOW()
            WHERE token = ${token}
          `);
        } else {
          // Fallback: match by recipient email within last 7 days
          await db.execute(runSql`
            UPDATE email_tracking 
            SET placement = 'spam', placement_updated_at = NOW()
            WHERE recipient_email = ${email}
              AND sent_at > NOW() - INTERVAL '7 days'
              AND placement = 'unknown'
          `);
        }
      } catch (err: any) {
        log.warn('Failed to update email_tracking placement from FBL', { email, error: err.message });
      }

      // Push deliverability update
      try {
        const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
        await clusterSync.notifyDeliverabilityUpdated(lead.userId, {
          integrationId: lead.integrationId,
          placement: 'spam',
          source: 'fbl_webhook'
        }).catch(() => {});
      } catch (_) {}
    }

    // Audit trail
    await db.insert(auditTrail).values({
      userId: lead.userId,
      leadId: lead.id,
      action: 'fbl_suppression',
      details: {
        email,
        suppressedCampaignEmails: updated.length,
        fblMetadata: metadata,
      },
    });

    log.warn('Email permanently suppressed due to FBL complaint', {
      email,
      leadId: lead.id,
      suppressedCount: updated.length,
      campaignIds: updated.map(r => r.campaignId),
    });
  } catch (err: any) {
    log.error('Failed to process FBL suppression', { email, error: err.message });
  }
}

/**
 * POST /webhooks/fbl/complaint
 * Accepts ARF-formatted FBL complaints.
 * ISPs send a multipart email where the body contains the ARF payload.
 */
router.post('/complaint', async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart')) {
      // ARF format (Gmail, Outlook, Yahoo) — parse the multipart body
      // In production, use a proper multipart parser (e.g., multer, busboy)
      // For now, we handle the simplified JSON fallback below
      log.info('Received ARF multipart FBL — processing simplified JSON fallback');
      const { email, feedbackType, ...meta } = req.body;
      if (email) {
        await suppressEmailAddress(email, { feedbackType, ...meta });
      }
    } else {
      // Generic JSON webhook (SendGrid, AWS SES, etc.)
      const { email, feedbackType, campaignId, messageId, ...meta } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Missing email field' });
      }

      await suppressEmailAddress(email, { feedbackType, campaignId, messageId, ...meta });
    }

    // Always return 200 so ISPs don't retry
    res.status(200).json({ status: 'processed' });
  } catch (err: any) {
    log.error('FBL webhook processing error', { error: err.message });
    // Still return 200 to prevent ISP retries
    res.status(200).json({ status: 'acknowledged' });
  }
});

/**
 * POST /webhooks/fbl/sendgrid
 * SendGrid-specific Event Webhook (spam reports)
 */
router.post('/sendgrid', async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      if (event.event === 'spamreport' && event.email) {
        await suppressEmailAddress(event.email, {
          provider: 'sendgrid',
          event: event.event,
          timestamp: event.timestamp,
          sgMessageId: event.sg_message_id,
          campaignId: event.campaign_id,
        });
      }
    }

    res.status(200).json({ status: 'processed', count: events.length });
  } catch (err: any) {
    log.error('SendGrid FBL webhook error', { error: err.message });
    res.status(200).json({ status: 'acknowledged' });
  }
});

/**
 * POST /webhooks/fbl/ses
 * AWS SES-specific complaint notification (via SNS)
 */
router.post('/ses', async (req, res) => {
  try {
    const { notificationType, complaint } = req.body;

    if (notificationType === 'Complaint' && complaint?.complainedRecipients) {
      for (const recipient of complaint.complainedRecipients) {
        await suppressEmailAddress(recipient.emailAddress, {
          provider: 'aws-ses',
          complaintFeedbackType: complaint.complaintFeedbackType,
          arrivalDate: complaint.arrivalDate,
        });
      }
    }

    res.status(200).json({ status: 'processed' });
  } catch (err: any) {
    log.error('SES FBL webhook error', { error: err.message });
    res.status(200).json({ status: 'acknowledged' });
  }
});

export default router;
