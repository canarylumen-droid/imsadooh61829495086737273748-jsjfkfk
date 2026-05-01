import { generateReply } from '../core/ai-service.js';
import { MODELS } from '../utils/model-config.js';
import { storage } from '@shared/lib/storage/storage.js';
import type { Lead, Message } from '@audnix/shared';
import { db } from '@shared/lib/db/db.js';
import { notifications } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { formatDMWithButton, formatCommentReply, prepareMetaButton, type DMButton } from '../formatters/dm-formatter.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';

const isDemoMode = false;

/**
 * Detect if a comment indicates user wants a DM (link, info, etc.)
 */
export async function detectCommentIntent(comment: string): Promise<{
  wantsDM: boolean;
  intent: 'link' | 'info' | 'offer' | 'product' | 'general';
  confidence: number;
  originalMessage: string;
}> {
  if (isDemoMode) {
    const lowerComment = comment.toLowerCase();
    const wantsDM = /\b(link|dm|info|interested|send|yes)\b/.test(lowerComment);
    return {
      wantsDM,
      intent: 'link',
      confidence: 0.85,
      originalMessage: comment
    };
  }

  try {
    const prompt = `Analyze this social media comment and determine if the user wants to receive a DM with more information.

Comment: "${comment}"

Common patterns that indicate wanting a DM:
- "Link" or "link please"
- "DM me"
- "Interested"
- "Send info"
- "Yes"
- Single word responses to "comment X for [something]"

Determine:
1. Does this user want a DM? (true/false)
2. What type of content did they request? (link, info, offer, product, general)
3. Confidence level (0.0-1.0)

Return JSON only: { "wantsDM": boolean, "intent": string, "confidence": number }`;

    const response = await generateReply(
      'You are an expert at analyzing social media engagement patterns.',
      prompt,
      {
        model: MODELS.intent_classification,
        jsonMode: true,
        maxTokens: 150,
        temperature: 0.3
      }
    );

    const analysis = JSON.parse(response.text || '{}');

    return {
      wantsDM: analysis.wantsDM || false,
      intent: analysis.intent || 'general',
      confidence: analysis.confidence || 0.5,
      originalMessage: comment
    };
  } catch (error) {
    console.error('Comment detection error:', error);
    return {
      wantsDM: false,
      intent: 'general',
      confidence: 0,
      originalMessage: comment
    };
  }
}

/**
 * Generate personalized initial DM based on what they commented for
 * Now includes ManyChat-style CTA button formatting
 */
export async function generateInitialDM(
  leadName: string,
  commentIntent: {
    wantsDM: boolean;
    intent: 'link' | 'info' | 'offer' | 'product' | 'general';
    originalMessage: string;
  },
  postContext: string,
  ctaButton?: DMButton
): Promise<string> {
  if (isDemoMode) {
    const message = `Hey ${leadName}! Thanks for your interest. Here's what you asked for:`;
    if (ctaButton) {
      return formatDMWithButton(message, ctaButton);
    }
    return message;
  }

  try {
    const prompt = `Generate a friendly, personalized DM to send to someone who commented on our post.

Lead Name: ${leadName}
What they commented: "${commentIntent.originalMessage}"
Intent: ${commentIntent.intent}
Post Context: ${postContext}

Guidelines:
- Address them by name naturally (just once at the start)
- Reference what they asked for (link, info, offer, etc.)
- Be warm but professional
- Keep it under 60 words (the CTA link button will be added separately)
- Sound human, not like a bot
- If it's an offer, create light urgency ("limited spots", "early access")
- DO NOT include any links in your message - the CTA button will be added below

Generate the DM:`;

    const response = await generateReply(
      'You are a skilled digital marketer creating personalized DM responses. Never include URLs - they will be added as styled buttons.',
      prompt,
      {
        model: MODELS.intent_classification,
        maxTokens: 150,
        temperature: 0.8
      }
    );

    const aiMessage = response.text || `Hey ${leadName}! Thanks for reaching out.`;

    if (ctaButton) {
      return formatDMWithButton(aiMessage, ctaButton);
    }
    return aiMessage;
  } catch (error) {
    console.error('Initial DM generation error:', error);
    const fallback = `Hey ${leadName}! Thanks for your interest. Let me share what you asked for.`;
    if (ctaButton) {
      return formatDMWithButton(fallback, ctaButton);
    }
    return fallback;
  }
}

