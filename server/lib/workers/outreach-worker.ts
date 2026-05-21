/**
 * Autonomous Email Outreach Worker
 * 
 * Polls every 5 seconds for users with email integrations
 * and automatically sends AI-personalized cold outreach emails
 * to uncontacted leads with 2-4 minute delays.
 */

import { db } from '../../db.js';
import { users, leads, messages, integrations, followUpQueue } from '../../../shared/schema.js';
import { eq, and, or, isNull, ne } from 'drizzle-orm';
import { storage } from '../../storage.js';
import { wsSync } from '../websocket-sync.js';
import { sendEmail } from '../channels/email.js';
import { workerHealthMonitor } from '../monitoring/worker-health.js';
import OpenAI from 'openai';

const openai = process.env.OPENAI_API_KEY 
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

interface UserWithEmail {
  id: string;
  email: string;
  company: string | null;
  businessName: string | null;
}

interface UncontactedLead {
  id: string;
  name: string;
  email: string;
  channel: string;
  status: string;
  metadata: Record<string, unknown>;
  userId: string;
}

/**
 * Generate AI-powered cold outreach email based on lead metadata
 * Uses curiosity, FOMO, trust, and punchy triggers
 */
async function generateColdOutreachEmail(
  lead: UncontactedLead,
  businessName: string
): Promise<{ subject: string; body: string }> {
  const leadMetadata = lead.metadata || {};
  const leadCompany = (leadMetadata.company as string) || '';
  const leadIndustry = (leadMetadata.industry as string) || '';
  const leadRole = (leadMetadata.role as string) || '';
  const firstName = lead.name.split(' ')[0];

  const prompt = `You are an expert cold email copywriter. Generate a highly personalized cold outreach email.

LEAD INFO:
- Name: ${lead.name} (First name: ${firstName})
- Company: ${leadCompany || 'Unknown'}
- Industry: ${leadIndustry || 'B2B'}
- Role: ${leadRole || 'Decision Maker'}
- Email: ${lead.email}

YOUR BUSINESS:
- Name: ${businessName}
- Offering: AI-powered automation solutions

PSYCHOLOGICAL TRIGGERS TO USE:
1. **CURIOSITY** - Tease a benefit without revealing everything. Make them want to know more.
2. **FOMO** - Others are using this, limited spots, exclusive access
3. **TRUST** - Specific results, social proof, credibility markers
4. **PUNCHY** - Short sentences. Impactful. No fluff.

RULES:
- Subject line: 5-8 words max, create intrigue, no spam words
- First line: Pattern interrupt, NOT "I hope this email finds you well"
- Body: 3-4 short paragraphs max (2-3 sentences each)
- Focus on THEIR pain, not your product features
- End with a soft CTA - get the REPLY first, not the call
- NO links in first email
- Sound human, not salesy
- Use their first name naturally

Return JSON only:
{
  "subject": "...",
  "body": "..."
}`;

  if (openai) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a cold email expert. Return only valid JSON." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.8
      });

      const content = response.choices[0].message.content;
      if (content) {
        const parsed = JSON.parse(content);
        return {
          subject: parsed.subject || `Quick question, ${firstName}`,
          body: parsed.body || `Hey ${firstName},\n\nWanted to reach out about something that might help ${leadCompany || 'your business'}.\n\nWould love to share a quick idea - mind if I send it over?\n\nBest,\n${businessName}`
        };
      }
    } catch (error) {
      console.error('[AutoOutreach] AI generation error:', error);
    }
  }

  // Fallback template
  return {
    subject: `Quick question for ${firstName}`,
    body: `Hey ${firstName},\n\nI noticed ${leadCompany || 'your business'} and had a quick idea that might help.\n\nWould you be open to hearing it?\n\nBest,\n${businessName}`
  };
}

/**
 * Autonomous Outreach Worker Class
 */
export class AutonomousOutreachWorker {
  private isRunning: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private activeOutreachQueue: Map<string, boolean> = new Map(); // Track users being processed
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds
  private readonly MIN_DELAY_MS = 120000; // 2 minutes
  private readonly MAX_DELAY_MS = 240000; // 4 minutes

  constructor() {
    this.isRunning = false;
    this.pollingInterval = null;
  }

  /**
   * Start the autonomous outreach worker
   */
  start(): void {
    if (this.isRunning) {
      console.log('[AutoOutreach] Worker is already running');
      return;
    }

    this.isRunning = true;
    console.log('✅ Autonomous outreach worker started (5s polling interval)');

    // Poll every 5 seconds
    this.pollingInterval = setInterval(async () => {
      await this.checkAndProcessUsers();
    }, this.POLL_INTERVAL_MS);

    // Process immediately on start
    this.checkAndProcessUsers();
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isRunning = false;
    console.log('[AutoOutreach] Worker stopped');
  }

  /**
   * Check for users with email integrations and process their leads
   */
  private async checkAndProcessUsers(): Promise<void> {
    if (!db) return;

    try {
      // Find users with connected email integrations
      const usersWithEmail = await db
        .select({
          userId: integrations.userId,
        })
        .from(integrations)
        .where(
          and(
            eq(integrations.connected, true),
            or(
              eq(integrations.provider, 'custom_email'),
              eq(integrations.provider, 'gmail'),
              eq(integrations.provider, 'outlook')
            )
          )
        );

      if (usersWithEmail.length === 0) {
        return; // No users with email integrations
      }

      const uniqueUserIds = [...new Set(usersWithEmail.map((u: { userId: string }) => u.userId))];
      
      for (const userId of uniqueUserIds) {
        // Skip if this user is already being processed
        if (this.activeOutreachQueue.has(userId as string)) {
          continue;
        }

        // Find uncontacted leads for this user
        const uncontactedLeads = await this.getUncontactedLeads(userId as string);

        if (uncontactedLeads.length > 0) {
          console.log(`[AutoOutreach] User ${userId} has ${uncontactedLeads.length} uncontacted leads`);
          
          // Mark user as being processed
          this.activeOutreachQueue.set(userId as string, true);
          
          // Process leads asynchronously with delays
          this.processLeadsWithDelay(userId as string, uncontactedLeads);
        }
      }

      workerHealthMonitor.recordSuccess('autonomous-outreach-worker');
    } catch (error: any) {
      console.error('[AutoOutreach] Error checking users:', error);
      workerHealthMonitor.recordError('autonomous-outreach-worker', error?.message || 'Unknown error');
    }
  }

