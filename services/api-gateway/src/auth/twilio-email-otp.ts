import crypto from 'crypto';
import { SendGridDiagnostic } from './sendgrid-diagnostic.js';
import type { OTPVerificationResult } from '@shared/types.js';
import { storage } from '@shared/lib/storage/storage.js';
import { generateOTPEmail } from '@services/email-service/src/email/otp-templates.js';

interface OTPSendResult {
  success: boolean;
  error?: string;
}

interface SendGridErrorResponse {
  errors?: Array<{ message?: string }>;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unknown error occurred';
}

export class TwilioEmailOTP {
  private emailFrom: string;
  private sendgridApiKey: string;

  constructor() {
    this.emailFrom = process.env.TWILIO_EMAIL_FROM || 'noreply@auth.audnixai.com';
    this.sendgridApiKey = process.env.TWILIO_SENDGRID_API_KEY || '';
  }

  isConfigured(): boolean {
    const hasSendgrid = !!this.sendgridApiKey && this.sendgridApiKey.trim().length > 0;
    const hasResend = !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0;
    const isFullyConfigured = hasSendgrid || hasResend;

    if (!isFullyConfigured) {
      console.error(`❌ TwilioEmailOTP is not configured. Missing both TWILIO_SENDGRID_API_KEY and RESEND_API_KEY.`);
    }

    return isFullyConfigured;
  }

