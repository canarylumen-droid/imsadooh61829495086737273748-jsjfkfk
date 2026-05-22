import { connectMongo } from "@shared/lib/mongo.js";
import { RecoveryEventLog, type RecoveryEventLogDocument } from "@shared/lib/models/lead-recovery.js";

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
  | "DeliverabilityChecked";

export async function logRecoveryEvent(
  tenantId: string,
  action: LeadRecoveryWorkerEvent,
  payload: Record<string, unknown> = {}
): Promise<RecoveryEventLogDocument> {
  await connectMongo();
  return RecoveryEventLog.create({
    tenantId,
    action,
    payload,
    timestamp: new Date(),
  });
}
