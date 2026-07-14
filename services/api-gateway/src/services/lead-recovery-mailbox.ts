import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@shared/lib/db/db.js";
import { outreachCampaigns, campaignLeads } from "@audnix/shared";

export interface MailboxCampaignStatus {
  mailboxId: string;
  isBusy: boolean;
  availableAt: Date | null;
  activeCampaignIds: string[];
}

export async function checkMailboxCampaignStatus(
  tenantId: string,
  mailboxId: string
): Promise<MailboxCampaignStatus> {
  const activeCampaigns = await db
    .select({
      id: outreachCampaigns.id,
      config: outreachCampaigns.config,
      stats: outreachCampaigns.stats,
      updatedAt: outreachCampaigns.updatedAt,
    })
    .from(outreachCampaigns)
    .where(and(eq(outreachCampaigns.userId, tenantId), eq(outreachCampaigns.status, "active")));

  const matchingCampaigns = activeCampaigns.filter((campaign: any) => {
    const mailboxIds = Array.isArray(campaign.config?.mailboxIds) ? campaign.config.mailboxIds : [];
    return mailboxIds.includes(mailboxId);
  });

  if (matchingCampaigns.length === 0) {
    return { mailboxId, isBusy: false, availableAt: null, activeCampaignIds: [] };
  }

  const campaignIds = matchingCampaigns.map((campaign) => campaign.id);
  const pendingRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignLeads)
    .where(and(inArray(campaignLeads.campaignId, campaignIds), inArray(campaignLeads.status, ["pending", "queued", "sent"])));

  const pendingCount = Number(pendingRows[0]?.count || 0);
  const combinedDailyLimit = matchingCampaigns.reduce((sum: number, campaign: any) => {
    const mailboxLimit = Number(campaign.config?.mailboxLimits?.[mailboxId] || 0);
    const campaignLimit = Number(campaign.config?.dailyLimit || 50);
    return sum + (mailboxLimit || campaignLimit || 50);
  }, 0);
  const estimatedDays = Math.max(1, Math.ceil(pendingCount / Math.max(1, combinedDailyLimit)));
  const availableAt = new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000);

  return {
    mailboxId,
    isBusy: true,
    availableAt,
    activeCampaignIds: campaignIds,
  };
}
