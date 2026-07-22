import { db } from "@shared/lib/db/db.js";
import { outreachCampaigns, campaignEmails } from "@audnix/shared";
import { eq, and, gt, sql, inArray } from "drizzle-orm";

export interface MailboxCampaignStatus {
  mailboxId: string;
  isBusy: boolean;
  availableAt: Date | null;
  activeCampaignIds: string[];
}

const CAMPAIGN_COOLDOWN_MINUTES = 10;

export async function checkMailboxCampaignStatus(
  tenantId: string,
  mailboxIds: string[]
): Promise<Map<string, MailboxCampaignStatus>> {
  const result = new Map<string, MailboxCampaignStatus>();
  const cooldown = new Date(Date.now() - CAMPAIGN_COOLDOWN_MINUTES * 60 * 1000);

  try {
    const [recentSends, activeCampaigns] = await Promise.all([
      db
        .select({
          integrationId: campaignEmails.integrationId,
          count: sql<number>`count(*)::int`,
        })
        .from(campaignEmails)
        .where(
          and(
            eq(campaignEmails.userId, tenantId),
            gt(campaignEmails.sentAt, cooldown),
            mailboxIds.length > 0
              ? inArray(campaignEmails.integrationId, mailboxIds.map(m => m as any))
              : undefined
          )
        )
        .groupBy(campaignEmails.integrationId),
      db
        .select({ id: outreachCampaigns.id })
        .from(outreachCampaigns)
        .where(
          and(
            eq(outreachCampaigns.userId, tenantId),
            eq(outreachCampaigns.status, "active")
          )
        ),
    ]);

    const activeIds = activeCampaigns.map((c: any) => c.id);
    const recentByMailbox = new Map(
      recentSends.map((r: any) => [r.integrationId, r.count])
    );

    for (const mailboxId of mailboxIds) {
      const recentCount = recentByMailbox.get(mailboxId) || 0;
      const isBusy = recentCount > 0 || activeIds.length > 0;
      result.set(mailboxId, {
        mailboxId,
        isBusy,
        availableAt: isBusy ? new Date(Date.now() + 60_000) : null,
        activeCampaignIds: activeIds,
      });
    }
  } catch {
    for (const mailboxId of mailboxIds) {
      result.set(mailboxId, {
        mailboxId,
        isBusy: false,
        availableAt: null,
        activeCampaignIds: [],
      });
    }
  }

  return result;
}