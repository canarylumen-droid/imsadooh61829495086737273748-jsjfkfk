import { z } from "zod";
import { pgTable, text, uuid, timestamp, boolean, integer, jsonb, varchar, real, uniqueIndex, customType, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// Custom type for PostgreSQL bytea
export const bytea = customType<{ data: any }>({
  dataType() {
    return 'bytea';
  },
  fromDriver(value: unknown) {
    if (typeof value === 'object' && value !== null && 'constructor' in value && (value as any).constructor.name === 'Buffer') return value;
    return value;
  },
  toDriver(value: any) {
    return value;
  },
});

export const smtpSettings = pgTable("smtp_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  user: text("user").notNull(),
  pass: text("pass").notNull(),
  secure: boolean("secure").notNull().default(true),
  dailySentCount: integer("daily_sent_count").notNull().default(0),
  yesterdaySentCount: integer("yesterday_sent_count").notNull().default(0),
  lastResetAt: timestamp("last_reset_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const smtpSettingsSelect = createSelectSchema(smtpSettings);
export const smtpSettingsInsert = createInsertSchema(smtpSettings);
export type SmtpSettings = z.infer<typeof smtpSettingsSelect>;
export type InsertSmtpSettings = z.infer<typeof smtpSettingsInsert>;

export const userSessions = pgTable("user_sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
}, (table) => ({
  expireIdx: index("IDX_user_sessions_expire").on(table.expire),
}));

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  supabaseId: text("supabase_id"),
  email: text("email").notNull().unique(),
  password: text("password"),
  name: text("name"),
  username: text("username"),
  avatar: text("avatar"),
  company: text("company"),
  timezone: text("timezone").notNull().default("America/New_York"),
  plan: text("plan", { enum: ["trial", "starter", "pro", "enterprise"] }).notNull().default("trial"),
  subscriptionTier: text("subscription_tier", { enum: ["free", "trial", "starter", "pro", "enterprise"] }).default("free"),
  trialExpiresAt: timestamp("trial_expires_at"),
  replyTone: text("reply_tone", { enum: ["friendly", "professional", "short"] }).notNull().default("professional"),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  voiceCloneId: text("voice_clone_id"),
  voiceMinutesUsed: real("voice_minutes_used").notNull().default(0),
  voiceMinutesTopup: real("voice_minutes_topup").notNull().default(0),
  businessName: text("business_name"),
  voiceRules: text("voice_rules"),
  pdfConfidenceThreshold: real("pdf_confidence_threshold").default(0.7),
  lastInsightGeneratedAt: timestamp("last_insight_generated_at"),
  lastProspectScanAt: timestamp("last_prospect_scan_at"),
  paymentStatus: text("payment_status").default("none"),
  pendingPaymentPlan: text("pending_payment_plan"),
  pendingPaymentAmount: real("pending_payment_amount"),
  pendingPaymentDate: timestamp("pending_payment_date"),
  paymentApprovedAt: timestamp("payment_approved_at"),
  stripeSessionId: text("stripe_session_id"),
  subscriptionId: text("subscription_id"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLogin: timestamp("last_login"),
  updatedAt: timestamp("updated_at").defaultNow(),
  calendarLink: text("calendar_link"),
  brandGuidelinePdfUrl: text("brand_guideline_pdf_url"),
  brandGuidelinePdfText: text("brand_guideline_pdf_text"),
  config: jsonb("config").default({ autonomousMode: false }),
  filteredLeadsCount: integer("filtered_leads_count").notNull().default(0),
  calendlyAccessToken: text("calendly_access_token"),
  calendlyRefreshToken: text("calendly_refresh_token"),
  calendlyExpiresAt: timestamp("calendly_expires_at"),
  calendlyUserUri: text("calendly_user_uri"),
  businessLogo: text("business_logo"),
  intelligenceMetadata: jsonb("intelligence_metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  defaultPaymentLink: text("default_payment_link"),
  offerDescription: text("offer_description"),
  offerValue: real("offer_value").default(0),
  offerDescription2: text("offer_description_2"),
  offerValue2: real("offer_value_2").default(0),
  appLink: text("app_link"),
  aiAdjustCopyEnabled: boolean("ai_adjust_copy_enabled").notNull().default(true),
  doubleOfferEnabled: boolean("double_offer_enabled").notNull().default(false),
  aiStickerFollowupsEnabled: boolean("ai_sticker_followups_enabled").notNull().default(true),
}, (table) => ({
  usersStripeCustomerIdx: index("users_stripe_customer_idx").on(table.stripeCustomerId),
  usersEmailIdx: index("users_email_idx").on(table.email),
}));

export const brandPdfCache = pgTable("brand_pdf_cache", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  fileHash: text("file_hash").notNull(),
  pdfContent: bytea("pdf_content"),
  extractedText: text("extracted_text"),
  brandContext: jsonb("brand_context").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  analysisScore: integer("analysis_score").default(0),
  analysisItems: jsonb("analysis_items").$type<any[]>().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  userIdHashIdx: uniqueIndex("brand_pdf_cache_user_id_hash_idx").on(table.userId, table.fileHash),
}));

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id"),
  name: text("name").notNull(),
  company: text("company"),
  role: text("role"),
  bio: text("bio"),
  snippet: text("snippet"),
  channel: text("channel", { enum: ["email", "linkedin", "sms", "voice", "whatsapp", "instagram"] }).notNull(),
  email: text("email"),
  replyEmail: text("reply_email"),
  phone: text("phone"),
  status: text("status", { enum: ["new", "open", "replied", "converted", "not_interested", "unsubscribed", "no_show", "cold", "hardened", "recovered", "bouncy", "booked", "warm", "qualified", "risky"] }).notNull().default("new"),
  verified: boolean("verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  score: integer("score").notNull().default(0),
  warm: boolean("warm").notNull().default(false),
  sentiment: text("sentiment", { enum: ["positive", "neutral", "negative"] }).default("neutral"),
  lastMessagePreview: text("last_message_preview"),
  lastMessageAt: timestamp("last_message_at"),
  lastEnrichedAt: timestamp("last_enriched_at"),
  aiPaused: boolean("ai_paused").notNull().default(true),
  pdfConfidence: real("pdf_confidence"),
  archived: boolean("archived").notNull().default(false),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  timezone: text("timezone"),
  calendlyLink: text("calendly_link"),
  fathomMeetingId: text("fathom_meeting_id"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  bant: jsonb("bant").$type<{
    budget?: string;
    authority?: string;
    need?: string;
    timeline?: string;
  }>().default(sql`'{}'::jsonb`),
  proceduralMemory: jsonb("procedural_memory").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  leadsUserIdIdx: index("leads_user_id_idx").on(table.userId),
  leadsIntegrationIdIdx: index("leads_integration_id_idx").on(table.integrationId),
  leadsStatusIdx: index("leads_status_idx").on(table.status),
  leadsArchivedIdx: index("leads_archived_idx").on(table.archived),
  leadsEmailIdx: index("leads_email_idx").on(table.email),
  leadsExternalIdIdx: index("leads_external_id_idx").on(table.externalId),
  leadsUserIdChannelIdx: index("leads_user_id_channel_idx").on(table.userId, table.channel),
  // Phase 15: Composite indices for sub-100ms dashboard queries
  leadsUserStatusIdx: index("leads_user_status_idx").on(table.userId, table.status),
  leadsUserEmailUnique: uniqueIndex("leads_user_email_unique_idx").on(table.userId, table.email),
  leadsLastMsgIdx: index("leads_last_msg_idx").on(table.lastMessageAt),
}));

export const domainVerifications = pgTable("domain_verifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  verificationResult: jsonb("verification_result").$type<Record<string, any>>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  domainUserIdx: uniqueIndex("domain_user_idx").on(table.userId, table.domain),
}));

/**
 * Lead Timezone Intelligence – Phase v2
 * Auto-populated on lead import from city + niche inference.
 * Drives niche-aware slot suggestions and natural-language copy.
 */
