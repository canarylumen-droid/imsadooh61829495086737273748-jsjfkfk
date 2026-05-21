import { type User, type InsertUser, type Lead, type InsertLead, type Message, type InsertMessage, type Integration, type InsertIntegration, type FollowUpQueue, type InsertFollowUpQueue, type OAuthAccount, type InsertOAuthAccount, type CalendarEvent, type InsertCalendarEvent, type AuditTrail, type InsertAuditTrail, type Organization, type InsertOrganization, type TeamMember, type InsertTeamMember, type Payment, type InsertPayment, type AiLearningPattern, type InsertAiLearningPattern } from "../shared/schema.js";
import { randomUUID } from "crypto";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBySupabaseId(supabaseId: string): Promise<User | undefined>;
  createUser(user: Partial<InsertUser> & { email: string }): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
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
  getLeads(options: { userId: string; status?: string; channel?: string; search?: string; limit?: number }): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  getLeadById(id: string): Promise<Lead | undefined>;
  getLeadByUsername(username: string, channel: string): Promise<Lead | undefined>;
  createLead(lead: Partial<InsertLead> & { userId: string; name: string; channel: string }): Promise<Lead>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined>;
  getTotalLeadsCount(): Promise<number>;

  // Message methods
  getMessagesByLeadId(leadId: string): Promise<Message[]>;
  getMessages(leadId: string): Promise<Message[]>; // Alias for getMessagesByLeadId
  getAllMessages(userId: string, options?: { limit?: number; channel?: string }): Promise<Message[]>;
  createMessage(message: Partial<InsertMessage> & { leadId: string; userId: string; direction: "inbound" | "outbound"; body: string }): Promise<Message>;

  // Integration methods
  getIntegrations(userId: string): Promise<Integration[]>;
  getIntegration(userId: string, provider: string): Promise<Integration | undefined>;
  getIntegrationsByProvider(provider: string): Promise<Integration[]>;
  createIntegration(integration: Partial<InsertIntegration> & { userId: string; provider: string; encryptedMeta: string }): Promise<Integration>;
  updateIntegration(userId: string, provider: string, updates: Partial<Integration>): Promise<Integration | undefined>;
  disconnectIntegration(userId: string, provider: string): Promise<void>;
  deleteIntegration(userId: string, provider: string): Promise<void>;

  // Notification methods
  getNotifications(userId: string): Promise<any[]>;
  markNotificationAsRead(notificationId: string, userId: string): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  createNotification(data: any): Promise<any>;
  markNotificationRead(id: string): Promise<void>;

  // Video monitor methods
  getVideoMonitors(userId: string): Promise<any[]>;
  createVideoMonitor(data: any): Promise<any>;
  updateVideoMonitor(id: string, userId: string, updates: any): Promise<any>;
  deleteVideoMonitor(id: string, userId: string): Promise<void>;
  isCommentProcessed(commentId: string): Promise<boolean>;
  markCommentProcessed(commentId: string, status: string, intentType: string): Promise<void>;
  getBrandKnowledge(userId: string): Promise<string>;

  // Deal tracking methods
  getDeals(userId: string): Promise<any[]>;
  createDeal(data: any): Promise<any>;
  updateDeal(id: string, userId: string, updates: any): Promise<any>;
  calculateRevenue(userId: string): Promise<{ total: number; thisMonth: number; deals: any[] }>;

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
  getOAuthAccount(userId: string, provider: string): Promise<OAuthAccount | undefined>;
  getSoonExpiringOAuthAccounts(provider: string, thresholdMinutes: number): Promise<OAuthAccount[]>;
  saveOAuthAccount(data: InsertOAuthAccount): Promise<OAuthAccount>;
  deleteOAuthAccount(userId: string, provider: string): Promise<void>;

  // Reputation & Delivery
  getRecentBounces(userId: string, hours?: number): Promise<any[]>;
  getDomainVerifications(userId: string, limit?: number): Promise<any[]>;

  // Calendar Events
  createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent>;

  // Audit Trail (Recent Activities)
  createAuditLog(data: InsertAuditTrail): Promise<AuditTrail>;

  // Voice Balance
  getVoiceMinutesBalance(userId: string): Promise<number>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private leads: Map<string, Lead>;
  private messages: Map<string, Message>;
  private integrations: Map<string, Integration>;
  private organizations: Map<string, Organization>;
  private teamMembers: Map<string, TeamMember>;
  private payments: Map<string, Payment>;

  private followUps: Map<string, FollowUpQueue>;
  private learningPatterns: Map<string, AiLearningPattern>;

  constructor() {
    this.users = new Map();
    this.leads = new Map();
    this.messages = new Map();
    this.integrations = new Map();
    this.organizations = new Map();
    this.teamMembers = new Map();
    this.payments = new Map();
    this.followUps = new Map();
    this.learningPatterns = new Map();
  }

  async getVoiceMinutesBalance(userId: string): Promise<number> {
    const user = this.users.get(userId);
    return (Number(user?.voiceMinutesUsed) || 0) + (Number(user?.voiceMinutesTopup) || 0);
  }

  // --- Organization Methods ---
  async getOrganization(id: string): Promise<Organization | undefined> {
    return this.organizations.get(id);
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    return Array.from(this.organizations.values()).find(o => o.slug === slug);
  }

  async getOrganizationsByOwner(ownerId: string): Promise<Organization[]> {
    return Array.from(this.organizations.values()).filter(o => o.ownerId === ownerId);
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const id = randomUUID();
    const newOrg: Organization = {
      ...org,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      slug: org.slug ?? null,
      stripeCustomerId: org.stripeCustomerId ?? null,
      subscriptionId: org.subscriptionId ?? null,
      plan: org.plan ?? "trial",
      metadata: org.metadata ?? {}
    };
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
    const newMember: TeamMember = {
      ...member,
      id,
      invitedAt: new Date(),
      acceptedAt: null,
      invitedBy: member.invitedBy ?? null,
      role: member.role ?? "member"
    };
    this.teamMembers.set(id, newMember);
    return newMember;
  }

  async removeTeamMember(orgId: string, userId: string): Promise<void> {
    const member = Array.from(this.teamMembers.values()).find(m => m.organizationId === orgId && m.userId === userId);
    if (member) this.teamMembers.delete(member.id);
  }

  async getFollowUpById(id: string): Promise<FollowUpQueue | undefined> {
    return Array.from(this.followUps.values()).find(f => f.id === id);
  }
  async updateFollowUp(id: string, updates: Partial<FollowUpQueue>): Promise<FollowUpQueue | undefined> {
    const followUp = this.followUps.get(id);
    if (!followUp) return undefined;
    const updated = { ...followUp, ...updates, updatedAt: new Date() };
    this.followUps.set(id, updated);
    return updated;
  }
  async getDueFollowUps(): Promise<FollowUpQueue[]> {
    const now = new Date();
    return Array.from(this.followUps.values())
      .filter(f => f.status === 'pending' && f.scheduledAt <= now)
      .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
  }
  async getLearningPatterns(userId: string): Promise<AiLearningPattern[]> {
    return Array.from(this.learningPatterns.values()).filter(p => p.userId === userId);
  }
  async recordLearningPattern(userId: string, key: string, success: boolean): Promise<void> {
    const id = randomUUID();
    const existing = Array.from(this.learningPatterns.values()).find(p => p.userId === userId && p.patternKey === key);
    if (existing) {
      existing.strength = success ? existing.strength + 1 : Math.max(0, existing.strength - 1);
      existing.lastUsedAt = new Date();
    } else {
      const now = new Date();
      this.learningPatterns.set(id, {
        id,
        userId,
        patternKey: key,
        strength: success ? 1 : 0,
        metadata: {},
        lastUsedAt: now,
        createdAt: now
      });
    }
  }
  async createPayment(data: InsertPayment): Promise<Payment> {
    const id = randomUUID();
    const payment: Payment = {
      ...data,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      stripePaymentId: data.stripePaymentId ?? null,
      plan: data.plan ?? null,
      paymentLink: data.paymentLink ?? null,
      status: (data as any).status || "pending",
      currency: (data as any).currency || "USD",
      webhookPayload: (data as any).webhookPayload || {}
    };
    this.payments.set(id, payment);
    return payment;
  }

  async getPayments(userId: string): Promise<Payment[]> {
    return Array.from(this.payments.values()).filter(p => p.userId === userId);
  }

  async getPaymentById(id: string): Promise<Payment | undefined> {
    return this.payments.get(id);
  }

  async updatePayment(id: string, updates: Partial<Payment>): Promise<Payment | undefined> {
    const payment = this.payments.get(id);
    if (!payment) return undefined;
    const updated = { ...payment, ...updates, updatedAt: new Date() };
    this.payments.set(id, updated);
    return updated;
  }


  // ========== User Methods ==========

  async getPendingFollowUp(leadId: string): Promise<FollowUpQueue | undefined> {
    return Array.from(this.followUps.values()).find(f => f.leadId === leadId && f.status === 'pending');
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserBySupabaseId(supabaseId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.supabaseId === supabaseId,
    );
  }

  async createUser(insertUser: Partial<InsertUser> & { email: string }): Promise<User> {
    const id = randomUUID();
    const now = new Date();

    // Calculate trial expiry (3 days from now)
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 3);

    const user: User = {
      id,
      supabaseId: insertUser.supabaseId || null,
      email: insertUser.email,
      password: insertUser.password || null,
      name: insertUser.name || null,
      username: insertUser.username || null,
      avatar: insertUser.avatar || null,
      company: insertUser.company || null,
      timezone: insertUser.timezone || "America/New_York",
      plan: insertUser.plan || "trial",
      subscriptionTier: insertUser.subscriptionTier || "free",
      trialExpiresAt: insertUser.trialExpiresAt || trialExpiry,
      replyTone: insertUser.replyTone || "professional",
      role: insertUser.role || "member",
      stripeCustomerId: insertUser.stripeCustomerId || null,
      stripeSubscriptionId: insertUser.stripeSubscriptionId || null,
      voiceCloneId: insertUser.voiceCloneId || null,
      voiceMinutesUsed: insertUser.voiceMinutesUsed || 0,
      voiceMinutesTopup: insertUser.voiceMinutesTopup || 0,
      businessName: insertUser.businessName || null,
      voiceRules: insertUser.voiceRules || null,
      pdfConfidenceThreshold: insertUser.pdfConfidenceThreshold || 0.7,
      lastInsightGeneratedAt: insertUser.lastInsightGeneratedAt || null,
      lastProspectScanAt: insertUser.lastProspectScanAt || null,
      paymentStatus: insertUser.paymentStatus || "none",
      pendingPaymentPlan: insertUser.pendingPaymentPlan || null,
      pendingPaymentAmount: insertUser.pendingPaymentAmount || null,
      pendingPaymentDate: insertUser.pendingPaymentDate || null,
      paymentApprovedAt: insertUser.paymentApprovedAt || null,
      stripeSessionId: insertUser.stripeSessionId || null,
      subscriptionId: insertUser.subscriptionId || null,
      metadata: insertUser.metadata || {},
      createdAt: now,
      lastLogin: now,
      updatedAt: now,
      calendarLink: insertUser.calendarLink || null,
      brandGuidelinePdfUrl: insertUser.brandGuidelinePdfUrl || null,
      brandGuidelinePdfText: insertUser.brandGuidelinePdfText || null,
      filteredLeadsCount: insertUser.filteredLeadsCount || 0,
    };

    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;

    const updatedUser = {
      ...user,
      ...updates,
      calendarLink: updates.calendarLink !== undefined ? updates.calendarLink : user.calendarLink,
      brandGuidelinePdfUrl: updates.brandGuidelinePdfUrl !== undefined ? updates.brandGuidelinePdfUrl : user.brandGuidelinePdfUrl,
      brandGuidelinePdfText: updates.brandGuidelinePdfText !== undefined ? updates.brandGuidelinePdfText : user.brandGuidelinePdfText,
      metadata: updates.metadata ? { ...user.metadata, ...updates.metadata } : user.metadata
    };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUserCount(): Promise<number> {
    return this.users.size;
  }

  // ========== Lead Methods ==========

  async getLeads(options: { userId: string; status?: string; channel?: string; search?: string; limit?: number }): Promise<Lead[]> {
    let leads = Array.from(this.leads.values()).filter(
      (lead) => lead.userId === options.userId
    );

    if (options.status) {
      leads = leads.filter((lead) => lead.status === options.status);
    }

    if (options.channel) {
      leads = leads.filter((lead) => lead.channel === options.channel);
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      leads = leads.filter((lead) =>
        lead.name.toLowerCase().includes(searchLower) ||
        lead.email?.toLowerCase().includes(searchLower) ||
        lead.phone?.includes(searchLower)
      );
    }

    leads = leads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (options.limit) {
      leads = leads.slice(0, options.limit);
    }

    return leads;
  }

  async getLead(id: string): Promise<Lead | undefined> {
    return this.leads.get(id);
  }

  async getLeadById(id: string): Promise<Lead | undefined> {
    return this.getLead(id);
  }

  async getLeadByUsername(username: string, channel: string): Promise<Lead | undefined> {
    const leads = await this.getLeads({ userId: '', limit: 1000 });
    return leads.find(lead =>
      lead.name.toLowerCase() === username.toLowerCase() &&
      lead.channel === channel
    );
  }


  async createLead(insertLead: Partial<InsertLead> & { userId: string; name: string; channel: string }): Promise<Lead> {
    const id = randomUUID();
    const now = new Date();

    const lead: Lead = {
      id,
      userId: insertLead.userId,
      organizationId: insertLead.organizationId || null,
      externalId: insertLead.externalId || null,
      name: insertLead.name,
      company: insertLead.company || null,
      role: insertLead.role || null,
      bio: insertLead.bio || null,
      channel: insertLead.channel as "instagram" | "email",
      email: insertLead.email || null,
      phone: insertLead.phone || null,
      status: (insertLead.status as any) || "new",
      score: insertLead.score || 0,
      warm: insertLead.warm || false,
      lastMessageAt: insertLead.lastMessageAt || null,
      aiPaused: insertLead.aiPaused || false,
      verified: insertLead.verified || false,
      verifiedAt: insertLead.verifiedAt || null,
      pdfConfidence: insertLead.pdfConfidence || null,
      tags: insertLead.tags || [],
      metadata: insertLead.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    this.leads.set(id, lead);
    return lead;
  }

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined> {
    const lead = this.leads.get(id);
    if (!lead) return undefined;

    const updatedLead = { ...lead, ...updates, updatedAt: new Date() };
    this.leads.set(id, updatedLead);
    return updatedLead;
  }

  async getTotalLeadsCount(): Promise<number> {
    return this.leads.size;
  }

  // ========== Message Methods ==========

  async getMessagesByLeadId(leadId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter((msg) => msg.leadId === leadId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getMessages(leadId: string): Promise<Message[]> {
    return this.getMessagesByLeadId(leadId);
  }

  async getAllMessages(userId: string, options?: { limit?: number; channel?: string }): Promise<Message[]> {
    let msgs = Array.from(this.messages.values())
      .filter((msg) => msg.userId === userId);

    if (options?.channel) {
      msgs = msgs.filter((msg) => msg.provider === options.channel);
    }

    msgs = msgs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (options?.limit) {
      msgs = msgs.slice(0, options.limit);
    }

    return msgs;
  }

  async createMessage(message: Partial<InsertMessage> & { leadId: string; userId: string; direction: "inbound" | "outbound"; body: string }): Promise<Message> {
    const id = randomUUID();
    const now = new Date();

    const newMessage: Message = {
      id,
      leadId: message.leadId,
      userId: message.userId,
      provider: message.provider || "instagram",
      direction: message.direction,
      body: message.body,
      audioUrl: message.audioUrl || null,
      trackingId: message.trackingId || null,
      openedAt: message.openedAt || null,
      clickedAt: message.clickedAt || null,
      repliedAt: message.repliedAt || null,
      metadata: message.metadata || {},
      createdAt: now,
    };

    this.messages.set(id, newMessage);
    return newMessage;
  }

  // ========== Integration Methods ==========

  async getIntegrations(userId: string): Promise<Integration[]> {
    return Array.from(this.integrations.values()).filter(
      (integration) => integration.userId === userId
    );
  }

  async getIntegration(userId: string, provider: string): Promise<Integration | undefined> {
    return Array.from(this.integrations.values()).find(
      (integration) => integration.userId === userId && integration.provider === provider
    );
  }

  async getIntegrationsByProvider(provider: string): Promise<Integration[]> {
    return Array.from(this.integrations.values()).filter(
      (integration) => integration.provider === provider
    );
  }

  async createIntegration(integration: Partial<InsertIntegration> & { userId: string; provider: string; encryptedMeta: string }): Promise<Integration> {
    const id = randomUUID();
    const now = new Date();

    const newIntegration: Integration = {
      id,
      userId: integration.userId,
      provider: integration.provider as any,
      encryptedMeta: integration.encryptedMeta,
      connected: integration.connected ?? true,
      accountType: integration.accountType || null,
      lastSync: integration.lastSync || null,
      createdAt: now,
    };

    this.integrations.set(id, newIntegration);
    return newIntegration;
  }

  async updateIntegration(userId: string, provider: string, updates: Partial<Integration>): Promise<Integration | undefined> {
    const integration = Array.from(this.integrations.values()).find(
      (i) => i.userId === userId && i.provider === provider
    );

    if (!integration) return undefined;

    const updated = { ...integration, ...updates };
    this.integrations.set(integration.id, updated);
    return updated;
  }

  async disconnectIntegration(userId: string, provider: string): Promise<void> {
    const integration = Array.from(this.integrations.values()).find(
      (i) => i.userId === userId && i.provider === provider
    );

    if (integration) {
      this.integrations.delete(integration.id);
    }
  }

  async deleteIntegration(userId: string, provider: string): Promise<void> {
    return this.disconnectIntegration(userId, provider);
  }

  // ========== Notification Methods ==========

  private notifications: Map<string, any> = new Map();
  private readNotifications: Set<string> = new Set();

  async getNotifications(userId: string): Promise<any[]> {
    // Return notifications from leads for demo purposes
    const leads = await this.getLeads({ userId, limit: 10 });
    return leads.map((lead, index) => ({
      id: lead.id,
      type: lead.status === 'converted' ? 'conversion' : 'lead_reply',
      title: lead.status === 'converted' ? 'New conversion!' : 'New lead',
      message: `${lead.name} from ${lead.channel}${lead.status === 'converted' ? ' converted to a customer' : ''}`,
      timestamp: lead.createdAt,
      read: this.readNotifications.has(lead.id),
    }));
  }

  async markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
    this.readNotifications.add(notificationId);
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    const notifications = await this.getNotifications(userId);
    notifications.forEach(n => this.readNotifications.add(n.id));
  }

  async createNotification(data: any): Promise<any> {
    const id = randomUUID();
    const notification = { id, ...data, createdAt: new Date() };
    this.notifications.set(id, notification);
    return notification;
  }

  async markNotificationRead(id: string): Promise<void> {
    this.readNotifications.add(id);
  }

  // Video monitor methods
  private videoMonitors: Map<string, any> = new Map();
  private processedComments: Set<string> = new Set();
  private brandKnowledge: Map<string, string> = new Map();

  async getVideoMonitors(userId: string): Promise<any[]> {
    return Array.from(this.videoMonitors.values()).filter(m => m.userId === userId);
  }

  async createVideoMonitor(data: any): Promise<any> {
    const id = randomUUID();
    const monitor = { id, ...data, createdAt: new Date() };
    this.videoMonitors.set(id, monitor);
    return monitor;
  }

  async updateVideoMonitor(id: string, userId: string, updates: any): Promise<any> {
    const monitor = this.videoMonitors.get(id);
    if (!monitor || monitor.userId !== userId) return null;

    const updated = { ...monitor, ...updates };
    this.videoMonitors.set(id, updated);
    return updated;
  }

  async deleteVideoMonitor(id: string, userId: string): Promise<void> {
    const monitor = this.videoMonitors.get(id);
    if (monitor && monitor.userId === userId) {
      this.videoMonitors.delete(id);
    }
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

  // Deal tracking
  private deals: Map<string, any> = new Map();

  async getDeals(userId: string): Promise<any[]> {
    return Array.from(this.deals.values()).filter(d => d.userId === userId);
  }

  async createDeal(data: any): Promise<any> {
    const id = randomUUID();
    const deal = { id, ...data, createdAt: new Date() };
    this.deals.set(id, deal);
    return deal;
  }

  async updateDeal(id: string, userId: string, updates: any): Promise<any> {
    const deal = this.deals.get(id);
    if (!deal || deal.userId !== userId) return null;

    const updated = { ...deal, ...updates, updatedAt: new Date() };
    this.deals.set(id, updated);
    return updated;
  }

  async calculateRevenue(userId: string): Promise<{ total: number; thisMonth: number; deals: any[] }> {
    const deals = await this.getDeals(userId);
    const closedDeals = deals.filter(d => d.status === 'closed_won');

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const total = closedDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
    const thisMonth = closedDeals
      .filter(d => new Date(d.closedAt) >= thisMonthStart)
      .reduce((sum, d) => sum + (d.amount || 0), 0);

    return { total, thisMonth, deals: closedDeals };
  }

  // Usage tracking
  private usageHistory: Map<string, any[]> = new Map();

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

  // Onboarding methods
  private onboardingProfiles: Map<string, any> = new Map();

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
  private otpCodes: Map<string, any> = new Map();

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
      scheduledAt: data.scheduledAt instanceof Date ? data.scheduledAt : new Date(data.scheduledAt),
      status: data.status || "pending",
      processedAt: null,
      context: data.context || {},
      errorMessage: null,
      createdAt: new Date(),
    };
    this.followUps.set(id, followUp);
    return followUp;
  }


  // ========== OAuth Accounts ==========
  private oauthAccounts: Map<string, OAuthAccount> = new Map();

  async getOAuthAccount(userId: string, provider: string): Promise<OAuthAccount | undefined> {
    return Array.from(this.oauthAccounts.values()).find(
      (account) => account.userId === userId && account.provider === provider
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
    const existing = await this.getOAuthAccount(data.userId, data.provider);
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

  async deleteOAuthAccount(userId: string, provider: string): Promise<void> {
    const existing = await this.getOAuthAccount(userId, provider);
    if (existing) {
      this.oauthAccounts.delete(existing.id);
    }
  }

  // ========== Calendar Events ==========
  private calendarEvents: Map<string, CalendarEvent> = new Map();

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
      isAiBooked: data.isAiBooked || false,
      preCallNote: data.preCallNote || null,
      createdAt: new Date(),
    };
    this.calendarEvents.set(id, event);
    return event;
  }

  // ========== Audit Trail ==========
  private auditLogs: Map<string, AuditTrail> = new Map();

  async createAuditLog(data: InsertAuditTrail): Promise<AuditTrail> {
    const id = randomUUID();
    const log: AuditTrail = {
      id,
      userId: data.userId,
      leadId: data.leadId,
      action: data.action,
      messageId: data.messageId || null,
      details: data.details || {},
      createdAt: new Date(),
    };
    this.auditLogs.set(id, log);
    return log;
  }

  async getRecentBounces(userId: string, hours: number = 168): Promise<any[]> {
    return [];
  }

  async getDomainVerifications(userId: string, limit: number = 10): Promise<any[]> {
    return [];
  }
}

// Use DrizzleStorage with Replit PostgreSQL database
import { drizzleStorage } from './drizzle-storage.js';

export const storage: IStorage = drizzleStorage;

console.log("✓ Using DrizzleStorage with PostgreSQL (persistent storage enabled)");