/**
 * Generate context-aware 6-hour follow-up that references previous messages
 */
export async function generateFollowUpDM(
  leadName: string,
  originalIntent: 'link' | 'info' | 'offer' | 'product' | 'general',
  messageOpened: boolean,
  linkClicked: boolean,
  postContext: string,
  conversationHistory?: Array<{ direction: 'inbound' | 'outbound'; body: string; createdAt: Date }>
): Promise<string> {
  if (isDemoMode) {
    return `Hey ${leadName}, just wanted to make sure you saw the ${originalIntent} I sent earlier. Still interested?`;
  }

  try {
    const engagementStatus = !messageOpened
      ? 'never opened the message'
      : linkClicked
        ? 'opened and clicked'
        : 'opened but didn\'t click the link';

    const historyContext = conversationHistory && conversationHistory.length > 0
      ? `\n\nPrevious conversation:\n${conversationHistory.slice(-5).map(m =>
        `${m.direction === 'outbound' ? 'You' : 'Lead'}: ${m.body.substring(0, 200)}`
      ).join('\n')}`
      : '';

    const prompt = `Generate a context-aware follow-up DM for someone who commented 6 hours ago.

Lead Name: ${leadName}
Original Intent: ${originalIntent}
Engagement: ${engagementStatus}
Post Context: ${postContext}${historyContext}

Guidelines:
- Use their name naturally (once at start)
- REFERENCE something specific from the previous conversation if available
- Acknowledge what you sent before (be specific if you know what it was)
- For offers: Create urgency ("might be last chance", "limited spots filling up")
- For info/links: Check if they had a chance to look at [specific thing you sent]
- For products: Soft reminder with benefit highlight
- Keep it friendly and conversational (60-80 words max)
- End with a question or gentle CTA
- Don't sound desperate or robotic
- If they already engaged, acknowledge that too

Generate the follow-up:`;

    const response = await generateReply(
      'You are a skilled sales professional creating thoughtful, context-aware follow-up messages. Always reference specific details from previous conversations when available.',
      prompt,
      {
        model: MODELS.intent_classification,
        maxTokens: 180,
        temperature: 0.8
      }
    );

    return response.text || `Hey ${leadName}, did you get a chance to check out what I sent earlier?`;
  } catch (error) {
    console.error('Follow-up DM generation error:', error);
    return `Hey ${leadName}, just following up on the ${originalIntent} I shared. Still interested?`;
  }
}

/**
 * Schedule 6-hour follow-up for a lead
 */
export async function scheduleCommentFollowUp(
  userId: string,
  leadId: string,
  channel: string,
  originalIntent: 'link' | 'info' | 'offer' | 'product' | 'general',
  postContext: string
): Promise<void> {
  try {
    // Schedule follow-up for 6 hours from now
    const followUpTime = new Date(Date.now() + 6 * 60 * 60 * 1000);

    await storage.createNotification({
      userId,
      title: '⏰ Comment Follow-Up Scheduled',
      message: `Auto follow-up set for 6 hours - Lead from ${channel} comment`,
      type: 'info',
      isRead: false,
      metadata: {
        leadId,
        followUpType: 'comment_automation',
        intent: originalIntent,
        scheduledFor: followUpTime.toISOString(),
        postContext
      }
    });

    console.log(`✓ Scheduled 6-hour follow-up for lead ${leadId} (${originalIntent})`);
  } catch (error) {
    console.error('Error scheduling comment follow-up:', error);
  }
}

/**
 * Select appropriate emoji based on intent
 */