export const leadTimezoneProfiles = pgTable("lead_timezone_profiles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: uuid("lead_id").notNull().unique().references(() => leads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  detectedTimezone: text("detected_timezone"),              // e.g. "America/Chicago"
  detectedCity: text("detected_city"),                     // e.g. "Houston"
  niche: text("niche"),                                    // e.g. "plumbing", "real_estate"
  nicheCategory: text("niche_category"),                   // e.g. "trades", "professional_services"
  preferredContactStart: integer("preferred_contact_start").default(10),  // Hour 0-23 local
  preferredContactEnd: integer("preferred_contact_end").default(18),      // Hour 0-23 local
  preferredDays: jsonb("preferred_days").$type<string[]>().default(sql`'["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb`),
  detectionConfidence: real("detection_confidence").default(0),
  detectionSource: text("detection_source", {
    enum: ["city_niche_inference", "email_context", "manual", "none"]
  }).default("none"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  tzProfileLeadIdx: index("tz_profile_lead_idx").on(table.leadId),
  tzProfileUserIdx: index("tz_profile_user_idx").on(table.userId),
}));

export const leadTimezoneProfilesSelect = createSelectSchema(leadTimezoneProfiles);
export const leadTimezoneProfilesInsert = createInsertSchema(leadTimezoneProfiles);
export type LeadTimezoneProfile = z.infer<typeof leadTimezoneProfilesSelect>;
export type InsertLeadTimezoneProfile = z.infer<typeof leadTimezoneProfilesInsert>;




export const leadSocialDetails = pgTable("lead_social_details", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // linkedin, twitter, instagram, github, etc.
  profileUrl: text("profile_url").notNull(),
  handle: text("handle"),
  followersCount: integer("followers_count"),
  bio: text("bio"),
  lastActivityAt: timestamp("last_activity_at"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  verified: boolean("verified").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  leadPlatformIdx: uniqueIndex("lead_platform_idx").on(table.leadId, table.platform),
}));

export const leadSocialDetailsSelect = createSelectSchema(leadSocialDetails);
export const leadSocialDetailsInsert = createInsertSchema(leadSocialDetails);
// types are defined later in the file to avoid duplication


export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id"),
  provider: text("provider", { enum: ["instagram", "gmail", "email", "system"] }).notNull(),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  audioUrl: text("audio_url"),
  trackingId: text("tracking_id"),
  externalId: text("external_id"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  repliedAt: timestamp("replied_at"),
  isRead: boolean("is_read").notNull().default(false),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  uid: integer("uid"),
  targetUrl: text("target_url"),
  isWarmup: boolean("is_warmup").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  msgsUserIdIdx: index("msgs_user_id_idx").on(table.userId),
  msgsLeadIdIdx: index("msgs_lead_id_idx").on(table.leadId),
  msgsIntegrationIdIdx: index("msgs_integration_id_idx").on(table.integrationId),
}));

export const threads = pgTable("threads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  subject: text("subject"),
  lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const leadInsights = pgTable("lead_insights", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: uuid("lead_id").notNull().unique().references(() => leads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  intent: text("intent"), // "interested", "not_interested", "oos", "job_seeker", etc.
  intentScore: integer("intent_score").notNull().default(0),
  summary: text("summary"),
  nextNextStep: text("next_step"),
  competitors: jsonb("competitors").$type<string[]>().default(sql`'[]'::jsonb`),
  painPoints: jsonb("pain_points").$type<string[]>().default(sql`'[]'::jsonb`),
  budget: text("budget"),
  timeline: text("timeline"),
  lastAnalyzedAt: timestamp("last_analyzed_at"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["instagram", "gmail", "outlook", "manychat", "custom_email", "google_calendar", "calendly"] }).notNull(),
  encryptedMeta: text("encrypted_meta").notNull(),
  connected: boolean("connected").notNull().default(false),
  accountType: text("account_type"),
  lastSync: timestamp("last_sync"),
  // Mailbox health monitoring fields
  healthStatus: text("health_status", { enum: ["connected", "warning", "failed"] }).notNull().default("connected"),
  lastHealthError: text("last_health_error"),
  lastHealthCheckAt: timestamp("last_health_check_at"),
  mailboxPauseUntil: timestamp("mailbox_pause_until"),
  failureCount: integer("failure_count").notNull().default(0),
  dailyLimit: integer("daily_limit").notNull().default(50),
  spamRiskScore: real("spam_risk_score").notNull().default(0),
  aiAutonomousMode: boolean("ai_autonomous_mode").notNull().default(false),
  reputationScore: integer("reputation_score").notNull().default(100),
  healthLevel: text("health_level", { enum: ["healthy", "cautious", "poor", "critical"] }).notNull().default("healthy"),
  lastReputationCheck: timestamp("last_reputation_check"),
  sourceOfScore: text("source_of_score", { enum: ["local", "postmaster", "fbl"] }),
  gracefulDailyLimit: integer("graceful_daily_limit"),
  warmupStatus: text("warmup_status", { enum: ["active", "paused", "completed", "none"] }).notNull().default("none"),
  syncMetadata: jsonb("sync_metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  workerId: text("worker_id"),
  initialOutreachLimit: integer("initial_outreach_limit").notNull().default(50),
  warmupLimit: integer("warmup_limit").notNull().default(5),
  throttleUntil: timestamp("throttle_until"),
  originalDailyLimit: integer("original_daily_limit"),
  providerLimits: jsonb("provider_limits").$type<Record<string, {
    initialOutreachLimit: number;
    warmupLimit: number;
    reputationScore: number;
    healthLevel: string;
    dailySentCount: number;
    dailyBounceCount: number;
    dailySpamCount: number;
    lastAdjustmentAt: string;
  }>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  integrationsUserIdIdx: index('integrations_user_id_idx').on(table.userId),
  integrationsHealthStatusIdx: index('integrations_health_status_idx').on(table.healthStatus),
  integrationsConnectedIdx: index('integrations_connected_idx').on(table.connected),
}));

export const integrationReputation = pgTable("integration_reputation", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  integrationId: uuid("integration_id").notNull().unique().references(() => integrations.id, { onDelete: "cascade" }),
  score: integer("score").notNull().default(100),
  details: jsonb("details").$type<{
    spamhaus: { listed: boolean; score: number; lastChecked: string };
    abuseipdb: { score: number; categories: string[]; lastChecked: string };
    talos: { score: number; lastChecked: string };
    gmailPostmaster: { spamRate: number; reputation: string; lastChecked: string };
    microsoftSnds: { spamRate: number; volume: number; lastChecked: string };
  }>().notNull().default(sql`'{}'::jsonb`),
  sources: jsonb("sources").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  reputationScoreIdx: index('rep_score_idx').on(table.score),
}));

export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  brand: text("brand").notNull(),
  channel: text("channel", { enum: ["instagram", "email", "gmail", "manual"] }).notNull(),
  value: real("value").notNull(),
  status: text("status", { enum: ["open", "closed_won", "closed_lost", "pending"] }).notNull().default("open"),
  notes: text("notes"),
  convertedAt: timestamp("converted_at"),
  meetingScheduled: boolean("meeting_scheduled").notNull().default(false),
  meetingUrl: text("meeting_url"),
  dealValue: integer("deal_value").default(0),
  calendarLink: text("calendar_link"),
  source: text("source").default("manual"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  aiAnalysis: jsonb("ai_analysis").default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const voiceSettings = pgTable("voice_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(false),
  voiceSampleUrl: text("voice_sample_url"),
  voiceCloneId: text("voice_clone_id"),
  consentGiven: boolean("consent_given").notNull().default(false),
  minutesUsed: integer("minutes_used").notNull().default(0),
  minutesAllowed: integer("minutes_allowed").notNull().default(100),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const automations = pgTable("automations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  tone: text("tone", { enum: ["friendly", "professional", "short"] }).notNull().default("professional"),
  schedule: jsonb("schedule").$type<Array<{
    delay: string;
    action: string;
    channel: "instagram" | "email" | null;
    randomizationWindow: number;
  }>>().notNull().default(sql`'[]'::jsonb`),
  triggers: jsonb("triggers").$type<Array<{ condition: string; value: string }>>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  meetingUrl: text("meeting_url"),
  provider: text("provider", { enum: ["google", "outlook", "calendly"] }).notNull(),
  externalId: text("external_id").notNull(),
  attendees: jsonb("attendees").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  attendeeEmail: text("attendee_email"),
  attendeeName: text("attendee_name"),
  status: text("status", { enum: ["scheduled", "cancelled", "no_show", "completed"] }).notNull().default("scheduled"),
  isAiBooked: boolean("is_ai_booked").notNull().default(false),
  preCallNote: text("pre_call_note"),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Phase 15: Fast calendar range queries
  calEventsStartTimeIdx: index("cal_events_start_time_idx").on(table.startTime),
  calEventsUserIdIdx: index("cal_events_user_id_idx").on(table.userId),
}));

