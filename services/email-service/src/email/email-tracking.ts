import crypto from 'crypto';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { isValidUUID } from '@shared/lib/utils/validation.js';

export interface EmailTrackingData {
  messageId: string;
  userId: string;
  leadId?: string;
  integrationId?: string;
  recipientEmail: string;
  subject: string;
  sentAt: Date;
  targetUrl?: string;
}

export interface EmailEvent {
  type: 'open' | 'click';
  messageId: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  linkUrl?: string;
}

export function generateTrackingToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function generateTrackingPixel(baseUrl: string, token: string): string {
  return `<img src="${baseUrl}/api/email-tracking/track/open/${token}" width="1" height="1" style="display:none;" alt="" />`;
}

export async function wrapLinksWithTracking(html: string, baseUrl: string, messageToken: string): Promise<{ html: string; urls: string[] }> {
  const isDocument = html.toLowerCase().includes('<html');
  const { load } = await import('cheerio');
  const $ = load(html);
  const urls: string[] = [];

  $('a').each((_: any, el: any) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.includes('/api/email/track/') && !href.includes('/api/email-tracking/track/') && !href.includes('/api/outreach/click/')) {
      urls.push(href);
      const encodedUrl = encodeURIComponent(href);
      const trackingUrl = `${baseUrl}/api/email-tracking/track/click/${messageToken}?url=${encodedUrl}`;
      $el.attr('href', trackingUrl);
    }
  });

  const outputHtml = isDocument ? $.html() : ($('body').html() || $.html());
  return { html: outputHtml, urls };
}

