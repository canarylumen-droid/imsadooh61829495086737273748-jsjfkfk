import fs from 'fs';
import path from 'path';

/**
 * QuotaService tracks the database quota status both in-memory and via a persistent file.
 * It provides a centralized way for background workers to check if they
 * should pause or slow down due to database restrictions (e.g. Neon's transfer quota).
 */
class QuotaService {
  private isOverQuota: boolean = false;
  private lastQuotaErrorAt: Date | null = null;
  private readonly QUOTA_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes default recovery window
  private readonly PERSISTENCE_FILE = path.join(process.cwd(), '.quota_restricted');

  constructor() {
    this.loadPersistence();
  }

  private loadPersistence(): void {
    try {
      if (fs.existsSync(this.PERSISTENCE_FILE)) {
        const stats = fs.statSync(this.PERSISTENCE_FILE);
        const elapsed = Date.now() - stats.mtimeMs;
        
        if (elapsed < this.QUOTA_COOLDOWN_MS) {
          this.isOverQuota = true;
          this.lastQuotaErrorAt = stats.mtime;
          console.warn(`🕒 [QuotaService] Resumed restriction from persistent flag. Remaining: ${Math.round((this.QUOTA_COOLDOWN_MS - elapsed) / 1000)}s`);
        } else {
          this.resetQuota();
        }
      }
    } catch (e) {
      console.error('[QuotaService] Failed to load persistence:', e);
    }
  }

  private savePersistence(): void {
    try {
      fs.writeFileSync(this.PERSISTENCE_FILE, new Date().toISOString());
    } catch (e) {
      console.error('[QuotaService] Failed to save persistence:', e);
    }
  }

  private clearPersistence(): void {
    try {
      if (fs.existsSync(this.PERSISTENCE_FILE)) {
        fs.unlinkSync(this.PERSISTENCE_FILE);
      }
    } catch (e) {
      console.error('[QuotaService] Failed to clear persistence:', e);
    }
  }

  /**
   * Updates the quota status based on observed database errors.
   */
  public reportDbError(error: any): void {
    const errorBody = typeof error === 'string' ? error : JSON.stringify(error);
    const errorMessage = (error?.message || error?.error || errorBody || '').toLowerCase();
    const errorCode = (error?.code || error?.error_code || '').toString().toUpperCase();
    
    // Detect variations of quota/transfer/maintenance errors
    const isQuotaError = 
        errorMessage.includes('exceeded the data transfer quota') || 
        errorMessage.includes('quota exceeded') ||
        errorMessage.includes('database is currently undergoing maintenance') ||
        errorMessage.includes('temporary capacity limits') ||
        errorCode === 'QUOTA_EXCEEDED' ||
        errorCode === '503' || // Service Unavailable
        errorCode === '504' || // Gateway Timeout (sometimes caused by DB saturation)
        (error?.code === 'XX000' && errorMessage.includes('quota'));
    
    if (isQuotaError) {
      if (!this.isOverQuota) {
        console.error('🚨 [QuotaService] Database quota restriction active! Pausing background operations.');
      }
      
      this.isOverQuota = true;
      this.lastQuotaErrorAt = new Date();
      this.savePersistence();
    }
  }

  /**
   * Resets the quota status manually (e.g. via admin action or automated check).
   */
  public resetQuota(): void {
    if (this.isOverQuota) {
      console.log('✅ [QuotaService] Database quota restriction reset.');
    }
    this.isOverQuota = false;
    this.lastQuotaErrorAt = null;
    this.clearPersistence();
  }

  /**
   * Checks if the system is currently under quota restrictions.
   * Automatically recovers after the cooldown period if no new errors are reported.
   */
  public isRestricted(): boolean {
    if (!this.isOverQuota) return false;

    // Auto-recovery check
    if (this.lastQuotaErrorAt) {
      const elapsed = Date.now() - this.lastQuotaErrorAt.getTime();
      if (elapsed > this.QUOTA_COOLDOWN_MS) {
        this.resetQuota();
        return false;
      }
    }

    return true;
  }

  /**
   * Returns the time remaining until auto-recovery.
   */
  public getRemainingCooldownMs(): number {
    if (!this.isOverQuota || !this.lastQuotaErrorAt) return 0;
    const elapsed = Date.now() - this.lastQuotaErrorAt.getTime();
    return Math.max(0, this.QUOTA_COOLDOWN_MS - elapsed);
  }

  /**
   * Returns a standard middleware that blocks requests if restricted.
   */
  public getSentinelMiddleware() {
    return (req: any, res: any, next: any) => {
      if (this.isRestricted()) {
        const remaining = Math.round(this.getRemainingCooldownMs() / 1000);
        return res.status(503).json({
          error: "Service Temporarily Unavailable",
          message: "The database is currently undergoing maintenance or has reached its temporary capacity limits. We are automatically throttling requests to preserve system integrity.",
          code: "QUOTA_EXCEEDED",
          retryAfter: remaining
        });
      }
      next();
    };
  }
}

export const quotaService = new QuotaService();