export const videoMonitors = pgTable("video_monitors", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  videoId: text("video_id").notNull(),
  videoUrl: text("video_url").notNull(),
  productLink: text("product_link").notNull(),
  ctaText: text("cta_text").notNull().default('Check it out'),
  isActive: boolean("is_active").notNull().default(true),
  autoReplyEnabled: boolean("auto_reply_enabled").notNull().default(true),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

export const processedComments = pgTable("processed_comments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  commentId: text("comment_id").notNull().unique(),
  videoMonitorId: uuid("video_monitor_id").references(() => videoMonitors.id, { onDelete: 'cascade' }),
  commenterUsername: text("commenter_username").notNull(),
  commentText: text("comment_text").notNull(),
  intentType: text("intent_type").notNull(),
  status: text("status", { enum: ['dm_sent', 'ignored', 'failed'] }).notNull().default('dm_sent'),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  processedAt: timestamp("processed_at").notNull().defaultNow()
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["webhook_error", "billing_issue", "conversion", "lead_reply", "system", "insight", "lead_import", "campaign_sent", "new_lead", "lead_status_change", "topup_success", "info", "email_bounce", "inbound_email", "mailbox_failure", "mailbox_warning", "lead_redistribution"] }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  actionUrl: text("action_url"),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const notificationsSelect = createSelectSchema(notifications);
export const notificationsInsert = createInsertSchema(notifications);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["trial", "starter", "pro", "enterprise"] }).notNull().default("trial"),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionId: text("subscription_id"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  invitedBy: uuid("invited_by"),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
});

export const teamMembersSelect = createSelectSchema(teamMembers);
export const teamMembersInsert = createInsertSchema(teamMembers);
export type TeamMember = z.infer<typeof teamMembersSelect>;
export type InsertTeamMember = z.infer<typeof teamMembersInsert>;

export const outreachCampaigns = pgTable("outreach_campaigns", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["draft", "active", "paused", "completed", "aborted"] }).notNull().default("draft"),
  excludeWeekends: boolean("exclude_weekends").notNull().default(false),
  stats: jsonb("stats").$type<{
    total: number;
    sent: number;
    replied: number;
    bounced: number;
  }>().default(sql`'{"total": 0, "sent": 0, "replied": 0, "bounced": 0}'::jsonb`),
  template: jsonb("template").$type<{
    subject: string;
    body: string;
    followups: Array<{ delayDays: number; subject?: string; body: string }>;
    autoReplyBody?: string;
  }>().notNull(),
  config: jsonb("config").$type<{
    dailyLimit: number;
    minDelayMinutes: number;
    maxDelayMinutes?: number;
    isManual?: boolean;
    replyEmail?: string;
    aiAdjustCopy?: boolean;
    threadFollowUp?: boolean;
  }>().notNull().default(sql`'{"dailyLimit": 50, "minDelayMinutes": 2, "maxDelayMinutes": 10}'::jsonb`),
  replyEmail: text("reply_email"),
  aiAutonomousMode: boolean("ai_autonomous_mode").notNull().default(false),
  proceduralMemory: jsonb("procedural_memory").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
}, (table) => ({
  campaignsUserIdIdx: index("campaigns_user_id_idx").on(table.userId),
  campaignsStatusIdx: index("campaigns_status_idx").on(table.status),
}));

export const userOutreachSettings = pgTable("user_outreach_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dailyLimit: integer("daily_limit").notNull().default(50),
  warmupEnabled: boolean("warmup_enabled").notNull().default(true),
  autoRedistribute: boolean("auto_redistribute").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

export const webhooks = pgTable("webhooks", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  secret: text("secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastTriggeredAt: timestamp("last_triggered_at"),
  failureCount: integer("failure_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key: text("key").notNull().unique(),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const prospects = pgTable("prospects", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  sessionId: uuid("session_id"),
  entity: text("entity").notNull(),
  industry: text("industry"),
  location: text("location"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  source: text("source", { enum: ["google", "bing", "maps", "instagram", "youtube", "facebook", "twitter", "tiktok", "pinterest", "linkedin", "manual"] }),
  snippet: text("snippet"),
  platforms: jsonb("platforms").$type<string[]>().default(sql`'[]'::jsonb`),
  socialProfiles: jsonb("social_profiles").$type<Record<string, string>>().default(sql`'{}'::jsonb`),
  wealthSignal: text("wealth_signal", { enum: ["high", "medium", "low"] }),
  leadScore: integer("lead_score").default(0),
  estimatedRevenue: text("estimated_revenue"),
  verified: boolean("verified").default(false),
  verifiedAt: timestamp("verified_at"),
  emailValid: boolean("email_valid"),
  status: text("status").default("found"),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  prospectsUserIdIdx: index("prospects_user_id_idx").on(table.userId),
  prospectsIntegrationIdIdx: index("prospects_integration_id_idx").on(table.integrationId),
}));

export const followUpQueue = pgTable("follow_up_queue", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: ["email", "linkedin", "sms", "voice", "whatsapp", "instagram"] }).notNull(),
  scheduledAt: timestamp("scheduled_at"),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  processedAt: timestamp("processed_at"),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  context: jsonb("context").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Phase 15: Critical for worker polling performance (avoids full-table scan)
  followUpScheduledStatusIdx: index("follow_up_scheduled_status_idx").on(table.scheduledAt, table.status),
  followUpUserIdIdx: index("follow_up_user_id_idx").on(table.userId),
  followUpIntegrationStatusIdx: index("follow_up_integration_status_idx").on(table.integrationId, table.status),
}));