export function wrapPlainTextLinksWithTracking(text: string, baseUrl: string, messageToken: string): string {
  // Simple regex for HTTP/HTTPS URLs
  const urlRegex = /(?<!["'])(https?:\/\/[^\s<]+)/gi;

  return text.replace(urlRegex, (url: string) => {
    if (url.includes('/api/email-tracking/track/')) {
      return url;
    }

    const encodedUrl = encodeURIComponent(url);
    return `${baseUrl}/api/email-tracking/track/click/${messageToken}?url=${encodedUrl}`;
  });
}

export async function createTrackedEmail(data: EmailTrackingData): Promise<{ token: string; pixelHtml: string }> {
  const token = generateTrackingToken();
  const baseUrl = (globalThis as any).process?.env?.BASE_URL || 'https://audnixai.com';

  try {
    const validLeadId = isValidUUID(data.leadId) ? data.leadId : null;
    const validIntegrationId = isValidUUID(data.integrationId) ? data.integrationId : null;

    try {
      // Attempt 1: Full insert with target_url and integration_id (Modern schema)
      await db.execute(sql`
        INSERT INTO email_tracking (
          id, user_id, lead_id, integration_id, recipient_email, subject, token, sent_at, created_at, target_url
        ) VALUES (
          gen_random_uuid(),
          ${data.userId},
          ${validLeadId},
          ${validIntegrationId},
          ${data.recipientEmail},
          ${data.subject},
          ${token},
          ${data.sentAt.toISOString()},
          NOW(),
          ${data.targetUrl || null}
        )
      `);
    } catch (insertErr: any) {
      // Fallback: If columns don't exist (Error 42703), try without newer columns
      const isMissingCol = insertErr?.code === '42703' || 
                           insertErr?.message?.includes('target_url') || 
                           insertErr?.message?.includes('integration_id');
      
      if (isMissingCol) {
        console.warn(`[Tracking Resilience] Fallback triggered: New columns missing in production DB. Retrying with legacy schema.`);
        await db.execute(sql`
          INSERT INTO email_tracking (
            id, user_id, lead_id, recipient_email, subject, token, sent_at, created_at
          ) VALUES (
            gen_random_uuid(),
            ${data.userId},
            ${validLeadId},
            ${data.recipientEmail},
            ${data.subject},
            ${token},
            ${data.sentAt.toISOString()},
            NOW()
          )
        `);
      } else {
        throw insertErr; // Re-throw other errors
      }
    }
  } catch (error) {
    console.error('Failed to create email tracking record (even with fallback):', error);
  }

  const pixelHtml = generateTrackingPixel(baseUrl, token);
  return { token, pixelHtml };
}

export async function recordEmailEvent(event: EmailEvent): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO email_events (
        id, token, event_type, ip_address, user_agent, link_url, created_at
      )
      SELECT 
        gen_random_uuid(),
        ${event.messageId},
        ${event.type},
        ${event.ipAddress || null},
        ${event.userAgent || null},
        ${event.linkUrl || null},
        ${event.timestamp.toISOString()}
      WHERE NOT EXISTS (
        SELECT 1 FROM email_events 
        WHERE token = ${event.messageId} 
        AND event_type = ${event.type}
        ${event.type === 'click' ? sql`AND link_url = ${event.linkUrl}` : sql``}
      )
    `);

    // Get userId and leadId to notify
    const trackResult = await db.execute(sql`
      SELECT user_id, lead_id, integration_id, recipient_email, subject 
      FROM email_tracking 
      WHERE token = ${event.messageId}
    `);

    const trackingInfo = trackResult.rows[0] as any;

    if (event.type === 'open') {
      await db.execute(sql`
        UPDATE email_tracking 
        SET first_opened_at = COALESCE(first_opened_at, ${event.timestamp.toISOString()}),
            open_count = COALESCE(open_count, 0) + 1
        WHERE token = ${event.messageId}
      `);
    } else if (event.type === 'click') {
      await db.execute(sql`
        UPDATE email_tracking 
        SET first_clicked_at = COALESCE(first_clicked_at, ${event.timestamp.toISOString()}),
            click_count = COALESCE(click_count, 0) + 1
        WHERE token = ${event.messageId}
      `);
    }

    // Real-time Notification
    if (trackingInfo) {
      const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');

      // Update lead metadata for filtering
      if (trackingInfo.lead_id) {
        try {
          if (event.type === 'open') {
            await db.execute(sql`
                  UPDATE leads 
                  SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isOpened}', 'true'::jsonb),
                      status = CASE WHEN status = 'new' THEN 'open'::text ELSE status END,
                      updated_at = NOW()
                  WHERE id = ${trackingInfo.lead_id}
                `);

            // Update messages table
            await db.execute(sql`
                  UPDATE messages
                  SET opened_at = COALESCE(opened_at, ${event.timestamp.toISOString()}),
                      is_read = true
                  WHERE tracking_id = ${event.messageId}
                `);

            // Update campaign_emails table
            await db.execute(sql`
                  UPDATE campaign_emails
                  SET opened_at = COALESCE(opened_at, ${event.timestamp.toISOString()}),
                      status = 'opened'
                  WHERE message_id = ${event.messageId}
                `);
          } else if (event.type === 'click') {
            await db.execute(sql`
                  UPDATE leads 
                  SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isClicked}', 'true'::jsonb),
                      updated_at = NOW()
                  WHERE id = ${trackingInfo.lead_id}
                `);

            // Update messages table
            await db.execute(sql`
                  UPDATE messages
                  SET clicked_at = COALESCE(clicked_at, ${event.timestamp.toISOString()})
                  WHERE tracking_id = ${event.messageId}
                `);

            // Update campaign_emails table
            await db.execute(sql`
                  UPDATE campaign_emails
                  SET clicked_at = COALESCE(clicked_at, ${event.timestamp.toISOString()}),
                      status = 'clicked'
                  WHERE message_id = ${event.messageId}
                `);
          }

          // Notify lead update to refresh counts/badges
          wsSync.notifyLeadsUpdated(trackingInfo.user_id, {
            leadId: trackingInfo.lead_id,
            action: event.type === 'open' ? 'email_opened' : 'email_clicked'
          });

          // Notify messages update to refresh the message thread instantly
          wsSync.notifyMessagesUpdated(trackingInfo.user_id, {
            leadId: trackingInfo.lead_id,
            action: event.type === 'open' ? 'email_opened' : 'email_clicked'
          });
        } catch (err) {
          console.error('Failed to update lead/message metadata for tracking event:', err);
        }
      }

      // Notify activity feed with integrationId for mailbox-specific updates
      wsSync.notifyActivityUpdated(trackingInfo.user_id, {
        type: event.type === 'open' ? 'email_opened' : 'email_clicked',
        leadId: trackingInfo.lead_id,
        integrationId: trackingInfo.integration_id,
        details: {
          email: trackingInfo.recipient_email,
          subject: trackingInfo.subject,
          link: event.linkUrl,
          timestamp: event.timestamp
        }
      });

      // Also trigger a generic notification toast
      if (trackingInfo.lead_id) {
        wsSync.notifyNotification(trackingInfo.user_id, {
          type: 'lead_activity',
          title: event.type === 'open' ? '⚡ Email Opened' : '🔗 Link Clicked',
          message: `${trackingInfo.recipient_email} ${event.type === 'open' ? 'opened your email' : 'clicked a link'}: "${trackingInfo.subject}"`,
          leadId: trackingInfo.lead_id,
          integrationId: trackingInfo.integration_id
        });
      }

      // Instant Stats Refresh for Dashboard
      wsSync.notifyStatsUpdated(trackingInfo.user_id, { 
        integrationId: trackingInfo.integration_id,
        type: event.type 
      });
    }

  } catch (error) {
    console.error('Failed to record email event:', error);
  }
}

export async function getEmailStats(userId: string, days: number = 30, integrationId?: string): Promise<{
  sent: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
}> {
  try {
    const boundedDays = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 3650) : 30;
    const whereClause = integrationId 
      ? sql`WHERE user_id = ${userId} AND integration_id = ${integrationId}`
      : sql`WHERE user_id = ${userId}`;

    const result = await db.execute(sql`
      SELECT 
        COUNT(*) as sent,
        COUNT(CASE WHEN open_count > 0 THEN 1 END) as opened,
        COUNT(CASE WHEN click_count > 0 THEN 1 END) as clicked
      FROM email_tracking
      ${whereClause}
      AND sent_at > NOW() - (${boundedDays} * INTERVAL '1 day')
    `);

    const row = result.rows[0] as { sent: string; opened: string; clicked: string } | undefined;
    const sent = parseInt(row?.sent || '0');
    const opened = parseInt(row?.opened || '0');
    const clicked = parseInt(row?.clicked || '0');

    return {
      sent,
      opened,
      clicked,
      openRate: sent > 0 ? (opened / sent) * 100 : 0,
      clickRate: sent > 0 ? (clicked / sent) * 100 : 0,
    };
  } catch (error) {
    console.error('Failed to get email stats:', error);
    return { sent: 0, opened: 0, clicked: 0, openRate: 0, clickRate: 0 };
  }
}

export async function injectTrackingIntoEmail(html: string, token: string): Promise<{ html: string; urls: string[] }> {
  const baseUrl = (globalThis as any).process?.env?.BASE_URL || 'https://audnixai.com';

  const { html: trackedHtml, urls } = await wrapLinksWithTracking(html, baseUrl, token);

  const trackingPixel = generateTrackingPixel(baseUrl, token);

  let finalHtml = trackedHtml;
  if (finalHtml.includes('</body>')) {
    finalHtml = finalHtml.replace('</body>', `${trackingPixel}</body>`);
  } else {
    finalHtml += trackingPixel;
  }

  return { html: finalHtml, urls };
}





