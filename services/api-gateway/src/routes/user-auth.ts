import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { twilioEmailOTP } from '@services/api-gateway/src/auth/twilio-email-otp.js';
import { storage } from '@shared/lib/storage/storage.js';
import { rateLimit } from 'express-rate-limit';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const router = Router();

/**
 * OTP_ENABLED Feature Flag
 * Set to false to temporarily disable OTP verification during signup.
 * When false:
 * - Users can sign up directly without email OTP verification
 * - Users are marked as verified by default
 * - OTP-related code remains intact for future re-activation
 * 
 * Set to true to re-enable OTP verification (production behavior)
 */
const OTP_ENABLED = false;

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max for avatars
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'));
    }
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many auth attempts' },
});

router.get('/otp-configured', async (_req: Request, res: Response): Promise<void> => {
  res.json({
    configured: twilioEmailOTP.isConfigured(),
  });
});

router.post('/signup/request-otp', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('🔍 [OTP Request] Received request to /api/user/auth/signup/request-otp');

    // Defensive check for missing body (happens when JSON middleware not applied)
    if (!req.body) {
      console.error('🚨 [OTP CRASH] req.body is undefined - JSON middleware not applied');
      res.status(400).json({ error: 'Invalid request format', details: 'No JSON body received' });
      return;
    }

    const { email, password } = req.body as { email?: string; password?: string };
    console.log('🔍 [OTP Request] Body - Email:', email ? '✓' : '✗', 'Password:', password ? '✓' : '✗');

    // SECURITY: Use a stricter, non-polynomial regex for email validation
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!email || !emailRegex.test(email)) {
      console.error('❌ [OTP] Invalid email format');
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    if (!password || password.length < 8) {
      console.error('❌ [OTP] Weak password');
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Check for existing user with better error handling
    let existing;
    try {
      existing = await storage.getUserByEmail(email);
    } catch (dbError: any) {
      console.error('❌ [OTP] Database error checking existing user:', dbError.message);
      res.status(503).json({
        error: 'Database temporarily unavailable',
        details: 'Please try again in a moment'
      });
      return;
    }

    if (existing) {
      // Check if account setup was incomplete
      const isTemporaryUsername = existing.username && /\d{13}$/.test(existing.username);
      const onboardingProfile = await storage.getOnboardingProfile(existing.id);
      const hasCompletedOnboarding = onboardingProfile?.completed || existing.metadata?.onboardingCompleted;

      if (isTemporaryUsername || !hasCompletedOnboarding) {
        // Allow them to continue - they can login with their password to restore state
        console.log(`ℹ️ [OTP] User ${email} has incomplete account - directing to login`);
        res.status(400).json({
          error: 'Account exists but setup incomplete. Please login to continue setup.',
          incompleteSetup: true,
          useLogin: true
        });
        return;
      }

      console.error(`❌ [OTP] Email already registered: ${email}`);
      res.status(400).json({ error: 'Email already registered. Use login instead.' });
      return;
    }

    // Hash password and store with OTP in database (serverless-safe)
    const hashedPassword = await bcrypt.hash(password, 10);

    if (!OTP_ENABLED) {
      console.log(`ℹ️ [OTP Bypass] Direct signup is available. Redirecting ${email} to direct flow.`);
      res.json({
        success: true,
        message: 'OTP verification is disabled. You can sign up directly.',
        otpEnabled: false,
        directSignupAvailable: true
      });
      return;
    }

    if (!twilioEmailOTP.isConfigured()) {
      console.error(`❌ [OTP] SendGrid NOT configured. Missing: TWILIO_SENDGRID_API_KEY`);
      res.status(503).json({
        error: 'Email service not configured',
        details: 'Missing required SendGrid API key: TWILIO_SENDGRID_API_KEY (from SendGrid, not Twilio)',
        configured: false
      });
      return;
    }

    console.log(`📧 [OTP] Sending to: ${email}`);
    let result;
    try {
      // Send OTP with password hash stored in database (not session)
      result = await twilioEmailOTP.sendSignupOTP(email, hashedPassword);
    } catch (emailError: any) {
      console.error(`❌ [OTP] Email service error:`, emailError.message);
      res.status(503).json({
        error: 'Email service temporarily unavailable',
        details: 'Please try again in a moment'
      });
      return;
    }

    if (!result.success) {
      console.error(`❌ [OTP FAILED] ${email} - Error: ${result.error}`);
      res.status(400).json({
        error: result.error || 'Failed to send OTP',
        reason: result.error
      });
      return;
    }

    console.log(`✅ [OTP SUCCESS] OTP sent to ${email}`);
    res.json({
      success: true,
      message: 'OTP sent to your email from auth@audnixai.com',
      expiresIn: '10 minutes',
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('🚨 [OTP CRASH]', errorMessage, error);
    res.status(500).json({
      error: 'A server error occurred',
      details: 'Please try again later'
    });
  }
});

/**
 * GET /api/user/auth/otp-status
 * Check if OTP verification is enabled for signup
 * Frontend uses this to decide whether to show OTP step
 */
router.get('/otp-status', (_req: Request, res: Response): void => {
  res.json({
    otpEnabled: OTP_ENABLED,
    message: OTP_ENABLED 
      ? 'OTP verification is required for signup' 
      : 'OTP verification is currently disabled - direct signup available'
  });
});

/**
 * POST /api/user/auth/signup/direct
 * Direct signup WITHOUT OTP verification (only works when OTP_ENABLED = false)
 * Creates user immediately and marks as verified
 */
router.post('/signup/direct', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    // Block this endpoint if OTP is enabled
    if (OTP_ENABLED) {
      res.status(403).json({ 
        error: 'Direct signup is disabled. Please use OTP verification.',
        otpRequired: true 
      });
      return;
    }

    console.log('🚀 [Direct Signup] Processing direct signup (OTP bypassed)');

    if (!req.body) {
      res.status(400).json({ error: 'Invalid request format' });
      return;
    }

    const { email, password, username } = req.body as { email?: string; password?: string; username?: string };

    // Validate email
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!email || !emailRegex.test(email)) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    // Validate password
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    // Validate username
    if (!username || username.length < 3 || username.length > 30) {
      res.status(400).json({ error: 'Username must be 3-30 characters' });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      res.status(400).json({ error: 'Only letters, numbers, hyphens and underscores allowed' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    // Check for existing user
    const existingEmail = await storage.getUserByEmail(normalizedEmail);
    if (existingEmail) {
      res.status(400).json({ error: 'Email already registered. Use login instead.' });
      return;
    }

    // Check for existing username
    const existingUsername = await storage.getUserByUsername(username);
    if (existingUsername) {
      res.status(400).json({ error: 'Username already taken' });
      return;
    }

    // Hash password and create user directly
    const hashedPassword = await bcrypt.hash(password, 10);

    const vipEmails = ['team.replyflow@gmail.com', 'fortuneuchendu708@gmail.com', 'teamp.replyflow@gmail.com'];
    const isVip = vipEmails.includes(normalizedEmail);

    const user = await storage.createUser({
      email: normalizedEmail,
      username: username,
      password: hashedPassword,
      plan: isVip ? 'enterprise' : 'trial',
      role: 'member',
      subscriptionTier: isVip ? 'enterprise' : undefined,
      metadata: {
        signupMethod: 'direct',
        otpBypassed: true,
        verifiedAt: new Date().toISOString(),
      },
    });

    console.log(`✅ [Direct Signup] User created: ${normalizedEmail} (username: ${username})`);

    // Establish session
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          console.error('Session regenerate error:', err);
          reject(err);
        } else {
          console.log('✅ Session regenerated for direct signup');
          resolve();
        }
      });
    });

    req.session.userId = user.id;
    req.session.email = normalizedEmail;
    req.session.isAdmin = false;
    if (req.session.cookie) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    // Defensive check: Ensure session store is available before saving
    if (!req.sessionStore) {
      console.error('🚨 [Direct Signup] No session store available');
      throw new Error('Internal session error: Store unavailable');
    }

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('?? [Login] Session save error (SID: ' + req.sessionID + '):', err);
          reject(err);
        } else {
          console.log('✅ Session saved for direct signup user:', user.id);
          resolve();
        }
      });
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    res.json({
      success: true,
      message: 'Account created successfully (OTP verification bypassed)',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
        role: 'member',
      },
      otpBypassed: true,
      sessionExpiresIn: '30 days',
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('🚨 [Direct Signup Error]', errorMessage, error);
    res.status(500).json({
      error: 'Signup failed',
      details: 'Please try again later'
    });
  }
});

