"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drizzleStorage = exports.DrizzleStorage = void 0;
const db_js_1 = require("./db.js");
const schema_js_1 = require("../shared/schema.js");
const drizzle_orm_1 = require("drizzle-orm");
const validation_js_1 = require("./lib/utils/validation.js");
const process_1 = require("process");
const websocket_sync_js_1 = require("./lib/websocket-sync.js");
// Function to check if the database connection is available
function checkDatabase() {
    // In a real application, you might want to check a connection pool or a specific connection status.
    // For this example, we'll assume `db` is either configured or not.
    // If `db` is not initialized or has issues, subsequent operations will likely fail,
    // and error handling in those operations should catch it.
    // A more robust check might involve a simple query like `db.execute(sql`SELECT 1`)`.
    if (!db_js_1.db) {
        throw new Error("Database connection is not available.");
    }
}
class DrizzleStorage {
    async createEmailMessage(message) {
        const [newMessage] = await db_js_1.db.insert(schema_js_1.emailMessages).values(message).returning();
        return newMessage;
    }
    async getEmailMessages(userId) {
        checkDatabase();
        return await db_js_1.db.select().from(schema_js_1.emailMessages).where((0, drizzle_orm_1.eq)(schema_js_1.emailMessages.userId, userId));
    }
    async getEmailMessageByMessageId(messageId) {
        checkDatabase();
        const [result] = await db_js_1.db
            .select()
            .from(schema_js_1.emailMessages)
            .where((0, drizzle_orm_1.eq)(schema_js_1.emailMessages.messageId, messageId))
            .limit(1);
        return result;
    }
    async getFollowUpById(id) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(id))
            return undefined;
        const [result] = await db_js_1.db.select().from(schema_js_1.followUpQueue).where((0, drizzle_orm_1.eq)(schema_js_1.followUpQueue.id, id)).limit(1);
        return result;
    }
    async updateFollowUp(id, updates) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(id))
            return undefined;
        const [result] = await db_js_1.db
            .update(schema_js_1.followUpQueue)
            .set({ ...updates, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_js_1.followUpQueue.id, id))
            .returning();
        return result;
    }
    async getDueFollowUps() {
        checkDatabase();
        const now = new Date();
        return await db_js_1.db
            .select()
            .from(schema_js_1.followUpQueue)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.followUpQueue.status, 'pending'), (0, drizzle_orm_1.lte)(schema_js_1.followUpQueue.scheduledAt, now)))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.followUpQueue.scheduledAt));
    }
    async getPendingFollowUp(leadId) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(leadId))
            return undefined;
        const [result] = await db_js_1.db
            .select()
            .from(schema_js_1.followUpQueue)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.followUpQueue.leadId, leadId), (0, drizzle_orm_1.eq)(schema_js_1.followUpQueue.status, 'pending')))
            .limit(1);
        return result;
    }
    async getUser(id) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(id))
            return undefined;
        const result = await db_js_1.db.select().from(schema_js_1.users).where((0, drizzle_orm_1.eq)(schema_js_1.users.id, id)).limit(1);
        return result[0];
    }
    async getUserById(id) {
        checkDatabase();
        return this.getUser(id);
    }
    async getUserByEmail(email) {
        checkDatabase();
        try {
            const result = await db_js_1.db.select().from(schema_js_1.users).where((0, drizzle_orm_1.eq)(schema_js_1.users.email, email)).limit(1);
            return result[0];
        }
        catch (error) {
            console.error("Error in getUserByEmail:", { email, error });
            // Fallback: If 'config' or other columns are missing, we'll try to get basic info
            try {
                const rawResult = await db_js_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, email, password, role, username FROM users WHERE email = ${email} LIMIT 1`);
                if (rawResult.rows && rawResult.rows.length > 0) {
                    const row = rawResult.rows[0];
                    return {
                        id: row.id,
                        email: row.email,
                        password: row.password,
                        role: row.role,
                        username: row.username,
                        config: {},
                        metadata: {},
                        plan: 'trial',
                        subscriptionTier: 'free'
                    };
                }
            }
            catch (fallbackError) {
                console.error("Fallback getUserByEmail also failed:", fallbackError);
            }
            throw error;
        }
    }
    async getUserByUsername(username) {
        checkDatabase();
        const result = await db_js_1.db.select().from(schema_js_1.users).where((0, drizzle_orm_1.eq)(schema_js_1.users.username, username)).limit(1);
        return result[0];
    }
    async getUserBySupabaseId(supabaseId) {
        checkDatabase();
        const result = await db_js_1.db.select().from(schema_js_1.users).where((0, drizzle_orm_1.eq)(schema_js_1.users.supabaseId, supabaseId)).limit(1);
        return result[0];
    }
    async createUser(insertUser) {
        checkDatabase();
        const trialExpiry = new Date();
        trialExpiry.setDate(trialExpiry.getDate() + 3);
        // SECURITY: Always default to 'member' - only elevate to 'admin' if whitelist verified
        // NEVER trust caller-provided role to prevent privilege escalation
        let userRole = 'member';
        try {
            const whitelistCheck = await db_js_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT id FROM admin_whitelist 
        WHERE LOWER(email) = LOWER(${insertUser.email})
          AND status = 'active'
        LIMIT 1
      `);
            if (whitelistCheck.rows && whitelistCheck.rows.length > 0) {
                userRole = 'admin';
                console.log(`[ADMIN] Creating admin user from whitelist: ${insertUser.email}`);
            }
        }
        catch (error) {
            console.error("[ADMIN] Error checking whitelist during user creation:", error);
            // SECURITY: Force 'member' role on whitelist check failure
            userRole = 'member';
        }
        const result = await db_js_1.db
            .insert(schema_js_1.users)
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
            config: {},
        })
            .returning();
        return result[0];
    }
    async updateUser(id, updates) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(id))
            return undefined;
        // If metadata is being updated, merge it with existing metadata instead of overwriting
        if (updates.metadata) {
            const { metadata, ...otherUpdates } = updates;
            // Get current user to merge metadata
            const currentUser = await this.getUser(id);
            if (!currentUser) {
                return undefined;
            }
            // Merge metadata
            const mergedMetadata = {
                ...(currentUser.metadata ?? {}),
                ...metadata,
            };
            const result = await db_js_1.db
                .update(schema_js_1.users)
                .set({
                ...otherUpdates,
                metadata: mergedMetadata,
                updatedAt: new Date()
            })
                .where((0, drizzle_orm_1.eq)(schema_js_1.users.id, id))
                .returning();
            return result[0];
        }
        // Always bump updatedAt for any update
        const result = await db_js_1.db
            .update(schema_js_1.users)
            .set({ ...updates, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_js_1.users.id, id))
            .returning();
        if (result[0]) {
            websocket_sync_js_1.wsSync.notifySettingsUpdated(id, result[0]);
        }
        return result[0];
    }
    async getAllUsers() {
        checkDatabase();
        return await db_js_1.db.select().from(schema_js_1.users);
    }
    async getUsers() {
        return this.getAllUsers();
    }
    async getUserCount() {
        checkDatabase();
        const result = await db_js_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` }).from(schema_js_1.users);
        return Number(result[0].count);
    }
    // --- Organization Methods ---
    async getOrganization(id) {
        checkDatabase();
        const result = await db_js_1.db.select().from(schema_js_1.organizations).where((0, drizzle_orm_1.eq)(schema_js_1.organizations.id, id)).limit(1);
        return result[0];
    }
    async getOrganizationBySlug(slug) {
        checkDatabase();
        const result = await db_js_1.db.select().from(schema_js_1.organizations).where((0, drizzle_orm_1.eq)(schema_js_1.organizations.slug, slug)).limit(1);
        return result[0];
    }
    async getOrganizationsByOwner(ownerId) {
        checkDatabase();
        return await db_js_1.db.select().from(schema_js_1.organizations).where((0, drizzle_orm_1.eq)(schema_js_1.organizations.ownerId, ownerId));
    }
    async createOrganization(org) {
        checkDatabase();
        const result = await db_js_1.db.insert(schema_js_1.organizations).values(org).returning();
        return result[0];
    }
    async updateOrganization(id, updates) {
        checkDatabase();
        const result = await db_js_1.db.update(schema_js_1.organizations).set({ ...updates, updatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_js_1.organizations.id, id)).returning();
        return result[0];
    }
    // --- Team Member Methods ---
    async getTeamMember(orgId, userId) {
        checkDatabase();
        const result = await db_js_1.db.select().from(schema_js_1.teamMembers).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.teamMembers.organizationId, orgId), (0, drizzle_orm_1.eq)(schema_js_1.teamMembers.userId, userId))).limit(1);
        return result[0];
    }
    async getOrganizationMembers(orgId) {
        checkDatabase();
        const result = await db_js_1.db.select({
            member: schema_js_1.teamMembers,
            user: schema_js_1.users
        })
            .from(schema_js_1.teamMembers)
            .innerJoin(schema_js_1.users, (0, drizzle_orm_1.eq)(schema_js_1.teamMembers.userId, schema_js_1.users.id))
            .where((0, drizzle_orm_1.eq)(schema_js_1.teamMembers.organizationId, orgId));
        return result.map((r) => ({ ...r.member, user: r.user }));
    }
    async getUserOrganizations(userId) {
        checkDatabase();
        const result = await db_js_1.db.select({
            org: schema_js_1.organizations,
            role: schema_js_1.teamMembers.role
        })
            .from(schema_js_1.teamMembers)
            .innerJoin(schema_js_1.organizations, (0, drizzle_orm_1.eq)(schema_js_1.teamMembers.organizationId, schema_js_1.organizations.id))
            .where((0, drizzle_orm_1.eq)(schema_js_1.teamMembers.userId, userId));
        return result.map((r) => ({ ...r.org, role: r.role }));
    }
    async addTeamMember(member) {
        checkDatabase();
        const result = await db_js_1.db.insert(schema_js_1.teamMembers).values(member).returning();
        return result[0];
    }
    async removeTeamMember(orgId, userId) {
        checkDatabase();
        await db_js_1.db.delete(schema_js_1.teamMembers).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.teamMembers.organizationId, orgId), (0, drizzle_orm_1.eq)(schema_js_1.teamMembers.userId, userId)));
    }
    async getLeads(options) {
        checkDatabase();
        // Ensure userId is a string, not an object
        const userId = typeof options.userId === 'string' ? options.userId : String(options.userId);
        if (!userId || userId === '[object Object]') {
            throw new Error(`Invalid user ID: ${String(options.userId)}`);
        }
        let conditions = [(0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId)];
        if (!options.includeArchived) {
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.leads.archived, false));
        }
        // Improved Status Filtering logic
        if (options.status === 'warm') {
            // Warm = replied status or engagement score >= 50
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_js_1.leads.status, 'replied'), (0, drizzle_orm_1.gte)(schema_js_1.leads.score, 50)));
        }
        else if (options.status === 'cold') {
            // Cold = status is cold
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.leads.status, 'cold'));
        }
        else if (options.status && options.status !== 'all') {
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.leads.status, options.status));
        }
        if (options.channel) {
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.leads.channel, options.channel));
        }
        if (options.search) {
            const searchPattern = `%${options.search}%`;
            conditions.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_js_1.leads.name, searchPattern), (0, drizzle_orm_1.like)(schema_js_1.leads.email, searchPattern), (0, drizzle_orm_1.like)(schema_js_1.leads.phone, searchPattern), (0, drizzle_orm_1.like)(schema_js_1.leads.company, searchPattern), (0, drizzle_orm_1.like)(schema_js_1.leads.role, searchPattern)));
        }
        let query = db_js_1.db.select().from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.sql) `COALESCE(${schema_js_1.leads.lastMessageAt}, ${schema_js_1.leads.createdAt}) DESC`);
        if (options.limit) {
            query = query.limit(options.limit);
        }
        if (options.offset) {
            query = query.offset(options.offset);
        }
        return await query;
    }
    async getLead(id) {
        checkDatabase();
        // Ensure id is a string, not an object
        const leadId = typeof id === 'string' ? id : String(id);
        if (!(0, validation_js_1.isValidUUID)(leadId) || leadId === '[object Object]') {
            return undefined;
        }
        const result = await db_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, leadId)).limit(1);
        return result[0];
    }
    async getLeadById(id) {
        return this.getLead(id);
    }
    async getLeadByEmail(email, userId) {
        checkDatabase();
        const [result] = await db_js_1.db
            .select()
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.email, email), (0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId)))
            .limit(1);
        return result;
    }
    async getExistingEmails(userId, emails) {
        checkDatabase();
        if (emails.length === 0)
            return [];
        const results = await db_js_1.db
            .select({ email: schema_js_1.leads.email })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.inArray)(schema_js_1.leads.email, emails)));
        return results.map((r) => r.email).filter((e) => !!e);
    }
    async getLeadsCount(userId) {
        checkDatabase();
        const [result] = await db_js_1.db
            .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId));
        return Number(result?.count || 0);
    }
    async getLeadBySocialId(socialId, channel) {
        checkDatabase();
        const [result] = await db_js_1.db
            .select()
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.externalId, socialId), (0, drizzle_orm_1.eq)(schema_js_1.leads.channel, channel)))
            .limit(1);
        return result;
    }
    async createLead(insertLead, options) {
        checkDatabase();
        const result = await db_js_1.db
            .insert(schema_js_1.leads)
            .values({
            userId: insertLead.userId,
            organizationId: insertLead.organizationId || null,
            externalId: insertLead.externalId || null,
            name: insertLead.name,
            company: insertLead.company || null,
            role: insertLead.role || null,
            bio: insertLead.bio || null,
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
            tags: insertLead.tags || [],
            metadata: insertLead.metadata || {},
        })
            .returning();
        if (result[0]) {
            websocket_sync_js_1.wsSync.notifyLeadsUpdated(insertLead.userId, { event: 'INSERT', lead: result[0] });
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
        }
        return result[0];
    }
    async updateLead(id, updates) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(id))
            return undefined;
        // Get old lead for status change detection if status is being updated
        let oldLead;
        if (updates.status) {
            oldLead = await this.getLeadById(id);
        }
        const [result] = await db_js_1.db
            .update(schema_js_1.leads)
            .set({ ...updates, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id))
            .returning();
        if (result) {
            websocket_sync_js_1.wsSync.notifyLeadsUpdated(result.userId, { event: 'UPDATE', lead: result });
            // Trigger notification on status change
            if (oldLead && updates.status && oldLead.status !== updates.status) {
                this.createNotification({
                    userId: result.userId,
                    type: 'lead_status_change',
                    title: '📈 Lead Status Updated',
                    message: `${result.name} moved from ${oldLead.status} to ${updates.status}.`,
                    actionUrl: `/dashboard/leads/${result.id}`
                });
            }
        }
        return result;
    }
    async archiveLead(id, userId, archived) {
        checkDatabase();
        const [result] = await db_js_1.db
            .update(schema_js_1.leads)
            .set({ archived, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id), (0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId)))
            .returning();
        if (result) {
            websocket_sync_js_1.wsSync.notifyLeadsUpdated(userId, { event: 'UPDATE', lead: result });
        }
        return result;
    }
    async deleteLead(id, userId) {
        checkDatabase();
        const [lead] = await db_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id), (0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId))).limit(1);
        if (lead) {
            await db_js_1.db.delete(schema_js_1.leads).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id), (0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId)));
            websocket_sync_js_1.wsSync.notifyLeadsUpdated(userId, { event: 'DELETE', leadId: id });
        }
    }
    async archiveMultipleLeads(ids, userId, archived) {
        checkDatabase();
        await db_js_1.db.update(schema_js_1.leads)
            .set({ archived, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.sql) `${schema_js_1.leads.id} IN ${ids}`));
        websocket_sync_js_1.wsSync.notifyLeadsUpdated(userId, { event: 'BULK_UPDATE', leadIds: ids, updates: { archived } });
    }
    async deleteMultipleLeads(ids, userId) {
        checkDatabase();
        await db_js_1.db.delete(schema_js_1.leads).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.sql) `${schema_js_1.leads.id} IN ${ids}`));
        websocket_sync_js_1.wsSync.notifyLeadsUpdated(userId, { event: 'BULK_DELETE', leadIds: ids });
    }
    async getAuditLogs(userId) {
        checkDatabase();
        return await db_js_1.db
            .select()
            .from(schema_js_1.auditTrail)
            .where((0, drizzle_orm_1.eq)(schema_js_1.auditTrail.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.auditTrail.createdAt))
            .limit(50);
    }
    async getTotalLeadsCount() {
        checkDatabase();
        const result = await db_js_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` }).from(schema_js_1.leads);
        return Number(result[0].count);
    }
    async getMessagesByLeadId(leadId) {
        checkDatabase();
        return await db_js_1.db
            .select()
            .from(schema_js_1.messages)
            .where((0, drizzle_orm_1.eq)(schema_js_1.messages.leadId, leadId))
            .orderBy(schema_js_1.messages.createdAt);
    }
    async getMessages(leadId) {
        checkDatabase();
        return this.getMessagesByLeadId(leadId);
    }
    async getAllMessages(userId, options) {
        checkDatabase();
        // Build conditions array
        const conditions = [(0, drizzle_orm_1.eq)(schema_js_1.messages.userId, userId)];
        if (options?.channel) {
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.messages.provider, options.channel));
        }
        // Build query with combined conditions
        let query = db_js_1.db
            .select()
            .from(schema_js_1.messages)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.messages.createdAt));
        if (options?.limit) {
            return await query.limit(options.limit);
        }
        return await query;
    }
    async createMessage(message) {
        checkDatabase();
        const result = await db_js_1.db
            .insert(schema_js_1.messages)
            .values({
            userId: message.userId,
            leadId: message.leadId,
            threadId: message.threadId,
            direction: message.direction,
            body: message.body,
            provider: message.provider || 'system',
            trackingId: message.trackingId || null,
            openedAt: message.openedAt || null,
            clickedAt: message.clickedAt || null,
            repliedAt: message.repliedAt || null,
            isRead: message.isRead ?? (message.direction === 'outbound'),
            createdAt: new Date(),
            metadata: message.metadata || {},
        })
            .returning();
        if (result[0]) {
            // Update lead's lastMessageAt
            await db_js_1.db.update(schema_js_1.leads)
                .set({
                lastMessageAt: new Date(),
                updatedAt: new Date(),
                snippet: message.body.substring(0, 150).replace(/\n/g, ' '),
                status: message.direction === 'inbound' ? 'replied' : undefined
            })
                .where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, message.leadId));
            // Notify both updates
            websocket_sync_js_1.wsSync.notifyMessagesUpdated(message.userId, { event: 'INSERT', message: result[0] });
            websocket_sync_js_1.wsSync.notifyLeadsUpdated(message.userId, { event: 'UPDATE', leadId: message.leadId });
        }
        return result[0];
    }
    async getOrCreateThread(userId, leadId, subject, providerThreadId) {
        checkDatabase();
        if (providerThreadId) {
            const existing = await db_js_1.db
                .select()
                .from(schema_js_1.threads)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.threads.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.threads.leadId, leadId), (0, drizzle_orm_1.sql) `${schema_js_1.threads.metadata}->>'providerThreadId' = ${providerThreadId}`))
                .limit(1);
            if (existing[0])
                return existing[0];
        }
        const result = await db_js_1.db
            .insert(schema_js_1.threads)
            .values({
            userId,
            leadId,
            subject,
            metadata: providerThreadId ? { providerThreadId } : {},
        })
            .returning();
        return result[0];
    }
    async getThreadsByLeadId(leadId) {
        checkDatabase();
        return await db_js_1.db
            .select()
            .from(schema_js_1.threads)
            .where((0, drizzle_orm_1.eq)(schema_js_1.threads.leadId, leadId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.threads.lastMessageAt));
    }
    async updateThread(id, updates) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(id))
            return undefined;
        const [result] = await db_js_1.db
            .update(schema_js_1.threads)
            .set({ ...updates })
            .where((0, drizzle_orm_1.eq)(schema_js_1.threads.id, id))
            .returning();
        return result;
    }
    async getLeadInsight(leadId) {
        checkDatabase();
        if (!(0, validation_js_1.isValidUUID)(leadId))
            return undefined;
        const [result] = await db_js_1.db
            .select()
            .from(schema_js_1.leadInsights)
            .where((0, drizzle_orm_1.eq)(schema_js_1.leadInsights.leadId, leadId))
            .limit(1);
        return result;
    }
    async upsertLeadInsight(insight) {
        checkDatabase();
        const existing = await this.getLeadInsight(insight.leadId);
        let result;
        if (existing) {
            const [updated] = await db_js_1.db
                .update(schema_js_1.leadInsights)
                .set({ ...insight, lastAnalyzedAt: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_js_1.leadInsights.id, existing.id))
                .returning();
            result = updated;
        }
        else {
            const [inserted] = await db_js_1.db
                .insert(schema_js_1.leadInsights)
                .values({ ...insight, lastAnalyzedAt: new Date() })
                .returning();
            result = inserted;
        }
        if (result) {
            websocket_sync_js_1.wsSync.notifyLeadsUpdated(result.userId, { event: 'UPDATE', leadId: result.leadId });
        }
        return result;
    }
    async updateMessage(id, updates) {
        checkDatabase();
        const [result] = await db_js_1.db
            .update(schema_js_1.messages)
            .set(updates)
            .where((0, drizzle_orm_1.eq)(schema_js_1.messages.id, id))
            .returning();
        if (result) {
            websocket_sync_js_1.wsSync.notifyMessagesUpdated(result.userId, { event: 'UPDATE', message: result });
        }
        return result;
    }
    async getMessageByTrackingId(trackingId) {
        checkDatabase();
        const [result] = await db_js_1.db
            .select()
            .from(schema_js_1.messages)
            .where((0, drizzle_orm_1.eq)(schema_js_1.messages.trackingId, trackingId))
            .limit(1);
        return result;
    }
    async getIntegrations(userId) {
        checkDatabase();
        return await db_js_1.db.select().from(schema_js_1.integrations).where((0, drizzle_orm_1.eq)(schema_js_1.integrations.userId, userId));
    }
    async getIntegration(userId, provider) {
        checkDatabase();
        const result = await db_js_1.db
            .select()
            .from(schema_js_1.integrations)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.integrations.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.integrations.provider, provider)))
            .limit(1);
        return result[0];
    }
    async getIntegrationsByProvider(provider) {
        checkDatabase();
        return await db_js_1.db
            .select()
            .from(schema_js_1.integrations)
            .where((0, drizzle_orm_1.eq)(schema_js_1.integrations.provider, provider));
    }
    async createIntegration(integration) {
        checkDatabase();
        const result = await db_js_1.db
            .insert(schema_js_1.integrations)
            .values({
            userId: integration.userId,
            provider: integration.provider,
            encryptedMeta: integration.encryptedMeta,
            connected: integration.connected ?? true,
            accountType: integration.accountType || null,
            lastSync: integration.lastSync || null,
        })
            .returning();
        return result[0];
    }
    async updateIntegration(userId, provider, updates) {
        checkDatabase();
        const result = await db_js_1.db
            .update(schema_js_1.integrations)
            .set({
            ...updates,
            provider: provider, // Preserve provider to avoid type issues
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.integrations.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.integrations.provider, provider)))
            .returning();
        return result[0];
    }
    async disconnectIntegration(userId, provider) {
        checkDatabase();
        await db_js_1.db
            .delete(schema_js_1.integrations)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.integrations.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.integrations.provider, provider)));
    }
    async deleteIntegration(userId, provider) {
        return this.disconnectIntegration(userId, provider);
    }
    async getVideoMonitors(userId) {
        checkDatabase();
        return await db_js_1.db.select().from(schema_js_1.videoMonitors).where((0, drizzle_orm_1.eq)(schema_js_1.videoMonitors.userId, userId));
    }
    async createVideoMonitor(data) {
        checkDatabase();
        const [result] = await db_js_1.db.insert(schema_js_1.videoMonitors).values(data).returning();
        return result;
    }
    async updateVideoMonitor(id, userId, updates) {
        checkDatabase();
        const [result] = await db_js_1.db.update(schema_js_1.videoMonitors).set(updates).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.videoMonitors.id, id), (0, drizzle_orm_1.eq)(schema_js_1.videoMonitors.userId, userId))).returning();
        return result;
    }
    async deleteVideoMonitor(id, userId) {
        checkDatabase();
        await db_js_1.db.delete(schema_js_1.videoMonitors).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.videoMonitors.id, id), (0, drizzle_orm_1.eq)(schema_js_1.videoMonitors.userId, userId)));
    }
    async isCommentProcessed(commentId) {
        checkDatabase();
        const result = await db_js_1.db.select().from(schema_js_1.processedComments).where((0, drizzle_orm_1.eq)(schema_js_1.processedComments.commentId, commentId)).limit(1);
        return result.length > 0;
    }
    async markCommentProcessed(commentId, status, intentType) {
        checkDatabase();
        await db_js_1.db.insert(schema_js_1.processedComments).values({
            commentId,
            status: status,
            intentType,
            processedAt: new Date()
        });
    }
    async getBrandKnowledge(userId) {
        checkDatabase();
        const result = await db_js_1.db.select().from(schema_js_1.brandEmbeddings)
            .where((0, drizzle_orm_1.eq)(schema_js_1.brandEmbeddings.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.brandEmbeddings.createdAt))
            .limit(10);
        return result.map((r) => r.snippet).join('\n');
    }
    async getLeadByUsername(username, channel) {
        checkDatabase();
        const result = await db_js_1.db
            .select()
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `LOWER(${schema_js_1.leads.name}) = LOWER(${username})`, (0, drizzle_orm_1.eq)(schema_js_1.leads.channel, channel)))
            .limit(1);
        return result[0];
    }
    async getActiveVideoMonitors(userId) {
        checkDatabase();
        try {
            const result = await db_js_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT * FROM video_monitors 
        WHERE user_id = ${userId} AND is_active = true
        ORDER BY created_at DESC
      `);
            return result.rows;
        }
        catch (error) {
            // Return empty array if table doesn't exist yet
            return [];
        }
    }
    async getVideoMonitor(id) {
        checkDatabase();
        try {
            const result = await db_js_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT * FROM video_monitors 
        WHERE id = ${id}
        LIMIT 1
      `);
            return result.rows[0];
        }
        catch (error) {
            return null;
        }
    }
    async getDeals(userId) {
        checkDatabase();
        const result = await db_js_1.db.execute((0, drizzle_orm_1.sql) `
      SELECT d.*, l.name as lead_name 
      FROM deals d
      LEFT JOIN leads l ON d.lead_id = l.id
      WHERE d.user_id = ${userId}
      ORDER BY d.created_at DESC
    `);
        return result.rows;
    }
    async createDeal(data) {
        checkDatabase();
        const result = await db_js_1.db.execute((0, drizzle_orm_1.sql) `
      INSERT INTO deals (user_id, lead_id, title, amount, currency, status, source, metadata)
      VALUES (${data.userId}, ${data.leadId || null}, ${data.title}, ${data.amount}, ${data.currency || 'USD'}, ${data.status || 'open'}, ${data.source || 'manual'}, ${JSON.stringify(data.metadata || {})})
      RETURNING *
    `);
        return result.rows[0];
    }
    async updateDeal(id, userId, updates) {
        checkDatabase();
        const updateData = {};
        if (updates.status) {
            updateData.status = updates.status;
            if (updates.status === 'closed_won' || updates.status === 'closed_lost') {
                updateData.convertedAt = new Date();
            }
        }
        if (updates.amount !== undefined) {
            updateData.value = updates.amount;
        }
        if (Object.keys(updateData).length === 0)
            return null;
        const result = await db_js_1.db
            .update(schema_js_1.deals)
            .set(updateData)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.deals.id, id), (0, drizzle_orm_1.eq)(schema_js_1.deals.userId, userId)))
            .returning();
        return result[0];
    }
    async calculateRevenue(userId) {
        checkDatabase();
        // Use raw SQL to avoid referencing the 'deal_value' column which may not exist in the DB.
        // Only select columns that are guaranteed to exist.
        let allDeals = [];
        try {
            const result = await db_js_1.db.execute((0, drizzle_orm_1.sql) `SELECT id, status, value, converted_at FROM deals WHERE user_id = ${userId}`);
            allDeals = result.rows || result || [];
        }
        catch (e) {
            console.error("Error fetching deals for revenue:", e);
            return { total: 0, thisMonth: 0, deals: [] };
        }
        const closedDeals = allDeals.filter((d) => d.status === 'closed_won');
        const now = new Date();
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const total = closedDeals.reduce((sum, d) => {
            const val = Number(d.value) || 0;
            return sum + val;
        }, 0);
        const thisMonth = closedDeals
            .filter((d) => d.converted_at && new Date(d.converted_at) >= thisMonthStart)
            .reduce((sum, d) => {
            const val = Number(d.value) || 0;
            return sum + val;
        }, 0);
        return { total, thisMonth, deals: closedDeals };
    }
    async createUsageTopup(data) {
        checkDatabase();
        const topup = {
            userId: data.userId,
            type: data.type,
            amount: data.amount,
            metadata: data.metadata || {}
        };
        const result = await db_js_1.db.insert(schema_js_1.usageTopups).values(topup).returning();
        return result[0];
    }
    async getUsageTopups(userId, type) {
        checkDatabase();
        const allTopups = await db_js_1.db
            .select()
            .from(schema_js_1.usageTopups)
            .where((0, drizzle_orm_1.eq)(schema_js_1.usageTopups.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.usageTopups.createdAt));
        // Filter by type in JavaScript since Drizzle has type constraints
        return allTopups.filter((topup) => topup.type === type);
    }
    async getUsageHistory(userId, type) {
        checkDatabase();
        const allHistory = await db_js_1.db
            .select()
            .from(schema_js_1.usageTopups)
            .where((0, drizzle_orm_1.eq)(schema_js_1.usageTopups.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.usageTopups.createdAt));
        if (type) {
            return allHistory.filter((h) => h.type === type);
        }
        return allHistory;
    }
    async getVoiceMinutesBalance(userId) {
        checkDatabase();
        const user = await this.getUserById(userId);
        if (!user)
            return 0;
        const planMinutes = this.getVoiceMinutesForPlan(user.plan);
        const topupMinutes = user.voiceMinutesTopup || 0;
        const usedMinutes = user.voiceMinutesUsed || 0;
        return Math.max(0, planMinutes + topupMinutes - usedMinutes);
    }
    async deductVoiceMinutes(userId, minutes) {
        checkDatabase();
        const balance = await this.getVoiceMinutesBalance(userId);
        if (balance < minutes)
            return false;
        const user = await this.getUserById(userId);
        if (!user)
            return false;
        await this.updateUser(userId, {
            voiceMinutesUsed: (user.voiceMinutesUsed || 0) + minutes
        });
        return true;
    }
    async addVoiceMinutes(userId, minutes, source) {
        checkDatabase();
        const user = await this.getUserById(userId);
        if (!user)
            return;
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
    getVoiceMinutesForPlan(plan) {
        const planMinutes = {
            'starter': parseInt(process_1.default.env.VOICE_MINUTES_PLAN_49 || '300'),
            'pro': parseInt(process_1.default.env.VOICE_MINUTES_PLAN_99 || '800'),
            'enterprise': parseInt(process_1.default.env.VOICE_MINUTES_PLAN_199 || '1000'),
            'trial': 0
        };
        return planMinutes[plan] || 0;
    }
    // Onboarding methods
    async createOnboardingProfile(data) {
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
        const result = await db_js_1.db.insert(schema_js_1.onboardingProfiles).values(profile).returning();
        return result[0];
    }
    async getOnboardingProfile(userId) {
        checkDatabase();
        const result = await db_js_1.db
            .select()
            .from(schema_js_1.onboardingProfiles)
            .where((0, drizzle_orm_1.eq)(schema_js_1.onboardingProfiles.userId, userId))
            .limit(1);
        return result[0];
    }
    async updateOnboardingProfile(userId, updates) {
        const [updated] = await db_js_1.db
            .update(schema_js_1.onboardingProfiles)
            .set({ ...updates, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_js_1.onboardingProfiles.userId, userId))
            .returning();
        if (!updated) {
            throw new Error('Onboarding profile not found');
        }
        return updated;
    }
    async createOtpCode(data) {
        const [otp] = await db_js_1.db.insert(schema_js_1.otpCodes).values({
            ...data,
            purpose: data.purpose || 'login',
        }).returning();
        return otp;
    }
    async getLatestOtpCode(email, purpose) {
        try {
            const normalizedEmail = email.toLowerCase();
            const conditions = [(0, drizzle_orm_1.eq)(schema_js_1.otpCodes.email, normalizedEmail)];
            if (purpose) {
                conditions.push((0, drizzle_orm_1.eq)(schema_js_1.otpCodes.purpose, purpose));
            }
            const result = await db_js_1.db
                .select()
                .from(schema_js_1.otpCodes)
                .where((0, drizzle_orm_1.and)(...conditions))
                .orderBy((0, drizzle_orm_1.desc)(schema_js_1.otpCodes.createdAt))
                .limit(1);
            return result[0] || null;
        }
        catch (error) {
            console.error('Error getting latest OTP code:', error);
            throw error;
        }
    }
    async incrementOtpAttempts(id) {
        await db_js_1.db
            .update(schema_js_1.otpCodes)
            .set({ attempts: (0, drizzle_orm_1.sql) `${schema_js_1.otpCodes.attempts} + 1` })
            .where((0, drizzle_orm_1.eq)(schema_js_1.otpCodes.id, id));
    }
    async markOtpVerified(id) {
        await db_js_1.db
            .update(schema_js_1.otpCodes)
            .set({ verified: true })
            .where((0, drizzle_orm_1.eq)(schema_js_1.otpCodes.id, id));
    }
    async cleanupDemoData() {
        checkDatabase();
        // Delete all users with @demo.com email (used by seeder)
        const result = await db_js_1.db.delete(schema_js_1.users)
            .where((0, drizzle_orm_1.like)(schema_js_1.users.email, '%@demo.com'))
            .returning();
        console.log(`🧹 Demo Data Cleanup: Deleted ${result.length} demo users`);
        return { deletedUsers: result.length };
    }
    // ========== Follow Up Queue ==========
    async createFollowUp(data) {
        checkDatabase();
        const [result] = await db_js_1.db.insert(schema_js_1.followUpQueue).values(data).returning();
        return result;
    }
    async updateFollowUpStatus(id, status, errorMessage) {
        checkDatabase();
        const updateData = { status, processedAt: new Date() };
        if (errorMessage !== undefined)
            updateData.errorMessage = errorMessage;
        // Validate status against enum if enforcing strict types, or cast as any if dynamic
        const [updated] = await db_js_1.db
            .update(schema_js_1.followUpQueue)
            .set(updateData)
            .where((0, drizzle_orm_1.eq)(schema_js_1.followUpQueue.id, id))
            .returning();
        return updated;
    }
    // ========== OAuth Accounts ==========
    async getOAuthAccount(userId, provider) {
        checkDatabase();
        const [account] = await db_js_1.db
            .select()
            .from(schema_js_1.oauthAccounts)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.oauthAccounts.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.oauthAccounts.provider, provider)));
        return account;
    }
    async getSoonExpiringOAuthAccounts(provider, thresholdMinutes) {
        checkDatabase();
        const threshold = new Date(Date.now() + thresholdMinutes * 60 * 1000);
        const accounts = await db_js_1.db.select()
            .from(schema_js_1.oauthAccounts)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.oauthAccounts.provider, provider), (0, drizzle_orm_1.lte)(schema_js_1.oauthAccounts.expiresAt, threshold)));
        return accounts;
    }
    async saveOAuthAccount(data) {
        checkDatabase();
        const existing = await this.getOAuthAccount(data.userId, data.provider);
        if (existing) {
            const [updated] = await db_js_1.db
                .update(schema_js_1.oauthAccounts)
                .set({ ...data, updatedAt: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_js_1.oauthAccounts.id, existing.id))
                .returning();
            return updated;
        }
        else {
            const [created] = await db_js_1.db
                .insert(schema_js_1.oauthAccounts)
                .values(data)
                .returning();
            return created;
        }
    }
    async deleteOAuthAccount(userId, provider) {
        checkDatabase();
        await db_js_1.db.delete(schema_js_1.oauthAccounts)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.oauthAccounts.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.oauthAccounts.provider, provider)));
    }
    async getAnalyticsSummary(userId, startDate) {
        checkDatabase();
        const [mainSummary] = await db_js_1.db.select({
            totalLeads: (0, drizzle_orm_1.sql) `count(*)`,
            conversions: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('converted', 'booked'))`,
            active: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('open', 'replied', 'warm'))`,
            ghosted: (0, drizzle_orm_1.sql) `count(*) filter (where status = 'cold')`,
            notInterested: (0, drizzle_orm_1.sql) `count(*) filter (where status = 'not_interested')`,
            leadsReplied: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('replied', 'converted', 'booked', 'warm'))`,
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.createdAt, startDate)));
        const statusResults = await db_js_1.db.select({
            status: schema_js_1.leads.status,
            count: (0, drizzle_orm_1.sql) `count(*)`,
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.createdAt, startDate)))
            .groupBy(schema_js_1.leads.status);
        const channelResults = await db_js_1.db.select({
            channel: schema_js_1.leads.channel,
            count: (0, drizzle_orm_1.sql) `count(*)`,
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.createdAt, startDate)))
            .groupBy(schema_js_1.leads.channel);
        const hourResults = await db_js_1.db.select({
            hour: (0, drizzle_orm_1.sql) `extract(hour from last_message_at)`,
            count: (0, drizzle_orm_1.sql) `count(*)`,
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.createdAt, startDate), (0, drizzle_orm_1.not)((0, drizzle_orm_1.isNull)(schema_js_1.leads.lastMessageAt))))
            .groupBy((0, drizzle_orm_1.sql) `extract(hour from last_message_at)`)
            .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.sql) `count(*)`))
            .limit(1);
        const timelineResults = await db_js_1.db.select({
            date: (0, drizzle_orm_1.sql) `to_char(created_at, 'YYYY-MM-DD')`,
            leads: (0, drizzle_orm_1.sql) `count(*)`,
            conversions: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('converted', 'booked'))`,
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.createdAt, startDate)))
            .groupBy((0, drizzle_orm_1.sql) `to_char(created_at, 'YYYY-MM-DD')`)
            .orderBy((0, drizzle_orm_1.sql) `to_char(created_at, 'YYYY-MM-DD')`);
        const total = Number(mainSummary?.totalLeads || 0);
        const conversions = Number(mainSummary?.conversions || 0);
        // Sentiment calculation
        const [sentimentSummary] = await db_js_1.db.select({
            positive: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('replied', 'converted', 'booked', 'open', 'warm'))`,
            negative: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('not_interested', 'cold'))`,
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.createdAt, startDate)));
        const positiveCount = Number(sentimentSummary?.positive || 0);
        const negativeCount = Number(sentimentSummary?.negative || 0);
        const totalWithSentiment = positiveCount + negativeCount;
        const positiveSentimentRate = totalWithSentiment > 0
            ? ((positiveCount / totalWithSentiment) * 100).toFixed(1)
            : '0';
        return {
            summary: {
                totalLeads: total,
                conversions,
                conversionRate: total > 0 ? ((conversions / total) * 100).toFixed(1) : '0',
                active: Number(mainSummary?.active || 0),
                ghosted: Number(mainSummary?.ghosted || 0),
                notInterested: Number(mainSummary?.notInterested || 0),
                leadsReplied: Number(mainSummary?.leadsReplied || 0),
                bestReplyHour: hourResults[0] ? Number(hourResults[0].hour) : null,
            },
            channelBreakdown: channelResults.map((c) => ({
                channel: c.channel,
                count: Number(c.count),
                percentage: total > 0 ? (Number(c.count) / total) * 100 : 0
            })),
            statusBreakdown: statusResults.map((s) => ({
                status: s.status,
                count: Number(s.count),
                percentage: total > 0 ? (Number(s.count) / total) * 100 : 0
            })),
            timeline: timelineResults.map((t) => ({
                date: t.date,
                leads: Number(t.leads),
                conversions: Number(t.conversions)
            })),
            positiveSentimentRate
        };
    }
    async createCalendarEvent(data) {
        checkDatabase();
        const [result] = await db_js_1.db.insert(schema_js_1.calendarEvents).values(data).returning();
        if (result) {
            websocket_sync_js_1.wsSync.notifyCalendarUpdated(data.userId, { event: 'INSERT', eventData: result });
        }
        return result;
    }
    async getCalendarEvents(userId) {
        checkDatabase();
        return await db_js_1.db
            .select()
            .from(schema_js_1.calendarEvents)
            .where((0, drizzle_orm_1.eq)(schema_js_1.calendarEvents.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.calendarEvents.startTime));
    }
    // ========== Audit Trail ==========
    async createAuditLog(data) {
        checkDatabase();
        const [result] = await db_js_1.db.insert(schema_js_1.auditTrail).values(data).returning();
        return result;
    }
    // ========== AI Learning Patterns ==========
    async getLearningPatterns(userId) {
        checkDatabase();
        try {
            const results = await db_js_1.db
                .select()
                .from(schema_js_1.aiLearningPatterns)
                .where((0, drizzle_orm_1.eq)(schema_js_1.aiLearningPatterns.userId, userId));
            return results;
        }
        catch (error) {
            console.warn('getLearningPatterns: table may not exist, returning empty array');
            return [];
        }
    }
    async recordLearningPattern(userId, key, success) {
        checkDatabase();
        try {
            const existing = await db_js_1.db
                .select()
                .from(schema_js_1.aiLearningPatterns)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.aiLearningPatterns.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.aiLearningPatterns.patternKey, key)))
                .limit(1);
            if (existing.length > 0) {
                const newStrength = success ? existing[0].strength + 1 : Math.max(0, existing[0].strength - 1);
                await db_js_1.db
                    .update(schema_js_1.aiLearningPatterns)
                    .set({ strength: newStrength, lastUsedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_js_1.aiLearningPatterns.id, existing[0].id));
            }
            else {
                await db_js_1.db.insert(schema_js_1.aiLearningPatterns).values({
                    userId,
                    patternKey: key,
                    strength: success ? 1 : 0,
                    metadata: {},
                    lastUsedAt: new Date(),
                });
            }
        }
        catch (error) {
            console.error('Error recording learning pattern:', error);
        }
    }
    async getRecentBounces(userId, hours = 168) {
        checkDatabase();
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        try {
            return await db_js_1.db
                .select()
                .from(schema_js_1.bounceTracker)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.bounceTracker.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.bounceTracker.createdAt, since)))
                .orderBy((0, drizzle_orm_1.desc)(schema_js_1.bounceTracker.createdAt));
        }
        catch (error) {
            console.warn('getRecentBounces: table may not exist');
            return [];
        }
    }
    async getDomainVerifications(userId, limit = 10) {
        checkDatabase();
        try {
            const result = await db_js_1.db.execute((0, drizzle_orm_1.sql) `
        SELECT domain, verification_result, created_at
        FROM domain_verifications
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `);
            return result.rows || [];
        }
        catch (e) {
            return [];
        }
    }
    async getSmtpSettings(userId) {
        checkDatabase();
        return await db_js_1.db.select().from(schema_js_1.smtpSettings).where((0, drizzle_orm_1.eq)(schema_js_1.smtpSettings.userId, userId));
    }
    async createPayment(data) {
        checkDatabase();
        const result = await db_js_1.db
            .insert(schema_js_1.payments)
            .values(data)
            .returning();
        return result[0];
    }
    async getPayments(userId) {
        checkDatabase();
        return await db_js_1.db.select().from(schema_js_1.payments).where((0, drizzle_orm_1.eq)(schema_js_1.payments.userId, userId)).orderBy((0, drizzle_orm_1.desc)(schema_js_1.payments.createdAt));
    }
    async getPaymentById(id) {
        checkDatabase();
        const [result] = await db_js_1.db.select().from(schema_js_1.payments).where((0, drizzle_orm_1.eq)(schema_js_1.payments.id, id)).limit(1);
        return result;
    }
    async updatePayment(id, updates) {
        checkDatabase();
        const [result] = await db_js_1.db.update(schema_js_1.payments).set({ ...updates, updatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_js_1.payments.id, id)).returning();
        return result;
    }
    async getDashboardStats(userId, overrideDates) {
        checkDatabase();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        const leadsBaseWhere = overrideDates
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.createdAt, overrideDates.start), (0, drizzle_orm_1.lte)(schema_js_1.leads.createdAt, overrideDates.end))
            : (0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId);
        const messagesBaseWhere = overrideDates
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.messages.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.messages.createdAt, overrideDates.start), (0, drizzle_orm_1.lte)(schema_js_1.messages.createdAt, overrideDates.end))
            : (0, drizzle_orm_1.eq)(schema_js_1.messages.userId, userId);
        const dealsBaseWhere = overrideDates
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.deals.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.deals.createdAt, overrideDates.start), (0, drizzle_orm_1.lte)(schema_js_1.deals.createdAt, overrideDates.end))
            : (0, drizzle_orm_1.eq)(schema_js_1.deals.userId, userId);
        const [leadsStats] = await db_js_1.db.select({
            totalLeads: (0, drizzle_orm_1.sql) `count(*)`,
            newLeads: (0, drizzle_orm_1.sql) `count(*) filter (where ${schema_js_1.leads.createdAt} >= ${sevenDaysAgo})`,
            activeLeads: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('open', 'replied', 'warm'))`,
            convertedLeads: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('converted', 'booked'))`,
            hardenedLeads: (0, drizzle_orm_1.sql) `count(*) filter (where verified = true)`,
            bouncyLeads: (0, drizzle_orm_1.sql) `count(*) filter (where status = 'bouncy')`,
            recoveredLeads: (0, drizzle_orm_1.sql) `count(*) filter (where status = 'recovered')`,
            queuedLeads: (0, drizzle_orm_1.sql) `count(*) filter (where status = 'new' and ai_paused = false)`,
        })
            .from(schema_js_1.leads)
            .where(leadsBaseWhere);
        const [messagesStats] = await db_js_1.db.select({
            totalSent: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'outbound')`,
            opened: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'outbound' and opened_at is not null)`,
            replied: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'inbound')`,
            messagesToday: (0, drizzle_orm_1.sql) `count(*) filter (where ${schema_js_1.messages.createdAt} >= ${todayStart} and direction = 'outbound')`,
            messagesYesterday: (0, drizzle_orm_1.sql) `count(*) filter (where ${schema_js_1.messages.createdAt} >= ${yesterdayStart} and ${schema_js_1.messages.createdAt} < ${todayStart} and direction = 'outbound')`,
            positiveIntents: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'inbound' and (lower(body) like '%yes%' or lower(body) like '%book%' or lower(body) like '%interested%' or lower(body) like '%call%' or lower(body) like '%meeting%'))`,
        })
            .from(schema_js_1.messages)
            .where(messagesBaseWhere);
        const [dealsStats] = await db_js_1.db.select({
            pipelineValue: (0, drizzle_orm_1.sql) `coalesce(sum(case when status = 'open' then value else 0 end), 0)`,
            closedRevenue: (0, drizzle_orm_1.sql) `coalesce(sum(case when status in ('converted', 'closed_won') then value else 0 end), 0)`,
        })
            .from(schema_js_1.deals)
            .where(dealsBaseWhere);
        // Calculate predicted deal value from leads without explicit deals
        const [predictedStats] = await db_js_1.db.select({
            value: (0, drizzle_orm_1.sql) `coalesce(sum(cast(metadata->'intelligence'->'predictions'->>'predictedAmount' as numeric)), 0)`
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)(leadsBaseWhere, (0, drizzle_orm_1.sql) `metadata->'intelligence'->'predictions'->>'predictedAmount' is not null`, (0, drizzle_orm_1.sql) `not exists (select 1 from deals where deals.lead_id = leads.id)`));
        const averageResponseTime = await this.calculateAverageResponseTime(userId);
        return {
            totalLeads: Number(leadsStats?.totalLeads || 0),
            newLeads: Number(leadsStats?.newLeads || 0),
            activeLeads: Number(leadsStats?.activeLeads || 0),
            convertedLeads: Number(leadsStats?.convertedLeads || 0),
            hardenedLeads: Number(leadsStats?.hardenedLeads || 0),
            bouncyLeads: Number(leadsStats?.bouncyLeads || 0),
            recoveredLeads: Number(leadsStats?.recoveredLeads || 0),
            positiveIntents: Number(messagesStats?.positiveIntents || 0),
            totalMessages: Number(messagesStats?.totalSent || 0),
            messagesToday: Number(messagesStats?.messagesToday || 0),
            messagesYesterday: Number(messagesStats?.messagesYesterday || 0),
            pipelineValue: Number(dealsStats?.pipelineValue || 0) + Number(predictedStats?.value || 0),
            closedRevenue: Number(dealsStats?.closedRevenue || 0),
            openRate: Number(messagesStats?.totalSent || 0) > 0 ? Math.round((Number(messagesStats?.opened || 0) / Number(messagesStats?.totalSent || 0)) * 100) : 0,
            responseRate: Number(leadsStats?.totalLeads || 0) > 0 ? Math.round((Number(messagesStats?.replied || 0) / Number(leadsStats?.totalLeads || 0)) * 100) : 0,
            averageResponseTime,
            queuedLeads: Number(leadsStats?.queuedLeads || 0),
            undeliveredLeads: Number(leadsStats?.bouncyLeads || 0),
        };
    }
    async calculateAverageResponseTime(userId) {
        const result = await db_js_1.db.execute((0, drizzle_orm_1.sql) `
      WITH response_times AS (
        SELECT 
          m2.created_at - m1.created_at as duration
        FROM messages m1
        JOIN messages m2 ON m1.lead_id = m2.lead_id
        WHERE m1.direction = 'outbound'
          AND m2.direction = 'inbound'
          AND m2.created_at > m1.created_at
          AND m1.user_id = ${userId}
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
        if (avgSeconds <= 0)
            return '—';
        if (avgSeconds < 3600) {
            return `${Math.round(avgSeconds / 60)}m`;
        }
        else if (avgSeconds < 86400) {
            return `${(avgSeconds / 3600).toFixed(1)}h`;
        }
        else {
            return `${(avgSeconds / 86400).toFixed(1)}d`;
        }
    }
    async getAnalyticsFull(userId, days) {
        checkDatabase();
        // 1. Basic Metrics
        const [counts] = await db_js_1.db.select({
            totalLeads: (0, drizzle_orm_1.sql) `count(*)`,
            conversions: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('converted', 'booked'))`,
            replied: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('replied', 'converted', 'booked', 'warm'))`,
        }).from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId));
        const [msgCounts] = await db_js_1.db.select({
            sent: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'outbound')`,
            opened: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'outbound' and opened_at is not null)`,
        }).from(schema_js_1.messages).where((0, drizzle_orm_1.eq)(schema_js_1.messages.userId, userId));
        const [dealsStats] = await db_js_1.db.select({
            pipelineValue: (0, drizzle_orm_1.sql) `coalesce(sum(value), 0)`,
            closedRevenue: (0, drizzle_orm_1.sql) `coalesce(sum(case when status = 'closed_won' then value else 0 end), 0)`,
        }).from(schema_js_1.deals).where((0, drizzle_orm_1.eq)(schema_js_1.deals.userId, userId));
        const [predictedStats] = await db_js_1.db.select({
            value: (0, drizzle_orm_1.sql) `coalesce(sum(cast(metadata->'intelligence'->'predictions'->>'predictedAmount' as numeric)), 0)`
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.sql) `metadata->'intelligence'->'predictions'->>'predictedAmount' is not null`, (0, drizzle_orm_1.sql) `not exists (select 1 from deals where deals.lead_id = leads.id)`));
        const [user] = await db_js_1.db.select({
            filteredLeadsCount: schema_js_1.users.filteredLeadsCount
        }).from(schema_js_1.users).where((0, drizzle_orm_1.eq)(schema_js_1.users.id, userId)).limit(1);
        const totalLeads = Number(counts?.totalLeads || 0);
        const conversions = Number(counts?.conversions || 0);
        const replied = Number(counts?.replied || 0);
        const sent = Number(msgCounts?.sent || 0);
        const opened = Number(msgCounts?.opened || 0);
        const averageResponseTime = await this.calculateAverageResponseTime(userId);
        // 2. Time Series
        // We'll calculate this in JS loop but using targeted SQL counts to avoid loading all objects
        const timeSeries = [];
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const dayStart = new Date(date);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(date);
            dayEnd.setHours(23, 59, 59, 999);
            const [dayMsg] = await db_js_1.db.select({
                sent_email: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'outbound' and provider = 'email')`,
                sent_instagram: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'outbound' and provider = 'instagram')`,
                opened: (0, drizzle_orm_1.sql) `count(*) filter (where direction = 'outbound' and opened_at is not null)`,
            }).from(schema_js_1.messages).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.messages.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.messages.createdAt, dayStart), (0, drizzle_orm_1.lte)(schema_js_1.messages.createdAt, dayEnd)));
            const [dayLeads] = await db_js_1.db.select({
                replied_email: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('replied', 'converted', 'booked', 'warm') and channel = 'email')`,
                replied_instagram: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('replied', 'converted', 'booked', 'warm') and channel = 'instagram')`,
                booked: (0, drizzle_orm_1.sql) `count(*) filter (where status in ('converted', 'booked'))`
            }).from(schema_js_1.leads).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId), (0, drizzle_orm_1.gte)(schema_js_1.leads.updatedAt, dayStart), (0, drizzle_orm_1.lte)(schema_js_1.leads.updatedAt, dayEnd)));
            timeSeries.push({
                name: dayStr,
                sent_email: Number(dayMsg?.sent_email || 0),
                sent_instagram: Number(dayMsg?.sent_instagram || 0),
                opened: Number(dayMsg?.opened || 0),
                replied_email: Number(dayLeads?.replied_email || 0),
                replied_instagram: Number(dayLeads?.replied_instagram || 0),
                booked: Number(dayLeads?.booked || 0)
            });
        }
        // 3. Channel Performance
        const channelStats = await db_js_1.db.select({
            channel: schema_js_1.leads.channel,
            value: (0, drizzle_orm_1.sql) `count(*)`,
        }).from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId)).groupBy(schema_js_1.leads.channel);
        // 4. Recent Events
        const recentLeads = await db_js_1.db.select({
            id: schema_js_1.leads.id,
            name: schema_js_1.leads.name,
            status: schema_js_1.leads.status,
            updatedAt: schema_js_1.leads.updatedAt,
            createdAt: schema_js_1.leads.createdAt
        })
            .from(schema_js_1.leads)
            .where((0, drizzle_orm_1.eq)(schema_js_1.leads.userId, userId))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.leads.updatedAt))
            .limit(5);
        return {
            metrics: {
                sent,
                opened,
                replied,
                booked: conversions,
                leadsFiltered: user?.filteredLeadsCount || 0,
                conversionRate: totalLeads > 0 ? Math.round((conversions / totalLeads) * 100) : 0,
                responseRate: totalLeads > 0 ? Math.round((replied / totalLeads) * 100) : 0,
                openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
                closedRevenue: Number(dealsStats?.closedRevenue || 0),
                pipelineValue: Number(dealsStats?.pipelineValue || 0) + Number(predictedStats?.value || 0),
                averageResponseTime: averageResponseTime
            },
            timeSeries,
            channelPerformance: channelStats.map((s) => ({ channel: s.channel || 'Unknown', value: Number(s.value) })),
            recentEvents: recentLeads.map((l) => {
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
    async getNotifications(userId, opts) {
        checkDatabase();
        const conditions = [(0, drizzle_orm_1.eq)(schema_js_1.notifications.userId, userId)];
        if (opts?.dateFrom)
            conditions.push((0, drizzle_orm_1.gte)(schema_js_1.notifications.createdAt, opts.dateFrom));
        if (opts?.dateTo)
            conditions.push((0, drizzle_orm_1.lte)(schema_js_1.notifications.createdAt, opts.dateTo));
        return await db_js_1.db.select()
            .from(schema_js_1.notifications)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_js_1.notifications.createdAt))
            .limit(opts?.limit || 50)
            .offset(opts?.offset || 0);
    }
    async getUnreadNotificationCount(userId) {
        checkDatabase();
        const result = await db_js_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_js_1.notifications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.notifications.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.notifications.isRead, false)));
        return Number(result[0]?.count || 0);
    }
    async createNotification(data) {
        checkDatabase();
        const [notification] = await db_js_1.db.insert(schema_js_1.notifications).values(data).returning();
        if (notification) {
            websocket_sync_js_1.wsSync.notifyNotification(data.userId, notification);
            websocket_sync_js_1.wsSync.broadcastToUser(data.userId, { type: 'notification', payload: notification });
        }
        return notification;
    }
    async markNotificationAsRead(id, userId) {
        checkDatabase();
        const conditions = [(0, drizzle_orm_1.eq)(schema_js_1.notifications.id, id)];
        if (userId)
            conditions.push((0, drizzle_orm_1.eq)(schema_js_1.notifications.userId, userId));
        await db_js_1.db.update(schema_js_1.notifications)
            .set({ isRead: true })
            .where((0, drizzle_orm_1.and)(...conditions));
    }
    async markLeadNotificationsAsRead(leadId, userId) {
        checkDatabase();
        await db_js_1.db.update(schema_js_1.notifications)
            .set({ isRead: true })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.notifications.userId, userId), (0, drizzle_orm_1.eq)((0, drizzle_orm_1.sql) `${schema_js_1.notifications.metadata}->>'leadId'`, leadId)));
        // Broadcast update so the UI counter drops
        websocket_sync_js_1.wsSync.notifyNotification(userId, { type: 'update', action: 'read_lead', leadId });
    }
    async markAllNotificationsAsRead(userId) {
        checkDatabase();
        await db_js_1.db.update(schema_js_1.notifications)
            .set({ isRead: true })
            .where((0, drizzle_orm_1.eq)(schema_js_1.notifications.userId, userId));
    }
    async deleteNotification(id, userId) {
        checkDatabase();
        await db_js_1.db.delete(schema_js_1.notifications)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.notifications.id, id), (0, drizzle_orm_1.eq)(schema_js_1.notifications.userId, userId)));
    }
    async clearAllNotifications(userId) {
        checkDatabase();
        await db_js_1.db.delete(schema_js_1.notifications)
            .where((0, drizzle_orm_1.eq)(schema_js_1.notifications.userId, userId));
    }
}
exports.DrizzleStorage = DrizzleStorage;
exports.drizzleStorage = new DrizzleStorage();
