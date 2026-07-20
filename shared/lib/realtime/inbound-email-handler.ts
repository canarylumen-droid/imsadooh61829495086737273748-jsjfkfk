/**
 * Inbound Email Handler
 *
 * Processes INBOUND_EMAIL events from the Rust mailbox monitor.
 * Rust detects new emails via persistent IMAP IDLE connections,
 * publishes to Redis, and this handler:
 * 1. Matches sender to existing lead
 * 2. Creates message in DB
 * 3. Fires socket events to push to UI instantly
 *
 * This bypasses the Node.js IMAP ImapConnectionManager entirely —
 * the Rust IMAP worker handles all mailbox IDLE connections.
 */

let inboundHandlerInitialized = false;

export async function initInboundEmailHandler() {
  if (inboundHandlerInitialized) return;
  inboundHandlerInitialized = true;

  try {
    const { getRedisClient } = await import('@shared/lib/redis/redis.js');
    const client = await getRedisClient();
    if (!client) {
      console.warn('[InboundEmailHandler] Redis not available');
      return;
    }

    const subClient = client.duplicate();
    await subClient.connect();

    await subClient.subscribe('audnix-cluster:events', async (message: string) => {
      try {
        const data = JSON.parse(message);
        const eventType = data.type || data.event;

        if (eventType === 'INBOUND_EMAIL') {
          const payload = data.payload || data;
          await handleInboundEmail(payload);
        }
      } catch (e: any) {
        console.warn('[InboundEmailHandler] Parse error:', e.message);
      }
    });

    console.log('[InboundEmailHandler] 🟢 Listening for INBOUND_EMAIL events from Rust IMAP worker');
  } catch (e: any) {
    console.warn('[InboundEmailHandler] Init failed:', e.message);
  }
}

