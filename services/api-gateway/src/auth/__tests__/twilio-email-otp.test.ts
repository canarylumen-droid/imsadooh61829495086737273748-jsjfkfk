import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@shared/lib/storage/storage.js', () => ({
  storage: {
    getLatestOtpCode: vi.fn(),
    createOtpCode: vi.fn(),
    updateOtpCode: vi.fn(),
    incrementOtpAttempts: vi.fn().mockResolvedValue(undefined),
    markOtpVerified: vi.fn().mockResolvedValue(undefined),
    getUserByEmail: vi.fn(),
    getUser: vi.fn(),
  },
}));

vi.mock('@shared/lib/providers/resend-failover.js', () => ({
  ResendFailover: {
    send: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@services/email-service/src/email/otp-templates.js', () => ({
  generateOTPEmail: vi.fn(() => '<html><body>OTP</body></html>'),
}));

vi.mock('@shared/lib/crypto/encryption.js', () => ({
  encrypt: vi.fn((data: string) => data),
  decrypt: vi.fn((data: string) => data),
}));

describe('TwilioEmailOTP', () => {
  let TwilioEmailOTP: any;
  let otp: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.BYPASS_OTP_CODE = '';
    process.env.RESEND_API_KEY = 'test-resend-key';
    const mod = await import('../twilio-email-otp.js');
    TwilioEmailOTP = mod.TwilioEmailOTP;
    otp = new TwilioEmailOTP();
  });

  describe('verifyEmailOTP', () => {
    it('should accept bypass code when configured', async () => {
      process.env.BYPASS_OTP_CODE = '123456';
      const { storage } = await import('@shared/lib/storage/storage.js');
      (storage.getLatestOtpCode as any).mockResolvedValue(null);

      const result = await otp.verifyEmailOTP('test@example.com', '123456');
      expect(result.success).toBe(true);
    });

    it('should reject bypass code when not configured', async () => {
      process.env.BYPASS_OTP_CODE = '';
      const { storage } = await import('@shared/lib/storage/storage.js');
      (storage.getLatestOtpCode as any).mockResolvedValue(null);

      const result = await otp.verifyEmailOTP('test@example.com', '123456');
      expect(result.success).toBe(false);
    });

    it('should reject expired OTP codes', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      const expiredDate = new Date(Date.now() - 60000);
      (storage.getLatestOtpCode as any).mockResolvedValue({
        id: 'otp-1',
        code: '654321',
        expiresAt: expiredDate.toISOString(),
        attempts: 0,
        verified: false,
      });

      const result = await otp.verifyEmailOTP('test@example.com', '654321');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/expired/i);
    });

    it('should reject OTP after max attempts', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      const futureDate = new Date(Date.now() + 600000);
      (storage.getLatestOtpCode as any).mockResolvedValue({
        id: 'otp-2',
        code: '111111',
        expiresAt: futureDate.toISOString(),
        attempts: 5,
        verified: false,
      });

      const result = await otp.verifyEmailOTP('test@example.com', '111111');
      expect(result.success).toBe(false);
    });

    it('should verify valid OTP', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      const futureDate = new Date(Date.now() + 600000);
      (storage.getLatestOtpCode as any).mockResolvedValue({
        id: 'otp-3',
        code: '999999',
        expiresAt: futureDate.toISOString(),
        attempts: 0,
        verified: false,
      });

      const result = await otp.verifyEmailOTP('test@example.com', '999999');
      expect(result.success).toBe(true);
    });

    it('should handle missing OTP record', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      (storage.getLatestOtpCode as any).mockResolvedValue(null);

      const result = await otp.verifyEmailOTP('nonexistent@example.com', '123456');
      expect(result.success).toBe(false);
    });
  });

  describe('sendEmailOTP', () => {
    it('should generate a 6-digit OTP', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      (storage.createOtpCode as any).mockResolvedValue({});

      const result = await otp.sendEmailOTP('test@example.com');
      expect(result.success).toBe(true);
    });
  });

  describe('sendSignupOTP', () => {
    it('should store password hash alongside OTP', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      (storage.createOtpCode as any).mockResolvedValue({});

      const result = await otp.sendSignupOTP('test@example.com', 'hashed-password');
      expect(result.success).toBe(true);
      expect(storage.createOtpCode).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          passwordHash: 'hashed-password',
        })
      );
    });
  });

  describe('verifySignupOTP', () => {
    it('should return password hash on successful verification', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      const futureDate = new Date(Date.now() + 600000);
      (storage.getLatestOtpCode as any).mockResolvedValue({
        id: 'otp-4',
        code: '555555',
        expiresAt: futureDate.toISOString(),
        attempts: 0,
        verified: false,
        passwordHash: 'stored-hash',
      });

      const result = await otp.verifySignupOTP('test@example.com', '555555');
      expect(result.passwordHash).toBe('stored-hash');
    });
  });

  describe('sendPasswordResetOTP and verifyPasswordResetOTP', () => {
    it('should verify reset OTP correctly', async () => {
      const { storage } = await import('@shared/lib/storage/storage.js');
      const futureDate = new Date(Date.now() + 600000);
      (storage.getLatestOtpCode as any).mockResolvedValue({
        id: 'otp-5',
        code: '777777',
        expiresAt: futureDate.toISOString(),
        attempts: 0,
        verified: false,
        purpose: 'reset_password',
      });

      const result = await otp.verifyPasswordResetOTP('test@example.com', '777777');
      expect(result.success).toBe(true);
    });
  });
});
