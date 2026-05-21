import { z } from "zod";
import { pgTable, text, uuid, timestamp, boolean, integer, jsonb, varchar, real, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// Custom type for PostgreSQL bytea
export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
  fromDriver(value: unknown) {
    if (Buffer.isBuffer(value)) return value;
    return Buffer.from(value as any);
  },
  toDriver(value: Buffer) {
    return value;
  },
});

// ========== DRIZZLE DATABASE TABLES ==========

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
  filteredLeadsCount: integer("filtered_leads_count").notNull().default(0),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  externalId: text("external_id"),
  name: text("name").notNull(),
  company: text("company"),
  role: text("role"),
  bio: text("bio"),
  channel: text("channel", { enum: ["instagram", "email"] }).notNull(),
  email: text("email"),
  phone: text("phone"),
  status: text("status", { enum: ["new", "open", "replied", "converted", "not_interested", "cold", "hardened", "recovered", "bouncy"] }).notNull().default("new"),
  verified: boolean("verified").notNull().default(false),
  verifiedAt: timestamp("verified_at"),
  score: integer("score").notNull().default(0),
  warm: boolean("warm").notNull().default(false),
  lastMessageAt: timestamp("last_message_at"),
  aiPaused: boolean("ai_paused").notNull().default(false),
  pdfConfidence: real("pdf_confidence"),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["instagram", "gmail", "email", "system"] }).notNull(),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  body: text("body").notNull(),
  audioUrl: text("audio_url"),
  trackingId: text("tracking_id"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  repliedAt: timestamp("replied_at"),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  provider: text("provider", { enum: ["google", "outlook"] }).notNull(),
  externalId: text("external_id").notNull(),
  attendees: jsonb("attendees").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  isAiBooked: boolean("is_ai_booked").notNull().default(false),
  preCallNote: text("pre_call_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  type: text("type", { enum: ["webhook_error", "billing_issue", "conversion", "lead_reply", "system", "insight"] }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  actionUrl: text("action_url"),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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

// Duplicate identifiers removed - using organizations.ts logic if needed or consolidating here
export const teamMembers = pgTable("team_members", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  invitedBy: uuid("invited_by"),
  invitedAt: timestamp("invited_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
});

// Export types
export const teamMembersSelect = createSelectSchema(teamMembers);
export const teamMembersInsert = createInsertSchema(teamMembers);
export type TeamMember = z.infer<typeof teamMembersSelect>;
export type InsertTeamMember = z.infer<typeof teamMembersInsert>;

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
});

export const followUpQueue = pgTable("follow_up_queue", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: ["instagram", "email"] }).notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
  processedAt: timestamp("processed_at"),
  context: jsonb("context").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // "ai_message_sent", "opt_out_toggled", "pdf_processed", "upload_rate_limited"
  messageId: uuid("message_id"),
  details: jsonb("details").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  actionType: text("action_type", { enum: ["calendar_booking", "video_sent", "dm_sent", "follow_up", "objection_handled"] }).notNull(),
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

export const brandPdfCache = pgTable("brand_pdf_cache", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  brandContext: jsonb("brand_context").notNull().default(sql`'{}'::jsonb`),
  pdfContent: bytea("pdf_content"), // Store actual PDF buffer
  extractedText: text("extracted_text").notNull(),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  fileHash: text("file_hash"),
  analysisScore: integer("analysis_score"),
  analysisItems: jsonb("analysis_items"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => {
  return {
    userIdHashIdx: uniqueIndex("user_id_file_hash_idx").on(table.userId, table.fileHash),
  };
});


export const adminWhitelist = pgTable("admin_whitelist", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  status: text("status").notNull().default("active"),
  role: text("role", { enum: ["admin", "superadmin"] }).notNull().default("admin"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});


// ========== ZOD VALIDATION SCHEMAS ==========

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
export const insertCalendarBookingSchema = createInsertSchema(calendarBookings);
export const insertAutomationRuleSchema = createInsertSchema(automationRules);
export const insertContentLibrarySchema = createInsertSchema(contentLibrary);
export const insertConversationEventSchema = createInsertSchema(conversationEvents);
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
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;
// Duplicate TeamMember types removed
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

export type BrandPdfCache = typeof brandPdfCache.$inferSelect;
export type InsertBrandPdfCache = typeof brandPdfCache.$inferInsert;
export type AdminWhitelist = typeof adminWhitelist.$inferSelect;
export type InsertAdminWhitelist = typeof adminWhitelist.$inferInsert;

export type FollowUpQueue = typeof followUpQueue.$inferSelect;
export type InsertFollowUpQueue = typeof followUpQueue.$inferInsert;

export type AiLearningPattern = typeof aiLearningPatterns.$inferSelect;
export type InsertAiLearningPattern = typeof aiLearningPatterns.$inferInsert;

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
  type: z.enum(["webhook_error", "billing_issue", "conversion", "lead_reply", "system", "insight"]),
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
