import { InstagramProvider } from "@shared/lib/providers/instagram.js";
import { ElevenLabsProvider } from "@shared/lib/providers/elevenlabs.js";
import { storage } from '@shared/lib/storage/storage.js';
import { generateVoiceScript, assessLeadWarmth, detectConversationStatus } from '../core/conversation-ai.js';
import { advancedStorage } from "@shared/lib/storage/advanced-storage.js";
import { decrypt } from '@shared/lib/crypto/encryption.js';
import type { Lead, Message, User } from '@audnix/shared';
import type { ProviderType } from '@shared/types.js';

/**
 * Voice AI Service Interfaces
 */
interface VoiceLimitCheck {
  allowed: boolean;
  remaining: number;
}

interface VoiceDecision {
  shouldSend: boolean;
  reason: string;
}

interface VoiceNoteResult {
  success: boolean;
  audioUrl?: string;
  secondsUsed?: number;
  error?: string;
}

interface VoiceCloneResult {
  success: boolean;
  voiceId?: string;
  error?: string;
}

interface BatchVoiceResult {
  processed: number;
  sent: number;
  skipped: number;
  errors: string[];
}

interface DecryptedInstagramMeta {
  tokens?: {
    access_token?: string;
    page_id?: string;
  };
  accessToken?: string;
  pageId?: string;
}

type PlanWithVoice = 'trial' | 'starter' | 'pro' | 'enterprise';

const PLAN_VOICE_LIMITS: Record<PlanWithVoice, number> = {
  trial: 0,
  starter: 250,
  pro: 1000,
  enterprise: -1 // -1 means unlimited
};

/**
 * Voice AI Service
 * Intelligently generates and sends AI voice notes to warm leads
 * on Instagram, respecting plan limits
 */
export class VoiceAIService {
  private elevenlabs: ElevenLabsProvider;

  constructor() {
    this.elevenlabs = new ElevenLabsProvider();
  }

  /**
   * Check if user has enough voice minutes remaining
   */
  private async checkVoiceLimit(userId: string, estimatedSeconds: number): Promise<VoiceLimitCheck> {
    const user = await storage.getUserById(userId);

    if (!user) {
      return { allowed: false, remaining: 0 };
    }

    const planMinutes = PLAN_VOICE_LIMITS[user.plan as PlanWithVoice] || 0;
    
    // Unlimited balance for Enterprise
    if (planMinutes === -1) {
      return { allowed: true, remaining: Infinity };
    }

    // Calculate total balance: plan minutes + topup minutes - used minutes
    const topupMinutes = user.voiceMinutesTopup || 0;
    const usedMinutes = user.voiceMinutesUsed || 0;
    const totalBalance = planMinutes + topupMinutes - usedMinutes;

    // Convert estimated seconds to minutes
    const estimatedMinutes = estimatedSeconds / 60;

    return {
      allowed: totalBalance >= estimatedMinutes && totalBalance > 0,
      remaining: Math.max(0, totalBalance)
    };
  }

  /**
   * Update voice usage for user (convert seconds to minutes)
   */
  private async trackVoiceUsage(userId: string, secondsUsed: number): Promise<void> {
    const user = await storage.getUserById(userId);
    if (!user) return;

    // Convert seconds to minutes
    const minutesUsed = secondsUsed / 60;
    const currentUsage = user.voiceMinutesUsed || 0;
    const newTotal = currentUsage + minutesUsed;

    await storage.updateUser(userId, {
      voiceMinutesUsed: newTotal
    });

    console.log(`📊 Voice usage tracked: ${minutesUsed.toFixed(2)} minutes (${secondsUsed}s) for user ${userId} (total: ${newTotal.toFixed(2)} minutes)`);
  }

  /**
   * Determine if lead should receive a voice note
   * Based on warmth, engagement, and channel
   */
  async shouldSendVoiceNote(
    lead: Lead,
    messages: Message[]
  ): Promise<VoiceDecision> {
    // Only Instagram supports voice
    if (lead.channel !== 'instagram') {
      return { shouldSend: false, reason: 'Channel does not support voice messages' };
    }

    // Check if lead is warm
    const isWarm = assessLeadWarmth(messages, lead);
    if (!isWarm) {
      return { shouldSend: false, reason: 'Lead is not warm enough' };
    }

    // Check conversation status
    const status = detectConversationStatus(messages);
    if (!status.shouldUseVoice) {
      return { shouldSend: false, reason: 'Conversation does not indicate voice would help' };
    }

    // Check if already converted or not interested
    if ((status.status as any) === 'converted' || (status.status as any) === 'not_interested') {
      return { shouldSend: false, reason: `Lead status is ${status.status}` };
    }

    return { shouldSend: true, reason: 'Lead is warm and engaged, voice will increase conversion' };
  }