export const emailWarmupSchedules = pgTable("email_warmup_schedules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  day: integer("day").notNull(), // 1-30
  dailyLimit: integer("daily_limit").notNull(), // emails to send today
  randomDelay: boolean("random_delay").notNull().default(true), // 2-12s delays
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const bounceTracker = pgTable("bounce_tracker", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
  bounceType: text("bounce_type", { enum: ["hard", "soft", "spam"] }).notNull(),
  email: text("email").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  period: jsonb("period").$type<{ start: Date; end: Date }>().notNull(),
  summary: text("summary").notNull(),
  metrics: jsonb("metrics").$type<{
    totalLeads: number;
    conversions: number;
    conversionRate: number;
    topChannel: string;
    topPerformingTime: string;
    avgResponseTime: string;
  }>().notNull(),
  channelBreakdown: jsonb("channel_breakdown").$type<Array<{
    channel: string;
    count: number;
    percentage: number;
  }>>().notNull(),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const emailTracking = pgTable("email_tracking", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject"),
  token: text("token").notNull().unique(),
  sentAt: timestamp("sent_at").notNull(),
  firstOpenedAt: timestamp("first_opened_at"),
  firstClickedAt: timestamp("first_clicked_at"),
  openCount: integer("open_count").notNull().default(0),
  clickCount: integer("click_count").notNull().default(0),
  targetUrl: text("target_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  emailTrackingUserIdIdx: index("email_tracking_user_id_idx").on(table.userId),
  emailTrackingIntegrationIdIdx: index("email_tracking_integration_id_idx").on(table.integrationId),
  emailTrackingTokenIdx: index("email_tracking_token_idx").on(table.token),
}));

export const emailEvents = pgTable("email_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull(),
  eventType: text("event_type", { enum: ["open", "click"] }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  linkUrl: text("link_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const emailMessages = pgTable("email_messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull().unique(),
  threadId: text("thread_id"),
  campaignId: uuid("campaign_id").references(() => outreachCampaigns.id, { onDelete: "set null" }),
  subject: text("subject"),
  from: text("from_address").notNull(),
  to: text("to_address").notNull(),
  body: text("body"),
  htmlBody: text("html_body"),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  provider: text("provider", { enum: ["gmail", "outlook", "custom_email"] }).notNull(),
  uid: integer("uid"),
  isRead: boolean("is_read").notNull().default(false),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at").notNull(),
  targetUrl: text("target_url"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  emailMsgsUserIdIdx: index("email_msgs_user_id_idx").on(table.userId),
  emailMsgsLeadIdIdx: index("email_msgs_lead_id_idx").on(table.leadId),
  emailMsgsThreadIdIdx: index("email_msgs_thread_id_idx").on(table.threadId),
}));

export const emailMessagesSelect = createSelectSchema(emailMessages);
export const emailMessagesInsert = createInsertSchema(emailMessages);
export type EmailMessage = z.infer<typeof emailMessagesSelect>;
export type InsertEmailMessage = z.infer<typeof emailMessagesInsert>;

export const usageTopups = pgTable("usage_topups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["leads", "voice"] }).notNull(),
  amount: real("amount").notNull(),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const brandEmbeddings = pgTable("brand_embeddings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  embedding: text("embedding"), // Vector stored as text in Neon
  snippet: text("snippet").notNull(),
  version: integer("version").notNull().default(1),
  documentId: uuid("document_id").default(sql`gen_random_uuid()`),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripePaymentId: text("stripe_payment_id"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("pending"),
  plan: text("plan"),
  paymentLink: text("payment_link"),
  webhookPayload: jsonb("webhook_payload").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const onboardingProfiles = pgTable("onboarding_profiles", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  completed: boolean("completed").notNull().default(false),
  userRole: text("user_role", { enum: ["creator", "founder", "developer", "agency", "freelancer", "other"] }),
  source: text("source"),
  useCase: text("use_case"),
  businessSize: text("business_size", { enum: ["solo", "small_team", "medium", "enterprise"] }),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["github", "google", "linkedin", "instagram", "facebook", "outlook"] }).notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  scope: text("scope"),
  tokenType: text("token_type"),
  idToken: text("id_token"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditTrail = pgTable("audit_trail", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // "ai_message_sent", "opt_out_toggled", "pdf_processed", "upload_rate_limited"
  messageId: uuid("message_id"),
  details: jsonb("details").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  auditTrailUserIdIdx: index('audit_trail_user_id_idx').on(table.userId),
  auditTrailCreatedAtIdx: index('audit_trail_created_at_idx').on(table.createdAt),
  auditTrailActionIdx: index('audit_trail_action_idx').on(table.action),
}));

export const pdfAnalytics = pgTable("pdf_analytics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  confidence: real("confidence").notNull(),
  missingFields: jsonb("missing_fields").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  leadsExtracted: integer("leads_extracted").notNull().default(0),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
});

export const uploadRateLimit = pgTable("upload_rate_limit", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  uploads: integer("uploads").notNull().default(0),
  lastResetAt: timestamp("last_reset_at").notNull().defaultNow(),
  windowSizeMinutes: integer("window_size_minutes").notNull().default(60),
});

export const otpCodes = pgTable("otp_codes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  verified: boolean("verified").notNull().default(false),
  passwordHash: text("password_hash"),
  purpose: text("purpose").default("login"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const calendarSettings = pgTable("calendar_settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  calendlyToken: text("calendly_token"),
  calendlyUsername: text("calendly_username"),
  calendlyEventTypeUri: text("calendly_event_type_uri"),
  googleCalendarEnabled: boolean("google_calendar_enabled").notNull().default(false),
  calendlyEnabled: boolean("calendly_enabled").notNull().default(false),
  autoBookingEnabled: boolean("auto_booking_enabled").notNull().default(false),
  minIntentScore: integer("min_intent_score").notNull().default(70),
  minTimingScore: integer("min_timing_score").notNull().default(60),
  meetingDuration: integer("meeting_duration").notNull().default(30),
  titleTemplate: text("title_template").notNull().default("{{lead_name}} - Discovery Call"),
  bufferBefore: integer("buffer_before").notNull().default(10),
  bufferAfter: integer("buffer_after").notNull().default(5),
  workingHoursStart: integer("working_hours_start").notNull().default(9),
  workingHoursEnd: integer("working_hours_end").notNull().default(17),
  timezone: text("timezone").notNull().default("America/New_York"),
  bookingPreference: text("booking_preference", { enum: ["link", "autonomous"] }).notNull().default("autonomous"),
  availabilityCache: jsonb("availability_cache").$type<Array<{ time: string; available: boolean }>>().notNull().default(sql`'[]'::jsonb`),
  availabilityCachedAt: timestamp("availability_cached_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const videoAssets = pgTable("video_assets", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull().default("instagram"),
  externalId: text("external_id").notNull(),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  purpose: text("purpose", { enum: ["education", "pitch", "proof", "entertainment", "other"] }),
  ctaLink: text("cta_link"),
  aiContext: text("ai_context"),
  enabled: boolean("enabled").notNull().default(true),
  impressionCount: integer("impression_count").notNull().default(0),
  dmSentCount: integer("dm_sent_count").notNull().default(0),
  conversionCount: integer("conversion_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const aiActionLogs = pgTable("ai_action_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  actionType: text("action_type", { enum: ["calendar_booking", "video_sent", "dm_sent", "follow_up", "objection_handled", "observation"] }).notNull(),
  decision: text("decision", { enum: ["act", "wait", "skip", "escalate"] }).notNull(),
  intentScore: integer("intent_score"),
  timingScore: integer("timing_score"),
  confidence: real("confidence"),
  reasoning: text("reasoning"),
  assetId: uuid("asset_id"),
  assetType: text("asset_type"),
  outcome: text("outcome"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const calendarBookings = pgTable("calendar_bookings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  provider: text("provider", { enum: ["calendly", "google", "outlook"] }).notNull(),
  externalEventId: text("external_event_id"),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  meetingUrl: text("meeting_url"),
  attendeeEmail: text("attendee_email"),
  attendeeName: text("attendee_name"),
  status: text("status", { enum: ["scheduled", "completed", "cancelled", "no_show"] }).notNull().default("scheduled"),
  isAiBooked: boolean("is_ai_booked").notNull().default(false),
  intentScoreAtBooking: integer("intent_score_at_booking"),
  confidenceAtBooking: real("confidence_at_booking"),
  bookingReason: text("booking_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Intelligence-governed automation rules (not trigger-based)
export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  ruleType: text("rule_type", { enum: ["follow_up", "objection_handler", "meeting_booking", "re_engagement"] }).notNull().default("follow_up"),
  channel: text("channel", { enum: ["instagram", "email", "all"] }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  minIntentScore: integer("min_intent_score").notNull().default(50),
  maxIntentScore: integer("max_intent_score").notNull().default(100),
  minConfidence: real("min_confidence").notNull().default(0.6),
  allowedActions: jsonb("allowed_actions").$type<Array<"reply" | "video" | "calendar" | "cta">>().notNull().default(sql`'["reply"]'::jsonb`),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(60),
  maxActionsPerDay: integer("max_actions_per_day").notNull().default(10),
  escalateOnLowConfidence: boolean("escalate_on_low_confidence").notNull().default(true),
  requireHumanApproval: boolean("require_human_approval").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Content library for AI to choose from
export const contentLibrary = pgTable("content_library", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["reply", "objection", "cta", "video"] }).notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  intentTags: jsonb("intent_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  objectionTags: jsonb("objection_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  channelRestriction: text("channel_restriction", { enum: ["instagram", "email", "all"] }).notNull().default("all"),
  isActive: boolean("is_active").notNull().default(true),
  usageCount: integer("usage_count").notNull().default(0),
  successRate: real("success_rate"),
  linkedVideoId: uuid("linked_video_id"),
  linkedCtaLink: text("linked_cta_link"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Conversation events for unified message ingestion
export const conversationEvents = pgTable("conversation_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  channel: text("channel", { enum: ["instagram", "email"] }).notNull(),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  content: text("content").notNull(),
  contentType: text("content_type", { enum: ["text", "image", "video", "audio", "file"] }).notNull().default("text"),
  externalId: text("external_id"),
  threadId: text("thread_id"),
  signals: jsonb("signals").$type<{
    behavioral?: Record<string, any>;
    commercial?: Record<string, any>;
    risk?: Record<string, any>;
  }>().notNull().default(sql`'{}'::jsonb`),
  processedByEngine: boolean("processed_by_engine").notNull().default(false),
  engineDecision: text("engine_decision", { enum: ["act", "wait", "skip", "escalate"] }),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const aiLearningPatterns = pgTable("ai_learning_patterns", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  patternKey: text("pattern_key").notNull(),
  strength: integer("strength").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => {
  return {
    userPatternIdx: uniqueIndex("user_pattern_idx").on(table.userId, table.patternKey),
  };
});

// ========== SCRAPING SESSIONS ==========

// Scraping session tracking
export const scrapingSessions = pgTable("scraping_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  niche: text("niche").notNull(),
  location: text("location").notNull(),
  status: text("status", { enum: ["running", "completed", "failed", "cancelled"] }).notNull().default("running"),
  totalFound: integer("total_found").notNull().default(0),
  verified: integer("verified").notNull().default(0),
  enriched: integer("enriched").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  sourcesScanned: jsonb("sources_scanned").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  proxyNodesUsed: integer("proxy_nodes_used").notNull().default(0),
  durationMs: integer("duration_ms"),
  errorLog: jsonb("error_log").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});



// Duplicate outreachCampaigns definition removed

export const campaignLeads = pgTable("campaign_leads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: uuid("campaign_id").notNull().references(() => outreachCampaigns.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "processing", "sent", "failed", "replied", "aborted", "queued"] }).notNull().default("pending"),
  currentStep: integer("current_step").notNull().default(0),
  nextActionAt: timestamp("next_action_at"),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  proceduralMemory: jsonb("procedural_memory").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => {
  return {
    campaignLeadIdx: uniqueIndex("campaign_lead_idx").on(table.campaignId, table.leadId),
    campaignLeadsNextActionIdx: index("campaign_leads_next_action_idx").on(table.campaignId, table.status, table.nextActionAt),
    campaignLeadsIntegrationIdx: index("campaign_leads_integration_idx").on(table.integrationId, table.status),
  };
});

export const adminWhitelist = pgTable("admin_whitelist", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  status: text("status").notNull().default("active"),
  role: text("role", { enum: ["admin", "superadmin"] }).notNull().default("admin"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});


export const campaignEmails = pgTable("campaign_emails", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: uuid("campaign_id").notNull().references(() => outreachCampaigns.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messageId: text("message_id").notNull(),
  subject: text("subject"),
  body: text("body"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  status: text("status", { enum: ["sending", "sent", "delivered", "opened", "clicked", "replied", "bounced", "suppressed"] }).notNull().default("sent"),
  stepIndex: integer("step_index").notNull().default(0),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "set null" }),
  targetUrl: text("target_url"),
  isWarmup: boolean("is_warmup").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
}, (table) => ({
  // PG-level idempotency guard — prevents duplicate sends at the database layer
  // even when two concurrent workers race past the SELECT check.
  ceCampaignLeadStepIdx: uniqueIndex("ce_campaign_lead_step_idx").on(table.campaignId, table.leadId, table.stepIndex),
  // High-throughput status scan for watchdog / analytics at 1M+ scale
  ceStatusSentAtIdx: index("ce_status_sent_at_idx").on(table.status, table.sentAt),
  // Reputation monitor: per-mailbox daily initial-send count (step 0 only)
  ceIntegrationStatusSentAtIdx: index("ce_integration_status_sent_at_idx").on(table.integrationId, table.status, table.sentAt),
}));

export const emailReplyStore = pgTable("email_reply_store", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: text("message_id").notNull().unique(),
  inReplyTo: text("in_reply_to").notNull(),
  campaignId: uuid("campaign_id").references(() => outreachCampaigns.id, { onDelete: "set null" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromAddress: text("from_address").notNull(),
  subject: text("subject"),
  body: text("body"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
});

export const aiProcessLogs = pgTable("ai_process_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "import_csv", "email_verification", etc.
  status: text("status", { enum: ["processing", "completed", "failed"] }).notNull().default("processing"),
  totalItems: integer("total_items").notNull().default(0),
  processedItems: integer("processed_items").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});


// Generate insert schemas from Drizzle tables
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertIntegrationSchema = createInsertSchema(integrations).omit({ id: true, createdAt: true });
export const insertDealSchema = createInsertSchema(deals);
export const insertVoiceSettingSchema = createInsertSchema(voiceSettings);
export const insertAutomationSchema = createInsertSchema(automations);
export const insertCalendarEventSchema = createInsertSchema(calendarEvents);
export const insertNotificationSchema = createInsertSchema(notifications);
export const insertWebhookSchema = createInsertSchema(webhooks);
export const insertApiKeySchema = createInsertSchema(apiKeys);
export const insertInsightSchema = createInsertSchema(insights);
export const insertPaymentSchema = createInsertSchema(payments);
export const insertBrandEmbeddingSchema = createInsertSchema(brandEmbeddings);
export const insertOnboardingProfileSchema = createInsertSchema(onboardingProfiles);
export const insertOAuthAccountSchema = createInsertSchema(oauthAccounts);
export const insertOtpCodeSchema = createInsertSchema(otpCodes);
export const insertEmailWarmupScheduleSchema = createInsertSchema(emailWarmupSchedules);
export const insertBounceTrackerSchema = createInsertSchema(bounceTracker);
export const insertCalendarSettingsSchema = createInsertSchema(calendarSettings);
export const insertVideoAssetSchema = createInsertSchema(videoAssets);
export const insertAiActionLogSchema = createInsertSchema(aiActionLogs);
export const insertAiProcessLogSchema = createInsertSchema(aiProcessLogs);
export const insertCalendarBookingSchema = createInsertSchema(calendarBookings);
export const insertAutomationRuleSchema = createInsertSchema(automationRules);
export const insertContentLibrarySchema = createInsertSchema(contentLibrary);
export const insertConversationEventSchema = createInsertSchema(conversationEvents);
export const insertThreadSchema = createInsertSchema(threads);
export const insertLeadInsightSchema = createInsertSchema(leadInsights);
export const insertProspectSchema = createInsertSchema(prospects);
export const insertScrapingSessionSchema = createInsertSchema(scrapingSessions);
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertTeamMemberSchema = createInsertSchema(teamMembers).omit({ id: true, invitedAt: true });
export const insertBrandPdfCacheSchema = createInsertSchema(brandPdfCache);
export const insertAdminWhitelistSchema = createInsertSchema(adminWhitelist);
export const insertAiLearningPatternSchema = createInsertSchema(aiLearningPatterns);

// Types from Drizzle
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type BrandEmbedding = typeof brandEmbeddings.$inferSelect;
export type InsertBrandEmbedding = typeof brandEmbeddings.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;
export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = typeof integrations.$inferInsert;
export type Deal = typeof deals.$inferSelect;
export type InsertDeal = typeof deals.$inferInsert;
export type VoiceSetting = typeof voiceSettings.$inferSelect;
export type InsertVoiceSetting = typeof voiceSettings.$inferInsert;
export type Automation = typeof automations.$inferSelect;
export type InsertAutomation = typeof automations.$inferInsert;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = typeof calendarEvents.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;
export type Webhook = typeof webhooks.$inferSelect;
export type InsertWebhook = typeof webhooks.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
export type Insight = typeof insights.$inferSelect;
export type InsertInsight = typeof insights.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;
export type OnboardingProfile = typeof onboardingProfiles.$inferSelect;
export type InsertOnboardingProfile = typeof onboardingProfiles.$inferInsert;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type InsertOAuthAccount = typeof oauthAccounts.$inferInsert;
// ========== TEAM MEMBERS ==========
// Types from Drizzle
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;
export type OtpCode = typeof otpCodes.$inferSelect;
export type InsertOtpCode = typeof otpCodes.$inferInsert;
export type EmailWarmupSchedule = typeof emailWarmupSchedules.$inferSelect;
export type InsertEmailWarmupSchedule = typeof emailWarmupSchedules.$inferInsert;
export type BounceTracker = typeof bounceTracker.$inferSelect;
export type InsertBounceTracker = typeof bounceTracker.$inferInsert;
export type VideoMonitor = typeof videoMonitors.$inferSelect;
export type InsertVideoMonitor = typeof videoMonitors.$inferInsert;
export type ProcessedComment = typeof processedComments.$inferSelect;
export type InsertProcessedComment = typeof processedComments.$inferInsert;
export type CalendarSetting = typeof calendarSettings.$inferSelect;
export type InsertCalendarSetting = typeof calendarSettings.$inferInsert;
export type VideoAsset = typeof videoAssets.$inferSelect;
export type InsertVideoAsset = typeof videoAssets.$inferInsert;
export type AiActionLog = typeof aiActionLogs.$inferSelect;
export type InsertAiActionLog = typeof aiActionLogs.$inferInsert;
export type CalendarBooking = typeof calendarBookings.$inferSelect;
export type InsertCalendarBooking = typeof calendarBookings.$inferInsert;
export type AutomationRule = typeof automationRules.$inferSelect;
export type InsertAutomationRule = typeof automationRules.$inferInsert;
export type ContentLibraryItem = typeof contentLibrary.$inferSelect;
export type InsertContentLibraryItem = typeof contentLibrary.$inferInsert;
export type ConversationEvent = typeof conversationEvents.$inferSelect;
export type InsertConversationEvent = typeof conversationEvents.$inferInsert;
export type Prospect = typeof prospects.$inferSelect;
export type InsertProspect = typeof prospects.$inferInsert;
export type LeadSocialDetail = typeof leadSocialDetails.$inferSelect;
export type InsertLeadSocialDetail = typeof leadSocialDetails.$inferInsert;

export const fathomCalls = pgTable("fathom_calls", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  fathomMeetingId: text("fathom_meeting_id").notNull(),
  title: text("title"),
  summary: text("summary"),
  transcript: text("transcript"),
  videoUrl: text("video_url"),
  videoThumbnail: text("video_thumbnail"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  analysis: jsonb("analysis").$type<{
    outcome: "closed" | "followed_up" | "lost" | "no_show";
    coaching: {
      strengths: string[];
      weaknesses: string[];
      improvements: string[];
      progressAudit?: string;
    };
    bant?: {
      budget?: string;
      authority?: string;
      need?: string;
      timeline?: string;
    };
    primaryObjection?: {
      category: "pricing" | "competitor" | "trust" | "timing" | "features" | "other";
      snippet: string;
    };
    sentimentPivot?: {
      quote: string;
      shift: "positive" | "negative";
    };
    talkRatio?: number;
    bookingFailureReason?: string;
    suggestedAction: string;
    agreedToPay?: boolean;
    paymentAmount?: string;
    automatedActionTaken?: string;
    status?: string;
    error?: string;
  }>().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  fathomCallsMeetingIdx: uniqueIndex("fathom_calls_meeting_idx").on(table.fathomMeetingId, table.leadId),
  fathomCallsLeadIdx: index("fathom_calls_lead_idx").on(table.leadId),
}));

export const fathomCallsSelect = createSelectSchema(fathomCalls);
export const fathomCallsInsert = createInsertSchema(fathomCalls);
export type FathomCall = typeof fathomCalls.$inferSelect;
export type InsertFathomCall = typeof fathomCalls.$inferInsert;

export const pendingPayments = pgTable("pending_payments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  fathomMeetingId: text("fathom_meeting_id"),
  status: text("status", { enum: ["pending", "sent", "paid", "expired"] }).notNull().default("pending"),
  readyToGoEmail: text("ready_to_go_email"),
  customPaymentLink: text("custom_payment_link"),
  amountDetected: real("amount_detected"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  pendingPaymentsLeadIdx: index("pending_payments_lead_idx").on(table.leadId),
  pendingPaymentsUserStatusIdx: index("pending_payments_user_status_idx").on(table.userId, table.status),
}));

export const pendingPaymentsSelect = createSelectSchema(pendingPayments);
export const pendingPaymentsInsert = createInsertSchema(pendingPayments);
export type PendingPayment = typeof pendingPayments.$inferSelect;
export type InsertPendingPayment = typeof pendingPayments.$inferInsert;

export const aiStickerMetrics = pgTable("ai_sticker_metrics", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stickerId: text("sticker_id").notNull(),
  provider: text("provider", { enum: ["giphy"] }).notNull().default("giphy"),
  url: text("url").notNull(),
  associatedNiche: text("associated_niche"),
  sentiment: text("sentiment"),
  conversionWeight: real("conversion_weight").notNull().default(1.0),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  aiStickerMetricsUserStickerIdx: index("ai_sticker_metrics_user_sticker_idx").on(table.userId, table.stickerId),
}));

export const aiStickerMetricsSelect = createSelectSchema(aiStickerMetrics);
export const aiStickerMetricsInsert = createInsertSchema(aiStickerMetrics);
export type AiStickerMetric = typeof aiStickerMetrics.$inferSelect;
export type InsertAiStickerMetric = typeof aiStickerMetrics.$inferInsert;

export const prospectObjections = pgTable("prospect_objections", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  fathomMeetingId: text("fathom_meeting_id"),
  category: text("category", { enum: ["pricing", "competitor", "trust", "timing", "features", "other"] }).notNull(),
  snippet: text("snippet").notNull(),
  isResolved: boolean("is_resolved").default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  objectionsLeadIdx: index("objections_lead_idx").on(table.leadId),
}));

export const prospectObjectionsSelect = createSelectSchema(prospectObjections);
export const prospectObjectionsInsert = createInsertSchema(prospectObjections);
export type ProspectObjection = typeof prospectObjections.$inferSelect;
export type InsertProspectObjection = typeof prospectObjections.$inferInsert;

export type BrandPdfCache = typeof brandPdfCache.$inferSelect;
export type InsertBrandPdfCache = typeof brandPdfCache.$inferInsert;
export type AdminWhitelist = typeof adminWhitelist.$inferSelect;
export type InsertAdminWhitelist = typeof adminWhitelist.$inferInsert;

export type OutreachCampaign = typeof outreachCampaigns.$inferSelect;
export type InsertOutreachCampaign = typeof outreachCampaigns.$inferInsert;
export type CampaignLead = typeof campaignLeads.$inferSelect;
export type InsertCampaignLead = typeof campaignLeads.$inferInsert;

export type FollowUpQueue = typeof followUpQueue.$inferSelect;
export type InsertFollowUpQueue = typeof followUpQueue.$inferInsert;

export type AiLearningPattern = typeof aiLearningPatterns.$inferSelect;
export type InsertAiLearningPattern = typeof aiLearningPatterns.$inferInsert;

export type Thread = typeof threads.$inferSelect;
export type InsertThread = typeof threads.$inferInsert;
export type LeadInsight = typeof leadInsights.$inferSelect;
export type InsertLeadInsight = typeof leadInsights.$inferInsert;

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(), // Use simple object instead of complex parsing
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions);
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;



export type AuditTrail = typeof auditTrail.$inferSelect;
export type InsertAuditTrail = typeof auditTrail.$inferInsert;

// LEGACY - Keep old Zod schemas for backward compatibility (deprecated)
export const userSchema = z.object({
  id: z.string().uuid(),
  supabaseId: z.string().nullable(),
  email: z.string().email(),
  name: z.string().nullable(),
  username: z.string().nullable(),
  avatar: z.string().url().nullable(),
  company: z.string().nullable(),
  timezone: z.string().default("America/New_York"),
  plan: z.enum(["trial", "starter", "pro", "enterprise"]).default("trial"),
  trialExpiresAt: z.date().nullable(),
  replyTone: z.enum(["friendly", "professional", "short"]).default("professional"),
  role: z.enum(["admin", "member"]).default("member"),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  createdAt: z.date(),
  lastLogin: z.date().nullable(),
});

// ========== LEADS ==========
export const leadSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  externalId: z.string().nullable(),
  name: z.string(),
  channel: z.enum(["instagram", "email"]),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  bio: z.string().nullable(),
  status: z.enum(["new", "open", "replied", "converted", "not_interested", "cold", "hardened", "recovered", "bouncy"]).default("new"),
  verified: z.boolean().default(false),
  verifiedAt: z.date().nullable(),
  score: z.number().min(0).max(100).default(0),
  warm: z.boolean().default(false),
  lastMessageAt: z.date().nullable(),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.any()).default({}),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ========== MESSAGES ==========
export const messageSchema = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.enum(["instagram", "gmail"]),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string(),
  audioUrl: z.string().url().nullable(),
  trackingId: z.string().nullable(),
  openedAt: z.date().nullable(),
  clickedAt: z.date().nullable(),
  repliedAt: z.date().nullable(),
  metadata: z.record(z.any()).default({}),
  createdAt: z.date(),
});

// ========== DEALS ==========
export const dealSchema = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  userId: z.string().uuid(),
  brand: z.string(),
  channel: z.enum(["instagram", "email"]),
  value: z.number(),
  status: z.enum(["converted", "lost", "pending"]).default("pending"),
  notes: z.string().nullable(),
  convertedAt: z.date().nullable(),
  meetingScheduled: z.boolean().default(false),
  meetingUrl: z.string().url().nullable(),
  createdAt: z.date(),
});

