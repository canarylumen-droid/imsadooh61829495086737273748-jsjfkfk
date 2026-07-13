import { EventEmitter } from "events";
import { connectMongo } from "@shared/lib/mongo.js";
import { RecoveryEventLog } from "@shared/lib/models/lead-recovery.js";

export type RecoveryEventAction =
  | "SyncStarted"
  | "LeadAnalyzed"
  | "ObjectionDiscovered"
  | "DraftGenerated"
  | "RecoveryActivated"
  | "RecoveryDeactivated"
  | "MailboxStatusChecked"
  | "BrainstormSyncCompleted";

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
    await connectMongo();
    await RecoveryEventLog.create({
      tenantId: event.tenantId,
      action: event.action,
      payload: event.payload || {},
      timestamp: event.timestamp || new Date(),
    });
  } catch (error) {
    console.error("[LeadRecoveryEvents] Failed to persist event", error);
  }
});