router.post('/signup/verify-otp', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body as { email?: string; otp?: string };

    if (!email || !otp) {
      res.status(400).json({ error: 'Email and OTP required' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    // Verify OTP and get signup data from database (serverless-safe)
    const verifyResult = await twilioEmailOTP.verifySignupOTP(email, otp);
    if (!verifyResult.success) {
      res.status(400).json({ error: verifyResult.error });
      return;
    }

    // Get password hash from OTP record
    const passwordHash = verifyResult.passwordHash;
    if (!passwordHash) {
      console.error(`❌ [OTP Verify] Password hash missing for ${normalizedEmail}`);
      res.status(400).json({ error: 'Please start signup again. Data expired.' });
      return;
    }

    // Create temporary username (will be updated in step 3)
    const tempUsername = normalizedEmail.split('@')[0] + Date.now();

    const vipEmails = ['team.replyflow@gmail.com', 'fortuneuchendu708@gmail.com', 'teamp.replyflow@gmail.com'];
    const isVip = vipEmails.includes(normalizedEmail);

    const user = await storage.createUser({
      email: normalizedEmail,
      username: tempUsername,
      password: passwordHash,
      plan: isVip ? 'enterprise' : 'trial',
      role: 'member',
      subscriptionTier: isVip ? 'enterprise' : undefined,
    });

    // Set session for logged-in user FIRST (before regenerate to preserve data)
    const sessionData = {
      userId: user.id,
      email: normalizedEmail,
      isAdmin: false,
    };

    console.log(`📝 [OTP Verify] Setting session data:`, JSON.stringify(sessionData));

    // Regenerate session ID for security (prevents session fixation)
    await new Promise<void>((resolve, reject) => {
      const oldSessionId = req.sessionID;
      req.session.regenerate((err) => {
        if (err) {
          console.error('Session regenerate error:', err);
          reject(err);
        } else {
          console.log(`✅ Session regenerated: ${oldSessionId.slice(0, 8)}... -> ${req.sessionID.slice(0, 8)}...`);
          resolve();
        }
      });
    });

    // Re-apply session data after regeneration
    req.session.userId = user.id;
    req.session.email = normalizedEmail;
    req.session.isAdmin = false;
    if (req.session.cookie) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    // Defensive check: Ensure session store is available before saving
    if (!req.sessionStore) {
      console.error('🚨 [OTP Verify] No session store available');
      throw new Error('Internal session error: Store unavailable');
    }

    // Save session explicitly for serverless environments
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Session save error after OTP verification:', err);
          reject(err);
        } else {
          console.log('✅ Session saved successfully for user:', user.id);
          console.log('📝 [OTP Verify] Session after save:', JSON.stringify({
            userId: req.session.userId,
            email: req.session.email,
            sessionID: req.sessionID.slice(0, 8) + '...',
          }));
          resolve();
        }
      });
    });

    // Add small delay to ensure session is fully written to PostgreSQL
    await new Promise(resolve => setTimeout(resolve, 200));

    res.json({
      success: true,
      message: 'OTP verified - proceed to username',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
        role: 'member',
      },
      needsUsername: true,
      sessionExpiresIn: '30 days',
    });

    console.log(`✅ User created after OTP verification: ${normalizedEmail}`);
  } catch (error: unknown) {
    console.error('Signup verification error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const user = await storage.getUserByEmail(email);

    if (!user || !user.password) {
      console.log(`❌ Login failed: User not found or no password for ${email}`);
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      console.log(`❌ Login failed: Invalid password for ${email}`);
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (user.role === 'admin') {
      res.status(403).json({
        error: 'Admin accounts use separate login',
        adminOnly: true
      });
      return;
    }

    // Regenerate session ID for security (prevents session fixation)
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          console.error('Session regenerate error:', err);
          reject(err);
        } else {
          console.log('✅ Session regenerated for login');
          resolve();
        }
      });
    });

    // Set session data after regeneration
    req.session.userId = user.id;
    req.session.email = email;
    req.session.isAdmin = false;
    if (req.session.cookie) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    // Defensive check: Ensure session store is available before saving
    if (!req.sessionStore) {
      console.error('🚨 [Login] No session store available');
      throw new Error('Internal session error: Store unavailable');
    }

    // Save session explicitly and wait for completion
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('?? [Login] Session save error (SID: ' + req.sessionID + '):', err);
          reject(err);
        } else {
          console.log('[Login] Session saved successfully (SID: ' + req.sessionID + ') for user:', user.id, '| userId in session:', req.session.userId);
          resolve();
        }
      });
    });

    // Auto-update unread status or lead counts on login
    try {
      const userLeads = await storage.getLeads({ userId: user.id });
      const unreadCount = userLeads.filter(l => (l.metadata as any)?.isUnread).length;
      console.log(`📊 User ${email} has ${unreadCount} unread leads`);
    } catch (e) {
      console.error('Error fetching leads on login:', e);
    }

    // Add delay to ensure session is committed to PostgreSQL before client makes follow-up requests.
    // Increased to 500ms for high-latency Railway multi-replica environments.
    await new Promise(resolve => setTimeout(resolve, 500));

    // Final safety check - verify session still has userId after save
    console.log(`[Login] Pre-response session check: userId=${req.session.userId}, SID=${req.sessionID}`);

    // Check if account setup is incomplete and restore state
    const isTemporaryUsername = user.username && /\d{13}$/.test(user.username); // Ends with timestamp
    const onboardingProfile = await storage.getOnboardingProfile(user.id);
    const hasCompletedOnboarding = onboardingProfile?.completed || user.metadata?.onboardingCompleted;

    let incompleteSetup = false;
    let nextStep = null;
    let suggestedUsername = null;
    let restoreState = null;

    if (isTemporaryUsername) {
      // User verified OTP but never set a proper username
      incompleteSetup = true;
      nextStep = 'username';
      suggestedUsername = user.email.split('@')[0];
      restoreState = {
        step: 3,
        email: user.email,
        message: 'Continue your signup by choosing a username'
      };
      console.log(`🔄 User ${email} has incomplete setup - restoring to username step`);
    } else if (!hasCompletedOnboarding) {
      // User has username but didn't complete onboarding
      incompleteSetup = true;
      nextStep = 'onboarding';
      restoreState = {
        step: 'onboarding',
        username: user.username,
        email: user.email,
        message: 'Complete your profile setup to get started'
      };
      console.log(`🔄 User ${email} has incomplete setup - restoring to onboarding step`);
    }

    res.json({
      success: true,
      message: incompleteSetup ? 'Account found - continue setup' : 'Logged in successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
        role: 'member',
      },
      incompleteSetup,
      nextStep,
      suggestedUsername,
      restoreState,
      sessionExpiresIn: '30 days',
    });

    console.log(`✅ User logged in: ${email}${incompleteSetup ? ` (restoring to: ${nextStep})` : ''}`);
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
    return;
  }
});

