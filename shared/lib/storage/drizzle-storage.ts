import type { IStorage } from './storage.js';
import type { User, InsertUser, Lead, InsertLead, Message, InsertMessage, Integration, InsertIntegration, Deal, OnboardingProfile, OtpCode, FollowUpQueue, InsertFollowUpQueue, OAuthAccount, InsertOAuthAccount, CalendarEvent, InsertCalendarEvent, AuditTrail, InsertAuditTrail, Organization, InsertOrganization, TeamMember, InsertTeamMember, Payment, InsertPayment, SmtpSettings, InsertSmtpSettings, EmailMessage, InsertEmailMessage, Notification, InsertNotification, Thread, InsertThread, LeadInsight, InsertLeadInsight, OutreachCampaign, InsertOutreachCampaign, CampaignLead, InsertCampaignLead, FathomCall, InsertFathomCall, PendingPayment, InsertPendingPayment } from "@audnix/shared";
import { db } from '@shared/lib/db/db.js';
import { users, leads, messages, integrations, notifications, deals, usageTopups, onboardingProfiles, otpCodes, payments, followUpQueue, oauthAccounts, calendarEvents, auditTrail, organizations, teamMembers, aiLearningPatterns, bounceTracker, smtpSettings, videoMonitors, processedComments, emailMessages, brandEmbeddings, threads, leadInsights, outreachCampaigns, campaignLeads, fathomCalls, pendingPayments, prospects, emailTracking } from "@audnix/shared";
import { eq, desc, and, gte, lte, sql, not, isNull, or, like, inArray, exists } from "drizzle-orm";
import { isValidUUID } from '../utils/validation.js';
import crypto from 'crypto';
import process from 'process';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';
import { getPlanCapabilities, getActivePlanId } from '../../../shared/plan-utils.js';
import { episodicMemory } from '../memory/episodic-memory-service.js';
// Time Saved Benchmarks (in seconds)
export const TIME_SAVED_BENCHMARKS = {
  OUTBOUND_MESSAGE: 120,    // 2m
  AI_REPLY_HANDLING: 600,   // 10m
  LEAD_RESEARCH: 300,       // 5m
  MEETING_BOOKED: 1800,     // 30m
  FATHOM_ANALYSIS: 1800,    // 30m
  DEAL_WON: 3600            // 60m
};