// ========== INTEGRATIONS ==========
export const integrationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.enum(["instagram", "gmail", "outlook", "manychat", "custom_email"]),
  encryptedMeta: z.string(), // Encrypted credentials as string (iv:tag:ciphertext)
  connected: z.boolean().default(false),
  accountType: z.enum(["personal", "creator", "business"]).nullable(),
  lastSync: z.date().nullable(),
  createdAt: z.date(),
});

// ========== VOICE SETTINGS ==========
export const voiceSettingSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  isActive: z.boolean().default(false),
  voiceSampleUrl: z.string().url().nullable(),
  voiceCloneId: z.string().nullable(),
  consentGiven: z.boolean().default(false),
  minutesUsed: z.number().default(0),
  minutesAllowed: z.number().default(100),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ========== AUTOMATIONS ==========
export const automationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  isActive: z.boolean().default(true),
  tone: z.enum(["friendly", "professional", "short"]).default("professional"),
  schedule: z.array(z.object({
    delay: z.string(), // "12h", "24h", "48h", "72h", "7d"
    action: z.string(), // "send_message", "escalate_channel", "send_voice"
    channel: z.enum(["instagram", "email"]).nullable(),
    randomizationWindow: z.number().default(0), // Minutes of variance
  })).default([]),
  triggers: z.array(z.object({
    condition: z.string(),
    value: z.string(),
  })).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ========== CALENDAR EVENTS ==========
