import { drizzleStorage } from "./drizzle-storage.js";
import { type User, type InsertUser, type Lead, type InsertLead, type Message, type InsertMessage, type Integration, type InsertIntegration, type Deal, type InsertDeal, type FollowUpQueue, type InsertFollowUpQueue, type OAuthAccount, type InsertOAuthAccount, type CalendarEvent, type InsertCalendarEvent, type AuditTrail, type InsertAuditTrail, type Organization, type InsertOrganization, type TeamMember, type InsertTeamMember, type Payment, type InsertPayment, type AiLearningPattern, type InsertAiLearningPattern, type SmtpSettings, type InsertSmtpSettings, type EmailMessage, type InsertEmailMessage, type Notification, type InsertNotification, type Thread, type InsertThread, type LeadInsight, type InsertLeadInsight, type OutreachCampaign, type InsertOutreachCampaign, type CampaignLead, type InsertCampaignLead, type FathomCall, type InsertFathomCall, type PendingPayment, type InsertPendingPayment, smtpSettings, users, leads, messages, integrations, deals, followUpQueue, aiLearningPatterns, notifications, threads, leadInsights, outreachCampaigns, campaignLeads, fathomCalls, pendingPayments } from "@audnix/shared";
import { getPlanCapabilities, getActivePlanId } from "../../../shared/plan-utils.js";
import { randomUUID } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from '@shared/lib/db/db.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';


