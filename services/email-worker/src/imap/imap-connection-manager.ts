/**
 * Production-Grade IMAP Connection Manager
 *
 * - integrationId is the primary key everywhere (Redis, BullMQ, logs)
 * - Redis state tracking so orphan rebalance works across Railway redeploys
 * - Per-host circuit breaker (5 failures / 60s → 15-min cool-off)
 * - Lua atomic claim prevents double-connect across replicas
 * - AUTH_FAILED → marks DB + notifies UI, never reconnects
 * - Proactive 29-min recycle (<50ms downtime)
 * - Reactive reconnect: 0 → 100ms → 500ms → 2s → 10s → 30s with ±25% jitter
 * - NOOP heartbeat every 5 min + Redis TTL refresh
 * - Cap: MAX_SOCKETS per replica, rejects beyond that
 */

import { ImapFlow } from 'imapflow';
import {
  imapConnectionsActive,
  imapReconnectTotal,
  imapErrorsTotal,
  imapMailEventsTotal,
} from '@shared/lib/monitoring/metrics-service.js';
import { storage } from '@shared/lib/storage/storage.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
let gmailOAuth: any = null;
let outlookOAuth: any = null;

async function ensureGmailOAuth() {
  if (!gmailOAuth) {
    try {
      gmailOAuth = (await import('@services/api-gateway/src/oauth/gmail.js')).gmailOAuth;
    } catch {
      console.warn('[IMAP] Gmail OAuth module not available (email-worker deployed separately)');
    }
  }
  return gmailOAuth;
}

async function ensureOutlookOAuth() {
  if (!outlookOAuth) {
    try {
      outlookOAuth = (await import('@services/api-gateway/src/oauth/outlook.js')).outlookOAuth;
    } catch {
      console.warn('[IMAP] Outlook OAuth module not available (email-worker deployed separately)');
    }
  }
  return outlookOAuth;
}
import { emailSyncQueue } from '@shared/lib/queues/email-sync-queue.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';
import { getRedisClient } from '@shared/lib/redis/redis.js';
import { IMAP_KEYS, IMAP_TTL, CIRCUIT_BREAKER } from '@shared/lib/redis/imap-keys.js';
import { imapCircuitTrippedTotal, imapCircuitStatus } from '@shared/lib/monitoring/metrics-service.js';
import { pushMailboxToRustMonitor, removeMailboxFromRustMonitor, buildMailboxConfig } from '@shared/lib/realtime/mailbox-monitor-bridge.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImapIntegration {
  id: string;
  userId: string;
  provider: string;
  accountType?: string | null;
  encryptedMeta?: string | null;
}

interface ImapClientData {
  client: ImapFlow;
  integration: ImapIntegration;
  host: string;
  reconnectDelay: number;
  heartbeatInterval: NodeJS.Timeout;
  recycleTimeout: NodeJS.Timeout;
  reconnectTimeout?: NodeJS.Timeout;
  /** True while a proactive recycle is in progress — suppresses reactive reconnect race */
  isRecycling: boolean;
  /** True while a reactive reconnect is queued — prevents dual reconnect timers */
  isReconnecting: boolean;
  /** Consecutive heartbeat failures — forces reconnect after 3 */
  heartbeatFailures: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECYCLE_TIME     = 14 * 60 * 1000; // 14 min proactive recycle (under 15-min OAuth window)
const HEARTBEAT_TIME   =  30 * 1000;     // 30s NOOP + Redis TTL refresh — near-instant
// 50 mailboxes per pod: ~10MB/connection × 50 = 500MB IMAP budget.
// Keeps event loop fast (<5ms latency per IDLE event) and isolates crashes.
// Scale out by adding replicas (TOTAL_REPLICAS env var), not increasing this cap.
const MAX_SOCKETS      = parseInt(process.env.IMAP_MAX_SOCKETS || '50', 10);
// Memory guard: refuse new connections if heap exceeds this threshold.
// Triggers Redis signal so the watchdog knows to spin up another pod.
const MAX_HEAP_MB      = parseInt(process.env.IMAP_MAX_HEAP_MB || '400', 10);
const WORKER_ID        = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || `worker-${process.pid}`;

/** Jitter ±25% of a delay value */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

/** Backoff ladder: 0 → 100ms → 500ms → 2s → 10s → 30s */
const BACKOFF_LADDER = [0, 100, 500, 2_000, 10_000, 30_000];
function nextBackoff(current: number): number {
  // Find nearest ladder rung below current to handle jittered values
  let idx = -1;
  for (let i = BACKOFF_LADDER.length - 1; i >= 0; i--) {
    if (current >= BACKOFF_LADDER[i]) { idx = i; break; }
  }
  const next = idx >= 0 && idx < BACKOFF_LADDER.length - 1
    ? BACKOFF_LADDER[idx + 1]
    : 30_000;
  return jitter(next);
}

// ─── Lua Script: Atomic Claim ─────────────────────────────────────────────────
// Returns 1 if this replica claimed the integration, 0 if already owned by another.
const LUA_CLAIM = `
  if redis.call("EXISTS", KEYS[1]) == 0 then
    redis.call("HSET", KEYS[1],
      "workerId", ARGV[1],
      "userId",   ARGV[2],
      "host",     ARGV[3],
      "status",   "CONNECTING",
      "connectedAt", ARGV[4],
      "lastHeartbeat", ARGV[4]
    )
    redis.call("EXPIRE", KEYS[1], ${IMAP_TTL.active})
    redis.call("SADD", KEYS[2], ARGV[5])
    -- Legacy Sync: Grab legacy lock so email-service backs off
    redis.call("SET", KEYS[3], ARGV[1], "EX", 300)
    return 1
  else
    return 0
  end
`;

// ─── ImapConnectionManager ────────────────────────────────────────────────────

export class ImapConnectionManager {
  private connections: Map<string, ImapClientData> = new Map(); // Key: integrationId

