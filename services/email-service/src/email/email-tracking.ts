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
  senderEmail?: string;
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
  // Use a stealth tracking path that looks like a normal image/redirect URL
  // instead of the obvious /api/email-tracking/track/open/ path.
  // The short /t/{token} path blends in as a generic URL shortener redirect.
  return `<img src="${baseUrl}/t/${token}" width="1" height="1" alt="" />`;
}

export async function wrapLinksWithTracking(html: string, baseUrl: string, messageToken: string): Promise<{ html: string; urls: string[] }> {
  const isDocument = html.toLowerCase().includes('<html');
  const { load } = await import('cheerio');
  const $ = load(html);
  const urls: string[] = [];

  $('a').each((_: any, el: any) => {
    const $el = $(el);
    const href = $el.attr('href');
    // Skip already-tracked links and non-web links
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (href.includes('/api/email/track/') || href.includes('/api/email-tracking/track/') || href.includes('/api/outreach/click/')) return;
    if (href.includes('/t/') || href.includes('/c/')) return; // skip already-stealth-tracked

    urls.push(href);
    const encodedUrl = encodeURIComponent(href);
    // Stealth click path: /c/{token} instead of /api/email-tracking/track/click/{token}
    const trackingUrl = `${baseUrl}/c/${messageToken}?url=${encodedUrl}`;
    $el.attr('href', trackingUrl);
  });

  const outputHtml = isDocument ? $.html() : ($('body').html() || $.html());
  return { html: outputHtml, urls };
}