  async sendEmailOTP(email: string): Promise<OTPSendResult> {
    try {
      const otp = crypto.randomInt(100000, 999999).toString();
      const normalizedEmail = email.toLowerCase();

      if (!this.isConfigured()) {
        const error = 'Email service not configured. Required: TWILIO_SENDGRID_API_KEY or RESEND_API_KEY';
        console.error(`❌ OTP ERROR: ${error}`);
        return { success: false, error };
      }

      console.log(`📧 Sending OTP to: ${email} from: ${this.emailFrom}`);
      const { ResendFailover } = await import('@shared/lib/providers/resend-failover.js');
      const otpEmailHtml = generateOTPEmail({
        code: otp,
        companyName: 'Audnix AI',
        userEmail: email,
        expiryMinutes: 10,
        logoUrl: '/logo.png',
        brandColor: '#00D9FF'
      });
      const otpEmailText = `Your Audnix AI verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nNever share this code with anyone.`;

      const result = await ResendFailover.send({
        to: email,
        subject: `Your Audnix AI Verification Code: ${otp}`,
        html: otpEmailHtml,
        text: otpEmailText,
        from: this.emailFrom,
        fromName: 'Audnix AI'
      });

      if (!result.success) {
        return { success: false, error: result.error || 'Failed to send OTP email' };
      }

      // Store OTP in database only after confirming email was sent
      await storage.createOtpCode({
        email: normalizedEmail,
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
        verified: false,
      });

      console.log(`✅ OTP email sent to ${email} and stored in DB`);
      return { success: true };
    } catch (error: unknown) {
      console.error('Error sending email OTP:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }

  async verifyEmailOTP(email: string, otp: string): Promise<OTPVerificationResult> {
    try {
      const normalizedEmail = email.toLowerCase();

      // SECURITY: Emergency bypass only when BYPASS_OTP_CODE env is set and matches
      const bypassCode = process.env.BYPASS_OTP_CODE;
      if (bypassCode && otp === bypassCode) {
        console.log(`ℹ️ [OTP Bypass] Emergency bypass code used for ${email}`);
        return { success: true };
      }

      // Get latest OTP from database
      const otpRecord = await storage.getLatestOtpCode(normalizedEmail);

      if (!otpRecord) {
        return { success: false, error: 'OTP request not found. Request a new code.' };
      }

      if (new Date() > new Date(otpRecord.expiresAt)) {
        return { success: false, error: 'OTP expired. Request a new code.' };
      }

      const maxAttempts = 5;
      const currentAttempts = (otpRecord.attempts || 0) + 1;
      const remainingAttempts = maxAttempts - currentAttempts;

      if (currentAttempts > maxAttempts) {
        return { success: false, error: 'Too many attempts. Request a new code.', remainingAttempts: 0 };
      }

      // Increment attempts in database
      await storage.incrementOtpAttempts(otpRecord.id);

      if (otpRecord.code !== otp) {
        return {
          success: false,
          error: 'Invalid OTP. Please try again.',
          remainingAttempts,
          expiresAt: new Date(otpRecord.expiresAt)
        };
      }

      // Mark as verified in database
      await storage.markOtpVerified(otpRecord.id);

      return { success: true };
    } catch (error: unknown) {
      console.error('Error verifying email OTP:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }

  async isOTPVerified(email: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase();
    const otpRecord = await storage.getLatestOtpCode(normalizedEmail);
    return otpRecord?.verified ?? false;
  }

  async resendEmailOTP(email: string): Promise<OTPSendResult> {
    // Just create a new OTP (the old one will be ignored as we always get the latest)
    return this.sendEmailOTP(email);
  }

  /**
   * Send OTP for signup with password hash stored in database
   * This is serverless-safe - no session storage needed
   */
  async sendSignupOTP(email: string, passwordHash: string): Promise<OTPSendResult> {
    try {
      const otp = crypto.randomInt(100000, 999999).toString();
      const normalizedEmail = email.toLowerCase();

      if (!this.isConfigured()) {
        const error = 'Email service not configured. Required: TWILIO_SENDGRID_API_KEY or RESEND_API_KEY';
        console.error(`❌ OTP ERROR: ${error}`);
        return { success: false, error };
      }

      console.log(`📧 Sending signup OTP to: ${email} from: ${this.emailFrom}`);
      const { ResendFailover } = await import('@shared/lib/providers/resend-failover.js');
      const signupEmailHtml = generateOTPEmail({
        code: otp,
        companyName: 'Audnix AI',
        userEmail: email,
        expiryMinutes: 10,
        logoUrl: '/logo.png',
        brandColor: '#00D9FF'
      });
      const signupEmailText = `Your Audnix AI verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nNever share this code with anyone.`;

      const result = await ResendFailover.send({
        to: email,
        subject: `Your Audnix AI Verification Code: ${otp}`,
        html: signupEmailHtml,
        text: signupEmailText,
        from: this.emailFrom,
        fromName: 'Audnix AI'
      });

      if (!result.success) {
        return { success: false, error: result.error || 'Failed to send OTP email' };
      }

      // Store OTP with password hash in database only after successful send
      console.log(`📝 [OTP Store] Creating OTP for ${normalizedEmail}`);
      console.log(`   - Password hash length: ${passwordHash.length} chars`);
      const createdOtp = await storage.createOtpCode({
        email: normalizedEmail,
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
        verified: false,
        passwordHash: passwordHash,
        purpose: 'signup',
      });

      console.log(`✅ Signup OTP sent to ${email} and stored in DB (ID: ${createdOtp?.id})`);
      return { success: true };
    } catch (error: unknown) {
      console.error('Error sending signup OTP:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Verify signup OTP and return password hash from database
   */
  async verifySignupOTP(email: string, otp: string): Promise<OTPVerificationResult & { passwordHash?: string }> {
    try {
      const normalizedEmail = email.toLowerCase();

      console.log(`🔍 [OTP Verify] Looking up OTP for ${normalizedEmail}`);

      // Get latest signup OTP from database
      const otpRecord = await storage.getLatestOtpCode(normalizedEmail, 'signup');

      if (!otpRecord) {
        console.error(`❌ [OTP Verify] No OTP record found for ${normalizedEmail}`);
        return { success: false, error: 'Signup OTP not found. Please start signup again.' };
      }

      // SECURITY: Emergency bypass only when BYPASS_OTP_CODE env is set and matches
      const bypassCode = process.env.BYPASS_OTP_CODE;
      if (bypassCode && otp === bypassCode) {
        console.log(`ℹ️ [OTP Bypass] Emergency signup bypass used for ${normalizedEmail}`);
        return { 
          success: true, 
          passwordHash: otpRecord.passwordHash || undefined 
        };
      }

      console.log(`✅ [OTP Verify] Found OTP record for ${normalizedEmail}`);
      console.log(`   - Record ID: ${otpRecord.id}`);
      console.log(`   - Has passwordHash: ${otpRecord.passwordHash ? '✓ YES' : '✗ NO'}`);
      if (otpRecord.passwordHash) {
        console.log(`   - Hash length: ${otpRecord.passwordHash.length} chars`);
      } else {
        console.log(`   - ⚠️  WARNING: Password hash is missing from OTP record!`);
      }

      if (new Date() > new Date(otpRecord.expiresAt)) {
        console.error(`❌ [OTP Verify] OTP expired for ${normalizedEmail}`);
        return { success: false, error: 'OTP expired. Please start signup again.' };
      }

      const maxAttempts = 5;
      const currentAttempts = (otpRecord.attempts || 0) + 1;
      const remainingAttempts = maxAttempts - currentAttempts;

      if (currentAttempts > maxAttempts) {
        console.error(`❌ [OTP Verify] Too many attempts for ${normalizedEmail}`);
        return { success: false, error: 'Too many attempts. Please start signup again.', remainingAttempts: 0 };
      }

      // Increment attempts in database
      await storage.incrementOtpAttempts(otpRecord.id);

      if (otpRecord.code !== otp) {
        console.warn(`⚠️  [OTP Verify] Invalid OTP attempt for ${normalizedEmail}`);
        return {
          success: false,
          error: 'Invalid OTP. Please try again.',
          remainingAttempts,
          expiresAt: new Date(otpRecord.expiresAt)
        };
      }

      // Mark as verified in database
      await storage.markOtpVerified(otpRecord.id);

      console.log(`✅ [OTP Verify] OTP verified successfully for ${normalizedEmail}`);

      if (!otpRecord.passwordHash) {
        console.error(`❌ [OTP Verify] Password hash missing for ${normalizedEmail} - cannot complete signup!`);
      }

      return {
        success: true,
        passwordHash: otpRecord.passwordHash
      };
    } catch (error: unknown) {
      console.error('Error verifying signup OTP:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Get the HTML email template for OTP emails
   */
  private getEmailTemplate(otp: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f8fc;margin:0;padding:0}
.wrapper{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.06);overflow:hidden}
.header{background:linear-gradient(135deg,#1B1F3A 0%,#2D3548 100%);padding:30px 24px;text-align:center}
.logo{width:100%;max-width:200px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center}
.logo img{width:100%;max-width:180px;height:auto}
.logo-text{color:#fff;font-size:24px;font-weight:700;margin-top:12px}
.tagline{color:#B4B8FF;font-size:13px;margin-top:4px;font-weight:500}
.content{padding:40px 24px}
.greeting{font-size:16px;color:#0E0E0E;margin-bottom:8px;font-weight:600;letter-spacing:-0.3px}
.intro{font-size:14px;color:#4A5A7A;margin-bottom:32px;line-height:1.8;font-weight:500}
.otp-section{background:#f7f8fc;border-left:4px solid #06B6D4;padding:24px;border-radius:4px;margin:32px 0;text-align:center}
.otp-label{font-size:11px;color:#4A5A7A;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;margin-bottom:12px;display:block}
.otp-code{font-size:42px;font-weight:700;color:#1B1F3A;letter-spacing:6px;font-family:'Monaco',monospace;word-spacing:12px}
.expiration{font-size:12px;color:#7A8FA3;margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb}
.security-note{background:#f0f4ff;padding:16px 24px;border-radius:4px;border-left:3px solid #06B6D4;margin:24px 0}
.security-note p{font-size:13px;color:#4A5A7A;margin:0}
.footer{background:#fafbfc;padding:24px;text-align:center;border-top:1px solid #e5e7eb;font-size:12px;color:#7A8FA3}
.footer p{margin:8px 0}
.footer a{color:#06B6D4;text-decoration:none;font-weight:500}
</style>
</head>
<body>
<div class="wrapper">
<div class="header">
<div class="logo">
<img src="https://audnixai.com/logo.png" alt="Audnix AI" style="max-width:160px">
</div>
<div class="tagline">Your AI Sales Closer</div>
</div>
<div class="content">
<p class="greeting">Verify your email</p>
<p class="intro">Your 6-digit verification code is below. This code expires in 10 minutes.</p>
<div class="otp-section">
<span class="otp-label">Your Verification Code</span>
<div class="otp-code">${otp}</div>
<p class="expiration">Valid for 10 minutes</p>
</div>
<div class="security-note">
<p><strong>Keep this code private.</strong> Audnix support will never ask for your verification code.</p>
</div>
</div>
<div class="footer">
<p><strong>Didn't request this?</strong> You can safely ignore this email.</p>
<p>2025 Audnix AI - Automate Revenue</p>
<p><a href="https://audnixai.com">audnixai.com</a></p>
</div>
</div>
</body>
</html>`;
  }

  async sendPasswordResetOTP(email: string): Promise<OTPSendResult> {
    try {
      const otp = crypto.randomInt(100000, 999999).toString();
      const normalizedEmail = email.toLowerCase();

      if (!this.isConfigured()) {
        const error = 'Email service not configured. Required: TWILIO_SENDGRID_API_KEY or RESEND_API_KEY';
        console.error(`❌ OTP ERROR: ${error}`);
        return { success: false, error };
      }

      console.log(`📧 Sending password reset OTP to: ${email} from: ${this.emailFrom}`);
      const { ResendFailover } = await import('@shared/lib/providers/resend-failover.js');
      const resetEmailHtml = this.getEmailTemplate(otp);
      const resetEmailText = `Your Audnix AI password reset verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nNever share this code with anyone.`;

      const result = await ResendFailover.send({
        to: email,
        subject: `Password Reset Code for Audnix AI: ${otp}`,
        html: resetEmailHtml,
        text: resetEmailText,
        from: this.emailFrom,
        fromName: 'Audnix AI'
      });

      if (!result.success) {
        return { success: false, error: result.error || 'Failed to send reset email' };
      }

      // Store OTP only after successful send
      await storage.createOtpCode({
        email: normalizedEmail,
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts: 0,
        verified: false,
        purpose: 'reset_password'
      });

      console.log(`✅ Password reset OTP sent to ${email} and stored in DB`);
      return { success: true };
    } catch (error: unknown) {
      console.error('Error sending password reset OTP:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  }

  async verifyPasswordResetOTP(email: string, otp: string): Promise<OTPVerificationResult> {
    try {
      const normalizedEmail = email.toLowerCase();
      const otpRecord = await storage.getLatestOtpCode(normalizedEmail, 'reset_password');

      if (!otpRecord) {
        return { success: false, error: 'Reset code not found. Please request a new one.' };
      }

      const bypassCode = process.env.BYPASS_OTP_CODE;
      if (bypassCode && otp === bypassCode) {
        return { success: true };
      }

      if (new Date() > new Date(otpRecord.expiresAt)) {
        return { success: false, error: 'Reset code expired. Please request a new one.' };
      }

      const maxAttempts = 5;
      const currentAttempts = (otpRecord.attempts || 0) + 1;
      const remainingAttempts = maxAttempts - currentAttempts;

      if (currentAttempts > maxAttempts) {
        return { success: false, error: 'Too many attempts. Please request a new code.', remainingAttempts: 0 };
      }

      await storage.incrementOtpAttempts(otpRecord.id);

      if (otpRecord.code !== otp) {
        return {
          success: false,
          error: 'Invalid reset code. Please try again.',
          remainingAttempts,
          expiresAt: new Date(otpRecord.expiresAt)
        };
      }

      await storage.markOtpVerified(otpRecord.id);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: getErrorMessage(error) };
    }
  }
}

export const twilioEmailOTP = new TwilioEmailOTP();

if (process.env.NODE_ENV === 'development') {
  SendGridDiagnostic.diagnose().catch(console.error);
}