router.post('/refresh-session', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (req.session.cookie) {
      req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    }

    res.json({
      success: true,
      message: 'Session extended',
      sessionExpiresIn: '7 days',
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

router.get('/check-state', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.json({ authenticated: false });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.json({ authenticated: false });
      return;
    }

    // Check account completion state
    const isTemporaryUsername = user.username && /\d{13}$/.test(user.username);
    const onboardingProfile = await storage.getOnboardingProfile(user.id);
    const hasCompletedOnboarding = onboardingProfile?.completed || user.metadata?.onboardingCompleted;

    let incompleteSetup = false;
    let nextStep = null;
    let suggestedUsername = null;
    let restoreState = null;

    if (isTemporaryUsername) {
      incompleteSetup = true;
      nextStep = 'username';
      suggestedUsername = user.email.split('@')[0];
      restoreState = {
        step: 3,
        email: user.email,
        message: 'Continue your signup by choosing a username'
      };
    } else if (!hasCompletedOnboarding) {
      incompleteSetup = true;
      nextStep = 'onboarding';
      restoreState = {
        step: 'onboarding',
        username: user.username,
        email: user.email,
        message: 'Complete your profile setup to get started'
      };
    }

    res.json({
      authenticated: true,
      incompleteSetup,
      nextStep,
      suggestedUsername,
      restoreState,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });
  } catch (error: any) {
    console.error('Check state error:', error);
    res.status(500).json({ error: 'Failed to check state' });
    return;
  }
});