function selectEmojiForIntent(intent: string): string {
  const emojiMap: Record<string, string> = {
    'link': '🚀',
    'info': '📩',
    'offer': '🎁',
    'product': '✨',
    'general': '👍'
  };
  return emojiMap[intent] || '✅';
}

/**
 * Check if comment contains inappropriate content
 */
async function isCommentAppropriate(comment: string): Promise<boolean> {
  try {
    const { contentModerationService } = await import("../core/content-moderation.js");
    const result = await contentModerationService.moderateContent(comment);
    return result.isAppropriate;
  } catch (error) {
    console.error('Content moderation check failed:', error);
    // Default to allowing if moderation fails
    return true;
  }
}

/**
 * Process comment and initiate DM automation flow
 * NEW FLOW: Reply with emoji → Wait 2-8min → Send DM
 */
export async function processCommentAutomation(
  userId: string,
  comment: string,
  username: string,
  channel: 'instagram' | 'email',
  postContext: string,
  commentId?: string // Optional: for replying to specific comment
): Promise<{
  success: boolean;
  lead?: Lead;
  initialMessage?: Message;
  commentReplied?: boolean;
  followUpScheduled: boolean;
}> {
  try {
    // Step 0: Check for inappropriate content
    const isAppropriate = await isCommentAppropriate(comment);
    if (!isAppropriate) {
      console.log(`❌ Comment from ${username} flagged as inappropriate - skipping automation`);
      return { success: false, followUpScheduled: false, commentReplied: false };
    }

    // Step 1: Detect if this comment wants a DM
    const intent = await detectCommentIntent(comment);

    if (!intent.wantsDM) {
      console.log(`Comment from ${username} doesn't indicate DM intent - skipping automation`);
      return { success: false, followUpScheduled: false, commentReplied: false };
    }

    // Step 2: REPLY TO COMMENT FIRST with short message (ManyChat style)
    const shortReply = formatCommentReply(intent.intent);
    let commentReplied = false;

    if (channel === 'instagram' && commentId) {
      try {
        // Reply to the comment with short message like "Check DMs!"
        console.log(`💬 Replying to comment ${commentId} with: ${shortReply}`);

        const { InstagramOAuth } = await import('@services/api-gateway/src/oauth/instagram.js');
        const { replyToInstagramComment } = await import("@shared/lib/providers/instagram.js");

        const oauth = new InstagramOAuth();
        const token = await oauth.getValidToken(userId);

        if (token) {
          await replyToInstagramComment(token, commentId, shortReply);
          console.log(`✅ Successfully replied to comment ${commentId}`);
        } else {
          console.error(`❌ No valid Instagram token for user ${userId} to reply to comment`);
        }

        await storage.createNotification({
          userId,
          title: '💬 Comment Reply Sent',
          message: `Replied "${shortReply}" to ${username}'s comment. DM will be sent shortly.`,
          type: 'info',
          isRead: false,
          metadata: {
            username,
            shortReply,
            originalComment: comment,
            action: 'comment_reply'
          }
        });
        commentReplied = true;
      } catch (error) {
        console.error('Failed to reply to comment:', error);
      }
    }

    // Step 3: Create or get lead
    let lead = await storage.getLeadByUsername(username, channel);

    if (!lead) {
      lead = await storage.createLead({
        userId,
        name: username,
        channel,
        status: 'new',
        tags: ['comment', intent.intent, 'auto_dm'],
        metadata: {
          source: 'comment_automation',
          originalComment: comment,
          commentIntent: intent.intent,
          postContext,
          commentReplied: commentReplied
        }
      });
    }

    // Step 4: Get user's CTA settings for branded buttons
    const user = await storage.getUser(userId);
    const ctaLink = user?.metadata?.ctaLink || null;
    const ctaText = user?.metadata?.ctaText || 'Get Access';

    const ctaButton: DMButton | undefined = ctaLink ? {
      text: ctaText,
      url: ctaLink
    } : undefined;

    // Step 5: Generate initial DM with ManyChat-style CTA button
    const initialDM = await generateInitialDM(username, intent, postContext, ctaButton);

    // Step 6: Schedule DM for 2-4 minutes later (human-like timing)
    const delayMinutes = Math.floor(Math.random() * 2) + 2; // Random 2-4 minutes
    const dmTime = new Date(Date.now() + delayMinutes * 60 * 1000);

    await storage.createNotification({
      userId,
      title: '⏰ DM Scheduled',
      message: `DM to ${username} will be sent in ${delayMinutes} minutes (after comment reply)`,
      type: 'info',
      isRead: false,
      metadata: {
        leadId: lead.id,
        dmBody: initialDM,
        scheduledFor: dmTime.toISOString(),
        intent: intent.intent,
        action: 'send_dm'
      }
    });

    console.log(`✓ Comment automation started for ${username}:`);
    console.log(`  - Comment replied with: "${shortReply}"`);
    console.log(`  - DM scheduled in ${delayMinutes} minutes`);
    console.log(`  - CTA button: ${ctaButton ? ctaButton.text : 'None configured'}`);

    return {
      success: true,
      lead,
      commentReplied,
      followUpScheduled: true
    };
  } catch (error) {
    console.error('Comment automation error:', error);
    return { success: false, followUpScheduled: false, commentReplied: false };
  }
}