export function wrapPlainTextLinksWithTracking(text: string, baseUrl: string, messageToken: string): string {
  // Simple regex for HTTP/HTTPS URLs
  const urlRegex = /(?<!["'])(https?:\/\/[^\s<]+)/gi;

  return text.replace(urlRegex, (url: string) => {
    if (url.includes('/api/email-tracking/track/') || url.includes('/c/') || url.includes('/t/')) {
      return url;
    }

    const encodedUrl = encodeURIComponent(url);
    return `${baseUrl}/c/${messageToken}?url=${encodedUrl}`;
  });
}

export async function createTrackedEmail(data: EmailTrackingData): Promise<{ token: string; pixelHtml: string }> {
  // Use the provided messageId as the token if available, so callers can
  // store the same value in campaign_emails.message_id and correlate events.
  // If no messageId is provided, generate a new tracking token.
  const token = data.messageId || generateTrackingToken();
  // Always use APP domain for tracking — never sender's domain (tracking server only runs on app domain)
  const baseUrl = (globalThis as any).process?.env?.PUBLIC_URL
    || (globalThis as any).process?.env?.BASE_URL
    || 'https://audnixai.com';

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
    // RE-THROW: Callers must know tracking record creation failed.
    // Returning a token without a persisted DB record means open/click events
    // will silently fail with no stats or notifications.
    throw new Error(`Failed to create tracking record: ${(error as Error).message}`);
  }

  const pixelHtml = generateTrackingPixel(baseUrl, token);
  return { token, pixelHtml };
}

export async function recordEmailEvent(event: EmailEvent): Promise<void> {
  try {
    // Filter out automated email security scanners and bots from marking emails as "opened"
    const ua = (event.userAgent || '').toLowerCase();
    const isBotOrScanner = event.type === 'open' && (
      ua.includes('googleimageproxy') ||
      ua.includes('googlesafety') ||
      ua.includes('googlecloud') ||
      ua.includes('microsoft office') ||
      ua.includes('outlook-ios') ||
      ua.includes('applebot') ||
      ua.includes('yahooseeker') ||
      ua.includes('barracuda') ||
      ua.includes('proofpoint') ||
      ua.includes('mimecast') ||
      ua.includes('symantec') ||
      ua.includes('spamassassin') ||
      ua.includes('trendmicro') ||
      ua.includes('kaspersky') ||
      ua.includes('mcafee') ||
      ua.includes('forcepoint') ||
      ua.includes('zscaler') ||
      ua.includes('cisco') ||
      ua.includes('fireeye') ||
      ua.includes('f-secure') ||
      ua.includes('checkpoint') ||
      ua.includes('fortinet') ||
      ua.includes('virustotal') ||
      ua.includes('urlscan') ||
      ua.includes('cloudflare') ||
      ua.includes('threat') ||
      ua.includes('phish') ||
      ua.includes('abuse') ||
      ua.includes('mailscanner') ||
      ua.includes('bot') ||
      ua.includes('crawler') ||
      ua.includes('spider') ||
      ua.includes('scan')
    );

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

    // Get userId and lead_id to notify
    const trackResult = await db.execute(sql`
      SELECT user_id, lead_id, integration_id, recipient_email, subject 
      FROM email_tracking 
      WHERE token = ${event.messageId}
    `);

    const trackingInfo = trackResult.rows[0] as any;

    // If it's an email security scanner bot, record delivery placement update but DO NOT mark as opened
    if (isBotOrScanner) {
      if (trackingInfo) {
        const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
        // Update placement to inbox (scanner loaded pixel = delivered to inbox)
        await db.execute(sql`
          UPDATE email_tracking 
          SET placement = CASE WHEN placement IN ('unknown', 'delivered') THEN 'inbox' ELSE placement END,
              placement_updated_at = COALESCE(placement_updated_at, ${event.timestamp.toISOString()})
          WHERE token = ${event.messageId}
        `).catch(() => {});
        
        await clusterSync.notifyDeliverabilityUpdated(trackingInfo.user_id, {
          integrationId: trackingInfo.integration_id,
          placement: 'inbox',
          source: 'security_scanner_proxy'
        });
      }
      return;
    }

    // FIRE SOCKET EVENTS FIRST — instant UI update before DB writes
    const socketPromises: Promise<any>[] = [];
    if (trackingInfo) {
      const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');

      if (trackingInfo.lead_id) {
        socketPromises.push(
          clusterSync.notifyLeadsUpdated(trackingInfo.user_id, {
            leadId: trackingInfo.lead_id,
            action: event.type === 'open' ? 'email_opened' : 'email_clicked'
          }),
          clusterSync.notifyMessagesUpdated(trackingInfo.user_id, {
            leadId: trackingInfo.lead_id,
            action: event.type === 'open' ? 'email_opened' : 'email_clicked'
          })
        );
      }

      socketPromises.push(
        clusterSync.notifyActivityUpdated(trackingInfo.user_id, {
          type: event.type === 'open' ? 'email_opened' : 'email_clicked',
          leadId: trackingInfo.lead_id,
          integrationId: trackingInfo.integration_id,
          details: {
            email: trackingInfo.recipient_email,
            subject: trackingInfo.subject,
            link: event.linkUrl,
            timestamp: event.timestamp
          }
        })
      );

      if (trackingInfo.lead_id && event.type === 'click') {
        socketPromises.push(
          clusterSync.notifyNotification(trackingInfo.user_id, {
            type: 'lead_activity',
            title: 'Link Clicked',
            message: `${trackingInfo.recipient_email} clicked a link in "${trackingInfo.subject}"`,
            leadId: trackingInfo.lead_id,
            integrationId: trackingInfo.integration_id
          })
        );
      }

      socketPromises.push(
        clusterSync.notifyStatsUpdated(trackingInfo.user_id, { 
          integrationId: trackingInfo.integration_id,
          type: event.type 
        }),
        clusterSync.notifyStatsCacheInvalidate(trackingInfo.user_id)
      );

      // Push placement update to deliverability page on first open
      // (Spam doesn't load images, so an open = inbox delivery)
      if (event.type === 'open') {
        socketPromises.push(
          clusterSync.notifyDeliverabilityUpdated(trackingInfo.user_id, {
            integrationId: trackingInfo.integration_id,
            placement: 'inbox',
            source: 'tracking_pixel'
          })
        );
      }

      // Fire all socket notifications in parallel, don't block DB writes
      Promise.all(socketPromises).catch(err =>
        console.error('Failed to fire tracking socket events:', err)
      );
    }

    // DB writes — update tracking counters
    if (event.type === 'open') {
      await db.execute(sql`
        UPDATE email_tracking 
        SET first_opened_at = COALESCE(first_opened_at, ${event.timestamp.toISOString()}),
            open_count = COALESCE(open_count, 0) + 1,
            placement = CASE WHEN placement IN ('unknown', 'delivered') THEN 'inbox' ELSE placement END,
            placement_updated_at = COALESCE(placement_updated_at, ${event.timestamp.toISOString()})
        WHERE token = ${event.messageId}
      `).catch(async (sqlErr: any) => {
        if (sqlErr?.message?.includes('placement_updated_at')) {
          await db.execute(sql`
            UPDATE email_tracking 
            SET first_opened_at = COALESCE(first_opened_at, ${event.timestamp.toISOString()}),
                open_count = COALESCE(open_count, 0) + 1,
                placement = CASE WHEN placement IN ('unknown', 'delivered') THEN 'inbox' ELSE placement END
            WHERE token = ${event.messageId}
          `);
        } else {
          throw sqlErr;
        }
      });
    } else if (event.type === 'click') {
      await db.execute(sql`
        UPDATE email_tracking 
        SET first_clicked_at = COALESCE(first_clicked_at, ${event.timestamp.toISOString()}),
            click_count = COALESCE(click_count, 0) + 1
        WHERE token = ${event.messageId}
      `);
    }

    // Update lead/message/campaign metadata
    if (trackingInfo?.lead_id) {
      try {
        if (event.type === 'open') {
          await db.execute(sql`
            UPDATE leads 
            SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{isOpened}', 'true'::jsonb),
                status = CASE WHEN status IN ('new', 'open') THEN 'opened'::text ELSE status END,
                updated_at = NOW()
            WHERE id = ${trackingInfo.lead_id}
          `);

          await db.execute(sql`
            UPDATE messages
            SET opened_at = COALESCE(opened_at, ${event.timestamp.toISOString()}),
                is_read = true
            WHERE tracking_id = ${event.messageId}
          `);

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

          await db.execute(sql`
            UPDATE messages
            SET clicked_at = COALESCE(clicked_at, ${event.timestamp.toISOString()})
            WHERE tracking_id = ${event.messageId}
          `);

          await db.execute(sql`
            UPDATE campaign_emails
            SET clicked_at = COALESCE(clicked_at, ${event.timestamp.toISOString()}),
                status = 'clicked'
            WHERE message_id = ${event.messageId}
          `);
        }
      } catch (err) {
        console.error('Failed to update lead/message metadata for tracking event:', err);
      }
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

export async function injectTrackingIntoEmail(content: string, token: string, _senderDomain?: string): Promise<{ html: string; urls: string[] }> {
  const baseUrl = (globalThis as any).process?.env?.PUBLIC_URL || (globalThis as any).process?.env?.BASE_URL || 'https://audnixai.com';

  // Check if content is HTML or plain text
  const isHtml = /<[a-z][\s\S]*>/i.test(content);

  if (isHtml) {
    const { html: trackedHtml, urls } = await wrapLinksWithTracking(content, baseUrl, token);
    const trackingPixel = generateTrackingPixel(baseUrl, token);

    let finalHtml = trackedHtml;
    if (finalHtml.includes('</body>')) {
      finalHtml = finalHtml.replace('</body>', `${trackingPixel}</body>`);
    } else {
      finalHtml += trackingPixel;
    }

    return { html: finalHtml, urls };
  } else {
    // Plain text: wrap links for tracking, then embed in minimal HTML with tracking pixel
    const trackedText = wrapPlainTextLinksWithTracking(content, baseUrl, token);
    const trackingPixel = generateTrackingPixel(baseUrl, token);

    const finalHtml = `<!DOCTYPE html>
<html>
<body>
  <div style="white-space: pre-wrap; font-family: sans-serif; line-height: 1.5;">
${trackedText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}
  </div>
  ${trackingPixel}
</body>
</html>`;

    // Extract URLs from the plain text for analytics
    const urlRegex = /https?:\/\/[^\s<>"']+/gi;
    const matchingUrls = [...content.matchAll(urlRegex)].map(m => m[0]).filter(u =>
      !u.includes('/api/email-tracking/track/')
    );

    return { html: finalHtml, urls: matchingUrls };
  }
}





