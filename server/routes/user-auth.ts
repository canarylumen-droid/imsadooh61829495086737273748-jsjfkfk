import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { twilioEmailOTP } from '../lib/auth/twilio-email-otp.js';
import { storage } from '../storage.js';
import { rateLimit } from 'express-rate-limit';
import { wsSync } from '../lib/websocket-sync.js';

const router = Router();
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
  message: 'Too many auth attempts',
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

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

    const vipEmails = ['team.replyflow@gmail.com', 'fortuneuchendu708@gmail.com'];
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
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
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

    // Save session explicitly and wait for completion
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          reject(err);
        } else {
          console.log('✅ Session saved successfully for user:', user.id);
          console.log('📝 [Login] Session data:', JSON.stringify({
            userId: req.session.userId,
            email: req.session.email,
            sessionID: req.sessionID.slice(0, 8) + '...',
          }));
          resolve();
        }
      });
    });

    // Add small delay to ensure session is written to PostgreSQL
    await new Promise(resolve => setTimeout(resolve, 150));

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

    await storage.markNotificationRead(id);
    res.json({ success: true });
  } catch (error: unknown) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

/**
 * POST /api/user/auth/metadata
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
 * POST /api/user/auth/set-username
 * After OTP verified → User selects username → Saved to DB
 */
router.post('/set-username', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    const { username } = req.body as { username: string };

    console.log('📝 [set-username] Request received');
    console.log('📝 [set-username] Session data:', JSON.stringify({
      userId: req.session?.userId,
      email: req.session?.email,
      cookie: req.session?.cookie
    }));

    if (!userId) {
      console.error('❌ [set-username] Session missing or expired');
      res.status(401).json({
        error: 'Not authenticated',
        hint: 'Session may have expired. Please login again.'
      });
      return;
    }

    if (!username || username.length < 3 || username.length > 30) {
      res.status(400).json({ error: 'Username must be 3-30 characters' });
      return;
    }

    // Validate username format
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      res.status(400).json({ error: 'Only letters, numbers, hyphens and underscores allowed' });
      return;
    }

    // Check if username taken
    const existing = await storage.getUserByUsername(username);
    if (existing && existing.id !== userId) {
      res.status(400).json({ error: 'Username already taken' });
      return;
    }

    // Update user
    const user = await storage.updateUser(userId, { username });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    console.log(`✅ Username updated successfully for user ${userId}: ${username}`);

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

export default router;
