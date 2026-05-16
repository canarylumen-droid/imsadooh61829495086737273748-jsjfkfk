import { Router, Request, Response } from "express";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuth, getCurrentUserId } from "../middleware/auth.js";
import { sendEmail } from "@shared/lib/channels/email.js";
import { sendInstagramMessage } from "@shared/lib/channels/instagram.js";

const router = Router();


/**
 * GET /api/messages/:leadId
 * Get messages for a lead with pagination
 */
router.get("/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId } = req.params;
    const { limit = "100", offset = "0" } = req.query;

    const lead = await storage.getLeadById(leadId as string);
    if (!lead || lead.userId !== userId) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const messages = await storage.getMessagesByLeadId(leadId as string);

    // Apply pagination
    const offsetNum = parseInt(offset as string) || 0;
    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const paginatedMessages = messages.slice(offsetNum, offsetNum + limitNum);

    res.json({
      messages: paginatedMessages,
      total: messages.length,
      hasMore: offsetNum + paginatedMessages.length < messages.length,
    });
  } catch (error: unknown) {
    console.error("Get messages error:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

/**
 * POST /api/messages/:leadId
 * Send a message to a lead
 */
router.post("/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId } = req.params;
    const { content, channel, subject } = req.body;

    let inReplyTo: string | undefined = undefined;
    let references: string | undefined = undefined;
    let threadId: string | undefined = undefined;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: "Message content is required" });
      return;
    }

    const lead = await storage.getLeadById(leadId as string);
    if (!lead || lead.userId !== userId) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const selectedChannel = channel || lead.channel;
    const messageBody = content.trim();

    let trackingId: string | undefined = undefined;

    // Actual sending logic
    try {
      if (selectedChannel === 'email') {
        if (!lead.email) {
          res.status(400).json({ error: "Lead has no email address" });
          return;
        }
        let emailSubject = subject;
        if (!emailSubject) {
          // Z AI: Craft a killer subject based on the email body and lead context
          try {
            const { generateEmailSubject } = await import('@services/brain-worker/src/ai-lib/core/ai-service.js');
            emailSubject = await generateEmailSubject(messageBody, lead.name, lead.company || undefined);
          } catch (e) {
            // Fast fallback — never block send
            emailSubject = `Re: ${lead.company || lead.name}`;
          }
        }

        // Generate professional tracking ID
        const { generateTrackingToken } = await import('@services/email-service/src/email/email-tracking.js');
        trackingId = generateTrackingToken();

        // --- REFINED THREADING LOGIC ---
        try {
          const history = await storage.getMessagesByLeadId(lead.id);
          if (history.length > 0) {
            // History is ordered by createdAt DESC in getMessagesByLeadId (usually)
            // Let's verify sort order or just find the most recent
            const lastMsg = history[0]; // storage.ts shows orderBy(desc(messages.createdAt))
            const meta = (lastMsg.metadata as any) || {};
            
            inReplyTo = lastMsg.externalId || meta.externalId;
            threadId = meta.providerThreadId || meta.threadId || (lead.metadata as any)?.providerThreadId;

            if (inReplyTo) {
              const prevRefs = meta.references || "";
              references = prevRefs ? `${prevRefs} ${inReplyTo}` : inReplyTo;
            }
          }
        } catch (threadErr) {
          console.warn("[MessagesRoute] Failed to fetch threading headers:", threadErr);
        }

        await sendEmail(userId, lead.email, messageBody, emailSubject, {
          isRaw: true,
          isHtml: true, // Force HTML for tracking pixel
          trackingId,
          leadId: lead.id,
          inReplyTo,
          references,
          threadId
        });

        // metadata should include trackingId for consistency if storage doesn't auto-handle it
        // and we will update the message record created below
      } else if (selectedChannel === 'instagram') {
        const leadMeta = lead.metadata as any;
        const igId = leadMeta?.instagram_id || leadMeta?.psid || lead.externalId;
        if (!igId) {
          res.status(400).json({ error: "Lead has no Instagram ID" });
          return;
        }
        // Fetch Credentials
        const oauth = await storage.getOAuthAccount(userId, 'instagram');
        if (!oauth || !oauth.accessToken) {
          res.status(400).json({ error: "Instagram not connected" });
          return;
        }
        const meta = (oauth.metadata as any) || {};
        const businessId = meta.instagram_business_account_id;
        if (!businessId) {
          res.status(400).json({ error: "Instagram business account ID missing" });
          return;
        }
        await sendInstagramMessage(oauth.accessToken, businessId, igId, messageBody);
      }
    } catch (sendError: any) {
      console.error("Sending error:", sendError);
      // Check for IMAP timeout specifically or general failure
      if (sendError.message?.toLowerCase().includes('timeout') || sendError.code === 'ETIMEDOUT') {
        res.status(504).json({ error: "Connection timed out. Retrying in background..." });
        return;
      }
      throw sendError;
    }

    const message = await storage.createMessage({
      leadId: leadId as string,
      userId,
      provider: selectedChannel,
      direction: "outbound",
      body: messageBody,
      subject: subject || undefined, // Store subject if provided
      audioUrl: null,
      trackingId: selectedChannel === 'email' ? trackingId : undefined,
      metadata: {
        manual: true,
        sentAt: new Date(),
        ...(trackingId ? { trackingId } : {}),
        inReplyTo,
        references,
        providerThreadId: threadId
      },
    });

    // Update lead last message time
    const updatedLead = await storage.updateLead(leadId as string, {
      lastMessageAt: new Date(),
      status: lead.status === "new" ? "open" : lead.status,
    });

    if (!updatedLead) {
      res.status(500).json({ error: "Failed to update lead status" });
      return;
    }

    // Notify via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyMessagesUpdated(userId, { leadId: leadId as string, message });
    wsSync.notifyLeadsUpdated(userId, { type: 'lead_updated', lead: updatedLead });
    
    // Explicit notification for Real-time Feedback (Sound / Animation)
    if (selectedChannel === 'email') {
      wsSync.notifyEmailSent(userId, { 
        leadId: leadId as string, 
        messageId: message.id,
        subject: message.subject || undefined
      });
    }

    if (!res.headersSent && !res.writableEnded) {
      res.json({
        message,
        leadStatus: updatedLead.status,
      });
    }
  } catch (error: unknown) {
    console.error("Send message error:", error);
    if (!res.headersSent && !res.writableEnded) {
      res.status(500).json({ error: "Failed to send message" });
    }
  }
});

/**
 * POST /api/messages/:leadId/read
 * Mark all notifications for this lead as read
 */
router.post("/:leadId/read", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId } = req.params;

    const lead = await storage.getLeadById(leadId as string);
    if (!lead || lead.userId !== userId) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    // Mark all notifications for this lead as read
    const notifications = await storage.getNotifications(userId);
    const leadNotifications = notifications.filter((n: any) =>
      n.metadata && (n.metadata as any).leadId === leadId && !n.read
    );
    for (const n of leadNotifications) {
      await storage.markNotificationAsRead(n.id);
    }

    // Notify client to update notification count/UI
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyNotification(userId, { type: 'update', action: 'read_all', leadId });

    res.json({ success: true });
  } catch (error: unknown) {
    console.error("Mark messages read error:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

export default router;


