import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { encrypt, decrypt } from '@shared/lib/crypto/encryption.js';
import { revocationService } from '@services/api-gateway/src/oauth/revocation-service.js';
import nodemailer from 'nodemailer';
const Mail = nodemailer;

const router = Router();

interface SmtpConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  fromEmail?: string;
  fromName?: string;
  secure?: boolean;
  verified?: boolean;
}

interface UserSettings {
  emailProvider: string;
  smtp: SmtpConfig;
  notifications: {
    emailEnabled: boolean;
    dailyDigest: boolean;
    weeklyReport: boolean;
  };
  automation: {
    autoRespond: boolean;
    autoBookMeetings: boolean;
    voiceNotes: boolean;
  };
  sync: {
    intervalSeconds: number;
    lastSyncAt: string | null;
  };
  meetingLink: string | null;
  brandContext: any;
}

router.get('/', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const result = await db.execute(sql`
      SELECT * FROM user_settings WHERE user_id = ${userId}
    `);

    if (result.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO user_settings (user_id) VALUES (${userId})
        ON CONFLICT (user_id) DO NOTHING
      `);

      res.json({
        emailProvider: 'sendgrid',
        smtp: { verified: false },
        notifications: { emailEnabled: true, dailyDigest: true, weeklyReport: true },
        automation: { autoRespond: true, autoBookMeetings: true, voiceNotes: true },
        sync: { intervalSeconds: 30, lastSyncAt: null },
      });
      return;
    }

    const row = result.rows[0] as any;

    let smtpPassword: string | undefined;
    if (row.smtp_password_encrypted) {
      try {
        smtpPassword = decrypt(row.smtp_password_encrypted);
      } catch {
        smtpPassword = undefined;
      }
    }

    const settings: UserSettings = {
      emailProvider: row.email_provider || 'sendgrid',
      smtp: {
        host: row.smtp_host || undefined,
        port: parseInt(String(row.smtp_port)) || 587,
        username: row.smtp_username || undefined,
        password: smtpPassword ? '••••••••' : undefined,
        fromEmail: row.smtp_from_email || undefined,
        fromName: row.smtp_from_name || undefined,
        secure: row.smtp_secure !== false,
        verified: row.smtp_verified === true,
      },
      notifications: {
        emailEnabled: row.email_notifications_enabled !== false,
        dailyDigest: row.daily_digest_enabled !== false,
        weeklyReport: row.weekly_report_enabled !== false,
      },
      automation: {
        autoRespond: row.auto_respond_enabled !== false,
        autoBookMeetings: row.auto_book_meetings !== false,
        voiceNotes: row.voice_notes_enabled !== false,
      },
      sync: {
        intervalSeconds: row.sync_interval_seconds || 30,
        lastSyncAt: row.last_sync_at?.toISOString() || null,
      },
      meetingLink: row.meeting_link || null,
      brandContext: row.brand_context || {},
    };

    res.json(settings);
  } catch (error) {
    console.error('Error fetching user settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.put('/smtp', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { host, port, username, password, fromEmail, fromName, secure } = req.body;
    const parsedPort = port ? parseInt(String(port)) : 587;

    if (!host || !username || !fromEmail) {
      res.status(400).json({ error: 'Host, username, and from email are required' });
      return;
    }

    // Phase 11 Fix: Validate that the SMTP username and fromEmail share the same domain.
    // Sending from "bob@domain.com" while SMTP auth is "alice@other.com" will cause
    // the email to show as spoofed, triggering spam flags from Gmail/Outlook.
    const usernameDomain = username.includes('@') ? username.split('@')[1].toLowerCase() : null;
    const fromEmailDomain = fromEmail.includes('@') ? fromEmail.split('@')[1].toLowerCase() : null;
    if (usernameDomain && fromEmailDomain && usernameDomain !== fromEmailDomain) {
      res.status(400).json({
        error: `Identity mismatch: SMTP username (${username}) and From email (${fromEmail}) must share the same domain. Mismatches cause spam flags.`
      });
      return;
    }

    const encryptedPassword = password ? encrypt(password) : null;

    await db.execute(sql`
      INSERT INTO user_settings (
        user_id, email_provider, smtp_host, smtp_port, smtp_username, 
        smtp_password_encrypted, smtp_from_email, smtp_from_name, smtp_secure, smtp_verified
      )
      VALUES (
        ${userId}, 'custom_smtp', ${host}, ${parsedPort}, ${username},
        ${encryptedPassword}, ${fromEmail}, ${fromName || null}, ${secure !== false}, false
      )
      ON CONFLICT (user_id) DO UPDATE SET
        email_provider = 'custom_smtp',
        smtp_host = ${host},
        smtp_port = ${parsedPort},
        smtp_username = ${username},
        smtp_password_encrypted = COALESCE(${encryptedPassword}, user_settings.smtp_password_encrypted),
        smtp_from_email = ${fromEmail},
        smtp_from_name = ${fromName || null},
        smtp_secure = ${secure !== false},
        smtp_verified = false,
        updated_at = NOW()
    `);

    // Notify other clients about settings update
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId, { smtpUpdated: true });

    res.json({ success: true, message: 'SMTP settings saved. Test connection to verify.' });
  } catch (error) {
    console.error('Error saving SMTP settings:', error);
    res.status(500).json({ error: 'Failed to save SMTP settings' });
  }
});


router.post('/smtp/test', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const result = await db.execute(sql`
      SELECT smtp_host, smtp_port, smtp_username, smtp_password_encrypted, 
             smtp_from_email, smtp_from_name, smtp_secure
      FROM user_settings WHERE user_id = ${userId}
    `);

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'No SMTP settings configured' });
      return;
    }

    const row = result.rows[0] as any;

    if (!row.smtp_host || !row.smtp_password_encrypted) {
      res.status(400).json({ error: 'Incomplete SMTP configuration' });
      return;
    }

    let password: string;
    try {
      password = decrypt(row.smtp_password_encrypted);
    } catch {
      res.status(400).json({ error: 'Failed to decrypt SMTP password' });
      return;
    }

    const transporter = nodemailer.createTransport({
      host: row.smtp_host,
      port: parseInt(String(row.smtp_port)) || 587,
      secure: row.smtp_secure && parseInt(String(row.smtp_port)) === 465,
      auth: {
        user: row.smtp_username,
        pass: password,
      },
      connectionTimeout: 10000,
    });

    await transporter.verify();
    transporter.close();

    await db.execute(sql`
      UPDATE user_settings 
      SET smtp_verified = true, smtp_last_tested_at = NOW(), updated_at = NOW()
      WHERE user_id = ${userId}
    `);

    // Trigger immediate historic sync for the inbox
    try {
      const { emailSyncWorker } = await import('@services/email-service/src/email/email-sync-worker.js');
      const integration = await storage.getIntegration(userId, 'custom_email');
      if (integration) {
        // Run in background to not block the response
        emailSyncWorker.syncUserEmails(userId, integration).catch((err: any) =>
          console.error(`[DeepSync] background sync failed for ${userId}:`, err)
        );
      }
    } catch (syncErr: any) {
      console.warn('Failed to trigger background deep sync:', syncErr);
    }

    res.json({ success: true, message: 'SMTP connection verified successfully! Initial inbox sync started.' });
  } catch (error: any) {
    console.error('SMTP test failed:', error);
    res.status(400).json({
      error: 'SMTP connection failed',
      details: error.message || 'Check your credentials and server settings'
    });
  }
});

router.put('/notifications', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { emailEnabled, dailyDigest, weeklyReport } = req.body;

    await db.execute(sql`
      INSERT INTO user_settings (user_id, email_notifications_enabled, daily_digest_enabled, weekly_report_enabled)
      VALUES (${userId}, ${emailEnabled !== false}, ${dailyDigest !== false}, ${weeklyReport !== false})
      ON CONFLICT (user_id) DO UPDATE SET
        email_notifications_enabled = ${emailEnabled !== false},
        daily_digest_enabled = ${dailyDigest !== false},
        weekly_report_enabled = ${weeklyReport !== false},
        updated_at = NOW()
    `);

    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId, { notificationsUpdated: true, emailEnabled, dailyDigest, weeklyReport });

    res.json({ success: true, message: 'Notification preferences saved' });
  } catch (error) {
    console.error('Error saving notification settings:', error);
    res.status(500).json({ error: 'Failed to save notification settings' });
  }
});

router.put('/automation', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { autoRespond, autoBookMeetings, voiceNotes } = req.body;

    await db.execute(sql`
      INSERT INTO user_settings (user_id, auto_respond_enabled, auto_book_meetings, voice_notes_enabled)
      VALUES (${userId}, ${autoRespond !== false}, ${autoBookMeetings !== false}, ${voiceNotes !== false})
      ON CONFLICT (user_id) DO UPDATE SET
        auto_respond_enabled = ${autoRespond !== false},
        auto_book_meetings = ${autoBookMeetings !== false},
        voice_notes_enabled = ${voiceNotes !== false},
        updated_at = NOW()
    `);

    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId, { automationUpdated: true, autoRespond, autoBookMeetings, voiceNotes });

    res.json({ success: true, message: 'Automation preferences saved' });
  } catch (error) {
    console.error('Error saving automation settings:', error);
    res.status(500).json({ error: 'Failed to save automation settings' });
  }
});

router.put('/profile', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { meetingLink, brandContext, calendarLink, brandGuidelinePdfUrl, brandGuidelinePdfText, offerValue } = req.body;

    await db.execute(sql`
      INSERT INTO user_settings (user_id, meeting_link, brand_context)
      VALUES (${userId}, ${meetingLink || null}, ${brandContext || '{}'})
      ON CONFLICT (user_id) DO UPDATE SET
        meeting_link = ${meetingLink || null},
        brand_context = ${brandContext || '{}'},
        updated_at = NOW()
    `);

    // Update user table for main fields (this internally triggers wsSync.notifySettingsUpdated for the main profile)
    await storage.updateUser(userId, {
      calendarLink: calendarLink,
      brandGuidelinePdfUrl: brandGuidelinePdfUrl,
      brandGuidelinePdfText: brandGuidelinePdfText,
      offerValue: offerValue !== undefined ? Number(offerValue) : undefined
    });

    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId, { profileUpdated: true });

    res.json({ success: true, message: 'Profile settings saved' });
  } catch (error) {
    console.error('Error saving profile settings:', error);
    res.status(500).json({ error: 'Failed to save profile settings' });
  }
});

router.post('/sync', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    await db.execute(sql`
      UPDATE user_settings SET last_sync_at = NOW() WHERE user_id = ${userId}
    `);

    res.json({ success: true, syncedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error updating sync:', error);
    res.status(500).json({ error: 'Failed to update sync' });
  }
});

router.post('/sync/force', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Trigger immediate deep sync across all providers
    const integrations = await storage.getIntegrations(userId);
    const emailIntegrations = integrations.filter((i: any) =>
      ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected
    );

    if (emailIntegrations.length === 0) {
      res.status(400).json({ error: 'No email accounts connected' });
      return;
    }

    const { emailSyncWorker } = await import('@services/email-service/src/email/email-sync-worker.js');

    // Sync each integration in background
    for (const integration of emailIntegrations) {
      emailSyncWorker.syncUserEmails(userId, integration, 500).catch(err =>
        console.error(`Force sync failed for ${userId} (${integration.provider}):`, err)
      );
    }

    await db.execute(sql`
      UPDATE user_settings SET last_sync_at = NOW() WHERE user_id = ${userId}
    `);

    res.json({ success: true, message: 'Deep sync triggered for all connected mailboxes.' });
  } catch (error) {
    console.error('Error in force sync:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

router.post('/account/schedule-deletion', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Schedule deletion 24-48 hours from now (randomized)
    const hoursUntil = 24 + Math.floor(Math.random() * 24);
    const scheduledAt = new Date(Date.now() + hoursUntil * 60 * 60 * 1000).toISOString();

    await db.execute(sql`
      UPDATE users SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{scheduledDeletionAt}', to_jsonb(${scheduledAt}::text))
      WHERE id = ${userId}
    `);

    res.json({ success: true, message: 'Account scheduled for deletion.', scheduledAt });
  } catch (error) {
    console.error('Error scheduling account deletion:', error);
    res.status(500).json({ error: 'Failed to schedule account deletion.' });
  }
});

router.post('/account/cancel-deletion', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    await db.execute(sql`
      UPDATE users SET metadata = metadata - 'scheduledDeletionAt'
      WHERE id = ${userId}
    `);

    res.json({ success: true, message: 'Deletion cancelled.' });
  } catch (error) {
    console.error('Error cancelling account deletion:', error);
    res.status(500).json({ error: 'Failed to cancel deletion.' });
  }
});

router.get('/account/deletion-status', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const result = await db.execute(sql`
      SELECT metadata->>'scheduledDeletionAt' as scheduled_deletion_at FROM users WHERE id = ${userId}
    `);

    const scheduledAt = result.rows[0]?.scheduled_deletion_at as string | undefined;
    if (!scheduledAt) {
      res.json({ scheduledDeletionAt: null });
      return;
    }

    const now = new Date();
    const deletionDate = new Date(scheduledAt as string);
    const remainingMs = deletionDate.getTime() - now.getTime();
    const canUndo = remainingMs > 0;

    res.json({
      scheduledDeletionAt: scheduledAt,
      remainingMs: Math.max(0, remainingMs),
      canUndo,
    });
  } catch (error) {
    console.error('Error fetching deletion status:', error);
    res.status(500).json({ error: 'Failed to fetch deletion status.' });
  }
});

// Direct deletion endpoint (used when countdown expires)
router.delete('/account', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    await revocationService.revokeAllAndDestroyUser(userId);

    try {
      (req as any).logout?.((err: any) => {
        if (err) console.error("Error during logout:", err);
      });
    } catch {}
    
    if (req.session) {
      req.session.destroy(() => {});
    }

    res.json({ success: true, message: 'Account deleted.' });
  } catch (error: any) {
    console.error('Error during account deletion:', error);
    const message = error?.message || 'Failed to delete account.';
    res.status(500).json({ error: message });
  }
});

// Process expired scheduled deletions (called during auth check)
async function processExpiredDeletions(): Promise<void> {
  try {
    const now = new Date().toISOString();
    const result = await db.execute(sql`
      SELECT id, metadata->>'scheduledDeletionAt' as scheduled_deletion_at
      FROM users
      WHERE metadata->>'scheduledDeletionAt' IS NOT NULL
      AND metadata->>'scheduledDeletionAt' <= ${now}
    `);

    for (const row of result.rows as any[]) {
      try {
        console.log(`[AccountDeletion] Processing expired deletion for user ${row.id}`);
        await revocationService.revokeAllAndDestroyUser(row.id);
        console.log(`[AccountDeletion] Successfully deleted user ${row.id}`);
      } catch (err) {
        console.error(`[AccountDeletion] Failed to delete user ${row.id}:`, err);
      }
    }
  } catch (error) {
    console.error('[AccountDeletion] Error processing expired deletions:', error);
  }
}

// Run expired deletion processor every minute
setInterval(processExpiredDeletions, 60_000);
processExpiredDeletions();

export default router;