export const calendarEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  leadId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  startTime: z.date(),
  endTime: z.date(),
  meetingUrl: z.string().url().nullable(),
  provider: z.enum(["google", "outlook"]),
  externalId: z.string(),
  attendees: z.array(z.string().email()).default([]),
  isAiBooked: z.boolean().default(false),
  preCallNote: z.string().nullable(),
  createdAt: z.date(),
});

// ========== NOTIFICATIONS ==========
export const notificationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.enum(["webhook_error", "billing_issue", "conversion", "lead_reply", "system", "insight", "lead_import", "campaign_sent", "new_lead", "lead_status_change", "topup_success", "info", "email_bounce", "inbound_email"]),
  title: z.string(),
  message: z.string(),
  isRead: z.boolean().default(false),
  actionUrl: z.string().url().nullable(),
  metadata: z.record(z.any()).default({}),
  createdAt: z.date(),
});

// Duplicate TEAM MEMBERS block removed

// ========== WEBHOOKS ==========
export const webhookSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  url: z.string().url(),
  events: z.array(z.string()).default([]),
  secret: z.string(),
  isActive: z.boolean().default(true),
  lastTriggeredAt: z.date().nullable(),
  failureCount: z.number().default(0),
  createdAt: z.date(),
});

// ========== ADMIN METRICS ==========
export const adminMetricsSchema = z.object({
  totalUsers: z.number(),
  activeUsers: z.number(),
  trialUsers: z.number(),
  paidUsers: z.number(),
  mrr: z.number(),
  apiBurn: z.number(),
  failedJobs: z.number(),
  storageUsed: z.number(),
  timestamp: z.date(),
});

