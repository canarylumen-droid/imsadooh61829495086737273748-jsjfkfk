import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { twilioEmailOTP } from '@services/api-gateway/src/auth/twilio-email-otp.js';
import { storage } from '@shared/lib/storage/storage.js';
import { rateLimit } from 'express-rate-limit';
import { SESSION_COOKIE_NAME } from '../config/session.js';

const router = Router();

/**
 * OTP_ENABLED Feature Flag
 * Set to false to bypass OTP verification during signup.
 */
const OTP_ENABLED = process.env.OTP_ENABLED !== 'false';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Too many auth attempts' },
});

router.post('/signup/request-otp', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    const existing = await storage.getUserByEmail(email);
    if (existing) {
      res.status(200).json({ success: true, message: 'Account exists. Please login.', redirectToLogin: true });
      return;
    }

    if (!twilioEmailOTP.isConfigured()) {
      console.error(`❌ [OTP] Email service NOT configured. Missing both TWILIO_SENDGRID_API_KEY and RESEND_API_KEY`);
      res.status(503).json({
        error: 'Email service not configured',
        details: 'Missing required email service API keys: TWILIO_SENDGRID_API_KEY or RESEND_API_KEY (from SendGrid or Resend)',
        configured: false
      });
      return;
    }

    if (!OTP_ENABLED) {
      console.log(`ℹ️ [OTP Bypass] OTP is disabled in auth-clean. Skipping send for ${email}`);
      res.json({
        success: true,
        message: 'OTP verification is currently bypassed',
        otpEnabled: false,
        bypass: true
      });
      return;
    }

    const result = await twilioEmailOTP.sendEmailOTP(email);

    if (!result.success) {
      res.status(400).json({ error: result.error || 'Failed to send OTP' });
      return;
    }

    res.json({
      success: true,
      message: 'OTP sent to your email',
      expiresIn: '10 minutes',
    });
  } catch (error: unknown) {
    console.error('Signup OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

interface SignupVerifyBody {
  email?: string;
  otp?: string;
  password?: string;
  username?: string;
}

router.post('/signup/verify-otp', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, password, username } = req.body as SignupVerifyBody;

    if (!email || !otp || !password || !username) {
      res.status(400).json({ error: 'Email, OTP, password, and username required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    if (username.length < 3) {
      res.status(400).json({ error: 'Username must be at least 3 characters' });
      return;
    }

    if (!OTP_ENABLED) {
      console.log(`ℹ️ [OTP Bypass] Verification skipped for ${email} because OTP_ENABLED is false`);
    } else {
      const verifyResult = await twilioEmailOTP.verifyEmailOTP(email, otp);
      if (!verifyResult.success) {
        res.status(400).json({ error: verifyResult.error });
        return;
      }
    }

    const existingUsername = await storage.getUserByUsername(username);
    if (existingUsername) {
      res.status(400).json({ error: 'Username already taken' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const vipEmails = ['team.replyflow@gmail.com', 'fortuneuchendu708@gmail.com'];
    const isVip = vipEmails.includes(email.toLowerCase());

    const user = await storage.createUser({
      email,
      username,
      password: hashedPassword,
      plan: isVip ? 'enterprise' : 'trial',
      subscriptionTier: isVip ? 'enterprise' : undefined,
    });

    req.session.userId = user.id;
    req.session.email = email;
    if (req.session.cookie) {
      req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    }

    // Explicitly save session before responding for serverless reliability
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('[Signup] Session save error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Small delay to ensure DB persistence
    await new Promise(resolve => setTimeout(resolve, 100));

    res.json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
      },
      sessionExpiresIn: '7 days',
    });

    console.log(`✅ New user signed up: ${email}`);
  } catch (error: unknown) {
    console.error('Signup verification error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

interface LoginBody {
  email?: string;
  password?: string;
}

router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as LoginBody;

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

    req.session.userId = user.id;
    req.session.email = email;
    if (req.session.cookie) {
      req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    }

    // Explicitly save session before responding for serverless reliability
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('[Login] Session save error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Small delay to ensure DB persistence
    await new Promise(resolve => setTimeout(resolve, 100));

    res.json({
      success: true,
      message: 'Logged in successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
      },
      sessionExpiresIn: '7 days',
    });

    console.log(`✅ User logged in: ${email}`);
  } catch (error: unknown) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/refresh-session', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;

    res.json({
      success: true,
      message: 'Session extended',
      sessionExpiresIn: '7 days',
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

router.post(['/logout', '/signout'], (req: Request, res: Response): void => {
  req.session.destroy((err: Error | undefined) => {
    if (err) {
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

/**
 * POST /api/user/auth/forgot-password
 * Request a password reset OTP code
 */
router.post('/forgot-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as { email?: string };

    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!email || !emailRegex.test(email)) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const user = await storage.getUserByEmail(normalizedEmail);

    if (!user) {
      res.status(404).json({ error: 'No account found with this email. Please check the spelling or sign up.' });
      return;
    }

    console.log(`🔑 [Forgot Password - Clean] Requesting password reset OTP for ${normalizedEmail}`);
    const result = await twilioEmailOTP.sendPasswordResetOTP(normalizedEmail);

    if (!result.success) {
      console.error(`❌ [Forgot Password FAILED - Clean] ${normalizedEmail} - Error: ${result.error}`);
      res.status(500).json({ error: result.error || 'Failed to send recovery email' });
      return;
    }

    console.log(`✅ [Forgot Password SUCCESS - Clean] Recovery code sent to ${normalizedEmail}`);
    res.json({
      success: true,
      message: 'Recovery verification code sent to your email',
      expiresIn: '10 minutes'
    });
  } catch (error: unknown) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

/**
 * POST /api/user/auth/reset-password
 * Verify OTP and reset password to a new one
 */
router.post('/reset-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp, newPassword } = req.body as { email?: string; otp?: string; newPassword?: string };

    if (!email || !otp || !newPassword) {
      res.status(400).json({ error: 'Email, OTP code, and new password are required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const user = await storage.getUserByEmail(normalizedEmail);

    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    // Verify OTP first
    const verifyResult = await twilioEmailOTP.verifyPasswordResetOTP(normalizedEmail, otp);
    if (!verifyResult.success) {
      res.status(400).json({ error: verifyResult.error });
      return;
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await storage.updateUser(user.id, {
      password: hashedPassword,
      metadata: {
        ...(user.metadata as any || {}),
        passwordLastReset: new Date().toISOString()
      }
    });

    console.log(`✅ [Password Reset SUCCESS - Clean] Password reset successfully for ${normalizedEmail}`);
    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });
  } catch (error: unknown) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

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

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
      },
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
