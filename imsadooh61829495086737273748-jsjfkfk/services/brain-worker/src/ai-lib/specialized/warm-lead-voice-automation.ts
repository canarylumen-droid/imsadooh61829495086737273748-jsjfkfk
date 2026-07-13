import { voiceAI } from './voice-ai-service.js';
import { storage } from '@shared/lib/storage/storage.js';

/**
 * Send 2 voice notes to a warm lead (max 15 seconds each = 30 seconds total)
 */
export async function sendVoiceNotesToWarmLead(userId: string, leadId: string): Promise<{
  success: boolean;
  notesSent: number;
  totalSecondsUsed: number;
  error?: string;
}> {
  try {
    const lead = await storage.getLeadById(leadId);
    if (!lead || !lead.warm) {
      return { success: false, notesSent: 0, totalSecondsUsed: 0, error: 'Lead not warm' };
    }

    // Check voice minutes balance (need at least 0.5 minutes = 30 seconds)
    const balance = await storage.getVoiceMinutesBalance(userId);
    if (balance < 0.5) {
      return { success: false, notesSent: 0, totalSecondsUsed: 0, error: 'Insufficient voice minutes' };
    }

    let totalSeconds = 0;
    let notesSent = 0;

    // Send first voice note (15 seconds max)
    const firstNote = await voiceAI.generateAndSendVoiceNote(userId, leadId, 15);
    if (firstNote.success && firstNote.secondsUsed) {
      totalSeconds += firstNote.secondsUsed;
      notesSent++;

      // Wait 2 hours before sending second note
      await new Promise(resolve => setTimeout(resolve, 2 * 60 * 60 * 1000));

      // Send second voice note (15 seconds max)
      const secondNote = await voiceAI.generateAndSendVoiceNote(userId, leadId, 15);
      if (secondNote.success && secondNote.secondsUsed) {
        totalSeconds += secondNote.secondsUsed;
        notesSent++;
      }
    }

    return {
      success: notesSent > 0,
      notesSent,
      totalSecondsUsed: totalSeconds
    };
  } catch (error) {
    console.error('Warm lead voice automation error:', error);
    return {
      success: false,
      notesSent: 0,
      totalSecondsUsed: 0,
      error: error instanceof Error ? error.message : 'Failed to send voice notes'
    };
  }
}