export type MessageDraft = Partial<InsertMessage> & { leadId: string; userId: string; body: string };

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBySupabaseId(supabaseId: string): Promise<User | undefined>;
  toggleAi(leadId: string, paused: boolean): Promise<void>;
  createUser(user: Partial<InsertUser> & { email: string }): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  getUsersNeedingWeeklyInsights(): Promise<User[]>;
  getUsersWithActiveVideoMonitors(): Promise<User[]>;
  getPaymentStats(): Promise<Record<string, number>>;
  getPendingLegacyPayments(): Promise<any[]>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  getUserByOutlookSubscriptionId(subscriptionId: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUserCount(): Promise<number>;
  getUsers(): Promise<User[]>;
  deleteUser(id: string): Promise<void>;

  // Organization methods
  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  getOrganizationsByOwner(ownerId: string): Promise<Organization[]>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, updates: Partial<Organization>): Promise<Organization | undefined>;

  // Team Member methods
  getTeamMember(orgId: string, userId: string): Promise<TeamMember | undefined>;
  getOrganizationMembers(orgId: string): Promise<(TeamMember & { user: User })[]>;
  getUserOrganizations(userId: string): Promise<(Organization & { role: TeamMember["role"] })[]>;
  addTeamMember(member: InsertTeamMember): Promise<TeamMember>;
  removeTeamMember(orgId: string, userId: string): Promise<void>;

  // Lead methods
  getLeads(options: { 
    userId: string; 
    status?: string; 
    channel?: string; 
    search?: string; 
    limit?: number; 
    offset?: number; 
    includeArchived?: boolean; 
    integrationId?: string; 
    excludeActiveCampaignLeads?: boolean 
  }): Promise<Lead[]>;
  getLeadsList(userId: string): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  getLeadById(id: string): Promise<Lead | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getLeadByUsername(username: string, channel: string): Promise<Lead | undefined>;
  getLeadByEmail(email: string, userId: string): Promise<Lead | undefined>;
  findLeadBySenderAndIntegration(email: string, integrationId: string): Promise<Lead | undefined>;
  getExistingEmails(userId: string, emails: string[]): Promise<string[]>;
  getLeadsCount(userId: string): Promise<number>;
  getLeadBySocialId(socialId: string, channel: string): Promise<Lead | undefined>;
  createLead(lead: Partial<InsertLead> & { userId: string; name: string; channel: string }, options?: { suppressNotification?: boolean }): Promise<Lead>;
  createLeadsBatch(leads: Array<Partial<InsertLead> & { userId: string; name: string; channel: string }>, options?: { suppressNotification?: boolean }): Promise<Lead[]>;
  updateLead(id: string, updates: Partial<Lead>, options?: { suppressNotification?: boolean }): Promise<Lead | undefined>;
  reserveLeadForAction(leadId: string, workerName: string, durationMs?: number): Promise<boolean>;
  archiveLead(id: string, userId: string, archived: boolean): Promise<Lead | undefined>;
  deleteLead(id: string, userId: string): Promise<void>;
  archiveMultipleLeads(ids: string[], userId: string, archived: boolean): Promise<void>;
  deleteMultipleLeads(ids: string[], userId: string): Promise<void>;
  getTotalLeadsCount(): Promise<number>;
  createAuditLog(data: InsertAuditTrail): Promise<AuditTrail>;
  getAuditLogs(userId: string, options?: { integrationId?: string, daysFilter?: number, limit?: number }): Promise<AuditTrail[]>;
  incrementAIFailureCount(leadId: string): Promise<boolean>;

  // Message methods
  getMessagesByLeadId(leadId: string): Promise<Message[]>;
  getAllMessages(userId: string, options?: { limit?: number; channel?: string; integrationId?: string }): Promise<Message[]>;
  getMessages(userId: string, options?: { limit?: number; channel?: string; integrationId?: string }): Promise<Message[]>;
  createMessage(message: Partial<InsertMessage> & { leadId: string; userId: string; direction: "inbound" | "outbound"; body: string; threadId?: string }, tx?: any): Promise<Message>;
  updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined>;
  getMessageByTrackingId(trackingId: string): Promise<Message | undefined>;

  // Thread methods
  getOrCreateThread(userId: string, leadId: string, subject: string, providerThreadId?: string): Promise<Thread>;
  getThreadsByLeadId(leadId: string): Promise<Thread[]>;
  updateThread(id: string, updates: Partial<Thread>): Promise<Thread | undefined>;

  // Integration methods
  getIntegrations(userId: string): Promise<Integration[]>;
  getIntegration(userId: string, provider: string): Promise<Integration | undefined>;
  getIntegrationById(id: string): Promise<Integration | undefined>;
  getIntegrationsByProvider(provider: string): Promise<Integration[]>;
  getOAuthAccountsByProvider(provider: string): Promise<OAuthAccount[]>;
  getOAuthAccountByProviderAccountId(provider: string, providerAccountId: string): Promise<OAuthAccount | undefined>;
  createIntegration(integration: Partial<InsertIntegration> & { userId: string; provider: string; encryptedMeta: string }): Promise<Integration>;
  updateIntegration(userId: string, provider: string, updates: Partial<Integration>): Promise<Integration | undefined>;
  updateIntegrationById(id: string, updates: Partial<Integration>): Promise<Integration | undefined>;
  disconnectIntegration(userId: string, provider: string): Promise<void>;
  deleteIntegration(userId: string, provider: string): Promise<void>;
  deleteIntegrationById(id: string): Promise<void>;
  checkMailboxLimit(userId: string): Promise<{ allowed: boolean; current: number; limit: number; plan: string }>;
  getIntegrationSentCount(userId: string, integrationId: string, since: Date): Promise<number>;

  // Video monitor methods
  getVideoMonitors(userId: string): Promise<any[]>;
  createVideoMonitor(data: any): Promise<any>;
  updateVideoMonitor(id: string, userId: string, updates: any): Promise<any>;
  deleteVideoMonitor(id: string, userId: string): Promise<void>;
  isCommentProcessed(commentId: string): Promise<boolean>;
  markCommentProcessed(commentId: string, status: string, intentType: string): Promise<void>;
  getBrandKnowledge(userId: string): Promise<string>;

  // Deal tracking methods
  getDeals(userId: string, integrationId?: string): Promise<any[]>;
  createDeal(data: any): Promise<any>;
  updateDeal(id: string, userId: string, updates: any): Promise<any>;
  calculateRevenue(userId: string, integrationId?: string): Promise<{ total: number; thisMonth: number; deals: any[] }>;

  // Payment methods
  createPayment(data: InsertPayment): Promise<Payment>;
  getPayments(userId: string): Promise<Payment[]>;
  getPaymentById(id: string): Promise<Payment | undefined>;
  updatePayment(id: string, updates: Partial<Payment>): Promise<Payment | undefined>;

  // Usage tracking
  createUsageTopup(data: any): Promise<any>;
  getUsageHistory(userId: string, type?: string): Promise<any[]>;

  // Onboarding methods
  createOnboardingProfile(data: any): Promise<any>;
  getOnboardingProfile(userId: string): Promise<any | undefined>;
  updateOnboardingProfile(userId: string, updates: any): Promise<any | undefined>;

  // OTP methods
  createOtpCode(data: { email: string; code: string; expiresAt: Date; attempts: number; verified: boolean; passwordHash?: string; purpose?: string }): Promise<any>;
  getLatestOtpCode(email: string, purpose?: string): Promise<any>;
  incrementOtpAttempts(id: string): Promise<void>;
  markOtpVerified(id: string): Promise<void>;
  cleanupDemoData(): Promise<{ deletedUsers: number }>;

  // SMTP Settings
  getSmtpSettings(userId: string): Promise<SmtpSettings[]>;

  // Follow Up Queue
  createFollowUp(data: InsertFollowUpQueue): Promise<FollowUpQueue>;
  getPendingFollowUp(leadId: string): Promise<FollowUpQueue | undefined>;
  getFollowUpById(id: string): Promise<FollowUpQueue | undefined>;
  updateFollowUp(id: string, updates: Partial<FollowUpQueue>): Promise<FollowUpQueue | undefined>;
  getDueFollowUps(): Promise<FollowUpQueue[]>;
  clearFollowUpQueue(leadId: string): Promise<void>;

  // AI Learning Patterns
  getLearningPatterns(userId: string, filters?: { industry?: string; persona?: string; strengthThreshold?: number }): Promise<AiLearningPattern[]>;
  recordLearningPattern(userId: string, key: string, success: boolean, metadata?: { industry?: string; persona?: string; insight?: string }): Promise<void>;

  // OAuth Accounts
  getOAuthAccount(userId: string, provider: string, providerAccountId?: string): Promise<OAuthAccount | undefined>;
  getSoonExpiringOAuthAccounts(provider: string, thresholdMinutes: number): Promise<OAuthAccount[]>;
  saveOAuthAccount(data: InsertOAuthAccount): Promise<OAuthAccount>;
  deleteOAuthAccount(userId: string, provider: string, providerAccountId?: string): Promise<void>;

  // Reputation & Delivery
  getRecentBounces(userId: string, hours?: number): Promise<any[]>;
  getDomainVerifications(userId: string, limit?: number): Promise<any[]>;
  createDomainVerification(userId: string, data: any): Promise<any>;

  // Permanent Email Storage
  createEmailMessage(message: InsertEmailMessage): Promise<EmailMessage>;
  getEmailMessages(userId: string): Promise<EmailMessage[]>;
  getEmailMessageByMessageId(messageId: string): Promise<EmailMessage | undefined>;
  getActiveImapIntegrations(): Promise<Integration[]>;

  // Calendar Events
  createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent>;
  getCalendarEvents(userId: string): Promise<CalendarEvent[]>;

  // Lead Insight methods
  getLeadInsight(leadId: string): Promise<LeadInsight | undefined>;
  upsertLeadInsight(insight: InsertLeadInsight): Promise<LeadInsight>;

  // Voice Balance
  getVoiceMinutesBalance(userId: string): Promise<number>;

  // Analytics
  getAnalyticsSummary(userId: string, startDate: Date, integrationId?: string): Promise<{
    summary: {
      totalLeads: number;
      conversions: number;
      conversionRate: string;
      active: number;
      ghosted: number;
      notInterested: number;
      leadsReplied: number;
      bestReplyHour: number | null;
    };
    channelBreakdown: Array<{ channel: string; count: number; percentage: number }>;
    statusBreakdown: Array<{ status: string; count: number; percentage: number }>;
    timeline: Array<{ date: string; leads: number; conversions: number }>;
    positiveSentimentRate: string;
  }>;

  // Notifications
  getNotifications(userId: string, opts?: { limit?: number; offset?: number; dateFrom?: Date; dateTo?: Date; integrationId?: string }): Promise<Notification[]>;
  getUnreadNotificationCount(userId: string): Promise<number>;
  createNotification(data: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: string, userId?: string): Promise<Notification | undefined>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  clearAllNotifications(userId: string): Promise<void>;
  deleteNotification(id: string, userId: string): Promise<void>;

  getDashboardStats(userId: string, options?: { start?: Date; end?: Date; integrationId?: string }): Promise<{
    totalLeads: number;
    newLeads: number;
    activeLeads: number;
    convertedLeads: number;
    hardenedLeads: number;
    bouncyLeads: number;
    recoveredLeads: number;
    positiveIntents: number;
    totalMessages: number;
    messagesToday: number;
    messagesYesterday: number;
    aiReplies: number;
    pipelineValue: number;
    closedRevenue: number;
    openRate: number | null;
    responseRate: number | null;
    averageResponseTime: string;
    queuedLeads: number;
    undeliveredLeads: number;
    conversionRate: number | null;
    intentRate: number | null;
    outreachVelocity: number | null;
    timeSaved: number;
    globalBounceRate: number;
  }>;

  getAnalyticsFull(userId: string, days: number, integrationId?: string): Promise<{
    metrics: {
      sent: number;
      opened: number;
      replied: number;
      booked: number;
      leadsFiltered: number;
      conversionRate: number;
      responseRate: number;
      openRate: number;
      closedRevenue: number;
      pipelineValue: number;
      averageResponseTime: string;
    };
    timeSeries: Array<{
      name: string;
      sent_email: number;
      sent_instagram: number;
      opened: number;
      replied_email: number;
      replied_instagram: number;
      booked: number;
    }>;
    channelPerformance: Array<{ channel: string; value: number }>;
    recentEvents: Array<{ id: string; type: string; description: string; time: string; isNew: boolean }>;
  }>;

  // Outreach Campaign methods
  getOutreachCampaign(id: string): Promise<OutreachCampaign | undefined>;
  createOutreachCampaign(campaign: InsertOutreachCampaign): Promise<OutreachCampaign>;
  updateOutreachCampaign(id: string, updates: Partial<OutreachCampaign>): Promise<OutreachCampaign | undefined>;
  addLeadsToCampaign(campaignId: string, leads: { leadId: string }[]): Promise<void>;
  getCampaignLead(campaignId: string, leadId: string): Promise<CampaignLead | undefined>;
  updateCampaignLeadStatus(campaignId: string, leadId: string, status: CampaignLead["status"], error?: string): Promise<void>;
  scheduleNextCampaignStep(campaignLeadId: string, nextActionAt: Date): Promise<void>;
  
  // Fathom Meeting logic
  getFathomCalls(leadId: string): Promise<FathomCall[]>;
  createFathomCall(call: InsertFathomCall): Promise<FathomCall>;

  // Pending Payments logic
  getPendingPayments(userId: string): Promise<(PendingPayment & { lead: Lead | null })[]>;
  getPendingPayment(id: string): Promise<PendingPayment | undefined>;
  createPendingPayment(data: InsertPendingPayment): Promise<PendingPayment>;
  updatePendingPayment(id: string, updates: Partial<PendingPayment>): Promise<PendingPayment | undefined>;

  // Procedural Memory methods
  updateCampaignLeadProceduralMemory(campaignId: string, leadId: string, memory: Record<string, any>): Promise<void>;
  getCampaignLeadProceduralMemory(campaignId: string, leadId: string): Promise<Record<string, any> | undefined>;
  updateCampaignProceduralMemory(campaignId: string, memory: Record<string, any>): Promise<void>;
}

export class MemStorage implements IStorage {
  async incrementAIFailureCount(leadId: string): Promise<boolean> {
    return false;
  }
  private users: Map<string, User>;
  private leads: Map<string, Lead>;
  private messages: Map<string, Message>;
  private integrations: Map<string, Integration>;
  private organizations: Map<string, Organization>;
  private teamMembers: Map<string, TeamMember>;
  private payments: Map<string, Payment>;
  private threads: Map<string, Thread>;
  private leadInsightsStore: Map<string, LeadInsight>;
  private followUps: Map<string, FollowUpQueue>;
  private learningPatterns: Map<string, AiLearningPattern>;
  private emailMessages: Map<string, EmailMessage>;
  private auditLogs: Map<string, AuditTrail>;
  private calendarEvents: Map<string, CalendarEvent>;
  private otpCodes: Map<string, any>;
  private onboardingProfiles: Map<string, any>;
  private usageHistory: Map<string, any[]>;
  private notifications: Map<string, Notification>;
  private oauthAccounts: Map<string, OAuthAccount>;
  private videoMonitors: Map<string, any>;
  private outreachCampaigns: Map<string, OutreachCampaign>;
  private campaignLeads: Map<string, CampaignLead>;
  private processedComments: Set<string>;
  private brandKnowledge: Map<string, string>;
  private deals: Map<string, any>;
  private fathomCallsStore: Map<string, FathomCall>;
  private pendingPaymentsStore: Map<string, PendingPayment>;

