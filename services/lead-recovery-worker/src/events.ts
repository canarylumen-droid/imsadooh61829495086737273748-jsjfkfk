import { connectMySql, ensureTables } from "@shared/lib/mysql.js";
import { createRecoveryEventLog } from "@shared/lib/mysql.js";

export type LeadRecoveryWorkerEvent =
  | "SyncStarted"
  | "LeadAnalyzed"
  | "ObjectionDiscovered"
  | "DraftGenerated"
  | "RecoveryActivated"
  | "RecoveryDeactivated"
  | "MailboxStatusChecked"
  | "BrainstormSyncCompleted"
  | "SyncCompleted"
  | "SyncFailed"
  | "EmailFiltered"
  | "DeliverabilityChecked"
  | "SkippedInActiveCampaign"
  | "SkippedRecentActivity";

export async function logRecoveryEvent(
  tenantId: string,
  action: LeadRecoveryWorkerEvent,
  payload: Record<string, unknown> = {}
): Promise<{ id: string }> {
  await connectMySql();
  const result = await createRecoveryEventLog(tenantId, action, payload);
  return result || { id: '' };
}