/**
 * Check and execute scheduled comment follow-ups
 */
export async function executeCommentFollowUps(): Promise<void> {
  try {
    const now = new Date();

    if (!db) return;

    // Direct DB query for due notifications globally, avoiding N+1 loops over ALL users
    const allNotifications = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'info'),
          eq(notifications.isRead, false)
        )
      );

    // Filter in JS to safely check JSON metadata
    const dueNotifications = allNotifications.filter((n: any) => {
      const meta = n.metadata as any;
      if (!meta || meta.followUpType !== 'comment_automation' || !meta.scheduledFor) return false;
      return new Date(meta.scheduledFor) <= now;
    });

    for (const notification of dueNotifications) {
      try {
        const leadId = (notification.metadata as any).leadId;
        const intent = (notification.metadata as any).intent;
        const postContext = (notification.metadata as any).postContext || '';
        const userId = notification.userId;

            // Get lead and check engagement
            const lead = await storage.getLeadById(leadId);
            if (!lead) continue;

            const messages = await storage.getMessagesByLeadId(leadId);
            const lastMessage = messages[messages.length - 1];

            // Check if message was opened/clicked (simplified - would need real tracking)
            const messageOpened = lastMessage?.metadata?.opened || false;
            const linkClicked = lastMessage?.metadata?.clicked || false;

            // Build conversation history for context-aware follow-up
            const conversationHistory = messages.map(m => ({
              direction: m.direction as 'inbound' | 'outbound',
              body: m.body,
              createdAt: m.createdAt
            }));

            // Generate and send context-aware follow-up
            const followUpDM = await generateFollowUpDM(
              lead.name,
              intent,
              messageOpened,
              linkClicked,
              postContext,
              conversationHistory
            );

            await storage.createMessage({
              leadId: lead.id,
              userId: userId,
              provider: lead.channel as any,
              direction: 'outbound',
              body: followUpDM,
              audioUrl: null,
              metadata: {
                ai_generated: true,
                automation_type: 'comment_followup',
                hours_after_initial: 6
              }
            });

            // Mark notification as read
            await storage.markNotificationAsRead(notification.id);

            console.log(`✓ Sent 6-hour follow-up to ${lead.name}`);
      } catch (innerErr) {
          console.error(`Failed to process comment follow-up for notification ${notification.id}`, innerErr);
      }
    }
    workerHealthMonitor.recordSuccess('video-comment-monitor');
  } catch (error: any) {
    console.error('Error executing comment follow-ups:', error);
    workerHealthMonitor.recordError('video-comment-monitor', error?.message || 'Unknown error');
  }
}




