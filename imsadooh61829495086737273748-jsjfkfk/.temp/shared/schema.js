"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoAssets = exports.calendarSettings = exports.otpCodes = exports.uploadRateLimit = exports.pdfAnalytics = exports.auditTrail = exports.oauthAccounts = exports.onboardingProfiles = exports.payments = exports.brandEmbeddings = exports.usageTopups = exports.emailMessagesInsert = exports.emailMessagesSelect = exports.emailMessages = exports.insights = exports.bounceTracker = exports.emailWarmupSchedules = exports.followUpQueue = exports.prospects = exports.apiKeys = exports.webhooks = exports.userOutreachSettings = exports.outreachCampaigns = exports.teamMembersInsert = exports.teamMembersSelect = exports.teamMembers = exports.organizations = exports.notificationsInsert = exports.notificationsSelect = exports.notifications = exports.processedComments = exports.videoMonitors = exports.calendarEvents = exports.automations = exports.voiceSettings = exports.deals = exports.integrations = exports.leadInsights = exports.threads = exports.messages = exports.leadSocialDetailsInsert = exports.leadSocialDetailsSelect = exports.leadSocialDetails = exports.leads = exports.brandPdfCache = exports.users = exports.smtpSettingsInsert = exports.smtpSettingsSelect = exports.smtpSettings = exports.bytea = void 0;
exports.insertPushSubscriptionSchema = exports.pushSubscriptions = exports.insertAiLearningPatternSchema = exports.insertAdminWhitelistSchema = exports.insertBrandPdfCacheSchema = exports.insertTeamMemberSchema = exports.insertOrganizationSchema = exports.insertScrapingSessionSchema = exports.insertProspectSchema = exports.insertLeadInsightSchema = exports.insertThreadSchema = exports.insertConversationEventSchema = exports.insertContentLibrarySchema = exports.insertAutomationRuleSchema = exports.insertCalendarBookingSchema = exports.insertAiProcessLogSchema = exports.insertAiActionLogSchema = exports.insertVideoAssetSchema = exports.insertCalendarSettingsSchema = exports.insertBounceTrackerSchema = exports.insertEmailWarmupScheduleSchema = exports.insertOtpCodeSchema = exports.insertOAuthAccountSchema = exports.insertOnboardingProfileSchema = exports.insertBrandEmbeddingSchema = exports.insertPaymentSchema = exports.insertInsightSchema = exports.insertApiKeySchema = exports.insertWebhookSchema = exports.insertNotificationSchema = exports.insertCalendarEventSchema = exports.insertAutomationSchema = exports.insertVoiceSettingSchema = exports.insertDealSchema = exports.insertIntegrationSchema = exports.insertMessageSchema = exports.insertLeadSchema = exports.insertUserSchema = exports.aiProcessLogs = exports.emailReplyStore = exports.campaignEmails = exports.adminWhitelist = exports.campaignLeads = exports.scrapingSessions = exports.aiLearningPatterns = exports.conversationEvents = exports.contentLibrary = exports.automationRules = exports.calendarBookings = exports.aiActionLogs = void 0;
exports.apiKeySchema = exports.insightSchema = exports.usageStatsSchema = exports.adminMetricsSchema = exports.webhookSchema = exports.notificationSchema = exports.calendarEventSchema = exports.automationSchema = exports.voiceSettingSchema = exports.integrationSchema = exports.dealSchema = exports.messageSchema = exports.leadSchema = exports.userSchema = void 0;
const zod_1 = require("zod");
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
const drizzle_zod_1 = require("drizzle-zod");
// Custom type for PostgreSQL bytea
exports.bytea = (0, pg_core_1.customType)({
    dataType() {
        return 'bytea';
    },
    fromDriver(value) {
        if (Buffer.isBuffer(value))
            return value;
        return Buffer.from(value);
    },
    toDriver(value) {
        return value;
    },
});
exports.smtpSettings = (0, pg_core_1.pgTable)("smtp_settings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    email: (0, pg_core_1.text)("email").notNull(),
    host: (0, pg_core_1.text)("host").notNull(),
    port: (0, pg_core_1.integer)("port").notNull(),
    user: (0, pg_core_1.text)("user").notNull(),
    pass: (0, pg_core_1.text)("pass").notNull(),
    secure: (0, pg_core_1.boolean)("secure").notNull().default(true),
    dailySentCount: (0, pg_core_1.integer)("daily_sent_count").notNull().default(0),
    yesterdaySentCount: (0, pg_core_1.integer)("yesterday_sent_count").notNull().default(0),
    lastResetAt: (0, pg_core_1.timestamp)("last_reset_at").notNull().defaultNow(),
    isActive: (0, pg_core_1.boolean)("is_active").notNull().default(true),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.smtpSettingsSelect = (0, drizzle_zod_1.createSelectSchema)(exports.smtpSettings);
exports.smtpSettingsInsert = (0, drizzle_zod_1.createInsertSchema)(exports.smtpSettings);
exports.users = (0, pg_core_1.pgTable)("users", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    supabaseId: (0, pg_core_1.text)("supabase_id"),
    email: (0, pg_core_1.text)("email").notNull().unique(),
    password: (0, pg_core_1.text)("password"),
    name: (0, pg_core_1.text)("name"),
    username: (0, pg_core_1.text)("username"),
    avatar: (0, pg_core_1.text)("avatar"),
    company: (0, pg_core_1.text)("company"),
    timezone: (0, pg_core_1.text)("timezone").notNull().default("America/New_York"),
    plan: (0, pg_core_1.text)("plan", { enum: ["trial", "starter", "pro", "enterprise"] }).notNull().default("trial"),
    subscriptionTier: (0, pg_core_1.text)("subscription_tier", { enum: ["free", "trial", "starter", "pro", "enterprise"] }).default("free"),
    trialExpiresAt: (0, pg_core_1.timestamp)("trial_expires_at"),
    replyTone: (0, pg_core_1.text)("reply_tone", { enum: ["friendly", "professional", "short"] }).notNull().default("professional"),
    role: (0, pg_core_1.text)("role", { enum: ["admin", "member"] }).notNull().default("member"),
    stripeCustomerId: (0, pg_core_1.text)("stripe_customer_id"),
    stripeSubscriptionId: (0, pg_core_1.text)("stripe_subscription_id"),
    voiceCloneId: (0, pg_core_1.text)("voice_clone_id"),
    voiceMinutesUsed: (0, pg_core_1.real)("voice_minutes_used").notNull().default(0),
    voiceMinutesTopup: (0, pg_core_1.real)("voice_minutes_topup").notNull().default(0),
    businessName: (0, pg_core_1.text)("business_name"),
    voiceRules: (0, pg_core_1.text)("voice_rules"),
    pdfConfidenceThreshold: (0, pg_core_1.real)("pdf_confidence_threshold").default(0.7),
    lastInsightGeneratedAt: (0, pg_core_1.timestamp)("last_insight_generated_at"),
    lastProspectScanAt: (0, pg_core_1.timestamp)("last_prospect_scan_at"),
    paymentStatus: (0, pg_core_1.text)("payment_status").default("none"),
    pendingPaymentPlan: (0, pg_core_1.text)("pending_payment_plan"),
    pendingPaymentAmount: (0, pg_core_1.real)("pending_payment_amount"),
    pendingPaymentDate: (0, pg_core_1.timestamp)("pending_payment_date"),
    paymentApprovedAt: (0, pg_core_1.timestamp)("payment_approved_at"),
    stripeSessionId: (0, pg_core_1.text)("stripe_session_id"),
    subscriptionId: (0, pg_core_1.text)("subscription_id"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    lastLogin: (0, pg_core_1.timestamp)("last_login"),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow(),
    calendarLink: (0, pg_core_1.text)("calendar_link"),
    brandGuidelinePdfUrl: (0, pg_core_1.text)("brand_guideline_pdf_url"),
    brandGuidelinePdfText: (0, pg_core_1.text)("brand_guideline_pdf_text"),
    config: (0, pg_core_1.jsonb)("config").default({}),
    filteredLeadsCount: (0, pg_core_1.integer)("filtered_leads_count").notNull().default(0),
});
exports.brandPdfCache = (0, pg_core_1.pgTable)("brand_pdf_cache", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    fileName: (0, pg_core_1.text)("file_name").notNull(),
    fileSize: (0, pg_core_1.integer)("file_size").notNull(),
    fileHash: (0, pg_core_1.text)("file_hash").notNull(),
    pdfContent: (0, exports.bytea)("pdf_content"),
    extractedText: (0, pg_core_1.text)("extracted_text"),
    brandContext: (0, pg_core_1.jsonb)("brand_context").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    analysisScore: (0, pg_core_1.integer)("analysis_score").default(0),
    analysisItems: (0, pg_core_1.jsonb)("analysis_items").$type().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow(),
}, (table) => {
    return {
        userIdHashIdx: (0, pg_core_1.uniqueIndex)("brand_pdf_cache_user_id_hash_idx").on(table.userId, table.fileHash),
    };
});
exports.leads = (0, pg_core_1.pgTable)("leads", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    organizationId: (0, pg_core_1.uuid)("organization_id").references(() => exports.organizations.id, { onDelete: "cascade" }),
    externalId: (0, pg_core_1.text)("external_id"),
    name: (0, pg_core_1.text)("name").notNull(),
    company: (0, pg_core_1.text)("company"),
    role: (0, pg_core_1.text)("role"),
    bio: (0, pg_core_1.text)("bio"),
    snippet: (0, pg_core_1.text)("snippet"),
    channel: (0, pg_core_1.text)("channel", { enum: ["email", "linkedin", "sms", "voice", "whatsapp", "instagram"] }).notNull(),
    email: (0, pg_core_1.text)("email"),
    replyEmail: (0, pg_core_1.text)("reply_email"),
    phone: (0, pg_core_1.text)("phone"),
    status: (0, pg_core_1.text)("status", { enum: ["new", "open", "replied", "converted", "not_interested", "cold", "hardened", "recovered", "bouncy", "booked", "warm"] }).notNull().default("new"),
    verified: (0, pg_core_1.boolean)("verified").notNull().default(false),
    verifiedAt: (0, pg_core_1.timestamp)("verified_at"),
    score: (0, pg_core_1.integer)("score").notNull().default(0),
    warm: (0, pg_core_1.boolean)("warm").notNull().default(false),
    lastMessageAt: (0, pg_core_1.timestamp)("last_message_at"),
    aiPaused: (0, pg_core_1.boolean)("ai_paused").notNull().default(true),
    pdfConfidence: (0, pg_core_1.real)("pdf_confidence"),
    archived: (0, pg_core_1.boolean)("archived").notNull().default(false),
    tags: (0, pg_core_1.jsonb)("tags").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.leadSocialDetails = (0, pg_core_1.pgTable)("lead_social_details", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    platform: (0, pg_core_1.text)("platform").notNull(), // linkedin, twitter, instagram, github, etc.
    profileUrl: (0, pg_core_1.text)("profile_url").notNull(),
    handle: (0, pg_core_1.text)("handle"),
    followersCount: (0, pg_core_1.integer)("followers_count"),
    bio: (0, pg_core_1.text)("bio"),
    lastActivityAt: (0, pg_core_1.timestamp)("last_activity_at"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    verified: (0, pg_core_1.boolean)("verified").default(false),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
}, (table) => ({
    leadPlatformIdx: (0, pg_core_1.uniqueIndex)("lead_platform_idx").on(table.leadId, table.platform),
}));
exports.leadSocialDetailsSelect = (0, drizzle_zod_1.createSelectSchema)(exports.leadSocialDetails);
exports.leadSocialDetailsInsert = (0, drizzle_zod_1.createInsertSchema)(exports.leadSocialDetails);
// types are defined later in the file to avoid duplication
exports.messages = (0, pg_core_1.pgTable)("messages", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    threadId: (0, pg_core_1.uuid)("thread_id"),
    provider: (0, pg_core_1.text)("provider", { enum: ["instagram", "gmail", "email", "system"] }).notNull(),
    direction: (0, pg_core_1.text)("direction", { enum: ["inbound", "outbound"] }).notNull(),
    subject: (0, pg_core_1.text)("subject"),
    body: (0, pg_core_1.text)("body").notNull(),
    audioUrl: (0, pg_core_1.text)("audio_url"),
    trackingId: (0, pg_core_1.text)("tracking_id"),
    openedAt: (0, pg_core_1.timestamp)("opened_at"),
    clickedAt: (0, pg_core_1.timestamp)("clicked_at"),
    repliedAt: (0, pg_core_1.timestamp)("replied_at"),
    isRead: (0, pg_core_1.boolean)("is_read").notNull().default(false),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.threads = (0, pg_core_1.pgTable)("threads", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    subject: (0, pg_core_1.text)("subject"),
    lastMessageAt: (0, pg_core_1.timestamp)("last_message_at").notNull().defaultNow(),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.leadInsights = (0, pg_core_1.pgTable)("lead_insights", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().unique().references(() => exports.leads.id, { onDelete: "cascade" }),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    intent: (0, pg_core_1.text)("intent"), // "interested", "not_interested", "oos", "job_seeker", etc.
    intentScore: (0, pg_core_1.integer)("intent_score").notNull().default(0),
    summary: (0, pg_core_1.text)("summary"),
    nextNextStep: (0, pg_core_1.text)("next_step"),
    competitors: (0, pg_core_1.jsonb)("competitors").$type().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    painPoints: (0, pg_core_1.jsonb)("pain_points").$type().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    budget: (0, pg_core_1.text)("budget"),
    timeline: (0, pg_core_1.text)("timeline"),
    lastAnalyzedAt: (0, pg_core_1.timestamp)("last_analyzed_at"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.integrations = (0, pg_core_1.pgTable)("integrations", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    provider: (0, pg_core_1.text)("provider", { enum: ["instagram", "gmail", "outlook", "manychat", "custom_email", "google_calendar", "calendly"] }).notNull(),
    encryptedMeta: (0, pg_core_1.text)("encrypted_meta").notNull(),
    connected: (0, pg_core_1.boolean)("connected").notNull().default(false),
    accountType: (0, pg_core_1.text)("account_type"),
    lastSync: (0, pg_core_1.timestamp)("last_sync"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.deals = (0, pg_core_1.pgTable)("deals", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    organizationId: (0, pg_core_1.uuid)("organization_id").references(() => exports.organizations.id, { onDelete: "cascade" }),
    brand: (0, pg_core_1.text)("brand").notNull(),
    channel: (0, pg_core_1.text)("channel", { enum: ["instagram", "email", "gmail", "manual"] }).notNull(),
    value: (0, pg_core_1.real)("value").notNull(),
    status: (0, pg_core_1.text)("status", { enum: ["open", "closed_won", "closed_lost", "pending"] }).notNull().default("open"),
    notes: (0, pg_core_1.text)("notes"),
    convertedAt: (0, pg_core_1.timestamp)("converted_at"),
    meetingScheduled: (0, pg_core_1.boolean)("meeting_scheduled").notNull().default(false),
    meetingUrl: (0, pg_core_1.text)("meeting_url"),
    dealValue: (0, pg_core_1.integer)("deal_value").default(0),
    calendarLink: (0, pg_core_1.text)("calendar_link"),
    source: (0, pg_core_1.text)("source").default("manual"),
    closedAt: (0, pg_core_1.timestamp)("closed_at", { withTimezone: true }),
    aiAnalysis: (0, pg_core_1.jsonb)("ai_analysis").default({}),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.voiceSettings = (0, pg_core_1.pgTable)("voice_settings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    isActive: (0, pg_core_1.boolean)("is_active").notNull().default(false),
    voiceSampleUrl: (0, pg_core_1.text)("voice_sample_url"),
    voiceCloneId: (0, pg_core_1.text)("voice_clone_id"),
    consentGiven: (0, pg_core_1.boolean)("consent_given").notNull().default(false),
    minutesUsed: (0, pg_core_1.integer)("minutes_used").notNull().default(0),
    minutesAllowed: (0, pg_core_1.integer)("minutes_allowed").notNull().default(100),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.automations = (0, pg_core_1.pgTable)("automations", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    name: (0, pg_core_1.text)("name").notNull(),
    description: (0, pg_core_1.text)("description").notNull(),
    isActive: (0, pg_core_1.boolean)("is_active").notNull().default(true),
    tone: (0, pg_core_1.text)("tone", { enum: ["friendly", "professional", "short"] }).notNull().default("professional"),
    schedule: (0, pg_core_1.jsonb)("schedule").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    triggers: (0, pg_core_1.jsonb)("triggers").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.calendarEvents = (0, pg_core_1.pgTable)("calendar_events", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").references(() => exports.leads.id, { onDelete: "set null" }),
    title: (0, pg_core_1.text)("title").notNull(),
    description: (0, pg_core_1.text)("description"),
    startTime: (0, pg_core_1.timestamp)("start_time").notNull(),
    endTime: (0, pg_core_1.timestamp)("end_time").notNull(),
    meetingUrl: (0, pg_core_1.text)("meeting_url"),
    provider: (0, pg_core_1.text)("provider", { enum: ["google", "outlook"] }).notNull(),
    externalId: (0, pg_core_1.text)("external_id").notNull(),
    attendees: (0, pg_core_1.jsonb)("attendees").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    isAiBooked: (0, pg_core_1.boolean)("is_ai_booked").notNull().default(false),
    preCallNote: (0, pg_core_1.text)("pre_call_note"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.videoMonitors = (0, pg_core_1.pgTable)("video_monitors", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: 'cascade' }),
    videoId: (0, pg_core_1.text)("video_id").notNull(),
    videoUrl: (0, pg_core_1.text)("video_url").notNull(),
    productLink: (0, pg_core_1.text)("product_link").notNull(),
    ctaText: (0, pg_core_1.text)("cta_text").notNull().default('Check it out'),
    isActive: (0, pg_core_1.boolean)("is_active").notNull().default(true),
    autoReplyEnabled: (0, pg_core_1.boolean)("auto_reply_enabled").notNull().default(true),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow()
});
exports.processedComments = (0, pg_core_1.pgTable)("processed_comments", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    commentId: (0, pg_core_1.text)("comment_id").notNull().unique(),
    videoMonitorId: (0, pg_core_1.uuid)("video_monitor_id").references(() => exports.videoMonitors.id, { onDelete: 'cascade' }),
    commenterUsername: (0, pg_core_1.text)("commenter_username").notNull(),
    commentText: (0, pg_core_1.text)("comment_text").notNull(),
    intentType: (0, pg_core_1.text)("intent_type").notNull(),
    status: (0, pg_core_1.text)("status", { enum: ['dm_sent', 'ignored', 'failed'] }).notNull().default('dm_sent'),
    leadId: (0, pg_core_1.uuid)("lead_id").references(() => exports.leads.id, { onDelete: "set null" }),
    processedAt: (0, pg_core_1.timestamp)("processed_at").notNull().defaultNow()
});
exports.notifications = (0, pg_core_1.pgTable)("notifications", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    type: (0, pg_core_1.text)("type", { enum: ["webhook_error", "billing_issue", "conversion", "lead_reply", "system", "insight", "lead_import", "campaign_sent", "new_lead", "lead_status_change", "topup_success", "info", "email_bounce"] }).notNull(),
    title: (0, pg_core_1.text)("title").notNull(),
    message: (0, pg_core_1.text)("message").notNull(),
    isRead: (0, pg_core_1.boolean)("is_read").notNull().default(false),
    actionUrl: (0, pg_core_1.text)("action_url"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.notificationsSelect = (0, drizzle_zod_1.createSelectSchema)(exports.notifications);
exports.notificationsInsert = (0, drizzle_zod_1.createInsertSchema)(exports.notifications);
exports.organizations = (0, pg_core_1.pgTable)("organizations", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    name: (0, pg_core_1.text)("name").notNull(),
    slug: (0, pg_core_1.text)("slug").unique(),
    ownerId: (0, pg_core_1.uuid)("owner_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    plan: (0, pg_core_1.text)("plan", { enum: ["trial", "starter", "pro", "enterprise"] }).notNull().default("trial"),
    stripeCustomerId: (0, pg_core_1.text)("stripe_customer_id"),
    subscriptionId: (0, pg_core_1.text)("subscription_id"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow(),
});
exports.teamMembers = (0, pg_core_1.pgTable)("team_members", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    organizationId: (0, pg_core_1.uuid)("organization_id").notNull().references(() => exports.organizations.id, { onDelete: "cascade" }),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    role: (0, pg_core_1.text)("role", { enum: ["admin", "member"] }).notNull().default("member"),
    invitedBy: (0, pg_core_1.uuid)("invited_by"),
    invitedAt: (0, pg_core_1.timestamp)("invited_at").notNull().defaultNow(),
    acceptedAt: (0, pg_core_1.timestamp)("accepted_at"),
});
exports.teamMembersSelect = (0, drizzle_zod_1.createSelectSchema)(exports.teamMembers);
exports.teamMembersInsert = (0, drizzle_zod_1.createInsertSchema)(exports.teamMembers);
exports.outreachCampaigns = (0, pg_core_1.pgTable)("outreach_campaigns", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    name: (0, pg_core_1.text)("name").notNull(),
    status: (0, pg_core_1.text)("status", { enum: ["draft", "active", "paused", "completed"] }).notNull().default("draft"),
    stats: (0, pg_core_1.jsonb)("stats").$type().default((0, drizzle_orm_1.sql) `'{"total": 0, "sent": 0, "replied": 0, "bounced": 0}'::jsonb`),
    template: (0, pg_core_1.jsonb)("template").$type().notNull(),
    config: (0, pg_core_1.jsonb)("config").$type().notNull().default((0, drizzle_orm_1.sql) `'{"dailyLimit": 50, "minDelayMinutes": 2}'::jsonb`),
    replyEmail: (0, pg_core_1.text)("reply_email"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow()
});
exports.userOutreachSettings = (0, pg_core_1.pgTable)("user_outreach_settings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    dailyLimit: (0, pg_core_1.integer)("daily_limit").notNull().default(50),
    warmupEnabled: (0, pg_core_1.boolean)("warmup_enabled").notNull().default(true),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow()
});
exports.webhooks = (0, pg_core_1.pgTable)("webhooks", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    url: (0, pg_core_1.text)("url").notNull(),
    events: (0, pg_core_1.jsonb)("events").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    secret: (0, pg_core_1.text)("secret").notNull(),
    isActive: (0, pg_core_1.boolean)("is_active").notNull().default(true),
    lastTriggeredAt: (0, pg_core_1.timestamp)("last_triggered_at"),
    failureCount: (0, pg_core_1.integer)("failure_count").notNull().default(0),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.apiKeys = (0, pg_core_1.pgTable)("api_keys", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    name: (0, pg_core_1.text)("name").notNull(),
    key: (0, pg_core_1.text)("key").notNull().unique(),
    lastUsedAt: (0, pg_core_1.timestamp)("last_used_at"),
    expiresAt: (0, pg_core_1.timestamp)("expires_at"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.prospects = (0, pg_core_1.pgTable)("prospects", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    sessionId: (0, pg_core_1.uuid)("session_id"),
    entity: (0, pg_core_1.text)("entity").notNull(),
    industry: (0, pg_core_1.text)("industry"),
    location: (0, pg_core_1.text)("location"),
    email: (0, pg_core_1.text)("email"),
    phone: (0, pg_core_1.text)("phone"),
    website: (0, pg_core_1.text)("website"),
    source: (0, pg_core_1.text)("source", { enum: ["google", "bing", "maps", "instagram", "youtube", "facebook", "twitter", "tiktok", "pinterest", "linkedin", "manual"] }),
    snippet: (0, pg_core_1.text)("snippet"),
    platforms: (0, pg_core_1.jsonb)("platforms").$type().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    socialProfiles: (0, pg_core_1.jsonb)("social_profiles").$type().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    wealthSignal: (0, pg_core_1.text)("wealth_signal", { enum: ["high", "medium", "low"] }),
    leadScore: (0, pg_core_1.integer)("lead_score").default(0),
    estimatedRevenue: (0, pg_core_1.text)("estimated_revenue"),
    verified: (0, pg_core_1.boolean)("verified").default(false),
    verifiedAt: (0, pg_core_1.timestamp)("verified_at"),
    emailValid: (0, pg_core_1.boolean)("email_valid"),
    status: (0, pg_core_1.text)("status").default("found"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.followUpQueue = (0, pg_core_1.pgTable)("follow_up_queue", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    channel: (0, pg_core_1.text)("channel", { enum: ["instagram", "email"] }).notNull(),
    scheduledAt: (0, pg_core_1.timestamp)("scheduled_at").notNull(),
    status: (0, pg_core_1.text)("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
    processedAt: (0, pg_core_1.timestamp)("processed_at"),
    context: (0, pg_core_1.jsonb)("context").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    errorMessage: (0, pg_core_1.text)("error_message"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.emailWarmupSchedules = (0, pg_core_1.pgTable)("email_warmup_schedules", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    day: (0, pg_core_1.integer)("day").notNull(), // 1-30
    dailyLimit: (0, pg_core_1.integer)("daily_limit").notNull(), // emails to send today
    randomDelay: (0, pg_core_1.boolean)("random_delay").notNull().default(true), // 2-12s delays
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.bounceTracker = (0, pg_core_1.pgTable)("bounce_tracker", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    bounceType: (0, pg_core_1.text)("bounce_type", { enum: ["hard", "soft", "spam"] }).notNull(),
    email: (0, pg_core_1.text)("email").notNull(),
    timestamp: (0, pg_core_1.timestamp)("timestamp").notNull().defaultNow(),
    metadata: (0, pg_core_1.jsonb)("metadata").$type(),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.insights = (0, pg_core_1.pgTable)("insights", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    period: (0, pg_core_1.jsonb)("period").$type().notNull(),
    summary: (0, pg_core_1.text)("summary").notNull(),
    metrics: (0, pg_core_1.jsonb)("metrics").$type().notNull(),
    channelBreakdown: (0, pg_core_1.jsonb)("channel_breakdown").$type().notNull(),
    generatedAt: (0, pg_core_1.timestamp)("generated_at").notNull().defaultNow(),
});
exports.emailMessages = (0, pg_core_1.pgTable)("email_messages", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").references(() => exports.leads.id, { onDelete: "cascade" }),
    messageId: (0, pg_core_1.text)("message_id").notNull().unique(),
    threadId: (0, pg_core_1.text)("thread_id"),
    campaignId: (0, pg_core_1.uuid)("campaign_id").references(() => exports.outreachCampaigns.id, { onDelete: "set null" }),
    subject: (0, pg_core_1.text)("subject"),
    from: (0, pg_core_1.text)("from_address").notNull(),
    to: (0, pg_core_1.text)("to_address").notNull(),
    body: (0, pg_core_1.text)("body"),
    htmlBody: (0, pg_core_1.text)("html_body"),
    direction: (0, pg_core_1.text)("direction", { enum: ["inbound", "outbound"] }).notNull(),
    provider: (0, pg_core_1.text)("provider", { enum: ["gmail", "outlook", "custom_email"] }).notNull(),
    sentAt: (0, pg_core_1.timestamp)("sent_at").notNull(),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.emailMessagesSelect = (0, drizzle_zod_1.createSelectSchema)(exports.emailMessages);
exports.emailMessagesInsert = (0, drizzle_zod_1.createInsertSchema)(exports.emailMessages);
exports.usageTopups = (0, pg_core_1.pgTable)("usage_topups", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    type: (0, pg_core_1.text)("type", { enum: ["leads", "voice"] }).notNull(),
    amount: (0, pg_core_1.real)("amount").notNull(),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.brandEmbeddings = (0, pg_core_1.pgTable)("brand_embeddings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    source: (0, pg_core_1.text)("source").notNull(),
    embedding: (0, pg_core_1.text)("embedding"), // Vector stored as text in Neon
    snippet: (0, pg_core_1.text)("snippet").notNull(),
    metadata: (0, pg_core_1.jsonb)("metadata").$type(),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.payments = (0, pg_core_1.pgTable)("payments", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    stripePaymentId: (0, pg_core_1.text)("stripe_payment_id"),
    amount: (0, pg_core_1.real)("amount").notNull(),
    currency: (0, pg_core_1.text)("currency").notNull().default("USD"),
    status: (0, pg_core_1.text)("status").notNull().default("pending"),
    plan: (0, pg_core_1.text)("plan"),
    paymentLink: (0, pg_core_1.text)("payment_link"),
    webhookPayload: (0, pg_core_1.jsonb)("webhook_payload").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").defaultNow(),
});
exports.onboardingProfiles = (0, pg_core_1.pgTable)("onboarding_profiles", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().unique().references(() => exports.users.id, { onDelete: "cascade" }),
    completed: (0, pg_core_1.boolean)("completed").notNull().default(false),
    userRole: (0, pg_core_1.text)("user_role", { enum: ["creator", "founder", "developer", "agency", "freelancer", "other"] }),
    source: (0, pg_core_1.text)("source"),
    useCase: (0, pg_core_1.text)("use_case"),
    businessSize: (0, pg_core_1.text)("business_size", { enum: ["solo", "small_team", "medium", "enterprise"] }),
    tags: (0, pg_core_1.jsonb)("tags").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    completedAt: (0, pg_core_1.timestamp)("completed_at"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.oauthAccounts = (0, pg_core_1.pgTable)("oauth_accounts", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    provider: (0, pg_core_1.text)("provider", { enum: ["github", "google", "linkedin", "instagram", "facebook", "outlook"] }).notNull(),
    providerAccountId: (0, pg_core_1.text)("provider_account_id").notNull(),
    accessToken: (0, pg_core_1.text)("access_token"),
    refreshToken: (0, pg_core_1.text)("refresh_token"),
    expiresAt: (0, pg_core_1.timestamp)("expires_at"),
    scope: (0, pg_core_1.text)("scope"),
    tokenType: (0, pg_core_1.text)("token_type"),
    idToken: (0, pg_core_1.text)("id_token"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.auditTrail = (0, pg_core_1.pgTable)("audit_trail", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    action: (0, pg_core_1.text)("action").notNull(), // "ai_message_sent", "opt_out_toggled", "pdf_processed", "upload_rate_limited"
    messageId: (0, pg_core_1.uuid)("message_id"),
    details: (0, pg_core_1.jsonb)("details").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.pdfAnalytics = (0, pg_core_1.pgTable)("pdf_analytics", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    fileName: (0, pg_core_1.text)("file_name").notNull(),
    fileSize: (0, pg_core_1.integer)("file_size").notNull(),
    confidence: (0, pg_core_1.real)("confidence").notNull(),
    missingFields: (0, pg_core_1.jsonb)("missing_fields").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    leadsExtracted: (0, pg_core_1.integer)("leads_extracted").notNull().default(0),
    processedAt: (0, pg_core_1.timestamp)("processed_at").notNull().defaultNow(),
});
exports.uploadRateLimit = (0, pg_core_1.pgTable)("upload_rate_limit", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    uploads: (0, pg_core_1.integer)("uploads").notNull().default(0),
    lastResetAt: (0, pg_core_1.timestamp)("last_reset_at").notNull().defaultNow(),
    windowSizeMinutes: (0, pg_core_1.integer)("window_size_minutes").notNull().default(60),
});
exports.otpCodes = (0, pg_core_1.pgTable)("otp_codes", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    email: (0, pg_core_1.text)("email").notNull(),
    code: (0, pg_core_1.text)("code").notNull(),
    expiresAt: (0, pg_core_1.timestamp)("expires_at").notNull(),
    attempts: (0, pg_core_1.integer)("attempts").notNull().default(0),
    verified: (0, pg_core_1.boolean)("verified").notNull().default(false),
    passwordHash: (0, pg_core_1.text)("password_hash"),
    purpose: (0, pg_core_1.text)("purpose").default("login"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.calendarSettings = (0, pg_core_1.pgTable)("calendar_settings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().unique().references(() => exports.users.id, { onDelete: "cascade" }),
    calendlyToken: (0, pg_core_1.text)("calendly_token"),
    calendlyUsername: (0, pg_core_1.text)("calendly_username"),
    calendlyEventTypeUri: (0, pg_core_1.text)("calendly_event_type_uri"),
    googleCalendarEnabled: (0, pg_core_1.boolean)("google_calendar_enabled").notNull().default(false),
    calendlyEnabled: (0, pg_core_1.boolean)("calendly_enabled").notNull().default(false),
    autoBookingEnabled: (0, pg_core_1.boolean)("auto_booking_enabled").notNull().default(false),
    minIntentScore: (0, pg_core_1.integer)("min_intent_score").notNull().default(70),
    minTimingScore: (0, pg_core_1.integer)("min_timing_score").notNull().default(60),
    meetingDuration: (0, pg_core_1.integer)("meeting_duration").notNull().default(30),
    titleTemplate: (0, pg_core_1.text)("title_template").notNull().default("{{lead_name}} - Discovery Call"),
    bufferBefore: (0, pg_core_1.integer)("buffer_before").notNull().default(10),
    bufferAfter: (0, pg_core_1.integer)("buffer_after").notNull().default(5),
    workingHoursStart: (0, pg_core_1.integer)("working_hours_start").notNull().default(9),
    workingHoursEnd: (0, pg_core_1.integer)("working_hours_end").notNull().default(17),
    timezone: (0, pg_core_1.text)("timezone").notNull().default("America/New_York"),
    bookingPreference: (0, pg_core_1.text)("booking_preference", { enum: ["link", "autonomous"] }).notNull().default("autonomous"),
    availabilityCache: (0, pg_core_1.jsonb)("availability_cache").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    availabilityCachedAt: (0, pg_core_1.timestamp)("availability_cached_at"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.videoAssets = (0, pg_core_1.pgTable)("video_assets", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    platform: (0, pg_core_1.text)("platform").notNull().default("instagram"),
    externalId: (0, pg_core_1.text)("external_id").notNull(),
    videoUrl: (0, pg_core_1.text)("video_url").notNull(),
    thumbnailUrl: (0, pg_core_1.text)("thumbnail_url"),
    caption: (0, pg_core_1.text)("caption"),
    purpose: (0, pg_core_1.text)("purpose", { enum: ["education", "pitch", "proof", "entertainment", "other"] }),
    ctaLink: (0, pg_core_1.text)("cta_link"),
    aiContext: (0, pg_core_1.text)("ai_context"),
    enabled: (0, pg_core_1.boolean)("enabled").notNull().default(true),
    impressionCount: (0, pg_core_1.integer)("impression_count").notNull().default(0),
    dmSentCount: (0, pg_core_1.integer)("dm_sent_count").notNull().default(0),
    conversionCount: (0, pg_core_1.integer)("conversion_count").notNull().default(0),
    lastUsedAt: (0, pg_core_1.timestamp)("last_used_at"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
exports.aiActionLogs = (0, pg_core_1.pgTable)("ai_action_logs", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").references(() => exports.leads.id, { onDelete: "set null" }),
    actionType: (0, pg_core_1.text)("action_type", { enum: ["calendar_booking", "video_sent", "dm_sent", "follow_up", "objection_handled"] }).notNull(),
    decision: (0, pg_core_1.text)("decision", { enum: ["act", "wait", "skip", "escalate"] }).notNull(),
    intentScore: (0, pg_core_1.integer)("intent_score"),
    timingScore: (0, pg_core_1.integer)("timing_score"),
    confidence: (0, pg_core_1.real)("confidence"),
    reasoning: (0, pg_core_1.text)("reasoning"),
    assetId: (0, pg_core_1.uuid)("asset_id"),
    assetType: (0, pg_core_1.text)("asset_type"),
    outcome: (0, pg_core_1.text)("outcome"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.calendarBookings = (0, pg_core_1.pgTable)("calendar_bookings", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").references(() => exports.leads.id, { onDelete: "set null" }),
    provider: (0, pg_core_1.text)("provider", { enum: ["calendly", "google", "outlook"] }).notNull(),
    externalEventId: (0, pg_core_1.text)("external_event_id"),
    title: (0, pg_core_1.text)("title").notNull(),
    description: (0, pg_core_1.text)("description"),
    startTime: (0, pg_core_1.timestamp)("start_time").notNull(),
    endTime: (0, pg_core_1.timestamp)("end_time").notNull(),
    meetingUrl: (0, pg_core_1.text)("meeting_url"),
    attendeeEmail: (0, pg_core_1.text)("attendee_email"),
    attendeeName: (0, pg_core_1.text)("attendee_name"),
    status: (0, pg_core_1.text)("status", { enum: ["scheduled", "completed", "cancelled", "no_show"] }).notNull().default("scheduled"),
    isAiBooked: (0, pg_core_1.boolean)("is_ai_booked").notNull().default(false),
    intentScoreAtBooking: (0, pg_core_1.integer)("intent_score_at_booking"),
    confidenceAtBooking: (0, pg_core_1.real)("confidence_at_booking"),
    bookingReason: (0, pg_core_1.text)("booking_reason"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
// Intelligence-governed automation rules (not trigger-based)
exports.automationRules = (0, pg_core_1.pgTable)("automation_rules", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    name: (0, pg_core_1.text)("name").notNull(),
    ruleType: (0, pg_core_1.text)("rule_type", { enum: ["follow_up", "objection_handler", "meeting_booking", "re_engagement"] }).notNull().default("follow_up"),
    channel: (0, pg_core_1.text)("channel", { enum: ["instagram", "email", "all"] }).notNull(),
    isActive: (0, pg_core_1.boolean)("is_active").notNull().default(true),
    minIntentScore: (0, pg_core_1.integer)("min_intent_score").notNull().default(50),
    maxIntentScore: (0, pg_core_1.integer)("max_intent_score").notNull().default(100),
    minConfidence: (0, pg_core_1.real)("min_confidence").notNull().default(0.6),
    allowedActions: (0, pg_core_1.jsonb)("allowed_actions").$type().notNull().default((0, drizzle_orm_1.sql) `'["reply"]'::jsonb`),
    cooldownMinutes: (0, pg_core_1.integer)("cooldown_minutes").notNull().default(60),
    maxActionsPerDay: (0, pg_core_1.integer)("max_actions_per_day").notNull().default(10),
    escalateOnLowConfidence: (0, pg_core_1.boolean)("escalate_on_low_confidence").notNull().default(true),
    requireHumanApproval: (0, pg_core_1.boolean)("require_human_approval").notNull().default(false),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
// Content library for AI to choose from
exports.contentLibrary = (0, pg_core_1.pgTable)("content_library", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").references(() => exports.users.id, { onDelete: "cascade" }),
    type: (0, pg_core_1.text)("type", { enum: ["reply", "objection", "cta", "video"] }).notNull(),
    name: (0, pg_core_1.text)("name").notNull(),
    content: (0, pg_core_1.text)("content").notNull(),
    intentTags: (0, pg_core_1.jsonb)("intent_tags").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    objectionTags: (0, pg_core_1.jsonb)("objection_tags").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    channelRestriction: (0, pg_core_1.text)("channel_restriction", { enum: ["instagram", "email", "all"] }).notNull().default("all"),
    isActive: (0, pg_core_1.boolean)("is_active").notNull().default(true),
    usageCount: (0, pg_core_1.integer)("usage_count").notNull().default(0),
    successRate: (0, pg_core_1.real)("success_rate"),
    linkedVideoId: (0, pg_core_1.uuid)("linked_video_id"),
    linkedCtaLink: (0, pg_core_1.text)("linked_cta_link"),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
// Conversation events for unified message ingestion
exports.conversationEvents = (0, pg_core_1.pgTable)("conversation_events", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").references(() => exports.leads.id, { onDelete: "set null" }),
    channel: (0, pg_core_1.text)("channel", { enum: ["instagram", "email"] }).notNull(),
    direction: (0, pg_core_1.text)("direction", { enum: ["inbound", "outbound"] }).notNull(),
    content: (0, pg_core_1.text)("content").notNull(),
    contentType: (0, pg_core_1.text)("content_type", { enum: ["text", "image", "video", "audio", "file"] }).notNull().default("text"),
    externalId: (0, pg_core_1.text)("external_id"),
    threadId: (0, pg_core_1.text)("thread_id"),
    signals: (0, pg_core_1.jsonb)("signals").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    processedByEngine: (0, pg_core_1.boolean)("processed_by_engine").notNull().default(false),
    engineDecision: (0, pg_core_1.text)("engine_decision", { enum: ["act", "wait", "skip", "escalate"] }),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.aiLearningPatterns = (0, pg_core_1.pgTable)("ai_learning_patterns", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    patternKey: (0, pg_core_1.text)("pattern_key").notNull(),
    strength: (0, pg_core_1.integer)("strength").notNull().default(0),
    lastUsedAt: (0, pg_core_1.timestamp)("last_used_at").defaultNow(),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
}, (table) => {
    return {
        userPatternIdx: (0, pg_core_1.uniqueIndex)("user_pattern_idx").on(table.userId, table.patternKey),
    };
});
// ========== SCRAPING SESSIONS ==========
// Scraping session tracking
exports.scrapingSessions = (0, pg_core_1.pgTable)("scraping_sessions", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    niche: (0, pg_core_1.text)("niche").notNull(),
    location: (0, pg_core_1.text)("location").notNull(),
    status: (0, pg_core_1.text)("status", { enum: ["running", "completed", "failed", "cancelled"] }).notNull().default("running"),
    totalFound: (0, pg_core_1.integer)("total_found").notNull().default(0),
    verified: (0, pg_core_1.integer)("verified").notNull().default(0),
    enriched: (0, pg_core_1.integer)("enriched").notNull().default(0),
    failed: (0, pg_core_1.integer)("failed").notNull().default(0),
    sourcesScanned: (0, pg_core_1.jsonb)("sources_scanned").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    proxyNodesUsed: (0, pg_core_1.integer)("proxy_nodes_used").notNull().default(0),
    durationMs: (0, pg_core_1.integer)("duration_ms"),
    errorLog: (0, pg_core_1.jsonb)("error_log").$type().notNull().default((0, drizzle_orm_1.sql) `'[]'::jsonb`),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    startedAt: (0, pg_core_1.timestamp)("started_at").notNull().defaultNow(),
    completedAt: (0, pg_core_1.timestamp)("completed_at"),
});
// Duplicate outreachCampaigns definition removed
exports.campaignLeads = (0, pg_core_1.pgTable)("campaign_leads", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    campaignId: (0, pg_core_1.uuid)("campaign_id").notNull().references(() => exports.outreachCampaigns.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    status: (0, pg_core_1.text)("status", { enum: ["pending", "sent", "failed", "replied"] }).notNull().default("pending"),
    currentStep: (0, pg_core_1.integer)("current_step").notNull().default(0),
    nextActionAt: (0, pg_core_1.timestamp)("next_action_at"),
    sentAt: (0, pg_core_1.timestamp)("sent_at"),
    error: (0, pg_core_1.text)("error"),
    retryCount: (0, pg_core_1.integer)("retry_count").notNull().default(0),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
}, (table) => {
    return {
        campaignLeadIdx: (0, pg_core_1.uniqueIndex)("campaign_lead_idx").on(table.campaignId, table.leadId),
    };
});
exports.adminWhitelist = (0, pg_core_1.pgTable)("admin_whitelist", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    email: (0, pg_core_1.text)("email").notNull().unique(),
    status: (0, pg_core_1.text)("status").notNull().default("active"),
    role: (0, pg_core_1.text)("role", { enum: ["admin", "superadmin"] }).notNull().default("admin"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.campaignEmails = (0, pg_core_1.pgTable)("campaign_emails", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    campaignId: (0, pg_core_1.uuid)("campaign_id").notNull().references(() => exports.outreachCampaigns.id, { onDelete: "cascade" }),
    leadId: (0, pg_core_1.uuid)("lead_id").notNull().references(() => exports.leads.id, { onDelete: "cascade" }),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    messageId: (0, pg_core_1.text)("message_id").notNull(),
    subject: (0, pg_core_1.text)("subject"),
    body: (0, pg_core_1.text)("body"),
    sentAt: (0, pg_core_1.timestamp)("sent_at").notNull().defaultNow(),
    status: (0, pg_core_1.text)("status", { enum: ["sent", "delivered", "opened", "clicked", "replied", "bounced"] }).notNull().default("sent"),
    stepIndex: (0, pg_core_1.integer)("step_index").notNull().default(0),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
});
exports.emailReplyStore = (0, pg_core_1.pgTable)("email_reply_store", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    messageId: (0, pg_core_1.text)("message_id").notNull().unique(),
    inReplyTo: (0, pg_core_1.text)("in_reply_to").notNull(),
    campaignId: (0, pg_core_1.uuid)("campaign_id").references(() => exports.outreachCampaigns.id, { onDelete: "set null" }),
    leadId: (0, pg_core_1.uuid)("lead_id").references(() => exports.leads.id, { onDelete: "set null" }),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    fromAddress: (0, pg_core_1.text)("from_address").notNull(),
    subject: (0, pg_core_1.text)("subject"),
    body: (0, pg_core_1.text)("body"),
    receivedAt: (0, pg_core_1.timestamp)("received_at").notNull().defaultNow(),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
});
exports.aiProcessLogs = (0, pg_core_1.pgTable)("ai_process_logs", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    type: (0, pg_core_1.text)("type").notNull(), // "import_csv", "email_verification", etc.
    status: (0, pg_core_1.text)("status", { enum: ["processing", "completed", "failed"] }).notNull().default("processing"),
    totalItems: (0, pg_core_1.integer)("total_items").notNull().default(0),
    processedItems: (0, pg_core_1.integer)("processed_items").notNull().default(0),
    metadata: (0, pg_core_1.jsonb)("metadata").$type().notNull().default((0, drizzle_orm_1.sql) `'{}'::jsonb`),
    error: (0, pg_core_1.text)("error"),
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at").notNull().defaultNow(),
});
// Generate insert schemas from Drizzle tables
exports.insertUserSchema = (0, drizzle_zod_1.createInsertSchema)(exports.users).omit({ id: true, createdAt: true });
exports.insertLeadSchema = (0, drizzle_zod_1.createInsertSchema)(exports.leads).omit({ id: true, createdAt: true, updatedAt: true });
exports.insertMessageSchema = (0, drizzle_zod_1.createInsertSchema)(exports.messages).omit({ id: true, createdAt: true });
exports.insertIntegrationSchema = (0, drizzle_zod_1.createInsertSchema)(exports.integrations).omit({ id: true, createdAt: true });
exports.insertDealSchema = (0, drizzle_zod_1.createInsertSchema)(exports.deals);
exports.insertVoiceSettingSchema = (0, drizzle_zod_1.createInsertSchema)(exports.voiceSettings);
exports.insertAutomationSchema = (0, drizzle_zod_1.createInsertSchema)(exports.automations);
exports.insertCalendarEventSchema = (0, drizzle_zod_1.createInsertSchema)(exports.calendarEvents);
exports.insertNotificationSchema = (0, drizzle_zod_1.createInsertSchema)(exports.notifications);
exports.insertWebhookSchema = (0, drizzle_zod_1.createInsertSchema)(exports.webhooks);
exports.insertApiKeySchema = (0, drizzle_zod_1.createInsertSchema)(exports.apiKeys);
exports.insertInsightSchema = (0, drizzle_zod_1.createInsertSchema)(exports.insights);
exports.insertPaymentSchema = (0, drizzle_zod_1.createInsertSchema)(exports.payments);
exports.insertBrandEmbeddingSchema = (0, drizzle_zod_1.createInsertSchema)(exports.brandEmbeddings);
exports.insertOnboardingProfileSchema = (0, drizzle_zod_1.createInsertSchema)(exports.onboardingProfiles);
exports.insertOAuthAccountSchema = (0, drizzle_zod_1.createInsertSchema)(exports.oauthAccounts);
exports.insertOtpCodeSchema = (0, drizzle_zod_1.createInsertSchema)(exports.otpCodes);
exports.insertEmailWarmupScheduleSchema = (0, drizzle_zod_1.createInsertSchema)(exports.emailWarmupSchedules);
exports.insertBounceTrackerSchema = (0, drizzle_zod_1.createInsertSchema)(exports.bounceTracker);
exports.insertCalendarSettingsSchema = (0, drizzle_zod_1.createInsertSchema)(exports.calendarSettings);
exports.insertVideoAssetSchema = (0, drizzle_zod_1.createInsertSchema)(exports.videoAssets);
exports.insertAiActionLogSchema = (0, drizzle_zod_1.createInsertSchema)(exports.aiActionLogs);
exports.insertAiProcessLogSchema = (0, drizzle_zod_1.createInsertSchema)(exports.aiProcessLogs);
exports.insertCalendarBookingSchema = (0, drizzle_zod_1.createInsertSchema)(exports.calendarBookings);
exports.insertAutomationRuleSchema = (0, drizzle_zod_1.createInsertSchema)(exports.automationRules);
exports.insertContentLibrarySchema = (0, drizzle_zod_1.createInsertSchema)(exports.contentLibrary);
exports.insertConversationEventSchema = (0, drizzle_zod_1.createInsertSchema)(exports.conversationEvents);
exports.insertThreadSchema = (0, drizzle_zod_1.createInsertSchema)(exports.threads);
exports.insertLeadInsightSchema = (0, drizzle_zod_1.createInsertSchema)(exports.leadInsights);
exports.insertProspectSchema = (0, drizzle_zod_1.createInsertSchema)(exports.prospects);
exports.insertScrapingSessionSchema = (0, drizzle_zod_1.createInsertSchema)(exports.scrapingSessions);
exports.insertOrganizationSchema = (0, drizzle_zod_1.createInsertSchema)(exports.organizations).omit({ id: true, createdAt: true });
exports.insertTeamMemberSchema = (0, drizzle_zod_1.createInsertSchema)(exports.teamMembers).omit({ id: true, invitedAt: true });
exports.insertBrandPdfCacheSchema = (0, drizzle_zod_1.createInsertSchema)(exports.brandPdfCache);
exports.insertAdminWhitelistSchema = (0, drizzle_zod_1.createInsertSchema)(exports.adminWhitelist);
exports.insertAiLearningPatternSchema = (0, drizzle_zod_1.createInsertSchema)(exports.aiLearningPatterns);
exports.pushSubscriptions = (0, pg_core_1.pgTable)("push_subscriptions", {
    id: (0, pg_core_1.uuid)("id").primaryKey().default((0, drizzle_orm_1.sql) `gen_random_uuid()`),
    userId: (0, pg_core_1.uuid)("user_id").notNull().references(() => exports.users.id, { onDelete: "cascade" }),
    endpoint: (0, pg_core_1.text)("endpoint").notNull().unique(),
    keys: (0, pg_core_1.jsonb)("keys").$type().notNull(), // Use simple object instead of complex parsing
    createdAt: (0, pg_core_1.timestamp)("created_at").notNull().defaultNow(),
});
exports.insertPushSubscriptionSchema = (0, drizzle_zod_1.createInsertSchema)(exports.pushSubscriptions);
// LEGACY - Keep old Zod schemas for backward compatibility (deprecated)
exports.userSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    supabaseId: zod_1.z.string().nullable(),
    email: zod_1.z.string().email(),
    name: zod_1.z.string().nullable(),
    username: zod_1.z.string().nullable(),
    avatar: zod_1.z.string().url().nullable(),
    company: zod_1.z.string().nullable(),
    timezone: zod_1.z.string().default("America/New_York"),
    plan: zod_1.z.enum(["trial", "starter", "pro", "enterprise"]).default("trial"),
    trialExpiresAt: zod_1.z.date().nullable(),
    replyTone: zod_1.z.enum(["friendly", "professional", "short"]).default("professional"),
    role: zod_1.z.enum(["admin", "member"]).default("member"),
    stripeCustomerId: zod_1.z.string().nullable(),
    stripeSubscriptionId: zod_1.z.string().nullable(),
    createdAt: zod_1.z.date(),
    lastLogin: zod_1.z.date().nullable(),
});
// ========== LEADS ==========
exports.leadSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    externalId: zod_1.z.string().nullable(),
    name: zod_1.z.string(),
    channel: zod_1.z.enum(["instagram", "email"]),
    email: zod_1.z.string().email().nullable(),
    phone: zod_1.z.string().nullable(),
    company: zod_1.z.string().nullable(),
    role: zod_1.z.string().nullable(),
    bio: zod_1.z.string().nullable(),
    status: zod_1.z.enum(["new", "open", "replied", "converted", "not_interested", "cold", "hardened", "recovered", "bouncy"]).default("new"),
    verified: zod_1.z.boolean().default(false),
    verifiedAt: zod_1.z.date().nullable(),
    score: zod_1.z.number().min(0).max(100).default(0),
    warm: zod_1.z.boolean().default(false),
    lastMessageAt: zod_1.z.date().nullable(),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    metadata: zod_1.z.record(zod_1.z.any()).default({}),
    createdAt: zod_1.z.date(),
    updatedAt: zod_1.z.date(),
});
// ========== MESSAGES ==========
exports.messageSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    leadId: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    provider: zod_1.z.enum(["instagram", "gmail"]),
    direction: zod_1.z.enum(["inbound", "outbound"]),
    body: zod_1.z.string(),
    audioUrl: zod_1.z.string().url().nullable(),
    trackingId: zod_1.z.string().nullable(),
    openedAt: zod_1.z.date().nullable(),
    clickedAt: zod_1.z.date().nullable(),
    repliedAt: zod_1.z.date().nullable(),
    metadata: zod_1.z.record(zod_1.z.any()).default({}),
    createdAt: zod_1.z.date(),
});
// ========== DEALS ==========
exports.dealSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    leadId: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    brand: zod_1.z.string(),
    channel: zod_1.z.enum(["instagram", "email"]),
    value: zod_1.z.number(),
    status: zod_1.z.enum(["converted", "lost", "pending"]).default("pending"),
    notes: zod_1.z.string().nullable(),
    convertedAt: zod_1.z.date().nullable(),
    meetingScheduled: zod_1.z.boolean().default(false),
    meetingUrl: zod_1.z.string().url().nullable(),
    createdAt: zod_1.z.date(),
});
// ========== INTEGRATIONS ==========
exports.integrationSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    provider: zod_1.z.enum(["instagram", "gmail", "outlook", "manychat", "custom_email"]),
    encryptedMeta: zod_1.z.string(), // Encrypted credentials as string (iv:tag:ciphertext)
    connected: zod_1.z.boolean().default(false),
    accountType: zod_1.z.enum(["personal", "creator", "business"]).nullable(),
    lastSync: zod_1.z.date().nullable(),
    createdAt: zod_1.z.date(),
});
// ========== VOICE SETTINGS ==========
exports.voiceSettingSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    isActive: zod_1.z.boolean().default(false),
    voiceSampleUrl: zod_1.z.string().url().nullable(),
    voiceCloneId: zod_1.z.string().nullable(),
    consentGiven: zod_1.z.boolean().default(false),
    minutesUsed: zod_1.z.number().default(0),
    minutesAllowed: zod_1.z.number().default(100),
    createdAt: zod_1.z.date(),
    updatedAt: zod_1.z.date(),
});
// ========== AUTOMATIONS ==========
exports.automationSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    name: zod_1.z.string(),
    description: zod_1.z.string(),
    isActive: zod_1.z.boolean().default(true),
    tone: zod_1.z.enum(["friendly", "professional", "short"]).default("professional"),
    schedule: zod_1.z.array(zod_1.z.object({
        delay: zod_1.z.string(), // "12h", "24h", "48h", "72h", "7d"
        action: zod_1.z.string(), // "send_message", "escalate_channel", "send_voice"
        channel: zod_1.z.enum(["instagram", "email"]).nullable(),
        randomizationWindow: zod_1.z.number().default(0), // Minutes of variance
    })).default([]),
    triggers: zod_1.z.array(zod_1.z.object({
        condition: zod_1.z.string(),
        value: zod_1.z.string(),
    })).default([]),
    createdAt: zod_1.z.date(),
    updatedAt: zod_1.z.date(),
});
// ========== CALENDAR EVENTS ==========
exports.calendarEventSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    leadId: zod_1.z.string().uuid().nullable(),
    title: zod_1.z.string(),
    description: zod_1.z.string().nullable(),
    startTime: zod_1.z.date(),
    endTime: zod_1.z.date(),
    meetingUrl: zod_1.z.string().url().nullable(),
    provider: zod_1.z.enum(["google", "outlook"]),
    externalId: zod_1.z.string(),
    attendees: zod_1.z.array(zod_1.z.string().email()).default([]),
    isAiBooked: zod_1.z.boolean().default(false),
    preCallNote: zod_1.z.string().nullable(),
    createdAt: zod_1.z.date(),
});
// ========== NOTIFICATIONS ==========
exports.notificationSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    type: zod_1.z.enum(["webhook_error", "billing_issue", "conversion", "lead_reply", "system", "insight"]),
    title: zod_1.z.string(),
    message: zod_1.z.string(),
    isRead: zod_1.z.boolean().default(false),
    actionUrl: zod_1.z.string().url().nullable(),
    metadata: zod_1.z.record(zod_1.z.any()).default({}),
    createdAt: zod_1.z.date(),
});
// Duplicate TEAM MEMBERS block removed
// ========== WEBHOOKS ==========
exports.webhookSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    url: zod_1.z.string().url(),
    events: zod_1.z.array(zod_1.z.string()).default([]),
    secret: zod_1.z.string(),
    isActive: zod_1.z.boolean().default(true),
    lastTriggeredAt: zod_1.z.date().nullable(),
    failureCount: zod_1.z.number().default(0),
    createdAt: zod_1.z.date(),
});
// ========== ADMIN METRICS ==========
exports.adminMetricsSchema = zod_1.z.object({
    totalUsers: zod_1.z.number(),
    activeUsers: zod_1.z.number(),
    trialUsers: zod_1.z.number(),
    paidUsers: zod_1.z.number(),
    mrr: zod_1.z.number(),
    apiBurn: zod_1.z.number(),
    failedJobs: zod_1.z.number(),
    storageUsed: zod_1.z.number(),
    timestamp: zod_1.z.date(),
});
// ========== USAGE STATS ==========
exports.usageStatsSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    plan: zod_1.z.enum(["trial", "starter", "pro", "enterprise"]),
    leadsCount: zod_1.z.number(),
    leadsLimit: zod_1.z.number(),
    voiceMinutesUsed: zod_1.z.number(),
    voiceMinutesLimit: zod_1.z.number(),
    messagesThisMonth: zod_1.z.number(),
    storageUsed: zod_1.z.number(),
    period: zod_1.z.object({
        start: zod_1.z.date(),
        end: zod_1.z.date(),
    }),
});
// ========== INSIGHTS ==========
exports.insightSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    period: zod_1.z.object({
        start: zod_1.z.date(),
        end: zod_1.z.date(),
    }),
    summary: zod_1.z.string(),
    metrics: zod_1.z.object({
        totalLeads: zod_1.z.number(),
        conversions: zod_1.z.number(),
        conversionRate: zod_1.z.number(),
        topChannel: zod_1.z.string(),
        topPerformingTime: zod_1.z.string(),
        avgResponseTime: zod_1.z.string(),
    }),
    channelBreakdown: zod_1.z.array(zod_1.z.object({
        channel: zod_1.z.string(),
        count: zod_1.z.number(),
        percentage: zod_1.z.number(),
    })),
    generatedAt: zod_1.z.date(),
});
// ========== API KEYS ==========
exports.apiKeySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    name: zod_1.z.string(),
    key: zod_1.z.string(),
    lastUsedAt: zod_1.z.date().nullable(),
    expiresAt: zod_1.z.date().nullable(),
    createdAt: zod_1.z.date(),
});
