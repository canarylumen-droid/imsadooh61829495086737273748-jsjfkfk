import { Router, Request, Response } from 'express';
import { twilioEmailOTP } from '@services/api-gateway/src/auth/twilio-email-otp.js';
import { storage } from '@shared/lib/storage/storage.js';
import { rateLimit } from 'express-rate-limit';

const router = Router();

const ADMIN_WHITELIST = (process.env.ADMIN_WHITELIST_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

console.log(`✅ Admin whitelist loaded: ${ADMIN_WHITELIST.length} emails`);

interface FailedAttemptRecord {
  count: number;
  blocked: boolean;
  blockedUntil: number;
}

interface BlockCheckResult {
  blocked: boolean;
  reason?: string;
}

interface EmailRequestBody {
  email?: string;
}

interface VerifyOTPBody {
  email?: string;
  otp?: string;
}

const failedAttempts = new Map<string, FailedAttemptRecord>();

const getAttemptsKey = (email: string, ip: string): string => `${email}:${ip}`;

function checkBlocked(email: string, ip: string): BlockCheckResult {
  const key = getAttemptsKey(email, ip);
  const record = failedAttempts.get(key);

  if (!record) return { blocked: false };

  if (record.blocked) {
    return { 
      blocked: true, 
      reason: `Access permanently blocked. Device banned after 2 failed attempts. Contact support.` 
    };
  }

  return { blocked: false };
}

function recordFailedAttempt(email: string, ip: string): void {
  const key = getAttemptsKey(email, ip);
  const record = failedAttempts.get(key) || { count: 0, blocked: false, blockedUntil: 0 };

  record.count += 1;
  console.warn(`[SECURITY] Admin login attempt ${record.count} for ${email} from ${ip}`);

  if (record.count >= 2) {
    record.blocked = true;
    record.blockedUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
    console.warn(`[SECURITY] Admin login PERMANENTLY BLOCKED (device ban) for ${email} from ${ip} for 1 week`);
  }

  failedAttempts.set(key, record);
}

function getClientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

router.post('/check-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as EmailRequestBody;
    const ip = getClientIp(req);

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    const blocked = checkBlocked(normalizedEmail, ip);
    if (blocked.blocked) {
      console.warn(`[SECURITY] Blocked device attempted access: ${normalizedEmail} from ${ip}`);
      res.status(403).json({ 
        error: 'Access permanently denied',
        reason: blocked.reason,
        blocked: true,
        permanent: true
      });
      return;
    }

    const isWhitelisted = ADMIN_WHITELIST.includes(normalizedEmail);

    if (!isWhitelisted) {
      recordFailedAttempt(normalizedEmail, ip);
      const record = failedAttempts.get(getAttemptsKey(normalizedEmail, ip));
      res.status(403).json({ 
        error: 'Not authorized for admin access',
        isWhitelisted: false,
        attempts: record?.count || 0,
        attemptsRemaining: 2 - (record?.count || 0)
      });
      return;
    }

    res.json({
      success: true,
      isWhitelisted: true,
      message: 'Email whitelisted for admin access'
    });

  } catch (error: unknown) {
    console.error('Admin email check error:', error);
    res.status(500).json({ error: 'Failed to check email' });
  }
});