/**
 * POST /api/user/auth/reset-account
 * For users stuck in limbo state - allows them to clear their account and start fresh
 * This preserves their email but resets username and onboarding status
 */
router.post('/reset-account', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };

    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const user = await storage.getUserByEmail(email);

    if (!user) {
      // User doesn't exist - that's fine, they can sign up fresh
      res.json({
        success: true,
        message: 'Account not found - you can sign up fresh',
        action: 'signup',
      });
      return;
    }

    // Reset user to initial state
    const tempUsername = email.split('@')[0] + Date.now();

    await storage.updateUser(user.id, {
      username: tempUsername,
      metadata: {
        onboardingCompleted: false,
        resetAt: new Date().toISOString(),
      },
    });

    // Clear any existing onboarding profile
    const onboardingProfile = await storage.getOnboardingProfile(user.id);
    if (onboardingProfile) {
      await storage.updateOnboardingProfile(user.id, {
        ...onboardingProfile,
        completed: false,
      });
    }

    // Destroy any existing sessions for this user
    req.session.destroy(() => { });

    console.log(`🔄 User account reset for: ${email}`);

    res.json({
      success: true,
      message: 'Account reset. Please login with your email and password to continue.',
      action: 'login',
    });
  } catch (error: unknown) {
    console.error('Reset account error:', error);
    res.status(500).json({ error: 'Failed to reset account' });
  }
});

