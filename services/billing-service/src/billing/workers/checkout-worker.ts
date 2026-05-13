
import { db } from '@shared/lib/db/db.js';
import { 
  pendingPayments, 
  users, 
  leads,
  notifications,
  type PendingPayment,
  type User,
  type Lead
} from '@audnix/shared';
import { eq, and, or, isNull, gt } from 'drizzle-orm';
import { sendEmail } from "@shared/lib/channels/email.js";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { generateReply, generateEmailSubject } from "@services/brain-worker/src/ai-lib/core/ai-service.js";

// ───────────────────────────────────────────────────────────
// SYSTEM PROMPT: Initial Checkout Delivery Email
// Sent immediately after a call where the prospect agreed to pay.
// This is the FIRST touchpoint — highest-stakes email in the pipeline.
// ───────────────────────────────────────────────────────────
const CHECKOUT_EMAIL_SYSTEM_PROMPT = `
You are an elite sales closer and communication expert writing on behalf of a business owner.

Your task is to write a brief, high-converting "checkout delivery" email.
This email is sent to a prospect who VERBALLY AGREED to pay on a sales call.
They are warm, engaged, and expecting this link — your job is to make clicking it feel like the obvious next step.

## Rules
- Keep it SHORT — 3-5 sentences max. No fluff.
- Start with a warm, personalized opener that references the call you just had.
- Make finishing the purchase feel natural and low-friction, not transactional or pushy.
- The checkout link will be appended by the system — DO NOT include it in the body text. Write as if the link will appear on its own line below your text.
- Use 1-2 emojis naturally — energetic, not corporate.
- Sound like a human, not a CMS template.
- End with the sender's first name only on its own line (no "Best regards" or "Sincerely").
- NO placeholder text like [Your Name] or [Company] — the system will inject real values.

## Output Format
Return ONLY the email body text. Plain text, paragraph breaks with \\n\\n. No subject line.
`;

import { isValidURL } from '@shared/lib/utils/validation.js';
import { messages } from '@audnix/shared';
import { desc } from 'drizzle-orm';

export class CheckoutWorker {
  /**
   * Satisfies the service initialization in billing/index.ts.
   * Can be used for periodic cleanup or health checks.
   */
  async start() {
    console.log('✅ CheckoutWorker logic online');
  }

  /**

   * Processes a pending payment: generates a personalized AI email with the
   * user's checkout link and dispatches it. Updates payment status to 'sent'.
   */
  async processPendingPayment(paymentId: string): Promise<boolean> {
    try {
      console.log(`[CheckoutWorker] 🛠️ Processing payment ${paymentId}...`);
      
      // 1. Fetch payment, user, and lead
      const [payment] = await db.select().from(pendingPayments).where(eq(pendingPayments.id, paymentId)).limit(1);
      if (!payment) {
        console.error(`[CheckoutWorker] ❌ Payment record ${paymentId} not found.`);
        return false;
      }

      const [user] = await db.select().from(users).where(eq(users.id, payment.userId)).limit(1);
      if (!user) {
        console.error(`[CheckoutWorker] ❌ User ${payment.userId} not found.`);
        return false;
      }

      const [lead] = await db.select().from(leads).where(eq(leads.id, payment.leadId)).limit(1);
      if (!lead || !lead.email) {
        console.error(`[CheckoutWorker] ❌ Lead ${payment.leadId} not found or has no email.`);
        return false;
      }

      // 2. Determine checkout link — custom on this payment > user's default
      const checkoutLink = payment.customPaymentLink || user.defaultPaymentLink;
      
      if (!checkoutLink || !isValidURL(checkoutLink)) {
        console.warn(`[CheckoutWorker] ⚠️ Missing or invalid checkout link for user ${user.id}. Skipping autonomous dispatch for ${lead.email}.`);
        
        // Notify user about broken link
        await db.insert(notifications).values({
          userId: user.id,
          type: 'billing_issue',
          title: 'Payment Link Required 💳',
          message: `We couldn't send the checkout email to ${lead.name} because your payment link is missing or invalid. Please update it in Settings.`,
          metadata: { leadId: lead.id, paymentId: payment.id }
        });

        return false;
      }

      // 3. Build rich context for the AI
      const userPrompt = `
Write the initial checkout delivery email for this prospect.

## Prospect
- Name: ${lead.name}
- Company: ${lead.company || 'their company'}
- They just had a sales call and verbally agreed to purchase
${payment.amountDetected ? `- Deal value discussed on call: $${payment.amountDetected}` : ''}
${payment.readyToGoEmail ? `- Notes/context captured from the call: ${payment.readyToGoEmail}` : ''}

## Sender
- Name: ${user.name || 'The team'}
- Business: ${user.businessName || user.name || 'us'}

## Important
- The checkout link will be placed on its own line immediately after your email body. Do NOT include it in the text.
- Write a 3-5 sentence email body only.
- End with the sender's first name on its own line.
`;

      console.log(`[CheckoutWorker] 🤖 Generating AI checkout email for ${lead.email}...`);

      // 4. Generate AI email body
      const { text: aiBody } = await generateReply(
        CHECKOUT_EMAIL_SYSTEM_PROMPT,
        userPrompt,
        {
          temperature: 0.7,
          maxTokens: 250 // Keep it short and impactful
        }
      );

      // 5. Append the checkout link cleanly below the AI body
      const fullBody = `${aiBody.trim()}\n\n${checkoutLink}`;

      // 6.5. Fetch last message for threading context
      let inReplyTo: string | undefined = undefined;
      let references: string | undefined = undefined;
      let threadId: string | undefined = undefined;

      try {
        const lastMessages = await db.select()
          .from(messages)
          .where(eq(messages.leadId, lead.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        if (lastMessages.length > 0) {
          const lastMsg = lastMessages[0];
          const meta = (lastMsg.metadata as any) || {};
          inReplyTo = lastMsg.externalId || meta.externalId;
          threadId = meta.providerThreadId || meta.threadId;

          if (inReplyTo) {
            const prevRefs = meta.references || "";
            references = prevRefs ? `${prevRefs} ${inReplyTo}` : inReplyTo;
          }
        }
      } catch (threadErr) {
        console.warn(`[CheckoutWorker] Threading lookup failed for lead ${lead.id}:`, threadErr);
      }

      // 6. Generate a matching AI subject line
      const subject = await generateEmailSubject(aiBody, lead.name, lead.company || undefined);

      console.log(`[CheckoutWorker] 📧 Sending checkout email to ${lead.email} | Subject: "${subject}" | Threaded: ${!!threadId}`);

      // 7. Send email
      await sendEmail(user.id, lead.email, fullBody, subject, {
        buttonUrl: checkoutLink,
        buttonText: 'Complete Payment',
        leadId: lead.id,
        isRaw: false,
        inReplyTo,
        references,
        threadId
      });

      // 8. Update payment to 'sent' and store the generated email for reference
      await db.update(pendingPayments)
        .set({ 
          status: 'sent', 
          readyToGoEmail: fullBody,
          customPaymentLink: checkoutLink,
          updatedAt: new Date() 
        })
        .where(eq(pendingPayments.id, paymentId));

      console.log(`[CheckoutWorker] ✅ Checkout email dispatched for ${lead.email}`);
      
      wsSync.notifyLeadsUpdated(user.id, { event: 'UPDATE', leadId: lead.id });
      
      return true;
    } catch (error) {
      console.error('[CheckoutWorker] ❌ Failed to process pending payment:', paymentId, error);
      return false;
    }
  }
}

export const checkoutWorker = new CheckoutWorker();