  // ── Public API ──────────────────────────────────────────────────────────────

  get connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Connect and enter IDLE for the given integrationId.
   * Atomically claims ownership in Redis before connecting.
   */
  async connectMailbox(integrationId: string): Promise<void> {
    if (this.connections.has(integrationId)) {
      // Already managed by this process — idempotent
      return;
    }

    if (this.connections.size >= MAX_SOCKETS) {
      console.warn(`[IMAP] Replica ${WORKER_ID} at socket cap (${MAX_SOCKETS}). Rejecting ${integrationId}.`);
      imapErrorsTotal.inc({ type: 'cap_exceeded', provider: 'unknown' });
      await this._signalCapReached();
      return;
    }

    // Memory guard — reject before we OOM-kill the entire pod
    const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    if (heapMB > MAX_HEAP_MB) {
      console.warn(`[IMAP] Replica ${WORKER_ID} memory pressure — heap=${heapMB}MB > ${MAX_HEAP_MB}MB. Rejecting ${integrationId}.`);
      imapErrorsTotal.inc({ type: 'memory_pressure', provider: 'unknown' });
      await this._signalCapReached();
      return;
    }

    try {
      const integration = await storage.getIntegrationById(integrationId);
      if (!integration || !integration.connected) {
        console.warn(`[IMAP] Integration ${integrationId} not found or disconnected. Skipping.`);
        return;
      }

      await this._establishConnection(integration as ImapIntegration);
    } catch (error: any) {
      console.error(`[IMAP] connectMailbox failed for ${integrationId}:`, error.message);
      imapErrorsTotal.inc({ type: 'setup_failed', provider: 'unknown' });
    }
  }

  /**
   * Gracefully disconnect a mailbox and clean up Redis state.
   */
  async disconnectMailbox(integrationId: string): Promise<void> {
    const data = this.connections.get(integrationId);
    if (!data) return;

    this._cleanupClientTimers(data);
    this.connections.delete(integrationId);
    imapConnectionsActive.dec({ provider: data.integration.provider });

    try {
      await data.client.logout();
    } catch {
      try { data.client.close(); } catch (err) { console.warn('[IMAP] Failed to close client on disconnect:', (err as any)?.message); }
    }
    await this._redisRelease(integrationId);
    await this._workerLoadUpdate();

    // Remove from Rust mailbox monitor
    if (data.integration.provider === 'custom_email') {
      removeMailboxFromRustMonitor(integrationId).catch(() => {});
    }

    console.log(`[IMAP] Cleanly disconnected ${integrationId}`);
  }