/**
 * GET /api/user/auth/me
 * Get current authenticated user
 */
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const onboardingProfile = await storage.getOnboardingProfile(userId);
    const metadata = user.metadata as Record<string, unknown> | null;
    const hasCompletedOnboarding = onboardingProfile?.completed || (metadata?.onboardingCompleted as boolean) || false;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role || 'member',
      plan: user.plan,
      avatar: user.avatar,
      subscriptionTier: user.subscriptionTier,
      businessName: user.businessName,
      trialExpiresAt: user.trialExpiresAt,
      createdAt: user.createdAt,
      metadata: {
        ...(metadata || {}),
        onboardingCompleted: hasCompletedOnboarding,
      },
    });
  } catch (error: unknown) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * POST /api/user/auth/logout
 * Logout user and destroy session
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
    });

    res.clearCookie('audnix.sid', {
      path: '/',
    });

    console.log(`👋 User logged out: ${userId || 'unknown'}`);

    if (userId) {
      wsSync.broadcastToUser(userId, { type: 'TERMINATE_SESSION', payload: {} });
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error: unknown) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * POST /api/user/auth/avatar
 * Upload avatar as base64 - stored directly in PostgreSQL (zero setup)
 */
router.post('/avatar', avatarUpload.single('avatar'), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No image provided' });
      return;
    }

    // Convert to base64 data URL
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Store directly in PostgreSQL user record
    await storage.updateUser(userId, { avatar: dataUrl });

    console.log(`✅ Avatar uploaded for user ${userId} (${Math.round(req.file.size / 1024)}KB)`);

    res.json({
      success: true,
      avatar: dataUrl,
      message: 'Avatar updated successfully'
    });
  } catch (error: unknown) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

/**
 * GET /api/user/notifications
 * Get user notifications
 */
router.get('/notifications', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const notifications = await storage.getNotifications(userId);
    res.json({ notifications });
  } catch (error: unknown) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * POST /api/user/notifications/:id/read
 * Mark notification as read (with ownership validation)
 */
router.post('/notifications/:id/read', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    // Verify ownership before marking as read
    const notifications = await storage.getNotifications(userId);
    const notification = notifications.find(n => n.id === id);

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    await storage.markNotificationAsRead(id as string);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * POST /api/user/auth/metadata
 * Update current user's metadata JSON
    const onboardingProfile = await storage.getOnboardingProfile(user.id);
    if (onboardingProfile) {
      await storage.updateOnboardingProfile(user.id, {
        ...onboardingProfile,
        completed: false,
      });
    }

    // Destroy any existing sessions for this user
    req.session.destroy(() => { });

    console.log(`🔄 User account reset for: ${email}`);

    res.json({
      success: true,
      message: 'Account reset. Please login with your email and password to continue.',
      action: 'login',
    });
  } catch (error: unknown) {
    console.error('Reset account error:', error);
    res.status(500).json({ error: 'Failed to reset account' });
  }
});

/**
 * GET /api/user/auth/me
 * Get current authenticated user
 */
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const onboardingProfile = await storage.getOnboardingProfile(userId);
    const metadata = user.metadata as Record<string, unknown> | null;
    const hasCompletedOnboarding = onboardingProfile?.completed || (metadata?.onboardingCompleted as boolean) || false;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role || 'member',
      plan: user.plan,
      avatar: user.avatar,
      subscriptionTier: user.subscriptionTier,
      businessName: user.businessName,
      trialExpiresAt: user.trialExpiresAt,
      createdAt: user.createdAt,
      metadata: {
        ...(metadata || {}),
        onboardingCompleted: hasCompletedOnboarding,
      },
    });
  } catch (error: unknown) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * POST /api/user/auth/logout
 * Logout user and destroy session
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
    });

    res.clearCookie('audnix.sid', {
      path: '/',
    });

    console.log(`👋 User logged out: ${userId || 'unknown'}`);

    if (userId) {
      wsSync.broadcastToUser(userId, { type: 'TERMINATE_SESSION', payload: {} });
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error: unknown) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * POST /api/user/auth/avatar
 * Upload avatar as base64 - stored directly in PostgreSQL (zero setup)
 */