export type AdminMetrics = z.infer<typeof adminMetricsSchema>;

// ========== USAGE STATS ==========
export const usageStatsSchema = z.object({
  userId: z.string().uuid(),
  plan: z.enum(["trial", "starter", "pro", "enterprise"]),
  leadsCount: z.number(),
  leadsLimit: z.number(),
  voiceMinutesUsed: z.number(),
  voiceMinutesLimit: z.number(),
  messagesThisMonth: z.number(),
  storageUsed: z.number(),
  period: z.object({
    start: z.date(),
    end: z.date(),
  }),
});

export type UsageStats = z.infer<typeof usageStatsSchema>;

// ========== INSIGHTS ==========
export const insightSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  period: z.object({
    start: z.date(),
    end: z.date(),
  }),
  summary: z.string(),
  metrics: z.object({
    totalLeads: z.number(),
    conversions: z.number(),
    conversionRate: z.number(),
    topChannel: z.string(),
    topPerformingTime: z.string(),
    avgResponseTime: z.string(),
  }),
  channelBreakdown: z.array(z.object({
    channel: z.string(),
    count: z.number(),
    percentage: z.number(),
  })),
  generatedAt: z.date(),
});

// ========== API KEYS ==========
export const apiKeySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  key: z.string(),
  lastUsedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
});

export const memoryEpisodes = pgTable("memory_episodes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["success", "failure", "neutral"] }).notNull(),
  action: text("action").notNull(), // e.g. "objection_handled", "meeting_booked"
  context: text("context").notNull(), // The prompt/input that led to the action
  outcome: text("outcome").notNull(), // The result/response
  embedding: text("embedding"), // Vector representation for retrieval
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  memoryUserIdIdx: index("memory_user_id_idx").on(table.userId),
  memoryActionIdx: index("memory_action_idx").on(table.action),
}));

export const agentSkills = pgTable("agent_skills", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(), // e.g. "email_sync", "pdf_extraction"
  description: text("description").notNull(),
  procedureMd: text("procedure_md").notNull(), // Markdown instructions on how to use this skill
  schemaJson: jsonb("schema_json").$type<Record<string, any>>(), // JSON schema for tool inputs
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const memoryEpisodesSelect = createSelectSchema(memoryEpisodes);
export const memoryEpisodesInsert = createInsertSchema(memoryEpisodes);
export const agentSkillsSelect = createSelectSchema(agentSkills);
export const agentSkillsInsert = createInsertSchema(agentSkills);

export const systemHealthLogs = pgTable("system_health_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  service: text("service").notNull(), // "ai", "email", "rag", "billing", "storage"
  level: text("level", { enum: ["info", "warn", "error", "critical"] }).notNull().default("info"),
  event: text("event").notNull(),
  message: text("message").notNull(),
  details: jsonb("details").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
  stackTrace: text("stack_trace"),
  durationMs: integer("duration_ms"),
  provider: text("provider"), // e.g. "openai", "gmail", "elevenlabs"
  isResolved: boolean("is_resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => {
  return {
    healthServiceIdx: index("health_service_idx").on(table.service),
    healthLevelIdx: index("health_level_idx").on(table.level),
    healthCreatedAtIdx: index("health_created_at_idx").on(table.createdAt),
    healthUserIdIdx: index("health_user_id_idx").on(table.userId),
  };
});

export const systemHealthLogsSelect = createSelectSchema(systemHealthLogs);
export const systemHealthLogsInsert = createInsertSchema(systemHealthLogs);
export type SystemHealthLog = z.infer<typeof systemHealthLogsSelect>;
export type InsertSystemHealthLog = z.infer<typeof systemHealthLogsInsert>;

// ─── Campaign Job Logs ────────────────────────────────────────────────────────
// PostgreSQL source-of-truth for every BullMQ campaign job.
// The self-healing Watchdog queries this table every hour:
//   SELECT * FROM campaign_job_logs WHERE status IN ('pending','processing')
//     AND scheduled_at < NOW() - INTERVAL '1 hour' AND attempt_count < 3
// If a job is missing from BullMQ, it is automatically re-queued.
export const campaignJobLogs = pgTable("campaign_job_logs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jobBullmqId: text("job_bullmq_id").notNull().unique(),
  campaignId: uuid("campaign_id").notNull().references(() => outreachCampaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  integrationId: text("integration_id"),
  campaignLeadId: text("campaign_lead_id"),
  jobType: text("job_type").notNull(),
  stepIndex: integer("step_index"),
  status: text("status").notNull().default("pending"),
  jobData: jsonb("job_data").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  scheduledAt: timestamp("scheduled_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  cjlBullmqIdIdx: index('cjl_bullmq_id_idx').on(table.jobBullmqId),
  cjlCampaignStatusIdx: index('cjl_campaign_status_idx').on(table.campaignId, table.status),
  cjlStatusScheduledIdx: index('cjl_status_scheduled_idx').on(table.status, table.scheduledAt),
}));

export type CampaignJobLog = typeof campaignJobLogs.$inferSelect;
export type InsertCampaignJobLog = typeof campaignJobLogs.$inferInsert;

// ─── Job Attempts ─────────────────────────────────────────────────────────────
// Fine-grained per-attempt audit trail for every BullMQ worker execution.
// Captures entry, success, and failure for full observability at 1M+ scale.
export const jobAttempts = pgTable("job_attempts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: text("job_id").notNull(),
  jobName: text("job_name").notNull(),
  campaignId: uuid("campaign_id").references(() => outreachCampaigns.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  integrationId: text("integration_id"),
  campaignLeadId: text("campaign_lead_id"),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: text("status").notNull().default("started"), // started | completed | failed
  error: text("error"),
  workerId: text("worker_id"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  jaJobIdIdx: index('ja_job_id_idx').on(table.jobId),
  jaStatusCreatedAtIdx: index('ja_status_created_at_idx').on(table.status, table.createdAt),
  jaCampaignIdIdx: index('ja_campaign_id_idx').on(table.campaignId),
}));

export type JobAttempt = typeof jobAttempts.$inferSelect;
export type InsertJobAttempt = typeof jobAttempts.$inferInsert;

// ========== P2P WARMUP SERVICE (Ghost Layer) ==========
export const warmupMailboxes = pgTable("warmup_mailboxes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  provider: text("provider", { enum: ["gmail", "outlook", "custom_email"] }).notNull(),
  status: text("status", { enum: ["active", "paused", "unenrolled", "error"] }).notNull().default("paused"),
  pauseReason: text("pause_reason"),
  poolType: text("pool_type", { enum: ["enterprise", "global"] }).notNull().default("global"),
  registeredDomain: text("registered_domain"),
  anchorRole: text("anchor_role", { enum: ["anchor", "member", "seed"] }).notNull().default("member"),
  anchorMailboxId: uuid("anchor_mailbox_id"),
  dailySentCount: integer("daily_sent_count").notNull().default(0),
  dailyReceivedCount: integer("daily_received_count").notNull().default(0),
  dailyLimit: integer("daily_limit"),
  lastResetAt: timestamp("last_reset_at").notNull().defaultNow(),
  hiddenFolderPath: text("hidden_folder_path"),
  hiddenFolderCreatedAt: timestamp("hidden_folder_created_at"),
  activeThreadIds: jsonb("active_thread_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").$type<{
    smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPass?: string;
    imapHost?: string; imapPort?: number; imapUser?: string; imapPass?: string;
    oauthUserId?: string; seedAccountId?: string; source?: string;
    lastError?: string; lastErrorAt?: string;
  }>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wmStatusIdx: index("wm_status_idx").on(table.status),
  wmPoolTypeIdx: index("wm_pool_type_idx").on(table.poolType),
  wmOrgIdx: index("wm_org_idx").on(table.organizationId),
  wmProviderIdx: index("wm_provider_idx").on(table.provider),
  wmDomainIdx: index("wm_domain_idx").on(table.registeredDomain),
  wmAnchorRoleIdx: index("wm_anchor_role_idx").on(table.anchorRole),
  wmIntegrationIdx: index("wm_integration_idx").on(table.integrationId),
}));