  /**
   * Disconnect all mailboxes — called on SIGTERM.
   */
  async disconnectAll(): Promise<void> {
    console.log(`[IMAP] Shutting down — disconnecting ${this.connections.size} mailboxes...`);
    await Promise.allSettled(
      Array.from(this.connections.keys()).map(id => this.disconnectMailbox(id))
    );

    // Remove this worker from the load sorted set
    try {
      const redis = await getRedisClient();
      if (redis) await redis.zRem(IMAP_KEYS.workerLoad(), WORKER_ID);
    } catch { /* ignore on shutdown */ }

    console.log('[IMAP] All mailboxes disconnected.');
  }

  /**
   * Register this worker replica in Redis load tracking.
   * Call once on worker boot.
   */
  async registerWorker(): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.zAdd(IMAP_KEYS.workerLoad(), { score: 0, value: WORKER_ID });
        console.log(`[IMAP] Worker ${WORKER_ID} registered in load tracker.`);
        
        // Start Global Zombie Watchdog
        this._startGlobalWatchdog();
      }
    } catch (err: any) {
      console.warn('[IMAP] Failed to register worker in Redis:', err.message);
    }
  }

  /**
   * Periodic watchdog:
   * 1) Cleans up stale entries in this pod's own worker set.
   * 2) Detects orphans from OTHER dead pods by scanning workerLoad + stale heartbeats.
   *    Dead pods → orphaned integration IDs pushed to Redis orphans list for
   *    the boot-time watchdog to reclaim.
   */
  private _watchdogInterval: NodeJS.Timeout | null = null;

  dispose(): void {
    if (this._watchdogInterval) {
      clearInterval(this._watchdogInterval);
      this._watchdogInterval = null;
    }
  }

  private _startGlobalWatchdog(): void {
    if (this._watchdogInterval) return;
    this._watchdogInterval = setInterval(async () => {
      try {
        const redis = await getRedisClient();
        if (!redis) return;

        const now = Date.now();

        // ── Phase 1: Local cleanup ─────────────────────────────────────────
        const myIntegrations = await redis.sMembers(IMAP_KEYS.workerSet(WORKER_ID));
        for (const id of myIntegrations) {
          const key = IMAP_KEYS.active(id);
          const state = await redis.hGetAll(key);

          if (!state || Object.keys(state).length === 0) {
            console.warn(`[WATCHDOG] Local orphan ${id} (no active key). Cleaning up.`);
            await redis.sRem(IMAP_KEYS.workerSet(WORKER_ID), id);
            continue;
          }

          const lastHB = parseInt(state.lastHeartbeat || '0', 10);
          if (state.status === 'CONNECTING' && (now - lastHB) > 10 * 60 * 1000) {
            console.warn(`[WATCHDOG] Integration ${id} stuck in CONNECTING for > 10m. Releasing.`);
            await this.disconnectMailbox(id);
          }
        }

        // ── Phase 2: Cross-pod orphan detection ────────────────────────────
        // Scan all workers in the load sorted set. If a worker's last update
        // is older than the threshold, scan its integration set for stale entries,
        // delete the stale Redis keys, and enqueue the orphans for reassignment.
        const DEAD_WORKER_THRESHOLD_MS = 3 * 60 * 1000; // 3 min (was 10 min — reduced for faster failover)
        const workers = await redis.zRangeWithScores(IMAP_KEYS.workerLoad(), 0, -1);
        for (const { value: otherWorkerId } of workers) {
          if (otherWorkerId === WORKER_ID) continue;
          // Check when this other worker last updated its load
          const lastScore = await redis.zScore(IMAP_KEYS.workerLoad(), otherWorkerId);
          if (lastScore === null) continue;
          const lastUpdateAge = now - lastScore;
          if (lastUpdateAge < DEAD_WORKER_THRESHOLD_MS) continue;

          console.log(`[WATCHDOG] Worker ${otherWorkerId} looks stale (${Math.round(lastUpdateAge / 1000)}s silent). Scanning for orphans...`);

          const otherIntegrations = await redis.sMembers(IMAP_KEYS.workerSet(otherWorkerId));
          let foundOrphans = 0;
          for (const integrationId of otherIntegrations) {
            const state = await redis.hGetAll(IMAP_KEYS.active(integrationId));
            const lastHB = parseInt(state.lastHeartbeat || '0', 10);
            const workerId = state.workerId || '';

            // If heartbeat is stale AND the key is still marked as owned by the dead worker
            if ((now - lastHB) > DEAD_WORKER_THRESHOLD_MS && workerId === otherWorkerId) {
              // Delete stale Redis keys so the next Lua claim attempt succeeds
              await Promise.allSettled([
                redis.del(IMAP_KEYS.active(integrationId)),
                redis.del(`lock:imap:conn:${integrationId}`),
                redis.del(IMAP_KEYS.integrationState(integrationId)),
              ]);

              // Push to reclaim list
              await redis.lPush(IMAP_KEYS.orphans(), JSON.stringify({
                integrationId,
                sourceWorker: otherWorkerId,
                reason: 'DEAD_WORKER',
                timestamp: now,
              }));
              // Clean the dead worker's set so it's not scanned again
              await redis.sRem(IMAP_KEYS.workerSet(otherWorkerId), integrationId);
              foundOrphans++;
            }
          }

          if (foundOrphans > 0) {
            console.log(`[WATCHDOG] 🐕 Found ${foundOrphans} orphans from dead worker ${otherWorkerId}. Enqueued for reclaim.`);
          }

          // Clean up the dead worker from the load tracker entirely
          await redis.zRem(IMAP_KEYS.workerLoad(), otherWorkerId);
          await redis.del(IMAP_KEYS.workerSet(otherWorkerId));
        }
      } catch (err: any) {
        console.warn('[WATCHDOG] Global scan failed:', err.message);
      }
    }, 5 * 60 * 1000); // Scan every 5 minutes
  }

  // ── Internal Connection Logic ───────────────────────────────────────────────

  private async _establishConnection(
    integration: ImapIntegration,
    isReconnect = false
  ): Promise<void> {
    const config = await this._getAuthConfig(integration);
    if (!config) {
      console.warn(`[IMAP] Could not build auth config for ${integration.id}. Skipping.`);
      return;
    }

    const host: string = config.host;

    // Circuit breaker check
    if (await this._isCircuitOpen(host)) {
      console.warn(`[IMAP] Circuit OPEN for host ${host} — skipping ${integration.id} for now.`);
      // Reschedule a retry after the cool-off window
      setTimeout(() => {
        if (!this.connections.has(integration.id)) {
          this._establishConnection(integration, true);
        }
      }, CIRCUIT_BREAKER.COOL_OFF_MS);
      return;
    }

    // Atomic Redis claim (prevents double-connect across replicas)
    const claimed = await this._redisClaim(integration, host);
    if (!claimed) {
      console.log(`[IMAP] Integration ${integration.id} already claimed by another replica. Skipping.`);
      return;
    }

    const client = new ImapFlow({
      ...config,
      logger: false,
    });

    const currentBackoff = isReconnect && this.connections.has(integration.id)
      ? this.connections.get(integration.id)!.reconnectDelay
      : 0;

    const clientData: ImapClientData = {
      client,
      integration,
      host,
      reconnectDelay: currentBackoff,
      heartbeatInterval: null as any,
      recycleTimeout: null as any,
      isRecycling: false,
      isReconnecting: false,
      heartbeatFailures: 0,
    };

    this.connections.set(integration.id, clientData);

    // ── Event Listeners (wired before connect()) ──

    client.on('error', (err: any) => {
      if (clientData.isRecycling) return; // suppress races during proactive recycle
      console.error(`[IMAP] Error on ${integration.id} [${integration.provider}]:`, err.message);
      imapErrorsTotal.inc({ type: 'connection_error', provider: integration.provider });
      this._recordCircuitFailure(host);
      this._handleReconnect(integration.id);
    });

    client.on('close', () => {
      if (clientData.isRecycling) return;
      console.log(`[IMAP] Connection closed for ${integration.id}`);
      this._handleReconnect(integration.id);
    });

    client.on('exists', (data: any) => {
      console.log(`[IMAP] 📬 New mail EXISTS for ${integration.id} (uid range: ${data.count})`);
      imapMailEventsTotal.inc({ provider: integration.provider });

      // Push to BullMQ — do NOT fetch body here, keeps the IMAP worker non-blocking
      if (emailSyncQueue) {
        emailSyncQueue.add('process-new-mail', {
          type: 'process-new-mail',
          integrationId: integration.id,
          userId: integration.userId,
          count: data.count,
        }, { priority: 1 }).catch((err: any) =>
          console.error(`[IMAP] Failed to enqueue new-mail for ${integration.id}:`, err.message)
        );
      }

      // INSTANT PUSH: Notify user immediately (before fetch completes)
      // This makes inbox feel like WhatsApp — new mail appears instantly
      clusterSync.notifyNewMail(integration.userId, {
        integrationId: integration.id,
        subject: undefined,
        from: undefined,
        snippet: 'New message arriving...',
        date: new Date().toISOString(),
        isNew: true,
      }).catch(() => {});
    });

    // ── Connect ──

    try {
      await client.connect();
      console.log(`[IMAP] ✅ Connected to ${integration.id} via ${host}`);

      clientData.reconnectDelay = 0; // reset backoff on success
      imapConnectionsActive.inc({ provider: integration.provider });
      await this._redisMarkConnected(integration.id);
      await this._workerLoadUpdate();

      await client.mailboxOpen('INBOX');
      console.log(`[IMAP] 📭 IDLE started on INBOX for ${integration.id}`);

      this._setupTimers(clientData);

      // Push custom_email config to Rust mailbox monitor for persistent IMAP IDLE
      if (integration.provider === 'custom_email') {
        buildMailboxConfig(integration as any).then(config => {
          if (config) pushMailboxToRustMonitor(config).catch(() => {});
        }).catch(() => {});
      }

    } catch (error: any) {
      this.connections.delete(integration.id);
      await this._redisRelease(integration.id);

      const isAuthFailure =
        error.responseStatus === 'NO' ||
        error.responseStatus === 'BAD' ||
        error.code === 'AUTHENTICATIONFAILED' ||
        (error.message || '').toLowerCase().includes('authentication failed') ||
        (error.message || '').toLowerCase().includes('invalid credentials');

      if (isAuthFailure) {
        console.warn(`[IMAP] ⛔ AUTH_FAILED for ${integration.id} — stopping reconnect, marking NEEDS_REAUTH`);
        imapErrorsTotal.inc({ type: 'auth_failed', provider: integration.provider });
        await this._handleAuthFailure(integration);
      } else {
        console.error(`[IMAP] ❌ Connect failed for ${integration.id}: ${error.message}`);
        this._recordCircuitFailure(host);
        this._handleReconnect(integration.id, integration);
      }
    }
  }

  // ── Auth Config Builder ─────────────────────────────────────────────────────

  private async _getAuthConfig(integration: ImapIntegration): Promise<any | null> {
    const user = integration.accountType || '';

    if (integration.provider === 'gmail' || integration.provider === 'outlook') {
      const host = integration.provider === 'gmail'
        ? 'imap.gmail.com'
        : 'outlook.office365.com';

      const oauth = integration.provider === 'gmail' ? await ensureGmailOAuth() : await ensureOutlookOAuth();
      if (!oauth) {
        console.warn(`[IMAP] OAuth module not available for ${integration.id} — skipping`);
        await this._handleAuthFailure(integration);
        return null;
      }
      const token = integration.provider === 'gmail'
        ? await oauth.getValidToken(integration.userId, user)
        : await oauth.getValidToken(integration.userId);

      if (!token) {
        console.warn(`[IMAP] No valid OAuth token for ${integration.id} — will mark NEEDS_REAUTH`);
        await this._handleAuthFailure(integration);
        return null;
      }

      return { host, port: 993, secure: true, auth: { user, accessToken: token } };
    }

    // Custom SMTP/IMAP
    if (!integration.encryptedMeta) return null;
    try {
      const meta = JSON.parse(await decrypt(integration.encryptedMeta));
      const smtpHost = meta.smtp_host || meta.smtpHost || '';
      const imapHost = meta.imap_host || meta.imapHost || smtpHost.replace(/^smtp\./i, 'imap.');
      const port: number = Number(meta.imap_port || meta.imapPort || 993);
      const user = meta.smtp_user || meta.smtpUser || meta.user || meta.email || integration.accountType || '';
      const pass = meta.smtp_pass || meta.smtpPass || meta.imap_pass || meta.imapPass || meta.password || '';
      const pwdType = meta.passwordType || 'mailbox_password';

      if (!imapHost || !user || !pass) {
        console.warn(`[IMAP] Custom email config incomplete for ${integration.id}: host/user/pass required.`);
        return null;
      }

      console.log(`[IMAP] Connecting ${integration.id} (${user}) via ${imapHost}:${port} [password type: ${pwdType}]`);

      return {
        host: imapHost,
        port,
        secure: port === 993,
        auth: { user, pass },
      };
    } catch (err: any) {
      console.error(`[IMAP] Failed to decrypt meta for ${integration.id}:`, err.message);
      return null;
    }
  }

  // ── Timer Management ────────────────────────────────────────────────────────

  private _setupTimers(data: ImapClientData): void {
    this._cleanupClientTimers(data);

    // 1. NOOP heartbeat every 5 minutes + Redis TTL refresh
    const HEARTBEAT_FAILURE_LIMIT = 3;
    data.heartbeatInterval = setInterval(async () => {
      try {
        if (data.client.usable) {
          await data.client.noop();
          await this._redisHeartbeat(data.integration.id);
          data.heartbeatFailures = 0;
        } else {
          data.heartbeatFailures++;
          console.warn(`[IMAP] Heartbeat skipped — client not usable for ${data.integration.id} (${data.heartbeatFailures}/${HEARTBEAT_FAILURE_LIMIT})`);
        }
      } catch (e: any) {
        data.heartbeatFailures++;
        console.warn(`[IMAP] Heartbeat failed for ${data.integration.id} (${data.heartbeatFailures}/${HEARTBEAT_FAILURE_LIMIT}): ${e.message}`);
      }

      if (data.heartbeatFailures >= HEARTBEAT_FAILURE_LIMIT) {
        console.warn(`[IMAP] 🔄 Heartbeat failure limit reached for ${data.integration.id} — forcing reconnect`);
        data.isRecycling = true;
        this._cleanupClientTimers(data);
        try { await data.client.logout(); } catch { try { data.client.close(); } catch {} }
        this.connections.delete(data.integration.id);
        imapConnectionsActive.dec({ provider: data.integration.provider });
        this._establishConnection(data.integration, true);
      }
    }, HEARTBEAT_TIME);

    // 2. Proactive 29-min recycle — <50ms downtime
    data.recycleTimeout = setTimeout(async () => {
      console.log(`[IMAP] ♻️  Proactive recycle for ${data.integration.id}`);
      imapReconnectTotal.inc({ reason: 'proactive_recycle' });

      data.isRecycling = true;
      this._cleanupClientTimers(data);

      // Logout old client silently
      try { await data.client.logout(); } catch { try { data.client.close(); } catch { /* ignore */ } }

      // Remove from map so _establishConnection can re-enter
      this.connections.delete(data.integration.id);
      imapConnectionsActive.dec({ provider: data.integration.provider });

      // Re-fetch integration in case OAuth token needs refresh
      try {
        const fresh = await storage.getIntegrationById(data.integration.id);
        const target = (fresh && fresh.connected) ? fresh as ImapIntegration : data.integration;
        await this._establishConnection(target, false);
      } catch (err: any) {
        console.error(`[IMAP] Recycle failed for ${data.integration.id}:`, err.message);
        // Fall back to reconnect
        await this._establishConnection(data.integration, true);
      }
    }, RECYCLE_TIME);
  }

  private _cleanupClientTimers(data: ImapClientData): void {
    if (data.heartbeatInterval) clearInterval(data.heartbeatInterval);
    if (data.recycleTimeout)    clearTimeout(data.recycleTimeout);
    if (data.reconnectTimeout)  clearTimeout(data.reconnectTimeout);
  }

  // ── Reactive Reconnect ──────────────────────────────────────────────────────

  private _handleReconnect(integrationId: string, integration?: ImapIntegration): void {
    const data = this.connections.get(integrationId);
    const target = integration || data?.integration;
    if (!target) return;

    if (!data) {
      console.log(`[IMAP] ⏭️ Skipping reconnect for ${integrationId} — no active connection data`);
      return;
    }

    // Prevent dual reconnect timers when error + close fire together
    if (data.isReconnecting) {
      console.log(`[IMAP] ⏭️ Reconnect already queued for ${integrationId} — skipping duplicate`);
      return;
    }
    data.isReconnecting = true;

    this._cleanupClientTimers(data);
    try { data.client.close(); } catch { /* ignore */ }
    imapConnectionsActive.dec({ provider: target.provider });

    imapReconnectTotal.inc({ reason: 'error_or_close' });

    const currentDelay = data.reconnectDelay ?? 0;
    const delay = currentDelay === 0 ? 0 : jitter(currentDelay);

    console.log(`[IMAP] 🔄 Reconnect ${integrationId} in ${delay}ms (backoff: ${currentDelay}ms)`);

    const timeout = setTimeout(async () => {
      const nextDelay = nextBackoff(currentDelay);
      if (this.connections.has(integrationId)) {
        this.connections.get(integrationId)!.reconnectDelay = nextDelay;
      }
      this.connections.delete(integrationId);
      await this._redisRelease(integrationId);

      await this._establishConnection(target, true);
    }, delay);

    data.reconnectTimeout = timeout;
  }

  // ── AUTH_FAILED Handler ─────────────────────────────────────────────────────

  private async _handleAuthFailure(integration: ImapIntegration): Promise<void> {
    // 1. Update DB: mark health as degraded but keep connected=true so it doesn't disappear
    try {
      await storage.updateIntegrationById(integration.id, {
        healthStatus: 'degraded',
        lastError: 'AUTH_FAILED: Reconnection needed. Token may have expired.',
      } as any);
    } catch (dbErr: any) {
      console.error(`[IMAP] DB update failed for AUTH_FAILED on ${integration.id}:`, dbErr.message);
    }

    // 2. Notify the UI immediately — priority event, not throttled
    await clusterSync.broadcast('INTEGRATION_ERROR', integration.userId, {
      integrationId: integration.id,
      provider: integration.provider,
      errorType: 'AUTH_FAILED',
      message: 'Your email account needs to be reconnected. Click here to re-authenticate.',
      critical: true,
    });

    // 3. Clean Redis state (or mark as ERROR so it's not orphan-rebalanced)
    try {
      const redis = await getRedisClient();
      if (redis) {
        await redis.hSet(IMAP_KEYS.active(integration.id), {
          status: 'ERROR',
          lastError: 'AUTH_FAILED',
          lastHeartbeat: Date.now().toString(),
        });
        await redis.expire(IMAP_KEYS.active(integration.id), 60 * 60); // Keep error state for 1 hour
      }
    } catch { /* ignore */ }

    this.connections.delete(integration.id);
  }

  // ── Circuit Breaker ─────────────────────────────────────────────────────────

  private async _isCircuitOpen(host: string): Promise<boolean> {
    try {
      const redis = await getRedisClient();
      if (!redis) return false;

      const state = await redis.hGet(IMAP_KEYS.circuit(host), 'state');
      const isOpen = state === 'OPEN';
      
      // Update metric
      imapCircuitStatus.set({ host }, isOpen ? 1 : 0);
      
      return isOpen;
    } catch {
      return false; // Fail open — don't block on Redis errors
    }
  }

  private async _recordCircuitFailure(host: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) return;

      const key = IMAP_KEYS.circuit(host);
      const now = Date.now();

      const [failures, lastFailure] = await Promise.all([
        redis.hGet(key, 'failures'),
        redis.hGet(key, 'lastFailure'),
      ]);

      const failureCount = parseInt(failures || '0', 10) + 1;
      const lastTs = parseInt(lastFailure || '0', 10);

      // Reset count if outside the rolling window
      const effectiveCount = (now - lastTs) > CIRCUIT_BREAKER.WINDOW_MS ? 1 : failureCount;

      await redis.hSet(key, {
        failures: effectiveCount,
        lastFailure: now,
        state: effectiveCount >= CIRCUIT_BREAKER.FAILURE_THRESHOLD ? 'OPEN' : 'CLOSED',
        nextRetry: effectiveCount >= CIRCUIT_BREAKER.FAILURE_THRESHOLD
          ? now + CIRCUIT_BREAKER.COOL_OFF_MS
          : 0,
      });
      await redis.expire(key, IMAP_TTL.circuit);

      if (effectiveCount >= CIRCUIT_BREAKER.FAILURE_THRESHOLD) {
        console.warn(`[IMAP] ⚡ Circuit OPENED for host ${host} after ${effectiveCount} failures. Cool-off: 15 min.`);
        imapCircuitTrippedTotal.inc({ host });
        imapCircuitStatus.set({ host }, 1);
      }
    } catch (err: any) {
      console.warn('[IMAP] Circuit breaker update failed:', err.message);
    }
  }

  // ── Redis State Helpers ─────────────────────────────────────────────────────

  private async _redisClaim(integration: ImapIntegration, host: string): Promise<boolean> {
    try {
      const redis = await getRedisClient();
      if (!redis) return true; // No Redis → always proceed (single-node mode)

      const activeKey = IMAP_KEYS.active(integration.id);
      const workerSetKey = IMAP_KEYS.workerSet(WORKER_ID);
      const legacyLockKey = `lock:imap:conn:${integration.id}`;
      const now = Date.now().toString();

      // ── Stale claim reaping ────────────────────────────────────────────────
      // If the imap:active key exists but has a stale heartbeat (>5 min),
      // the owning worker is likely dead. Delete the stale keys so the
      // atomic Lua claim below can succeed.
      const STALE_HEARTBEAT_MS = 5 * 60 * 1000;
      try {
        const existingState = await redis.hGetAll(activeKey);
        if (existingState && Object.keys(existingState).length > 0) {
          const lastHB = parseInt(existingState.lastHeartbeat || '0', 10);
          const ownerWorker = existingState.workerId || '';
          if (ownerWorker && (Date.now() - lastHB) > STALE_HEARTBEAT_MS) {
            console.log(`[IMAP] Reaping stale claim on ${integration.id} from worker ${ownerWorker} (last heartbeat ${Math.round((Date.now() - lastHB) / 1000)}s ago)`);
            await Promise.allSettled([
              redis.del(activeKey),
              redis.sRem(IMAP_KEYS.workerSet(ownerWorker), integration.id),
              redis.del(legacyLockKey),
              redis.del(IMAP_KEYS.integrationState(integration.id)),
            ]);
          }
        }
      } catch {
        // Non-critical — the Lua script below will still do the right thing
      }

      // Evaluate Lua script atomically
      const result = await (redis as any).eval(
        LUA_CLAIM,
        {
          keys: [activeKey, workerSetKey, legacyLockKey],
          arguments: [WORKER_ID, integration.userId, host, now, integration.id],
        }
      );

      return result === 1;
    } catch (err: any) {
      console.warn('[IMAP] Redis claim failed, proceeding anyway:', err.message);
      return true; // Fail open
    }
  }

  private async _redisMarkConnected(integrationId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) return;

      await redis.hSet(IMAP_KEYS.active(integrationId), {
        status: 'IDLE',
        lastHeartbeat: Date.now().toString(),
      });
      await redis.expire(IMAP_KEYS.active(integrationId), IMAP_TTL.active);
    } catch { /* non-critical */ }
  }

  private async _redisHeartbeat(integrationId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) return;

      const key = IMAP_KEYS.active(integrationId);
      await redis.hSet(key, 'lastHeartbeat', Date.now().toString());
      await redis.expire(key, IMAP_TTL.active); // Renew TTL every 35 min
      
      // Renew legacy lock
      await redis.set(`lock:imap:conn:${integrationId}`, WORKER_ID, { EX: 300 });
    } catch { /* non-critical */ }
  }

  private async _redisRelease(integrationId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) return;

      await Promise.allSettled([
        redis.del(IMAP_KEYS.active(integrationId)),
        redis.sRem(IMAP_KEYS.workerSet(WORKER_ID), integrationId),
        redis.del(`lock:imap:conn:${integrationId}`),
        redis.del(IMAP_KEYS.integrationState(integrationId)),
      ]);
    } catch { /* ignore on disconnect/shutdown */ }
  }

  private async _workerLoadUpdate(): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) return;

      await redis.zAdd(IMAP_KEYS.workerLoad(), {
        score: this.connections.size,
        value: WORKER_ID,
      });
    } catch { /* non-critical */ }
  }

  /**
   * Signal to the orchestrator that this pod is at capacity.
   * Used by external watchdog to decide whether to spin up a new replica.
   */
  private async _signalCapReached(): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) return;
      // Add to the orphans list so orchestrator knows another pod is needed
      await redis.lPush(IMAP_KEYS.orphans(), JSON.stringify({
        reason: 'CAPACITY',
        workerId: WORKER_ID,
        timestamp: Date.now(),
      }));
    } catch { /* ignore */ }
  }
}