async function handleInboundEmail(payload: any) {
  const { integration_id, user_id, uid, message_id, from, to, subject, date, snippet, in_reply_to, raw_email } = payload;

  // Parse email body — prefer raw_email with proper MIME parsing
  let parsedBody = (snippet || '').substring(0, 10000);
  let parsedHtml: string | undefined;
  if (raw_email && raw_email.length > 0) {
    try {
      // Strip IMAP protocol framing if present (e.g., "* 58 FETCH (BODY[] {size}\n...")
      let rfc822 = raw_email;
      const bodyMatch = raw_email.match(/BODY\[\]\s*\{[^}]+\}\s*\n?([\s\S]*)/);
      if (bodyMatch) {
        rfc822 = bodyMatch[1].replace(/\n\)\s*$/, '').trim();
      }
      const { simpleParser } = await import('mailparser');
      const parsed = await simpleParser(rfc822);
      if (parsed.text) {
        parsedBody = parsed.text.substring(0, 10000);
      }
      if (parsed.html) {
        parsedHtml = parsed.html.substring(0, 10000);
        if (!parsed.text) {
          parsedBody = parsed.html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 10000);
        }
      }
    } catch (parseErr: any) {
      console.warn('[InboundEmailHandler] Failed to parse raw_email:', parseErr.message);
    }
  }
  if (!integration_id || !user_id) return;

  console.log(`[InboundEmailHandler] 📬 Processing inbound email (uid=${uid}, from=${from?.substring(0, 50)}, user=${user_id})`);

  try {
    const senderAddr = (from || '').toLowerCase().trim().replace(/.*<([^>]+)>.*/, '$1');
    if (!senderAddr) return;

    const integration = await getIntegration(integration_id);
    if (!integration || !integration.connected) {
      console.warn(`[InboundEmailHandler] Integration ${integration_id} not connected — skipping`);
      return;
    }

    // ── SELF-LOOP GUARD ──────────────────────────────────────────────
    let ownAddr = (integration.email || integration.accountType || '').toLowerCase().trim();
    if (!ownAddr && integration.encryptedMeta) {
      try {
        const { decrypt } = await import('@shared/lib/crypto/encryption.js');
        const meta = JSON.parse(decrypt(integration.encryptedMeta));
        ownAddr = (meta.smtp_user || meta.smtpUser || meta.user || meta.email || '').toLowerCase().trim();
      } catch { /* non-critical */ }
    }
    if (ownAddr && senderAddr === ownAddr) {
      console.log(`[InboundEmailHandler] Skipping self-sent email from ${senderAddr}`);
      return;
    }

    // ── LEAD MATCHING ─────────────────────────────────────────────────
    const { storage } = await import('@shared/lib/storage/storage.js');
    let lead = await storage.findLeadBySenderAndIntegration(senderAddr, integration_id);

    if (!lead) {
      // Try recipient match (cross-match for sent replies)
      const recipientAddr = (to || '').toLowerCase().trim().replace(/.*<([^>]+)>.*/, '$1');
      if (recipientAddr && recipientAddr !== senderAddr) {
        lead = await storage.findLeadBySenderAndIntegration(recipientAddr, integration_id);
      }
    }

    if (!lead) {
      // Fallback: match by userId + email (legacy leads with null integrationId)
      const { db } = await import('@shared/lib/db/db.js');
      const { eq, and, sql } = await import('drizzle-orm');
      const { leads: leadsSchema } = await import('@audnix/shared');
      const [byEmail] = await db.select().from(leadsSchema)
        .where(and(eq(leadsSchema.userId, user_id), sql`LOWER(${leadsSchema.email}) = LOWER(${senderAddr})`))
        .limit(1);
      lead = byEmail || null;
    }

    const senderName = (from || '').replace(/<[^>]+>/g, '').trim() || senderAddr.split('@')[0];
    const isNewLead = !lead;

    // ── PHASE 1: Push to UI BEFORE DB (instant) ──────────────────────
    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');

    await Promise.all([
      clusterSync.notifyNewMail(user_id, {
        integrationId: integration_id,
        messageId: message_id || `imap-${integration_id}-${uid}`,
        subject: subject || '(no subject)',
        from,
        snippet: parsedBody.substring(0, 200) || 'New message arriving...',
        date: date || new Date().toISOString(),
        isNew: !!lead,
      }),
      isNewLead ? Promise.resolve() : clusterSync.notifyMessagesUpdated(user_id, {
        leadId: lead!.id,
        direction: 'inbound',
        source: 'rust_imap',
      }),
      isNewLead ? Promise.resolve() : clusterSync.notifyLeadsUpdated(user_id, {
        leadId: lead!.id,
        status: 'replied',
        action: 'replied',
      }),
      clusterSync.notifyStatsUpdated(user_id, {
        integrationId: integration_id,
        type: isNewLead ? 'new_lead' : 'reply',
      }),
      clusterSync.notifyStatsCacheInvalidate(user_id),
    ]);

    console.log(`[InboundEmailHandler] ⚡ Phase 1 done — UI notified instantly for ${isNewLead ? 'NEW' : lead!.id}`);

    // ── DEDUP: Check if this message_id already exists ────────────────
    if (message_id) {
      try {
        const { db } = await import('@shared/lib/db/db.js');
        const { emailMessages } = await import('@audnix/shared');
        const { eq } = await import('drizzle-orm');
        const existing = await db.select({ id: emailMessages.id })
          .from(emailMessages)
          .where(eq(emailMessages.messageId, message_id))
          .limit(1);
        if (existing.length > 0) {
          console.log(`[InboundEmailHandler] ⏭️ Skipping duplicate message_id=${message_id} (already exists)`);
          return;
        }
      } catch { /* non-critical dedup check */ }
    }

    // ── PHASE 2: Save to DB ───────────────────────────────────────────

    // Create email_message record
    const saved = await storage.createEmailMessage({
      userId: user_id,
      integrationId: integration_id,
      messageId: message_id || `imap-${integration_id}-${uid}`,
      subject: subject || '(no subject)',
      from: from || '',
      to: to || '',
      body: parsedBody,
      direction: 'inbound',
      provider: integration.provider as any,
      sentAt: date ? new Date(date) : new Date(),
      leadId: lead?.id || null,
      campaignId: null,
      metadata: {
        uid,
        integrationId: integration_id,
        source: 'rust_imap_idle',
        htmlBody: parsedHtml?.substring(0, 10000),
        rawEmail: raw_email?.substring(0, 5000),
      },
    }).catch((err: any) => {
      console.error(`[InboundEmailHandler] DB save failed:`, err.message);
      return null;
    });

    if (lead && saved) {
      console.log(`[InboundEmailHandler] 📨 Matching lead ${lead.id} for inbound email. Saving message.`);
      try {
        await storage.createMessage({
          userId: user_id,
          leadId: lead.id,
          direction: 'inbound',
          body: parsedBody,
        });

        // Update lead + campaign status
        try {
          const { db } = await import('@shared/lib/db/db.js');
          const { leads: leadsSchema, campaignLeads, campaignEmails } = await import('@audnix/shared');
          const { eq, and } = await import('drizzle-orm');

          await db.update(leadsSchema)
            .set({ status: 'replied', updatedAt: new Date() })
            .where(eq(leadsSchema.id, lead.id));

          await db.update(campaignLeads)
            .set({ status: 'replied', repliedAt: new Date() } as any)
            .where(eq(campaignLeads.leadId, lead.id));

          await db.update(campaignEmails)
            .set({ status: 'replied' })
            .where(and(
              eq(campaignEmails.leadId, lead.id),
              eq(campaignEmails.status, 'sent')
            ));
        } catch (dbErr: any) {
          console.warn(`[InboundEmailHandler] Status update failed:`, dbErr.message);
        }

        // AI reply trigger
        try {
          const { enqueuePriorityReply } = await import('@shared/lib/queues/outreach-queue.js');
          await enqueuePriorityReply({ userId: user_id, leadId: lead.id, type: 'autonomous_reply', isAutonomous: true });
          console.log(`⚡ [InboundEmailHandler] Priority reply enqueued for lead ${lead.id}`);
        } catch (replyErr: any) {
          console.warn(`[InboundEmailHandler] AI reply enqueue failed:`, replyErr.message);
        }
      } catch (e: any) {
        console.error(`[InboundEmailHandler] Message creation failed:`, e.message);
      }
    } else if (isNewLead && saved) {
      // ── NEW LEAD FROM UNKNOWN SENDER ────────────────────────────────
      try {
        const { db } = await import('@shared/lib/db/db.js');
        const { leads: leadsSchema, emailMessages } = await import('@audnix/shared');
        const { eq } = await import('drizzle-orm');

        const [newLead] = await db.insert(leadsSchema).values({
          userId: user_id,
          integrationId: integration_id,
          email: senderAddr,
          name: senderName,
          channel: 'email',
          status: 'new',
          aiPaused: true,
          metadata: { source: 'rust_imap_inbound', integrationId: integration_id },
        }).returning();

        if (newLead) {
          if (saved?.id) {
            await db.update(emailMessages)
              .set({ leadId: newLead.id })
              .where(eq(emailMessages.id, saved.id)).catch(() => {});
          }

          await storage.createMessage({
            userId: user_id,
            leadId: newLead.id,
            direction: 'inbound',
            body: parsedBody,
          });

          lead = newLead;
          console.log(`[InboundEmailHandler] 🆕 Created lead ${newLead.id} for unknown sender ${senderAddr}`);

          // Notify UI about the new lead
          await clusterSync.notifyLeadsUpdated(user_id, {
            event: 'INSERT',
            lead: {
              id: newLead.id,
              email: senderAddr,
              name: senderName,
              status: 'new',
              snippet: parsedBody?.substring(0, 120),
              lastMessageAt: new Date().toISOString(),
            },
          });
        }
      } catch (leadErr: any) {
        console.error(`[InboundEmailHandler] Lead creation failed:`, leadErr.message);
      }
    }

    // ── PHASE 3: Final notification ─────────────────────────────────
    if (saved && (lead || isNewLead)) {
      await Promise.allSettled([
        clusterSync.notifyStatsUpdated(user_id, { integrationId: integration_id, type: isNewLead ? 'new_lead' : 'reply' }),
        clusterSync.notifyStatsCacheInvalidate(user_id),
      ]);
    }

    console.log(`[InboundEmailHandler] ✅ Processed inbound email uid=${uid} from ${senderAddr} (lead=${lead?.id || 'new'})`);
  } catch (e: any) {
    console.error(`[InboundEmailHandler] Error:`, e.message);
  }
}

// Integration cache (same pattern as email-sync-queue.ts)
const integrationCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 30000;

async function getIntegration(integrationId: string): Promise<any | null> {
  const cached = integrationCache.get(integrationId);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const data = await storage.getIntegrationById(integrationId);
    if (data) integrationCache.set(integrationId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return null;
  }
}
