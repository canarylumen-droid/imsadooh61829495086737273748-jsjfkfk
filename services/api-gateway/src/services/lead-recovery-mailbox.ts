import { db } from "@shared/lib/db/db.js";
import { outreachCampaigns } from "@audnix/shared";
import { eq, and } from "drizzle-orm";

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
  try {
    const active = await db.select({ id: outreachCampaigns.id })
      .from(outreachCampaigns)
      .where(and(
        eq(outreachCampaigns.userId, tenantId),
        eq(outreachCampaigns.status, 'active')
      ));
    const activeIds = active.map((c: any) => c.id);
    return {
      mailboxId,
      isBusy: activeIds.length > 0,
      availableAt: activeIds.length > 0 ? new Date() : null,
      activeCampaignIds: activeIds,
    };
  } catch {
    return { mailboxId, isBusy: false, availableAt: null, activeCampaignIds: [] };
  }
}