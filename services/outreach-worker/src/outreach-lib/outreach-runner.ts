import { OutreachEngine } from "@services/outreach-worker/workers/outreach-engine.js";
import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { OutreachCampaign, leads, outreachCampaigns, campaignLeads, CampaignLead } from '@audnix/shared';
import { sendEmail } from '@shared/lib/channels/email.js';
import { generateReply } from '@services/brain-worker/src/ai-lib/core/ai-service.js';
import { randomUUID } from 'crypto';
import { eq, and, or, isNull, lte } from 'drizzle-orm';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const engine = new OutreachEngine();
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Fallback runner for campaigns when BullMQ is unavailable.
 * Triggers the engine's manual tick for the specific user.
 */
export async function runOutreachCampaignQueued(userId: string, campaignId: string) {
  const campaign = await storage.getOutreachCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // Force an immediate tick for this user
  const userIntegrations = await storage.getIntegrations(userId);
  const integration = userIntegrations.find(i => i.connected && !['google_calendar', 'calendly'].includes(i.provider));
  
  if (integration) {
    await engine.processUserOutreach(userId, integration);
  }
  
  // Return current stats after the tick
  const updatedCampaign = await storage.getOutreachCampaign(campaignId);
  return {
    success: true,
    campaignId,
    stats: updatedCampaign?.stats || { sent: 0, total: 0, failed: 0 }
  };
}

/**
 * Specialized runner for demo campaigns.
 * Replaced hardcoded mockup with real logic from HVAC demo script.
 */
export async function runDemoOutreach(userId: string) {
  console.log(`[DemoRunner] Starting HVAC demo for user ${userId}`);

  // 1. Ensure HVAC leads exist
  const existingLeads = await storage.getLeads({ userId, limit: 100 });
  let hvacLeads = existingLeads.filter(l => 
    l.metadata && (l.metadata as any).campaign_type === 'hvac_outreach'
  );

  if (hvacLeads.length === 0) {
    console.log('[DemoRunner] Seeding HVAC leads...');
    await seedHVACLeads(userId);
    const freshLeads = await storage.getLeads({ userId, limit: 100 });
    hvacLeads = freshLeads.filter(l => 
      l.metadata && (l.metadata as any).campaign_type === 'hvac_outreach'
    ).slice(0, 8);
  }

  // 2. Setup Results tracking
  const results: { email: string; status: string; subject?: string; error?: string }[] = [];
  let sentCount = 0;
  let failedCount = 0;

  // 3. Process the sequence
  for (const lead of hvacLeads) {
    try {
      // Generate personalized email content via AI Service
      const firstName = lead.name.split(' ')[0];
      const systemPrompt = `You are an expert B2B sales copywriter specializing in HVAC industry solutions. 
      Generate a personalized cold outreach email for an HVAC company owner.
      Keep it under 100 words. Industry: HVAC. 
      Focus on transformative value: AI receptionist that books appointments and Qualifies leads 24/7.
      End with a clear CTA.`;
      
      const userPrompt = `Lead Name: ${lead.name}, Company: ${lead.company || 'HVAC Company'}.
      Address the pain point: Overwhelmed with calls, missing revenue because calls go to voicemail.
      Return JSON: { "subject": "...", "body": "..." }`;

      const aiRes = await generateReply(systemPrompt, userPrompt, { jsonMode: true, temperature: 0.8 });
      const emailContent = JSON.parse(aiRes.text);

      // Send the email
      await sendEmail(
        userId,
        lead.email!,
        emailContent.body,
        emailContent.subject,
        { isHtml: false }
      );

      // Save outbound message
      await storage.createMessage({
        leadId: lead.id,
        userId,
        provider: 'email',
        direction: 'outbound',
        body: emailContent.body,
        metadata: {
          subject: emailContent.subject,
          ai_generated: true,
          campaign_type: 'hvac_initial_outreach',
          sent_at: new Date().toISOString()
        }
      });

      // Update lead status
      await storage.updateLead(lead.id, {
        status: 'open',
        lastMessageAt: new Date(),
        metadata: {
          ...(lead.metadata || {} as any),
          outreach_sent: true,
          outreach_sent_at: new Date().toISOString(),
          follow_up_scheduled_at: new Date(Date.now() + SIX_HOURS_MS).toISOString()
        }
      });

      // Schedule follow-up
      await storage.createFollowUp({
        leadId: lead.id,
        userId,
        channel: 'email',
        scheduledAt: new Date(Date.now() + SIX_HOURS_MS),
        status: 'pending',
        context: {
          original_subject: emailContent.subject,
          campaign_type: 'hvac_followup',
          follow_up_number: 1
        }
      });

      results.push({ email: lead.email!, status: 'sent', subject: emailContent.subject });
      sentCount++;
    } catch (error: any) {
      console.error(`[DemoRunner] Failed for lead ${lead.email}:`, error.message);
      results.push({ email: lead.email || 'unknown', status: 'failed', error: error.message });
      failedCount++;
    }
  }

  return {
    results,
    summary: {
      sent: sentCount,
      failed: failedCount,
      total: hvacLeads.length
    }
  };
}

async function seedHVACLeads(userId: string) {
  const hvacLeads = [
    { name: 'Mike Johnson', email: 'trexndom@gmail.com', company: 'Johnson HVAC Services' },
    { name: 'Sarah Williams', email: 'team.replyflow@gmail.com', company: 'Williams Heating & Cooling' },
    { name: 'James Anderson', email: 'iamherebro60@gmail.com', company: 'Anderson Air Solutions' },
    { name: 'David Martinez', email: 'loopstories1@gmail.com', company: 'Martinez Climate Control' },
    { name: 'Robert Thompson', email: 'orbieonlms@gmail.com', company: 'Thompson HVAC Pros' },
    { name: 'Chris Davis', email: 'nevermindthough79@gmail.com', company: 'Davis Air Systems' },
    { name: 'Kevin Wilson', email: 'somtouchendu9@gmail.com', company: 'Wilson Comfort Systems' },
    { name: 'Brian Taylor', email: 'c28926695@gmail.com', company: 'Taylor Heating Services' }
  ];

  for (const lead of hvacLeads) {
    try {
      await storage.createLead({
        userId,
        name: lead.name,
        email: lead.email,
        channel: 'email',
        status: 'new',
        company: lead.company,
        aiPaused: false,
        metadata: {
          industry: 'HVAC',
          campaign_type: 'hvac_outreach',
          seeded_at: new Date().toISOString()
        }
      });
    } catch (e) {
      // Ignore duplicates
    }
  }
}