  constructor() {
    this.users = new Map();
    this.leads = new Map();
    this.messages = new Map();
    this.integrations = new Map();
    this.organizations = new Map();
    this.teamMembers = new Map();
    this.payments = new Map();
    this.threads = new Map();
    this.leadInsightsStore = new Map();
    this.followUps = new Map();
    this.learningPatterns = new Map();
    this.emailMessages = new Map();
    this.auditLogs = new Map();
    this.calendarEvents = new Map();
    this.otpCodes = new Map();
    this.onboardingProfiles = new Map();
    this.usageHistory = new Map();
    this.notifications = new Map();
    this.oauthAccounts = new Map();
    this.videoMonitors = new Map();
    this.outreachCampaigns = new Map();
    this.campaignLeads = new Map();
    this.processedComments = new Set();
    this.brandKnowledge = new Map();
    this.deals = new Map();
    this.fathomCallsStore = new Map();
    this.pendingPaymentsStore = new Map();
  }

  async clearFollowUpQueue(leadId: string): Promise<void> {
    for (const [id, f] of this.followUps.entries()) {
      if (f.leadId === leadId) this.followUps.delete(id);
    }
  }

  // --- User Methods ---
  async getUser(id: string): Promise<User | undefined> { return this.users.get(id); }
  async getUserByEmail(email: string): Promise<User | undefined> { 
    return Array.from(this.users.values()).find(u => u.email.toLowerCase() === email.toLowerCase()); 
  }
  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username === username);
  }
  async getUserBySupabaseId(supabaseId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.supabaseId === supabaseId);
  }
  async toggleAi(leadId: string, paused: boolean): Promise<void> {
    const lead = this.leads.get(leadId);
    if (lead) {
      lead.aiPaused = paused;
      this.leads.set(leadId, lead);
    }
  }
  async createUser(insertUser: Partial<InsertUser> & { email: string }): Promise<User> {
    const id = randomUUID();
    const now = new Date();
    const user: User = {
      id,
      email: insertUser.email,
      password: insertUser.password || null,
      name: insertUser.name || null,
      username: insertUser.username || null,
      avatar: insertUser.avatar || null,
      company: insertUser.company || null,
      timezone: insertUser.timezone || "America/New_York",
      plan: insertUser.plan || "trial",
      subscriptionTier: insertUser.subscriptionTier || "free",
      trialExpiresAt: null,
      replyTone: insertUser.replyTone || "professional",
      role: insertUser.role || "member",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      supabaseId: insertUser.supabaseId || null,
      lastLogin: now,
      config: insertUser.config || {},
      calendarLink: null,
      brandGuidelinePdfUrl: null,
      brandGuidelinePdfText: null,
      filteredLeadsCount: 0,
      calendlyAccessToken: null,
      calendlyRefreshToken: null,
      calendlyExpiresAt: null,
      calendlyUserUri: null,
      createdAt: now,
      updatedAt: now,
      voiceCloneId: null,
      voiceMinutesUsed: 0,
      voiceMinutesTopup: 0,
      businessName: null,
      voiceRules: null,
      pdfConfidenceThreshold: 0.7,
      lastInsightGeneratedAt: null,
      lastProspectScanAt: null,
      paymentStatus: "none",
      pendingPaymentPlan: null,
      pendingPaymentAmount: null,
      pendingPaymentDate: null,
      paymentApprovedAt: null,
      stripeSessionId: null,
      subscriptionId: null,
      businessLogo: null,
      metadata: insertUser.metadata || {},
      intelligenceMetadata: {},
      defaultPaymentLink: insertUser.defaultPaymentLink || null,
      appLink: insertUser.appLink || null,
      offerDescription: insertUser.offerDescription || null,
      offerValue: insertUser.offerValue ?? 0,
      offerDescription2: insertUser.offerDescription2 || null,
      offerValue2: insertUser.offerValue2 ?? 0,
      aiAdjustCopyEnabled: insertUser.aiAdjustCopyEnabled ?? true,
      doubleOfferEnabled: insertUser.doubleOfferEnabled ?? false,
      aiStickerFollowupsEnabled: insertUser.aiStickerFollowupsEnabled ?? true,
    };
    this.users.set(id, user);
    return user;
  }
  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...updates, updatedAt: new Date() };
    this.users.set(id, updated);
    return updated;
  }
  async getAllUsers(): Promise<User[]> { return Array.from(this.users.values()); }
  async getUsers(): Promise<User[]> { return Array.from(this.users.values()); }
  async getUserCount(): Promise<number> { return this.users.size; }
  async deleteUser(id: string): Promise<void> { 
    this.users.delete(id); 
    // Simplified cascade delete for in-memory model
  }

  // --- Organization Methods ---
  async getOrganization(id: string): Promise<Organization | undefined> { return this.organizations.get(id); }
  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    return Array.from(this.organizations.values()).find(o => o.slug === slug);
  }
  async getOrganizationsByOwner(ownerId: string): Promise<Organization[]> {
    return Array.from(this.organizations.values()).filter(o => o.ownerId === ownerId);
  }
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const id = randomUUID();
    const newOrg: Organization = { ...org, id, createdAt: new Date(), updatedAt: new Date(), slug: org.slug || null, stripeCustomerId: null, subscriptionId: null, plan: org.plan || "trial", metadata: {} };
    this.organizations.set(id, newOrg);
    return newOrg;
  }
  async updateOrganization(id: string, updates: Partial<Organization>): Promise<Organization | undefined> {
    const org = this.organizations.get(id);
    if (!org) return undefined;
    const updated = { ...org, ...updates, updatedAt: new Date() };
    this.organizations.set(id, updated);
    return updated;
  }

  // --- Team Member Methods ---
  async getTeamMember(orgId: string, userId: string): Promise<TeamMember | undefined> {
    return Array.from(this.teamMembers.values()).find(m => m.organizationId === orgId && m.userId === userId);
  }
  async getOrganizationMembers(orgId: string): Promise<(TeamMember & { user: User })[]> {
    return Array.from(this.teamMembers.values())
      .filter(m => m.organizationId === orgId)
      .map(m => ({ ...m, user: this.users.get(m.userId)! }));
  }
  async getUserOrganizations(userId: string): Promise<(Organization & { role: TeamMember["role"] })[]> {
    return Array.from(this.teamMembers.values())
      .filter(m => m.userId === userId)
      .map(m => ({ ...this.organizations.get(m.organizationId)!, role: m.role }));
  }
  async addTeamMember(member: InsertTeamMember): Promise<TeamMember> {
    const id = randomUUID();
    const newMember: TeamMember = { ...member, id, invitedAt: new Date(), acceptedAt: null, invitedBy: member.invitedBy || null, role: member.role || "member" };
    this.teamMembers.set(id, newMember);
    return newMember;
  }
  async removeTeamMember(orgId: string, userId: string): Promise<void> {
    const member = Array.from(this.teamMembers.values()).find(m => m.organizationId === orgId && m.userId === userId);
    if (member) this.teamMembers.delete(member.id);
  }

  // --- Lead Methods ---
  async getLeads(options: { userId: string; status?: string; channel?: string; search?: string; limit?: number; offset?: number; includeArchived?: boolean; integrationId?: string; excludeActiveCampaignLeads?: boolean }): Promise<Lead[]> {
    let leads = Array.from(this.leads.values()).filter(l => l.userId === options.userId);
    if (options.status && options.status !== 'all') leads = leads.filter(l => l.status === options.status);
    if (options.channel) leads = leads.filter(l => l.channel === options.channel);
    if (!options.includeArchived) leads = leads.filter(l => !l.archived);
    if (options.integrationId) leads = leads.filter(l => l.integrationId === options.integrationId);
    if (options.search) {
      const s = options.search.toLowerCase();
      leads = leads.filter(l => l.name.toLowerCase().includes(s) || l.email?.toLowerCase().includes(s) || l.company?.toLowerCase().includes(s));
    }
    leads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const offset = options.offset || 0;
    if (options.limit) leads = leads.slice(offset, offset + options.limit);
    else if (offset) leads = leads.slice(offset);
    return leads;
  }
  async getLeadsList(userId: string): Promise<Lead[]> {
    return Array.from(this.leads.values()).filter(l => l.userId === userId);
  }
  async getLead(id: string): Promise<Lead | undefined> { return this.leads.get(id); }
  async getLeadById(id: string): Promise<Lead | undefined> { return this.leads.get(id); }
  async getUserById(id: string): Promise<User | undefined> { return this.users.get(id); }
  async getLeadByUsername(username: string, channel: string): Promise<Lead | undefined> {
    return Array.from(this.leads.values()).find(l => l.name === username && l.channel === channel);
  }
  async getLeadByEmail(email: string, userId: string): Promise<Lead | undefined> {
    return Array.from(this.leads.values()).find(l => l.userId === userId && l.email?.toLowerCase() === email.toLowerCase());
  }
  async findLeadBySenderAndIntegration(email: string, integrationId: string): Promise<Lead | undefined> {
    return Array.from(this.leads.values()).find(l => l.integrationId === integrationId && l.email?.toLowerCase() === email.toLowerCase());
  }
  async markLeadReplied(leadId: string): Promise<Lead | undefined> {
    const lead = this.leads.get(leadId);
    if (!lead) return undefined;
    const updated = { ...lead, status: 'replied' as const, updatedAt: new Date() };
    this.leads.set(leadId, updated);
    return updated;
  }
  async getExistingEmails(userId: string, emails: string[]): Promise<string[]> {
    const existing = Array.from(this.leads.values()).filter(l => l.userId === userId && l.email && emails.includes(l.email));
    return existing.map(l => l.email!);
  }
  async getLeadsCount(userId: string): Promise<number> {
    return Array.from(this.leads.values()).filter(l => l.userId === userId).length;
  }
  async getLeadBySocialId(socialId: string, channel: string): Promise<Lead | undefined> {
    return Array.from(this.leads.values()).find(l => l.externalId === socialId && l.channel === channel);
  }
  async createLead(insertLead: Partial<InsertLead> & { userId: string; name: string; channel: any }): Promise<Lead> {
    const id = randomUUID();
    const lead: Lead = {
      id,
      userId: insertLead.userId,
      organizationId: insertLead.organizationId || null,
      externalId: insertLead.externalId || null,
      name: insertLead.name,
      company: insertLead.company || null,
      role: insertLead.role || null,
      bio: insertLead.bio || null,
      snippet: insertLead.snippet || null,
      channel: insertLead.channel,
      email: insertLead.email || null,
      replyEmail: insertLead.replyEmail || insertLead.email || null,
      phone: insertLead.phone || null,
      status: (insertLead.status as any) || "new",
      score: insertLead.score || 0,
      warm: insertLead.warm || false,
      sentiment: (insertLead.sentiment as any) || "neutral",
      lastMessagePreview: insertLead.lastMessagePreview || null,
      lastMessageAt: insertLead.lastMessageAt || null,
      lastEnrichedAt: insertLead.lastEnrichedAt || null,
      aiPaused: insertLead.aiPaused ?? true,
      pdfConfidence: insertLead.pdfConfidence || null,
      archived: insertLead.archived || false,
      tags: insertLead.tags || [],
      integrationId: insertLead.integrationId || null,
      timezone: insertLead.timezone || null,
      calendlyLink: insertLead.calendlyLink || null,
      fathomMeetingId: insertLead.fathomMeetingId || null,
      metadata: insertLead.metadata || {},
      bant: insertLead.bant || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      verified: insertLead.verified || false,
      verifiedAt: insertLead.verifiedAt || null,
      website: insertLead.website || null,
      businessName: insertLead.businessName || null,
      city: insertLead.city || null,
      country: insertLead.country || null,
      niche: insertLead.niche || null,
      industry: insertLead.industry || null,
      revenue: insertLead.revenue || null,
      proceduralMemory: {},
    };
    this.leads.set(id, lead);
    return lead;
  }

  async createLeadsBatch(insertLeads: Array<Partial<InsertLead> & { userId: string; name: string; channel: string }>, options?: { suppressNotification?: boolean }): Promise<Lead[]> {
    return drizzleStorage.createLeadsBatch(insertLeads, options);
  }
  async updateLead(id: string, updates: Partial<Lead>, options?: { suppressNotification?: boolean }): Promise<Lead | undefined> {
    const lead = this.leads.get(id);
    if (!lead) return undefined;
    const updated = { ...lead, ...updates, updatedAt: new Date() };
    this.leads.set(id, updated);
    return updated;
  }
  async reserveLeadForAction(leadId: string, workerName: string, durationMs: number = 5000): Promise<boolean> {
    const lead = this.leads.get(leadId);
    if (!lead) return false;
    const now = new Date();
    const lockAt = (lead.metadata as any)?.processing_lock_at;
    const threshold = new Date(now.getTime() - durationMs);
    if (!lockAt || new Date(lockAt) < threshold) {
      lead.metadata = { ...(lead.metadata as any || {}), processing_lock_at: now.toISOString(), processing_worker: workerName, processing_lock_duration: durationMs };
      this.leads.set(leadId, lead);
      return true;
    }
    return false;
  }
  async archiveLead(id: string, userId: string, archived: boolean): Promise<Lead | undefined> {
    const lead = this.leads.get(id);
    if (!lead || lead.userId !== userId) return undefined;
    lead.archived = archived;
    lead.updatedAt = new Date();
    this.leads.set(id, lead);
    return lead;
  }
  async deleteLead(id: string, userId: string): Promise<void> {
    const lead = this.leads.get(id);
    if (lead && lead.userId === userId) this.leads.delete(id);
  }
  async archiveMultipleLeads(ids: string[], userId: string, archived: boolean): Promise<void> {
    ids.forEach(id => this.archiveLead(id, userId, archived));
  }
  async deleteMultipleLeads(ids: string[], userId: string): Promise<void> {
    ids.forEach(id => this.deleteLead(id, userId));
  }
  async getTotalLeadsCount(): Promise<number> { return this.leads.size; }
  async createAuditLog(data: InsertAuditTrail): Promise<AuditTrail> {
    const id = randomUUID();
    const log: AuditTrail = { ...data, id, createdAt: new Date(), leadId: data.leadId ?? null, integrationId: data.integrationId || null, messageId: data.messageId || null, details: data.details || {} };
    this.auditLogs.set(id, log);
    return log;
  }
  async getAuditLogs(userId: string, options?: { integrationId?: string, daysFilter?: number, limit?: number }): Promise<AuditTrail[]> {
    let logs = Array.from(this.auditLogs.values()).filter(l => l.userId === userId);
    if (options?.integrationId) logs = logs.filter(l => l.integrationId === options.integrationId);
    logs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (options?.limit) logs = logs.slice(0, options.limit);
    return logs;
  }

  // --- Message Methods ---
  async getMessagesByLeadId(leadId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter(m => m.leadId === leadId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async getMessages(userId: string, options?: { limit?: number; channel?: string; integrationId?: string }): Promise<Message[]> {
    return this.getAllMessages(userId, options);
  }
  async getAllMessages(userId: string, options?: { limit?: number; channel?: string; integrationId?: string }): Promise<Message[]> {
    let msgs = Array.from(this.messages.values()).filter(m => m.userId === userId);
    if (options?.channel) msgs = msgs.filter(m => m.provider === options.channel);
    if (options?.integrationId) msgs = msgs.filter(m => (m as any).integrationId === options.integrationId);
    msgs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (options?.limit) msgs = msgs.slice(0, options.limit);
    return msgs;
  }
  async createMessage(message: Partial<InsertMessage> & { leadId: string; userId: string; direction: "inbound" | "outbound"; body: string; threadId?: string }, tx?: any): Promise<Message> {
    const id = randomUUID();
    const now = new Date();
    // Use the actual email timestamp from Gmail/IMAP (metadata.date) if available,
    // otherwise fall back to current time. This fixes inbox timestamps not matching Gmail.
    const emailDate = (message.metadata as any)?.date
      ? new Date((message.metadata as any).date)
      : now;
    const createdAt = !isNaN(emailDate.getTime()) ? emailDate : now;
    const newMessage: Message = {
      id,
      leadId: message.leadId,
      userId: message.userId,
      threadId: (message.threadId as any) || null,
      provider: message.provider || "email",
      direction: message.direction,
      subject: message.subject || null,
      body: message.body,
      audioUrl: message.audioUrl || null,
      trackingId: message.trackingId || null,
      integrationId: (message as any).integrationId || null,
      targetUrl: null,
      openedAt: null,
      clickedAt: null,
      repliedAt: null,
      isRead: message.isRead ?? (message.direction === 'outbound'),
      externalId: null,
      uid: message.uid || null,
      isWarmup: message.isWarmup ?? false,
      metadata: message.metadata || {},
      createdAt,
      updatedAt: now,
    };
    this.messages.set(id, newMessage);

    // Track booking link sent in lead metadata
    const bodyText = message.body.toLowerCase();
    const hasBookingLink = bodyText.includes('calendly.com') ||
                          (message.metadata as any)?.intent === 'booking' ||
                          (message.metadata as any)?.isMeetingInvite === true;

    if (message.direction === 'outbound' && hasBookingLink) {
      const lead = this.leads.get(message.leadId);
      if (lead) {
        const leadMeta = { ...(lead.metadata as Record<string, any> || {}) };
        leadMeta.bookingLinkSentAt = new Date().toISOString();
        leadMeta.bookingReminderSentAt = null;
        leadMeta.bookingReminderStatus = 'pending';
        this.leads.set(message.leadId, { ...lead, metadata: leadMeta });
        console.log(`[BookingReminder] Registered booking link sent to lead ${message.leadId} at ${leadMeta.bookingLinkSentAt}`);
      }
    }

    // Detect booking intent in inbound replies
    if (message.direction === 'inbound') {
      const BOOKING_INTENT_PATTERNS = [
        /\blet'?s\b.*\b(book|schedule|meet|talk|hop|find|set)\b/i,
        /\bi'?d (like|love) to\b.*\b(book|schedule|talk|meet|hop)\b/i,
        /\byes\b.*\b(let'?s|book|schedule|meet|call)\b/i,
        /\bsounds good\b/i,
        /\blet'?s do (it|this)\b/i,
        /\bi'?m (ready|in|interested)\b/i,
        /\bsign me up\b/i,
        /\bschedule\b.*\b(call|meeting|time|demo)\b/i,
      ];
      const hasBookingIntent = BOOKING_INTENT_PATTERNS.some(p => p.test(message.body));
      if (hasBookingIntent) {
        const lead = this.leads.get(message.leadId);
        if (lead) {
          const leadMeta = { ...(lead.metadata as Record<string, any> || {}) };
          leadMeta.bookingIntentDetectedAt = new Date().toISOString();
          leadMeta.bookingReminderSentAt = null;
          leadMeta.bookingReminderStatus = 'intent_detected';
          this.leads.set(message.leadId, { ...lead, metadata: leadMeta });
          console.log(`[BookingReminder] Booking intent detected for lead ${message.leadId}`);
        }
      }
    }

    // Trigger WebSocket sync
    wsSync.notifyMessagesUpdated(message.userId, { event: 'INSERT', message: newMessage });

    return newMessage;
  }
  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined> {
    const msg = this.messages.get(id);
    if (!msg) return undefined;
    const updated = { ...msg, ...updates };
    this.messages.set(id, updated);
    
    // Trigger WebSocket sync
    wsSync.notifyMessagesUpdated(updated.userId, { event: 'UPDATE', message: updated });
    
    return updated;
  }
  async getMessageByTrackingId(trackingId: string): Promise<Message | undefined> {
    return Array.from(this.messages.values()).find(m => m.trackingId === trackingId);
  }
  async calculateRevenue(userId: string, integrationId?: string): Promise<{ total: number; thisMonth: number; deals: any[] }> {
    const deals = Array.from(this.deals.values()).filter(d => {
      const matchesUser = d.userId === userId;
      const lead = d.leadId ? this.leads.get(d.leadId) : null;
      const matchesIntegration = !integrationId || (lead && lead.integrationId === integrationId);
      return matchesUser && matchesIntegration;
    });
    const closedDeals = deals.filter(d => d.status === 'closed_won');

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const total = closedDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const thisMonth = closedDeals
      .filter(d => d.convertedAt && new Date(d.convertedAt) >= thisMonthStart)
      .reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    return { total, thisMonth, deals: closedDeals };
  }

  // Usage tracking

  async createUsageTopup(data: any): Promise<any> {
    const id = randomUUID();
    const now = new Date();
    const topup = { id, ...data, createdAt: now };

    if (!this.usageHistory.has(data.userId)) {
      this.usageHistory.set(data.userId, []);
    }
    this.usageHistory.get(data.userId)!.push(topup);
    return topup;
  }

  async getUsageHistory(userId: string, type?: string): Promise<any[]> {
    let history = this.usageHistory.get(userId) || [];
    if (type) {
      history = history.filter(item => item.type === type);
    }
    return history.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getSmtpSettings(userId: string): Promise<SmtpSettings[]> {
    return [];
  }

  async getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
    return Array.from(this.calendarEvents.values()).filter(e => e.userId === userId);
  }

  async getDeals(userId: string, integrationId?: string): Promise<any[]> {
    return Array.from(this.deals.values()).filter(d => {
      const matchUserId = d.userId === userId;
      if (!matchUserId) return false;
      if (integrationId) {
        const lead = d.leadId ? this.leads.get(d.leadId) : null;
        return lead && lead.integrationId === integrationId;
      }
      return true;
    });
  }

  async getPayments(userId: string): Promise<Payment[]> {
    return [];
  }

  async getPaymentById(id: string): Promise<Payment | undefined> {
    return undefined;
  }

  async updatePayment(id: string, updates: Partial<Payment>): Promise<Payment | undefined> {
    return undefined;
  }

  async createPayment(data: InsertPayment): Promise<Payment> {
    return {} as any;
  }


  // Onboarding methods

  async createOnboardingProfile(data: any): Promise<any> {
    const id = randomUUID();
    const now = new Date();
    const profile = {
      id,
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    this.onboardingProfiles.set(data.userId, profile);
    return profile;
  }

  async getOnboardingProfile(userId: string): Promise<any | undefined> {
    return this.onboardingProfiles.get(userId);
  }

  async updateOnboardingProfile(userId: string, updates: any): Promise<any | undefined> {
    const existing = this.onboardingProfiles.get(userId);
    if (!existing) return undefined;

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };

    this.onboardingProfiles.set(userId, updated);
    return updated;
  }

  // OTP methods (MemStorage implementation)

  async createOtpCode(data: { email: string; code: string; expiresAt: Date; attempts: number; verified: boolean; passwordHash?: string; purpose?: string }): Promise<any> {
    const id = randomUUID();
    const now = new Date();
    const otpCode = { id, ...data, purpose: data.purpose || 'login', createdAt: now, updatedAt: now };
    this.otpCodes.set(id, otpCode);
    return otpCode;
  }

  async getLatestOtpCode(email: string, purpose?: string): Promise<any> {
    // In-memory, this is inefficient, but for demonstration:
    return Array.from(this.otpCodes.values())
      .filter(code => code.email === email && (!purpose || code.purpose === purpose))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    const code = this.otpCodes.get(id);
    if (code) {
      code.attempts++;
      code.updatedAt = new Date();
      this.otpCodes.set(id, code);
    }
  }

  async markOtpVerified(id: string): Promise<void> {
    const code = this.otpCodes.get(id);
    if (code) {
      code.verified = true;
      code.updatedAt = new Date();
      this.otpCodes.set(id, code);
    }
  }

  // --- Fathom Meeting methods ---
  async getFathomCalls(leadId: string): Promise<FathomCall[]> {
    return Array.from(this.fathomCallsStore.values())
      .filter(c => c.leadId === leadId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  async createFathomCall(insertCall: InsertFathomCall): Promise<FathomCall> {
    const id = randomUUID();
    const call: FathomCall = {
      id,
      userId: insertCall.userId,
      leadId: insertCall.leadId,
      fathomMeetingId: insertCall.fathomMeetingId,
      title: insertCall.title || "Meeting",
      summary: insertCall.summary || null,
      transcript: insertCall.transcript || null,
      videoUrl: insertCall.videoUrl || null,
      videoThumbnail: insertCall.videoThumbnail || null,
      occurredAt: insertCall.occurredAt ? new Date(insertCall.occurredAt) : new Date(),
      metadata: insertCall.metadata || {},
      analysis: null,
      createdAt: new Date(),
    };
    this.fathomCallsStore.set(id, call);
    return call;
  }

  async cleanupDemoData(): Promise<{ deletedUsers: number }> {
    let deletedCount = 0;
    for (const [id, user] of this.users.entries()) {
      if (user.email.toLowerCase().endsWith('@demo.com')) {
        this.users.delete(id);
        deletedCount++;
      }
    }
    return { deletedUsers: deletedCount };
  }

  // getUserByEmail is already defined above for User, but for OTP context, we might need to return null if not found.
  // The interface definition for IStorage already has a getUserByEmail that returns User | null.
  // If the existing implementation returns undefined and needs to return null, it would be changed.
  // For now, assuming the existing getUserByEmail is compatible or will be adjusted.
  // If a distinct getUserByEmail for OTP context is needed, it would be implemented here.

  // ========== Follow Up Queue ==========

  async createFollowUp(data: InsertFollowUpQueue): Promise<FollowUpQueue> {
    const id = randomUUID();
    const followUp: FollowUpQueue = {
      id,
      userId: data.userId,
      leadId: data.leadId,
      channel: data.channel,
      scheduledAt: data.scheduledAt ? (data.scheduledAt instanceof Date ? data.scheduledAt : new Date(data.scheduledAt)) : null,
      status: data.status || "pending",
      processedAt: null,
      integrationId: data.integrationId || null,
      context: data.context || {},
      errorMessage: null,
      createdAt: new Date(),
    };
    this.followUps.set(id, followUp);
    return followUp;
  }

  async getPendingFollowUp(leadId: string): Promise<FollowUpQueue | undefined> {
    return Array.from(this.followUps.values()).find(f => f.leadId === leadId && f.status === 'pending');
  }

  async getFollowUpById(id: string): Promise<FollowUpQueue | undefined> {
    return this.followUps.get(id);
  }

  async updateFollowUp(id: string, updates: Partial<FollowUpQueue>): Promise<FollowUpQueue | undefined> {
    const existing = this.followUps.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.followUps.set(id, updated);
    return updated;
  }

  async getDueFollowUps(): Promise<FollowUpQueue[]> {
    const now = new Date();
    return Array.from(this.followUps.values()).filter(f => f.status === 'pending' && f.scheduledAt && f.scheduledAt <= now);
  }

  async getLearningPatterns(userId: string): Promise<AiLearningPattern[]> {
    return Array.from(this.learningPatterns.values()).filter(p => p.userId === userId);
  }

  async recordLearningPattern(userId: string, key: string, success: boolean): Promise<void> {
    const id = randomUUID();
    const pattern: AiLearningPattern = {
      id,
      userId,
      patternKey: key,
      strength: success ? 1 : 0,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1,
      lastUsedAt: new Date(),
      metadata: {},
      createdAt: new Date(),
    };
    this.learningPatterns.set(id, pattern);
  }


  // ========== OAuth Accounts ==========

  async getOAuthAccount(userId: string, provider: string, providerAccountId?: string): Promise<OAuthAccount | undefined> {
    return Array.from(this.oauthAccounts.values()).find(a => 
      a.userId === userId && 
      a.provider === provider && 
      (!providerAccountId || a.providerAccountId === providerAccountId)
    );
  }

  async getOAuthAccountByAccountId(userId: string, provider: string, accountId: string): Promise<OAuthAccount | undefined> {
    return Array.from(this.oauthAccounts.values()).find(
      (account) => account.userId === userId && account.provider === provider && account.providerAccountId === accountId
    );
  }

  async getSoonExpiringOAuthAccounts(provider: string, thresholdMinutes: number): Promise<OAuthAccount[]> {
    const now = Date.now();
    const threshold = now + thresholdMinutes * 60 * 1000;
    return Array.from(this.oauthAccounts.values()).filter(
      account => account.provider === provider &&
        account.expiresAt &&
        account.expiresAt.getTime() < threshold
    );
  }

  async saveOAuthAccount(data: InsertOAuthAccount): Promise<OAuthAccount> {
    const existing = await this.getOAuthAccountByAccountId(data.userId, data.provider, data.providerAccountId);
    const id = existing ? existing.id : randomUUID();
    const now = new Date();

    const account: OAuthAccount = {
      id,
      userId: data.userId,
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      accessToken: data.accessToken || null,
      refreshToken: data.refreshToken || null,
      expiresAt: data.expiresAt ? (data.expiresAt instanceof Date ? data.expiresAt : new Date(data.expiresAt)) : null,
      scope: data.scope || null,
      tokenType: data.tokenType || null,
      idToken: data.idToken || null,
      metadata: data.metadata || {},
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    this.oauthAccounts.set(id, account);
    return account;
  }

  async deleteOAuthAccount(userId: string, provider: string, providerAccountId?: string): Promise<void> {
    const accounts = Array.from(this.oauthAccounts.values()).filter(
      (account) => account.userId === userId && account.provider === provider && (!providerAccountId || account.providerAccountId === providerAccountId)
    );
    for (const account of accounts) {
      this.oauthAccounts.delete(account.id);
    }
  }

  // ========== Calendar Events ==========

  async createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent> {
    const id = randomUUID();
    const event: CalendarEvent = {
      id,
      userId: data.userId,
      leadId: data.leadId || null,
      title: data.title,
      description: data.description || null,
      startTime: data.startTime instanceof Date ? data.startTime : new Date(data.startTime),
      endTime: data.endTime instanceof Date ? data.endTime : new Date(data.endTime),
      meetingUrl: data.meetingUrl || null,
      provider: data.provider,
      externalId: data.externalId,
      attendees: data.attendees || [],
      attendeeEmail: data.attendeeEmail || null,
      attendeeName: data.attendeeName || null,
      status: data.status || "scheduled",
      isAiBooked: data.isAiBooked || false,
      preCallNote: data.preCallNote || null,
      metadata: (data.metadata as Record<string, any>) || {},
      createdAt: new Date(),
    };
    this.calendarEvents.set(id, event);
    return event;
  }

  // ========== Audit Trail ==========


  async checkMailboxLimit(userId: string): Promise<{ allowed: boolean; current: number; limit: number; plan: string }> {
    const user = this.users.get(userId);
    const plan = getActivePlanId(user);
    const capabilities = getPlanCapabilities(plan);
    const limit = capabilities.mailboxLimit || 1;
    
    const current = Array.from(this.integrations.values()).filter(i => 
      i.userId === userId && 
      i.connected && 
      ['custom_email', 'gmail', 'outlook'].includes(i.provider)
    ).length;
    
    return { 
      allowed: limit === -1 ? true : current < limit, 
      current, 
      limit, 
      plan 
    };
  }

  async getIntegrationSentCount(userId: string, integrationId: string, since: Date): Promise<number> {
    return Array.from(this.messages.values()).filter(m => 
      m.userId === userId && 
      m.direction === 'outbound' && 
      m.createdAt >= since && 
      (m as any).integrationId === integrationId
    ).length;
  }

  async createEmailMessage(message: InsertEmailMessage): Promise<EmailMessage> {
    return { ...message, id: randomUUID(), createdAt: new Date() } as any;
  }

  async getEmailMessages(userId: string): Promise<EmailMessage[]> {
    return [];
  }

  async getEmailMessageByMessageId(messageId: string): Promise<EmailMessage | undefined> {
    return Array.from(this.emailMessages.values()).find(m => m.messageId === messageId);
  }

  async getActiveImapIntegrations(): Promise<Integration[]> {
    return Array.from(this.integrations.values()).filter(i => 
      i.connected && (i.provider === 'gmail' || i.provider === 'outlook' || i.provider === 'custom_email')
    );
  }

  async getDashboardStats(userId: string, options?: { start?: Date; end?: Date; integrationId?: string }): Promise<{
    totalLeads: number;
    newLeads: number;
    activeLeads: number;
    convertedLeads: number;
    hardenedLeads: number;
    bouncyLeads: number;
    recoveredLeads: number;
    positiveIntents: number;
    totalMessages: number;
    messagesToday: number;
    messagesYesterday: number;
    aiReplies: number;
    pipelineValue: number;
    closedRevenue: number;
    openRate: number | null;
    responseRate: number | null;
    averageResponseTime: string;
    queuedLeads: number;
    undeliveredLeads: number;
    conversionRate: number | null;
    intentRate: number | null;
    outreachVelocity: number | null;
    timeSaved: number;
    globalBounceRate: number;
  }> {
    const userLeads = Array.from(this.leads.values()).filter(l => l.userId === userId);
    const totalLeads = userLeads.length;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(startOfDay.getTime() - 86400000);
    const newLeads = userLeads.filter(l => l.status === 'new').length;
    const activeLeads = userLeads.filter(l => ['contacted', 'warm', 'hot', 'engaged'].includes(l.status || '')).length;
    const convertedLeads = userLeads.filter(l => l.status === 'converted').length;
    const userMessages = Array.from(this.messages.values()).filter(m => m.userId === userId);
    const totalMessages = userMessages.length;
    const messagesToday = userMessages.filter(m => m.createdAt >= startOfDay).length;
    const messagesYesterday = userMessages.filter(m => m.createdAt >= yesterday && m.createdAt < startOfDay).length;
    const conversionRate = totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0;

    return {
      totalLeads,
      newLeads,
      activeLeads,
      convertedLeads,
      hardenedLeads: 0,
      bouncyLeads: 0,
      recoveredLeads: 0,
      positiveIntents: 0,
      totalMessages,
      messagesToday,
      messagesYesterday,
      aiReplies: 0,
      pipelineValue: 0,
      closedRevenue: 0,
      openRate: 0,
      responseRate: 0,
      averageResponseTime: '0m',
      queuedLeads: 0,
      undeliveredLeads: 0,
      conversionRate,
      intentRate: 0,
      outreachVelocity: 0,
      timeSaved: 0,
      globalBounceRate: 0
    };
  }

  async createIntegration(integration: any): Promise<Integration> {
    const id = randomUUID();
    const i: Integration = { ...integration, id, createdAt: new Date() } as any;
    this.integrations.set(id, i);
    return i;
  }
  async getIntegration(userId: string, provider: string): Promise<Integration | undefined> {
    return Array.from(this.integrations.values()).find(i => i.userId === userId && i.provider === provider);
  }
  async getIntegrationById(id: string): Promise<Integration | undefined> {
    return this.integrations.get(id);
  }
  async getIntegrations(userId: string): Promise<Integration[]> {
    return Array.from(this.integrations.values()).filter(i => i.userId === userId);
  }
  async getIntegrationsByProvider(provider: string): Promise<Integration[]> {
    return Array.from(this.integrations.values()).filter(i => i.provider === provider);
  }
  async getOAuthAccountsByProvider(provider: string): Promise<OAuthAccount[]> {
    const oauthProvider = provider === 'gmail' ? 'google' : provider;
    return Array.from(this.oauthAccounts.values()).filter(a => a.provider === oauthProvider);
  }
  async updateIntegration(userId: string, provider: string, updates: Partial<Integration>): Promise<Integration | undefined> {
    const i = await this.getIntegration(userId, provider);
    if (!i) return undefined;
    const updated = { ...i, ...updates } as Integration;
    this.integrations.set(i.id, updated);
    return updated;
  }
  async updateIntegrationById(id: string, updates: Partial<Integration>): Promise<Integration | undefined> {
    const i = this.integrations.get(id);
    if (!i) return undefined;
    const updated = { ...i, ...updates } as Integration;
    this.integrations.set(id, updated);
    return updated;
  }
  async disconnectIntegration(userId: string, provider: string): Promise<void> {
    await this.updateIntegration(userId, provider, { connected: false });
  }
  async deleteIntegration(userId: string, provider: string): Promise<void> {
    const i = await this.getIntegration(userId, provider);
    if (i) this.integrations.delete(i.id);
  }
  async deleteIntegrationById(id: string): Promise<void> {
    this.integrations.delete(id);
  }

  async isCommentProcessed(commentId: string): Promise<boolean> {
    return this.processedComments.has(commentId);
  }
  async markCommentProcessed(commentId: string, status: string, intentType: string): Promise<void> {
    this.processedComments.add(commentId);
  }
  async getBrandKnowledge(userId: string): Promise<string> {
    return this.brandKnowledge.get(userId) || '';
  }

  async getVideoMonitors(userId: string): Promise<any[]> {
    return Array.from(this.videoMonitors.values()).filter(v => v.userId === userId);
  }
  async createVideoMonitor(data: any): Promise<any> {
    const id = randomUUID();
    const v = { ...data, id, createdAt: new Date() };
    this.videoMonitors.set(id, v);
    return v;
  }
  async updateVideoMonitor(id: string, userId: string, updates: any): Promise<any> {
    const v = this.videoMonitors.get(id);
    if (v && v.userId === userId) {
      const u = { ...v, ...updates };
      this.videoMonitors.set(id, u);
      return u;
    }
    return undefined;
  }
  async deleteVideoMonitor(id: string, userId: string): Promise<void> {
    const m = this.videoMonitors.get(id);
    if (m && m.userId === userId) this.videoMonitors.delete(id);
  }

  async createDeal(data: any): Promise<any> {
    const id = randomUUID();
    const deal = { ...data, id, createdAt: new Date() };
    this.deals.set(id, deal);
    return deal;
  }
  async updateDeal(id: string, userId: string, updates: any): Promise<any> {
    const d = this.deals.get(id);
    if (!d || d.userId !== userId) return null;
    const updated = { ...d, ...updates, updatedAt: new Date() };
    this.deals.set(id, updated);
    return updated;
  }

  async getLeadInsight(leadId: string): Promise<LeadInsight | undefined> {
    return Array.from(this.leadInsightsStore.values()).find(i => i.leadId === leadId);
  }
  async upsertLeadInsight(i: any): Promise<LeadInsight> {
    const existing = await this.getLeadInsight(i.leadId);
    const id = existing ? existing.id : randomUUID();
    const insight: LeadInsight = { ...i, id, createdAt: existing ? existing.createdAt : new Date() } as any;
    this.leadInsightsStore.set(id, insight);
    return insight;
  }

  async getOrCreateThread(userId: string, leadId: string, subject: string, providerThreadId?: string): Promise<Thread> {
    const existing = Array.from(this.threads.values()).find(t => t.userId === userId && t.leadId === leadId);
    if (existing) return existing;
    const id = randomUUID();
    const t: Thread = { id, userId, leadId, subject, lastMessageAt: new Date(), metadata: providerThreadId ? { providerThreadId } : {}, createdAt: new Date() } as any;
    this.threads.set(id, t);
    return t;
  }
  async getThreadsByLeadId(leadId: string): Promise<Thread[]> {
    return Array.from(this.threads.values()).filter(t => t.leadId === leadId);
  }
  async updateThread(id: string, updates: Partial<Thread>): Promise<Thread | undefined> {
    const t = this.threads.get(id);
    if (!t) return undefined;
    const updated = { ...t, ...updates } as Thread;
    this.threads.set(id, updated);
    return updated;
  }

  // Analytics
  async getAnalyticsSummary(userId: string, startDate: Date, integrationId?: string): Promise<{
    summary: {
      totalLeads: number;
      conversions: number;
      conversionRate: string;
      active: number;
      ghosted: number;
      notInterested: number;
      leadsReplied: number;
      bestReplyHour: number | null;
    };
    channelBreakdown: Array<{ channel: string; count: number; percentage: number }>;
    statusBreakdown: Array<{ status: string; count: number; percentage: number }>;
    timeline: Array<{ date: string; leads: number; conversions: number }>;
    positiveSentimentRate: string;
  }> {
    return {
      summary: { totalLeads: 0, conversions: 0, conversionRate: "0%", active: 0, ghosted: 0, notInterested: 0, leadsReplied: 0, bestReplyHour: null },
      channelBreakdown: [], statusBreakdown: [], timeline: [], positiveSentimentRate: "0%"
    };
  }

  async getAnalyticsFull(userId: string, days: number, integrationId?: string): Promise<{
    metrics: {
      sent: number;
      opened: number;
      replied: number;
      booked: number;
      leadsFiltered: number;
      conversionRate: number;
      responseRate: number;
      openRate: number;
      closedRevenue: number;
      pipelineValue: number;
      averageResponseTime: string;
    };
    timeSeries: Array<{
      name: string;
      sent_email: number;
      sent_instagram: number;
      opened: number;
      replied_email: number;
      replied_instagram: number;
      booked: number;
    }>;
    channelPerformance: Array<{ channel: string; value: number }>;
    recentEvents: Array<{ id: string; type: string; description: string; time: string; isNew: boolean }>;
  }> {
    return { metrics: { sent: 0, opened: 0, replied: 0, booked: 0, leadsFiltered: 0, conversionRate: 0, responseRate: 0, openRate: 0, closedRevenue: 0, pipelineValue: 0, averageResponseTime: "0" }, timeSeries: [], channelPerformance: [], recentEvents: [] };
  }

  // Notifications
  async getNotifications(userId: string, opts?: any): Promise<Notification[]> {
    return Array.from(this.notifications.values()).filter(n => n.userId === userId);
  }
  async getUnreadNotificationCount(userId: string): Promise<number> {
    return Array.from(this.notifications.values()).filter(n => n.userId === userId && !n.isRead).length;
  }
  async createNotification(data: InsertNotification): Promise<Notification> {
    const id = randomUUID();
    const n = { ...data, id, isRead: false, createdAt: new Date() } as any;
    this.notifications.set(id, n);
    return n;
  }
  async markNotificationAsRead(id: string, userId?: string): Promise<Notification | undefined> {
    const n = this.notifications.get(id);
    if (!n) return undefined;
    n.isRead = true;
    return n;
  }
  async markNotificationRead(id: string, userId?: string): Promise<Notification | undefined> {
    return this.markNotificationAsRead(id, userId);
  }
  async markAllNotificationsAsRead(userId: string): Promise<void> {
    for (const n of this.notifications.values()) {
      if (n.userId === userId) n.isRead = true;
    }
  }
  async clearAllNotifications(userId: string): Promise<void> {
    for (const [id, n] of this.notifications.entries()) {
      if (n.userId === userId) this.notifications.delete(id);
    }
  }
  async deleteNotification(id: string, userId: string): Promise<void> {
    this.notifications.delete(id);
  }



  async getRecentBounces(userId: string, hours?: number): Promise<any[]> { return []; }
  async getDomainVerifications(userId: string, limit?: number): Promise<any[]> { return []; }
  async createDomainVerification(userId: string, data: any): Promise<any> { return data; }
  async getVoiceMinutesBalance(userId: string): Promise<number> { return 0; }

  // --- Outreach Campaign Methods ---
  async getOutreachCampaign(id: string): Promise<OutreachCampaign | undefined> {
    return this.outreachCampaigns.get(id);
  }
  async createOutreachCampaign(campaign: InsertOutreachCampaign): Promise<OutreachCampaign> {
    const id = randomUUID();
    const newCampaign: OutreachCampaign = {
      ...campaign,
      id,
      stats: campaign.stats || { total: 0, sent: 0, replied: 0, bounced: 0 },
      config: campaign.config || { dailyLimit: 50, minDelayMinutes: 2 },
      metadata: campaign.metadata || {},
      status: campaign.status || "draft",
      excludeWeekends: campaign.excludeWeekends || false,
      replyEmail: campaign.replyEmail || null,
      aiAutonomousMode: campaign.aiAutonomousMode || false,
      createdAt: new Date(),
      updatedAt: new Date()
    } as OutreachCampaign;
    this.outreachCampaigns.set(id, newCampaign);
    return newCampaign;
  }
  async updateOutreachCampaign(id: string, updates: Partial<OutreachCampaign>): Promise<OutreachCampaign | undefined> {
    const campaign = this.outreachCampaigns.get(id);
    if (!campaign) return undefined;
    const updated = { ...campaign, ...updates, updatedAt: new Date() };
    this.outreachCampaigns.set(id, updated);
    return updated;
  }
  async addLeadsToCampaign(campaignId: string, leads: { leadId: string }[]): Promise<void> {
    for (const l of leads) {
      const id = randomUUID();
      const campaignLead: CampaignLead = {
        id,
        campaignId,
        leadId: l.leadId,
        status: 'pending',
        currentStep: 0,
        nextActionAt: null,
        sentAt: null,
        error: null,
        retryCount: 0,
        integrationId: null,
        metadata: {},
        proceduralMemory: {},
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.campaignLeads.set(id, campaignLead);
    }
  }
  async getCampaignLead(campaignId: string, leadId: string): Promise<CampaignLead | undefined> {
    return Array.from(this.campaignLeads.values()).find(cl => cl.campaignId === campaignId && cl.leadId === leadId);
  }
  async updateCampaignLeadStatus(campaignId: string, leadId: string, status: CampaignLead["status"], error?: string): Promise<void> {
    const cl = Array.from(this.campaignLeads.values()).find(cl => cl.campaignId === campaignId && cl.leadId === leadId);
    if (cl) {
      const updated = { ...cl, status, error: error || null, updatedAt: new Date() };
      this.campaignLeads.set(cl.id, updated);
    }
  }
  async scheduleNextCampaignStep(campaignLeadId: string, nextActionAt: Date): Promise<void> {
    const cl = this.campaignLeads.get(campaignLeadId);
    if (cl) {
      const updated = { ...cl, nextActionAt, updatedAt: new Date() };
      this.campaignLeads.set(campaignLeadId, updated);
    }
  }


  // --- Pending Payment methods ---
  async getPendingPayments(userId: string): Promise<(PendingPayment & { lead: Lead | null })[]> {
    return Array.from(this.pendingPaymentsStore.values())
      .filter(p => p.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(p => ({ ...p, lead: null })); // MemStorage has no join capability — lead is null
  }

  async getPendingPayment(id: string): Promise<PendingPayment | undefined> {
    return this.pendingPaymentsStore.get(id);
  }

  async createPendingPayment(data: InsertPendingPayment): Promise<PendingPayment> {
    const id = randomUUID();
    const payment: PendingPayment = {
      ...data,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as PendingPayment;
    this.pendingPaymentsStore.set(id, payment);
    return payment;
  }

  async updatePendingPayment(id: string, updates: Partial<PendingPayment>): Promise<PendingPayment | undefined> {
    const payment = this.pendingPaymentsStore.get(id);
    if (!payment) return undefined;
    const updated = { ...payment, ...updates, updatedAt: new Date() };
    this.pendingPaymentsStore.set(id, updated);
    return updated;
  }

  // --- Missing methods for IStorage compliance ---
  async getUsersNeedingWeeklyInsights(): Promise<User[]> {
    return Array.from(this.users.values()).filter((u: User) => {
      const lastInsight = u.lastInsightGeneratedAt || u.createdAt;
      const days = Math.floor((Date.now() - new Date(lastInsight).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 7;
    });
  }

  async getUsersWithActiveVideoMonitors(): Promise<User[]> {
    return []; // MemStorage doesn't support complex joins currently
  }

  async getPaymentStats(): Promise<Record<string, number>> {
    return { starter: 0, pro: 0, enterprise: 0, pending_approvals: 0 };
  }

  async getPendingLegacyPayments(): Promise<any[]> {
    return [];
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u: User) => u.stripeCustomerId === customerId);
  }

  async getUserByOutlookSubscriptionId(subscriptionId: string): Promise<User | undefined> {
    return undefined;
  }

  async getOAuthAccountByProviderAccountId(provider: string, providerAccountId: string): Promise<OAuthAccount | undefined> {
    return Array.from(this.oauthAccounts.values()).find(acc => acc.provider === provider && acc.providerAccountId === providerAccountId);
  }

  // Procedural Memory methods
  async updateCampaignLeadProceduralMemory(campaignId: string, leadId: string, memory: Record<string, any>): Promise<void> {
    const key = `${campaignId}:${leadId}`;
    const lead = this.campaignLeads.get(key);
    if (lead) {
      this.campaignLeads.set(key, { ...lead, proceduralMemory: memory });
    }
  }

  async getCampaignLeadProceduralMemory(campaignId: string, leadId: string): Promise<Record<string, any> | undefined> {
    const key = `${campaignId}:${leadId}`;
    const lead = this.campaignLeads.get(key);
    return lead?.proceduralMemory as Record<string, any> || undefined;
  }

  async updateCampaignProceduralMemory(campaignId: string, memory: Record<string, any>): Promise<void> {
    const campaign = this.outreachCampaigns.get(campaignId);
    if (campaign) {
      this.outreachCampaigns.set(campaignId, { ...campaign, proceduralMemory: memory });
    }
  }
}

export const storage: IStorage = drizzleStorage;


console.log("✓ Using DrizzleStorage with PostgreSQL (persistent storage enabled)");

