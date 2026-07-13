import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { otpCodes } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { multiProviderEmailFailover } from '@services/email-service/src/email/multi-provider-failover.js';
import { generateOTPEmail } from '@services/email-service/src/email/otp-templates.js';
import { authLimiter } from '../middleware/rate-limit.js';
import crypto from 'crypto';

const router = Router();

interface SendOTPBody {
  email: string;
}

interface VerifyOTPBody {
  code: string;
  email: string;
}

interface ResendOTPBody {
  email: string;
}

/**
 * Generate and send OTP code
 */
router.post('/send', requireAuth, authLimiter, async (req: Request<Record<string, string>, unknown, SendOTPBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Valid email required' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Secure OTP Generation
    const otp = crypto.randomInt(100000, 999999).toString();

    await storage.createOtpCode({
      email,
      code: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      verified: false
    });

    const htmlContent = generateOTPEmail({
      code: otp,
      companyName: user.company || 'Audnix AI',
      userEmail: email,
      expiryMinutes: 10,
      logoUrl: user.metadata?.logoUrl as string | undefined,
      brandColor: (user.metadata?.brandColor as string) || '#00D9FF'
    });

    const result = await multiProviderEmailFailover.send({
      to: email,
      subject: '🔐 Your Audnix AI Verification Code',
      html: htmlContent,
      from: `noreply@${user.company?.toLowerCase().replace(/\s+/g, '') || 'audnix'}.com`
    }, userId);

    if (!result.success) {
      console.error('OTP send failed:', result.error);
      res.status(500).json({
        error: 'Failed to send OTP',
        details: result.error
      });
      return;
    }

    res.json({
      success: true,
      message: 'OTP sent successfully',
      provider: result.provider,
      expiresIn: '10 minutes',
      codeLength: otp.length
    });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

/**
 * Verify OTP code
 */
router.post('/verify', requireAuth, authLimiter, async (req: Request<Record<string, string>, unknown, VerifyOTPBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { code, email } = req.body;

    if (!code || !email) {
      res.status(400).json({ error: 'Code and email required' });
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Invalid code format' });
      return;
    }

    const otpRecords = await db.select().from(otpCodes).where(
      and(
        eq(otpCodes.email, email),
        eq(otpCodes.code, code),
        eq(otpCodes.verified, false)
      )
    ).limit(1);

    if (!otpRecords || otpRecords.length === 0) {
      console.log(`❌ OTP verification failed for ${email}: Code not found or already used`);
      res.status(400).json({
        success: false,
        error: 'Invalid or expired code'
      });
      return;
    }

    const otpRecord = otpRecords[0];

    if (new Date() > new Date(otpRecord.expiresAt)) {
      console.log(`❌ OTP expired for ${email}`);
      res.status(400).json({
        success: false,
        error: 'Code has expired'
      });
      return;
    }

    if (otpRecord.attempts >= 5) {
      console.log(`❌ Max attempts exceeded for ${email}`);
      res.status(400).json({
        success: false,
        error: 'Too many failed attempts. Please request a new code.'
      });
      return;
    }

    await db.update(otpCodes)
      .set({ verified: true, attempts: otpRecord.attempts + 1 })
      .where(eq(otpCodes.id, otpRecord.id));

    console.log(`✅ OTP verified successfully for ${email}`);

    res.json({
      success: true,
      message: 'Code verified successfully',
      email: email
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

/**
 * Resend OTP (rate-limited)
 */
router.post('/resend', requireAuth, authLimiter, async (req: Request<Record<string, string>, unknown, ResendOTPBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Secure OTP Generation
    const otp = crypto.randomInt(100000, 999999).toString();

    await storage.createOtpCode({
      email,
      code: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      verified: false
    });

    const htmlContent = generateOTPEmail({
      code: otp,
      companyName: user.company || 'Audnix AI',
      userEmail: email,
      expiryMinutes: 10,
      logoUrl: user.metadata?.logoUrl as string | undefined,
      brandColor: (user.metadata?.brandColor as string) || '#00D9FF'
    });

    const result = await multiProviderEmailFailover.send({
      to: email,
      subject: '🔐 Your Audnix AI Verification Code (Resend)',
      html: htmlContent,
      from: `noreply@${user.company?.toLowerCase().replace(/\s+/g, '') || 'audnix'}.com`
    }, userId);

    if (!result.success) {
      res.status(500).json({ error: 'Failed to resend OTP' });
      return;
    }

    res.json({
      success: true,
      message: 'OTP resent successfully',
      provider: result.provider
    });
  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

export default router;
