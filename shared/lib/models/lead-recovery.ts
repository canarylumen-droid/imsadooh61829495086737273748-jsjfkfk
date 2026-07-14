import mongoose, { Schema, type InferSchemaType } from "mongoose";

const leadRecoveryStateSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    isActive: { type: Boolean, default: false, index: true },
    lastSyncAt: { type: Date },
    syncRequestedAt: { type: Date },
    syncStatus: {
      type: String,
      enum: ["idle", "queued", "syncing", "completed", "failed"],
      default: "idle",
      index: true,
    },
    mailboxId: { type: String, index: true },
    isBusy: { type: Boolean, default: false },
    availableAt: { type: Date },
  },
  { timestamps: true }
);

leadRecoveryStateSchema.index({ tenantId: 1, mailboxId: 1 }, { unique: true, sparse: true });

const recoveredLeadSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    mailboxId: { type: String, index: true },
    sourceMailboxSnapshot: {
      provider: { type: String },
      accountType: { type: String },
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, default: "" },
    intent: {
      type: String,
      enum: ["Converted", "Ghosted", "Not-Interested", "Reply-Needed"],
      required: true,
      index: true,
    },
    deliverabilityStatus: {
      type: String,
      enum: ["safe", "risky", "invalid", "unknown"],
      default: "unknown",
    },
    followUpDraft: { type: String },
    conversationSummary: { type: String },
    lastMessageText: { type: String },
    lastMessageAt: { type: Date },
    brainstormedObjections: [
      {
        category: { type: String, required: true },
        rule: { type: String, required: true },
        evidence: { type: String },
        syncedAt: { type: Date },
      },
    ],
    sourceMessageIds: [{ type: String }],
  },
  { timestamps: true }
);

recoveredLeadSchema.index({ tenantId: 1, mailboxId: 1, email: 1 }, { unique: true });
recoveredLeadSchema.index({ tenantId: 1, createdAt: -1 });

const recoveryPromptConfigSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    systemPrompt: { type: String, required: true },
    userPromptTemplate: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const recoveryEventLogSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    action: { type: String, required: true, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

recoveryEventLogSchema.index({ tenantId: 1, timestamp: -1 });

const leadRecoveryObjectionSchema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    category: { type: String, required: true },
    rule: { type: String, required: true },
    evidence: { type: String },
    sourceLeadId: { type: Schema.Types.ObjectId, ref: "RecoveredLead" },
    createdBy: { type: String, enum: ["ai", "user"], default: "ai" },
  },
  { timestamps: true }
);

leadRecoveryObjectionSchema.index({ tenantId: 1, rule: 1 }, { unique: true });

export type LeadRecoveryStateDocument = InferSchemaType<typeof leadRecoveryStateSchema>;
export type RecoveredLeadDocument = InferSchemaType<typeof recoveredLeadSchema>;
export type RecoveryPromptConfigDocument = InferSchemaType<typeof recoveryPromptConfigSchema>;
export type RecoveryEventLogDocument = InferSchemaType<typeof recoveryEventLogSchema>;

export const LeadRecoveryState =
  mongoose.models.LeadRecoveryState || mongoose.model("LeadRecoveryState", leadRecoveryStateSchema);
export const RecoveredLead =
  mongoose.models.RecoveredLead || mongoose.model("RecoveredLead", recoveredLeadSchema);
export const RecoveryPromptConfig =
  mongoose.models.RecoveryPromptConfig || mongoose.model("RecoveryPromptConfig", recoveryPromptConfigSchema);
export const RecoveryEventLog =
  mongoose.models.RecoveryEventLog || mongoose.model("RecoveryEventLog", recoveryEventLogSchema);
export const LeadRecoveryObjection =
  mongoose.models.LeadRecoveryObjection || mongoose.model("LeadRecoveryObjection", leadRecoveryObjectionSchema);
