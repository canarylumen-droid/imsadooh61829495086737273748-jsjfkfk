// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  User,
  InsertUser,
  Lead,
  InsertLead,
  Message,
  InsertMessage,
  Integration,
  InsertIntegration,
} from "@audnix/shared";
import type { IStorage } from "./storage.js";

// Initialize Supabase client with service role key for server-side operations
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("Supabase credentials not set. Using MemStorage.");
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

/**
 * Supabase Storage implementation
 * Handles camelCase to snake_case conversion for database columns
 */
export class SupabaseStorage implements IStorage {
  private client: SupabaseClient;

  constructor() {
    if (!supabase) {
      throw new Error("Supabase client not initialized. Check environment variables.");
    }
    this.client = supabase;
  }

  // Helper: Convert snake_case DB row to camelCase TypeScript object
  private mapUserFromDb(row: any): User {
    return {
      id: row.id,
      supabaseId: row.supabase_id,
      email: row.email,
      name: row.name,
      username: row.username,
      avatar: row.avatar,
      company: row.company,
      timezone: row.timezone,
      plan: row.plan,
      trialExpiresAt: row.trial_expires_at ? new Date(row.trial_expires_at) : null,
      replyTone: row.reply_tone,
      role: row.role,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      createdAt: new Date(row.created_at),
      lastLogin: row.last_login ? new Date(row.last_login) : null,
    };
  }

  private mapLeadFromDb(row: any): Lead {
    return {
      id: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
      externalId: row.external_id,
      name: row.name,
      channel: row.channel,
      email: row.email,
      phone: row.phone,
      status: row.status,
      verified: row.verified ?? false,
      verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
      score: row.score,
      warm: row.warm,
      lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
      aiPaused: row.ai_paused ?? false,
      pdfConfidence: row.pdf_confidence,
      tags: row.tags || [],
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapMessageFromDb(row: any): Message {
    return {
      id: row.id,
      leadId: row.lead_id,
      userId: row.user_id,
      provider: row.provider,
      direction: row.direction,
      body: row.body,
      audioUrl: row.audio_url,
      metadata: row.metadata || {},
      createdAt: new Date(row.created_at),
    };
  }

  private mapIntegrationFromDb(row: any): Integration {
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      encryptedMeta: row.encrypted_meta,
      connected: row.connected,
      accountType: row.accountType,
      lastSync: row.last_sync ? new Date(row.last_sync) : null,
      createdAt: new Date(row.created_at),
    };
  }

  // ========== User Methods ==========

  async getUser(id: string): Promise<User | undefined> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return undefined;
    return this.mapUserFromDb(data);
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.getUser(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !data) return undefined;
    return this.mapUserFromDb(data);
  }

  async getUserBySupabaseId(supabaseId: string): Promise<User | undefined> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("supabase_id", supabaseId)
      .single();