  /**
   * Get leads that haven't received outreach yet
   */
  private async getUncontactedLeads(userId: string): Promise<UncontactedLead[]> {
    if (!db) return [];

    try {
      // Get leads with status 'new' that don't have outbound messages
      const userLeads = await db
        .select({
          id: leads.id,
          name: leads.name,
          email: leads.email,
          channel: leads.channel,
          status: leads.status,
          metadata: leads.metadata,
          userId: leads.userId,
        })
        .from(leads)
        .where(
          and(
            eq(leads.userId, userId),
            eq(leads.status, 'new'),
            eq(leads.channel, 'email')
          )
        )
        .limit(50);

      // Filter out leads that already have outbound messages
      const uncontactedLeads: UncontactedLead[] = [];

      for (const lead of userLeads) {
        if (!lead.email) continue;

        // Check if lead has any outbound messages
        const existingMessages = await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.leadId, lead.id),
              eq(messages.direction, 'outbound')
            )
          )
          .limit(1);

        // Check if already marked as outreach_sent in metadata
        const metadata = (lead.metadata as Record<string, any>) || {};
        const alreadySent = metadata.outreach_sent === true;

        if (existingMessages.length === 0 && !alreadySent) {
          uncontactedLeads.push({
            id: lead.id,
            name: lead.name,
            email: lead.email as string,
            channel: lead.channel as string,
            status: lead.status as string,
            metadata: metadata,
            userId: lead.userId as string,
          });
        }
      }

      return uncontactedLeads;
    } catch (error) {
      console.error('[AutoOutreach] Error fetching uncontacted leads:', error);
      return [];
    }
  }

  /**
   * Process leads with 2-4 minute random delays between each
   */
  private async processLeadsWithDelay(userId: string, leads: UncontactedLead[]): Promise<void> {
    try {
      // Get user info for branding
      const user = await storage.getUserById(userId);
      const businessName = user?.company || user?.businessName || 'Our Team';

      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        
        try {
          await this.sendOutreachToLead(userId, lead, businessName);
          
          // Add random delay between 2-4 minutes before next email
          if (i < leads.length - 1) {
            const delay = this.MIN_DELAY_MS + Math.random() * (this.MAX_DELAY_MS - this.MIN_DELAY_MS);
            console.log(`[AutoOutreach] Waiting ${Math.round(delay / 1000)}s before next email...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          console.error(`[AutoOutreach] Failed to send to ${lead.email}:`, error);
          // Continue with next lead
        }
      }
    } finally {
      // Remove user from active queue when done
      this.activeOutreachQueue.delete(userId);
    }
  }

  /**
   * Send outreach email to a single lead
   */
  private async sendOutreachToLead(
    userId: string,
    lead: UncontactedLead,
    businessName: string
  ): Promise<void> {
    console.log(`[AutoOutreach] Generating email for ${lead.name} (${lead.email})...`);

    // Generate AI-powered cold email
    const emailContent = await generateColdOutreachEmail(lead, businessName);

    // Send the email
    await sendEmail(
      userId,
      lead.email,
      emailContent.body,
      emailContent.subject,
      { isHtml: false }
    );

    console.log(`[AutoOutreach] ✅ Email sent to ${lead.email}: "${emailContent.subject}"`);

    // Save message to database
    await storage.createMessage({
      leadId: lead.id,
      userId: userId,
      provider: 'email',
      direction: 'outbound',
      body: emailContent.body,
      metadata: {
        subject: emailContent.subject,
        ai_generated: true,
        outreach_type: 'cold_email',
        sent_at: new Date().toISOString()
      }
    });

    // Update lead status and metadata
    await storage.updateLead(lead.id, {
      status: 'open',
      lastMessageAt: new Date(),
      metadata: {
        ...lead.metadata,
        outreach_sent: true,
        outreach_sent_at: new Date().toISOString(),
        outreach_subject: emailContent.subject
      }
    });

    // Schedule 6-hour follow-up
    const followUpTime = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6 hours
    await storage.createFollowUp({
      userId: userId,
      leadId: lead.id,
      channel: 'email',
      scheduledAt: followUpTime,
      status: 'pending',
      context: {
        type: 'first_followup',
        originalSubject: emailContent.subject
      }
    });

    // Create notification for UI
    await storage.createNotification({
      userId: userId,
      type: 'insight',
      title: '📧 Outreach Sent',
      message: `Cold email sent to ${lead.name} (${lead.email})`,
      metadata: {
        leadId: lead.id,
        leadName: lead.name,
        subject: emailContent.subject,
        activityType: 'outreach_sent'
      }
    });

    // Send real-time WebSocket updates
    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'outreach_sent' });
    wsSync.notifyMessagesUpdated(userId, { leadId: lead.id });
    wsSync.notifyActivityUpdated(userId, { type: 'outreach_sent', leadName: lead.name });
  }
}

// Export singleton instance
export const autonomousOutreachWorker = new AutonomousOutreachWorker();
