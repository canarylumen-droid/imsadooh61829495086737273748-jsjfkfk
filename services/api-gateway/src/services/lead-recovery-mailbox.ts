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
  return { mailboxId, isBusy: false, availableAt: null, activeCampaignIds: [] };
}