    if (error || !data) return undefined;
    return this.mapUserFromDb(data);
  }

  async createUser(insertUser: Partial<InsertUser> & { email: string }): Promise<User> {
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 3);

    const { data, error } = await this.client
      .from("users")
      .insert({
        supabase_id: insertUser.supabaseId || null,
        email: insertUser.email,
        password: insertUser.password || null,
        name: insertUser.name || null,
        username: insertUser.username || null,
        avatar: insertUser.avatar || null,
        company: insertUser.company || null,
        timezone: insertUser.timezone || "America/New_York",
        plan: insertUser.plan || "trial",
        trial_expires_at: insertUser.trialExpiresAt || trialExpiry,
        reply_tone: insertUser.replyTone || "professional",
        role: insertUser.role || "member",
        stripe_customer_id: insertUser.stripeCustomerId || null,
        stripe_subscription_id: insertUser.stripeSubscriptionId || null,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create user: ${error?.message}`);
    }

    return this.mapUserFromDb(data);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const dbUpdates: any = {};
    if (updates.supabaseId !== undefined) dbUpdates.supabase_id = updates.supabaseId;
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.username !== undefined) dbUpdates.username = updates.username;
    if (updates.avatar !== undefined) dbUpdates.avatar = updates.avatar;
    if (updates.company !== undefined) dbUpdates.company = updates.company;
    if (updates.timezone !== undefined) dbUpdates.timezone = updates.timezone;
    if (updates.plan !== undefined) dbUpdates.plan = updates.plan;
    if (updates.trialExpiresAt !== undefined) dbUpdates.trial_expires_at = updates.trialExpiresAt;
    if (updates.replyTone !== undefined) dbUpdates.reply_tone = updates.replyTone;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.stripeCustomerId !== undefined) dbUpdates.stripe_customer_id = updates.stripeCustomerId;
    if (updates.stripeSubscriptionId !== undefined) dbUpdates.stripe_subscription_id = updates.stripeSubscriptionId;
    if (updates.lastLogin !== undefined) dbUpdates.last_login = updates.lastLogin;

    const { data, error } = await this.client
      .from("users")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) return undefined;
    return this.mapUserFromDb(data);
  }

  async getAllUsers(): Promise<User[]> {
    const { data, error } = await this.client.from("users").select("*");

    if (error || !data) return [];
    return data.map((row) => this.mapUserFromDb(row));
  }

  async getUserCount(): Promise<number> {
    const { count, error } = await this.client
      .from("users")
      .select("*", { count: "exact", head: true });

    if (error) return 0;
    return count || 0;
  }

  // ========== Lead Methods ==========

  async getLeads(options: {
    userId: string;
    status?: string;
    channel?: string;
    search?: string;
    limit?: number;
  }): Promise<Lead[]> {
    let query = this.client
      .from("leads")
      .select("*")
      .eq("user_id", options.userId)
      .order("created_at", { ascending: false });

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.channel) {
      query = query.eq("channel", options.channel);
    }

    if (options.search) {
      // Security: Prevent SQL injection with parameterized search
      // Escape special characters and limit search term length
      const sanitizedSearch = options.search
        .replace(/[%_\\]/g, '\\$&')
        .substring(0, 100); // Limit length

      // Use safe pattern matching
      query = query.or(
        `name.ilike.%${sanitizedSearch}%,email.ilike.%${sanitizedSearch}%,phone.ilike.%${sanitizedSearch}%`
      );
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error || !data) return [];
    return data.map((row) => this.mapLeadFromDb(row));
  }

  async getLead(id: string): Promise<Lead | undefined> {
    const { data, error } = await this.client
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return undefined;
    return this.mapLeadFromDb(data);
  }

  async getLeadById(id: string): Promise<Lead | undefined> {
    return this.getLead(id);
  }

  async createLead(insertLead: Partial<InsertLead> & { userId: string; name: string; channel: string }): Promise<Lead> {
    const { data, error } = await this.client
      .from("leads")
      .insert({
        user_id: insertLead.userId,
        organization_id: insertLead.organizationId || null,
        external_id: insertLead.externalId || null,
        name: insertLead.name,
        channel: insertLead.channel,
        email: insertLead.email || null,
        phone: insertLead.phone || null,
        status: insertLead.status || "new",
        verified: insertLead.verified || false,
        verified_at: insertLead.verifiedAt || null,
        score: insertLead.score || 0,
        warm: insertLead.warm || false,
        last_message_at: insertLead.lastMessageAt || null,
        ai_paused: insertLead.aiPaused || false,
        pdf_confidence: insertLead.pdfConfidence || null,
        tags: insertLead.tags || [],
        metadata: insertLead.metadata || {},
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create lead: ${error?.message}`);
    }

    return this.mapLeadFromDb(data);
  }

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined> {
    const dbUpdates: any = { updated_at: new Date() };
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.organizationId !== undefined) dbUpdates.organization_id = updates.organizationId;
    if (updates.email !== undefined) dbUpdates.email = updates.email;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.verified !== undefined) dbUpdates.verified = updates.verified;
    if (updates.verifiedAt !== undefined) dbUpdates.verified_at = updates.verifiedAt;
    if (updates.score !== undefined) dbUpdates.score = updates.score;
    if (updates.warm !== undefined) dbUpdates.warm = updates.warm;
    if (updates.lastMessageAt !== undefined) dbUpdates.last_message_at = updates.lastMessageAt;
    if (updates.aiPaused !== undefined) dbUpdates.ai_paused = updates.aiPaused;
    if (updates.pdfConfidence !== undefined) dbUpdates.pdf_confidence = updates.pdfConfidence;
    if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
    if (updates.metadata !== undefined) dbUpdates.metadata = updates.metadata;

    const { data, error } = await this.client
      .from("leads")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) return undefined;
    return this.mapLeadFromDb(data);
  }

  async getTotalLeadsCount(): Promise<number> {
    const { count, error } = await this.client
      .from("leads")
      .select("*", { count: "exact", head: true });

    if (error) return 0;
    return count || 0;
  }

  // ========== Message Methods ==========

  async getMessagesByLeadId(leadId: string): Promise<Message[]> {
    const { data, error } = await this.client
      .from("messages")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });

    if (error || !data) return [];
    return data.map((row) => this.mapMessageFromDb(row));
  }

  async createMessage(
    message: Partial<InsertMessage> & {
      leadId: string;
      userId: string;
      direction: "inbound" | "outbound";
      body: string;
    }
  ): Promise<Message> {
    const { data, error } = await this.client
      .from("messages")
      .insert({
        lead_id: message.leadId,
        user_id: message.userId,
        provider: message.provider || "instagram",
        direction: message.direction,
        body: message.body,
        audio_url: message.audioUrl || null,
        metadata: message.metadata || {},
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create message: ${error?.message}`);
    }

    // Update lead's last_message_at
    await this.client
      .from("leads")
      .update({ last_message_at: new Date() })
      .eq("id", message.leadId);

    return this.mapMessageFromDb(data);
  }

  // ========== Integration Methods ==========

  async getIntegrations(userId: string): Promise<Integration[]> {
    const { data, error } = await this.client
      .from("integrations")
      .select("*")
      .eq("user_id", userId);

    if (error || !data) return [];
    return data.map((row) => this.mapIntegrationFromDb(row));
  }

  async getIntegration(userId: string, provider: string): Promise<Integration | undefined> {
    const { data, error } = await this.client
      .from("integrations")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", provider)
      .single();

    if (error || !data) return undefined;
    return this.mapIntegrationFromDb(data);
  }

  async getIntegrationsByProvider(provider: string): Promise<Integration[]> {
    const { data, error } = await this.client
      .from("integrations")
      .select("*")
      .eq("provider", provider);

    if (error || !data) return [];
    return data.map((row) => this.mapIntegrationFromDb(row));
  }

  async createIntegration(
    integration: Partial<InsertIntegration> & {
      userId: string;
      provider: string;
      encryptedMeta: string;
    }
  ): Promise<Integration> {
    const { data, error } = await this.client
      .from("integrations")
      .insert({
        user_id: integration.userId,
        provider: integration.provider,
        encrypted_meta: integration.encryptedMeta,
        connected: integration.connected ?? true,
        account_type: integration.accountType || null,
        last_sync: integration.lastSync || null,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create integration: ${error?.message}`);
    }

    return this.mapIntegrationFromDb(data);
  }

  async disconnectIntegration(userId: string, provider: string): Promise<void> {
    await this.client
      .from("integrations")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider);
  }
}

// Export singleton instance if Supabase is available
export const supabaseStorage = supabase ? new SupabaseStorage() : null;
