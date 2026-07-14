import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';

/**
 * THE "SYSTEM AUDIT" WATCHDOG DAEMON
 * Runs every 60 seconds to detect stuck leads, auto-release them, and optimize throughput.
 */

export function startActiveWatchdog() {
  const INTERVAL_MS = 60 * 1000; // 60 seconds
  const STUCK_THRESHOLD_MINUTES = 10;

  console.log(`[ActiveWatchdog] 👁️ System Audit Daemon armed (sweep every 60s)`);

  setInterval(async () => {
    try {
      if (!db) return;

      // 1. Auto-Release "Stuck" Processing Leads
      // Any lead in 'processing' state for > 10 minutes without completion gets released back to 'pending'
      // We JOIN outreach_campaigns to retrieve the user_id for WebSocket notifications since
      // campaign_leads does not store user_id directly.
      const released = await db.execute(sql`
        UPDATE campaign_leads cl
        SET 
          status = 'pending',
          integration_id = NULL,
          updated_at = NOW()
        FROM outreach_campaigns oc
        WHERE cl.campaign_id = oc.id
          AND cl.status = 'processing' 
          AND cl.updated_at < NOW() - (${STUCK_THRESHOLD_MINUTES} * INTERVAL '1 minute')
        RETURNING cl.id, cl.campaign_id, oc.user_id;
      `);

      if (released.rows.length > 0) {
        console.warn(`[ActiveWatchdog] 🔄 Auto-released ${released.rows.length} stuck leads back to pending queue.`);
        
        // Notify affected users
        const affectedUsers = new Set(released.rows.map((r: any) => r.user_id));
        affectedUsers.forEach((userId: any) => {
          clusterSync.broadcast('WATCHDOG_ALERT', userId as string, {
            type: 'stuck_leads_released',
            count: released.rows.filter((r: any) => r.user_id === userId).length,
            message: 'Stuck leads have been auto-released and re-queued.'
          });
        });
      }

      // 2. Throughput Optimization (Auto-Detect Throttling)
      // Identify mailboxes that are consistently underperforming/stuck (status processing for a long time)
      const fleetMetrics = await db.execute(sql`
        SELECT integration_id, COUNT(*) as stuck_count
        FROM campaign_leads
        WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '5 minutes'
        GROUP BY integration_id
        HAVING COUNT(*) > 10;
      `);

      if (fleetMetrics.rows.length > 0) {
        console.warn(`[ActiveWatchdog] ⚠️ Detected ${fleetMetrics.rows.length} potentially throttling mailboxes. Fleet adjustment required.`);
        // In a full implementation, this would trigger an event to `autonomous-scaler.ts` 
        // to lower the dailyLimit dynamically for these specific `integration_id`s.
      }

    } catch (error: any) {
      console.error('[ActiveWatchdog] ❌ Daemon Error:', error.message);
    }
  }, INTERVAL_MS);
}
