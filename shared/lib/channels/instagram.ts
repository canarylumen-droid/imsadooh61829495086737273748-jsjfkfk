/*
 * Instagram messaging functions using Facebook Graph API
 * 
 * IMPORTANT: All media URLs must be publicly accessible HTTPS URLs.
 * Upload media to Supabase Storage or S3 first, then pass the public URL.
 */

import FormData from 'form-data';
import { Readable } from 'stream';
import { storage } from '@shared/lib/storage/storage.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { wrapPlainTextLinksWithTracking, createTrackedEmail } from '@services/email-service/src/email/email-tracking.js';

interface InstagramMessage {
  id: string;
  text: string;
  timestamp: string;
  from: {
    id: string;
    username?: string;
  };
}

/**
 * Send a text message via Instagram Direct Message API (Facebook Graph)
 */
export async function sendInstagramMessage(
  accessToken: string,
  instagramBusinessAccountId: string,
  recipientId: string,
  message: string
): Promise<{ messageId: string }> {
  // EMERGENCY SUSPENSION CHECK: Prevent server crashes if IG API is unstable
  if (process.env.SUSPEND_INSTAGRAM === 'true') {
    console.warn('[INSTAGRAM_SUSPENDED] Skipping network request due to active suspension flag.');
    return { messageId: `ig_suspended_${Date.now()}` };
  }

  // Instagram Direct uses Facebook Graph API, not Instagram Graph API
  const endpoint = `https://graph.facebook.com/v18.0/${instagramBusinessAccountId}/messages`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      messaging_product: 'instagram', // Required by Meta Instagram API
      recipient: {
        id: recipientId
      },
      messaging_type: 'RESPONSE', // Required: RESPONSE for replies within 24hrs
      message: {
        text: message
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Instagram text message error:', data);
    throw new Error(data.error?.message || 'Failed to send Instagram message');
  }

  console.log('Instagram text message sent successfully:', data);
  return { messageId: data.message_id || data.id || `ig_${Date.now()}` };
}

/**
 * Upload media attachment to Instagram using URL and get attachment_id
 * This is step 1 of the two-step process for sending media
 * 
 * @param accessToken Instagram Page Access Token
 * @param instagramBusinessAccountId Instagram Business Account ID
 * @param mediaUrl Publicly accessible HTTPS URL of the media (from Supabase/S3)
 * @param mediaType Type of media: audio, image, video, or file
 * @returns attachment_id to use in message sending
 */
async function uploadInstagramAttachment(
  accessToken: string,
  instagramBusinessAccountId: string,
  mediaUrl: string,
  mediaType: 'audio' | 'image' | 'video' | 'file'
): Promise<string> {
  const endpoint = `https://graph.facebook.com/v18.0/${instagramBusinessAccountId}/message_attachments`;

  // Create form data with the media URL - multipart format required by Meta
  const formData = new FormData();
  formData.append('messaging_product', 'instagram'); // Required as separate field
  formData.append('message', JSON.stringify({
    attachment: {
      type: mediaType,
      payload: {
        url: mediaUrl,
        is_reusable: false
      }
    }
  }));

  // Use fetch with FormData (Node.js form-data package)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      ...formData.getHeaders()
    },
    body: formData as any
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Instagram media upload error:', data);
    throw new Error(data.error?.message || 'Failed to upload Instagram attachment');
  }

  if (!data.attachment_id) {
    throw new Error('Instagram API did not return attachment_id');
  }

  console.log('Instagram attachment uploaded, ID:', data.attachment_id);
  return data.attachment_id;
}

/**
 * Send a voice message via Instagram Direct Message API (Facebook Graph)
 * Uses two-step process: 1) Upload attachment, 2) Send message with attachment_id
 * @param accessToken Instagram access token
 * @param instagramBusinessAccountId Instagram Business Account ID
 * @param recipientId Instagram user ID to send to
 * @param audioUrl Public URL of the audio file (must be accessible by Facebook)
 */
export async function sendInstagramVoiceMessage(
  accessToken: string,
  instagramBusinessAccountId: string,
  recipientId: string,
  audioUrl: string
): Promise<{ messageId: string }> {
  // Step 1: Upload the audio file and get attachment_id
  const attachmentId = await uploadInstagramAttachment(
    accessToken,
    instagramBusinessAccountId,
    audioUrl,
    'audio'
  );

  // Step 2: Send message using the attachment_id
  const endpoint = `https://graph.facebook.com/v18.0/${instagramBusinessAccountId}/messages`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      messaging_product: 'instagram', // Required by Meta Instagram API
      recipient: {
        id: recipientId
      },
      messaging_type: 'RESPONSE', // Required: RESPONSE for replies within 24hrs
      message: {
        attachment: {
          type: 'audio',
          payload: {
            attachment_id: attachmentId
          }
        }
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Instagram voice message send error:', data);
    throw new Error(data.error?.message || 'Failed to send Instagram voice message');
  }

  console.log('Instagram voice message sent successfully:', data);
  return { messageId: data.message_id || data.id || `ig_voice_${Date.now()}` };
}

/**
 * Send media (image/video) via Instagram Direct Message API (Facebook Graph)
 * Uses two-step process: 1) Upload attachment, 2) Send message with attachment_id
 * @param accessToken Instagram access token
 * @param instagramBusinessAccountId Instagram Business Account ID
 * @param recipientId Instagram user ID to send to
 * @param mediaUrl Public URL of the media file
 * @param mediaType Type of media: 'image' or 'video'
 */
