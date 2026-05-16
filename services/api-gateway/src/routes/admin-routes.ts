import * as express from "express";
import { requireAdmin } from "../middleware/auth.js";
import { getSecurityLogs } from "../middleware/sentinel.js";
import { db } from "@shared/lib/db/db.js";
import { users, leads, messages, integrations, type User } from "@audnix/shared";
import { eq, desc, sql, and, gte, count } from "drizzle-orm";

const router = express.Router();

interface AuthenticatedRequest extends express.Request {
  user?: User;
}

interface PlanPrices {
  [key: string]: number;
}
interface UserWithPlan {
  plan: string | null;
}

interface RecentUser {
  id: string;
  name: string | null;
  email: string;
  plan: string;
  createdAt: Date;
}

interface SubscriptionRow {
  date: string;
  plan: string;
  subscriptions: string;
}

interface RevenueDataItem {
  date: string;
  revenue: number;
}

interface OnboardingStatRow {
  user_role?: string;
  source?: string;
  business_size?: string;
  count: string | number;
}

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  timestamp: Date;
}

// All routes require admin authentication
router.use(requireAdmin);

// ============ ANALYTICS ENDPOINTS ============

// Get admin metrics (for admin dashboard)
router.get("/metrics", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    // Get total users
    const totalUsersResult = await db.select({ count: count() }).from(users);
    const totalUsers = Number(totalUsersResult[0]?.count || 0);

    // Get active users (logged in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeUsersResult = await db
      .select({ count: count() })
      .from(users)
      .where(gte(users.lastLogin, thirtyDaysAgo));
    const activeUsers = Number(activeUsersResult[0]?.count || 0);

    // Get trial users
    const trialUsersResult = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.plan, 'trial'));
    const trialUsers = Number(trialUsersResult[0]?.count || 0);

    // Get paid users
    const paidUsersResult = await db
      .select({ count: count() })
      .from(users)
      .where(and(
        sql`${users.stripeSubscriptionId} IS NOT NULL`,
        sql`${users.plan} != 'trial'`
      ));
    const paidUsers = Number(paidUsersResult[0]?.count || 0);

    // Calculate MRR
    const planPrices: PlanPrices = {
      starter: 49,
      pro: 199,
      enterprise: 499,
    };

    const paidUsersWithPlans = await db
      .select({ plan: users.plan })
      .from(users)
      .where(and(
        sql`${users.stripeSubscriptionId} IS NOT NULL`,
        sql`${users.plan} != 'trial'`
      ));

    const mrr = paidUsersWithPlans.reduce((total: number, user: UserWithPlan) => {
      return total + (planPrices[user.plan || ''] || 0);
    }, 0);

    // API burn - count of messages sent today (rough estimate of API usage)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const apiBurnResult = await db
      .select({ count: count() })
      .from(messages)
      .where(and(
        gte(messages.createdAt, today),
        eq(messages.direction, 'outbound')
      ));
    const apiBurn = Number(apiBurnResult[0]?.count || 0);

    // Failed jobs - this would need a jobs table, for now return 0
    const failedJobs = 0;

    // Storage used - rough estimate based on message count
    const totalMessagesResult = await db.select({ count: count() }).from(messages);
    const totalMessages = Number(totalMessagesResult[0]?.count || 0);
    const storageUsed = Math.round((totalMessages * 0.5) / 1024); // Rough estimate in MB

    // Recent users (last 10)
    const recentUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        plan: users.plan,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(10);

    res.json({
      metrics: {
        totalUsers,
        activeUsers,
        trialUsers,
        paidUsers,
        mrr,
        apiBurn,
        failedJobs,
        storageUsed,
      },
      recentUsers: recentUsers.map((u: RecentUser) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching metrics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get previous period overview for comparison
router.get("/overview/previous", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    // Calculate previous 30-day period (30-60 days ago)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get previous period users
    const previousUsersResult = await db
      .select({ count: count() })
      .from(users)
      .where(and(
        gte(users.createdAt, sixtyDaysAgo),
        sql`${users.createdAt} < ${thirtyDaysAgo}`
      ));
    const totalUsers = Number(previousUsersResult[0]?.count || 0);

    // Get previous active users
    const previousActiveResult = await db
      .select({ count: count() })
      .from(users)
      .where(and(
        gte(users.lastLogin, sixtyDaysAgo),
        sql`${users.lastLogin} < ${thirtyDaysAgo}`
      ));
    const activeUsers = Number(previousActiveResult[0]?.count || 0);

    // Calculate previous MRR (simplified - same logic as current)
    const planPrices: PlanPrices = {
      starter: 49,
      pro: 199,
      enterprise: 499,
    };

    const previousPaidUsers = await db
      .select({ plan: users.plan })
      .from(users)
      .where(and(
        sql`${users.stripeSubscriptionId} IS NOT NULL`,
        sql`${users.plan} != 'trial'`,
        gte(users.createdAt, sixtyDaysAgo),
        sql`${users.createdAt} < ${thirtyDaysAgo}`
      ));

    const mrr = previousPaidUsers.reduce((total: number, user: UserWithPlan) => {
      return total + (planPrices[user.plan || ''] || 0);
    }, 0);

    // Get previous leads
    const previousLeadsResult = await db
      .select({ count: count() })
      .from(leads)
      .where(and(
        gte(leads.createdAt, sixtyDaysAgo),
        sql`${leads.createdAt} < ${thirtyDaysAgo}`
      ));
    const totalLeads = Number(previousLeadsResult[0]?.count || 0);

    // Get previous messages
    const previousMessagesResult = await db
      .select({ count: count() })
      .from(messages)
      .where(and(
        gte(messages.createdAt, sixtyDaysAgo),
        sql`${messages.createdAt} < ${thirtyDaysAgo}`
      ));
    const totalMessages = Number(previousMessagesResult[0]?.count || 0);

    res.json({
      totalUsers,
      activeUsers,
      mrr,
      totalLeads,
      totalMessages,
      period: "previous_30_days",
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching previous period:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get dashboard overview
router.get("/overview", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    // Get total users
    const totalUsersResult = await db.select({ count: count() }).from(users);
    const totalUsers = Number(totalUsersResult[0]?.count || 0);

    // Get active users (logged in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeUsersResult = await db
      .select({ count: count() })
      .from(users)
      .where(gte(users.lastLogin, thirtyDaysAgo));
    const activeUsers = Number(activeUsersResult[0]?.count || 0);

    // Get new users (last 30 days)
    const newUsersResult = await db
      .select({ count: count() })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo));
    const newUsers = Number(newUsersResult[0]?.count || 0);

    // Calculate MRR
    const planPrices: PlanPrices = {
      starter: 49,
      pro: 199,
      enterprise: 499,
    };

    const paidUsers = await db
      .select({ plan: users.plan })
      .from(users)
      .where(and(
        sql`${users.stripeSubscriptionId} IS NOT NULL`,
        sql`${users.plan} != 'trial'`
      ));

    const mrr = paidUsers.reduce((total: number, user: UserWithPlan) => {
      return total + (planPrices[user.plan || ''] || 0);
    }, 0);

    // Get total leads
    const totalLeadsResult = await db.select({ count: count() }).from(leads);
    const totalLeads = Number(totalLeadsResult[0]?.count || 0);

    // Get total messages
    const totalMessagesResult = await db.select({ count: count() }).from(messages);
    const totalMessages = Number(totalMessagesResult[0]?.count || 0);

    res.json({
      totalUsers,
      activeUsers,
      newUsers,
      mrr,
      totalLeads,
      totalMessages,
      period: "last_30_days",
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching overview:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user growth data
router.get("/analytics/user-growth", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const days = parseInt(req.query.days as string) || 30;

    // Get daily user registrations
    const userGrowth = await db.execute(sql`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as new_users,
        SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) as total_users
      FROM users
      WHERE created_at >= NOW() - make_interval(days => ${days})
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    res.json({ growth: userGrowth.rows });
  } catch (error) {
    console.error("[ADMIN] Error fetching user growth:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get revenue analytics
router.get("/analytics/revenue", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const days = parseInt(req.query.days as string) || 30;

    // Calculate daily revenue based on subscriptions
    const planPrices: PlanPrices = {
      starter: 49,
      pro: 199,
      enterprise: 499,
    };

    const subscriptionsByDate = await db.execute(sql`
      SELECT 
        DATE(created_at) as date,
        plan,
        COUNT(*) as subscriptions
      FROM users
      WHERE created_at >= NOW() - make_interval(days => ${days})
        AND stripe_subscription_id IS NOT NULL
        AND plan != 'trial'
      GROUP BY DATE(created_at), plan
      ORDER BY date DESC
    `);

    // Calculate revenue per day
    const revenueData = (subscriptionsByDate.rows as unknown as SubscriptionRow[]).reduce((acc: RevenueDataItem[], row: SubscriptionRow) => {
      const existingDay = acc.find(d => d.date === row.date);
      const revenue = (planPrices[row.plan] || 0) * parseInt(row.subscriptions);

      if (existingDay) {
        existingDay.revenue += revenue;
      } else {
        acc.push({ date: row.date, revenue });
      }
      return acc;
    }, []);

    res.json({ revenue: revenueData });
  } catch (error) {
    console.error("[ADMIN] Error fetching revenue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get channel performance
router.get("/analytics/channels", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const channelStats = await db.execute(sql`
      SELECT 
        channel,
        COUNT(*) as total_leads,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions,
        ROUND(COUNT(CASE WHEN status = 'converted' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as conversion_rate
      FROM leads
      GROUP BY channel
      ORDER BY total_leads DESC
    `);

    res.json({ channels: channelStats.rows });
  } catch (error) {
    console.error("[ADMIN] Error fetching channels:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get onboarding statistics
router.get("/analytics/onboarding", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { onboardingProfiles } = await import("@audnix/shared");

    // Get user role breakdown
    const roleStats = await db.execute(sql`
      SELECT 
        user_role,
        COUNT(*) as count
      FROM onboarding_profiles
      WHERE user_role IS NOT NULL
      GROUP BY user_role
      ORDER BY count DESC
    `);

    // Get source breakdown
    const sourceStats = await db.execute(sql`
      SELECT 
        source,
        COUNT(*) as count
      FROM onboarding_profiles
      WHERE source IS NOT NULL
      GROUP BY source
      ORDER BY count DESC
    `);

    // Get business size breakdown
    const sizeStats = await db.execute(sql`
      SELECT 
        business_size,
        COUNT(*) as count
      FROM onboarding_profiles
      WHERE business_size IS NOT NULL
      GROUP BY business_size
      ORDER BY count DESC
    `);

    // Total onboarded users
    const totalResult = await db.select({ count: count() }).from(onboardingProfiles);
    const totalOnboarded = Number(totalResult[0]?.count || 0);

    // Transform snake_case to camelCase for frontend
    const roles = (roleStats.rows as unknown as OnboardingStatRow[]).map((row: OnboardingStatRow) => ({
      userRole: row.user_role,
      count: Number(row.count)
    }));

    const sources = (sourceStats.rows as unknown as OnboardingStatRow[]).map((row: OnboardingStatRow) => ({
      source: row.source,
      count: Number(row.count)
    }));

    const businessSizes = (sizeStats.rows as unknown as OnboardingStatRow[]).map((row: OnboardingStatRow) => ({
      businessSize: row.business_size,
      count: Number(row.count)
    }));

    res.json({
      total: totalOnboarded,
      roles,
      sources,
      businessSizes,
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching onboarding stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ USER MANAGEMENT ENDPOINTS ============

// Search and list users
router.get("/users", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    let query = db.select().from(users).limit(limit).offset(offset).orderBy(desc(users.createdAt));

    if (search) {
      query = query.where(
        sql`${users.email} ILIKE ${'%' + search + '%'} 
            OR ${users.name} ILIKE ${'%' + search + '%'}
            OR ${users.username} ILIKE ${'%' + search + '%'}`
      ) as typeof query;
    }

    const usersList = await query;

    // Get total count
    const totalResult = await db.select({ count: count() }).from(users);
    const total = Number(totalResult[0]?.count || 0);

    res.json({
      users: usersList,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get specific user details
router.get("/users/:userId", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { userId } = req.params;

    // Get user details
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Get user's leads
    const userLeads = await db
      .select()
      .from(leads)
      .where(eq(leads.userId, userId))
      .orderBy(desc(leads.createdAt))
      .limit(10);

    // Get user's integrations
    const userIntegrations = await db
      .select({
        id: integrations.id,
        provider: integrations.provider,
        connected: integrations.connected,
        lastSync: integrations.lastSync,
      })
      .from(integrations)
      .where(eq(integrations.userId, userId));

    // Get lead stats
    const leadStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) as converted,
        COUNT(CASE WHEN status = 'new' THEN 1 END) as new,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open
      FROM leads
      WHERE user_id = ${userId}
    `);

    // Get message stats
    const messageStats = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN direction = 'inbound' THEN 1 END) as received,
        COUNT(CASE WHEN direction = 'outbound' THEN 1 END) as sent
      FROM messages
      WHERE user_id = ${userId}
    `);

    res.json({
      user,
      leads: userLeads,
      integrations: userIntegrations,
      stats: {
        leads: leadStats.rows[0],
        messages: messageStats.rows[0],
      },
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching user details:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user activity timeline
router.get("/users/:userId/activity", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;

    // Get recent leads
    const recentLeads = await db
      .select({
        id: leads.id,
        type: sql<string>`'lead_created'`,
        description: sql<string>`'New lead: ' || ${leads.name} || ' from ' || ${leads.channel}`,
        timestamp: leads.createdAt,
      })
      .from(leads)
      .where(eq(leads.userId, userId))
      .orderBy(desc(leads.createdAt))
      .limit(limit);

    // Get recent messages
    const recentMessages = await db
      .select({
        id: messages.id,
        type: sql<string>`CASE WHEN ${messages.direction} = 'inbound' THEN 'message_received' ELSE 'message_sent' END`,
        description: sql<string>`${messages.direction} || ' message via ' || ${messages.provider}`,
        timestamp: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    // Combine and sort by timestamp
    const activity = ([...recentLeads, ...recentMessages] as ActivityItem[])
      .sort((a: ActivityItem, b: ActivityItem) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    res.json({ activity });
  } catch (error) {
    console.error("[ADMIN] Error fetching user activity:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ LEAD MANAGEMENT ============

// Get all leads (read-only view)
router.get("/leads", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const channel = req.query.channel as string;

    let query = db
      .select({
        lead: leads,
        user: {
          email: users.email,
          name: users.name,
        },
      })
      .from(leads)
      .leftJoin(users, eq(leads.userId, users.id))
      .limit(limit)
      .offset(offset)
      .orderBy(desc(leads.createdAt));

    const conditions = [];
    if (status) conditions.push(eq(leads.status, status as "new" | "open" | "replied" | "converted" | "not_interested" | "cold"));
    if (channel) conditions.push(eq(leads.channel, channel as "instagram" | "email"));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const leadsList = await query;

    // Get total count
    const totalResult = await db.select({ count: count() }).from(leads);
    const total = Number(totalResult[0]?.count || 0);

    res.json({
      leads: leadsList,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching leads:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ADMIN WHITELIST MANAGEMENT ============

// ============ DIRECT USER MANAGEMENT ============

// Direct upgrade user to any plan (no payment required)
// Used for: whitelisted team members, promotions, testing
router.post("/users/:userId/upgrade", (async (req: AuthenticatedRequest, res: express.Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const { plan } = req.body;
    const adminId = req.user?.id;

    // Validate plan
    const validPlans = ['free', 'trial', 'starter', 'pro', 'enterprise'];
    if (!plan || !validPlans.includes(plan)) {
      res.status(400).json({
        error: "Invalid plan",
        validPlans
      });
      return;
    }

    // Get target user
    const targetUser = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser.length) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const oldPlan = targetUser[0].plan;

    // Update user plan directly (no payment required)
    await db
      .update(users)
      .set({
        plan,
        paymentStatus: 'approved',
        paymentApprovedAt: new Date(),
        pendingPaymentPlan: null,
        pendingPaymentAmount: null,
        pendingPaymentDate: null,
      })
      .where(eq(users.id, userId));

    console.log(`✅ Admin ${adminId} upgraded user ${targetUser[0].email}: ${oldPlan} → ${plan}`);

    res.json({
      success: true,
      message: `User upgraded to ${plan} plan`,
      user: {
        id: userId,
        email: targetUser[0].email,
        oldPlan,
        newPlan: plan,
      },
    });
  } catch (error) {
    console.error("[ADMIN] Error upgrading user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}) as any);

// Get user by email (for admin lookup)
router.get("/users/lookup", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { email } = req.query;

    if (!email || typeof email !== 'string') {
      res.status(400).json({ error: "Email query parameter required" });
      return;
    }

    const user = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        username: users.username,
        plan: users.plan,
        paymentStatus: users.paymentStatus,
        createdAt: users.createdAt,
        lastLogin: users.lastLogin,
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (!user.length) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user: user[0] });
  } catch (error) {
    console.error("[ADMIN] Error looking up user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ADMIN WHITELIST ============

// Get system health logs
router.get("/health-logs", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const level = req.query.level as string;
    const service = req.query.service as string;

    const { systemHealthLogs } = await import("@audnix/shared");

    let query = db.select().from(systemHealthLogs).limit(limit).offset(offset).orderBy(desc(systemHealthLogs.createdAt));

    const conditions = [];
    if (level) conditions.push(eq(systemHealthLogs.level, level));
    if (service) conditions.push(eq(systemHealthLogs.service, service));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const logs = await query;
    
    // Get count for pagination
    const totalResult = await db.select({ count: count() }).from(systemHealthLogs);
    const total = Number(totalResult[0]?.count || 0);

    res.json({ 
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("[ADMIN] Error fetching health logs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get admin whitelist
router.get("/whitelist", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const whitelist = await db.execute(sql`
      SELECT * FROM admin_whitelist 
      ORDER BY created_at DESC
    `);

    res.json({ whitelist: whitelist.rows });
  } catch (error) {
    console.error("[ADMIN] Error fetching whitelist:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get security logs from Sentinel
router.get("/security-logs", (req: express.Request, res: express.Response) => {
  res.json({ logs: getSecurityLogs() });
});

// Add email to whitelist
router.post("/whitelist", (async (req: AuthenticatedRequest, res: express.Response): Promise<void> => {
  try {
    const { email } = req.body;
    const adminId = req.user?.id;

    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "Valid email is required" });
      return;
    }

    const result = await db.execute(sql`
      INSERT INTO admin_whitelist (email, invited_by, status)
      VALUES (${email.toLowerCase()}, ${adminId}, 'active')
      ON CONFLICT (email) DO UPDATE SET status = 'active', updated_at = NOW()
      RETURNING *
    `);

    res.json({ success: true, admin: result.rows[0] });
  } catch (error) {
    console.error("[ADMIN] Error adding to whitelist:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}) as any);

// Remove email from whitelist
router.delete("/whitelist/:email", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { email } = req.params;

    await db.execute(sql`
      UPDATE admin_whitelist 
      SET status = 'revoked', updated_at = NOW()
      WHERE email = ${email.toLowerCase()}
    `);

    res.json({ success: true });
  } catch (error) {
    console.error("[ADMIN] Error removing from whitelist:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ USER RESET OPERATIONS ============

router.post("/reset-limbo-users", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    console.log("[ADMIN] Starting limbo user reset...");

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const limboUsersResult = await db.execute(sql`
      SELECT u.* FROM users u
      WHERE (
        u.username ~ '\\d{13}$'
        OR (u.password IS NULL AND u.plan = 'trial')
        OR (
          u.plan = 'trial' 
          AND u.created_at < ${twentyFourHoursAgo}
          AND NOT EXISTS (
            SELECT 1 FROM onboarding_profiles op 
            WHERE op.user_id = u.id AND op.completed = true
          )
        )
      )
    `);

    const limboUsers = limboUsersResult.rows as any[];
    console.log(`[ADMIN] Found ${limboUsers.length} limbo users`);

    let deletedCount = 0;

    for (const user of limboUsers) {
      try {
        await db.execute(sql`DELETE FROM onboarding_profiles WHERE user_id = ${user.id}`);
        await db.execute(sql`DELETE FROM users WHERE id = ${user.id}`);
        deletedCount++;
        console.log(`[ADMIN] Deleted limbo user: ${user.email}`);
      } catch (err) {
        console.error(`[ADMIN] Error deleting user ${user.email}:`, err);
      }
    }

    const expiredOtpsResult = await db.execute(sql`
      DELETE FROM otp_codes WHERE expires_at < ${now} RETURNING *
    `);

    console.log(`[ADMIN] Cleaned ${expiredOtpsResult.rows.length} expired OTPs`);

    res.json({
      success: true,
      usersReset: deletedCount,
      otpsCleaned: expiredOtpsResult.rows.length,
      message: `Reset ${deletedCount} limbo users and cleaned ${expiredOtpsResult.rows.length} expired OTPs`
    });
  } catch (error) {
    console.error("[ADMIN] Error resetting limbo users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reset-all-users", async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { confirmReset } = req.body;

    if (confirmReset !== "CONFIRM_RESET_ALL_USERS") {
      res.status(400).json({
        error: "Confirmation required",
        message: "Send { confirmReset: 'CONFIRM_RESET_ALL_USERS' } to proceed"
      });
      return;
    }

    console.log("[ADMIN] ⚠️ RESETTING ALL USERS - This is a destructive operation");

    await db.execute(sql`DELETE FROM onboarding_profiles`);
    await db.execute(sql`DELETE FROM otp_codes`);
    await db.execute(sql`DELETE FROM users WHERE role != 'admin'`);

    console.log("[ADMIN] ✅ All non-admin users reset complete");

    res.json({
      success: true,
      message: "All non-admin users have been reset. Users can now sign up fresh."
    });
  } catch (error) {
    console.error("[ADMIN] Error resetting all users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