export const warmupThreads = pgTable("warmup_threads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  senderMailboxId: uuid("sender_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  recipientMailboxId: uuid("recipient_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "completed", "stalled", "error"] }).notNull().default("active"),
  messageCount: integer("message_count").notNull().default(0),
  maxMessages: integer("max_messages").notNull().default(3),
  subject: text("subject").notNull(),
  rootMessageId: text("root_message_id"),
  lastMessageId: text("last_message_id"),
  references: jsonb("references").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  nextSendAt: timestamp("next_send_at"),
  nextExpectedReplyAt: timestamp("next_expected_reply_at"),
  lastInteractionAt: timestamp("last_interaction_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wtStatusNextSendIdx: index("wt_status_next_send_idx").on(table.status, table.nextSendAt),
  wtSenderIdx: index("wt_sender_idx").on(table.senderMailboxId),
  wtRecipientIdx: index("wt_recipient_idx").on(table.recipientMailboxId),
}));

export const warmupInteractions = pgTable("warmup_interactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: uuid("thread_id").notNull().references(() => warmupThreads.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
  fromMailboxId: uuid("from_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  toMailboxId: uuid("to_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  messageId: text("message_id").notNull().unique(),
  inReplyTo: text("in_reply_to"),
  references: jsonb("references").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  xAudnixWarmup: boolean("x_audnix_warmup").notNull().default(true),
  expungedFromSent: boolean("expunged_from_sent").notNull().default(false),
  movedToHiddenFolder: boolean("moved_to_hidden_folder").notNull().default(false),
  status: text("status", { enum: ["pending", "sent", "delivered", "failed", "bounced", "expunged"] }).notNull().default("pending"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  wiThreadIdx: index("wi_thread_idx").on(table.threadId),
  wiStatusIdx: index("wi_status_idx").on(table.status),
  wiMessageIdIdx: index("wi_message_id_idx").on(table.messageId),
}));

export const warmupPoolState = pgTable("warmup_pool_state", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  poolType: text("pool_type", { enum: ["enterprise", "global"] }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  totalMailboxes: integer("total_mailboxes").notNull().default(0),
  activeMailboxes: integer("active_mailboxes").notNull().default(0),
  pausedMailboxes: integer("paused_mailboxes").notNull().default(0),
  lastSnapshotAt: timestamp("last_snapshot_at").notNull().defaultNow(),
  isHealthy: boolean("is_healthy").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wpsPoolTypeOrgIdx: uniqueIndex("wps_pool_type_org_idx").on(table.poolType, table.organizationId),
}));

export const warmupDomainClusters = pgTable("warmup_domain_clusters", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  registeredDomain: text("registered_domain").notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  anchorMailboxIds: jsonb("anchor_mailbox_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  seedMailboxIds: jsonb("seed_mailbox_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  memberMailboxIds: jsonb("member_mailbox_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  mode: text("mode", { enum: ["user_provided", "platform_seed", "internal_only"] }).notNull().default("internal_only"),
  totalMailboxes: integer("total_mailboxes").notNull().default(0),
  anchorCount: integer("anchor_count").notNull().default(0),
  isHealthy: boolean("is_healthy").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wdcDomainOrgIdx: uniqueIndex("wdc_domain_org_idx").on(table.registeredDomain, table.organizationId),
  wdcModeIdx: index("wdc_mode_idx").on(table.mode),
  wdcHealthIdx: index("wdc_health_idx").on(table.isHealthy),
}));

export const warmupSeedAccounts = pgTable("warmup_seed_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  provider: text("provider", { enum: ["gmail", "outlook"] }).notNull(),
  status: text("status", { enum: ["active", "cooling", "exhausted", "error", "retired"] }).notNull().default("active"),
  dailySentCount: integer("daily_sent_count").notNull().default(0),
  dailyLimit: integer("daily_limit").notNull().default(400),
  partnerCount: integer("partner_count").notNull().default(0),
  maxPartners: integer("max_partners").notNull().default(10),
  lastResetAt: timestamp("last_reset_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<{
    smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPass?: string;
    imapHost?: string; imapPort?: number; imapUser?: string; imapPass?: string;
    oauthUserId?: string; lastError?: string; source?: string;
  }>().notNull().default(sql`'{}'::jsonb`),
  assignedDomainClusterIds: jsonb("assigned_domain_cluster_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wsaProviderIdx: index("wsa_provider_idx").on(table.provider),
  wsaStatusIdx: index("wsa_status_idx").on(table.status),
}));

export type WarmupMailbox = typeof warmupMailboxes.$inferSelect;
export type InsertWarmupMailbox = typeof warmupMailboxes.$inferInsert;
export type WarmupThread = typeof warmupThreads.$inferSelect;
export type InsertWarmupThread = typeof warmupThreads.$inferInsert;
export type WarmupInteraction = typeof warmupInteractions.$inferSelect;
export type InsertWarmupInteraction = typeof warmupInteractions.$inferInsert;
export type WarmupPoolState = typeof warmupPoolState.$inferSelect;
export type WarmupDomainCluster = typeof warmupDomainClusters.$inferSelect;
export type InsertWarmupDomainCluster = typeof warmupDomainClusters.$inferInsert;
export type WarmupSeedAccount = typeof warmupSeedAccounts.$inferSelect;
export type InsertWarmupSeedAccount = typeof warmupSeedAccounts.$inferInsert;
export type InsertWarmupPoolState = typeof warmupPoolState.$inferInsert;