router.post('/avatar', avatarUpload.single('avatar'), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No image provided' });
      return;
    }

    // Convert to base64 data URL
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Store directly in PostgreSQL user record
    await storage.updateUser(userId, { avatar: dataUrl });

    console.log(`✅ Avatar uploaded for user ${userId} (${Math.round(req.file.size / 1024)}KB)`);

    res.json({
      success: true,
      avatar: dataUrl,
      message: 'Avatar updated successfully'
    });
  } catch (error: unknown) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

/**
 * GET /api/user/notifications
 * Get user notifications
 */
router.get('/notifications', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const notifications = await storage.getNotifications(userId);
    res.json({ notifications });
  } catch (error: unknown) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

/**
 * POST /api/user/notifications/:id/read
 * Mark notification as read (with ownership validation)
 */
router.post('/notifications/:id/read', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    // Verify ownership before marking as read
    const notifications = await storage.getNotifications(userId);
    const notification = notifications.find(n => n.id === id);

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    await storage.markNotificationAsRead(id as string);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * POST /api/user/metadata
 * Update current user's metadata JSON
 */
router.post('/metadata', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { metadata } = req.body as { metadata: Record<string, any> };
    if (!metadata) {
      res.status(400).json({ error: 'Metadata required' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const currentMetadata = (user.metadata as Record<string, any>) || {};
    const updatedMetadata = { ...currentMetadata, ...metadata };

    await storage.updateUser(userId, { metadata: updatedMetadata });

    res.json({
      success: true,
      metadata: updatedMetadata,
      message: 'Metadata updated successfully'
    });
  } catch (error: unknown) {
    console.error('Update metadata error:', error);
    res.status(500).json({ error: 'Failed to update metadata' });
  }
});

/**
 * POST /api/user/set-username
 * After OTP verified → User selects username → Saved to DB
 */
router.post('/set-username', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const { username } = req.body as { username: string };

    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!username || username.length < 3 || username.length > 30) {
      res.status(400).json({ error: 'Username must be 3-30 characters' });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      res.status(400).json({ error: 'Only letters, numbers, hyphens and underscores allowed' });
      return;
    }

    const existing = await storage.getUserByUsername(username);
    if (existing && existing.id !== userId) {
      res.status(400).json({ error: 'Username already taken' });
      return;
    }

    const user = await storage.updateUser(userId, { username });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      message: 'Username set successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
        role: user.role
      },
      nextStep: '/dashboard',
    });
  } catch (error: unknown) {
    console.error('Error setting username:', error);
    res.status(500).json({ error: 'Failed to set username' });
  }
});

/**
 * PATCH /api/user/config
 * Update user configuration (e.g., autonomousMode)
 */
router.patch('/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { autonomousMode } = req.body;
    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const newConfig = {
      ...(user.config as any || {}),
      autonomousMode: !!autonomousMode
    };

    const updatedUser = await storage.updateUser(userId, { config: newConfig });
    
    console.log(`🤖 AI Engine toggle for user ${userId}: ${autonomousMode ? 'ON' : 'OFF'}`);

    if (autonomousMode && !(user.config as any)?.autonomousMode) {
      try {
        const { db } = await import('@shared/lib/db/db.js');
        const { followUpQueue } = await import('@audnix/shared');
        const { eq, and, lte } = await import('drizzle-orm');
        
        const overdueJobs = await db.select().from(followUpQueue)
          .where(and(
            eq(followUpQueue.userId, userId),
            eq(followUpQueue.status, 'pending'),
            lte(followUpQueue.scheduledAt, new Date())
          ));
          
        if (overdueJobs.length > 0) {
          console.log(`[Grace Window] Staggering ${overdueJobs.length} overdue jobs for user ${userId}`);
          const intervalMs = (30 * 60 * 1000) / overdueJobs.length;
          
          for (let i = 0; i < overdueJobs.length; i++) {
            const nextTime = new Date(Date.now() + i * intervalMs);
            await db.update(followUpQueue)
              .set({ scheduledAt: nextTime })
              .where(eq(followUpQueue.id, overdueJobs[i].id));
          }
        }
      } catch (err) {
        console.error('Failed to stagger follow up jobs:', err);
      }
    }

    res.json({
      success: true,
      config: updatedUser?.config
    });
  } catch (error) {
    console.error('Error updating user config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

export default router;

