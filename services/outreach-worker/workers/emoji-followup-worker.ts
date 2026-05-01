import { db } from '@shared/lib/db/db.js';
import { 
  pendingPayments, 
  users, 
  leads, 
  type PendingPayment,
  type User,
  type Lead
} from '@audnix/shared';
import { eq, and, lt, sql } from 'drizzle-orm';
import { sendEmail } from "@shared/lib/channels/email.js";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { generateReply, generateEmailSubject } from "@services/brain-worker/src/ai-lib/core/ai-service.js";

// ───────────────────────────────────────────────────
// SYSTEM PROMPT: Enterprise Payment Follow-up Engine
// ───────────────────────────────────────────────────
const PAYMENT_FOLLOWUP_SYSTEM_PROMPT = `
You are an elite enterprise sales closer and communication expert writing on behalf of a business owner.

Your task is to write a highly professional, concise follow-up email to a lead who verbally agreed to proceed with a purchase on a sales call, but has not yet completed their manual payment confirmation.

## Rules
- Keep it SHORT (2-4 sentences max). Professional enterprise tone.
- Be formal but polite. Not desperate or pushy.
- Do NOT use ANY emojis under any circumstances.
- Sound like a REAL human executive, not an automated bot.
- Reference the fact that they agreed on the call.
- NEVER mention specific dollar amounts unless provided in the context.
- Assume they might just need a reminder, make it easy for them to just handle it.

## Sequences
- Round 1 (48h after send): Friendly reminder. Assume they are busy.
- Round 2 (72h after send): Direct follow-up. Reference holding their service spot.

Return ONLY the plain email body text.
`;

export class PaymentFollowupWorker {
  private isRunning = false;
  private interval: NodeJS.Timeout | null = null;

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("🚀 [PaymentFollowupWorker] Online - Enterprise payment follow-ups active");
    
    // Tick every hour
    this.interval = setInterval(() => this.tick(), 60 * 60 * 1000);
    setTimeout(() => this.tick(), 15000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log("🛑 [PaymentFollowupWorker] Stopped");
  }

  async tick() {
    // Stage 1: Global AI Policy Enforcement
    if (process.env.GLOBAL_AI_PAUSE === 'true') {
      console.warn("[PaymentFollowupWorker] 🛑 GLOBAL AI PAUSE ACTIVE. Skipping tick.");
      return;
    }

    try {
      const now = new Date();
      const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      // Join everything to avoid N+1 queries and save DB Quota limitations
      const activePayments = await db.select({
          payment: pendingPayments,
          user: users,
          lead: leads
      })
      .from(pendingPayments)
      .innerJoin(users, eq(users.id, pendingPayments.userId))
      .innerJoin(leads, eq(leads.id, pendingPayments.leadId))
      .where(
        and(
          eq(pendingPayments.status, 'sent'),
          lt(pendingPayments.updatedAt, fortyEightHoursAgo),
          // --- GLOBAL AI ENGINE TOGGLE CHECK (SQL LEVEL) ---
          sql`(${users.config}->>'autonomousMode')::boolean IS NOT FALSE`
        )
      );

      if (activePayments.length > 0) {
        console.log(`[PaymentFollowupWorker] 🔍 Found ${activePayments.length} payment(s) requiring follow-up`);
      }

      for (const { payment, user, lead } of activePayments) {
        if (!lead.email) {
          console.warn(`[PaymentFollowupWorker] ⚠ Skipping payment ${payment.id}: missing lead email`);
          continue;
        }

        const hoursElapsed = (now.getTime() - new Date(payment.updatedAt).getTime()) / (1000 * 60 * 60);
        
        let followUpRound: 1 | 2;
        if (hoursElapsed >= 72) {
          followUpRound = 2;
        } else if (hoursElapsed >= 48) {
          followUpRound = 1;
        } else {
          continue; // Not yet time
        }

        console.log(`[PaymentFollowupWorker] 🤖 Generating Round ${followUpRound} AI follow-up for ${lead.email}`);

        const userPrompt = `
Write a Round ${followUpRound} payment follow-up email for this prospect.

## Prospect Context
- Name: ${lead.name}
- Company: ${lead.company || 'their company'}
- They agreed to pay on a sales call.
- They were sent a payment link to complete but haven't replied to confirm.
- Hours since link was sent: approximately ${Math.round(hoursElapsed)} hours.

## Sender Context
- Your name (the sender): ${user.name || 'The team'}
- Business name: ${user.businessName || user.name || 'us'}
${payment.amountDetected ? `- Approximate deal value discussed: $${payment.amountDetected}` : ''}
${payment.readyToGoEmail ? `- Previously sent email summary: ${payment.readyToGoEmail.substring(0, 500)}` : ''}

## Instructions
- Round ${followUpRound === 1 ? '1: Friendly 48h check-in. Gentle reminder.' : '2: 72h follow-up. Direct check-in to confirm if they still want to proceed.'}
- Do NOT repeat phrases from the previous email.
- Ask them to let you know once they have clicked the link and completed payment so you can proceed.
`;

        try {
          const { text: aiBody } = await generateReply(
            PAYMENT_FOLLOWUP_SYSTEM_PROMPT,
            userPrompt,
            { 
              temperature: 0.4, // Less creative for enterprise
              maxTokens: 250     
            }
          );

          const subject = await generateEmailSubject(aiBody, lead.name, lead.company || undefined);

          console.log(`[PaymentFollowupWorker] 📧 Dispatching follow-up to ${lead.email} | Subject: "${subject}"`);

          await sendEmail(user.id, lead.email, aiBody, subject, {
            leadId: lead.id,
            isRaw: false
          });

          await db.update(pendingPayments)
            .set({ updatedAt: new Date() })
            .where(eq(pendingPayments.id, payment.id));

          wsSync.notifyLeadsUpdated(user.id, { event: 'UPDATE', leadId: lead.id });

        } catch (aiError) {
          console.error(`[PaymentFollowupWorker] ❌ AI generation failed for payment ${payment.id}:`, aiError);
        }
      }
    } catch (error) {
      console.error("[PaymentFollowupWorker] ❌ Tick error:", error);
    }
  }
}

export const emojiFollowupWorker = new PaymentFollowupWorker();






