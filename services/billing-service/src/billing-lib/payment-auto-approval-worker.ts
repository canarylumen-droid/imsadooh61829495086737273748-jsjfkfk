import { storage } from '@shared/lib/storage/storage.js';
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { db } from '@shared/lib/db/db.js';
import { users } from "@audnix/shared";
import { eq, and, isNotNull, inArray, ne } from "drizzle-orm";

interface AutoApprovalStats {
  checked: number;
  approved: number;
  errors: number;
  lastRun: Date;
}

class PaymentAutoApprovalWorker {
  private processingInterval: ReturnType<typeof setInterval> | null = null;
  private stats: AutoApprovalStats = {
    checked: 0,
    approved: 0,
    errors: 0,
    lastRun: new Date(),
  };
  private isProcessing = false;
  private lastLogTime: number = 0; // To control log frequency

  /**
   * Start the auto-approval worker
   * Runs every 30 seconds to check and auto-upgrade pending payments
   */
  start() {
    if (this.processingInterval) {
      console.warn("Auto-approval worker already running");
      return;
    }

    console.log("🚀 Payment auto-approval worker started (checks every 30s, 24/7 auto-upgrade)");

    this.processingInterval = setInterval(async () => {
      if (!this.isProcessing) {
        await this.processPendingPayments();
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop the auto-approval worker
   */
  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log("⏹️  Payment auto-approval worker stopped");
    }
  }

  /**
   * Process all pending payments and auto-approve them
   */
  private async processPendingPayments() {
    if (quotaService.isRestricted()) {
      // Don't spam logs for this worker as it runs every 30s
      return;
    }
    try {
      this.isProcessing = true;
      const now = new Date();
      const currentTime = now.getTime();

      if (!db) return;

      // Direct targeted query for pending users to save bandwidth/quota
      const pendingUsers = await db.select().from(users).where(
        and(
          eq(users.paymentStatus, "pending"),
          isNotNull(users.pendingPaymentPlan)
        )
      );

      this.stats.checked += 1;

      if (pendingUsers.length === 0) {
        // Only log every 30 seconds (once per interval) to avoid spam if no activity
        if (currentTime - this.lastLogTime > 30000) {
          console.log(`✅ Auto-approval check: 0 pending payments found`);
          this.lastLogTime = currentTime;
        }
        return;
      }

      // Log only when there are actual pending payments
      console.log(
        `💳 Auto-approval: Found ${pendingUsers.length} pending payment(s)`
      );

      // Auto-approve each pending payment
      for (const user of pendingUsers) {
        try {
          const plan = (user.pendingPaymentPlan || "starter") as "trial" | "starter" | "pro" | "enterprise";
          const email = user.email;

          // Upgrade user immediately
          await storage.updateUser(user.id, {
            plan,
            paymentStatus: "approved",
            pendingPaymentPlan: null,
            pendingPaymentAmount: null,
            pendingPaymentDate: null,
            paymentApprovedAt: now,
          });

          this.stats.approved += 1;

          console.log(
            `✅ AUTO-APPROVED: ${email} → ${plan} plan (upgraded immediately, no admin needed)`
          );
        } catch (error: any) {
          this.stats.errors += 1;
          console.error(
            `❌ Error auto-approving user ${user.id}:`,
            error.message
          );
        }
      }

      // 3. Process whitelisted users (Dynamic check from ENV)
      const whitelistRaw = process.env.WHITELISTED_EMAILS || '';
      const whitelist = whitelistRaw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

      if (whitelist.length > 0) {
        const usersToUpgrade = await db.select().from(users).where(
          and(
            inArray(users.email, whitelist),
            ne(users.plan, 'pro')
          )
        );

        for (const user of usersToUpgrade) {
          try {
            await storage.updateUser(user.id, {
              plan: 'pro',
              paymentStatus: 'approved',
              paymentApprovedAt: now
            });
            console.log(`💎 WHITELIST UPGRADE: ${user.email} -> pro plan (granted via whitelist)`);
          } catch (err: any) {
            console.error(`❌ Whitelist upgrade error for ${user.email}:`, err.message);
          }
        }
      }

      this.stats.lastRun = now;
      this.lastLogTime = currentTime; // Update last log time when activity occurs

      workerHealthMonitor.recordSuccess('payment-auto-approval-worker');
    } catch (error: any) {
      this.stats.errors += 1;
      console.error("❌ Error in payment auto-approval worker:", error.message);
      quotaService.reportDbError(error);
      workerHealthMonitor.recordError('payment-auto-approval-worker', error.message || 'Unknown error');
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get worker statistics
   */
  getStats() {
    return {
      ...this.stats,
      status: this.processingInterval ? "running" : "stopped",
      uptime: new Date().getTime() - this.stats.lastRun.getTime(),
    };
  }
}

// Export singleton instance
export const paymentAutoApprovalWorker = new PaymentAutoApprovalWorker();