  /**
   * Generate and send AI voice note (15 seconds max for professional brevity)
   */
  async generateAndSendVoiceNote(
    userId: string,
    leadId: string,
    maxDuration: number = 15
  ): Promise<VoiceNoteResult> {
    try {
      // Check if user has voice notes enabled
      const user = await storage.getUserById(userId);
      const userMetadata = user?.metadata as Record<string, unknown> | undefined;
      if (userMetadata?.voiceNotesEnabled === false) {
        return { success: false, error: 'Voice notes disabled in settings' };
      }

      // Get lead and messages
      const lead = await storage.getLeadById(leadId);
      if (!lead) {
        return { success: false, error: 'Lead not found' };
      }

      const messages = await storage.getMessages(leadId);

      // Check if should send voice
      const decision = await this.shouldSendVoiceNote(lead, messages);
      if (!decision.shouldSend) {
        return { success: false, error: decision.reason };
      }

      // Generate AI text response with character limit for ~15 seconds
      // Average speaking rate: 150 words/min = 2.5 words/sec = ~37 words for 15 seconds
      const maxWords = Math.floor((maxDuration / 60) * 150);
      const aiResponse = await this.generateVoiceScriptInternal(lead, messages, maxWords);

      // Estimate duration from word count (average 2.5 words per second for natural speech)
      const wordCount = aiResponse.split(/\s+/).length;
      const estimatedDuration = Math.ceil(wordCount / 2.5);

      // Check voice limit with estimated duration
      const limitCheck = await this.checkVoiceLimit(userId, estimatedDuration);
      if (!limitCheck.allowed) {
        return {
          success: false,
          error: `Voice limit exceeded. Remaining: ${limitCheck.remaining.toFixed(1)} minutes. Top up or upgrade plan for more.`
        };
      }

      // Get user's cloned voice ID or use default (user already fetched at start of function)
      const voiceId = (userMetadata?.voiceCloneId as string) || undefined;

      // Generate voice with ElevenLabs
      const voiceData = await this.elevenlabs.textToSpeech(aiResponse, { voiceId });

      // Verify actual duration doesn't exceed remaining limit
      const finalLimitCheck = await this.checkVoiceLimit(userId, voiceData.duration);
      if (!finalLimitCheck.allowed) {
        return {
          success: false,
          error: `Voice generation exceeded limit. Generated ${(voiceData.duration / 60).toFixed(2)} minutes but only ${finalLimitCheck.remaining.toFixed(1)} minutes remaining.`
        };
      }

      // Upload audio to storage using unified AdvancedStorageService
      const fileName = `voice_${leadId}_${Date.now()}.mp3`;
      const audioUrl = await advancedStorage.upload('voice-notes', fileName, voiceData.audioBuffer, 'audio/mpeg');

      // Send voice message based on channel
      let messageId: string;
      if (lead.channel === 'instagram') {
        const integrations = await storage.getIntegrations(userId);
        const igIntegration = integrations.find(i => i.provider === 'instagram' && i.connected);

        if (!igIntegration) {
          return { success: false, error: 'Instagram not connected' };
        }

        // Decrypt credentials from integration
        const decryptedMetaJson = decrypt(igIntegration.encryptedMeta);
        const decryptedMeta: DecryptedInstagramMeta = JSON.parse(decryptedMetaJson);
        const accessToken = decryptedMeta.tokens?.access_token || decryptedMeta.accessToken;
        const pageId = decryptedMeta.tokens?.page_id || decryptedMeta.pageId;

        if (!accessToken || !pageId) {
          return { success: false, error: 'Instagram credentials incomplete' };
        }

        const instagram = new InstagramProvider(igIntegration.encryptedMeta);

        const result = await instagram.sendAudioMessage(lead.externalId || '', audioUrl);
        messageId = result.messageId;
      } else {
        return { success: false, error: 'Unsupported channel for voice notes' };
      }

      // Map channel to provider type
      const providerMap: Record<string, ProviderType> = {
        'instagram': 'instagram',
        'email': 'email'
      };
      const provider = providerMap[lead.channel] || 'system';

      // Save message to database
      await storage.createMessage({
        leadId: lead.id,
        userId,
        provider,
        direction: 'outbound',
        body: `[Voice Note] ${aiResponse}`,
        audioUrl,
        metadata: {
          isAiGenerated: true,
          voiceNote: true,
          duration: voiceData.duration,
          messageId
        }
      });

      // Track usage - CRITICAL: Actually deduct minutes from balance
      await this.trackVoiceUsage(userId, voiceData.duration);

      // Create usage audit log
      await storage.createUsageTopup({
        userId,
        type: 'voice',
        amount: -(voiceData.duration / 60), // Negative for usage
        metadata: {
          leadId: lead.id,
          leadName: lead.name,
          channel: lead.channel,
          audioUrl,
          duration: voiceData.duration
        }
      });

      // Update lead's last message time
      await storage.updateLead(leadId, {
        lastMessageAt: new Date()
      });

      console.log(`🎙️ Voice note sent to ${lead.name} on ${lead.channel} (${voiceData.duration}s)`);

      return {
        success: true,
        audioUrl,
        secondsUsed: voiceData.duration
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to generate and send voice note';
      console.error('Voice AI Service error:', error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Generate voice script with natural human speech patterns
   * 15 seconds max for professional brevity
   */
  private async generateVoiceScriptInternal(lead: Lead, history: Message[], maxWords: number = 37): Promise<string> {
    // Analyze conversation mood
    const recentMessages = history.slice(-3).map(m => m.body.toLowerCase()).join(' ');
    const isSerious = /problem|issue|concern|worried|upset/.test(recentMessages);

    const prompt = `
      You are a calm, conversational business professional speaking to ${lead.name || 'there'} on ${lead.channel}.
      Think of this as a genuine one-on-one conversation, not a sales pitch.
      
      Conversation history:
      ${history.map(msg => `${msg.direction === 'outbound' ? 'You' : lead.name}: ${msg.body}`).join('\n')}

      VOICE SCRIPT RULES:
      1. Natural conversation - 15 seconds MAX when spoken
      2. Keep it to ${maxWords} words MAXIMUM (strict limit)
      3. ${isSerious ? 'Empathetic and understanding tone' : 'Warm and genuine tone'}
      4. Sound like a real person having a real conversation
      5. Business-appropriate but conversational
      6. NO filler words, NO corporate jargon, NO aggressive sales language
      7. Use commas for natural breathing pauses (speaker will pause at commas)
      8. Use periods to indicate tone shifts, not just sentence endings
      
      PAUSE MARKERS FOR NATURAL SPEECH:
      - Use commas liberally (commas = brief natural pause for breath)
      - Use periods between complete ideas (period = speaker takes a breath)
      - Avoid "um", "uh", "like", "you know", "obviously", "honestly"
      - Avoid: "reaching out", "touch base", "circle back", "synergize", "leverage"
      - Sound warm, NOT pushy or salesman-y
      
      Generate conversational voice script (plain text, natural breathing):
    `;

    return await generateVoiceScript(lead, history);
  }

  /**
   * Clone user's voice from uploaded samples
   */
  async cloneUserVoice(
    userId: string,
    audioBuffers: Buffer[]
  ): Promise<VoiceCloneResult> {
    try {
      const user = await storage.getUserById(userId);
      if (!user) {
        return { success: false, error: 'User not found' };
      }

      // Clone voice with ElevenLabs
      const result = await this.elevenlabs.cloneVoice(
        `${user.name || user.email}'s Voice`,
        audioBuffers
      );

      // Save voice ID to user profile
      await storage.updateUser(userId, {
        voiceCloneId: result.voiceId
      });

      console.log(`🎤 Voice cloned successfully for user ${userId}: ${result.voiceId}`);

      return { success: true, voiceId: result.voiceId };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to clone voice';
      console.error('Voice cloning error:', error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Batch process: Send voice notes to all eligible warm leads
   */
  async sendVoiceNotesToWarmLeads(userId: string): Promise<BatchVoiceResult> {
    const results: BatchVoiceResult = {
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Get all user's leads
      const leads = await storage.getLeads({ userId, limit: 1000 });

      for (const lead of leads) {
        results.processed++;

        // Get messages for this lead
        const messages = await storage.getMessages(lead.id);

        // Check if should send
        const decision = await this.shouldSendVoiceNote(lead, messages);

        if (!decision.shouldSend) {
          results.skipped++;
          continue;
        }

        // Send a single high-impact voice note
        const result = await this.generateAndSendVoiceNote(userId, lead.id, 15);

        if (result.success) {
          results.sent++;
          // Add delay between sends to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          results.skipped++;
          if (result.error) {
            results.errors.push(`${lead.name}: ${result.error}`);
          }
        }
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown batch error';
      console.error('Batch voice sending error:', error);
      results.errors.push(`Batch error: ${errorMessage}`);
    }

    return results;
  }
}

export const voiceAI = new VoiceAIService();