const formatLeadName = (name: string) => {
  if (!name) return name;
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

// Function to check if the database connection is available
function checkDatabase() {
  if (!db) {
    throw new Error("Database connection is not available.");
  }
}

export class DrizzleStorage implements IStorage {
  async toggleAi(leadId: string, paused: boolean): Promise<void> {
    checkDatabase();
    const [updated] = await db.update(leads).set({ aiPaused: paused, updatedAt: new Date() }).where(eq(leads.id, leadId)).returning();
    if (updated) {
      wsSync.notifyLeadsUpdated(updated.userId, { event: 'UPDATE', lead: updated });
      try {
        clusterSync.notifyStatsCacheInvalidate(updated.userId);
        clusterSync.notifyStatsUpdated(updated.userId);
      } catch {}
    }
  }

  async incrementAIFailureCount(leadId: string): Promise<boolean> {
    checkDatabase();
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return false;

    const currentFailCount = (lead.metadata as any)?.aiFailCount || 0;
    const newFailCount = currentFailCount + 1;
    let shouldPause = false;

    const metadata = {
      ...(lead.metadata as any || {}),
      aiFailCount: newFailCount,
    };

    const updateData: any = { metadata, updatedAt: new Date() };

    if (newFailCount >= 3) {
      updateData.aiPaused = true;
      metadata.aiPausedAt = new Date().toISOString();
      metadata.aiPauseReason = 'Consecutive generation failures';
      shouldPause = true;
    }

    await db.update(leads).set(updateData).where(eq(leads.id, leadId));
    return shouldPause;
  }
  async getIntegrationSentCount(userId: string, integrationId: string, since: Date): Promise<number> {
    checkDatabase();
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(
        eq(messages.userId, userId),
        eq(messages.direction, 'outbound'),
        gte(messages.createdAt, since),
        sql`metadata->>'integrationId' = ${integrationId}`
      ));
    return Number(result?.count || 0);
  }
  async createEmailMessage(message: InsertEmailMessage): Promise<EmailMessage> {
    const [newMessage] = await db.insert(emailMessages).values(message).returning();
    return newMessage;
  }

  async getEmailMessages(userId: string): Promise<EmailMessage[]> {
    checkDatabase();
    return await db.select().from(emailMessages).where(eq(emailMessages.userId, userId));
  }

  async getEmailMessageByMessageId(messageId: string): Promise<EmailMessage | undefined> {
    checkDatabase();
    const [result] = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.messageId, messageId))
      .limit(1);
    return result;
  }

  async getFollowUpById(id: string): Promise<FollowUpQueue | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db.select().from(followUpQueue).where(eq(followUpQueue.id, id)).limit(1);
    return result;
  }

  async updateFollowUp(id: string, updates: Partial<FollowUpQueue>): Promise<FollowUpQueue | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db
      .update(followUpQueue)
      .set(updates)
      .where(eq(followUpQueue.id, id))
      .returning();
    return result;
  }

  async getDueFollowUps(): Promise<FollowUpQueue[]> {
    checkDatabase();
    const now = new Date();
    return await db
      .select()
      .from(followUpQueue)
      .where(and(eq(followUpQueue.status, 'pending'), lte(followUpQueue.scheduledAt, now)))
      .orderBy(desc(followUpQueue.scheduledAt));
  }
  async getPendingFollowUp(leadId: string): Promise<FollowUpQueue | undefined> {
    checkDatabase();
    if (!isValidUUID(leadId)) return undefined;
    const [result] = await db
      .select()
      .from(followUpQueue)
      .where(and(eq(followUpQueue.leadId, leadId), eq(followUpQueue.status, 'pending')))
      .limit(1);
    return result;
  }

  async getUser(id: string): Promise<User | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!result[0]) return undefined;
    const user = { ...result[0] };
    delete (user as any).password;
    return user as User;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    checkDatabase();
    try {
      const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return result[0];
    } catch (error) {
      console.error("Error in getUserByEmail:", { email, error });
      throw error;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    checkDatabase();
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!result[0]) return undefined;
    const user = { ...result[0] };
    delete (user as any).password;
    return user as User;
  }

  async getUserBySupabaseId(supabaseId: string): Promise<User | undefined> {
    checkDatabase();
    const result = await db.select().from(users).where(eq(users.supabaseId, supabaseId)).limit(1);
    if (!result[0]) return undefined;
    const user = { ...result[0] };
    delete (user as any).password;
    return user as User;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;

    // Get current user to merge metadata AND config (safety first)
    const currentUser = await this.getUser(id);
    if (!currentUser) return undefined;

    const dataToUpdate: any = { 
      ...updates, 
      updatedAt: new Date() 
    };

    // MERGE Metadata if present
    if (updates.metadata) {
      dataToUpdate.metadata = {
        ...(currentUser.metadata ?? {}),
        ...updates.metadata,
      };
    }

    // MERGE Config if present (Crucial for AI Engine Toggle persistence)
    if (updates.config) {
      dataToUpdate.config = {
        ...(currentUser.config as any ?? {}),
        ...updates.config,
      };
    }

    const [result] = await db
      .update(users)
      .set(dataToUpdate)
      .where(eq(users.id, id))
      .returning();
    
    if (result) {
      wsSync.notifySettingsUpdated(id, result);
    }
    return result;
  }

  async createUser(insertUser: Partial<InsertUser> & { email: string }): Promise<User> {
    checkDatabase();
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 3);

    // SECURITY: Always default to 'member' - only elevate to 'admin' if whitelist verified
    // NEVER trust caller-provided role to prevent privilege escalation
    let userRole: 'admin' | 'member' = 'member';
    try {
      const whitelistCheck = await db.execute(sql`
        SELECT id FROM admin_whitelist 
        WHERE LOWER(email) = LOWER(${insertUser.email})
          AND status = 'active'
        LIMIT 1
      `);

      if (whitelistCheck.rows && whitelistCheck.rows.length > 0) {
        userRole = 'admin';
        console.log(`[ADMIN] Creating admin user from whitelist: ${insertUser.email}`);
      }
    } catch (error) {
      console.error("[ADMIN] Error checking whitelist during user creation:", error);
      // SECURITY: Force 'member' role on whitelist check failure
      userRole = 'member';
    }

    const result = await db
      .insert(users)
      .values({
        email: insertUser.email,
        password: insertUser.password || null,
        name: insertUser.name || null,
        username: insertUser.username || null,
        avatar: insertUser.avatar || null,
        company: insertUser.company || null,
        timezone: insertUser.timezone || "America/New_York",
        plan: insertUser.plan || "trial",
        trialExpiresAt: insertUser.trialExpiresAt || trialExpiry,
        replyTone: insertUser.replyTone || "professional",
        role: userRole,
        stripeCustomerId: insertUser.stripeCustomerId || null,
        stripeSubscriptionId: insertUser.stripeSubscriptionId || null,
        supabaseId: insertUser.supabaseId || null,
        lastLogin: new Date(),
        config: insertUser.config || {},
        calendarLink: insertUser.calendarLink || null,
        brandGuidelinePdfUrl: insertUser.brandGuidelinePdfUrl || null,
        brandGuidelinePdfText: insertUser.brandGuidelinePdfText || null,
        filteredLeadsCount: insertUser.filteredLeadsCount || 0,
        calendlyAccessToken: insertUser.calendlyAccessToken || null,
        calendlyRefreshToken: insertUser.calendlyRefreshToken || null,
        calendlyExpiresAt: insertUser.calendlyExpiresAt || null,
        calendlyUserUri: insertUser.calendlyUserUri || null,
        defaultPaymentLink: insertUser.defaultPaymentLink || null,
        offerDescription: insertUser.offerDescription || null,
        aiStickerFollowupsEnabled: insertUser.aiStickerFollowupsEnabled ?? true,
      })
      .returning();

    return result[0];
  }


  async getUsersNeedingWeeklyInsights(): Promise<User[]> {
    checkDatabase();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return await db
      .select()
      .from(users)
      .where(or(
        isNull(users.lastInsightGeneratedAt),
        lte(users.lastInsightGeneratedAt, sevenDaysAgo)
      ));
  }

  async getUsersWithActiveVideoMonitors(): Promise<User[]> {
    checkDatabase();
    // This query finds users who have at least one active video monitor
    const results = await db
      .select({ user: users })
      .from(users)
      .where(exists(
        db.select()
          .from(videoMonitors)
          .where(and(
            eq(videoMonitors.userId, users.id),
            eq(videoMonitors.isActive, true)
          ))
      ));
    return results.map((r: { user: User }) => r.user);
  }

  async getPaymentStats(): Promise<Record<string, number>> {
    checkDatabase();
    const results = await db
      .select({
        plan: users.plan,
        count: sql<number>`count(*)`
      })
      .from(users)
      .groupBy(users.plan);
    
    const stats: Record<string, number> = {};
    results.forEach((r: { plan: string | null; count: number }) => {
      if (r.plan) {
        stats[r.plan] = Number(r.count);
      }
    });
    
    // Add pending approval count
    const [pendingResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.paymentStatus, 'pending'));
    
    stats['pending_approvals'] = Number(pendingResult?.count || 0);

    // Add approved count
    const [approvedResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.paymentStatus, 'approved'));
    
    stats['approved_payments'] = Number(approvedResult?.count || 0);
    
    return stats;
  }

  async getPendingLegacyPayments(): Promise<any[]> {
    checkDatabase();
    return await db
      .select()
      .from(users)
      .where(eq(users.paymentStatus, 'pending'));
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    checkDatabase();
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.stripeCustomerId, customerId))
      .limit(1);
    return user;
  }

  async getUserByOutlookSubscriptionId(subscriptionId: string): Promise<User | undefined> {
    checkDatabase();
    const [user] = await db
      .select()
      .from(users)
      .where(sql`metadata->>'outlook_subscription_id' = ${subscriptionId}`)
      .limit(1);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    checkDatabase();
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUserCount(): Promise<number> {
    checkDatabase();
    const result = await db.select({ count: sql<number>`count(*)` }).from(users);
    return Number(result[0].count);
  }

  async deleteUser(id: string): Promise<void> {
    checkDatabase();
    if (!isValidUUID(id)) return;

    // We do NOT use revocationService here directly to avoid circular dependencies.
    // Instead, the route handler calling deleteUser should orchestrate revocationService.revokeAllAndDestroyUser.
    
    // Deleting the user will cascade (if DB constraints are set) or we manually clean up.
    // Drizzle/Postgres usually handles cascades on foreign keys.
    await db.delete(users).where(eq(users.id, id));
  }

  // --- Organization Methods ---

  async getOrganization(id: string): Promise<Organization | undefined> {
    checkDatabase();
    const result = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
    return result[0];
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    checkDatabase();
    const result = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    return result[0];
  }

  async getOrganizationsByOwner(ownerId: string): Promise<Organization[]> {
    checkDatabase();
    return await db.select().from(organizations).where(eq(organizations.ownerId, ownerId));
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    checkDatabase();
    const result = await db.insert(organizations).values(org).returning();
    return result[0];
  }

  async updateOrganization(id: string, updates: Partial<Organization>): Promise<Organization | undefined> {
    checkDatabase();
    const result = await db.update(organizations).set({ ...updates, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
    return result[0];
  }

  // --- Team Member Methods ---

  async getTeamMember(orgId: string, userId: string): Promise<TeamMember | undefined> {
    checkDatabase();
    const result = await db.select().from(teamMembers).where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.userId, userId))).limit(1);
    return result[0];
  }

  async getOrganizationMembers(orgId: string): Promise<(TeamMember & { user: User })[]> {
    checkDatabase();
    const result = await db.select({
      member: teamMembers,
      user: users
    })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.organizationId, orgId));

    return result.map((r: any) => ({ ...r.member, user: r.user }));
  }

  async getUserOrganizations(userId: string): Promise<(Organization & { role: TeamMember["role"] })[]> {
    checkDatabase();
    const result = await db.select({
      org: organizations,
      role: teamMembers.role
    })
      .from(teamMembers)
      .innerJoin(organizations, eq(teamMembers.organizationId, organizations.id))
      .where(eq(teamMembers.userId, userId));

    return result.map((r: any) => ({ ...r.org, role: r.role }));
  }

  async addTeamMember(member: InsertTeamMember): Promise<TeamMember> {
    checkDatabase();
    const result = await db.insert(teamMembers).values(member).returning();
    return result[0];
  }

  async removeTeamMember(orgId: string, userId: string): Promise<void> {
    checkDatabase();
    await db.delete(teamMembers).where(and(eq(teamMembers.organizationId, orgId), eq(teamMembers.userId, userId)));
  }

  async getLeads(options: {
    userId: string;
    status?: string;
    channel?: string;
    search?: string;
    limit?: number;
    offset?: number;
    includeArchived?: boolean;
    integrationId?: string;
    excludeActiveCampaignLeads?: boolean;
  }): Promise<Lead[]> {
    checkDatabase();
    // Ensure userId is a string, not an object
    const userId = typeof options.userId === 'string' ? options.userId : String(options.userId);
    if (!userId || userId === '[object Object]') {
      throw new Error(`Invalid user ID: ${String(options.userId)}`);
    }

    let conditions = [eq(leads.userId, userId)];
    
    // Isolation and Pre-campaign visibility
    if (options.integrationId) {
      const { eq } = await import('drizzle-orm');
      conditions.push(eq(leads.integrationId, options.integrationId) as any);
    }

    if (!options.includeArchived) {
      conditions.push(eq(leads.archived, false));
    }

    // Improved Status Filtering logic
    if (options.status === 'warm') {
      // Warm = replied status or engagement score >= 50
      conditions.push(or(eq(leads.status, 'replied'), gte(leads.score, 50)) as any);
    } else if (options.status === 'cold') {
      // Cold = status is cold
      conditions.push(eq(leads.status, 'cold'));
    } else if (options.status && options.status !== 'all') {
      conditions.push(eq(leads.status, options.status as any));
    }

    if (options.channel) {
      conditions.push(eq(leads.channel, options.channel as any));
    }

    if (options.search) {
      const searchPattern = `%${options.search}%`;
      conditions.push(
        or(
          like(leads.name, searchPattern),
          like(leads.email, searchPattern),
          like(leads.phone, searchPattern),
          like(leads.company, searchPattern),
          like(leads.role, searchPattern)
        ) as any
      );
    }

    if (options.excludeActiveCampaignLeads) {
      conditions.push(
        not(
          exists(
            db.select({ id: campaignLeads.id })
              .from(campaignLeads)
              .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
              .where(
                and(
                  eq(campaignLeads.leadId, leads.id),
                  or(
                    eq(outreachCampaigns.status, 'active'),
                    eq(outreachCampaigns.status, 'paused')
                  )
                )
              )
          )
        ) as any
      );
    }

    let query: any = db.select({
        lead: leads,
        provider: integrations.provider,
        lastMessageData: sql<any>`(
          SELECT row_to_json(sq) FROM (
            SELECT direction, is_read
            FROM ${messages}
            WHERE lead_id = ${leads.id}
            ORDER BY created_at DESC LIMIT 1
          ) sq
        )`,
      })
      .from(leads)
      .leftJoin(integrations, eq(leads.integrationId, integrations.id))
      .where(and(...conditions))
      .orderBy(sql`COALESCE(${leads.lastMessageAt}, ${leads.createdAt}) DESC`);

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.offset(options.offset);
    }

    const rows = await query;
    return rows.map((r: { lead: Lead; provider: string | null; lastMessageData?: any }) => {
      let msgDirection: string | null = null;
      let msgIsRead: boolean | null = null;
      if (r.lastMessageData) {
        const parsed = typeof r.lastMessageData === 'string' ? JSON.parse(r.lastMessageData) : r.lastMessageData;
        msgDirection = parsed?.direction || null;
        msgIsRead = parsed?.is_read ?? null;
      }
      return {
        ...r.lead,
        metadata: {
          ...(r.lead.metadata as any || {}),
          provider: r.provider || r.lead.channel,
          lastMessageDirection: msgDirection,
          lastMessageIsRead: msgIsRead,
        }
      };
    });
  }

  async getLead(id: string): Promise<Lead | undefined> {
    checkDatabase();
    // Ensure id is a string, not an object
    const leadId = typeof id === 'string' ? id : String(id);
    if (!isValidUUID(leadId) || leadId === '[object Object]') {
      return undefined;
    }
    const result = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    return result[0];
  }

  async getLeadByEmail(email: string, userId: string): Promise<Lead | undefined> {
    checkDatabase();
    const [result] = await db
      .select()
      .from(leads)
      // Use ilike for case-insensitive email matching
      .where(and(sql`LOWER(${leads.email}) = LOWER(${email})`, eq(leads.userId, userId)))
      .limit(1);
    return result;
  }

  async findLeadBySenderAndIntegration(email: string, integrationId: string, userId?: string): Promise<Lead | undefined> {
    checkDatabase();
    const [result] = await db
      .select()
      .from(leads)
      .where(and(sql`LOWER(${leads.email}) = LOWER(${email})`, eq(leads.integrationId, integrationId)))
      .limit(1);
    if (!result && userId) {
      const [fallback] = await db
        .select()
        .from(leads)
        .where(and(sql`LOWER(${leads.email}) = LOWER(${email})`, eq(leads.userId, userId)))
        .limit(1);
      return fallback;
    }
    return result;
  }

  async markLeadReplied(leadId: string): Promise<Lead | undefined> {
    checkDatabase();
    const [result] = await db
      .update(leads)
      .set({ 
        status: 'replied', 
        updatedAt: new Date() 
      })
      .where(eq(leads.id, leadId))
      .returning();
    if (result) {
      wsSync.notifyLeadsUpdated(result.userId, { event: 'UPDATE', lead: result });
      try {
        clusterSync.notifyStatsCacheInvalidate(result.userId);
        clusterSync.notifyStatsUpdated(result.userId);
      } catch {}
    }
    return result;
  }

  async getExistingEmails(userId: string, emails: string[]): Promise<string[]> {
    checkDatabase();
    if (emails.length === 0) return [];
    const lowerEmails = emails.map(e => e.toLowerCase());
    // Use ANY with a properly formatted array literal to avoid drizzle's parameter expansion issue
    const emailList = lowerEmails.map(e => `'${e.replace(/'/g, "''")}'`).join(',');
    const results = await db
      .select({ email: leads.email })
      .from(leads)
      .where(and(
        eq(leads.userId, userId),
        sql`LOWER(${leads.email}) = ANY(ARRAY[${sql.raw(emailList)}]::text[])`
      ));
    return results.map((r: { email: string | null }) => r.email).filter((e: string | null): e is string => !!e);
  }

  async getLeadsCount(userId: string): Promise<number> {
    checkDatabase();
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(leads)
      .where(eq(leads.userId, userId));
    return Number(result?.count || 0);
  }

  async getLeadBySocialId(socialId: string, channel: string): Promise<Lead | undefined> {
    checkDatabase();
    const [result] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.externalId, socialId), eq(leads.channel, channel as any)))
      .limit(1);
    return result;
  }


  async createLead(insertLead: Partial<InsertLead> & { userId: string; name: string; channel: string }, options?: { suppressNotification?: boolean }): Promise<Lead> {
    checkDatabase();
    const result = await db
      .insert(leads)
      .values({
        userId: insertLead.userId,
        organizationId: insertLead.organizationId || null,
        externalId: insertLead.externalId || null,
        name: formatLeadName(insertLead.name),
        company: insertLead.company || null,
        role: insertLead.role || null,
        bio: insertLead.bio || null,
        channel: insertLead.channel as any,
        email: insertLead.email || null,
        replyEmail: insertLead.replyEmail || insertLead.email || null,
        phone: insertLead.phone || null,
        website: insertLead.website || null,
        businessName: insertLead.businessName || null,
        city: insertLead.city || null,
        country: insertLead.country || null,
        niche: insertLead.niche || null,
        industry: insertLead.industry || null,
        revenue: insertLead.revenue || null,
        status: insertLead.status || "new",
        score: insertLead.score || 0,
        warm: insertLead.warm || false,
        lastMessageAt: insertLead.lastMessageAt || null,
        aiPaused: insertLead.aiPaused ?? true,
        verified: insertLead.verified || false,
        verifiedAt: insertLead.verifiedAt || null,
        pdfConfidence: insertLead.pdfConfidence || null,
        tags: insertLead.tags || [],
        metadata: insertLead.metadata || {},
        integrationId: insertLead.integrationId || (insertLead.metadata as any)?.integrationId || null,
      })
      .returning();

    if (result[0]) {
      wsSync.notifyLeadsUpdated(insertLead.userId, { event: 'INSERT', lead: result[0] });

      // Notify about new lead unless suppressed
      if (!options?.suppressNotification) {
        this.createNotification({
          userId: insertLead.userId,
          type: 'new_lead',
          title: '🆕 New Lead Imported',
          message: `${result[0].name} has been added via ${result[0].channel}.`,
          actionUrl: `/dashboard/leads/${result[0].id}`
        });
      }

      // Auto-populate timezone intelligence profile (non-blocking)
      const meta = insertLead.metadata as any;
      setImmediate(async () => {
        try {
          const { populateLeadProfile } = await import('../calendar/lead-timezone-intelligence.js');
          await populateLeadProfile(result[0].id, insertLead.userId, {
            city: (insertLead as any).city || meta?.city,
            niche: meta?.niche,
            company: insertLead.company || null,
          });
        } catch { /* non-critical */ }
      });
    }
    return result[0];
  }


  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;

    // Get old lead for status change detection if status is being updated
    let oldLead: Lead | undefined;
    if (updates.status) {
      oldLead = await this.getLead(id);
    }

    if (updates.name) {
      updates.name = formatLeadName(updates.name);
    }

    const [result] = await db
      .update(leads)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(leads.id, id))
      .returning();

    if (result) {
      wsSync.notifyLeadsUpdated(result.userId, { event: 'UPDATE', lead: result });

      // Phase 11: Invalidate dashboard stats for Zero Refresh
      // Use Redis pub/sub for cross-process cache invalidation
      try {
        clusterSync.notifyStatsCacheInvalidate(result.userId);
        clusterSync.notifyStatsUpdated(result.userId);
      } catch (err) { console.warn('[Storage] Stats cache invalidate failed:', err); }


      // Trigger notification on status change
      if (oldLead && updates.status && oldLead.status !== updates.status) {
        let shouldNotify = false;
        let notificationTitle = '📈 Lead Status Updated';
        let notificationMessage = `${result.name} moved from ${oldLead.status} to ${updates.status}.`;
        
        // Suppress noisy status changes
        if (['replied', 'warm', 'booked', 'converted'].includes(updates.status)) {
           shouldNotify = true;
           if (updates.status === 'replied') {
             notificationTitle = '💬 Lead Replied!';
             notificationMessage = `${result.name} has replied to your outreach.`;
           } else if (updates.status === 'booked') {
             notificationTitle = '📅 Meeting Booked!';
             notificationMessage = `${result.name} booked a meeting.`;
           }
        } else if (updates.status === 'contacted') {
           // Notify only if it actually opened something and wasn't just imported
           if (oldLead.status !== 'new') {
              shouldNotify = true;
              notificationTitle = '👀 Lead Opened Email';
              notificationMessage = `${result.name} just opened your email.`;
           }
        } else if (updates.status === 'cold' && oldLead.status !== 'new') {
           shouldNotify = true;
           notificationTitle = '❄️ Lead Turned Cold';
           notificationMessage = `${result.name} has turned cold after no recent interaction.`;
        }

        if (shouldNotify) {
          this.createNotification({
            userId: result.userId,
            type: 'lead_status_change',
            title: notificationTitle,
            message: notificationMessage,
            actionUrl: `/dashboard/leads/${result.id}`
          });
        }

        // System 2: Record episodic memory for autonomous learning
        episodicMemory.onLeadStatusChange(id, oldLead.status, updates.status).catch(err => {
          console.warn('[Memory] Failed to record status change episode:', err);
        });
      }
    }
    return result;
  }

  async reserveLeadForAction(leadId: string, workerName: string, durationMs: number = 5000): Promise<boolean> {
    checkDatabase();
    if (!isValidUUID(leadId)) return false;

    try {
      const now = new Date();
      const lockThreshold = new Date(now.getTime() - durationMs);

      // Atomic update to prevent race conditions across multiple worker ticks or processes
      const result = await db.execute(sql`
        UPDATE leads 
        SET metadata = metadata || jsonb_build_object(
          'processing_lock_at', ${now.toISOString()}::text,
          'processing_worker', ${workerName}::text,
          'processing_lock_duration', ${durationMs}::integer
        )
        WHERE id = ${leadId}
        AND (
          (metadata->>'processing_lock_at') IS NULL
          OR (metadata->>'processing_lock_at')::timestamp < ${lockThreshold.toISOString()}::timestamp
        )
        RETURNING id;
      `);

      return (result.rows?.length || 0) > 0;
    } catch (error) {
      console.error(`[Mutex] Conflict reservation error for lead ${leadId}:`, error);
      return false;
    }
  }

  async archiveLead(id: string, userId: string, archived: boolean): Promise<Lead | undefined> {
    checkDatabase();
    const [result] = await db
      .update(leads)
      .set({ archived, updatedAt: new Date() })
      .where(and(eq(leads.id, id), eq(leads.userId, userId)))
      .returning();

    if (result && archived) {
      // Log as a "Raw" episode for resurrection distillation
      // This de-hardcodes the "Lost" state by allowing the AI to autonomously plan a re-engagement date.
      const { episodicMemory } = await import('../memory/episodic-memory-service.js');
      await episodicMemory.recordEpisode({
        userId,
        leadId: id,
        type: 'neutral',
        action: 'lead_archived',
        context: 'Lead manually archived or moved to lost pool',
        outcome: 'Lead archived',
        metadata: { needs_ai_distillation: true, trigger: 'manual_archive' }
      });
      wsSync.notifyLeadsUpdated(userId, { event: 'UPDATE', lead: result });
    }
    return result;
  }

  async deleteLead(id: string, userId: string): Promise<void> {
    checkDatabase();
    // DESTRUCTIVE ACTION GATE: Convert delete to archive and trigger resurrection logic
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.userId, userId))).limit(1);
    if (lead) {
      await db.update(leads)
        .set({ archived: true, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.userId, userId)));
      
      const { episodicMemory } = await import('../memory/episodic-memory-service.js');
      await episodicMemory.recordEpisode({
        userId,
        leadId: id,
        type: 'neutral',
        action: 'lead_deleted_intent',
        context: 'Lead deletion attempted, diverted to archive for resurrection',
        outcome: 'Lead archived',
        metadata: { needs_ai_distillation: true, trigger: 'destructive_gate' }
      });

      wsSync.notifyLeadsUpdated(userId, { event: 'UPDATE', leadId: id });
    }
  }

  async archiveMultipleLeads(ids: string[], userId: string, archived: boolean): Promise<void> {
    checkDatabase();
    try {
      await db.update(leads)
        .set({ archived, updatedAt: new Date() })
        .where(and(eq(leads.userId, userId), inArray(leads.id, ids)));
    } catch (err) {
      console.error('archiveMultipleLeads failed:', err);
      throw err;
    }

    wsSync.notifyLeadsUpdated(userId, { event: 'BULK_UPDATE', leadIds: ids, updates: { archived } });
    try {
      clusterSync.notifyStatsCacheInvalidate(userId);
      clusterSync.notifyStatsUpdated(userId);
    } catch {}
  }

  async deleteMultipleLeads(ids: string[], userId: string): Promise<void> {
    checkDatabase();
    try {
      // DESTRUCTIVE ACTION GATE: Convert bulk delete to bulk archive
      await db.update(leads)
        .set({ archived: true, updatedAt: new Date() })
        .where(and(eq(leads.userId, userId), inArray(leads.id, ids)));
    } catch (err) {
      console.error('deleteMultipleLeads failed:', err);
      throw err;
    }
    wsSync.notifyLeadsUpdated(userId, { event: 'BULK_UPDATE', leadIds: ids, updates: { archived: true } });
    try {
      clusterSync.notifyStatsCacheInvalidate(userId);
      clusterSync.notifyStatsUpdated(userId);
    } catch {}
  }

  // getAuditLogs with options is defined below in the Audit Trail section

  async getTotalLeadsCount(): Promise<number> {
    checkDatabase();
    const result = await db.select({ count: sql<number>`count(*)` }).from(leads);
    return Number(result[0].count);
  }

  async getMessagesByLeadId(leadId: string): Promise<Message[]> {
    checkDatabase();
    // Phase 8: Cap history to latest 50 messages to prevent payload bloat/OOM
    return await db
      .select()
      .from(messages)
      .where(eq(messages.leadId, leadId))
      .orderBy(desc(messages.createdAt))
      .limit(50);
  }

  async getAllMessages(userId: string, options?: { limit?: number; channel?: string; integrationId?: string }): Promise<Message[]> {
    checkDatabase();

    // Build conditions array
    const conditions = [eq(messages.userId, userId)];

    if (options?.channel) {
      conditions.push(eq(messages.provider, options.channel as any));
    }

    if (options?.integrationId) {
      // Show messages assigned to this mailbox OR Inventory (unassigned)
      conditions.push(or(eq(messages.integrationId, options.integrationId), isNull(messages.integrationId)) as any);
    }

    // Build query with combined conditions
    let query = db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt));

    if (options?.limit) {
      return await query.limit(options.limit);
    }

    return await query;
  }

  async createMessage(
    message: Partial<InsertMessage> & {
      leadId: string;
      userId: string;
      direction: "inbound" | "outbound";
      body: string;
      threadId?: string;
    },
    tx?: any
  ): Promise<Message> {
    checkDatabase();
    const client = tx || db;
    const result = await client
      .insert(messages)
      .values({
        userId: message.userId,
        leadId: message.leadId,
        threadId: message.threadId as any,
        direction: message.direction,
        body: message.body,
        provider: message.provider || 'system',
        trackingId: message.trackingId || null,
        openedAt: message.openedAt || null,
        clickedAt: message.clickedAt || null,
        repliedAt: message.repliedAt || null,
        isRead: message.isRead ?? (message.direction === 'outbound'),
        isWarmup: message.isWarmup ?? false,
        createdAt: new Date(),
        metadata: message.metadata || {},
        integrationId: message.integrationId || (message.metadata as any)?.integrationId || null,
      })
      .returning();

    if (result[0]) {
      const bodyText = message.body.toLowerCase();
      const hasBookingLink = bodyText.includes('calendly.com') ||
                            message.metadata?.intent === 'booking' ||
                            message.metadata?.isMeetingInvite === true;

      const [lead] = await db.select().from(leads).where(eq(leads.id, message.leadId)).limit(1);
      const currentMetadata = (lead?.metadata as Record<string, any>) || {};
      const newMetadata = { ...currentMetadata };

      if (message.direction === 'outbound' && hasBookingLink) {
        newMetadata.bookingLinkSentAt = new Date().toISOString();
        newMetadata.bookingReminderSentAt = null;
        newMetadata.bookingReminderStatus = 'pending';
        console.log(`[BookingReminder] Registered booking link sent to lead ${message.leadId} at ${newMetadata.bookingLinkSentAt}`);
      }

      // Detect booking intent in inbound replies (e.g. "yes let's book", "I'm in")
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
          newMetadata.bookingIntentDetectedAt = new Date().toISOString();
          newMetadata.bookingReminderSentAt = null;
          newMetadata.bookingReminderStatus = 'intent_detected';
          console.log(`[BookingReminder] Booking intent detected for lead ${message.leadId}`);
        }
      }

      // Clean snippet: strip RFC headers and IMAP framing
      const cleanSnippet = message.body
        .replace(/^References:.*$/m, '')
        .replace(/^In-Reply-To:.*$/m, '')
        .replace(/^Message-ID:.*$/m, '')
        .replace(/^Content-Type:.*$/m, '')
        .replace(/^MIME-Version:.*$/m, '')
        .replace(/^Date:.*$/m, '')
        .replace(/^From:.*$/m, '')
        .replace(/^To:.*$/m, '')
        .replace(/^Subject:.*$/m, '')
        .replace(/^DKIM-Signature:.*$/m, '')
        .replace(/^Authentication-Results:.*$/m, '')
        .replace(/^Received:.*$/m, '')
        .replace(/^X-.*:.*$/m, '')
        .replace(/^ARC-.*:.*$/m, '')
        .trim();
      await db.update(leads)
        .set({
          lastMessageAt: new Date(),
          updatedAt: new Date(),
          snippet: (cleanSnippet || message.body).substring(0, 150).replace(/\n/g, ' '),
          status: message.direction === 'inbound' ? 'replied' : undefined,
          metadata: newMetadata
        })
        .where(eq(leads.id, message.leadId));

      // SYSTEM 4: Autonomous Opt-Out Detection
      if (message.direction === 'inbound') {
        const { OptOutDetector } = await import('../ai/opt-out-detector.js');
        if (OptOutDetector.isLikelyOptOut(message.body)) {
          console.log(`[Compliance] Opt-out detected for lead ${message.leadId}. Unsubscribing...`);
          
          await client.update(leads)
            .set({ 
              status: 'unsubscribed', 
              aiPaused: true, 
              updatedAt: new Date(),
              metadata: sql`jsonb_set(metadata, '{unsubscribedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb)`
            })
            .where(eq(leads.id, message.leadId));

          // Log to Audit Trail
          await client.insert(auditTrail).values({
            userId: message.userId,
            action: 'LEAD_UNSUBSCRIBED',
            entityId: message.leadId,
            entityType: 'lead',
            metadata: { reason: 'Autonomous Opt-Out Detection', triggerMessage: message.body.substring(0, 100) }
          });
        }
      }

      // Notify both updates
      wsSync.notifyMessagesUpdated(message.userId, { event: 'INSERT', message: result[0] });
      wsSync.notifyLeadsUpdated(message.userId, { event: 'UPDATE', leadId: message.leadId });

      // Phase 11: Invalidate dashboard stats for Zero Refresh sync
      // Use Redis pub/sub for cross-process cache invalidation
      try {
        clusterSync.notifyStatsCacheInvalidate(message.userId);
        clusterSync.notifyStatsUpdated(message.userId);
      } catch (err) { console.warn('[Storage] Stats cache invalidate failed:', err); }


      // Phase 8: Emit direct thread update to dashboard for instant conversation sync
      import('@shared/lib/realtime/socket-service.js').then(({ socketService }) => {
        socketService.getIo()?.to(`user:${message.userId}`).emit('thread:update', {
          leadId: message.leadId,
          message: result[0]
        });
      }).catch(err => console.error('[SocketService] Failed to emit thread:update', err));

      // --- Campaign Auto-Reply Trigger ---
      // Only triggers when the campaign is active — paused/completed campaigns
      // must NOT auto-reply. Also respects aiPaused per-lead.
      if (message.direction === 'inbound') {
        try {
          const { campaignLeads: cTable, outreachCampaigns: campTable } = await import('@audnix/shared');
          const cLead = await db.select().from(cTable).where(eq(cTable.leadId, message.leadId)).limit(1);
          if (cLead[0] && cLead[0].status !== 'replied') {
            // VERIFY: Campaign must be active for auto-reply to proceed
            const [campRow] = await db.select({ status: campTable.status })
              .from(campTable)
              .where(and(eq(campTable.id, cLead[0].campaignId), eq(campTable.status, 'active')))
              .limit(1);

            // VERIFY: Lead must not have aiPaused
            const [leadRow] = await db.select({ aiPaused: leads.aiPaused })
              .from(leads)
              .where(eq(leads.id, message.leadId))
              .limit(1);

            const shouldAutoReply = campRow && !leadRow?.aiPaused;

            if (shouldAutoReply) {
              const delayMinutes = 2 + Math.floor(Math.random() * 3);
              const nextActionAt = new Date();
              nextActionAt.setMinutes(nextActionAt.getMinutes() + delayMinutes);

              await db.update(cTable)
                .set({
                  status: 'replied',
                  nextActionAt,
                  metadata: { ...cLead[0].metadata, pendingAutoReply: true }
                })
                .where(eq(cTable.id, cLead[0].id));

              try {
                const { campaignQueueManager } = await import('../queues/campaign-queue.js');
                await campaignQueueManager.scheduleAutoReply(
                  cLead[0].campaignId,
                  message.userId,
                  cLead[0].id,
                  cLead[0].integrationId || '',
                  message.leadId
                );
              } catch (queueErr) {
                // Non-critical: fallback to polling if BullMQ unavailable
              }
            }
          }
        } catch (err) {
          console.error('[AutoReply] Failed to check campaign status:', err);
        }
      }
    }
    return result[0];
  }

  async getOrCreateThread(userId: string, leadId: string, subject: string, providerThreadId?: string): Promise<Thread> {
    checkDatabase();

    if (providerThreadId) {
      const existing = await db
        .select()
        .from(threads)
        .where(
          and(
            eq(threads.userId, userId),
            eq(threads.leadId, leadId),
            sql`${threads.metadata}->>'providerThreadId' = ${providerThreadId}`
          )
        )
        .limit(1);

      if (existing[0]) return existing[0];
    }

    const result = await db
      .insert(threads)
      .values({
        userId,
        leadId,
        subject,
        metadata: providerThreadId ? { providerThreadId } : {},
      })
      .returning();

    return result[0];
  }

  async getThreadsByLeadId(leadId: string): Promise<Thread[]> {
    checkDatabase();
    return await db
      .select()
      .from(threads)
      .where(eq(threads.leadId, leadId))
      .orderBy(desc(threads.lastMessageAt));
  }
  async updateThread(id: string, updates: Partial<Thread>): Promise<Thread | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db
      .update(threads)
      .set({ ...updates })
      .where(eq(threads.id, id))
      .returning();
    return result;
  }

  async getLeadInsight(leadId: string): Promise<LeadInsight | undefined> {
    checkDatabase();
    if (!isValidUUID(leadId)) return undefined;
    const [result] = await db
      .select()
      .from(leadInsights)
      .where(eq(leadInsights.leadId, leadId))
      .limit(1);
    return result;
  }

  async upsertLeadInsight(insight: InsertLeadInsight): Promise<LeadInsight> {
    checkDatabase();
    const existing = await this.getLeadInsight(insight.leadId);

    let result: LeadInsight;
    if (existing) {
      const [updated] = await db
        .update(leadInsights)
        .set({ ...insight, lastAnalyzedAt: new Date() })
        .where(eq(leadInsights.id, existing.id))
        .returning();
      result = updated;
    } else {
      const [inserted] = await db
        .insert(leadInsights)
        .values({ ...insight, lastAnalyzedAt: new Date() })
        .returning();
      result = inserted;
    }

    if (result) {
      wsSync.notifyLeadsUpdated(result.userId, { event: 'UPDATE', leadId: result.leadId });
    }

    return result;
  }

  async createLeadsBatch(insertLeads: Array<any>, options?: { suppressNotification?: boolean }): Promise<Lead[]> {
    checkDatabase();
    if (!insertLeads || insertLeads.length === 0) return [];

    // Insert in chunks with ON CONFLICT DO NOTHING so one duplicate doesn't kill the entire batch
    const results: Lead[] = [];
    const chunkSize = 100;
    for (let i = 0; i < insertLeads.length; i += chunkSize) {
      const chunk = insertLeads.slice(i, i + chunkSize);
      try {
        const chunkResults = await db
          .insert(leads)
          .values(chunk.map(l => ({
            userId: l.userId,
            organizationId: l.organizationId || null,
            externalId: l.externalId || null,
            name: l.name,
            company: l.company || null,
            role: l.role || null,
            bio: l.bio || null,
            channel: l.channel as any,
            email: l.email || null,
            replyEmail: l.replyEmail || l.email || null,
            phone: l.phone || null,
            website: l.website || null,
            businessName: l.businessName || null,
            city: l.city || null,
            country: l.country || null,
            niche: l.niche || null,
            industry: l.industry || null,
            revenue: l.revenue || null,
            status: l.status || "new",
            score: l.score || 0,
            warm: l.warm || false,
            lastMessageAt: l.lastMessageAt || null,
            aiPaused: l.aiPaused ?? true,
            verified: l.verified || false,
            verifiedAt: l.verifiedAt || null,
            integrationId: l.integrationId || null,
            metadata: l.metadata || {},
            updatedAt: new Date()
          })))
          .onConflictDoNothing()
          .returning();
        results.push(...chunkResults);
      } catch (err) {
        console.warn(`createLeadsBatch chunk ${i}-${i + chunk.length} failed:`, err);
        // Try one-by-one for this chunk to isolate the problematic lead
        for (const lead of chunk) {
          try {
            const [single] = await db.insert(leads)
              .values({
                userId: lead.userId,
                organizationId: lead.organizationId || null,
                externalId: lead.externalId || null,
                name: lead.name,
                company: lead.company || null,
                role: lead.role || null,
                bio: lead.bio || null,
                channel: lead.channel as any,
                email: lead.email || null,
                replyEmail: lead.replyEmail || lead.email || null,
                phone: lead.phone || null,
                website: lead.website || null,
                businessName: lead.businessName || null,
                city: lead.city || null,
                country: lead.country || null,
                niche: lead.niche || null,
                industry: lead.industry || null,
                revenue: lead.revenue || null,
                integrationId: lead.integrationId || null,
                status: lead.status || "new",
                score: lead.score || 0,
                warm: lead.warm || false,
                lastMessageAt: lead.lastMessageAt || null,
                aiPaused: lead.aiPaused ?? true,
                verified: lead.verified || false,
                verifiedAt: lead.verifiedAt || null,
                metadata: lead.metadata || {},
                updatedAt: new Date()
              })
              .onConflictDoNothing()
              .returning();
            if (single) results.push(single);
          } catch (singleErr) {
            console.warn(`createLeadsBatch single insert failed for ${lead.email}:`, singleErr);
          }
        }
      }
    }

    if (results.length > 0 && !options?.suppressNotification) {
      wsSync.notifyLeadsUpdated(results[0].userId, { event: 'BATCH_CREATE', count: results.length });
    }
    return results;
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined> {
    checkDatabase();
    const [result] = await db
      .update(messages)
      .set(updates)
      .where(eq(messages.id, id))
      .returning();

    if (result) {
      wsSync.notifyMessagesUpdated(result.userId, { event: 'UPDATE', message: result });
    }
    return result;
  }

  async getMessageByTrackingId(trackingId: string): Promise<Message | undefined> {
    checkDatabase();
    const [result] = await db
      .select()
      .from(messages)
      .where(eq(messages.trackingId, trackingId))
      .limit(1);
    return result;
  }


  async getIntegrations(userId: string): Promise<Integration[]> {
    checkDatabase();
    return await db.select().from(integrations).where(eq(integrations.userId, userId));
  }

  async getIntegration(userId: string, provider: string): Promise<Integration | undefined> {
    checkDatabase();
    const result = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider as any)))
      .limit(1);
    return result[0];
  }

  async getIntegrationById(id: string): Promise<Integration | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, id))
      .limit(1);
    return result;
  }

  async getIntegrationsByProvider(provider: string): Promise<Integration[]> {
    checkDatabase();
    return await db
      .select()
      .from(integrations)
      .where(eq(integrations.provider, provider as any));
  }

  async getActiveImapIntegrations(): Promise<Integration[]> {
    checkDatabase();
    return await db
      .select()
      .from(integrations)
      .where(and(
        eq(integrations.connected, true),
        inArray(integrations.provider, ['gmail', 'outlook', 'custom_email'])
      ));
  }

  async getOAuthAccountsByProvider(provider: string): Promise<OAuthAccount[]> {
    checkDatabase();
    // Normalize provider name for OAuth table (gmail -> google, custom_email -> custom, etc.)
    const oauthProvider = provider === 'gmail' ? 'google' : provider;
    
    return await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.provider, oauthProvider as any));
  }

  async getOAuthAccountByProviderAccountId(provider: string, providerAccountId: string): Promise<OAuthAccount | undefined> {
    checkDatabase();
    const oauthProvider = provider === 'gmail' ? 'google' : provider;
    const [account] = await db
      .select()
      .from(oauthAccounts)
      .where(and(
        eq(oauthAccounts.provider, oauthProvider as any),
        eq(oauthAccounts.providerAccountId, providerAccountId)
      ))
      .limit(1);
    return account;
  }

  async createIntegration(
    integration: Partial<InsertIntegration> & {
      userId: string;
      provider: string;
      encryptedMeta: string;
    }
  ): Promise<Integration> {
    checkDatabase();

    // Cross-user uniqueness check: Prevent the same email from being connected by multiple users.
    // This checks across ALL users — if the mailbox email is already connected by someone else,
    // we reject the connection with a clear message.
    if (integration.accountType) {
      const existingAcrossUsers = await db
        .select({ id: integrations.id, userId: integrations.userId })
        .from(integrations)
        .where(
          and(
            eq(integrations.accountType, integration.accountType),
            eq(integrations.connected, true)
          )
        )
        .limit(1);

      if (existingAcrossUsers[0] && existingAcrossUsers[0].userId !== integration.userId) {
        throw new Error(
          `This mailbox (${integration.accountType}) is already connected by another account. Please ask the current owner to disconnect it first before reconnecting.`
        );
      }
    }

    // Upsert logic: Check if an integration for this user, provider, and account already exists
    // accountType is used to distinguish between different accounts of the same provider (e.g. gmail addresses)
    const existing = await db
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.userId, integration.userId),
          eq(integrations.provider, integration.provider as any),
          integration.accountType ? eq(integrations.accountType, integration.accountType) : isNull(integrations.accountType)
        )
      )
      .limit(1);

    if (existing[0]) {
      console.log(`[Storage] Updating existing integration ${existing[0].id} for ${integration.provider}`);
      const [updated] = await db
        .update(integrations)
        .set({
          encryptedMeta: integration.encryptedMeta,
          connected: integration.connected ?? true,
          accountType: integration.accountType || existing[0].accountType,
          lastSync: integration.lastSync || existing[0].lastSync,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, existing[0].id))
        .returning();
      return updated;
    }

    console.log(`[Storage] Creating new integration for ${integration.provider}`);
    const isEmailProvider = ['gmail', 'outlook', 'custom_email'].includes(integration.provider);
    const result = await db
      .insert(integrations)
      .values({
        userId: integration.userId,
        provider: integration.provider as any,
        encryptedMeta: integration.encryptedMeta,
        connected: integration.connected ?? true,
        accountType: integration.accountType || null,
        lastSync: integration.lastSync || null,
        warmupStatus: integration.warmupStatus || (isEmailProvider ? 'active' : 'none'),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result[0];
  }

  async updateIntegration(
    userId: string,
    provider: string,
    updates: Partial<Integration>
  ): Promise<Integration | undefined> {
    checkDatabase();
    // LEGACY: This updates the FIRST matching integration for this provider.
    // For multi-mailbox support, always use updateIntegrationById instead.
    const [result] = await db
      .update(integrations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider as any)))
      .returning();

    return result;
  }

  async updateIntegrationById(
    id: string,
    updates: Partial<Integration>
  ): Promise<Integration | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db
      .update(integrations)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, id))
      .returning();

    return result;
  }

  async checkMailboxLimit(userId: string): Promise<{ allowed: boolean; current: number; limit: number; plan: string }> {
    checkDatabase();
    
    // 1. Get user plan using robust centralized logic
    const user = await this.getUser(userId);
    const plan = getActivePlanId(user);
    const capabilities = getPlanCapabilities(plan);
    const limit = capabilities.mailboxLimit || 1;

    // 2. Count existing mailbox integrations
    const existingIntegrations = await db
      .select({ count: sql<number>`count(*)` })
      .from(integrations)
      .where(and(
        eq(integrations.userId, userId),
        eq(integrations.connected, true),
        inArray(integrations.provider, ['custom_email', 'gmail', 'outlook'])
      ));
    
    const current = Number(existingIntegrations[0]?.count || 0);
    
    return {
      allowed: limit === -1 ? true : current < limit,
      current,
      limit,
      plan
    };
  }

  async disconnectIntegration(userId: string, provider: string): Promise<void> {
    checkDatabase();
    
    // Fetch all integrations matching this provider for this user before deleting
    const matchingIntegrations = await db.select().from(integrations).where(
      and(eq(integrations.userId, userId), eq(integrations.provider, provider as any))
    );

    // Call deleteIntegrationById for each to ensure robust unlinking and cleaning
    for (const integration of matchingIntegrations) {
      await this.deleteIntegrationById(integration.id);
    }

    // Phase 12: Ensure "Full Deletion" of settings for email providers to prevent ghosting
    if (['custom_email', 'gmail', 'outlook'].includes(provider)) {
      try {
        // Purge legacy user_settings SMTP fields
        await db.execute(sql`
          UPDATE user_settings 
          SET smtp_host = NULL, 
              smtp_port = NULL, 
              smtp_username = NULL, 
              smtp_password_encrypted = NULL, 
              smtp_from_email = NULL, 
              smtp_from_name = NULL, 
              smtp_verified = FALSE,
              email_provider = 'sendgrid'
          WHERE user_id = ${userId}
        `);
      } catch (e) {
        console.warn(`[Storage] Failed to clear legacy SMTP settings in user_settings:`, e);
      }
    }
  }

  async deleteIntegration(userId: string, provider: string): Promise<void> {
    return this.disconnectIntegration(userId, provider);
  }

  async deleteIntegrationById(id: string): Promise<void> {
    checkDatabase();
    if (!isValidUUID(id)) return;
    
    // Fetch integration details before deletion to cleanup associated settings
    const [integration] = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1);
    
    // Safely unlink constraints from connected entities to allow deletion
    try { await db.update(leads).set({ integrationId: null as any }).where(eq(leads.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to unlink leads:', (e as Error)?.message); }
    try { await db.update(messages).set({ integrationId: null as any }).where(eq(messages.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to unlink messages:', (e as Error)?.message); }
    try { await db.update(notifications).set({ integrationId: null as any }).where(eq(notifications.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to unlink notifications:', (e as Error)?.message); }
    try { await db.update(prospects).set({ integrationId: null as any }).where(eq(prospects.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to unlink prospects:', (e as Error)?.message); }
    try { await db.update(emailTracking).set({ integrationId: null as any }).where(eq(emailTracking.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to unlink emailTracking:', (e as Error)?.message); }
    try { await db.update(emailMessages).set({ integrationId: null as any }).where(eq(emailMessages.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to unlink emailMessages:', (e as Error)?.message); }
    try { await db.update(campaignLeads).set({ integrationId: null as any }).where(eq(campaignLeads.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to unlink campaignLeads:', (e as Error)?.message); }
    try { await db.delete(bounceTracker).where(eq(bounceTracker.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to delete bounceTracker:', (e as Error)?.message); }
    try { await db.delete(auditTrail).where(eq(auditTrail.integrationId, id)); } catch (e) { console.warn('[DrizzleStorage] Failed to delete auditTrail:', (e as Error)?.message); }
    
    // Phase 12: Ensure "Full Deletion" of settings for email providers to prevent ghosting
    if (integration && ['custom_email', 'gmail', 'outlook'].includes(integration.provider)) {
      try {
        // 1. Purge from the smtp_settings table PRECISELY matching this email address
        if (integration.accountType) {
          await db.delete(smtpSettings).where(
            and(
              eq(smtpSettings.userId, integration.userId),
              sql`lower(${smtpSettings.email}) = lower(${integration.accountType})`
            )
          );
          console.log(`🧹 [Storage] Purged SMTP settings for ${integration.accountType}`);
        } else {
          // Fallback to purging all smtp settings if accountType is missing
          await db.delete(smtpSettings).where(eq(smtpSettings.userId, integration.userId));
        }

        // 2. Purge corresponding OAuth Accounts for this user & email address
        const oauthProvider = integration.provider === 'gmail' ? 'google' : integration.provider === 'outlook' ? 'outlook' : null;
        if (oauthProvider && integration.accountType) {
          await db.delete(oauthAccounts).where(
            and(
              eq(oauthAccounts.userId, integration.userId),
              eq(oauthAccounts.provider, oauthProvider),
              sql`lower(${oauthAccounts.providerAccountId}) = lower(${integration.accountType})`
            )
          );
          console.log(`🧹 [Storage] Purged OAuth account for ${integration.accountType} (${oauthProvider})`);
        }

        // 3. Purge Redis traces for this integrationId
        try {
          const { getRedisClient } = await import('../redis/redis.js');
          const redis = await getRedisClient();
          if (redis) {
            await Promise.allSettled([
              redis.del(`imap:active:${id}`),
              redis.del(`imap:integration:${id}:state`),
              redis.del(`lock:imap:conn:${id}`),
              // Also clean up worker set tracking keys if they exist
              (async () => {
                let cursor = '0';
                do {
                  const result = await redis.scan(cursor, { MATCH: 'imap:worker:*:integrations', COUNT: 100 });
                  cursor = result.cursor as string;
                  if (result.keys.length > 0) {
                    await Promise.allSettled(result.keys.map(k => redis.sRem(k, id)));
                  }
                } while (cursor !== '0');
              })()
            ]);
            console.log(`🧹 [Storage] Successfully purged Redis keys for integration ${id}`);
          }
        } catch (redisErr: any) {
          console.warn(`[Storage] Non-fatal Redis cleanup error: ${redisErr.message}`);
        }
      } catch (e) {
        console.warn(`[Storage] Failed to clear legacy/OAuth/SMTP/Redis settings for integration removal:`, e);
      }
    }

    try {
      await db
        .delete(integrations)
        .where(eq(integrations.id, id));
      console.log(`🗑️ [Storage] Successfully deleted integration ${id} from database.`);
    } catch (delErr: any) {
      console.error(`❌ [Storage] Failed to delete integration ${id} (falling back to marking disconnected):`, delErr);
      await db.update(integrations).set({
        connected: false,
        healthStatus: 'failed',
        lastHealthError: 'Pending deletion cleanup',
        updatedAt: new Date()
      }).where(eq(integrations.id, id));
    }
  }


  async getVideoMonitors(userId: string): Promise<any[]> {
    checkDatabase();
    return await db.select().from(videoMonitors).where(eq(videoMonitors.userId, userId));
  }

  async createVideoMonitor(data: any): Promise<any> {
    checkDatabase();
    const [result] = await db.insert(videoMonitors).values(data).returning();
    return result;
  }

  async updateVideoMonitor(id: string, userId: string, updates: any): Promise<any> {
    checkDatabase();
    const [result] = await db.update(videoMonitors).set(updates).where(and(eq(videoMonitors.id, id), eq(videoMonitors.userId, userId))).returning();
    return result;
  }


  async deleteVideoMonitor(id: string, userId: string): Promise<void> {
    checkDatabase();
    await db.delete(videoMonitors).where(and(eq(videoMonitors.id, id), eq(videoMonitors.userId, userId)));
  }

  async isCommentProcessed(commentId: string): Promise<boolean> {
    checkDatabase();
    const result = await db.select().from(processedComments).where(eq(processedComments.commentId, commentId)).limit(1);
    return result.length > 0;
  }

  async markCommentProcessed(commentId: string, status: string, intentType: string): Promise<void> {
    checkDatabase();
    await db.insert(processedComments).values({
      commentId,
      commenterUsername: "system",
      commentText: "[System Processed]",
      status: status as any,
      intentType,
      processedAt: new Date()
    });
  }

  async getBrandKnowledge(userId: string): Promise<string> {
    checkDatabase();
    const result = await db.select().from(brandEmbeddings)
      .where(eq(brandEmbeddings.userId, userId))
      .orderBy(desc(brandEmbeddings.createdAt))
      .limit(10);
    return result.map((r: any) => r.snippet).join('\n');
  }

  async getLeadByUsername(username: string, channel: string): Promise<Lead | undefined> {
    checkDatabase();
    const result = await db
      .select()
      .from(leads)
      .where(and(
        sql`LOWER(${leads.name}) = LOWER(${username})`,
        eq(leads.channel, channel as any)
      ))
      .limit(1);

    return result[0];
  }

  async getActiveVideoMonitors(userId: string): Promise<any[]> {
    checkDatabase();
    try {
      const result = await db.execute(sql`
        SELECT * FROM video_monitors 
        WHERE user_id = ${userId} AND is_active = true
        ORDER BY created_at DESC
      `);
      return result.rows as any[];
    } catch (error) {
      // Return empty array if table doesn't exist yet
      return [];
    }
  }

  async getVideoMonitor(id: string): Promise<any> {
    checkDatabase();
    try {
      const result = await db.execute(sql`
        SELECT * FROM video_monitors 
        WHERE id = ${id}
        LIMIT 1
      `);
      return result.rows[0];
    } catch (error) {
      return null;
    }
  }



  async getDeals(userId: string, integrationId?: string): Promise<any[]> {
    checkDatabase();
    const integrationFilter = integrationId ? sql`AND (l.integration_id = ${integrationId} OR l.integration_id IS NULL)` : sql``;
    const result = await db.execute(sql`
      SELECT d.*, l.name as lead_name 
      FROM deals d
      LEFT JOIN leads l ON d.lead_id = l.id
      WHERE d.user_id = ${userId} ${integrationFilter}
      ORDER BY d.created_at DESC
    `);
    return result.rows as any[];
  }

  async createDeal(data: any): Promise<any> {
    checkDatabase();
    const [newDeal] = await db.insert(deals).values({
      userId: data.userId,
      leadId: data.leadId,
      organizationId: data.organizationId,
      brand: data.brand || data.title || 'Unknown',
      channel: data.channel || 'manual',
      value: data.value || data.amount || 0,
      status: data.status || 'open',
      source: data.source || 'manual',
      aiAnalysis: data.aiAnalysis || data.metadata || {},
      notes: data.notes,
      dealValue: data.dealValue || 0,
    }).returning();
    return newDeal;
  }

  async updateDeal(id: string, userId: string, updates: any): Promise<any> {
    checkDatabase();
    const updateData: Record<string, any> = {};

    if (updates.status) {
      updateData.status = updates.status;
      if (updates.status === 'closed_won' || updates.status === 'closed_lost') {
        updateData.convertedAt = new Date();
      }
    }
    if (updates.amount !== undefined) {
      updateData.value = updates.amount;
    }

    if (Object.keys(updateData).length === 0) return null;

    const result = await db
      .update(deals)
      .set(updateData)
      .where(and(eq(deals.id, id), eq(deals.userId, userId)))
      .returning();

    return result[0];
  }

  async calculateRevenue(userId: string, integrationId?: string): Promise<{ total: number; thisMonth: number; deals: Deal[] }> {
    checkDatabase();
    // Use raw SQL to avoid referencing the 'deal_value' column which may not exist in the DB.
    // Filter by integrationId if provided, linking through leads
    const integrationFilter = integrationId ? sql`AND (l.integration_id = ${integrationId} OR l.integration_id IS NULL)` : sql``;
    
    let allDeals: any[] = [];
    try {
      const result = await db.execute(
        sql`SELECT d.id, d.status, d.value, d.converted_at, d.ai_analysis as metadata 
            FROM deals d
            LEFT JOIN leads l ON d.lead_id = l.id
            WHERE d.user_id = ${userId} ${integrationFilter}`
      );
      allDeals = (result as any).rows || result || [];
    } catch (e) {
      console.error("Error fetching deals for revenue:", e);
      return { total: 0, thisMonth: 0, deals: [] };
    }
    const closedDeals = allDeals.filter((d: any) => d.status === 'closed_won');

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const total = closedDeals.reduce((sum: number, d: any) => {
      // Prioritize 'offerPrice' from metadata, then fallback to 'value'
      const metadata = d.metadata || {};
      const val = Number(metadata.offerPrice || metadata.offer_price || d.value) || 0;
      return sum + val;
    }, 0);
    const thisMonth = closedDeals
      .filter((d: any) => d.converted_at && new Date(d.converted_at) >= thisMonthStart)
      .reduce((sum: number, d: any) => {
        const metadata = d.metadata || {};
        const val = Number(metadata.offerPrice || metadata.offer_price || d.value) || 0;
        return sum + val;
      }, 0);

    return { total, thisMonth, deals: closedDeals as Deal[] };
  }

  async createUsageTopup(data: any): Promise<any> {
    checkDatabase();
    const topup = {
      userId: data.userId,
      type: data.type,
      amount: data.amount,
      metadata: data.metadata || {}
    };

    const result = await db.insert(usageTopups).values(topup).returning();
    return result[0];
  }

  async getUsageTopups(userId: string, type: 'voice' | 'leads'): Promise<any[]> {
    checkDatabase();
    const allTopups = await db
      .select()
      .from(usageTopups)
      .where(eq(usageTopups.userId, userId))
      .orderBy(desc(usageTopups.createdAt));

    // Filter by type in JavaScript since Drizzle has type constraints
    return allTopups.filter((topup: any) => topup.type === type);
  }

  async getUsageHistory(userId: string, type?: 'voice' | 'leads'): Promise<any[]> {
    checkDatabase();
    const allHistory = await db
      .select()
      .from(usageTopups)
      .where(eq(usageTopups.userId, userId))
      .orderBy(desc(usageTopups.createdAt));

    if (type) {
      return allHistory.filter((h: any) => h.type === type);
    }

    return allHistory;
  }

  async getVoiceMinutesBalance(userId: string): Promise<number> {
    checkDatabase();
    const user = await this.getUser(userId);
    if (!user) return 0;

    const planMinutes = this.getVoiceMinutesForPlan(user.plan);
    const topupMinutes = user.voiceMinutesTopup || 0;
    const usedMinutes = user.voiceMinutesUsed || 0;

    return Math.max(0, planMinutes + topupMinutes - usedMinutes);
  }

  async deductVoiceMinutes(userId: string, minutes: number): Promise<boolean> {
    checkDatabase();
    const balance = await this.getVoiceMinutesBalance(userId);
    if (balance < minutes) return false;

    const user = await this.getUser(userId);
    if (!user) return false;

    await this.updateUser(userId, {
      voiceMinutesUsed: (user.voiceMinutesUsed || 0) + minutes
    });

    return true;
  }

  async addVoiceMinutes(userId: string, minutes: number, source: string): Promise<void> {
    checkDatabase();
    const user = await this.getUser(userId);
    if (!user) return;

    await this.updateUser(userId, {
      voiceMinutesTopup: (user.voiceMinutesTopup || 0) + minutes
    });

    await this.createNotification({
      userId,
      type: 'topup_success',
      title: '✅ Top-up successful!',
      message: `+${minutes} voice minutes added to your account.`,
      actionUrl: '/dashboard/integrations'
    });
  }

  private getVoiceMinutesForPlan(plan: string): number {
    const planMinutes: Record<string, number> = {
      'starter': parseInt(process.env.VOICE_MINUTES_PLAN_49 || '300'),
      'pro': parseInt(process.env.VOICE_MINUTES_PLAN_99 || '800'),
      'enterprise': parseInt(process.env.VOICE_MINUTES_PLAN_199 || '1000'),
      'trial': 0
    };
    return planMinutes[plan] || 0;
  }

  // Onboarding methods
  async createOnboardingProfile(data: any): Promise<any> {
    checkDatabase();
    const profile = {
      userId: data.userId,
      userRole: data.userRole,
      source: data.source || null,
      useCase: data.useCase || null,
      businessSize: data.businessSize || null,
      tags: data.tags || [],
      completed: data.completed || false,
      completedAt: data.completedAt || null,
    };

    const result = await db.insert(onboardingProfiles).values(profile).returning();
    return result[0];
  }

  async getOnboardingProfile(userId: string): Promise<any | undefined> {
    checkDatabase();
    const result = await db
      .select()
      .from(onboardingProfiles)
      .where(eq(onboardingProfiles.userId, userId))
      .limit(1);

    return result[0];
  }

  async updateOnboardingProfile(userId: string, updates: Partial<OnboardingProfile>): Promise<OnboardingProfile> {
    const [updated] = await db
      .update(onboardingProfiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(onboardingProfiles.userId, userId))
      .returning();

    if (!updated) {
      throw new Error('Onboarding profile not found');
    }

    return updated;
  }

  async createOtpCode(data: { email: string; code: string; expiresAt: Date; attempts: number; verified: boolean; passwordHash?: string; purpose?: string }): Promise<any> {
    const [otp] = await db.insert(otpCodes).values({
      ...data,
      purpose: data.purpose || 'login',
    }).returning();
    return otp;
  }

  async getLatestOtpCode(email: string, purpose?: string): Promise<OtpCode | null> {
    try {
      const normalizedEmail = email.toLowerCase();

      const conditions = [eq(otpCodes.email, normalizedEmail)];

      if (purpose) {
        conditions.push(eq(otpCodes.purpose, purpose));
      }

      const result = await db
        .select()
        .from(otpCodes)
        .where(and(...conditions))
        .orderBy(desc(otpCodes.createdAt))
        .limit(1);

      return result[0] || null;
    } catch (error) {
      console.error('Error getting latest OTP code:', error);
      throw error;
    }
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, id));
  }

  async markOtpVerified(id: string): Promise<void> {
    await db
      .update(otpCodes)
      .set({ verified: true })
      .where(eq(otpCodes.id, id));
  }

  async cleanupDemoData(): Promise<{ deletedUsers: number }> {
    checkDatabase();
    // Delete all users with @demo.com email (used by seeder)
    const result = await db.delete(users)
      .where(like(users.email, '%@demo.com'))
      .returning();

    console.log(`🧹 Demo Data Cleanup: Deleted ${result.length} demo users`);
    return { deletedUsers: result.length };
  }

  // ========== Follow Up Queue ==========
  async createFollowUp(data: InsertFollowUpQueue): Promise<FollowUpQueue> {
    checkDatabase();
    const [result] = await db.insert(followUpQueue).values(data).returning();
    return result;
  }

  async clearFollowUpQueue(leadId: string): Promise<void> {
    checkDatabase();
    await db.delete(followUpQueue).where(eq(followUpQueue.leadId, leadId));
  }

  async updateFollowUpStatus(id: string, status: string, errorMessage?: string | null): Promise<FollowUpQueue | undefined> {
    checkDatabase();
    const updateData: any = { status, processedAt: new Date() };
    if (errorMessage !== undefined) updateData.errorMessage = errorMessage;

    // Validate status against enum if enforcing strict types, or cast as any if dynamic
    const [updated] = await db
      .update(followUpQueue)
      .set(updateData)
      .where(eq(followUpQueue.id, id))
      .returning();
    return updated;
  }

  // ========== OAuth Accounts ==========
  async getOAuthAccount(userId: string, provider: string, providerAccountId?: string): Promise<OAuthAccount | undefined> {
    checkDatabase();
    const conditions = [
      eq(oauthAccounts.userId, userId),
      eq(oauthAccounts.provider, provider as any)
    ];

    if (providerAccountId) {
      conditions.push(eq(oauthAccounts.providerAccountId, providerAccountId));
    }

    const result = await db
      .select()
      .from(oauthAccounts)
      .where(and(...conditions))
      .limit(1);

    return result[0];
  }

  async getOAuthAccountByAccountId(userId: string, provider: string, providerAccountId: string): Promise<OAuthAccount | undefined> {
    checkDatabase();
    const [result] = await db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.userId, userId),
          eq(oauthAccounts.provider, provider as any),
          eq(oauthAccounts.providerAccountId, providerAccountId)
        )
      )
      .limit(1);
    return result;
  }

  async getSoonExpiringOAuthAccounts(provider: string, thresholdMinutes: number): Promise<OAuthAccount[]> {
    checkDatabase();
    const threshold = new Date(Date.now() + thresholdMinutes * 60 * 1000);
    const accounts = await db.select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider as any),
          lte(oauthAccounts.expiresAt, threshold)
        )
      );
    return accounts;
  }

  async saveOAuthAccount(data: InsertOAuthAccount): Promise<OAuthAccount> {
    checkDatabase();
    const existing = await this.getOAuthAccount(data.userId, data.provider, data.providerAccountId);

    if (existing) {
      // PERSISTENCE: If the new data doesn't have a refresh token, but we already have one, keep the old one.
      // This is critical for OAuth reconnects where Gmail/Outlook might not return a new refresh token.
      const updateData = { ...data };
      if (!updateData.refreshToken && existing.refreshToken) {
        updateData.refreshToken = existing.refreshToken;
      }

      const [updated] = await db
        .update(oauthAccounts)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(oauthAccounts.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(oauthAccounts)
        .values(data)
        .returning();
      return created;
    }
  }

  async deleteOAuthAccount(userId: string, provider: string, providerAccountId?: string): Promise<void> {
    checkDatabase();
    const conditions = [
      eq(oauthAccounts.userId, userId),
      eq(oauthAccounts.provider, provider as any)
    ];
    if (providerAccountId) {
      conditions.push(eq(oauthAccounts.providerAccountId, providerAccountId));
    }
    await db.delete(oauthAccounts)
      .where(and(...conditions));
  }

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
    checkDatabase();

    const [mainSummary] = await db.select({
      totalLeads: sql<number>`count(*)`,
      conversions: sql<number>`count(*) filter (where status in ('converted', 'booked'))`,
      active: sql<number>`count(*) filter (where status in ('contacted', 'replied', 'warm'))`,
      ghosted: sql<number>`count(*) filter (where status = 'cold')`,
      notInterested: sql<number>`count(*) filter (where status = 'not_interested')`,
      leadsReplied: sql<number>`count(*) filter (where status in ('replied', 'converted', 'booked', 'warm'))`,
    })
      .from(leads)
      .where(and(eq(leads.userId, userId), gte(leads.createdAt, startDate), integrationId ? eq(leads.integrationId, integrationId) : undefined));

    const statusResults = await db.select({
      status: leads.status,
      count: sql<number>`count(*)`,
    })
      .from(leads)
      .where(and(eq(leads.userId, userId), gte(leads.createdAt, startDate), integrationId ? eq(leads.integrationId, integrationId) : undefined))
      .groupBy(leads.status);

    const channelResults = await db.select({
      channel: leads.channel,
      count: sql<number>`count(*)`,
    })
      .from(leads)
      .where(and(eq(leads.userId, userId), gte(leads.createdAt, startDate), integrationId ? eq(leads.integrationId, integrationId) : undefined))
      .groupBy(leads.channel);

    const hourResults = await db.select({
      hour: sql<number>`extract(hour from last_message_at)`,
      count: sql<number>`count(*)`,
    })
      .from(leads)
      .where(and(eq(leads.userId, userId), gte(leads.createdAt, startDate), not(isNull(leads.lastMessageAt)), integrationId ? eq(leads.integrationId, integrationId) : undefined))
      .groupBy(sql`extract(hour from last_message_at)`)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    const timelineResults = await db.select({
      date: sql<string>`to_char(created_at, 'YYYY-MM-DD')`,
      leads: sql<number>`count(*)`,
      conversions: sql<number>`count(*) filter (where status in ('converted', 'booked'))`,
    })
      .from(leads)
      .where(and(eq(leads.userId, userId), gte(leads.createdAt, startDate), integrationId ? eq(leads.integrationId, integrationId) : undefined))
      .groupBy(sql`to_char(created_at, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(created_at, 'YYYY-MM-DD')`);

    const total = Number(mainSummary?.totalLeads || 0);
    const conversions = Number(mainSummary?.conversions || 0);

    // Sentiment calculation
    const [sentimentSummary] = await db.select({
      positive: sql<number>`count(*) filter (where status in ('replied', 'converted', 'booked', 'contacted', 'warm'))`,
      negative: sql<number>`count(*) filter (where status in ('not_interested', 'cold'))`,
    })
      .from(leads)
      .where(and(eq(leads.userId, userId), gte(leads.createdAt, startDate), integrationId ? eq(leads.integrationId, integrationId) : undefined));

    const positiveCount = Number(sentimentSummary?.positive || 0);
    const negativeCount = Number(sentimentSummary?.negative || 0);
    const totalWithSentiment = positiveCount + negativeCount;
    const positiveSentimentRate = totalWithSentiment > 0
      ? ((positiveCount / totalWithSentiment) * 100).toFixed(2)
      : '0.00';

    return {
      summary: {
        totalLeads: total,
        conversions,
        conversionRate: total > 0 ? ((conversions / total) * 100).toFixed(2) : '0.00',
        active: Number(mainSummary?.active || 0),
        ghosted: Number(mainSummary?.ghosted || 0),
        notInterested: Number(mainSummary?.notInterested || 0),
        leadsReplied: Number(mainSummary?.leadsReplied || 0),
        bestReplyHour: hourResults[0] ? Number(hourResults[0].hour) : null,
      },
      channelBreakdown: channelResults.map((c: { channel: string; count: number | string }) => ({
        channel: c.channel,
        count: Number(c.count),
        percentage: total > 0 ? (Number(c.count) / total) * 100 : 0
      })),
      statusBreakdown: statusResults.map((s: { status: string; count: number | string }) => ({
        status: s.status,
        count: Number(s.count),
        percentage: total > 0 ? (Number(s.count) / total) * 100 : 0
      })),
      timeline: timelineResults.map((t: { date: string; leads: number | string; conversions: number | string }) => ({
        date: t.date,
        leads: Number(t.leads),
        conversions: Number(t.conversions)
      })),
      positiveSentimentRate
    };
  }
  async createCalendarEvent(data: InsertCalendarEvent): Promise<CalendarEvent> {
    checkDatabase();
    const [result] = await db.insert(calendarEvents).values(data).returning();

    if (result) {
      wsSync.notifyCalendarUpdated(data.userId, { event: 'INSERT', eventData: result });
    }
    return result;
  }

  async getCalendarEvents(userId: string): Promise<CalendarEvent[]> {
    checkDatabase();
    return await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, userId))
      .orderBy(desc(calendarEvents.startTime));
  }

  // ========== Audit Trail ==========
  async createAuditLog(data: InsertAuditTrail): Promise<AuditTrail> {
    checkDatabase();
    
    // Proactive normalization: PostgreSQL UUID fields cannot be malformed strings or "system" placeholders
    const sanitizedData = {
      ...data,
      leadId: (data.leadId && data.leadId.length > 0 && isValidUUID(data.leadId)) ? data.leadId : null,
      integrationId: (data.integrationId && data.integrationId.length > 0 && isValidUUID(data.integrationId)) ? data.integrationId : null,
      messageId: (data.messageId && data.messageId.length > 0 && isValidUUID(data.messageId)) ? data.messageId : null,
    };

    const [result] = await db.insert(auditTrail).values(sanitizedData).returning();
    return result;
  }


  async getAuditLogs(userId: string, options?: { integrationId?: string, daysFilter?: number, limit?: number, offset?: number }): Promise<AuditTrail[]> {
    checkDatabase();
    const conditions = [eq(auditTrail.userId, userId)];
    if (options?.integrationId) {
      conditions.push(eq(auditTrail.integrationId, options.integrationId));
    }
    // Only apply daysFilter if it is greater than 0. 0 or undefined means 'all time'
    if (options?.daysFilter && options.daysFilter > 0) {
      const cutOff = new Date();
      cutOff.setDate(cutOff.getDate() - options.daysFilter);
      conditions.push(gte(auditTrail.createdAt, cutOff));
    }
    
    let query: any = db
      .select()
      .from(auditTrail)
      .where(and(...conditions))
      .orderBy(desc(auditTrail.createdAt))
      .limit(options?.limit || 50);

    if (options?.offset) {
      query = query.offset(options.offset);
    }

    return await query;
  }

  // ========== AI Learning Patterns ==========
  async getLearningPatterns(userId: string, filters?: { industry?: string; persona?: string; strengthThreshold?: number }): Promise<any[]> {
    checkDatabase();
    try {
      let conditions = [eq(aiLearningPatterns.userId, userId)];
      
      if (filters?.strengthThreshold !== undefined) {
        conditions.push(gte(aiLearningPatterns.strength, filters.strengthThreshold));
      }

      let results = await db
        .select()
        .from(aiLearningPatterns)
        .where(and(...conditions))
        .orderBy(desc(aiLearningPatterns.strength));

      // Filter by metadata in-memory for JSONB safety across different Postgres versions
      if (filters?.industry) {
        results = results.filter(r => (r.metadata as any)?.industry === filters.industry);
      }
      if (filters?.persona) {
        results = results.filter(r => (r.metadata as any)?.persona === filters.persona);
      }

      return results;
    } catch (error) {
      console.warn('getLearningPatterns error:', error);
      return [];
    }
  }


  async recordLearningPattern(userId: string, key: string, success: boolean, metadata?: { industry?: string; persona?: string; insight?: string }): Promise<void> {
    checkDatabase();
    try {
      const existing = await db
        .select()
        .from(aiLearningPatterns)
        .where(and(eq(aiLearningPatterns.userId, userId), eq(aiLearningPatterns.patternKey, key)))
        .limit(1);

      if (existing.length > 0) {
        const newStrength = success ? existing[0].strength + 1 : Math.max(0, existing[0].strength - 1);
        const mergedMetadata = {
          ...(existing[0].metadata as any || {}),
          ...(metadata || {}),
          last_update: new Date().toISOString()
        };
        
        await db
          .update(aiLearningPatterns)
          .set({ 
            strength: newStrength, 
            lastUsedAt: new Date(),
            metadata: mergedMetadata
          })
          .where(eq(aiLearningPatterns.id, existing[0].id));
      } else {
        await db.insert(aiLearningPatterns).values({
          userId,
          patternKey: key,
          strength: success ? 1 : 0,
          metadata: metadata || {},
          lastUsedAt: new Date(),
        });
      }
    } catch (error) {
      console.error('Error recording learning pattern:', error);
    }
  }

  async getRecentBounces(userId: string, hours: number = 168): Promise<any[]> {
    checkDatabase();
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    try {
      return await db
        .select()
        .from(bounceTracker)
        .where(and(eq(bounceTracker.userId, userId), gte(bounceTracker.createdAt, since)))
        .orderBy(desc(bounceTracker.createdAt));
    } catch (error) {
      console.warn('getRecentBounces: table may not exist');
      return [];
    }
  }

  async getDomainVerifications(userId: string, limit: number = 10): Promise<any[]> {
    checkDatabase();
    try {
      const result = await db.execute(sql`
        SELECT domain, verification_result, created_at
        FROM domain_verifications
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);
      return result.rows || [];
    } catch (e) {
      return [];
    }
  }

  async createDomainVerification(userId: string, data: any): Promise<any> {
    checkDatabase();
    try {
      const result = await db.execute(sql`
        INSERT INTO domain_verifications (user_id, domain, verification_result)
        VALUES (${userId}, ${data.domain}, ${JSON.stringify(data.verificationResult)}::jsonb)
        ON CONFLICT (user_id, domain) 
        DO UPDATE SET 
          verification_result = EXCLUDED.verification_result,
          created_at = NOW()
        RETURNING *
      `);
      return result.rows[0];
    } catch (e) {
      console.error('Failed to create/update domain verification', e);
      return null;
    }
  }

  async getSmtpSettings(userId: string): Promise<SmtpSettings[]> {
    checkDatabase();
    const rows = await db.select().from(smtpSettings).where(eq(smtpSettings.userId, userId));
    return rows.map(row => {
      const safe = { ...row };
      delete (safe as any).pass;
      return safe as SmtpSettings;
    });
  }

  async createPayment(data: InsertPayment): Promise<Payment> {
    checkDatabase();
    const result = await db
      .insert(payments)
      .values(data)
      .returning();

    return result[0];
  }

  async getPayments(userId: string): Promise<Payment[]> {
    checkDatabase();
    return await db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt));
  }

  async getPaymentById(id: string): Promise<Payment | undefined> {
    checkDatabase();
    const [result] = await db.select().from(payments).where(eq(payments.id, id)).limit(1);
    return result;
  }

  async updatePayment(id: string, updates: Partial<Payment>): Promise<Payment | undefined> {
    checkDatabase();
    const [result] = await db.update(payments).set({ ...updates, updatedAt: new Date() }).where(eq(payments.id, id)).returning();
    return result;
  }


  private calculateRate(num: number, den: number, minDen: number = 0): number | null {
    if (den === 0 || den < minDen) return null;
    return Number(((num / den) * 100).toFixed(2));
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
    outreachedLeads: number;
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
    timeSaved: number; // Total seconds saved by AI
    globalBounceRate: number;
    health: {
      score: number | null;
      status: 'healthy' | 'warning' | 'critical' | 'unknown';
      reputation: number | null;
      bounces: {
        hard: number;
        soft: number;
        spam: number;
        total: number;
      };
    };
  }> {
    checkDatabase();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    // Build filters
    let leadsWhere = eq(leads.userId, userId);
    let messagesWhere = and(eq(messages.userId, userId), eq(messages.isWarmup, false))!;
    let dealsWhere = eq(deals.userId, userId);

    if (options?.start) {
      leadsWhere = and(leadsWhere, gte(leads.createdAt, options.start))!;
      messagesWhere = and(messagesWhere, gte(messages.createdAt, options.start))!;
      dealsWhere = and(dealsWhere, gte(deals.createdAt, options.start))!;
    }
    if (options?.end) {
      leadsWhere = and(leadsWhere, lte(leads.createdAt, options.end))!;
      messagesWhere = and(messagesWhere, lte(messages.createdAt, options.end))!;
      dealsWhere = and(dealsWhere, lte(deals.createdAt, options.end))!;
    }
    if (options?.integrationId) {
      // STRICT ISOLATION: When viewing a specific mailbox (integration), 
      // only count messages and leads TRULY assigned to that mailbox.
      // Do NOT include unassigned (isNull) leads as they "hike" the metrics.
      messagesWhere = and(messagesWhere, eq(messages.integrationId, options.integrationId))!;
      leadsWhere = and(leadsWhere, eq(leads.integrationId, options.integrationId))!;

      // Filter deals associated with THIS mailbox's leads
      dealsWhere = and(dealsWhere, sql`exists (
        select 1 from ${leads} 
        where ${leads.id} = ${deals.leadId} 
        and ${leads.integrationId} = ${options.integrationId}
      )`)!;
    }

    const [integration] = options?.integrationId 
      ? await db.select().from(integrations).where(and(eq(integrations.id, options.integrationId), eq(integrations.userId, userId)))
      : [null];

    const [queueStats] = await db.select({
      failedFollowUps: sql<number>`count(*) filter (where status = 'failed')`
    })
      .from(followUpQueue)
      .where(options?.integrationId 
        ? and(eq(followUpQueue.userId, userId), sql`exists (select 1 from ${leads} where ${leads.id} = ${followUpQueue.leadId} and ${leads.integrationId} = ${options.integrationId})`)
        : eq(followUpQueue.userId, userId)
      );

    // [FIX] Query bounceTracker table directly for accurate bounce counts
    const bounceTrackerWhere = options?.integrationId
      ? and(eq(bounceTracker.userId, userId), eq(bounceTracker.integrationId, options.integrationId))
      : eq(bounceTracker.userId, userId);
    const [bounceTrackerStats] = await db.select({
      hard: sql<number>`count(*) filter (where ${bounceTracker.bounceType} = 'hard')`,
      soft: sql<number>`count(*) filter (where ${bounceTracker.bounceType} = 'soft')`,
      spam: sql<number>`count(*) filter (where ${bounceTracker.bounceType} = 'spam')`,
      total: sql<number>`count(*)`,
    }).from(bounceTracker).where(bounceTrackerWhere);

    // [PHASE 70] SENIOR PERFORMANCE OPTIMIZATION: Single-trip aggregation query
    const [combinedStats] = await db.select({
      totalLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere})`,
      newLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere} AND ${leads.createdAt} >= ${sevenDaysAgo})`,
      activeLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere} AND status IN ('contacted', 'replied', 'warm'))`,
      convertedLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere} AND status IN ('converted', 'booked'))`,
      hardenedLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere} AND verified = true)`,
      bouncyLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere} AND status = 'bouncy')`,
      recoveredLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere} AND status = 'recovered')`,
      repliedLeads: sql<number>`(SELECT count(DISTINCT lead_id) FROM ${messages} WHERE ${messagesWhere} AND direction = 'inbound' AND (${messages.subject} NOT LIKE '%Undelivered%' OR ${messages.subject} IS NULL))`,
      queuedLeads: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leadsWhere} AND status = 'new' AND ai_paused = false)`,
      totalSent: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messagesWhere} AND direction = 'outbound')`,
      opened: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messagesWhere} AND direction = 'outbound' AND opened_at IS NOT NULL)`,
      replied: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messagesWhere} AND direction = 'inbound' AND (${messages.subject} NOT LIKE '%Undelivered%' OR ${messages.subject} IS NULL))`,
      messagesToday: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messagesWhere} AND ${messages.createdAt} >= ${todayStart} AND direction = 'outbound')`,
      messagesYesterday: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messagesWhere} AND ${messages.createdAt} >= ${yesterdayStart} AND ${messages.createdAt} < ${todayStart} AND direction = 'outbound')`,
      positiveIntents: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messagesWhere} AND direction = 'inbound' AND (lower(body) LIKE '%yes%' OR lower(body) LIKE '%book%' OR lower(body) LIKE '%interested%' OR lower(body) LIKE '%call%' OR lower(body) LIKE '%meeting%'))`,
      aiReplies: sql<number>`(SELECT count(*) FROM ${messages} WHERE ${messagesWhere} AND direction = 'outbound' AND (metadata->>'autonomous' = 'true' OR metadata->>'campaignId' IS NOT NULL))`,
      pipelineValue: sql<number>`(SELECT coalesce(sum(CASE WHEN status = 'open' THEN coalesce(cast(ai_analysis->>'offerPrice' as numeric), cast(ai_analysis->>'offer_price' as numeric), value) ELSE 0 END), 0) FROM ${deals} WHERE ${dealsWhere})`,
      closedRevenue: sql<number>`(SELECT coalesce(sum(CASE WHEN status IN ('converted', 'closed_won') THEN coalesce(cast(ai_analysis->>'offerPrice' as numeric), cast(ai_analysis->>'offer_price' as numeric), value) ELSE 0 END), 0) FROM ${deals} WHERE ${dealsWhere})`,
      wonCount: sql<number>`(SELECT count(*) FROM ${deals} WHERE ${dealsWhere} AND status IN ('converted', 'closed_won'))`,
      outreachedLeads: sql<number>`(SELECT count(DISTINCT lead_id) FROM ${messages} WHERE ${messagesWhere} AND direction = 'outbound')`,
      predictedValue: sql<number>`(SELECT coalesce(sum(cast(metadata->'intelligence'->'predictions'->>'predictedAmount' as numeric)), 0) FROM ${leads} WHERE ${leadsWhere} AND metadata->'intelligence'->'predictions'->>'predictedAmount' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${deals} WHERE deals.lead_id = ${leads.id}))`,
    }).from(sql`(SELECT 1) as dual`);

    // [NEW] Precision Time Saved Metrics
    const [bookingStats, fathomStats] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(calendarEvents).where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.startTime, options?.start || sevenDaysAgo))),
      db.select({ count: sql<number>`count(*)` }).from(fathomCalls).where(and(eq(fathomCalls.userId, userId), gte(fathomCalls.occurredAt, options?.start || sevenDaysAgo)))
    ]);

    const timeSaved = 
      (Number(combinedStats.totalSent || 0) * TIME_SAVED_BENCHMARKS.OUTBOUND_MESSAGE) + 
      (Number(combinedStats.aiReplies || 0) * TIME_SAVED_BENCHMARKS.AI_REPLY_HANDLING) + 
      (Number(combinedStats.outreachedLeads || 0) * TIME_SAVED_BENCHMARKS.LEAD_RESEARCH) + 
      (Number(bookingStats[0].count || 0) * TIME_SAVED_BENCHMARKS.MEETING_BOOKED) + 
      (Number(fathomStats[0].count || 0) * TIME_SAVED_BENCHMARKS.FATHOM_ANALYSIS) + 
      (Number(combinedStats.wonCount || 0) * TIME_SAVED_BENCHMARKS.DEAL_WON);

    // Calculate predicted deal value from leads without explicit deals
    const [predictedStats] = await db.select({
      value: sql<number>`coalesce(sum(cast(${leads.metadata}->'intelligence'->'predictions'->>'predictedAmount' as numeric)), 0)`
    })
      .from(leads)
      .where(and(
        leadsWhere,
        sql`${leads.metadata}->'intelligence'->'predictions'->>'predictedAmount' is not null`,
        sql`not exists (select 1 from deals where deals.lead_id = leads.id)`
      ));

    // For averageResponseTime, we also ideally filter by integrationId
    const averageResponseTime = await this.calculateAverageResponseTime(userId, options?.integrationId);

    return {
      totalLeads: Number(combinedStats.totalLeads || 0),
      newLeads: Number(combinedStats.newLeads || 0),
      activeLeads: Number(combinedStats.activeLeads || 0),
      convertedLeads: Number(combinedStats.convertedLeads || 0),
      hardenedLeads: Number(combinedStats.hardenedLeads || 0),
      bouncyLeads: Number(combinedStats.bouncyLeads || 0),
      recoveredLeads: Number(combinedStats.recoveredLeads || 0),
      positiveIntents: Number(combinedStats.positiveIntents || 0),
      totalMessages: Number(combinedStats.totalSent || 0),
      outreachedLeads: Number(combinedStats.outreachedLeads || 0),
      messagesToday: Number(combinedStats.messagesToday || 0),
      messagesYesterday: Number(combinedStats.messagesYesterday || 0),
      aiReplies: Number(combinedStats.aiReplies || 0),
      pipelineValue: Number((Number(combinedStats.pipelineValue || 0) + Number(combinedStats.predictedValue || 0)).toFixed(2)),
      closedRevenue: Number(Number(combinedStats.closedRevenue || 0).toFixed(2)),
      averageResponseTime,
      queuedLeads: Number(combinedStats.queuedLeads || 0),
      undeliveredLeads: Number(queueStats?.failedFollowUps || 0),
      
      // Precision Rates - Level 10 Ratio-Safe Math
      openRate: this.calculateRate(Number(combinedStats.opened || 0), Number(combinedStats.totalSent || 0), 5),
      responseRate: this.calculateRate(Number(combinedStats.repliedLeads || 0), Number(combinedStats.outreachedLeads || 0), 1), 
      conversionRate: this.calculateRate(Number(combinedStats.convertedLeads || 0), Number(combinedStats.outreachedLeads || 0), 1),
      intentRate: this.calculateRate(Number(combinedStats.positiveIntents || 0), Number(combinedStats.repliedLeads || 0), 1),
      outreachVelocity: this.calculateRate(Number(combinedStats.totalSent || 0), Number(combinedStats.totalLeads || 0), 1),
      timeSaved,
      globalBounceRate: Number((this.calculateRate(Number(bounceTrackerStats?.total || 0), Number(combinedStats.totalSent || 0), 1) ?? 0) / 100),
      health: {
        score: integration?.reputationScore ?? null,
        status: integration?.reputationScore == null ? 'unknown' : integration.reputationScore < 45 ? 'critical' : integration.reputationScore < 70 ? 'warning' : 'healthy',
        reputation: integration?.reputationScore ?? null,
        bounces: {
          hard: Number(bounceTrackerStats?.hard || 0),
          soft: Number(bounceTrackerStats?.soft || 0),
          spam: Number(bounceTrackerStats?.spam || 0),
          total: Number(bounceTrackerStats?.total || 0)
        }
      }
    };
  }

  private async calculateAverageResponseTime(userId: string, integrationId?: string): Promise<string> {
    const integrationFilter = integrationId
      ? sql`AND m1.integration_id = ${integrationId}`
      : sql``;

    const result: any = await db.execute(sql`
      WITH response_times AS (
        SELECT 
          m2.created_at - m1.created_at as duration
        FROM messages m1
        JOIN messages m2 ON m1.lead_id = m2.lead_id
        WHERE m1.direction = 'outbound'
          AND m1.is_warmup = false
          AND m2.direction = 'inbound'
          AND m2.created_at > m1.created_at
          AND m1.user_id = ${userId}
          ${integrationFilter}
          AND NOT EXISTS (
            SELECT 1 FROM messages m3
            WHERE m3.lead_id = m1.lead_id
              AND m3.created_at > m1.created_at
              AND m3.created_at < m2.created_at
          )
      )
      SELECT 
        AVG(EXTRACT(EPOCH FROM duration)) as avg_seconds
      FROM response_times
    `);

    const row = Array.isArray(result) ? result[0] : result?.rows?.[0];
    const avgSeconds = Number(row?.avg_seconds || 0);
    if (avgSeconds <= 0) return '—';

    if (avgSeconds < 3600) {
      return `${(avgSeconds / 60).toFixed(2)}m`;
    } else if (avgSeconds < 86400) {
      return `${(avgSeconds / 3600).toFixed(2)}h`;
    } else {
      return `${(avgSeconds / 86400).toFixed(2)}d`;
    }
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
    checkDatabase();

    // 1. Basic Metrics
    const leadWhere = and(
      eq(leads.userId, userId), 
      integrationId ? eq(leads.integrationId, integrationId) : undefined
    );
    const msgWhere = and(
      eq(messages.userId, userId), 
      integrationId ? eq(messages.integrationId, integrationId) : undefined
    );

    const [counts] = await db.select({
      totalLeads: sql<number>`count(*)`,
      conversions: sql<number>`count(*) filter (where status in ('converted', 'booked'))`,
      replied: sql<number>`count(*) filter (where status = 'replied')`,
    }).from(leads).where(leadWhere);

    const [msgCounts] = await db.select({
      sent: sql<number>`count(*) filter (where direction = 'outbound')`,
      opened: sql<number>`count(*) filter (where direction = 'outbound' and opened_at is not null)`,
    }).from(messages).where(msgWhere);

    const dealWhere = integrationId 
      ? and(
          eq(deals.userId, userId), 
          sql`exists (
            select 1 from leads 
            where leads.id = deals.lead_id 
            and leads.integration_id = ${integrationId}
          )`
        )
      : eq(deals.userId, userId);

    const [dealsStats] = await db.select({
      pipelineValue: sql<number>`coalesce(sum(coalesce(cast(ai_analysis->>'offerPrice' as numeric), cast(ai_analysis->>'offer_price' as numeric), value)), 0)`,
      closedRevenue: sql<number>`coalesce(sum(case when status in ('closed_won', 'converted') then coalesce(cast(ai_analysis->>'offerPrice' as numeric), cast(ai_analysis->>'offer_price' as numeric), value) else 0 end), 0)`,
    }).from(deals).where(dealWhere as any);

    const [predictedStats] = await db.select({
      value: sql<number>`coalesce(sum(cast(metadata->'intelligence'->'predictions'->>'predictedAmount' as numeric)), 0)`
    })
      .from(leads)
      .where(and(
        leadWhere,
        sql`metadata->'intelligence'->'predictions'->>'predictedAmount' is not null`,
        sql`not exists (select 1 from deals where deals.lead_id = leads.id)`
      ));

    const [user] = await db.select({
      filteredLeadsCount: users.filteredLeadsCount
    }).from(users).where(eq(users.id, userId)).limit(1);

    const totalLeads = Number(counts?.totalLeads || 0);
    const conversions = Number(counts?.conversions || 0);
    const replied = Number(counts?.replied || 0);
    const sent = Number(msgCounts?.sent || 0);
    const opened = Number(msgCounts?.opened || 0);
    const averageResponseTime = await this.calculateAverageResponseTime(userId, integrationId);

    // 2. Optimized Time Series (Single Query per Table)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const messageSeries = await db.select({
      day: sql<string>`date_trunc('day', ${messages.createdAt})`,
      sent_email: sql<number>`count(*) filter (where direction = 'outbound' and provider = 'email')`,
      sent_instagram: sql<number>`count(*) filter (where direction = 'outbound' and provider = 'instagram')`,
      opened: sql<number>`count(*) filter (where direction = 'outbound' and opened_at is not null)`,
    })
      .from(messages)
      .where(and(msgWhere, gte(messages.createdAt, startDate)))
      .groupBy(sql`date_trunc('day', ${messages.createdAt})`)
      .orderBy(sql`date_trunc('day', ${messages.createdAt})`);

    const leadSeries = await db.select({
      day: sql<string>`date_trunc('day', ${leads.updatedAt})`,
      replied_email: sql<number>`count(*) filter (where status = 'replied' and channel = 'email')`,
      replied_instagram: sql<number>`count(*) filter (where status = 'replied' and channel = 'instagram')`,
      booked: sql<number>`count(*) filter (where status in ('converted', 'booked'))`
    })
      .from(leads)
      .where(and(leadWhere, gte(leads.updatedAt, startDate)))
      .groupBy(sql`date_trunc('day', ${leads.updatedAt})`)
      .orderBy(sql`date_trunc('day', ${leads.updatedAt})`);

    // Merge Series into final timeSeries array
    const timeSeries = [];
    for (let i = days - 1; i >= 0; i--) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - i);
      targetDate.setHours(0, 0, 0, 0);
      
      const dayStr = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      const msgData = messageSeries.find(m => new Date(m.day).getTime() === targetDate.getTime());
      const leadData = leadSeries.find(l => new Date(l.day).getTime() === targetDate.getTime());

      timeSeries.push({
        name: dayStr,
        sent_email: Number(msgData?.sent_email || 0),
        sent_instagram: Number(msgData?.sent_instagram || 0),
        opened: Number(msgData?.opened || 0),
        replied_email: Number(leadData?.replied_email || 0),
        replied_instagram: Number(leadData?.replied_instagram || 0),
        booked: Number(leadData?.booked || 0)
      });
    }

    // 3. Channel Performance
    const channelStats = await db.select({
      channel: leads.channel,
      value: sql<number>`count(*)`,
    }).from(leads).where(leadWhere).groupBy(leads.channel);

    // 4. Recent Events
    const recentLeads = await db.select({
      id: leads.id,
      name: leads.name,
      status: leads.status,
      updatedAt: leads.updatedAt,
      createdAt: leads.createdAt
    })
      .from(leads)
      .where(leadWhere)
      .orderBy(desc(leads.updatedAt))
      .limit(5);

    return {
      metrics: {
        sent,
        opened,
        replied,
        booked: conversions,
        leadsFiltered: user?.filteredLeadsCount || 0,
        conversionRate: this.calculateRate(conversions, totalLeads) ?? 0,
        responseRate: this.calculateRate(replied, totalLeads) ?? 0,
        openRate: this.calculateRate(opened, sent) ?? 0,
        closedRevenue: Number(Number(dealsStats?.closedRevenue || 0).toFixed(2)),
        pipelineValue: Number((Number(dealsStats?.pipelineValue || 0) + Number(predictedStats?.value || 0)).toFixed(2)),
        averageResponseTime: averageResponseTime
      },
      timeSeries,
      channelPerformance: channelStats.map((s: any) => ({ channel: s.channel || 'Unknown', value: Number(s.value) })),
      recentEvents: recentLeads.map((l: any) => {
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

  // ========== Notification Methods ==========

  async getNotifications(userId: string, opts?: { limit?: number; offset?: number; dateFrom?: Date; dateTo?: Date; integrationId?: string }): Promise<Notification[]> {
    checkDatabase();
    const conditions = [eq(notifications.userId, userId)];
    if (opts?.dateFrom) conditions.push(gte(notifications.createdAt, opts.dateFrom));
    if (opts?.dateTo) conditions.push(lte(notifications.createdAt, opts.dateTo));
    if (opts?.integrationId) {
      // Find leads shared with this integration via campaigns
      const campaignSubquery = db
        .select({ campaignId: leads.integrationId }) // Fallback reference if campaignLeads table metadata is used
        .from(leads)
        .where(eq(leads.integrationId, opts.integrationId));
      
      // Subquery: find leads that share this integration
      // Cast the JSONB-extracted text to UUID to avoid `operator does not exist: text = uuid`
      const metadataLeadId = sql`(${notifications.metadata}->>'leadId')::uuid`;
      conditions.push(
        or(
          eq(notifications.integrationId, opts.integrationId),
          isNull(notifications.integrationId),
          inArray(metadataLeadId, db.select({ id: leads.id }).from(leads).where(eq(leads.integrationId, opts.integrationId)))
        ) as any
      );
    }

    return await db.select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(opts?.limit || 50)
      .offset(opts?.offset || 0);
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    checkDatabase();
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return Number(result[0]?.count || 0);
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    checkDatabase();
    const [notification] = await db.insert(notifications).values({
      ...data,
      integrationId: data.integrationId || (data.metadata as any)?.integrationId || null,
    }).returning();

    if (notification) {
      clusterSync.notifyNotification(data.userId, notification);
    }

    return notification;
  }

  async markNotificationAsRead(id: string, userId?: string): Promise<Notification | undefined> {
    checkDatabase();
    const conditions = [eq(notifications.id, id)];
    if (userId) conditions.push(eq(notifications.userId, userId));

    const [result] = await db.update(notifications)
      .set({ isRead: true })
      .where(and(...conditions))
      .returning();
    return result;
  }

  async markLeadNotificationsAsRead(leadId: string, userId: string): Promise<void> {
    checkDatabase();
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(
        eq(notifications.userId, userId),
        eq(sql`${notifications.metadata}->>'leadId'`, leadId)
      ));

    // Broadcast update so the UI counter drops
    wsSync.notifyNotification(userId, { type: 'update', action: 'read_lead', leadId });
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    checkDatabase();
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId));
  }

  async deleteNotification(id: string, userId: string): Promise<void> {
    checkDatabase();
    await db.delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  }

  async clearAllNotifications(userId: string): Promise<void> {
    checkDatabase();
    await db.delete(notifications)
      .where(eq(notifications.userId, userId));
  }

  // --- Outreach Campaign methods ---

  async getOutreachCampaign(id: string): Promise<OutreachCampaign | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, id)).limit(1);
    return result;
  }

  async createOutreachCampaign(campaign: InsertOutreachCampaign): Promise<OutreachCampaign> {
    checkDatabase();
    const [result] = await db.insert(outreachCampaigns).values(campaign).returning();
    return result;
  }

  async updateOutreachCampaign(id: string, updates: Partial<OutreachCampaign>): Promise<OutreachCampaign | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db
      .update(outreachCampaigns)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(outreachCampaigns.id, id))
      .returning();
    return result;
  }

  async addLeadsToCampaign(campaignId: string, leadsList: { leadId: string }[]): Promise<void> {
    checkDatabase();
    if (leadsList.length === 0) return;
    
    const values = leadsList.map(item => ({
      campaignId,
      leadId: item.leadId,
      status: 'pending' as any,
    }));

    // Using onConflictDoNothing to avoid duplicates if leads are already in the campaign
    await db.insert(campaignLeads).values(values).onConflictDoNothing();
  }

  async getPendingCampaignLeads(campaignId: string): Promise<(CampaignLead & { lead: Lead })[]> {
    checkDatabase();
    const result = await db
      .select({
        campaignLead: campaignLeads,
        lead: leads
      })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .where(and(
        eq(campaignLeads.campaignId, campaignId),
        or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'))
      ));

    return result.map((r: { campaignLead: CampaignLead, lead: Lead }) => ({ ...r.campaignLead, lead: r.lead }));
  }

  async getCampaignLead(campaignId: string, leadId: string): Promise<CampaignLead | undefined> {
    checkDatabase();
    const [result] = await db
      .select()
      .from(campaignLeads)
      .where(and(
        eq(campaignLeads.campaignId, campaignId),
        eq(campaignLeads.leadId, leadId)
      ))
      .limit(1);
    return result;
  }

  async updateCampaignLeadStatus(campaignId: string, leadId: string, status: OutreachCampaignStatus, error?: string): Promise<void> {
    checkDatabase();
    // Look up userId for notifications
    const [cLead] = await db.select({ userId: leads.userId })
      .from(campaignLeads)
      .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
      .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.leadId, leadId)))
      .limit(1);

    await db
      .update(campaignLeads)
      .set({ 
        status: status as any, 
        error: error || null,
        sentAt: status === 'sent' ? new Date() : undefined,
        updatedAt: new Date()
      })
      .where(and(
        eq(campaignLeads.campaignId, campaignId),
        eq(campaignLeads.leadId, leadId)
      ));

    // Real-time notification
    if (cLead?.userId) {
      clusterSync.notifyCampaignStatsUpdated(cLead.userId, campaignId).catch(() => {});
      clusterSync.notifyStatsCacheInvalidate(cLead.userId).catch(() => {});
    }
  }

  async scheduleNextCampaignStep(campaignLeadId: string, nextActionAt: Date): Promise<void> {
    checkDatabase();
    await db.update(campaignLeads)
      .set({ nextActionAt: nextActionAt })
      .where(eq(campaignLeads.id, campaignLeadId));
  }

  // --- Fathom Meeting methods ---
  async getFathomCalls(leadId: string): Promise<FathomCall[]> {
    checkDatabase();
    if (!isValidUUID(leadId)) return [];
    return await db
      .select()
      .from(fathomCalls)
      .where(eq(fathomCalls.leadId, leadId))
      .orderBy(desc(fathomCalls.occurredAt));
  }

  async createFathomCall(call: InsertFathomCall): Promise<FathomCall> {
    checkDatabase();
    const [result] = await db
      .insert(fathomCalls)
      .values({
        ...call,
        occurredAt: call.occurredAt ? new Date(call.occurredAt) : new Date(),
        createdAt: new Date(),
      })
      .returning();
    return result;
  }

  // --- Pending Payment methods ---
  async getPendingPayments(userId: string): Promise<(PendingPayment & { lead: Lead | null })[]> {
    checkDatabase();
    const result = await db
      .select({
        payment: pendingPayments,
        lead: leads
      })
      .from(pendingPayments)
      .leftJoin(leads, eq(pendingPayments.leadId, leads.id))
      .where(eq(pendingPayments.userId, userId))
      .orderBy(desc(pendingPayments.updatedAt));

    return result.map((r: any) => ({
      ...r.payment,
      lead: r.lead
    }));
  }

  async getPendingPayment(id: string): Promise<PendingPayment | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db
      .select()
      .from(pendingPayments)
      .where(eq(pendingPayments.id, id))
      .limit(1);
    return result;
  }

  async createPendingPayment(data: InsertPendingPayment): Promise<PendingPayment> {
    checkDatabase();
    const [result] = await db
      .insert(pendingPayments)
      .values({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return result;
  }

  async updatePendingPayment(id: string, updates: Partial<PendingPayment>): Promise<PendingPayment | undefined> {
    checkDatabase();
    if (!isValidUUID(id)) return undefined;
    const [result] = await db
      .update(pendingPayments)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(pendingPayments.id, id))
      .returning();
    
    if (result) {
      wsSync.notifyLeadsUpdated(result.userId, { event: 'UPDATE', leadId: result.leadId });
    }
    return result;
  }

  async getUsers(): Promise<User[]> {
    return this.getAllUsers();
  }
  async getLeadsList(userId: string): Promise<Lead[]> {
    return this.getLeads({ userId });
  }
  async getLeadById(id: string): Promise<Lead | undefined> {
    return this.getLead(id);
  }
  async getUserById(id: string): Promise<User | undefined> {
    return this.getUser(id);
  }
  async getMessages(userId: string, options?: { limit?: number; channel?: string; integrationId?: string }): Promise<Message[]> {
    return this.getAllMessages(userId, options);
  }

  // Procedural Memory Implementation
  async updateCampaignLeadProceduralMemory(campaignId: string, leadId: string, memory: Record<string, any>): Promise<void> {
    checkDatabase();
    await db.update(campaignLeads)
      .set({ proceduralMemory: memory, updatedAt: new Date() })
      .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.leadId, leadId)));
  }

  async getCampaignLeadProceduralMemory(campaignId: string, leadId: string): Promise<Record<string, any> | undefined> {
    checkDatabase();
    const [result] = await db.select({ proceduralMemory: campaignLeads.proceduralMemory })
      .from(campaignLeads)
      .where(and(eq(campaignLeads.campaignId, campaignId), eq(campaignLeads.leadId, leadId)))
      .limit(1);
    return result?.proceduralMemory as Record<string, any> || undefined;
  }

  async updateCampaignProceduralMemory(campaignId: string, memory: Record<string, any>): Promise<void> {
    checkDatabase();
    await db.update(outreachCampaigns)
      .set({ proceduralMemory: memory, updatedAt: new Date() })
      .where(eq(outreachCampaigns.id, campaignId));
  }
}

// Helper for campaign lead status type (from schema)
type OutreachCampaignStatus = "pending" | "sent" | "failed" | "replied" | "aborted" | "queued";

export const drizzleStorage = new DrizzleStorage();
