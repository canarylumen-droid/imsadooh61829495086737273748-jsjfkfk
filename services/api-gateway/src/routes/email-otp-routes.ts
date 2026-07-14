import { Router, Request, Response } from 'express';
import { twilioEmailOTP } from '@services/api-gateway/src/auth/twilio-email-otp.js';
import { storage } from '@shared/lib/storage/storage.js';
import { rateLimit } from 'express-rate-limit';

const router = Router();

interface RequestOTPBody {
  email: string;
}

interface VerifyOTPBody {
  email: string;
  otp: string;
}

interface ResendOTPBody {
  email: string;
}

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/auth/email-otp/request
 * Request OTP for email
 */
router.post('/email-otp/request', otpLimiter, async (req: Request<Record<string, string>, unknown, RequestOTPBody>, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    const hasSendgridKey = !!process.env.TWILIO_SENDGRID_API_KEY;
    const emailFrom = process.env.TWILIO_EMAIL_FROM || 'auth@audnixai.com';
    
    console.log(`📧 OTP Request for: ${email}`);
    console.log(`🔐 SendGrid Config - API Key: ${hasSendgridKey}`);
    console.log(`📬 Email From: ${emailFrom}`);

    if (!twilioEmailOTP.isConfigured()) {
      console.error('❌ OTP Service Not Configured');
      res.status(503).json({ error: 'Email OTP service not configured' });
      return;
    }

    const result = await twilioEmailOTP.sendEmailOTP(email);

    if (!result.success) {
      console.error(`❌ OTP Send Failed: ${result.error}`);
      res.status(400).json({ error: result.error || 'Failed to send OTP' });
      return;
    }

    console.log(`✅ OTP Sent Successfully to ${email}`);
    res.json({
      success: true,
      message: 'OTP sent to your email',
      expiresIn: '10 minutes',
    });
  } catch (error) {
    console.error('Error requesting email OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

/**
 * POST /api/auth/email-otp/verify
 * Verify OTP and login
 */
router.post('/email-otp/verify', otpLimiter, async (req: Request<Record<string, string>, unknown, VerifyOTPBody>, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      res.status(400).json({ error: 'Email and OTP required' });
      return;
    }

    const verifyResult = await twilioEmailOTP.verifyEmailOTP(email, otp);

    if (!verifyResult.success) {
      res.status(400).json({ error: verifyResult.error });
      return;
    }

    let user = await storage.getUserByEmail(email);

    if (!user) {
      user = await storage.createUser({
        email,
        username: email.split('@')[0],
        plan: 'trial',
      });
    }

    req.session.userId = user.id;
    req.session.email = email;

    res.json({
      success: true,
      message: 'Logged in successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        plan: user.plan,
      },
    });
  } catch (error) {
    console.error('Error verifying email OTP:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/auth/email-otp/resend
 * Resend OTP
 */
router.post('/email-otp/resend', otpLimiter, async (req: Request<Record<string, string>, unknown, ResendOTPBody>, res: Response): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const result = await twilioEmailOTP.resendEmailOTP(email);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      message: 'New OTP sent to your email',
    });
  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

export default router;