router.post('/request-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as EmailRequestBody;
    const ip = getClientIp(req);

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    const blocked = checkBlocked(normalizedEmail, ip);
    if (blocked.blocked) {
      console.warn(`[SECURITY] Blocked device attempted OTP request: ${normalizedEmail} from ${ip}`);
      res.status(403).json({ 
        error: 'Access permanently denied',
        reason: blocked.reason,
        blocked: true,
        permanent: true
      });
      return;
    }

    if (!ADMIN_WHITELIST.includes(normalizedEmail)) {
      recordFailedAttempt(normalizedEmail, ip);
      const record = failedAttempts.get(getAttemptsKey(normalizedEmail, ip));
      res.status(403).json({ 
        error: 'Email not authorized for admin access',
        isWhitelisted: false,
        attempts: record?.count || 0,
        attemptsRemaining: 2 - (record?.count || 0)
      });
      return;
    }

    if (!twilioEmailOTP.isConfigured()) {
      res.status(503).json({ error: 'Email service not configured' });
      return;
    }

    const result = await twilioEmailOTP.sendEmailOTP(normalizedEmail);

    if (!result.success) {
      res.status(400).json({ error: result.error || 'Failed to send OTP' });
      return;
    }

    res.json({
      success: true,
      message: 'OTP sent to your email',
      expiresIn: '10 minutes',
    });

    console.log(`✅ Admin OTP sent to ${normalizedEmail}`);

  } catch (error: unknown) {
    console.error('Admin OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

router.post('/verify-otp', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body as VerifyOTPBody;
    const ip = getClientIp(req);

    if (!email || !otp) {
      res.status(400).json({ error: 'Email and OTP required' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    const blocked = checkBlocked(normalizedEmail, ip);
    if (blocked.blocked) {
      console.warn(`[SECURITY] Blocked device attempted verify: ${normalizedEmail} from ${ip}`);
      res.status(403).json({ 
        error: 'Access permanently denied',
        reason: blocked.reason,
        blocked: true,
        permanent: true
      });
      return;
    }

    if (!ADMIN_WHITELIST.includes(normalizedEmail)) {
      recordFailedAttempt(normalizedEmail, ip);
      const record = failedAttempts.get(getAttemptsKey(normalizedEmail, ip));
      res.status(403).json({ 
        error: 'Email not authorized for admin access',
        isWhitelisted: false,
        attempts: record?.count || 0,
        attemptsRemaining: 2 - (record?.count || 0)
      });
      return;
    }

    const verifyResult = await twilioEmailOTP.verifyEmailOTP(normalizedEmail, otp);
    if (!verifyResult.success) {
      res.status(400).json({ error: verifyResult.error });
      return;
    }

    let user = await storage.getUserByEmail(normalizedEmail);
    
    if (!user) {
      user = await storage.createUser({
        email: normalizedEmail,
        username: normalizedEmail.split('@')[0],
        password: null,
        plan: 'enterprise',
        role: 'admin',
      });
      console.log(`✅ New admin user created: ${normalizedEmail}`);
    } else if (user.role !== 'admin') {
      await storage.updateUser(user.id, { role: 'admin' });
      user.role = 'admin';
      console.log(`✅ User promoted to admin: ${normalizedEmail}`);
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('[AdminAuth] Session regenerate failed:', err);
        return res.status(500).json({ error: 'Session error' });
      }

      req.session.userId = user.id;
      req.session.email = normalizedEmail;
      req.session.isAdmin = true;
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;

      failedAttempts.delete(getAttemptsKey(normalizedEmail, ip));

      res.json({
        success: true,
        message: 'Admin logged in successfully',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: 'admin',
        },
        sessionExpiresIn: '30 days',
      });

      console.log(`✅ Admin logged in: ${normalizedEmail}`);
    });
  } catch (error: unknown) {
    console.error('Admin OTP verification error:', error);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});

router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.json({ authenticated: false, isAdmin: false });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.json({ authenticated: false, isAdmin: false });
      return;
    }

    res.json({
      authenticated: true,
      isAdmin: user.role === 'admin',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      }
    });

  } catch (error: unknown) {
    res.json({ authenticated: false, isAdmin: false });
  }
});

router.post('/reset-limbo-users', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const admin = await storage.getUserById(userId);
    if (!admin || admin.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    console.log('🔧 [Admin] Starting limbo user reset...');

    const results = {
      usersReset: 0,
      usersWithTempUsername: 0,
      usersWithIncompleteOnboarding: 0,
      errors: [] as string[]
    };

    const allUsers = await storage.getAllUsers();

    for (const user of allUsers) {
      try {
        const isTemporaryUsername = user.username && /\d{13}$/.test(user.username);
        const onboardingProfile = await storage.getOnboardingProfile(user.id);
        const hasCompletedOnboarding = onboardingProfile?.completed || (user.metadata as any)?.onboardingCompleted;

        if (isTemporaryUsername) {
          results.usersWithTempUsername++;
          const suggestedUsername = user.email.split('@')[0];
          await storage.updateUser(user.id, { 
            username: suggestedUsername,
            metadata: { ...(user.metadata as object || {}), needsUsernameReset: false }
          });
          results.usersReset++;
          console.log(`✅ Reset user ${user.email} to username: ${suggestedUsername}`);
        }

        if (!hasCompletedOnboarding && !isTemporaryUsername) {
          results.usersWithIncompleteOnboarding++;
        }
      } catch (userError: any) {
        results.errors.push(`Failed to process ${user.email}: ${userError.message}`);
      }
    }

    console.log(`✅ [Admin] Limbo user reset complete: ${results.usersReset} users fixed`);

    res.json({
      success: true,
      message: `Reset ${results.usersReset} users from limbo state`,
      results
    });

  } catch (error: unknown) {
    console.error('Admin reset limbo users error:', error);
    res.status(500).json({ error: 'Failed to reset users' });
  }
});

export default router;
