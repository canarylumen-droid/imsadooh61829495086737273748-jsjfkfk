/**
 * HVAC Outreach Campaign Runner
 * 
 * This script runs an email outreach campaign for the 8 seeded HVAC leads
 * connected to user canarylumen1@gmail.com.
 * 
 * Features:
 * - Sends AI-generated personalized initial emails to 8 HVAC company leads
 * - Schedules 6-hour follow-ups (first time only)
 * - Updates database in real-time
 * - Syncs with frontend UI via notifications
 */

import 'dotenv/config';
import { storage } from '@shared/lib/storage/storage.js';
import { sendEmail } from '@shared/lib/channels/email.js';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// HVAC-specific brand context for outreach
const HVAC_BRAND_CONTEXT = {
  serviceName: 'AI-Powered Call Handling for HVAC Companies',
  pricing: 'Starting at $297/month',
  valueProposition: 'Never miss another HVAC service call. Our AI receptionist handles your calls 24/7, books appointments, and qualifies leads while you focus on the jobs that matter.',
  businessName: 'Audnix AI'
};

// 6 hours in milliseconds for follow-up scheduling
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

interface HVACLead {
  id: string;
  name: string;
  email: string;
  company?: string;
}

/**
 * Generate HVAC-specific personalized outreach email
 */
