import { EventEmitter } from "events";
import { connectMySql, createRecoveryEventLog } from "@shared/lib/mysql.js";

export type RecoveryEventAction =
  | "SyncStarted"
  | "LeadAnalyzed"
  | "ObjectionDiscovered"
  | "DraftGenerated"
  | "RecoveryActivated"
  | "RecoveryDeactivated"
  | "MailboxStatusChecked"
  | "BrainstormSyncCompleted"
  | "RecoverySent";

export interface RecoveryEvent {
  tenantId: string;
  action: RecoveryEventAction;
  payload?: Record<string, unknown>;
  timestamp?: Date;
}

class RecoveryEventBus extends EventEmitter {
  emitRecovery(event: RecoveryEvent): boolean {
    return this.emit("recovery:event", {
      ...event,
      timestamp: event.timestamp || new Date(),
      payload: event.payload || {},
    });
  }
}

export const recoveryEvents = new RecoveryEventBus();

recoveryEvents.on("recovery:event", async (event: RecoveryEvent) => {
  try {
    await connectMySql();
    await createRecoveryEventLog(event.tenantId, event.action, event.payload ?? {});
  } catch (error) {
    console.error("[LeadRecoveryEvents] Failed to persist event", error);
  }
});
