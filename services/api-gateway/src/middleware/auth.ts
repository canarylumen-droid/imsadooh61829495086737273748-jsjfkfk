import type { Request, Response, NextFunction } from "express";
import { storage } from "@shared/lib/storage/storage.js";
import type { User } from "@audnix/shared";
import { SESSION_COOKIE_NAME } from "../config/session.js";
import crypto from "crypto";

// Extend Express session to include our custom fields
declare module "express-session" {
  interface SessionData {
    userId?: string;
    userEmail?: string;
    supabaseId?: string;
    email?: string;
    isAdmin?: boolean;
  }
}

// Extend Express Request to include user property
declare global {
  namespace Express {
    interface Request {
      user?: User;
      userId?: string;
      apiKeyScope?: string;
      isApiKey?: boolean;
    }
  }
}

/**
 * Authentication middleware - requires user to be logged in
 * Only accepts authenticated sessions - no header bypass
 * Prevents timing attacks and session fixation
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  const sessionID = req.sessionID;

  if (!userId) {
    const cookies = req.headers.cookie || '';
    const sidCookie = cookies.split(';').find(c => c.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
    
    // Silenced verbose auth rejection logging to prevent log pollution on unauthenticated endpoints (like /status or /user/profile checks)
    // console.debug(`[AUTH] Rejected 401: No userId for ${req.method} ${req.path}`);

    // Security: Add small delay to prevent timing attacks
    await new Promise(resolve => setTimeout(resolve, 100));

    if (req.path.startsWith('/auth')) {
      return next();
    }

    return res.status(401).json({
      error: "Unauthorized",
      message: "Authentication required. Please log in to access this resource.",
      code: "AUTH_REQUIRED"
    });
  }

  // Verify user exists in database
  // IMPORTANT: Wrap in try-catch to handle transient DB errors (quota, connection timeout)
  // WITHOUT destroying the session. Only destroy session when user genuinely doesn't exist.
  let user;
  try {
    user = await storage.getUserById(userId);
  } catch (dbError: any) {
    // Transient DB error — do NOT destroy the session
    console.warn(`[AUTH] DB lookup failed for user ${userId} (transient error, session preserved):`, dbError?.message || dbError);
    return res.status(503).json({
      error: "Service temporarily unavailable",
      message: "Database is temporarily busy. Please retry in a moment.",
      code: "DB_TRANSIENT_ERROR"
    });
  }

  if (!user) {
    console.warn(`[AUTH] Rejected 401: User ${userId} not found in database. Possible deleted user with active session.`);

    // Security: Add small delay to prevent timing attacks
    await new Promise(resolve => setTimeout(resolve, 100));

    // Security: Destroy invalid session to prevent fixation attacks
    req.session.destroy(() => { });

    return res.status(401).json({
      error: "Unauthorized",
      message: "Session invalid or expired. Please log in again.",
      code: "SESSION_INVALID"
    });
  }

  // Attach user to request for downstream handlers
  req.user = user;
  next();
}

/**
 * Optional authentication middleware - attaches user if logged in
 * Does not require authentication, but provides user context if available
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;

  if (userId) {
    const user = await storage.getUserById(userId);
    if (user) {
      req.user = user;
    }
  }

  next();
}

/**
 * Admin-only middleware - requires user to be an admin
 * Checks both user role AND admin whitelist (strict enforcement)
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "Please log in to access this resource"
    });
  }

  const user = await storage.getUserById(userId);
  if (!user) {
    return res.status(401).json({
      error: "Invalid session",
      message: "User not found"
    });
  }

  // CRITICAL: Check admin whitelist FIRST (primary security control)
  try {
    const { db } = await import("@shared/lib/db/db.js");
    const { sql } = await import("drizzle-orm");

    const whitelistCheck = await db.execute(sql`
      SELECT id, email, status FROM admin_whitelist 
      WHERE LOWER(email) = LOWER(${user.email})
        AND status = 'active'
      LIMIT 1
    `);

    if (!whitelistCheck.rows || whitelistCheck.rows.length === 0) {
      console.warn(`[SECURITY] Non-whitelisted user attempted admin access: ${user.email}`);
      return res.status(403).json({
        error: "Forbidden",
        message: "Admin access denied"
      });
    }

    // Secondary check: ensure role is set correctly
    if (user.role !== 'admin') {
      console.warn(`[SECURITY] Whitelisted user ${user.email} has incorrect role: ${user.role}`);
      // Auto-fix the role for whitelisted users
      await storage.updateUser(user.id, { role: 'admin' });
      user.role = 'admin';
    }
  } catch (error) {
    console.error("[SECURITY] Admin whitelist check failed:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: "Unable to verify admin access"
    });
  }

  req.user = user;
  next();
}

/**
 * Middleware to check if user has an active subscription or valid trial
 * Blocks access to premium features if trial expired and no paid plan
 */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;

  if (!userId) {
    return res.status(401).json({
      error: "Authentication required",
      message: "Please log in to access this resource"
    });
  }

  const user = await storage.getUserById(userId);
  if (!user) {
    return res.status(401).json({
      error: "Invalid session",
      message: "User not found"
    });
  }

  // Check if user has a paid plan
  if (user.plan && user.plan !== 'trial') {
    req.user = user;
    return next();
  }

  // If on trial, check if it's expired
  if (user.plan === 'trial' && user.trialExpiresAt) {
    const now = new Date();
    if (now < user.trialExpiresAt) {
      // Trial is still valid
      req.user = user;
      return next();
    }
  }

  // Trial expired or no active subscription
  return res.status(402).json({
    error: "Subscription required",
    message: "Your free trial has ended. Please upgrade to continue using premium features.",
    redirectTo: "/dashboard/pricing"
  });
}