async function generateHVACOutreachEmail(lead: HVACLead): Promise<{ subject: string; body: string }> {
  const firstName = lead.name.split(' ')[0];

  const prompt = `You are an expert B2B sales copywriter specializing in HVAC industry solutions.
Generate a personalized cold outreach email for an HVAC company owner.

Lead Info:
- Name: ${lead.name}
- Email: ${lead.email}
${lead.company ? `- Company: ${lead.company}` : ""}

Service Being Offered:
- AI-powered call handling system
- 24/7 AI receptionist that answers calls, books appointments, qualifies leads
- Specifically designed for HVAC companies handling high call volumes

RULES:
1. Keep it under 100 words
2. Address their specific pain point: missing calls = losing revenue
3. Reference their industry (HVAC) specifically
4. Personal, not corporate-sounding
5. End with a clear CTA (reply or book a call)
6. Use the lead's first name only
7. Focus on the TRANSFORMATION: from overwhelmed with calls to automated booking

Return JSON only:
{
  "subject": "...",
  "body": "..."
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful B2B sales assistant specializing in HVAC industry. Generate JSON." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (content) {
      const parsed = JSON.parse(content);
      return {
        subject: parsed.subject || `${firstName}, your HVAC calls are being missed`,
        body: parsed.body || getDefaultHVACEmail(firstName)
      };
    }
  } catch (error) {
    console.error('AI generation error:', error);
  }

  return {
    subject: `${firstName}, your HVAC calls are being missed`,
    body: getDefaultHVACEmail(firstName)
  };
}

function getDefaultHVACEmail(firstName: string): string {
  return `Hey ${firstName},

I notice you're running an HVAC company - which means you're probably swamped with service calls, especially during peak season.

Quick question: How many calls do you think get missed when your team is out on jobs?

We built an AI system specifically for HVAC companies that handles every incoming call 24/7, books appointments automatically, and qualifies leads - so your team can focus on the actual work.

Would you be open to a quick 10-min call to see if this could work for you?

Best,
The Audnix AI Team`;
}

/**
 * Main function to run the HVAC outreach campaign
 */
async function runHVACOutreachCampaign() {
  console.log('\n========================================');
  console.log('🚀 HVAC OUTREACH CAMPAIGN STARTING');
  console.log('========================================\n');

  // Step 1: Find user canarylumen1@gmail.com
  console.log('[1/5] Finding user canarylumen1@gmail.com...');
  const user = await storage.getUserByEmail('canarylumen1@gmail.com');

  if (!user) {
    console.error('❌ User canarylumen1@gmail.com not found in database!');
    console.log('Creating test user for campaign...');

    // Create user if not exists
    const newUser = await storage.createUser({
      email: 'canarylumen1@gmail.com',
      name: 'Canary Lumen',
      plan: 'pro',
      businessName: 'Audnix AI'
    });
    console.log(`✅ Created user: ${newUser.id}`);
    return runCampaignForUser(newUser.id);
  }

  console.log(`✅ Found user: ${user.id} (${user.email})`);
  return runCampaignForUser(user.id);
}

async function runCampaignForUser(userId: string) {
  // Step 2: Check email integration
  console.log('\n[2/5] Checking email integration...');
  const emailIntegration = await storage.getIntegration(userId, 'custom_email');

  if (!emailIntegration?.connected) {
    console.warn('⚠️ Custom email not configured. Checking for Gmail/Outlook...');
    const integrations = await storage.getIntegrations(userId);
    const hasEmail = integrations.some(i => ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected);

    if (!hasEmail) {
      console.error('❌ No email integration found! Please configure email in Settings > Email Integration.');
      console.log('\n📧 To proceed, set up SMTP credentials in the dashboard.');
      process.exit(1);
    }
  }
  console.log('✅ Email integration verified');

  // Step 3: Get the 8 leads for this user
  console.log('\n[3/5] Fetching leads from database...');
  const allLeads = await storage.getLeads({ userId, limit: 100 });

  console.log(`📊 Found ${allLeads.length} total leads in database`);

  // Filter to only email leads that haven't been contacted yet
  const emailLeads = allLeads.filter(lead =>
    lead.email &&
    lead.channel === 'email' &&
    (lead.status === 'new' || lead.status === 'contacted')
  ).slice(0, 8);

  if (emailLeads.length === 0) {
    console.log('No new email leads found. Creating demo HVAC leads...');
    await seedHVACLeads(userId);
    // Refetch leads after seeding
    const freshLeads = await storage.getLeads({ userId, limit: 100 });
    const hvacLeads = freshLeads.filter(l => l.email && l.channel === 'email').slice(0, 8);
    return runOutreachSequence(userId, hvacLeads);
  }

  console.log(`✅ Found ${emailLeads.length} leads ready for outreach`);
  return runOutreachSequence(userId, emailLeads);
}

async function seedHVACLeads(userId: string) {
  console.log('\n📋 Seeding 8 HVAC company leads...');

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
          niche: 'HVAC Company',
          company_size: 'Small-Medium',
          pain_point: 'High call volume, missed calls',
          campaign_type: 'hvac_outreach',
          seeded_at: new Date().toISOString()
        }
      });
      console.log(`  ✅ Created lead: ${lead.name} (${lead.email})`);
    } catch (error) {
      console.log(`  ⚠️ Lead may already exist: ${lead.email}`);
    }
  }
}

async function runOutreachSequence(userId: string, leads: any[]) {
  console.log('\n[4/5] Starting email outreach sequence...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const results: { email: string; status: string; subject?: string; error?: string }[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    console.log(`\n📧 [${i + 1}/${leads.length}] Processing: ${lead.name} (${lead.email})`);

    try {
      // Generate personalized HVAC email
      const emailContent = await generateHVACOutreachEmail({
        id: lead.id,
        name: lead.name,
        email: lead.email,
        company: lead.company
      });

      console.log(`   📝 Subject: "${emailContent.subject}"`);

      // Send the email
      await sendEmail(
        userId,
        lead.email,
        emailContent.body,
        emailContent.subject,
        { isHtml: false }
      );

      console.log(`   ✅ Email SENT successfully!`);

      // Save outbound message to database
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
        status: 'contacted',
        lastMessageAt: new Date(),
        metadata: {
          ...(lead.metadata || {}),
          outreach_sent: true,
          outreach_sent_at: new Date().toISOString(),
          follow_up_scheduled_at: new Date(Date.now() + SIX_HOURS_MS).toISOString()
        }
      });

      // Schedule 6-hour follow-up
      const followUpTime = new Date(Date.now() + SIX_HOURS_MS);
      await storage.createFollowUp({
        leadId: lead.id,
        userId,
        channel: 'email',
        scheduledAt: followUpTime,
        status: 'pending',
        context: {
          original_subject: emailContent.subject,
          campaign_type: 'hvac_followup',
          follow_up_number: 1
        }
      });
      console.log(`   📅 Follow-up scheduled for: ${followUpTime.toLocaleString()}`);

      // Create notification for real-time UI update
      await storage.createNotification({
        userId,
        type: 'system',
        title: '📧 HVAC Outreach Sent',
        message: `Email sent to ${lead.name} at ${lead.company || 'HVAC Company'}`,
        metadata: {
          leadId: lead.id,
          leadName: lead.name,
          leadEmail: lead.email,
          activityType: 'outreach_sent',
          campaign: 'hvac_initial'
        }
      });

      results.push({
        email: lead.email,
        status: 'sent',
        subject: emailContent.subject
      });
      sentCount++;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ FAILED: ${errorMsg}`);

      results.push({
        email: lead.email,
        status: 'failed',
        error: errorMsg
      });
      failedCount++;
    }

    // Delay between emails to avoid rate limiting (3 seconds)
    if (i < leads.length - 1) {
      console.log(`   ⏳ Waiting 3s before next email...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // Step 5: Print summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n[5/5] CAMPAIGN COMPLETE! 🎉');
  console.log('========================================');
  console.log(`✅ Emails Sent: ${sentCount}/${leads.length}`);
  console.log(`❌ Failed: ${failedCount}`);
  console.log(`📅 Follow-ups scheduled: ${sentCount} (in 6 hours)`);
  console.log('========================================\n');

  // Print detailed results
  console.log('📋 DETAILED RESULTS:');
  console.log('--------------------');
  results.forEach((r, i) => {
    if (r.status === 'sent') {
      console.log(`${i + 1}. ✅ ${r.email} - "${r.subject}"`);
    } else {
      console.log(`${i + 1}. ❌ ${r.email} - Error: ${r.error}`);
    }
  });

  console.log('\n🔔 NEXT STEPS:');
  console.log('- Check dashboard Inbox for sent messages');
  console.log('- Integration page will show updated message counts');
  console.log('- Follow-ups will auto-send in 6 hours');
  console.log('- Replies will appear in real-time inbox');
  console.log('\n');

  return { results, summary: { sent: sentCount, failed: failedCount, total: leads.length } };
}

// Run the campaign
runHVACOutreachCampaign()
  .then((result) => {
    console.log('Campaign finished successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Campaign error:', error);
    process.exit(1);
  });