export async function sendInstagramMedia(
  accessToken: string,
  instagramBusinessAccountId: string,
  recipientId: string,
  mediaUrl: string,
  mediaType: 'image' | 'video' = 'image'
): Promise<{ messageId: string }> {
  // Step 1: Upload the media file and get attachment_id
  const attachmentId = await uploadInstagramAttachment(
    accessToken,
    instagramBusinessAccountId,
    mediaUrl,
    mediaType
  );

  // Step 2: Send message using the attachment_id
  const endpoint = `https://graph.facebook.com/v18.0/${instagramBusinessAccountId}/messages`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      messaging_product: 'instagram', // Required by Meta Instagram API
      recipient: {
        id: recipientId
      },
      messaging_type: 'RESPONSE', // Required: RESPONSE for replies within 24hrs
      message: {
        attachment: {
          type: mediaType,
          payload: {
            attachment_id: attachmentId
          }
        }
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Instagram media send error:', data);
    throw new Error(data.error?.message || 'Failed to send Instagram media');
  }

  console.log('Instagram media sent successfully:', data);
  return { messageId: data.message_id || data.id || `ig_media_${Date.now()}` };
}

/**
 * Get Instagram conversations using Facebook Graph API
 */
export async function getInstagramConversations(
  accessToken: string,
  instagramBusinessAccountId: string,
  limit: number = 20
): Promise<InstagramMessage[]> {
  const endpoint = `https://graph.facebook.com/v18.0/${instagramBusinessAccountId}/conversations?fields=messages{id,text,timestamp,from}&limit=${limit}`;

  const response = await fetch(endpoint, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Instagram conversations error:', data);
    throw new Error(data.error?.message || 'Failed to get conversations');
  }

  return data.data || [];
}

/**
 * Reply to a comment on Instagram
 */
export async function replyToInstagramComment(
  accessToken: string,
  commentId: string,
  message: string
): Promise<void> {
  const endpoint = `https://graph.facebook.com/v18.0/${commentId}/replies`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      message: message
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Instagram comment reply error:', data);
    throw new Error(data.error?.message || 'Failed to reply to Instagram comment');
  }

  console.log('Instagram comment reply sent successfully:', data);
}

/**
 * Subscribe to Instagram webhooks
 */
export async function subscribeToInstagramWebhooks(
  accessToken: string,
  callbackUrl: string
): Promise<void> {
  // Instagram webhook subscription logic
  // This would be configured in the Facebook App Dashboard
  console.log('Instagram webhook subscription should be configured in Facebook App Dashboard');
}

/**
 * High-level helper to send an Instagram outreach message for a given user
 * Automatically retrieves and decrypts credentials and logs to database.
 */
export async function sendInstagramOutreach(
  userId: string,
  leadId: string,
  message: string,
  options: { isAutonomous?: boolean; metadata?: any } = {}
): Promise<{ messageId: string }> {
  const integration = await storage.getIntegration(userId, 'instagram');
  
  if (!integration || !integration.connected || !integration.encryptedMeta) {
    throw new Error('Instagram integration not connected');
  }

  const lead = await storage.getLead(leadId);
  if (!lead || !lead.externalId) {
    throw new Error('Lead missing Instagram ID (externalId)');
  }

  try {
    const credentialsStr = await decrypt(integration.encryptedMeta);
    const credentials = JSON.parse(credentialsStr);
    
    const accessToken = credentials.accessToken || credentials.access_token;
    const instagramBusinessAccountId = credentials.instagramBusinessAccountId || credentials.instagram_business_account_id;

    if (!accessToken || !instagramBusinessAccountId) {
      throw new Error('Missing Instagram access token or business account ID');
    }

    // Tracking Setup
    const baseUrl = process.env.BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://audnixai.com';
    const trackingToken = Math.random().toString(36).substring(2, 11);
    
    // Wrap links if any
    const trackedMessage = wrapPlainTextLinksWithTracking(message, baseUrl, trackingToken);

    await createTrackedEmail({
      userId,
      recipientEmail: lead.externalId, // Using ID as "email" for tracking consistency
      subject: 'Instagram Message',
      sentAt: new Date(),
      messageId: trackingToken
    });

    const result = await sendInstagramMessage(
      accessToken,
      instagramBusinessAccountId,
      lead.externalId,
      trackedMessage
    );

    // LOG TO PERMANENT MESSAGES TABLE FOR DASHBOARD VISIBILITY
    await storage.createMessage({
      userId,
      leadId,
      body: trackedMessage,
      direction: 'outbound',
      threadId: `ig_thread_${lead.externalId}`,
      metadata: { 
        channel: 'instagram', 
        trackingToken, 
        messageId: result.messageId,
        integrationId: integration.id,
        isAutonomous: !!options.isAutonomous,
        ...(options.metadata || {})
      }
    });

    return result;

    return result;
  } catch (error: any) {
    console.error(`[IG_OUTREACH] Failed for user ${userId}:`, error.message);
    
    // If it's a permanent auth error, we might want to mark as disconnected
    if (error.message.includes('token') || error.message.includes('OAuth') || error.message.includes('401')) {
      await storage.updateIntegration(userId, 'instagram', { connected: false });
    }
    
    throw error;
  }
}