/**
 * API Key Authentication Middleware
 * Validates Bearer token from Authorization header.
 * Sets req.userId on success.
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer audnix_...' });
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith('audnix_')) {
    return res.status(401).json({ error: 'Invalid API key format. Key must start with audnix_' });
  }

  const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

  try {
    const { db } = await import('@shared/lib/db/db.js');
    const { sql } = await import('drizzle-orm');

    const result = await db.execute(sql`
      SELECT user_id, name, scope FROM api_keys WHERE key = ${hashedKey}
    `);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'API key not found or has been revoked.' });
    }

    const keyData = result.rows[0] as any;

    // Update last used timestamp (fire-and-forget)
    db.execute(sql`UPDATE api_keys SET last_used_at = NOW() WHERE key = ${hashedKey}`).catch(() => {});

    req.userId = keyData.user_id;
    req.user = { id: keyData.user_id } as any;
    req.apiKeyScope = keyData.scope;
    req.isApiKey = true;
    next();
  } catch (error) {
    console.error('API key auth error:', error);
    res.status(500).json({ error: 'Authentication failed.' });
  }
}

/**
 * Combined auth middleware — accepts session OR API key
 * Session takes priority. API key must start with "audnix_"
 */
export async function requireAuthOrApiKey(req: Request, res: Response, next: NextFunction) {
  // Try session first
  if (req.session?.userId) {
    return requireAuth(req, res, next);
  }

  // Fall back to API key
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer audnix_')) {
    return requireApiKey(req, res, next);
  }

  await new Promise(resolve => setTimeout(resolve, 100));
  return res.status(401).json({
    error: "Unauthorized",
    message: "Authentication required. Provide session cookie or Authorization: Bearer audnix_... header.",
    code: "AUTH_REQUIRED"
  });
}

/**
 * Helper function to get current user from request
 */
export function getCurrentUser(req: Request) {
  return req.user;
}

/**
 * Helper function to get current user ID from request
 * Works with both session auth and API key auth
 */
export function getCurrentUserId(req: Request): string | undefined {
  if (req.isApiKey && req.userId) return req.userId;
  return req.session?.userId;
}
