import { db, withDbRetry } from "@shared/lib/db/db.js";
import { campaignLeads, leads, notifications } from "@audnix/shared";
import { eq, and, or } from "drizzle-orm";
import { campaignQueue } from "./campaign-queue.js";
import { createLogger } from "@services/api-gateway/src/core/logger.js";
import { clusterSync } from "@shared/lib/realtime/redis-pubsub.js";

const log = createLogger("SEQUENCE-KILLER");

export interface SequenceKillResult {
  jobsRemoved: number;
  campaignLeadsUpdated: number;
  leadPaused: boolean;
  handoffNotified: boolean;
}

/**
 * Kill every pending automated sequence for a lead and flag it for human hand-off.
 * Called by InboundMessageAnalyzer the instant positive intent is detected.
 */
export async function killLeadSequence(
  leadId: string,
  userId: string,
  reason: string = "positive_intent_detected",
  intentLevel: string = "high",
  suggestedAction: string = "Lead expressed interest - manual hand-off required"
): Promise<SequenceKillResult> {
  const result: SequenceKillResult = {
    jobsRemoved: 0,
    campaignLeadsUpdated: 0,
    leadPaused: false,
    handoffNotified: false,
  };

  log.info("SEQUENCE-KILLER: Initiating kill for lead " + leadId + " (reason: " + reason + ")");

  // STEP 1: Mark all active campaignLeads rows as "replied".
  // This is the authoritative DB-level kill-switch checked by all queue processors.
  try {
    const updated = await withDbRetry(() =>
      db
        .update(campaignLeads)
        .set({
          status: "replied" as any,
          metadata: {
            sequenceKilledAt: new Date().toISOString(),
            sequenceKillReason: reason,
            intentLevel,
          } as any,
        })
        .where(
          and(
            eq(campaignLeads.leadId, leadId),
            or(
              eq(campaignLeads.status, "pending" as any),
              eq(campaignLeads.status, "queued" as any),
              eq(campaignLeads.status, "sent" as any),
              eq(campaignLeads.status, "processing" as any)
            )
          )
        )
        .returning({ id: campaignLeads.id })
    );
    result.campaignLeadsUpdated = updated.length;
    log.info("SEQUENCE-KILLER: Marked " + result.campaignLeadsUpdated + " campaignLeads row(s) as replied");
  } catch (e: any) {
    log.error("SEQUENCE-KILLER: campaignLeads update failed", { error: e.message });
  }

  // STEP 2: Set aiPaused=true - the deepest stop signal.
  // processSendBatch WHERE clause: eq(leads.aiPaused, false)
  try {
    const [updated] = await withDbRetry(() =>
      db
        .update(leads)
        .set({ aiPaused: true })
        .where(and(eq(leads.id, leadId), eq(leads.userId, userId)))
        .returning()
    );
    result.leadPaused = true;

    // Real-time notification
    if (updated) {
      clusterSync.notifyLeadsUpdated(userId, { event: 'UPDATE', lead: updated }).catch(() => {});
      clusterSync.notifyStatsCacheInvalidate(userId).catch(() => {});
    }
  } catch (e: any) {
    log.error("SEQUENCE-KILLER: aiPaused update failed", { error: e.message });
  }

  // STEP 3: Purge BullMQ delayed auto-reply jobs that carry this leadId.
  // Note: follow-up jobs carry campaignLeadId, not leadId. Those are caught by
  // the "replied" status check in the processor (step 1 above is sufficient).
  if (campaignQueue) {
    try {
      const PAGE = 200;
      let offset = 0;
      while (true) {
        const page = await campaignQueue.getDelayed(offset, offset + PAGE - 1);
        if (page.length === 0) break;
        let removed = 0;
        for (const job of page) {
          const jData = job.data as any;
          if (jData?.leadId !== leadId) continue;
          try {
            await job.remove();
            result.jobsRemoved++;
            removed++;
            log.info("SEQUENCE-KILLER: Removed BullMQ job " + job.id);
          } catch (removeErr: any) {
            if (removeErr.message?.includes("job scheduler")) {
              try {
                await campaignQueue!.removeJobScheduler(job.name);
                result.jobsRemoved++;
                removed++;
              } catch (_e) { }
            }
          }
        }
        offset += PAGE - removed;
        if (page.length < PAGE) break;
      }
      log.info("SEQUENCE-KILLER: Removed " + result.jobsRemoved + " BullMQ job(s) for lead " + leadId);
    } catch (e: any) {
      log.error("SEQUENCE-KILLER: BullMQ scan failed", { error: e.message });
    }
  }

  // STEP 4: Fire hand-off notification to user dashboard.
  try {
    await withDbRetry(() =>
      db.insert(notifications).values({
        userId,
        type: "conversion",
        title: "Hot Lead - Human Hand-off Required",
        message: "A lead expressed positive interest. AI sequence STOPPED. Action: " + suggestedAction,
        metadata: {
          leadId,
          intentLevel,
          reason,
          suggestedAction,
          killedAt: new Date().toISOString(),
        },
        isRead: false,
      })
    );
    result.handoffNotified = true;
    log.info("SEQUENCE-KILLER: Hand-off notification created for user " + userId);
  } catch (e: any) {
    log.warn("SEQUENCE-KILLER: Notification insert failed", { error: e.message });
  }

  log.info("SEQUENCE-KILLER: Kill complete for lead " + leadId, result);
  return result;
}