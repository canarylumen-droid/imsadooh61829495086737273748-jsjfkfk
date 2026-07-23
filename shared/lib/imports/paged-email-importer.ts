import { db } from '@shared/lib/db/db.js';
import { leads as leadsTable, emailReplyStore, campaignEmails, outreachCampaigns, campaignLeads } from '@audnix/shared';
import { storage } from '@shared/lib/storage/storage.js';
import pLimit from 'p-limit';
import { analyzeInboundMessage } from '@services/brain-worker/src/ai-lib/analyzers/inbound-message-analyzer.js';
import { eq, and, or, sql, desc } from 'drizzle-orm';

/**
 * Paged email importer - prevents timeout and memory issues
 * Imports 100 emails at a time with background queue processing
 */

export async function pagedEmailImport(
  userId: string,
  emails: any[],
  onProgress?: (progress: number) => void,
  direction: 'inbound' | 'outbound' = 'inbound'
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const results = { imported: 0, skipped: 0, errors: [] as string[] };
  const limit = pLimit(5); // Process 5 emails in parallel

  try {
    const totalPages = Math.ceil(emails.length / 100);

    for (let page = 0; page < totalPages; page++) {
      const start = page * 100;
      const end = start + 100;
      const pageEmails = emails.slice(start, end);

      const tasks = pageEmails.map(email =>
        limit(() => processEmailForLead(userId, email, results, direction))
      );

      await Promise.all(tasks);

      // Report progress
      const progress = Math.round(((page + 1) / totalPages) * 100);
      onProgress?.(progress);

      // Small delay between pages to avoid overwhelming DB
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error('Email import error:', error);
    results.errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return results;
}

/**
 * Smart lead creation - only create leads for non-transactional emails
 * Uses heuristics to detect if email is from a real prospect
 */
async function processEmailForLead(
  userId: string,
  email: any,
  results: any,
  direction: 'inbound' | 'outbound' = 'inbound'
): Promise<void> {
  try {
    // ── HISTORICAL EMAIL GATE ─────────────────────────────────────────────────
    // Emails that pre-date the integration connection are none of the app's
    // business. We resolve the integration once here and bail out early so
    // nothing downstream (lead creation, message storage, notifications, AI)
    // ever touches them.
    const integration = email.integrationId ? await storage.getIntegrationById(email.integrationId) : null;
    const emailDate = new Date(email.date);
    const integrationCreatedAt = integration ? new Date(integration.createdAt) : null;
    const isHistorical = integrationCreatedAt ? emailDate.getTime() < integrationCreatedAt.getTime() : false;

    if (isHistorical) {
      results.skipped++;
      return;
    }

    // Skip warmup emails (defensive — should have been filtered upstream by IMAP idle)
    if (email.isWarmup || (email.headers && (
      (email.headers.get && email.headers.get('x-audnix-warmup')) ||
      email.headers['x-audnix-warmup']
    ))) {
      results.skipped++;
      return;
    }

    // ── BOUNCE DSN DETECTION ─────────────────────────────────────────────────
    // Run BEFORE transactional/spam filters so mailer-daemon bounces are caught.
    if (direction === 'inbound') {
      await handleBounceDSN(userId, email);
    }

    // Skip if email is transactional (only for inbound)
    if (direction === 'inbound' && isTransactionalEmail(email)) {
      results.skipped++;
      return;
    }

    // Skip if spam/newsletter (only for inbound)
    if (direction === 'inbound' && isSpamOrNewsletter(email)) {
      results.skipped++;
      return;
    }

    const emailAddress = direction === 'inbound' ? email.from : email.to; // For outbound, we care who we sent TO
    console.log(`[DEBUG] Processing ${direction} email: ${emailAddress} - Subject: ${email.subject} - Message-ID: ${email.messageId}`);

    // [DEDUPLICATION] check by messageId if available
    if (email.messageId) {
      const existingEmail = await storage.getEmailMessageByMessageId(email.messageId);
      if (existingEmail) {
        results.skipped++;
        return;
      }
    }

    // [ROBUST LOOKUP] Use direct DB query for case-insensitive email matching
    const leads = await db
      .select()
      .from(leadsTable)
      .where(and(
        eq(leadsTable.userId, userId),
        sql`LOWER(${leadsTable.email}) = ${emailAddress.toLowerCase()}`
      ))
      .limit(1);

    let lead = leads[0];
    console.log('[DEBUG] Lead lookup result:', lead ? `Found ${lead.id}` : 'Not found');

    if (!lead) {
      const user = await storage.getUserById(userId);
      const userConfig = (user?.config as any) || {};
      const discoverInboundLeads = userConfig.discoverInboundLeads !== false;

      if (!discoverInboundLeads && direction === 'inbound') {
        console.log(`[EMAIL_IMPORT] Skipping email from unknown contact because Inbound Lead Discovery is disabled: ${emailAddress}`);
        results.skipped++;
        return;
      }

      // Create lead for both inbound discovery and outbound intentional outreach
      lead = await storage.createLead({
        userId,
        name: extractNameFromEmail(emailAddress),
        email: emailAddress,
        channel: 'email',
        status: 'new',
        score: 0,
        metadata: {
          firstEmailDate: email.date,
          imported: true,
          discovery_source: direction === 'inbound' ? 'inbound_import' : 'outbound_outreach'
        }
      });
      console.log(`[DEBUG] Created new lead for ${direction} email: ${emailAddress}`);
    }

    // Check if message already exists to avoid duplicates
    // This is expensive unless we track message IDs.
    // We can filter by timestamp roughly or hash.
    // Or just reliance on recent 50 fetch limit and hope?
    // Proper way: Store external_id in messages table.
    // Drizzle schema likely doesn't have external_id on messages yet?
    // Let's check schema.ts later. For now, we risk duplicates if we keep importing.
    // We should check if a message with same Body + Date exists for this lead.

    const existingMessages = await storage.getMessages(lead.id);
    const existingMessage = existingMessages.find(m =>
      (m.externalId && email.messageId && m.externalId === email.messageId) ||
      (Math.abs(new Date(m.createdAt).getTime() - new Date(email.date).getTime()) < 2000 &&
      m.body === (email.text || email.html || ''))
    );

    if (existingMessage) {
      // If message exists, check if isRead status changed
      if (email.isRead !== undefined && existingMessage.isRead !== email.isRead) {
        await storage.updateMessage(existingMessage.id, { isRead: email.isRead });
        results.imported++; // Count as dynamic update

        // Notify UI of read status change
        try {
          const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
          wsSync.notifyMessagesUpdated(userId, {
            type: 'UPDATE',
            messageId: existingMessage.id,
            event: 'read_status_changed',
            isRead: email.isRead
          });
        } catch (wsError) { }
      } else {
        results.skipped++;
      }
      return;
    }

    // Resolve internal Thread ID
    const thread = await storage.getOrCreateThread(userId, lead.id, email.subject || 'No Subject', email.threadId);
    const threadId = (thread as any).id;

    // Create Message
    const newMessage = await storage.createMessage({
      userId,
      leadId: lead.id,
      threadId,
      direction,
      body: email.text || email.html || '', // Prefer text, fallback html
      provider: 'email',
      isRead: email.isRead || direction === 'outbound', // Sent emails are usually considered read
      externalId: email.messageId || undefined,
      uid: email.uid,
      integrationId: email.integrationId,
      metadata: {
        subject: email.subject,
        html: email.html, // Store full HTML in metadata if needed
        from: email.from,
        to: email.to,
        date: email.date,
        providerThreadId: email.threadId
      }
    });

    // PERMANENT STORAGE: Also store in email_messages table
    try {
      await storage.createEmailMessage({
        userId,
        leadId: lead.id,
        messageId: email.messageId || `msg_${Date.now()}_${Math.random()}`,
        threadId: email.threadId || threadId, // Store provider thread ID if available, otherwise internal UUID
        subject: email.subject,
        from: email.from || '',
        to: email.to || '',
        body: email.text || '',
        htmlBody: email.html,
        direction,
        provider: 'custom_email',
        uid: email.uid,
        integrationId: email.integrationId,
        sentAt: email.date || new Date(),
        metadata: {
          internalThreadId: threadId
        }
      });
    } catch (e) {
      // Ignore duplicates
    }

    // Notify UI of new message and potentially lead status change via Redis pub/sub (works cross-process)
    try {
      const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');

      clusterSync.notifyMessagesUpdated(userId, {
        type: 'INSERT',
        event: 'INSERT',
        messageId: (newMessage as any).id,
        direction
      });

      clusterSync.notifyLeadsUpdated(userId, {
        leadId: lead.id,
        action: direction === 'inbound' ? 'message_received' : 'message_sent'
      });

      if (direction === 'inbound') {
        // Create actual notification for inbound replies (never for historical)
        try {
          await storage.createNotification({
            userId,
            type: 'inbound_email',
            title: 'New Reply Received',
            message: `From ${email.from || lead.email}: "${email.subject}"`,
            metadata: {
              leadId: lead.id,
              threadId: threadId,
              messageId: (newMessage as any).id
            }
          });

          clusterSync.notifyNotification(userId, {
            type: 'lead_activity',
            title: 'New Reply Received',
            message: `${email.from || lead.email} replied to your outreach.`,
            leadId: lead.id,
            playSound: true
          });
        } catch (notifErr) {
          console.error('[Email Import] Notification failed:', notifErr);
        }
        clusterSync.notifyActivityUpdated(userId, {
          type: 'email_received',
          leadId: lead.id,
          messageId: (newMessage as any).id
        });
      } else {
        clusterSync.notifyActivityUpdated(userId, {
          type: 'email_sent',
          leadId: lead.id,
          messageId: (newMessage as any).id
        });
      }
    } catch (wsError) { }

    // Update last message time on lead
    if (new Date(email.date) > new Date(lead.lastMessageAt || 0)) {
      await storage.updateLead(lead.id, { lastMessageAt: new Date(email.date) });
    }

    results.imported++;

    // AUTO-REPLY TRIGGER & CAMPAIGN MANAGEMENT
    let aiShouldWait = false; // Flag to determine if AI should hold off
    let fullAnalysis: any = { intent: { score: 0, label: 'nurture' }, urgencyLevel: 0, qualityScore: 0 };
    let isNegativeIntent = false;
    let isPositiveIntent = false;
    let globalAutoReplyBody: string | null = null;

    if (direction === 'inbound') {
      try {
        // 0. Fetch Global Auto Reply Body
        try {
          const userObj = await storage.getUserById(userId);
          globalAutoReplyBody = (userObj?.config as any)?.autoReplyBody || null;
        } catch (e) { console.warn('[PagedEmailImporter] Failed to fetch global auto-reply body:', (e as Error)?.message); }

        // 1. Run full inbound message analysis FIRST
        const messageForAnalysis = {
          ...newMessage,
          id: (newMessage as any).id,
          body: email.text || email.html || ''
        };

        try {
          fullAnalysis = await analyzeInboundMessage(lead.id, messageForAnalysis as any, lead as any);
          console.log(`[EMAIL_IMPORT] Full inbound analysis for ${lead.email}: urgency=${fullAnalysis.urgencyLevel}, quality=${fullAnalysis.qualityScore}`);

          // --- PHASE 18: INTELLIGENCE WIRING ---
          
          // 1. Competitor Detection
          try {
            const { detectCompetitorMention, trackCompetitorMention } = await import('@services/brain-worker/src/ai-lib/analyzers/competitor-detection.js');
            const compResult = await detectCompetitorMention(messageForAnalysis.body);
            if (compResult.detected) {
              console.log(`[EMAIL_IMPORT] 🎯 Competitor detected: ${compResult.competitor}`);
              await trackCompetitorMention(userId, lead.id, compResult.competitor, compResult.context, compResult.sentiment);
              // Inject into analysis for follow-up context
              (fullAnalysis as any).competitorData = compResult;
            }
          } catch (compErr) {
            console.error('[EMAIL_IMPORT] Competitor detection failed:', compErr);
          }

          // 2. Price Negotiation
          try {
            const { detectPriceObjection } = await import('@services/brain-worker/src/ai-lib/specialized/price-negotiation.js');
            const priceResult = await detectPriceObjection(messageForAnalysis.body);
            if (priceResult.detected) {
              console.log(`[EMAIL_IMPORT] 💰 Price objection detected (Severity: ${priceResult.severity})`);
              // Inject into analysis for follow-up context
              (fullAnalysis as any).priceObjection = priceResult;
            }
          } catch (priceErr) {
            console.error('[EMAIL_IMPORT] Price objection detection failed:', priceErr);
          }

          isNegativeIntent = fullAnalysis.intent?.label === 'negative' || 
                             fullAnalysis.intent?.label === 'unsubscribe' || 
                             fullAnalysis.qualityScore < 30;

          isPositiveIntent = fullAnalysis.intent?.readyToBuy === true ||
                             fullAnalysis.intent?.wantsToSchedule === true ||
                             fullAnalysis.deepIntent?.intentLevel === "high";

          // Phase 11: Trigger Intelligence-governed Automation Rules
          const { AutomationRuleEngine } = await import('../automation/rule-engine.js');
          await AutomationRuleEngine.processEvent(userId, lead.id, {
            channel: 'email',
            intentScore: fullAnalysis.qualityScore,
            confidence: (fullAnalysis.intent as any)?.confidence || 0.8,
            messageBody: email.text || email.html || '',
            messageId: (newMessage as any).id
          });
        } catch (analysisError) {
          console.error('[EMAIL_IMPORT] Inbound message analysis error:', analysisError);
        }

        // 2. MARK CAMPAIGN AS REPLIED: Stop follow-ups if lead replied
        // We do this immediately upon receiving an inbound message from a lead
        let linkedCampaignId: string | null = null;
        try {
          const { campaignLeads, outreachCampaigns } = await import('@audnix/shared');
          const { db } = await import('@shared/lib/db/db.js');
          const { eq, and, or, sql, desc } = await import('drizzle-orm');

          // DEEP LINKING: Try to find campaign via inReplyTo header
          if (email.inReplyTo) {
            const parentEmail = await storage.getEmailMessageByMessageId(email.inReplyTo);
            if (parentEmail?.campaignId) {
              linkedCampaignId = parentEmail.campaignId;
              console.log(`[EMAIL_IMPORT] Deep linked inbound reply to campaign ${linkedCampaignId} via In-Reply-To: ${email.inReplyTo}`);
            }
          }

          // Find the campaign lead entry (preferably the one linked, otherwise any active 'sent'/'pending' one)
          const campaignLeadEntries = await db.select()
            .from(campaignLeads)
            .where(
              and(
                eq(campaignLeads.leadId, lead.id),
                linkedCampaignId ? eq(campaignLeads.campaignId, linkedCampaignId) : or(eq(campaignLeads.status, 'sent'), eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'replied'))
              )
            )
            .orderBy(desc(campaignLeads.createdAt))
            .limit(1);

          if (campaignLeadEntries.length > 0) {
            const entry = campaignLeadEntries[0];
            
            // Fetch the campaign to see if it has an auto-reply configured
            const campaigns = await db.select()
              .from(outreachCampaigns)
              .where(eq(outreachCampaigns.id, entry.campaignId))
              .limit(1);
            
            const activeCampaign = campaigns.length > 0 ? campaigns[0] : null;
            const hasCampaignAutoReply = activeCampaign ? !!(activeCampaign.template as any)?.autoReplyBody : false;

            const isFirstReply = entry.status !== 'replied';

            if (isFirstReply) {
                // First time replying to this campaign sequence.
                const randomDelayMinutes = 2 + Math.random() * 2; // 2-4 minutes
                const nextActionAt = new Date(Date.now() + randomDelayMinutes * 60 * 1000);
                
                // If it has a campaign auto reply, trigger it. 
                // AI should wait during this!
                let pendingAutoReply = hasCampaignAutoReply;
                
                // BUG A4 FIX: Skip campaign auto-reply if intent is negative
                if (pendingAutoReply && isNegativeIntent) {
                  console.log(`[EMAIL_IMPORT] Skipping campaign auto-reply due to negative AI intent: ${fullAnalysis.intent?.label}`);
                  pendingAutoReply = false;
                }
                
                // Skip campaign auto-reply if intent is positive (human hand-off required)
                if (pendingAutoReply && isPositiveIntent) {
                  console.log(`[EMAIL_IMPORT] Skipping campaign auto-reply due to positive AI intent`);
                  pendingAutoReply = false;
                }
                
                if (pendingAutoReply) {
                    aiShouldWait = true;
                }

                await db.update(campaignLeads)
                  .set({
                    status: 'replied',
                    ...(pendingAutoReply ? { nextActionAt } : {}), // only update nextActionAt if we are queuing an auto-reply
                    metadata: {
                      ...(entry.metadata as Record<string, any> || {}),
                      ...(pendingAutoReply ? { pendingAutoReply: true } : {})
                    }
                  })
                  .where(eq(campaignLeads.id, entry.id));

                console.log(`[EMAIL_IMPORT] Lead ${lead.email} marked as 'replied' in campaign ${entry.campaignId}. pendingAutoReply: ${pendingAutoReply}`);

                // --- PHASE 18: AI LEARNING LOOP ---
                try {
                  const { learningEngine } = await import('@services/brain-worker/src/ai-lib/engines/learning-engine.js');
                  // We don't await this as it's an background optimization task
                  learningEngine.extractWinningPattern(userId, lead.id, entry.campaignId).catch(err => console.warn('[PagedEmailImporter] Pattern extraction failed:', err.message));
                } catch (learnErr) {
                  // Non-critical
                }

                // Schedule BullMQ auto-reply job for autonomous processing
                if (pendingAutoReply) {
                  try {
                    const { campaignQueueManager } = await import('../queues/campaign-queue.js');
                    await campaignQueueManager.scheduleAutoReply(
                      entry.campaignId,
                      userId,
                      entry.id,
                      entry.integrationId || '',
                      lead.id
                    );
                  } catch (queueErr) {
                    // Non-critical: fallback to polling if BullMQ unavailable
                  }
                }

                // NEW: Increment replied stat in outreachCampaigns
                await db.update(outreachCampaigns)
                  .set({
                    stats: sql`jsonb_set(stats, '{replied}', (COALESCE((stats->>'replied')::int, 0) + 1)::text::jsonb)`,
                    updatedAt: new Date()
                  })
                  .where(eq(outreachCampaigns.id, entry.campaignId));
            } else {
                // Lead has already replied previously. Let AI take over because campaign is "done".
                aiShouldWait = false; 
                console.log(`[EMAIL_IMPORT] Lead ${lead.email} replied AGAIN. AI taking over.`);
            }

            // UNIFIED TRACKING: Record reply in tracking engine for global KPIs
            try {
              const { TrackingEngine } = await import('@services/email-service/src/email/tracking-engine.js');
              await TrackingEngine.recordReply(lead.id, email.text || email.html || '');
            } catch (trackErr) {
              console.error('[EMAIL_IMPORT] Failed to record reply in TrackingEngine:', trackErr);
            }

            // Real-time notification and audit log
            try {
              const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
              wsSync.notifyActivityUpdated(userId, {
                type: 'email_reply',
                leadId: lead.id,
                campaignId: entry.campaignId
              });

              // Notify frontend with full lead object to trigger toasts
              wsSync.notifyLeadsUpdated(userId, { event: 'INSERT', lead: lead });

              await storage.createAuditLog({
                userId,
                leadId: lead.id,
                integrationId: entry.integrationId || '',
                action: 'lead_reply',
                details: {
                  message: `Received email reply from ${lead.name}`,
                  campaignId: entry.campaignId,
                  channel: 'email'
                }
              });

              // Create persistent notification
              await storage.createNotification({
                userId,
                type: 'lead_reply',
                title: '📩 New Reply Received',
                message: `${lead.name} replied to your outreach.`,
                actionUrl: `/dashboard/inbox?leadId=${lead.id}`
              });
            } catch (notifyErr) {
              console.error('Failed to notify reply activity:', notifyErr);
            }

            // Log to emailReplyStore
            try {
              const { emailReplyStore } = await import('@audnix/shared');
              await db.insert(emailReplyStore).values({
                messageId: email.messageId || `reply_${Date.now()}_${Math.random()}`,
                inReplyTo: email.inReplyTo || '',
                campaignId: entry.campaignId,
                leadId: lead.id,
                userId: userId,
                fromAddress: email.from || '',
                subject: email.subject,
                body: email.text || '',
                receivedAt: email.date || new Date()
              });
            } catch (replyLogErr) { }

          }
        } catch (campaignStatusError) {
          console.warn('[EMAIL_IMPORT] Failed to update campaign status:', campaignStatusError);
        }

        // Reload lead to get latest status and aiPaused after analyzer/sequence-killer updates
        const freshLead = await storage.getLeadById(lead.id);
        if (freshLead) {
          lead = freshLead;
        }

        // Check if we should auto-reply (lead not paused, not recently replied)
        const existingOutbound = existingMessages.filter(m => m.direction === 'outbound');
        const lastOutbound = existingOutbound[existingOutbound.length - 1];
        const hoursSinceLastOutbound = lastOutbound
          ? (Date.now() - new Date(lastOutbound.createdAt).getTime()) / (1000 * 60 * 60)
          : Infinity;


        // Only auto-reply if:
        // 1. Lead doesn't have AI paused
        // 2. We haven't replied in the last 2 hours (avoid rapid back-and-forth)
        // 3. Lead is not converted, not_interested, qualified, warm, or booked
        // 4. Email is RECENT (within last 1 hour) - SAFETY CHECK for imports
        // 5. The campaign is not currently handling the auto-reply (!aiShouldWait)
        // 6. No positive intent was detected
        const isRecent = new Date(email.date).getTime() > Date.now() - 1000 * 60 * 60;

        if (!lead.aiPaused &&
          hoursSinceLastOutbound > 2 &&
          !['converted', 'not_interested', 'qualified', 'warm', 'booked'].includes(lead.status) &&
          !isPositiveIntent &&
          isRecent &&
          !isHistorical &&
          !aiShouldWait) {

          // Schedule QUICK follow-up (2-4 minutes like Instagram DMs)
          // This is different from initial outreach which uses 2-4 hours
          const { db: followUpDb } = await import('@shared/lib/db/db.js');
          const { followUpQueue } = await import('@audnix/shared');

          if (followUpDb) {
            const quickDelay = (2 + Math.random() * 2) * 60 * 1000; // 2-4 minutes random delay
            const scheduledTime = new Date(Date.now() + quickDelay);

            await followUpDb.insert(followUpQueue).values({
              userId,
              leadId: lead.id,
              channel: 'email',
              scheduledAt: scheduledTime,
              context: {
                follow_up_number: existingOutbound.length + 1,
                source: 'inbound_reply',
                temperature: 'hot', // Inbound emails are hot leads
                campaign_day: 0,
                sequence_number: 1,
                inbound_message: email.text?.substring(0, 200) || email.html?.substring(0, 200) || '',
                quick_reply: true,
                customAutoReply: globalAutoReplyBody
              }
            });

            console.log(`🤖 [EMAIL_IMPORT] Quick AI auto-reply queued for inbound email from ${lead.name} (${Math.round(quickDelay / 60000)}min)`);
          }
        } else {
          console.log(`[EMAIL_IMPORT] Auto-reply SKIPPED for ${lead.email}. Reasons: Paused=${lead.aiPaused}, RecentOutbound=${hoursSinceLastOutbound < 2}, Status=${lead.status}, IsRecent=${isRecent}, aiShouldWait=${aiShouldWait}`);
        }

        // [PIPELINE ENHANCEMENT] Run deal evaluation in background to update Revenue KPIs
        const { evaluateLeadDealValue } = await import("@services/brain-worker/src/ai-lib/engines/deal-evaluator.js");
        evaluateLeadDealValue(userId, lead.id).catch(err => 
          console.error(`[EMAIL_IMPORT] Background deal evaluation failed for lead ${lead.id}:`, err)
        );
      } catch (autoReplyError) {
        console.warn('Auto-reply scheduling failed (non-critical):', autoReplyError);
      }
    }
  } catch (error) {
    console.error('Error processing email:', error);
  }
}

/**
 * Detect if email is transactional (receipts, alerts, notifications, OTP, etc)
 */
function isTransactionalEmail(email: any): boolean {
  const transactionalKeywords = [
    // Financial (Stricter)
    'receipt', 'invoice', 'billing', 'payment',
    // Security & OTP
    'password', 'reset', 'verify', 'verification', 'otp', 'code',
    'two-factor', '2fa', 'authenticator', 'security alert', 'unusual activity',
    // System alerts
    'alert', 'notification', 'update', 'change', 'validate', 'expire',
    'security', 'urgent', 'action required', 'warning',
    // App-generated
    'no-reply', 'noreply', 'do-not-reply', 'bounced', 'undeliverable',
    'automatic', 'automated', 'no response', 'do not reply',
    // Service messages
    'signup', 'registered', 'activation', 'account created'
  ];

  const subject = (email.subject || '').toLowerCase();
  const from = (email.from || '').toLowerCase();
  const body = (email.text || '').toLowerCase().substring(0, 500); // Check first 500 chars

  // Check for OTP-specific patterns
  const otpPatterns = /\b\d{4,8}\b|otp|one-time|one time password|verification code|verify your/i;
  if (otpPatterns.test(subject) || otpPatterns.test(body)) {
    return true;
  }

  // Check email address for automation indicators
  if (from.includes('noreply') || from.includes('no-reply') || from.includes('donotreply') ||
    from.includes('automatic') || from.includes('notification') || from.includes('alert')) {
    return true;
  }

  return transactionalKeywords.some(kw =>
    subject.includes(kw) || body.includes(kw)
  );
}

/**
 * Detect if email is spam or newsletter
 */
function isSpamOrNewsletter(email: any): boolean {
  const spamKeywords = [
    'unsubscribe', 'newsletter', 'subscribe', 'marketing',
    'promotion', 'deal', 'sale', 'offer', 'discount',
    'free shipping', 'limited time', 'contact us'
  ];

  const subject = (email.subject || '').toLowerCase();
  const body = (email.text || '').toLowerCase();

  return spamKeywords.some(kw =>
    subject.includes(kw) || body.includes(kw)
  );
}

/**
 * Extract name from email address
 */
function extractNameFromEmail(emailAddress: string): string {
  try {
    const namePart = emailAddress.split('@')[0];
    return namePart
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
  } catch {
    return 'Contact';
  }
}

/**
 * Detect and handle bounce DSN (Delivery Status Notification) emails.
 * Runs BEFORE transactional/spam filters so mailer-daemon bounces are
 * linked back to the original sent email_tracking record.
 */
async function handleBounceDSN(userId: string, email: any): Promise<void> {
  const from = (email.from || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();

  // Check if this is a bounce DSN email
  const isMailerDaemon = from.includes('mailer-daemon') ||
    from.includes('postmaster') ||
    from.includes('mailerdaemon');
  const isBounceSubject = subject.includes('undeliverable') ||
    subject.includes('bounced') ||
    subject.includes('delivery failure') ||
    subject.includes('failure notice') ||
    subject.includes('returned mail') ||
    subject.includes('delivery status notification');

  if (!isMailerDaemon && !isBounceSubject) return;

  console.log(`[BounceDSN] Detected bounce DSN from ${email.from}: "${email.subject}"`);

  // Extract the original recipient from the bounce body
  const originalRecipient = extractBounceOriginalRecipient(email);

  // We know the sender of the bounce IS our user (it's their own mailbox),
  // so the user_id is known. The original_recipient is who they tried to email.
  if (!originalRecipient) {
    console.warn('[BounceDSN] Could not extract original recipient from bounce — skipping');
    return;
  }

  try {
    // Find the email_tracking record by recipient email and user
    const { db } = await import('@shared/lib/db/db.js');
    const { sql } = await import('drizzle-orm');

    const result = await db.execute(sql`
      SELECT token, id, user_id, integration_id, recipient_email, lead_id
      FROM email_tracking
      WHERE user_id = ${userId}
        AND LOWER(recipient_email) = ${originalRecipient.toLowerCase()}
        AND placement IN ('delivered', 'unknown')
        AND sent_at > NOW() - INTERVAL '7 days'
      ORDER BY sent_at DESC
      LIMIT 1
    `);

    const sentEmail = result.rows?.[0] as any;
    if (!sentEmail) {
      console.warn(`[BounceDSN] No matching email_tracking for recipient ${originalRecipient}`);
      return;
    }

    console.log(`[BounceDSN] Matched to email_tracking token=${sentEmail.token}, updating placement to 'bounced'`);

    // Update email_tracking.placement
    const bounceType = subject.includes('permanent') || subject.includes('550') ? 'hard' : 'soft';
    await db.execute(sql`
      UPDATE email_tracking
      SET placement = 'bounced',
          placement_updated_at = NOW(),
          metadata = COALESCE(metadata, '{}'::jsonb) || 
            jsonb_build_object('bounce_type', ${bounceType}, 'bounce_reason', ${(email.text || '').substring(0, 500)})
      WHERE id = ${sentEmail.id}
    `);

    // Record in bounce_handler for bounce stats
    try {
      const { bounceHandler } = await import('@services/email-service/src/email/bounce-handler.js');
      await bounceHandler.recordBounce({
        userId: sentEmail.user_id,
        leadId: sentEmail.lead_id,
        integrationId: sentEmail.integration_id,
        email: originalRecipient,
        bounceType: bounceType as any,
        reason: (email.text || email.html || '').substring(0, 500) || 'Delivery failure (DSN detected)'
      });
    } catch (bhErr) {
      console.warn('[BounceDSN] Failed to record in bounceHandler:', (bhErr as Error)?.message);
    }

    // Fire deliverability_updated + stats socket events for real-time UI
    try {
      const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
      await Promise.all([
        clusterSync.notifyDeliverabilityUpdated(userId, {
          integrationId: sentEmail.integration_id,
          placement: 'bounced',
          source: 'dsn_detection',
          email: originalRecipient
        }),
        clusterSync.notifyStatsUpdated(userId, {
          integrationId: sentEmail.integration_id,
          type: 'bounce'
        }),
        clusterSync.notifyStatsCacheInvalidate(userId)
      ]);
    } catch (socketErr) {
      console.warn('[BounceDSN] Failed to fire socket events:', (socketErr as Error)?.message);
    }
  } catch (err) {
    console.error('[BounceDSN] Error processing bounce:', (err as Error)?.message);
  }
}

/**
 * Extract the original recipient email from a bounce DSN.
 * The body contains the original email headers including the To: address.
 */
function extractBounceOriginalRecipient(email: any): string | null {
  const body = email.text || email.html || '';

  // Try to find X-Audnix-Id in the bounce body to narrow down the search
  // The original email headers are typically included in the DSN body
  // Look for patterns like "Original-Recipient:" or "Final-Recipient:"
  const originalRecipientMatch = body.match(/Original-Recipient:\s*rfc822;\s*(\S+@\S+)/i)
    || body.match(/Final-Recipient:\s*rfc822;\s*(\S+@\S+)/i);

  if (originalRecipientMatch) {
    return originalRecipientMatch[1].replace(/[<>]/g, '');
  }

  // Fallback: look for X-Audnix-Id in the body, then rely on To: parse
  // The bounce body often contains the original message headers
  // Try to find the To: header from the original message
  const toMatch = body.match(/^To:\s*(.*@.*)$/im);
  if (toMatch) {
    const addr = toMatch[1].replace(/[<>"']/g, '').trim();
    if (addr.includes('@')) return addr;
  }

  // Return the original email "to" from email_tracking perspective
  // If email has original_to field or similar
  if (email.originalTo) return email.originalTo;

  return null;
}








