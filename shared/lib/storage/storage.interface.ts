import { drizzleStorage } from "./drizzle-storage.js";
import { type User, type InsertUser, type Lead, type InsertLead, type Message, type InsertMessage, type Integration, type InsertIntegration, type Deal, type InsertDeal, type FollowUpQueue, type InsertFollowUpQueue, type OAuthAccount, type InsertOAuthAccount, type CalendarEvent, type InsertCalendarEvent, type AuditTrail, type InsertAuditTrail, type Organization, type InsertOrganization, type TeamMember, type InsertTeamMember, type Payment, type InsertPayment, type AiLearningPattern, type InsertAiLearningPattern, type SmtpSettings, type InsertSmtpSettings, type EmailMessage, type InsertEmailMessage, type Notification, type InsertNotification, type Thread, type InsertThread, type LeadInsight, type InsertLeadInsight, type OutreachCampaign, type InsertOutreachCampaign, type CampaignLead, smtpSettings, users, leads, messages, integrations, deals, followUpQueue, aiLearningPatterns, notifications, threads, leadInsights, outreachCampaigns, campaignLeads } from "@audnix/shared";
import { randomUUID } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { db } from '@shared/lib/db/db.js';

export type MessageDraft = Partial<InsertMessage> & { leadId: string; userId: string; body: string };

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBySupabaseId(supabaseId: string): Promise<User | undefined>;
  toggleAi(leadId: string, paused: boolean): Promise<void>;
  createUser(user: Partial<InsertUser> & { email: string }): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsers(): Promise<User[]>; // Alias for getAllUsers
  getUserCount(): Promise<number>;

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
  getLead(id: string): Promise<Lead | undefined>;
  getLeadById(id: string): Promise<Lead | undefined>;
  getLeadByEmail(email: string, userId: string): Promise<Lead | undefined>;
  getExistingEmails(userId: string, emails: string[]): Promise<string[]>;
  getLeadsCount(userId: string): Promise<number>;
  getLeadBySocialId(socialId: string, channel: string): Promise<Lead | undefined>;
  createLead(lead: Partial<InsertLead> & { userId: string; name: string; channel: string }, options?: { suppressNotification?: boolean }): Promise<Lead>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined>;
  reserveLeadForAction(leadId: string, workerName: string, durationMs?: number): Promise<boolean>;
  archiveLead(id: string, userId: string, archived: boolean): Promise<Lead | undefined>;
  deleteLead(id: string, userId: string): Promise<void>;
  archiveMultipleLeads(ids: string[], userId: string, archived: boolean): Promise<void>;
  deleteMultipleLeads(ids: string[], userId: string): Promise<void>;
  findLeadBySenderAndIntegration(email: string, integrationId: string): Promise<Lead | undefined>;
  markLeadReplied(leadId: string): Promise<Lead | undefined>;
  getTotalLeadsCount(): Promise<number>;
  createAuditLog(data: InsertAuditTrail): Promise<AuditTrail>;
  getAuditLogs(userId: string, options?: { integrationId?: string, daysFilter?: number, limit?: number }): Promise<AuditTrail[]>;

  // Message methods
  getMessagesByLeadId(leadId: string): Promise<Message[]>;
  getMessages(leadId: string): Promise<Message[]>; // Alias for getMessagesByLeadId
  getAllMessages(userId: string, options?: { limit?: number; channel?: string; integrationId?: string }): Promise<Message[]>;
  createMessage(message: Partial<InsertMessage> & { leadId: string; userId: string; direction: "inbound" | "outbound"; body: string; threadId?: string }): Promise<Message>;
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

  // AI Learning Patterns
  getLearningPatterns(userId: string): Promise<AiLearningPattern[]>;
  recordLearningPattern(userId: string, key: string, success: boolean): Promise<void>;

  // OAuth Accounts
  getOAuthAccount(userId: string, provider: string, providerAccountId?: string): Promise<OAuthAccount | undefined>;
  getOAuthAccountByAccountId(userId: string, provider: string, accountId: string): Promise<OAuthAccount | undefined>;
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
  markNotificationRead(id: string, userId?: string): Promise<Notification | undefined>;
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
  getCampaignById(id: string): Promise<OutreachCampaign | undefined>; // Alias
  createOutreachCampaign(campaign: InsertOutreachCampaign): Promise<OutreachCampaign>;
  updateOutreachCampaign(id: string, updates: Partial<OutreachCampaign>): Promise<OutreachCampaign | undefined>;
  getCampaignLead(campaignId: string, leadId: string): Promise<CampaignLead | undefined>;
  updateCampaignLeadProceduralMemory(campaignId: string, leadId: string, memory: Record<string, any>): Promise<void>;
  getCampaignLeadProceduralMemory(campaignId: string, leadId: string): Promise<Record<string, any> | undefined>;
  updateCampaignProceduralMemory(campaignId: string, memory: Record<string, any>): Promise<void>;
}
