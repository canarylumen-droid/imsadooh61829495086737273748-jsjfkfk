"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storage = exports.MemStorage = void 0;
const drizzle_storage_js_1 = require("./drizzle-storage.js");
const crypto_1 = require("crypto");
class MemStorage {
    users;
    leads;
    messages;
    integrations;
    organizations;
    teamMembers;
    payments;
    threads;
    leadInsightsStore;
    followUps;
    learningPatterns;
    emailMessages;
    auditLogs;
    calendarEvents;
    otpCodes;
    onboardingProfiles;
    usageTopups;
    notifications;
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
        this.usageTopups = new Map();
        this.notifications = new Map();
    }
    async getVoiceMinutesBalance(userId) {
        const user = this.users.get(userId);
        return (Number(user?.voiceMinutesUsed) || 0) + (Number(user?.voiceMinutesTopup) || 0);
    }
    async getExistingEmails(userId, emails) {
        const userLeads = Array.from(this.leads.values()).filter(l => l.userId === userId);
        return emails.filter(e => userLeads.some(l => l.email === e));
    }
    async getLeadsCount(userId) {
        return Array.from(this.leads.values()).filter(l => l.userId === userId).length;
    }
    // --- Organization Methods ---
    async getOrganization(id) {
        return this.organizations.get(id);
    }
    async getOrganizationBySlug(slug) {
        return Array.from(this.organizations.values()).find(o => o.slug === slug);
    }
    async getOrganizationsByOwner(ownerId) {
        return Array.from(this.organizations.values()).filter(o => o.ownerId === ownerId);
    }
    async createOrganization(org) {
        const id = (0, crypto_1.randomUUID)();
        const newOrg = {
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
    async updateOrganization(id, updates) {
        const org = this.organizations.get(id);
        if (!org)
            return undefined;
        const updated = { ...org, ...updates, updatedAt: new Date() };
        this.organizations.set(id, updated);
        return updated;
    }
    // --- Team Member Methods ---
    async getTeamMember(orgId, userId) {
        return Array.from(this.teamMembers.values()).find(m => m.organizationId === orgId && m.userId === userId);
    }
    async getOrganizationMembers(orgId) {
        return Array.from(this.teamMembers.values())
            .filter(m => m.organizationId === orgId)
            .map(m => ({ ...m, user: this.users.get(m.userId) }));
    }
    async getUserOrganizations(userId) {
        return Array.from(this.teamMembers.values())
            .filter(m => m.userId === userId)
            .map(m => ({ ...this.organizations.get(m.organizationId), role: m.role }));
    }
    async addTeamMember(member) {
        const id = (0, crypto_1.randomUUID)();
        const newMember = {
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
    async removeTeamMember(orgId, userId) {
        const member = Array.from(this.teamMembers.values()).find(m => m.organizationId === orgId && m.userId === userId);
        if (member)
            this.teamMembers.delete(member.id);
    }
    async getFollowUpById(id) {
        return Array.from(this.followUps.values()).find(f => f.id === id);
    }
    async updateFollowUp(id, updates) {
        const followUp = this.followUps.get(id);
        if (!followUp)
            return undefined;
        const updated = { ...followUp, ...updates, updatedAt: new Date() };
        this.followUps.set(id, updated);
        return updated;
    }
    async getDueFollowUps() {
        const now = new Date();
        return Array.from(this.followUps.values())
            .filter(f => f.status === 'pending' && f.scheduledAt <= now)
            .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
    }
    async getLearningPatterns(userId) {
        return Array.from(this.learningPatterns.values()).filter(p => p.userId === userId);
    }
    async recordLearningPattern(userId, key, success) {
        const id = (0, crypto_1.randomUUID)();
        const existing = Array.from(this.learningPatterns.values()).find(p => p.userId === userId && p.patternKey === key);
        if (existing) {
            existing.strength = success ? existing.strength + 1 : Math.max(0, existing.strength - 1);
            existing.lastUsedAt = new Date();
        }
        else {
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
    async createPayment(data) {
        const id = (0, crypto_1.randomUUID)();
        const payment = {
            ...data,
            id,
            createdAt: new Date(),
            updatedAt: new Date(),
            stripePaymentId: data.stripePaymentId ?? null,
            plan: data.plan ?? null,
            paymentLink: data.paymentLink ?? null,
            status: data.status || "pending",
            currency: data.currency || "USD",
            webhookPayload: data.webhookPayload || {}
        };
        this.payments.set(id, payment);
        return payment;
    }
    async getPayments(userId) {
        return Array.from(this.payments.values()).filter(p => p.userId === userId);
    }
    async getPaymentById(id) {
        return this.payments.get(id);
    }
    async updatePayment(id, updates) {
        const payment = this.payments.get(id);
        if (!payment)
            return undefined;
        const updated = { ...payment, ...updates, updatedAt: new Date() };
        this.payments.set(id, updated);
        return updated;
    }
    // ========== User Methods ==========
    async getPendingFollowUp(leadId) {
        return Array.from(this.followUps.values()).find(f => f.leadId === leadId && f.status === 'pending');
    }
    async getUser(id) {
        return this.users.get(id);
    }
    async getUserById(id) {
        return this.users.get(id);
    }
    async getUserByEmail(email) {
        return Array.from(this.users.values()).find((user) => user.email === email);
    }
    async getUserByUsername(username) {
        return Array.from(this.users.values()).find((user) => user.username === username);
    }
    async getUserBySupabaseId(supabaseId) {
        return Array.from(this.users.values()).find((user) => user.supabaseId === supabaseId);
    }
    async createUser(insertUser) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date();
        // Calculate trial expiry (3 days from now)
        const trialExpiry = new Date();
        trialExpiry.setDate(trialExpiry.getDate() + 3);
        const user = {
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
            config: insertUser.config || {},
            filteredLeadsCount: insertUser.filteredLeadsCount || 0,
        };
        this.users.set(id, user);
        return user;
    }
    async updateUser(id, updates) {
        const user = this.users.get(id);
        if (!user)
            return undefined;
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
    async getAllUsers() {
        return Array.from(this.users.values());
    }
    async getUserCount() {
        return this.users.size;
    }
    async getUsers() {
        return Array.from(this.users.values());
    }
    // ========== Lead Methods ==========
    async getLeads(options) {
        let leads = Array.from(this.leads.values()).filter((lead) => lead.userId === options.userId);
        if (options.status) {
            leads = leads.filter((lead) => lead.status === options.status);
        }
        if (!options.includeArchived) {
            leads = leads.filter(lead => !lead.archived);
        }
        if (options.channel) {
            leads = leads.filter((lead) => lead.channel === options.channel);
        }
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            leads = leads.filter((lead) => lead.name.toLowerCase().includes(searchLower) ||
                lead.email?.toLowerCase().includes(searchLower) ||
                lead.phone?.includes(searchLower));
        }
        leads = leads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (options.limit) {
            leads = leads.slice(0, options.limit);
        }
        return leads;
    }
    async getLead(id) {
        return this.leads.get(id);
    }
    async getLeadById(id) {
        return this.getLead(id);
    }
    async getLeadByUsername(username, channel) {
        return Array.from(this.leads.values()).find(lead => lead.name.toLowerCase() === username.toLowerCase() &&
            lead.channel === channel);
    }
    async getLeadByEmail(email, userId) {
        return Array.from(this.leads.values()).find(lead => lead.email?.toLowerCase() === email.toLowerCase() &&
            lead.userId === userId);
    }
    async getLeadBySocialId(socialId, channel) {
        return Array.from(this.leads.values()).find(lead => lead.externalId === socialId &&
            lead.channel === channel);
    }
    async createLead(insertLead, options) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date();
        const lead = {
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
            status: insertLead.status || "new",
            score: insertLead.score || 0,
            warm: insertLead.warm || false,
            lastMessageAt: insertLead.lastMessageAt || null,
            aiPaused: insertLead.aiPaused || false,
            verified: insertLead.verified || false,
            verifiedAt: insertLead.verifiedAt || null,
            pdfConfidence: insertLead.pdfConfidence || null,
            archived: insertLead.archived || false,
            tags: insertLead.tags || [],
            metadata: insertLead.metadata || {},
            createdAt: now,
            updatedAt: now,
        };
        this.leads.set(id, lead);
        return lead;
    }
    async updateLead(id, updates) {
        const lead = this.leads.get(id);
        if (!lead)
            return undefined;
        const updatedLead = { ...lead, ...updates, updatedAt: new Date() };
        this.leads.set(id, updatedLead);
        return updatedLead;
    }
    async getTotalLeadsCount() {
        return this.leads.size;
    }
    async archiveLead(id, userId, archived) {
        const lead = this.leads.get(id);
        if (!lead || lead.userId !== userId)
            return undefined;
        const updated = { ...lead, archived, updatedAt: new Date() };
        this.leads.set(id, updated);
        return updated;
    }
    async deleteLead(id, userId) {
        const lead = this.leads.get(id);
        if (lead && lead.userId === userId) {
            this.leads.delete(id);
        }
    }
    async archiveMultipleLeads(ids, userId, archived) {
        for (const id of ids) {
            const lead = this.leads.get(id);
            if (lead && lead.userId === userId) {
                this.leads.set(id, { ...lead, archived, updatedAt: new Date() });
            }
        }
    }
    async deleteMultipleLeads(ids, userId) {
        for (const id of ids) {
            const lead = this.leads.get(id);
            if (lead && lead.userId === userId) {
                this.leads.delete(id);
            }
        }
    }
    async getCalendarEvents(userId) {
        return Array.from(this.calendarEvents.values())
            .filter(e => e.userId === userId)
            .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
    }
    // ========== Message Methods ==========
    async getMessagesByLeadId(leadId) {
        return Array.from(this.messages.values())
            .filter((msg) => msg.leadId === leadId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }
    async getMessages(leadId) {
        return this.getMessagesByLeadId(leadId);
    }
    async getAllMessages(userId, options) {
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
    async createMessage(message) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date();
        const threadId = message.threadId || null;
        const newMessage = {
            id,
            leadId: message.leadId,
            userId: message.userId,
            threadId: threadId,
            provider: message.provider || "instagram",
            direction: message.direction,
            subject: message.subject || null,
            body: message.body,
            audioUrl: message.audioUrl || null,
            trackingId: message.trackingId || null,
            openedAt: message.openedAt || null,
            clickedAt: message.clickedAt || null,
            repliedAt: message.repliedAt || null,
            isRead: message.isRead ?? (message.direction === 'outbound'),
            metadata: message.metadata || {},
            createdAt: now,
        };
        this.messages.set(id, newMessage);
        return newMessage;
    }
    async getOrCreateThread(userId, leadId, subject, providerThreadId) {
        const existing = Array.from(this.threads.values()).find(t => t.userId === userId &&
            t.leadId === leadId &&
            (providerThreadId ? t.metadata?.providerThreadId === providerThreadId : true));
        if (existing)
            return existing;
        const id = (0, crypto_1.randomUUID)();
        const newThread = {
            id,
            userId,
            leadId,
            subject,
            lastMessageAt: new Date(),
            metadata: providerThreadId ? { providerThreadId } : {},
            createdAt: new Date(),
        };
        this.threads.set(id, newThread);
        return newThread;
    }
    async getThreadsByLeadId(leadId) {
        return Array.from(this.threads.values()).filter(t => t.leadId === leadId);
    }
    async updateThread(id, updates) {
        const thread = this.threads.get(id);
        if (!thread)
            return undefined;
        const updated = { ...thread, ...updates };
        this.threads.set(id, updated);
        return updated;
    }
    async updateMessage(id, updates) {
        const message = this.messages.get(id);
        if (!message)
            return undefined;
        const updated = { ...message, ...updates };
        this.messages.set(id, updated);
        return updated;
    }
    async getMessageByTrackingId(trackingId) {
        return Array.from(this.messages.values()).find(m => m.trackingId === trackingId);
    }
    // ========== Integration Methods ==========
    async getIntegrations(userId) {
        return Array.from(this.integrations.values()).filter((integration) => integration.userId === userId);
    }
    async getIntegration(userId, provider) {
        return Array.from(this.integrations.values()).find((integration) => integration.userId === userId && integration.provider === provider);
    }
    async getIntegrationsByProvider(provider) {
        return Array.from(this.integrations.values()).filter((integration) => integration.provider === provider);
    }
    async createIntegration(integration) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date();
        const newIntegration = {
            id,
            userId: integration.userId,
            provider: integration.provider,
            encryptedMeta: integration.encryptedMeta,
            connected: integration.connected ?? true,
            accountType: integration.accountType || null,
            lastSync: integration.lastSync || null,
            createdAt: now,
            updatedAt: now,
        };
        this.integrations.set(id, newIntegration);
        return newIntegration;
    }
    async updateIntegration(userId, provider, updates) {
        const integration = Array.from(this.integrations.values()).find((i) => i.userId === userId && i.provider === provider);
        if (!integration)
            return undefined;
        const updated = { ...integration, ...updates };
        this.integrations.set(integration.id, updated);
        return updated;
    }
    async disconnectIntegration(userId, provider) {
        const integration = Array.from(this.integrations.values()).find((i) => i.userId === userId && i.provider === provider);
        if (integration) {
            this.integrations.delete(integration.id);
        }
    }
    async deleteIntegration(userId, provider) {
        return this.disconnectIntegration(userId, provider);
    }
    // Video monitor methods
    videoMonitors = new Map();
    processedComments = new Set();
    brandKnowledge = new Map();
    async getVideoMonitors(userId) {
        return Array.from(this.videoMonitors.values()).filter(m => m.userId === userId);
    }
    async createVideoMonitor(data) {
        const id = (0, crypto_1.randomUUID)();
        const monitor = { id, ...data, createdAt: new Date() };
        this.videoMonitors.set(id, monitor);
        return monitor;
    }
    async updateVideoMonitor(id, userId, updates) {
        const monitor = this.videoMonitors.get(id);
        if (!monitor || monitor.userId !== userId)
            return null;
        const updated = { ...monitor, ...updates };
        this.videoMonitors.set(id, updated);
        return updated;
    }
    async deleteVideoMonitor(id, userId) {
        const monitor = this.videoMonitors.get(id);
        if (monitor && monitor.userId === userId) {
            this.videoMonitors.delete(id);
        }
    }
    async isCommentProcessed(commentId) {
        return this.processedComments.has(commentId);
    }
    async markCommentProcessed(commentId, status, intentType) {
        this.processedComments.add(commentId);
    }
    async getBrandKnowledge(userId) {
        return this.brandKnowledge.get(userId) || '';
    }
    // Deal tracking
    deals = new Map();
    async getDeals(userId) {
        return Array.from(this.deals.values()).filter(d => d.userId === userId);
    }
    async createDeal(data) {
        const id = (0, crypto_1.randomUUID)();
        const deal = { id, ...data, createdAt: new Date() };
        this.deals.set(id, deal);
        return deal;
    }
    async updateDeal(id, userId, updates) {
        const deal = this.deals.get(id);
        if (!deal || deal.userId !== userId)
            return null;
        const updated = { ...deal, ...updates, updatedAt: new Date() };
        this.deals.set(id, updated);
        return updated;
    }
    async calculateRevenue(userId) {
        const deals = await this.getDeals(userId);
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
    usageHistory = new Map();
    async createUsageTopup(data) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date();
        const topup = { id, ...data, createdAt: now };
        if (!this.usageHistory.has(data.userId)) {
            this.usageHistory.set(data.userId, []);
        }
        this.usageHistory.get(data.userId).push(topup);
        return topup;
    }
    async getUsageHistory(userId, type) {
        let history = this.usageHistory.get(userId) || [];
        if (type) {
            history = history.filter(item => item.type === type);
        }
        return history.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    async getSmtpSettings(userId) {
        return [];
    }
    async getRecentBounces(userId, hours = 168) {
        return [];
    }
    async getDomainVerifications(userId, limit = 10) {
        return [];
    }
    // Onboarding methods
    async createOnboardingProfile(data) {
        const id = (0, crypto_1.randomUUID)();
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
    async getOnboardingProfile(userId) {
        return this.onboardingProfiles.get(userId);
    }
    async updateOnboardingProfile(userId, updates) {
        const existing = this.onboardingProfiles.get(userId);
        if (!existing)
            return undefined;
        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date(),
        };
        this.onboardingProfiles.set(userId, updated);
        return updated;
    }
    // OTP methods (MemStorage implementation)
    async createOtpCode(data) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date();
        const otpCode = { id, ...data, purpose: data.purpose || 'login', createdAt: now, updatedAt: now };
        this.otpCodes.set(id, otpCode);
        return otpCode;
    }
    async getLatestOtpCode(email, purpose) {
        // In-memory, this is inefficient, but for demonstration:
        return Array.from(this.otpCodes.values())
            .filter(code => code.email === email && (!purpose || code.purpose === purpose))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    }
    async incrementOtpAttempts(id) {
        const code = this.otpCodes.get(id);
        if (code) {
            code.attempts++;
            code.updatedAt = new Date();
            this.otpCodes.set(id, code);
        }
    }
    async markOtpVerified(id) {
        const code = this.otpCodes.get(id);
        if (code) {
            code.verified = true;
            code.updatedAt = new Date();
            this.otpCodes.set(id, code);
        }
    }
    async cleanupDemoData() {
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
    async createFollowUp(data) {
        const id = (0, crypto_1.randomUUID)();
        const followUp = {
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
    oauthAccounts = new Map();
    async getOAuthAccount(userId, provider) {
        return Array.from(this.oauthAccounts.values()).find((account) => account.userId === userId && account.provider === provider);
    }
    async getSoonExpiringOAuthAccounts(provider, thresholdMinutes) {
        const now = Date.now();
        const threshold = now + thresholdMinutes * 60 * 1000;
        return Array.from(this.oauthAccounts.values()).filter(account => account.provider === provider &&
            account.expiresAt &&
            account.expiresAt.getTime() < threshold);
    }
    async saveOAuthAccount(data) {
        const existing = await this.getOAuthAccount(data.userId, data.provider);
        const id = existing ? existing.id : (0, crypto_1.randomUUID)();
        const now = new Date();
        const account = {
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
    async deleteOAuthAccount(userId, provider) {
        const existing = await this.getOAuthAccount(userId, provider);
        if (existing) {
            this.oauthAccounts.delete(existing.id);
        }
    }
    // ========== Calendar Events ==========
    async createCalendarEvent(data) {
        const id = (0, crypto_1.randomUUID)();
        const event = {
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
    async toggleAi(leadId, paused) {
        const lead = this.leads.get(leadId);
        if (lead) {
            this.leads.set(leadId, { ...lead, aiPaused: paused });
        }
    }
    async createEmailMessage(message) {
        return { ...message, id: (0, crypto_1.randomUUID)(), createdAt: new Date() };
    }
    async getEmailMessages(userId) {
        return [];
    }
    async getEmailMessageByMessageId(messageId) {
        return undefined;
    }
    async getDashboardStats(userId, overrideDates) {
        const leads = Array.from(this.leads.values()).filter(l => {
            const matchUserId = l.userId === userId;
            if (!matchUserId)
                return false;
            if (overrideDates) {
                const createdAt = new Date(l.createdAt);
                return createdAt >= overrideDates.start && createdAt < overrideDates.end;
            }
            return true;
        });
        const messages = Array.from(this.messages.values()).filter(m => {
            const matchUserId = m.userId === userId;
            if (!matchUserId)
                return false;
            if (overrideDates) {
                const createdAt = new Date(m.createdAt);
                return createdAt >= overrideDates.start && createdAt < overrideDates.end;
            }
            return true;
        });
        const deals = Array.from(this.deals.values()).filter(d => {
            const matchUserId = d.userId === userId;
            if (!matchUserId)
                return false;
            if (overrideDates) {
                const createdAt = new Date(d.createdAt);
                return createdAt >= overrideDates.start && createdAt < overrideDates.end;
            }
            return true;
        });
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const positiveIntents = leads.filter(l => {
            // Use lead score or specific AI intent flags
            const hasHighIntent = l.score > 75;
            const aiIntent = l.metadata?.lastAnalysis?.intentLevel === 'high' ||
                l.metadata?.intelligence?.intent?.intentLevel === 'high';
            return hasHighIntent || aiIntent;
        }).length;
        // Calculate pipeline value including AI-predicted amounts for leads without explicit deals
        const explicitDealValue = deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
        const predictedDealValue = leads
            .filter(l => {
            // Only include predicted value if there's no explicit deal for this lead
            const hasNoDeal = !deals.some(d => d.leadId === l.id);
            const prediction = l.metadata?.intelligence?.predictions?.predictedAmount;
            return hasNoDeal && prediction && prediction > 0;
        })
            .reduce((sum, l) => sum + (Number(l.metadata.intelligence.predictions.predictedAmount) || 0), 0);
        return {
            totalLeads: leads.length,
            newLeads: leads.filter(l => new Date(l.createdAt) >= sevenDaysAgo).length,
            activeLeads: leads.filter(l => l.status === 'open' || l.status === 'replied').length,
            convertedLeads: leads.filter(l => l.status === 'converted').length,
            hardenedLeads: leads.filter(l => l.verified).length,
            bouncyLeads: leads.filter(l => l.status === 'bouncy').length,
            recoveredLeads: leads.filter(l => l.status === 'recovered').length,
            positiveIntents,
            totalMessages: messages.length,
            messagesToday: messages.filter(m => new Date(m.createdAt) >= today && m.direction === 'outbound').length,
            messagesYesterday: messages.filter(m => {
                const d = new Date(m.createdAt);
                return d >= yesterday && d < today && m.direction === 'outbound';
            }).length,
            pipelineValue: explicitDealValue + predictedDealValue,
            closedRevenue: deals.filter(d => d.status === 'converted' || d.status === 'closed_won').reduce((sum, d) => sum + (Number(d.value) || 0), 0),
            openRate: messages.filter(m => m.direction === 'outbound' && m.openedAt).length / (messages.filter(m => m.direction === 'outbound').length || 1) * 100,
            responseRate: leads.length > 0 ? (leads.filter(l => l.status === 'replied' || l.status === 'converted').length / leads.length) * 100 : 0,
            averageResponseTime: this.calculateAverageResponseTime(userId, messages),
            queuedLeads: leads.filter(l => l.status === 'new' && !l.aiPaused).length,
            undeliveredLeads: leads.filter(l => l.status === 'bouncy').length,
        };
    }
    calculateAverageResponseTime(userId, userMessages) {
        const threadResponses = [];
        const messagesByThread = new Map();
        userMessages.forEach(m => {
            const tid = m.threadId || 'default';
            if (!messagesByThread.has(tid))
                messagesByThread.set(tid, []);
            messagesByThread.get(tid).push(m);
        });
        messagesByThread.forEach(msgs => {
            const sorted = msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            const firstOutbound = sorted.find(m => m.direction === 'outbound');
            const firstInboundAfterOutbound = firstOutbound
                ? sorted.find(m => m.direction === 'inbound' && new Date(m.createdAt) > new Date(firstOutbound.createdAt))
                : null;
            if (firstOutbound && firstInboundAfterOutbound) {
                const diff = new Date(firstInboundAfterOutbound.createdAt).getTime() - new Date(firstOutbound.createdAt).getTime();
                threadResponses.push(diff);
            }
        });
        if (threadResponses.length === 0)
            return '—';
        const avgMs = threadResponses.reduce((a, b) => a + b, 0) / threadResponses.length;
        const hours = avgMs / (1000 * 60 * 60);
        if (hours < 1) {
            const mins = Math.round(hours * 60);
            return `${mins}m`;
        }
        return `${hours.toFixed(1)}h`;
    }
    async getAnalyticsFull(userId, days) {
        const leads = Array.from(this.leads.values()).filter(l => l.userId === userId);
        const allMessages = Array.from(this.messages.values()).filter(m => m.userId === userId);
        const deals = Array.from(this.deals.values()).filter(d => d.userId === userId);
        const user = Array.from(this.users.values()).find(u => u.id === userId);
        const conversions = leads.filter(l => l.status === 'converted').length;
        const replied = leads.filter(l => l.status === 'replied' || l.status === 'converted').length;
        const sent = allMessages.filter(m => m.direction === 'outbound').length;
        const opened = allMessages.filter(m => m.direction === 'outbound' && m.openedAt).length;
        const timeSeries = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const dayStart = new Date(date.setHours(0, 0, 0, 0));
            const dayEnd = new Date(date.setHours(23, 59, 59, 999));
            const dayMessages = allMessages.filter(m => new Date(m.createdAt) >= dayStart && new Date(m.createdAt) <= dayEnd);
            const dayLeads = leads.filter(l => l.updatedAt && new Date(l.updatedAt) >= dayStart && new Date(l.updatedAt) <= dayEnd);
            timeSeries.push({
                name: dayStr,
                sent_email: dayMessages.filter(m => m.direction === 'outbound' && m.provider === 'email').length,
                sent_instagram: dayMessages.filter(m => m.direction === 'outbound' && m.provider === 'instagram').length,
                opened: dayMessages.filter(m => m.direction === 'outbound' && m.openedAt).length,
                replied_email: dayLeads.filter(l => (l.status === 'replied' || l.status === 'converted') && l.channel === 'email').length,
                replied_instagram: dayLeads.filter(l => (l.status === 'replied' || l.status === 'converted') && l.channel === 'instagram').length,
                booked: 0
            });
        }
        return {
            metrics: {
                sent,
                opened,
                replied,
                booked: conversions,
                leadsFiltered: user?.filteredLeadsCount || 0,
                conversionRate: leads.length > 0 ? Math.round((conversions / leads.length) * 100) : 0,
                responseRate: leads.length > 0 ? Math.round((replied / leads.length) * 100) : 0,
                openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
                closedRevenue: deals.filter((d) => d.status === 'closed_won').reduce((sum, d) => sum + (Number(d.value) || 0), 0),
                pipelineValue: deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0) + leads
                    .filter(l => !deals.some(d => d.leadId === l.id))
                    .reduce((sum, l) => sum + (Number(l.metadata?.intelligence?.predictions?.predictedAmount) || 0), 0),
                averageResponseTime: this.calculateAverageResponseTime(userId, allMessages),
            },
            timeSeries,
            channelPerformance: [
                { channel: 'Email', value: leads.filter(l => l.channel === 'email').length },
                { channel: 'Instagram', value: leads.filter(l => l.channel === 'instagram').length }
            ],
            recentEvents: leads
                .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
                .slice(0, 5)
                .map(l => {
                const updatedDate = new Date(l.updatedAt || l.createdAt);
                return {
                    id: l.id,
                    type: 'interaction',
                    description: `${l.name} updated status to ${l.status}`,
                    time: updatedDate.toLocaleTimeString(),
                    isNew: (Date.now() - updatedDate.getTime()) < 24 * 60 * 60 * 1000
                };
            })
        };
    }
    async getAnalyticsSummary(userId, startDate) {
        const allLeads = Array.from(this.leads.values()).filter(l => l.userId === userId && new Date(l.createdAt) >= startDate);
        const total = allLeads.length;
        const conversions = allLeads.filter(l => l.status === 'converted').length;
        const active = allLeads.filter(l => l.status === 'open' || l.status === 'replied').length;
        const ghosted = allLeads.filter(l => l.status === 'cold').length;
        const notInterested = allLeads.filter(l => l.status === 'not_interested').length;
        const leadsReplied = allLeads.filter(l => l.status === 'replied' || l.status === 'converted').length;
        // Use AI sentiment if available, otherwise fallback to status
        const positiveCount = allLeads.filter(l => {
            const aiSentiment = l.metadata?.lastAnalysis?.intent === 'positive' ||
                l.metadata?.intelligence?.intent?.sentiment === 'positive';
            return aiSentiment || ['replied', 'converted', 'open'].includes(l.status);
        }).length;
        const negativeCount = allLeads.filter(l => {
            const aiSentiment = l.metadata?.lastAnalysis?.intent === 'negative' ||
                l.metadata?.intelligence?.intent?.sentiment === 'negative';
            return aiSentiment || ['not_interested', 'cold'].includes(l.status);
        }).length;
        const totalWithSentiment = positiveCount + negativeCount;
        const positiveSentimentRate = totalWithSentiment > 0
            ? ((positiveCount / totalWithSentiment) * 100).toFixed(1)
            : '0';
        // Channel breakdown
        const channelMap = new Map();
        allLeads.forEach(l => {
            channelMap.set(l.channel, (channelMap.get(l.channel) || 0) + 1);
        });
        const channelBreakdown = Array.from(channelMap.entries()).map(([channel, count]) => ({
            channel,
            count,
            percentage: total > 0 ? (count / total) * 100 : 0
        }));
        // Status breakdown
        const statusMap = new Map();
        allLeads.forEach(l => {
            statusMap.set(l.status, (statusMap.get(l.status) || 0) + 1);
        });
        const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({
            status,
            count,
            percentage: total > 0 ? (count / total) * 100 : 0
        }));
        return {
            summary: {
                totalLeads: total,
                conversions,
                conversionRate: total > 0 ? ((conversions / total) * 100).toFixed(1) : '0',
                active,
                ghosted,
                notInterested,
                leadsReplied,
                bestReplyHour: null,
            },
            channelBreakdown,
            statusBreakdown,
            timeline: [],
            positiveSentimentRate,
        };
    }
    async createAuditLog(data) {
        const id = (0, crypto_1.randomUUID)();
        const entry = {
            ...data,
            id,
            messageId: data.messageId || null,
            details: data.details || {},
            createdAt: new Date(),
        };
        this.auditLogs.set(id, entry);
        return entry;
    }
    async getAuditLogs(userId) {
        return Array.from(this.auditLogs.values())
            .filter(log => log.userId === userId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    // --- Notification Methods ---
    async getNotifications(userId, opts) {
        let results = Array.from(this.notifications.values()).filter(n => n.userId === userId);
        if (opts?.dateFrom)
            results = results.filter(n => n.createdAt >= opts.dateFrom);
        if (opts?.dateTo)
            results = results.filter(n => n.createdAt <= opts.dateTo);
        results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (opts?.offset)
            results = results.slice(opts.offset);
        if (opts?.limit)
            results = results.slice(0, opts.limit);
        return results;
    }
    async getUnreadNotificationCount(userId) {
        return Array.from(this.notifications.values()).filter(n => n.userId === userId && !n.isRead).length;
    }
    async createNotification(data) {
        const id = (0, crypto_1.randomUUID)();
        const now = new Date();
        const notification = {
            ...data,
            id,
            isRead: false,
            createdAt: now,
            metadata: data.metadata || {},
            actionUrl: data.actionUrl || null,
        };
        this.notifications.set(id, notification);
        return notification;
    }
    async markNotificationAsRead(id, userId) {
        const notification = this.notifications.get(id);
        if (notification && (!userId || notification.userId === userId)) {
            notification.isRead = true;
        }
    }
    async markAllNotificationsAsRead(userId) {
        Array.from(this.notifications.values())
            .filter(n => n.userId === userId)
            .forEach(n => n.isRead = true);
    }
    async clearAllNotifications(userId) {
        Array.from(this.notifications.values())
            .filter(n => n.userId === userId)
            .forEach(n => this.notifications.delete(n.id));
    }
    async deleteNotification(id, userId) {
        const notification = this.notifications.get(id);
        if (notification && notification.userId === userId) {
            this.notifications.delete(id);
        }
    }
    async getLeadInsight(leadId) {
        return Array.from(this.leadInsightsStore.values()).find(i => i.leadId === leadId);
    }
    async upsertLeadInsight(insight) {
        const existing = await this.getLeadInsight(insight.leadId);
        const id = existing ? existing.id : (0, crypto_1.randomUUID)();
        const now = new Date();
        const newInsight = {
            id,
            leadId: insight.leadId,
            userId: insight.userId,
            intent: insight.intent || null,
            intentScore: insight.intentScore ?? 0,
            summary: insight.summary || null,
            nextNextStep: insight.nextNextStep || null,
            competitors: insight.competitors || [],
            painPoints: insight.painPoints || [],
            budget: insight.budget || null,
            timeline: insight.timeline || null,
            lastAnalyzedAt: insight.lastAnalyzedAt instanceof Date ? insight.lastAnalyzedAt : now,
            metadata: insight.metadata || {},
            createdAt: existing ? existing.createdAt : now,
        };
        this.leadInsightsStore.set(id, newInsight);
        return newInsight;
    }
}
exports.MemStorage = MemStorage;
exports.storage = drizzle_storage_js_1.drizzleStorage;
console.log("✓ Using DrizzleStorage with PostgreSQL (persistent storage enabled)");
