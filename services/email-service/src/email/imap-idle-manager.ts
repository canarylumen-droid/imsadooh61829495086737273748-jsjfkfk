import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { storage } from '@shared/lib/storage/storage.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { pagedEmailImport } from '@shared/lib/imports/paged-email-importer.js';
import type { Integration } from '@audnix/shared';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { mailboxHealthService } from './mailbox-health-service.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import { gmailOAuth } from '@services/api-gateway/src/oauth/gmail.js';
import { outlookOAuth } from '@services/api-gateway/src/oauth/outlook.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import dns from 'dns';
import { acquireDistributedLock, extendLock, isLockOwner, releaseLock, getRedisClient } from '@shared/lib/redis/redis.js';
import { IMAP_KEYS, IMAP_TTL } from '@shared/lib/redis/imap-keys.js';
import { WorkerDiscoveryRegistry } from '@shared/lib/monitoring/worker-discovery-registry.js';


interface EmailConfig {
    smtp_host?: string;
    smtp_port?: number;
    imap_host?: string;
    imap_port?: number;
    smtp_user?: string;
    smtp_pass?: string;
    provider?: 'gmail' | 'outlook' | 'smtp' | 'custom';
}

class ImapIdleManager {
    private connections: Map<string, Map<string, Imap>> = new Map(); // Key: integrationId -> folderType (primaryInbox/primarySent)
    private folders: Map<string, { inbox: string[], sent: string[], spam: string[] }> = new Map(); // Key: integrationId
    private syncIntervals: Map<string, Map<string, NodeJS.Timeout>> = new Map(); // Key: integrationId -> folderType
    private syncing: Set<string> = new Set(); // Key: integrationId
    private isRunning = false;
    private backoffDelays: Map<string, number> = new Map(); // Key: integrationId
    private lastActivity: Map<string, Date> = new Map(); // Key: `${integrationId}:${folderName}`
    private reconnectTimers: Map<string, NodeJS.Timeout> = new Map(); // Key: integrationId
    private restartTimers: Map<string, Map<string, NodeJS.Timeout>> = new Map(); // Key: integrationId -> folderName
    private failureCooldowns: Map<string, number> = new Map(); // Key: integrationId -> timestamp to retry
    private syncingFolders: Set<string> = new Set(); // Key: `${integrationId}:${folderName}`
    private watchdogInterval: NodeJS.Timeout | null = null;
    private readonly MIN_BACKOFF = 1000; // 1s initial retry
    private readonly MAX_BACKOFF = 60 * 1000; // 1m max
    private readonly ZOMBIE_TIMEOUT_MS = 30 * 1000; // 30s silence = zombie (near-instant detection)
    // ─── Scaling: Connection throttle ────────────────────────────────────────────
    // IDLE connections hold a permanent TCP socket + buffer. At 500 mailboxes this
    // exhausts OS file descriptors (~1024 limit). Cap at 500 IDLE; overflow polls.
    private readonly MAX_IDLE_CONNECTIONS = 500;
    private pollingOnlyIntegrations: Map<string, { interval: NodeJS.Timeout; integration: Integration }> = new Map();
    private discoveryRegistry = new WorkerDiscoveryRegistry('email-service');

    /**
     * Start the IMAP IDLE manager
     */
    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log('🚀 IMAP IDLE Manager starting (Multi-Mailbox mode)...');
        // Initial sync
        await this.syncConnections();

        // Phase 11: Start the Zombie Connection Watchdog
        this.startWatchdog();

        // Use BullMQ for periodic connection management
        // This ensures transparency and reliability across restarts
        const { emailSyncQueue } = await import('@shared/lib/queues/email-sync-queue.js');
        if (emailSyncQueue) {
          await emailSyncQueue.add('sync-connections', { type: 'discovery' }, {
            repeat: {
              every: 60 * 1000 // Every 1 minute (fast discovery)
            },
            jobId: 'discovery-cycle'
          });
        }
    }

    /**
     * Gracefully stop the IMAP IDLE Manager.
     * Called during server SIGTERM/SIGINT to prevent ghost sessions on redeploy.
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }

        let closed = 0;
        for (const [integrationId, folderMap] of this.connections.entries()) {
            const intervals = this.syncIntervals.get(integrationId);
            if (intervals) {
                for (const interval of intervals.values()) clearInterval(interval);
                this.syncIntervals.delete(integrationId);
            }
            for (const imap of folderMap.values()) {
                try { imap.end(); closed++; } catch (e) { console.warn('[IMAP] Error ending connection in stop:', (e as Error)?.message); }
            }
        }

        this.connections.clear();
        this.folders.clear();
        this.lastActivity.clear();
        // Stop all polling-fallback intervals
        for (const [, entry] of this.pollingOnlyIntegrations.entries()) {
            clearInterval(entry.interval);
        }
        this.pollingOnlyIntegrations.clear();
        console.log(`[ImapIdleManager] Stopped. Closed ${closed} connection(s).`);
    }

    /**
     * Check if the IMAP manager is currently running
     */
    public getRunningStatus(): boolean {
        return this.isRunning;
    }

    public isConnectionAlive(integrationId: string): boolean {
        const folderMap = this.connections.get(integrationId);
        if (!folderMap || folderMap.size === 0) return false;
        for (const imap of folderMap.values()) {
            if (imap.state === 'authenticated' || imap.state === 'idle') return true;
        }
        return false;
    }

    public async releaseAllMailboxClaims(): Promise<void> {
        await this.discoveryRegistry.releaseAll();
    }

    /**
     * Get discovered folders for a specific integration
     */
    public getDiscoveredFolders(integrationId: string): { inbox: string[], sent: string[], spam: string[] } | undefined {
        return this.folders.get(integrationId);
    }

    /**
     * Sync active connections with database integrations
     */

    /**
     * Immediately and permanently kill all IMAP connections for a specific integration.
     * Called when a user explicitly disconnects a mailbox.
     * Clears all state, timers, and notifies the frontend in real time.
     */
    public forceDisconnect(integrationId: string, userId?: string): void {
        console.log(`🔌 [IMAP] Force-disconnecting all connections for integration ${integrationId}`);

        // 1. Kill all sync intervals for this integration
        const intervals = this.syncIntervals.get(integrationId);
        if (intervals) {
            for (const interval of intervals.values()) clearInterval(interval);
            this.syncIntervals.delete(integrationId);
        }

        // 2. Kill all IMAP connections (destroy, not just end — no graceful goodbye)
        const folderMap = this.connections.get(integrationId);
        if (folderMap) {
            for (const imap of folderMap.values()) {
                try {
                    if (imap.state !== 'disconnected') imap.destroy();
                } catch (e) { console.warn('[IMAP] Error destroying connection in forceDisconnect:', (e as Error)?.message); }
            }
            this.connections.delete(integrationId);
        }

        // 3. Clear all metadata for this integration
        this.folders.delete(integrationId);
        this.syncing.delete(integrationId);
        this.backoffDelays.delete(integrationId);
        // Also kill polling-fallback if this integration was in poll mode
        const pollingEntry = this.pollingOnlyIntegrations.get(integrationId);
        if (pollingEntry) {
            clearInterval(pollingEntry.interval);
            this.pollingOnlyIntegrations.delete(integrationId);
        }

        // 4. Clear any pending reconnection timers
        const timer = this.reconnectTimers.get(integrationId);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(integrationId);
        }

        // 5. Clear any lastActivity entries for this integration
        for (const key of this.lastActivity.keys()) {
            if (key.startsWith(`${integrationId}:`)) {
                this.lastActivity.delete(key);
            }
        }

        // 5. Release mailbox claim in worker discovery registry
        this.discoveryRegistry.releaseMailbox(integrationId).catch((err: any) => console.warn('[IMAP] Failed to release mailbox claim in forceDisconnect:', err?.message));

        // 6. Notify frontend in real time so UI updates immediately
        if (userId) {
            wsSync.notifySettingsUpdated(userId);
            wsSync.notifySyncStatus(userId, { syncing: false, integrationId, disconnected: true });
        }

        console.log(`✅ [IMAP] Integration ${integrationId} fully disconnected and all state cleared.`);
    }

    /**
     * Trigger an immediate email sync for all active integrations belonging to a user.
     * Fetches new messages from inbox, sent, and spam folders using existing IDLE connections.
     * Emits sync_status events for real-time frontend feedback.
     */
    public async syncNow(userId: string): Promise<void> {
        const synced: string[] = [];
        for (const [integrationId, folderMap] of this.connections.entries()) {
            const imap = folderMap?.values().next().value;
            if (!imap || imap.state !== 'authenticated') continue;
            const folders = this.folders.get(integrationId);
            if (!folders) continue;

            wsSync.notifySyncStatus(userId, { syncing: true, integrationId });
            try {
                for (const inbox of folders.inbox) await this.fetchNewEmails(integrationId, userId, imap, inbox, 'inbound');
                for (const sent of folders.sent) await this.fetchNewEmails(integrationId, userId, imap, sent, 'outbound');
                for (const spam of folders.spam) await this.fetchNewEmails(integrationId, userId, imap, spam, 'inbound', true);
                synced.push(integrationId);
            } catch (e) {
                console.warn(`[IMAP] syncNow error for ${integrationId}:`, (e as Error)?.message);
            } finally {
                wsSync.notifySyncStatus(userId, { syncing: false, integrationId });
            }
        }
        if (synced.length > 0) {
            console.log(`[IMAP] syncNow: synced ${synced.length} integrations for user ${userId}`);
        }
    }

    public async syncConnections(): Promise<void> {
        if (quotaService.isRestricted()) {
            console.log('[IMAPIdleManager] Skipping connection sync: Database quota restricted');
            return;
        }
        try {
            // All providers now use permanent IMAP IDLE connections for real-time sync.
            // Gmail & Outlook authenticate via XOAUTH2 (access token).
            // custom_email authenticates via password from encryptedMeta.
            const providers = ['gmail', 'outlook', 'custom_email'];
            let integrations: Integration[] = [];
            
            for (const provider of providers) {
                const found = await storage.getIntegrationsByProvider(provider);
                if (found) integrations = [...integrations, ...found];
            }
            
            const activeIntegrationIds = new Set(integrations.filter(i => i.connected).map(i => i.id));

            // Remove connections for integrations no longer active/connected
            for (const [integrationId, folderMap] of this.connections.entries()) {
                if (!activeIntegrationIds.has(integrationId)) {
                    console.log(`🔌 Closing all IMAP connections for integration ${integrationId}`);
                    
                    // Clear sync intervals
                    const intervals = this.syncIntervals.get(integrationId);
                    if (intervals) {
                        for (const interval of intervals.values()) clearInterval(interval);
                        this.syncIntervals.delete(integrationId);
                    }

                    for (const imap of folderMap.values()) {
                        try { imap.end(); } catch (e) { console.debug('[IMAP] Error ending connection in syncConnections:', (e as Error)?.message); }
                    }
                    this.connections.delete(integrationId);
                    this.folders.delete(integrationId);
                    // Release mailbox claim so another worker can pick it up
        this.discoveryRegistry.releaseMailbox(integrationId).catch((err: any) => console.warn('[IMAP] Failed to release mailbox claim:', err?.message));
                }
            }

            // Add IMAP connections — throttled:
            // First MAX_IDLE_CONNECTIONS active mailboxes get real-time IDLE.
            // Overflow gets 5-minute polling to avoid fd exhaustion.
            const supported = ['custom_email', 'gmail', 'outlook'];
            const activeMailboxes = integrations.filter(i => i.connected && supported.includes(i.provider));

            // Cleanup stale polling-only entries (disconnected mailboxes)
            for (const [id, entry] of this.pollingOnlyIntegrations.entries()) {
                if (!activeIntegrationIds.has(id)) {
                    clearInterval(entry.interval);
                    this.pollingOnlyIntegrations.delete(id);
                    console.log(`[IMAP] 📅 Removed polling fallback for disconnected integration ${id}`);
                }
            }

            for (const integration of activeMailboxes) {
                const alreadyIdle = this.connections.has(integration.id);
                const alreadyPolling = this.pollingOnlyIntegrations.has(integration.id);
                if (alreadyIdle || alreadyPolling) continue;

                // Claim this mailbox in the worker discovery registry
                const claimed = await this.discoveryRegistry.claimMailbox(integration.id);
                if (!claimed) {
                    console.log(`[IMAP] Integration ${integration.id} already owned by another worker — skipping`);
                    continue;
                }

                // Delegate custom_email (password-auth mailboxes) to Rust IMAP worker
                if (integration.provider === 'custom_email') {
                    const { buildMailboxConfig, pushMailboxToRustMonitor } = await import('@shared/lib/realtime/mailbox-monitor-bridge.js');
                    const config = await buildMailboxConfig(integration as any);
                    if (config) {
                        await pushMailboxToRustMonitor(config).catch(() => {});
                    }
                    continue;
                }

                const currentIdleCount = this.connections.size;
                if (currentIdleCount < this.MAX_IDLE_CONNECTIONS) {
                    console.log(`🔌 Opening real-time IMAP IDLE connection for integration ${integration.id} (${integration.provider}, User: ${integration.userId})`);
                    this.setupConnection(integration.id, integration);
                } else {
                    // IDLE cap reached — use 5-min polling fallback
                    this.startPollingFallback(integration.id, integration);
                }
            }
        } catch (error) {
            console.error('Error syncing IMAP IDLE connections:', error);
            quotaService.reportDbError(error);
        }
    }


    /**
     * Helper to execute IMAP commands safely by stopping IDLE if active, 
     * running the command, and then restarting IDLE if appropriate.
     */
    private async executeImapCommand<T>(imap: Imap, commandFn: (cb: (err: any, result: T) => void) => void): Promise<T | undefined> {
        if (!imap || imap.state === 'disconnected') return undefined;

        return new Promise((resolve, reject) => {
            const wasIdling = !!(imap as any)._idleWaiter;
            
            const runCommand = () => {
                commandFn((err, result) => {
                    if (wasIdling && imap.state === 'authenticated') {
                        try { (imap as any).idle(); } catch (e) { console.debug('[IMAP] Error restarting idle in executeImapCommand:', (e as Error)?.message); }
                    }
                    if (err) return reject(err);
                    resolve(result);
                });
            };

            if (wasIdling && imap.state === 'authenticated') {
                imap.once('update', () => { /* wait for idle stop */ });
                (imap as any).stopIdle();
                setTimeout(runCommand, 20); // Give it a moment to stop
            } else {
                runCommand();
            }
        });
    }

    /**
     * Discover special folders (Inbox, Sent) using IMAP attributes
     */
    private async discoverFolders(integrationId: string, imap: Imap): Promise<void> {
        try {
            const boxes = await this.executeImapCommand<any>(imap, (cb) => imap.getBoxes(cb));
            
            const inboxFolders: string[] = [];
            const sentFolders: string[] = [];
            const spamFolders: string[] = [];

            const processBoxes = (obj: any, prefix = '') => {
                for (const key in obj) {
                    const box = obj[key];
                    const fullName = prefix + key;
                    const attribs = box.attribs || [];

                    // 1. Check standard IMAP attributes (Most Reliable)
                    // Attributes like \Sent, \Junk, etc. are standard in RFC 6154
                    const isInbox = attribs.some((a: string) => a.toLowerCase() === '\\inbox');
                    const isSent = attribs.some((a: string) => 
                        a.toLowerCase() === '\\sent' || 
                        a.toLowerCase() === '\\sentmail' || 
                        a.toLowerCase() === '\\sentitems'
                    );
                    const isSpam = attribs.some((a: string) => 
                        a.toLowerCase() === '\\spam' || 
                        a.toLowerCase() === '\\junk'
                    );

                    if (isInbox) {
                        inboxFolders.push(fullName);
                    } else if (isSent) {
                        sentFolders.push(fullName);
                    } else if (isSpam) {
                        spamFolders.push(fullName);
                    } else {
                        // 2. Fallback to name patterns (Localized)
                        const lowerKey = key.toLowerCase();
                        if (lowerKey === 'inbox') {
                            inboxFolders.push(fullName);
                        } else if ([
                            'sent', 'sent items', 'sent messages', 'sent mails', 'sent-mail',
                            'gesendet', 'enviados', 'envoyés', 'outbox', 'verzonden', 
                            'posta inviata', 'skickat', 'elementos enviados'
                        ].some(s => lowerKey === s || lowerKey === `inbox.${s}`)) {
                            sentFolders.push(fullName);
                        } else if ([
                            'spam', 'junk', 'bulk', 'junk-email', 'junk email', 'spam-messages'
                        ].some(s => lowerKey === s || lowerKey.includes(s))) {
                            spamFolders.push(fullName);
                        }
                    }

                    if (box.children) {
                        processBoxes(box.children, fullName + (box.delimiter || '/'));
                    }
                }
            };

            processBoxes(boxes);

            // Defaults if none found
            if (inboxFolders.length === 0) inboxFolders.push('INBOX');
            if (sentFolders.length === 0) sentFolders.push('Sent'); 
            if (spamFolders.length === 0) spamFolders.push('Spam');

            console.log(`[IMAP] Discovered folders for ${integrationId}: Inbox=[${inboxFolders}], Sent=[${sentFolders}], Spam=[${spamFolders}]`);
            this.folders.set(integrationId, {
                inbox: [...new Set(inboxFolders)],
                sent: [...new Set(sentFolders)],
                spam: [...new Set(spamFolders)]
            });
        } catch (err: any) {
            console.warn(`[IMAP] Folder discovery failed for ${integrationId}:`, err.message);
            // Minimal fallbacks
            this.folders.set(integrationId, {
                inbox: ['INBOX'],
                sent: ['Sent', 'Sent Items', '[Gmail]/Sent Mail'],
                spam: ['Spam', 'Junk', '[Gmail]/Spam']
            });
        }
    }

    /**
     * Polling fallback for integrations beyond MAX_IDLE_CONNECTIONS cap.
     * Fetches the last 50 unseen messages every 30 seconds instead of holding
     * a permanent TCP socket. This prevents OS fd exhaustion at 500+ mailboxes.
     */
    private startPollingFallback(integrationId: string, integration: Integration): void {
        const POLL_INTERVAL_MS = 1000; // 1 second — instant polling for overflow connections
        console.log(`[IMAP] 📅 ${integrationId} (${integration.provider}) → polling fallback (IDLE cap ${this.MAX_IDLE_CONNECTIONS} reached). Polling every 1s.`);
        const poll = async () => {
            try {
                const { emailSyncQueue } = await import('@shared/lib/queues/email-sync-queue.js');
                if (emailSyncQueue) {
                    await emailSyncQueue.add('poll-fallback', {
                        type: 'historical',
                        integrationId: integration.id,
                        userId: integration.userId,
                        limit: 50,
                    }, { removeOnComplete: true, removeOnFail: true });
                }
            } catch (err) {
                console.debug(`[IMAP][poll] ${integrationId}: ${(err as Error).message}`);
            }
        };
        poll(); // Initial poll immediately
        const interval = setInterval(poll, POLL_INTERVAL_MS);
        this.pollingOnlyIntegrations.set(integrationId, { interval, integration });
    }

    /**
     * Setup a persistent IMAP connection with IDLE support
     */
    private async setupConnection(integrationId: string, integration: Integration): Promise<void> {
        if (this.connections.has(integrationId)) return;

        // Phase 25 Scaling: Distributed Connection Lock
        // SYNC: Check if this integration is already handled by a 24/7 worker replica.
        const activeKey = IMAP_KEYS.active(integrationId);
        const redis = await getRedisClient();
        if (redis) {
            const isWorkerActive = await redis.exists(activeKey);
            if (isWorkerActive) {
                console.log(`[IMAP] 🤖 ${integrationId} is managed by the autonomous worker cluster. Skipping local connection.`);
                return;
            }
        }

        // Fallback/Legacy Lock
        const lockKey = `imap:conn:${integrationId}`;
        const hasLock = await acquireDistributedLock(lockKey, 300); // 5 minute initial lock
        if (!hasLock) {
            console.log(`[IMAP] 🔒 Integration ${integrationId} is managed by another service node. Skipping setup.`);
            return;
        }

        console.log(`🔌 [IMAP] Initializing real-time connection for integration ${integrationId} (User: ${integration.userId})`);
        try {
            // For OAuth providers (gmail/outlook), we do NOT need encryptedMeta.
            // They authenticate via a live access token (XOAUTH2).
            // For custom_email, we require encryptedMeta to get IMAP credentials.
            const isOAuthProvider = integration.provider === 'gmail' || integration.provider === 'outlook';

            let config: EmailConfig = {};
            if (!isOAuthProvider) {
                if (!integration.encryptedMeta) {
                    console.debug(`[IMAP] Skipping integration ${integrationId} — encryptedMeta is missing (User: ${integration.userId})`);
                    return;
                }
                try {
                    const credentialsStr = await decrypt(integration.encryptedMeta);
                    config = JSON.parse(credentialsStr) as EmailConfig;
                } catch (decryptErr) {
                    console.debug(`[IMAP] Skipping integration ${integrationId} — failed to decrypt/parse config: ${(decryptErr as any)?.message}`);
                    return;
                }
            }

            // Determine IMAP host - OAuth providers have well-known hosts
            let imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
            const imapPort = config.imap_port || 993;

            if (!imapHost) {
                if (integration.provider === 'gmail') imapHost = 'imap.gmail.com';
                else if (integration.provider === 'outlook') imapHost = 'outlook.office365.com';
            }

            if (!imapHost) {
                console.warn(`[IMAP] Skipping integration ${integrationId} — imap_host not found in config (User: ${integration.userId})`);
                return;
            }

            const imapOptions: any = {
                user: config.smtp_user || integration.accountType || '',
                host: imapHost,
                port: imapPort,
                tls: imapPort === 993,
                // Force IPv4 for cloud environment stability
                family: 4,
                lookup: (hostname: string, options: any, callback: any) => {
                    dns.resolve4(hostname, (err, addresses) => {
                        if (err || !addresses || addresses.length === 0) {
                            return callback(err || new Error('No IPv4 found'), null, 4);
                        }
                        callback(null, addresses[0], 4);
                    });
                },
                tlsOptions: { 
                    rejectUnauthorized: false
                },
                connTimeout: 45000,
                authTimeout: 45000,
                keepalive: {
                    interval: 5000,    // NOOP every 5s — near-instant dead connection detection
                    idleInterval: 10000, // Re-IDLE every 10s — fastest possible mail push
                    forceNoop: true
                }
            };

            // Handle OAuth providers with XOAUTH2
            if (integration.provider === 'gmail' || integration.provider === 'outlook') {
                // Part 1: Force-refresh the token if it expires within 10 minutes so we always
                // start the IMAP session with a token good for ≥50 minutes.
                const token = integration.provider === 'gmail'
                    ? await gmailOAuth.getValidToken(integration.userId, integration.accountType || undefined, true /* forceRefreshIfExpiringSoon */)
                    : await outlookOAuth.getValidToken(integration.userId, true /* forceRefreshIfExpiringSoon */);

                if (token) {
                    imapOptions.xoauth2 = Buffer.from(
                        `user=${imapOptions.user}\x01auth=Bearer ${token}\x01\x01`
                    ).toString('base64');
                    
                    wsSync.broadcastToUser(integration.userId, {
                        type: 'sync_status',
                        payload: {
                            integrationId,
                            provider: integration.provider,
                            status: 'connected',
                            realtime: true,
                            method: 'idle'
                        }
                    });
                    // Remove password for OAuth
                    delete imapOptions.password;
                } else {
                    console.warn(`[IMAP] Could not get OAuth token for ${integration.provider} integration ${integrationId}`);
                    return;
                }
            } else {
                imapOptions.password = config.smtp_pass!;
            }

            const imap = new Imap(imapOptions);

            if (!this.connections.has(integrationId)) this.connections.set(integrationId, new Map());
            this.connections.get(integrationId)!.set('discovery', imap);

            const safeEnd = () => {
                try {
                    if (imap.state !== 'disconnected') imap.end();
                } catch (err) {
                    console.warn('[IMAP] Error ending connection in setupConnection safeEnd:', (err as Error)?.message);
                }
            };

            imap.once('ready', async () => {
                try {
                    await this.discoverFolders(integrationId, imap);
                    const folders = this.folders.get(integrationId);
                    
                    // This first connection handles INBOX discovery and IDLE
                    const primaryInbox = folders?.inbox[0] || 'INBOX';
                    this.setupPersistentListener(integrationId, primaryInbox, integration, 'inbound');

                    // If we have a Sent folder, spawn a second persistent listener for "Real Mail App" 0s discovery
                    const primarySent = folders?.sent[0];
                    if (primarySent) {
                        this.setupPersistentListener(integrationId, primarySent, integration, 'outbound');
                    }

                    // Close this discovery connection as we now have specific persistent ones
                    imap.end();
                } catch (readyErr) {
                    console.error(`[IMAP] CRITICAL: Discovery/setup failed for integration ${integrationId}:`, readyErr);
                    imap.end();
                }
            });

            imap.once('error', async (err: any) => {
                try {
                    // Phase 19: Full Error Diagnostics. Log everything to debug production loops.
                    const errorDetails = {
                        code: err.code,
                        message: err.message || 'No explicit message',
                        stack: err.stack ? 'present' : 'none',
                        integrationId,
                        userId: integration.userId
                    };
                    workerHealthMonitor.recordError('IMAP IDLE', err.message);

                    const fatalErrors = ['AUTHENTICATIONFAILED', 'Not authenticated', 'Invalid credentials', 'Login failed', 'BAD', 'NO'];
                    const errorStr = (err.code || err.message || '').toLowerCase();
                    const isAuthError = fatalErrors.some(code => errorStr.includes(code.toLowerCase()));
                    const isTimeout = errorStr.includes('timed out') || errorStr.includes('etimedout');
                    // OAuth providers retry with token refresh — not a permanent failure
                    const isOAuth = integration.provider === 'gmail' || integration.provider === 'outlook';

                    const integrationLatest = await storage.getIntegrationById(integrationId);
                    if (integrationLatest) {
                        // Phase 23: Production Safety. Link to Health Service to manage failure counts and "failed" state.
                        await mailboxHealthService.handleMailboxFailure(integrationLatest, err.message || 'IMAP Connection Error');

                        // Re-fetch to see if health service changed the status
                        const updated = await storage.getIntegrationById(integrationId);

                        // Only forceDisconnect non-OAuth providers with confirmed permanent auth failure.
                        // Gmail/Outlook get a reconnect+token-refresh instead.
                        if (updated && updated.healthStatus === 'failed' && isAuthError && !isOAuth) {
                            console.warn(`🛑 Strike 3 for integration ${integrationId} (Auth Error). Killing connection permanently.`);
                            wsSync.notifyIntegrationError(integration.userId, {
                                integrationId,
                                type: 'mailbox_failure',
                                title: 'Mailbox Disconnected',
                                message: `Permanent authentication failure for ${integration.accountType}. Please reconnect.`,
                                critical: true
                            });
                            this.forceDisconnect(integrationId, integration.userId);
                            return;
                        }

                        // Notify UI of the warning/failure instantly
                        wsSync.notifyIntegrationError(integration.userId, {
                            integrationId,
                            type: updated?.healthStatus === 'failed' ? 'mailbox_failure' : 'mailbox_warning',
                            title: updated?.healthStatus === 'failed' ? 'Connection Failed' : 'Connection Warning',
                            message: err.message || 'IMAP Connection Error',
                            critical: (updated?.healthStatus === 'failed') && !isOAuth
                        });

                        if (isTimeout) {
                            console.log(`⏳ Transient timeout for ${integrationId}. standardized retry will follow.`);
                        }
                    }

                    if (isAuthError) {
                        // OAuth: stale token — back off 5m so gmailOAuth.getValidToken() can refresh on next attempt
                        // custom_email: likely wrong password — back off 10m
                        const backoffMs = isOAuth ? 5 * 60 * 1000 : 10 * 60 * 1000;
                        console.warn(`🔄 Auth issue for integration ${integrationId} (${isOAuth ? 'OAuth stale token — will refresh' : 'credentials error'}). Retry in ${backoffMs / 60000}m...`);
                        try { imap.destroy(); } catch (e) { console.debug('[IMAP] Error destroying on auth error:', (e as Error)?.message); }
                        this.cleanupIntegration(integrationId);
                        this.backoffDelays.set(integrationId, backoffMs); 
                        this.reconnect(integrationId, integration);
                    } else {
                        console.warn(`⏳ Transient IMAP error for ${integrationId} (${err.code || 'unknown'}). Triggering reconnect...`);
                        try { imap.destroy(); } catch (e) { console.debug('[IMAP] Error destroying on transient error:', (e as Error)?.message); }
                        this.reconnect(integrationId, integration); 
                    }
                } catch (fatalErr) {
                    console.error('[IMAP] CRITICAL: Exception in error handler:', fatalErr);
                }
            });

            imap.once('end', () => {
                console.log(`IMAP discovery connection ended for integration ${integrationId}`);
                if (this.connections.get(integrationId)?.get('discovery') === imap) {
                    this.connections.get(integrationId)!.delete('discovery');
                }
            });

            try {
                imap.connect();
            } catch (err: any) {
                console.error(`IMAP synchronous connect error for integration ${integrationId}:`, err.message);
                this.reconnect(integrationId, integration);
            }
        } catch (error) {
            console.error(`Failed to setup IMAP connection for integration ${integrationId}:`, error);
        }
    }

    private async setupPersistentListener(integrationId: string, folderName: string, integration: Integration, direction: 'inbound' | 'outbound'): Promise<void> {
        try {
            // OAuth providers (gmail/outlook) authenticate via live access token — no encryptedMeta needed.
            const isOAuthProvider = integration.provider === 'gmail' || integration.provider === 'outlook';

            let config: EmailConfig = {};
            if (!isOAuthProvider) {
                if (!integration.encryptedMeta) {
                    console.debug(`[IMAP Persistent] Skipping ${folderName} for ${integrationId} — encryptedMeta missing.`);
                    return;
                }
                const credentialsStr = await decrypt(integration.encryptedMeta);
                config = JSON.parse(credentialsStr) as EmailConfig;
            }

            let imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
            const imapPort = config.imap_port || 993;

            if (!imapHost) {
                if (integration.provider === 'gmail') imapHost = 'imap.gmail.com';
                else if (integration.provider === 'outlook') imapHost = 'outlook.office365.com';
            }

            if (!imapHost) {
                console.debug(`[IMAP Persistent] Skipping folder ${folderName} for ${integrationId} — imap_host not found.`);
                return;
            }

            const imapOptions: any = {
                user: config.smtp_user || integration.accountType || '',
                host: imapHost,
                port: imapPort,
                tls: parseInt(String(imapPort)) === 993,
                // Force IPv4 for cloud environment stability
                family: 4,
                lookup: (hostname: string, options: any, callback: any) => {
                    dns.resolve4(hostname, (err, addresses) => {
                        if (err || !addresses || addresses.length === 0) {
                            return callback(err || new Error('No IPv4 found'), null, 4);
                        }
                        callback(null, addresses[0], 4);
                    });
                },
                tlsOptions: { rejectUnauthorized: false },
                keepalive: {
                    interval: 5000,    // NOOP every 5s — instant heartbeat
                    idleInterval: 10000, // Re-IDLE every 10s — fastest mail push
                    forceNoop: true
                }
            };

            if (isOAuthProvider) {
                // Part 2: Force-refresh the token on each persistent connection setup so
                // the IMAP session always starts with a token good for ≥50 minutes.
                const token = integration.provider === 'gmail'
                    ? await gmailOAuth.getValidToken(integration.userId, integration.accountType || undefined, true /* forceRefreshIfExpiringSoon */)
                    : await outlookOAuth.getValidToken(integration.userId, true /* forceRefreshIfExpiringSoon */);

                if (!token) {
                    console.warn(`[IMAP Persistent] Could not get OAuth token for ${integration.provider} integration ${integrationId}. Aborting persistent listener.`);
                    return;
                }
                const user = integration.accountType || config.smtp_user || '';
                imapOptions.user = user;
                imapOptions.xoauth2 = Buffer.from(`user=${user}\x01auth=Bearer ${token}\x01\x01`).toString('base64');
            } else {
                imapOptions.password = config.smtp_pass!;
            }

            const imap = new Imap(imapOptions);
            
            if (!this.connections.has(integrationId)) this.connections.set(integrationId, new Map());
            this.connections.get(integrationId)!.set(folderName, imap);

            const cleanup = () => {
                if (this.connections.get(integrationId)?.get(folderName) === imap) {
                    this.connections.get(integrationId)!.delete(folderName);
                }
                const intervals = this.syncIntervals.get(integrationId);
                if (intervals?.has(folderName)) {
                    clearInterval(intervals.get(folderName)!);
                    intervals.delete(folderName);
                }
                const restarts = this.restartTimers.get(integrationId);
                if (restarts?.has(folderName)) {
                    clearTimeout(restarts.get(folderName)!);
                    restarts.delete(folderName);
                }
                try { imap.destroy(); } catch (e) { console.debug('[IMAP] Error destroying in persistent listener cleanup:', (e as Error)?.message); }
            };

            imap.once('ready', () => {
                workerHealthMonitor.recordSuccess('IMAP IDLE');
                // Reset backoff on successful connect so next disconnect recovers fast (5s)
                this.backoffDelays.delete(integrationId);
                this.lastActivity.set(`${integrationId}:${folderName}`, new Date());

                imap.openBox(folderName, false, (err: any) => {
                    if (err) {
                        console.error(`[IMAP] Failed to open ${folderName} for integration ${integrationId}:`, err.message);
                        workerHealthMonitor.recordError('IMAP IDLE', err.message);
                        cleanup();
                        return;
                    }

                    console.log(`✅ Real-time IDLE active on '${folderName}' for integration ${integrationId} (${direction})`);
                    
                    wsSync.notifyActivityUpdated(integration.userId, {
                        type: 'sync_active',
                        integrationId,
                        title: '⚡ Real-time Sync Active',
                        message: `Monitoring ${direction} on ${folderName}`
                    });

                    this.fetchNewEmails(integrationId, integration.userId, imap, folderName, direction);

                    imap.on('mail', (num: number) => {
                        workerHealthMonitor.recordSuccess('IMAP IDLE');
                        this.lastActivity.set(`${integrationId}:${folderName}`, new Date());
                        console.log(`📬 [${folderName}] Integration ${integrationId} received ${num} new messages (IDLE push)`);
                        this.fetchNewEmails(integrationId, integration.userId, imap, folderName, direction);
                    });

                    imap.on('expunge', (seq: number) => {
                        console.log(`🗑️ [${folderName}] Integration ${integrationId} expunged message. Syncing deletions.`);
                        this.syncDeletedMessages(integrationId, imap, integration.userId, folderName);
                    });

                    // Flag synchronization (Read/Unread) - Optimized for high performance
                    imap.on('update', (seqno: number, info: any) => {
                        if (info.flags) {
                            const isSeen = info.flags.includes('\\Seen');
                            console.log(`🔄 [${folderName}] Flag update: seq ${seqno} is now ${isSeen ? 'READ' : 'UNREAD'} for ${integrationId}`);
                            
                            // Advanced: Fetch the specific UID to perform a surgically precise DB update
                            // instead of a full folder fetch.
                            const fetch = (imap as any).seq.fetch(seqno.toString(), { struct: false, bodies: 'HEADER.FIELDS (MESSAGE-ID)' });
                            fetch.on('message', (msg: any) => {
                                msg.on('attributes', async (attrs: any) => {
                                    const uid = attrs.uid;
                                    try {
                                        const { db } = await import('@shared/lib/db/db.js');
                                        const { emailMessages } = await import('@audnix/shared');
                                        const { eq, and } = await import('drizzle-orm');
                                        
                                        await db.update(emailMessages)
                                            .set({ isRead: isSeen, updatedAt: new Date() })
                                            .where(and(
                                                eq(emailMessages.integrationId, integrationId),
                                                eq(emailMessages.uid, uid)
                                            ));
                                            
                                        // Push real-time state to the frontend
                                        wsSync.notifyMessagesUpdated(integration.userId, { 
                                            integrationId, 
                                            uid, 
                                            isRead: isSeen,
                                            type: 'flag_update' 
                                        });
                                        wsSync.notifyStatsUpdated(integration.userId);
                                    } catch (err) {
                                        console.warn("[IMAP Flag Sync] Failed to update specific message state:", err);
                                    }
                                });
                            });
                        }
                    });

                    if (typeof (imap as any).idle === 'function') (imap as any).idle();

                    if (!this.syncIntervals.has(integrationId)) this.syncIntervals.set(integrationId, new Map());
                    const interval = setInterval(async () => {
                        if (this.connections.get(integrationId)?.get(folderName) === imap) {
                            if (imap.state === 'authenticated') {
                                try {
                                    // Phase 25: Distributed Lock Heartbeat
                                    const lockKey = `imap:conn:${integrationId}`;
                                    const extended = await extendLock(lockKey, 300);
                                    if (!extended) {
                                      console.warn(`[IMAP] 🚨 Lost distributed lock for ${integrationId}. Attempting to re-acquire...`);
                                      const reacquired = await acquireDistributedLock(lockKey, 300);
                                      if (!reacquired) {
                                        console.error(`[IMAP] ❌ Could not re-acquire lock for ${integrationId}. Someone else might be syncing.`);
                                        return;
                                      }
                                    }

                                    this.fetchNewEmails(integrationId, integration.userId, imap, folderName, direction);
                                } catch (e) {
                                    console.warn('[IMAP] Error in heartbeat interval fetch for', integrationId, (e as Error)?.message);
                                }
                            }
                        }
                    }, 5 * 1000); // 5s heartbeat — instant sync trigger
                    this.syncIntervals.get(integrationId)!.set(folderName, interval);

                    // Phase 26: Proactive Recycling (RFC 2177 Safety)
                    // Servers MUST terminate IDLE after 30 mins. We reset at 29 mins to be safe.
                    if (!this.restartTimers.has(integrationId)) this.restartTimers.set(integrationId, new Map());
                    const restartTimer = setTimeout(() => {
                        console.log(`🔄 [IMAP] Proactive 29m recycle for ${integrationId}:${folderName}`);
                        this.forceRecycleConnection(integrationId, folderName);
                    }, 29 * 60 * 1000);
                    this.restartTimers.get(integrationId)!.set(folderName, restartTimer);
                });
            });

            imap.once('error', (err: any) => {
                workerHealthMonitor.recordError('IMAP IDLE', err.message);
                console.error(`[IMAP Persistent] Error on ${folderName} for ${integrationId}:`, err.message);
                // Part 8: OAuth providers get a reconnect+token-refresh; only non-OAuth gets permanent disconnect
                const isOAuth = integration.provider === 'gmail' || integration.provider === 'outlook';
                const fatalErrors = ['AUTHENTICATIONFAILED', 'Not authenticated', 'Invalid credentials', 'Login failed'];
                const isAuthError = fatalErrors.some(code => (err.code || err.message || '').toLowerCase().includes(code.toLowerCase()));
                if (isAuthError && !isOAuth) {
                    // Non-OAuth with confirmed bad credentials — don't reconnect infinitely
                    console.warn(`[IMAP Persistent] ❌ Permanent auth failure on ${folderName} for ${integrationId}. Not reconnecting.`);
                    cleanup();
                } else {
                    this.reconnect(integrationId, integration);
                }
            });

            imap.once('end', () => {
                workerHealthMonitor.recordError('IMAP IDLE', 'Connection ended unexpectedly');
                // Part 2+8: Auto-reconnect on unexpected end for OAuth listeners so a fresh token is used
                const isOAuth = integration.provider === 'gmail' || integration.provider === 'outlook';
                if (isOAuth && this.connections.get(integrationId)?.get(folderName) === imap) {
                    console.log(`[IMAP Persistent] 🔄 OAuth connection ended for ${integrationId}:${folderName}. Scheduling reconnect with fresh token...`);
                    cleanup();
                    setTimeout(() => this.reconnect(integrationId, integration), 2000);
                }
            });

            imap.once('close', (hadError: boolean) => {
                workerHealthMonitor.recordError('IMAP IDLE', `Connection closed (hadError: ${hadError})`);
                // Phase 22: Infinite Persistence
                // Always trigger reconnect() for active mailboxes, even if no explicit error occurred.
                console.log(`🔌 [IMAP] Connection closed for ${integrationId} (${folderName}). Had error: ${hadError}. Triggering resurrection...`);
                this.reconnect(integrationId, integration);
            });

            imap.connect();
        } catch (e) {
            console.error(`[IMAP Persistent] Setup failed for ${folderName}:`, e);
        }
    }

    private async syncAccountFolders(integrationId: string, imap: Imap, userId: string): Promise<void> {
        if (imap.state !== 'authenticated') return;
        if (this.syncing.has(integrationId)) return;
        this.syncing.add(integrationId);
        
        // Instant notify UI
        wsSync.notifySyncStatus(userId, { syncing: true, integrationId });

        try {
            const folders = this.folders.get(integrationId);
            if (!folders) return;

            // Sync all discovered folders using the provided connection
            // Note: This connection is transient or one of the persistent ones
            for (const inbox of folders.inbox) await this.fetchNewEmails(integrationId, userId, imap, inbox, 'inbound');
            for (const sent of folders.sent) await this.fetchNewEmails(integrationId, userId, imap, sent, 'outbound');
            for (const spam of folders.spam) await this.fetchNewEmails(integrationId, userId, imap, spam, 'inbound', true);
        } catch (error) {
            console.error(`[IMAP] Sync folders failed for ${integrationId}:`, error);
        } finally {
            this.syncing.delete(integrationId);
            wsSync.notifySyncStatus(userId, { syncing: false, integrationId });
        }
    }

    private async fetchNewEmails(integrationId: string, userId: string, imap: Imap, folderName: string = 'INBOX', direction: 'inbound' | 'outbound' = 'inbound', isSpam = false): Promise<void> {
        const syncKey = `${integrationId}:${folderName}`;
        if (this.syncingFolders.has(syncKey)) return;
        this.syncingFolders.add(syncKey);

        try {
            wsSync.notifySyncStatus(userId, { syncing: true, folder: folderName, integrationId });

            const { CursorSyncService } = await import('./cursor-sync-service.js');

            await this.executeImapCommand(imap, (cb) => {
                imap.openBox(folderName, true, async (err, box) => {
                    if (err) return cb(err, null);

                    if (!box || !box.messages || box.messages.total === 0) {
                        return cb(null, null);
                    }

                    const uidNext = (box as any).uidnext;
                    const fetchConfig = await CursorSyncService.getFetchRange(integrationId, folderName, uidNext);
                    
                    let fetch;
                    const fetchOptions = { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', struct: true };
                    
                    if (fetchConfig.type === 'uid') {
                      console.log(`[IMAP] ⚡ Cursor Sync (Headers): Fetching UIDs ${fetchConfig.range} for ${folderName}`);
                      fetch = (imap as any).uid.fetch(fetchConfig.range, fetchOptions);
                    } else {
                      const total = box.messages.total;
                      const fetchLimit = total < 50 ? 1 : total - 49;
                      console.log(`[IMAP] 🐢 Full Sync (Headers): Fetching sequences ${fetchLimit}:* for ${folderName}`);
                      fetch = imap.seq.fetch(`${fetchLimit}:*`, fetchOptions);
                    }

                    const emails: any[] = [];
                    let maxUid = 0;

                    fetch.on('message', (msg: any, seqno: number) => {
                        let attrs: any;
                        msg.on('attributes', (a: any) => {
                            attrs = a;
                            if (attrs.uid > maxUid) maxUid = attrs.uid;
                        });
                        msg.on('body', (stream: any) => {
                            simpleParser(stream, (err: any, parsed: any) => {
                                if (!err && parsed) {
                                    emails.push({
                                        from: parsed.from?.text,
                                        to: parsed.to?.text,
                                        subject: parsed.subject,
                                        text: '', // Body will be fetched sequentially if needed
                                        date: parsed.date || new Date(),
                                        flags: attrs?.flags || [],
                                        uid: attrs?.uid || seqno,
                                        messageId: parsed.messageId,
                                        inReplyTo: parsed.inReplyTo,
                                        isSpam: isSpam,
                                        headers: parsed.headers
                                    });
                                }
                            });
                        });
                    });

                    fetch.once('error', (err: any) => cb(err, null));
                    fetch.once('end', async () => {
                        try {
                            if (emails.length > 0) {
                                const nonWarmupEmails = emails.filter(e => !e.headers?.get('x-audnix-warmup'));
                                if (nonWarmupEmails.length < emails.length) {
                                    console.log(`[IMAP] Filtered out ${emails.length - nonWarmupEmails.length} warmup email(s)`);
                                }
                                console.log(`📥 Processing ${nonWarmupEmails.length} ${direction} emails from ${folderName}`);
                                const importRes = await pagedEmailImport(userId, nonWarmupEmails.map(e => ({
                                    from: e.from?.split('<')[1]?.split('>')[0] || e.from,
                                    to: e.to?.split('<')[1]?.split('>')[0] || e.to,
                                    subject: e.subject,
                                    text: e.text,
                                    date: e.date,
                                    html: e.html,
                                    isRead: e.flags?.includes('\Seen') || false,
                                    messageId: e.messageId,
                                    inReplyTo: e.inReplyTo,
                                    integrationId: integrationId,
                                    isSpam: isSpam
                                })), undefined, direction);

                                if (importRes.imported > 0) {
                                    wsSync.notifyMessagesUpdated(userId, { 
                                        event: 'INSERT', 
                                        count: importRes.imported,
                                        integrationId,
                                        folder: folderName
                                    });

                                    // If we detect a reply in the imported batch, fire a specific high-priority event
                                    const hasReply = emails.some(e => e.inReplyTo || (e.subject && e.subject.toLowerCase().startsWith('re:')));
                                    if (hasReply && direction === 'inbound') {
                                        // Enqueue high-priority reply-detection job for instant AI processing
                                        try {
                                            const { emailSyncQueue } = await import('@shared/lib/queues/email-sync-queue.js');
                                            if (emailSyncQueue) {
                                                await emailSyncQueue.add('reply-detected', {
                                                    type: 'reply-detected',
                                                    integrationId,
                                                    userId,
                                                    hasReply: true,
                                                }, { priority: 1 });
                                            }
                                        } catch (_e) {
                                            console.warn('[IMAP] Failed to enqueue reply-detected job for', integrationId);
                                        }
                                        wsSync.notifyActivityUpdated(userId, {
                                            type: 'reply_detected',
                                            integrationId,
                                            details: {
                                                folder: folderName,
                                                timestamp: new Date()
                                            }
                                        });
                                    }
                                    
                                    // Update Cursor
                                    if (maxUid > 0) {
                                      await CursorSyncService.updateMetadata(integrationId, folderName, { lastUid: maxUid });
                                    }

                                    if (isSpam) {
                                        // REAL-TIME SPAM PLACEMENT DETECTION
                                        // When emails arrive in the spam folder via IDLE push, immediately check
                                        // if they match our tracked sent emails and mark placement as 'spam'.
                                        try {
                                            const { db } = await import('@shared/lib/db/db.js');
                                            const { emailTracking: etSchema } = await import('@audnix/shared');
                                            const { eq, and, gte: gteF } = await import('drizzle-orm');
                                            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

                                            const recentSent = await db.select({
                                                id: etSchema.id,
                                                subject: etSchema.subject,
                                            }).from(etSchema)
                                            .where(and(
                                                eq(etSchema.integrationId, integrationId),
                                                gteF(etSchema.sentAt, oneDayAgo)
                                            ))
                                            .limit(100);

                                            if (recentSent.length > 0) {
                                                let spamDetected = 0;
                                                for (const email of nonWarmupEmails) {
                                                    const subj = (email.subject || '').toLowerCase();
                                                    if (!subj) continue;
                                                    const match = recentSent.find(s => s.subject && subj === s.subject.toLowerCase());
                                                    if (match) {
                                                        spamDetected++;
                                                        await db.update(etSchema)
                                                            .set({ placement: 'spam', placementUpdatedAt: new Date() })
                                                            .where(eq(etSchema.id, match.id));
                                                    }
                                                }
                                                if (spamDetected > 0) {
                                                    console.warn(`⚡ [IMAP-Spam] Real-time: ${spamDetected} emails detected in spam folder for ${integrationId}`);
                                                    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
                                                    await clusterSync.notifyActivityUpdated(userId, {
                                                        type: 'spam_detected',
                                                        integrationId,
                                                        spamCount: spamDetected,
                                                        message: `${spamDetected} email(s) detected in spam folder in real-time.`
                                                    }).catch(() => {});
                                                    // Push deliverability update so UI refreshes inbox-placement stats immediately
                                                    wsSync.notifyDeliverabilityUpdated(userId, {
                                                        integrationId,
                                                        spamCount: spamDetected,
                                                        source: 'imap_idle'
                                                    });
                                                }
                                            }
                                        } catch (spamErr) {
                                            console.warn('[IMAP] Real-time spam detection error:', (spamErr as Error)?.message);
                                        }

                                        const { triggerImmediateReputationCheck } = await import('./reputation-monitor.js');
                                        triggerImmediateReputationCheck(integrationId).catch(console.error);
                                    }
                                    
                                    // Always notify stats updated for real-time KPIs
                                    wsSync.notifyStatsUpdated(userId);
                                    // Invalidate server-side dashboard stats cache
                                    import('@shared/lib/realtime/redis-pubsub.js').then(({ clusterSync }) => {
                                      clusterSync.notifyStatsCacheInvalidate(userId).catch(() => {});
                                    }).catch(() => {});
                                    
                                    // Trigger autonomous AI reply for new inbound messages
                                    if (direction === 'inbound' && !isSpam) {
                                        if (process.env.GLOBAL_AI_PAUSE === 'true') {
                                            console.warn("[IMAP] Global AI Pause active. Skipping automated analysis/reply.");
                                        } else {
                                            try {
                                                const { users } = await import('@audnix/shared');
                                            const { eq } = await import('drizzle-orm');
                                            const { db } = await import('@shared/lib/db/db.js');

                                            const userRow = await db.select({ config: users.config }).from(users).where(eq(users.id, userId)).limit(1);
                                            const config = (userRow[0]?.config as any) || {};
                                            const isAutonomousMode = config.autonomousMode !== false;

                                            const integration = await storage.getIntegrationById(integrationId);
                                            const integrationCreatedAt = integration ? new Date(integration.createdAt) : null;

                                            for (const email of emails) {
                                                const emailDate = new Date(email.date);
                                                const isHistorical = integrationCreatedAt ? emailDate.getTime() < integrationCreatedAt.getTime() : false;
                                                
                                                if (isHistorical) {
                                                    console.log(`[IMAP] Skipping fast-track AI analysis/reply for historical email from ${email.from}`);
                                                    continue;
                                                }

                                                const lead = await storage.getLeadByEmail(email.from?.split('<')[1]?.split('>')[0] || email.from, userId);
                                                if (lead) {
                                                    if (!isAutonomousMode || lead.aiPaused) continue;

                                                    let messageBody = email.text;
                                                    if (!messageBody && email.uid) {
                                                        const fullBody = await this.fetchFullMessageBody(imap, email.uid);
                                                        messageBody = fullBody.text || '';
                                                    }

                                                    const { processInboundMessageWithAnalysis } = await import('@services/brain-worker/src/ai-lib/analyzers/inbound-message-analyzer.js');
                                                    const analysis = await processInboundMessageWithAnalysis(lead.id, messageBody, 'email');

                                                    wsSync.notifyMessagesUpdated(userId, { 
                                                        leadId: lead.id, 
                                                        message: { 
                                                            id: email.id, 
                                                            content: messageBody,
                                                            direction: 'inbound', 
                                                            createdAt: email.date,
                                                            intent: analysis?.urgencyLevel
                                                        },
                                                        integrationId
                                                    });
                                                    
                                                    if (analysis?.shouldAutoReply) {
                                                        // Look up active campaign for this lead to schedule proper auto-reply
                                                        try {
                                                            const { db } = await import('@shared/lib/db/db.js');
                                                            const { campaignLeads, outreachCampaigns } = await import('@audnix/shared');
                                                            const { eq, and } = await import('drizzle-orm');

                                                            const [activeEntry] = await db.select({
                                                                campaignId: campaignLeads.campaignId,
                                                                campaignLeadId: campaignLeads.id,
                                                                integrationId: campaignLeads.integrationId,
                                                            })
                                                            .from(campaignLeads)
                                                            .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
                                                            .where(and(
                                                                eq(campaignLeads.leadId, lead.id),
                                                                eq(outreachCampaigns.userId, userId),
                                                                eq(outreachCampaigns.status, 'active')
                                                            ))
                                                            .limit(1);

                                                            if (activeEntry) {
                                                                const { campaignQueueManager } = await import('@shared/lib/queues/campaign-queue.js');
                                                                await campaignQueueManager.scheduleAutoReply(
                                                                    activeEntry.campaignId,
                                                                    userId,
                                                                    activeEntry.campaignLeadId,
                                                                    activeEntry.integrationId || '',
                                                                    lead.id
                                                                );
                                                                console.log(`⚡ [Fast-Track] Scheduled campaign auto-reply for lead ${lead.id}`);
                                                            } else {
                                                                // No active campaign — enqueue priority reply for AI handling
                                                                const { enqueuePriorityReply } = await import('@shared/lib/queues/outreach-queue.js');
                                                                await enqueuePriorityReply({
                                                                    userId,
                                                                    leadId: lead.id,
                                                                    type: 'autonomous_reply',
                                                                    isAutonomous: true,
                                                                });
                                                                console.log(`⚡ [Fast-Track] Enqueued priority AI reply for lead ${lead.id} (no campaign)`);
                                                            }
                                                        } catch (campaignErr) {
                                                            console.warn(`[Fast-Track] Campaign lookup failed, falling back to priority reply:`, campaignErr);
                                                            const { enqueuePriorityReply } = await import('@shared/lib/queues/outreach-queue.js');
                                                            await enqueuePriorityReply({
                                                                userId,
                                                                leadId: lead.id,
                                                                type: 'autonomous_reply',
                                                                isAutonomous: true,
                                                            });
                                                        }
                                                    }
                                                }
                                            }
                                        } catch (aiErr) {
                                            console.error('[IMAP] AI trigger error:', aiErr);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (importError) {
                            console.error(`[IMAP] CRITICAL: Failed to import emails from ${folderName}:`, importError);
                        } finally {
                            cb(null, null);
                        }
                    });
                });
            });
        } catch (error: any) {
            console.warn(`[IMAP] fetchNewEmails failed for ${folderName}:`, error.message);
        } finally {
            this.syncingFolders.delete(syncKey);
            wsSync.notifySyncStatus(userId, { syncing: false, folder: folderName, integrationId });
        }
    }

    private async fetchFullMessageBody(imap: Imap, uid: number): Promise<{ text: string, html?: string }> {
        return new Promise((resolve) => {
            const fetch = (imap as any).uid.fetch(uid.toString(), { bodies: '' });
            fetch.on('message', (msg: any) => {
                msg.on('body', (stream: any) => {
                    simpleParser(stream, (err, parsed) => {
                        if (err || !parsed) resolve({ text: '(Error fetching body)' });
                        else resolve({ text: parsed.text || parsed.html || '', html: parsed.html || undefined });
                    });
                });
            });
            fetch.once('error', () => resolve({ text: '(Error fetching body)' }));
        });
    }

    private async syncDeletedMessages(integrationId: string, imap: Imap, userId: string, folderName: string): Promise<void> {
        try {
            await this.executeImapCommand(imap, (cb) => {
                imap.openBox(folderName, true, (err, box) => {
                    if (err || !box || box.messages.total === 0) return cb(err, null);

                    const fetchRange = box.messages.total < 500 ? '1:*' : `${box.messages.total - 499}:*`;
                    const fetch = imap.seq.fetch(fetchRange, { struct: false, bodies: 'HEADER.FIELDS (MESSAGE-ID)' });
                    const imapMessageIds = new Set<string>();

                    fetch.on('message', (msg: any) => {
                        msg.on('body', (stream: any) => {
                            let buffer = '';
                            stream.on('data', (chunk: any) => buffer += chunk.toString());
                            stream.on('end', () => {
                                const match = buffer.match(/Message-ID:\s*(<[^>]+>)/i);
                                if (match && match[1]) imapMessageIds.add(match[1]);
                            });
                        });
                    });

                    fetch.once('error', (err: any) => cb(err, null));
                    fetch.once('end', async () => {
                        try {
                            const { db } = await import('@shared/lib/db/db.js');
                            const { messages } = await import('@audnix/shared');
                            const { eq, and, desc, inArray } = await import('drizzle-orm');

                            const recentDbMessages = await db.select()
                                .from(messages)
                                .where(and(eq(messages.userId, userId), eq(messages.integrationId, integrationId)))
                                .orderBy(desc(messages.createdAt))
                                .limit(100);

                            const toDelete: string[] = [];
                            for (const dbMsg of recentDbMessages) {
                                if (dbMsg.provider === 'email' && dbMsg.metadata && (dbMsg.metadata as any).messageId) {
                                    const mid = (dbMsg.metadata as any).messageId;
                                    if (!imapMessageIds.has(mid)) toDelete.push(dbMsg.id);
                                }
                            }

                            if (toDelete.length > 0) {
                                await db.delete(messages).where(inArray(messages.id, toDelete));
                                wsSync.notifyMessagesUpdated(userId, { event: 'DELETE', messageIds: toDelete });
                                wsSync.notifyStatsUpdated(userId);
                                console.log(`[IMAP] Synced ${toDelete.length} deletions.`);
                            }
                        } catch (e) {
                            console.warn('[IMAP] Error syncing deleted messages:', (e as Error)?.message);
                        }
                        cb(null, null);
                    });
                });
            });
        } catch (error: any) {
            console.error(`[IMAP] syncDeletedMessages failed for ${integrationId}:`, error.message);
        }
    }

    private cleanupIntegration(integrationId: string): void {
        const folderMap = this.connections.get(integrationId);
        if (folderMap) {
            for (const imap of folderMap.values()) {
                try { 
                    if ((imap as any)._idleWaiter) (imap as any).stopIdle();
                    imap.destroy();
                } catch (e) { console.warn('[IMAP] Error destroying connection in cleanupIntegration:', (e as Error)?.message); }
            }
        }
        this.connections.delete(integrationId);

        const intervals = this.syncIntervals.get(integrationId);
        if (intervals) {
            for (const interval of intervals.values()) clearInterval(interval);
            this.syncIntervals.delete(integrationId);
        }

        this.folders.delete(integrationId);
        this.syncing.delete(integrationId);
        this.backoffDelays.delete(integrationId);
        this.failureCooldowns.delete(integrationId);

        for (const [key] of this.lastActivity) {
            if (key.startsWith(`${integrationId}:`)) {
                this.lastActivity.delete(key);
            }
        }

        const timer = this.reconnectTimers.get(integrationId);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(integrationId);
        }

        const restartMap = this.restartTimers.get(integrationId);
        if (restartMap) {
            for (const [, rt] of restartMap) clearTimeout(rt);
            this.restartTimers.delete(integrationId);
        }

        for (const [key] of this.syncingFolders) {
            if (key.startsWith(`${integrationId}:`)) {
                this.syncingFolders.delete(key);
            }
        }

        const pollingEntry = this.pollingOnlyIntegrations.get(integrationId);
        if (pollingEntry) {
            clearInterval(pollingEntry.interval);
            this.pollingOnlyIntegrations.delete(integrationId);
        }
    }

    private reconnect(integrationId: string, integration: Integration): void {
        if (!this.isRunning) return;

        console.log(`🔄 Preparing IMAP reconnection for ${integrationId} (${integration.provider})...`);
        this.cleanupIntegration(integrationId);

        const currentDelay = this.backoffDelays.get(integrationId) || this.MIN_BACKOFF;
        // Phase 13: Exponential Backoff with Jitter (prevents synchronized thundering herd)
        const jitter = 0.5 + Math.random(); // 0.5 to 1.5 range
        const nextDelay = Math.min(Math.floor(currentDelay * 2 * jitter), this.MAX_BACKOFF);
        this.backoffDelays.set(integrationId, nextDelay);

        console.log(`🔄 Reconnecting IMAP for ${integrationId} in ${Math.round(currentDelay / 1000)}s (Next wait: ${Math.round(nextDelay / 1000)}s)...`);

        // Clear existing timer if any
        const existingTimer = this.reconnectTimers.get(integrationId);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(async () => {
            this.reconnectTimers.delete(integrationId);

            if (!this.isRunning || this.connections.has(integrationId)) return;

            // Phase 14: Database Verification — ensure integration still exists before reconnecting
            try {
                const checkInt = await storage.getIntegrationById(integrationId);
                if (!checkInt || !checkInt.connected) {
                    console.log(`🔌 [IMAP Reconnect] Aborting — integration ${integrationId} is no longer connected or was deleted.`);
                    return;
                }
                
                // Phase 24: Production Safety — Stop retrying if mailbox is marked as failed (e.g. 10+ auth failures)
                if (checkInt.healthStatus === 'failed') {
                    console.log(`🔌 [IMAP Reconnect] Aborting — integration ${integrationId} is in FAILED state. User intervention required to fix credentials.`);
                    return;
                }
            } catch (e) {
                console.error(`[IMAP Reconnect] DB Check failed for ${integrationId}:`, e);
                return;
            }

            // For OAuth providers, proactively refresh token before reconnecting.
            // Transient failures will retry via backoff instead of permanent abort.
            if (integration.provider === 'gmail' || integration.provider === 'outlook') {
                try {
                    const token = integration.provider === 'gmail'
                        ? await gmailOAuth.getValidToken(integration.userId, integration.accountType || undefined)
                        : await outlookOAuth.getValidToken(integration.userId);
                    if (!token) {
                        console.warn(`[IMAP Reconnect] Could not refresh OAuth token for ${integrationId}. Will retry (backoff: ${Math.round(currentDelay / 1000)}s).`);
                        this.reconnect(integrationId, integration);
                        return;
                    }
                    console.log(`[IMAP Reconnect] OAuth token refreshed for ${integrationId}. Reconnecting...`);
                } catch (tokenErr: any) {
                    console.error(`[IMAP Reconnect] Token refresh failed for ${integrationId}: ${tokenErr.message}. Will retry (backoff: ${Math.round(currentDelay / 1000)}s).`);
                    this.reconnect(integrationId, integration);
                    return;
                }
            }

            this.setupConnection(integrationId, integration);
        }, currentDelay);

        this.reconnectTimers.set(integrationId, timer);
    }

    /**
     * Sync a local action (archive/delete) to the remote IMAP server
     */
    public async syncRemoteAction(userId: string, leadId: string, action: 'archive' | 'unarchive' | 'delete'): Promise<void> {
        try {
            const lead = await storage.getLeadById(leadId);
            if (!lead || !lead.externalId) {
                throw new Error('Lead missing Instagram ID (externalId)');
            }

            // Find the integration for this user and lead
            const integrations = await storage.getIntegrations(userId);
            const emailIntegrations = integrations.filter((i: Integration) => 
                i.connected && (i.provider === 'gmail' || i.provider === 'outlook' || i.provider === 'custom_email')
            );

            // In a better architecture, we'd know which integration a lead belongs to.
            // For now, we try to find messages for this lead to identify the integration.
            const messages = await storage.getMessagesByLeadId(leadId);
            const integrationId = messages.find(m => m.integrationId)?.integrationId;

            if (!integrationId) {
                console.warn(`[IMAP Sync] Could not identify integration for lead ${leadId} to perform ${action}`);
                return;
            }

            const integration = emailIntegrations.find((i: Integration) => i.id === integrationId);
            if (!integration) return;

            const credentialsStr = await decrypt(integration.encryptedMeta!);
            const config = JSON.parse(credentialsStr) as EmailConfig;

            const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
            const imapPort = config.imap_port || 993;

            const imap = new Imap({
                user: config.smtp_user!,
                password: config.smtp_pass!,
                host: imapHost,
                port: imapPort,
                tls: parseInt(String(imapPort)) === 993,
                tlsOptions: { rejectUnauthorized: false }
            });

            return new Promise((resolve, reject) => {
                const cleanup = () => {
                    if (imap.state !== 'disconnected') imap.end();
                };

                imap.once('ready', () => {
                    const folders = this.folders.get(integrationId) || { inbox: ['INBOX'], sent: [] };
                    const primaryInbox = folders.inbox[0] || 'INBOX';

                    imap.openBox(primaryInbox, false, (err) => {
                        if (err) {
                            cleanup();
                            return resolve();
                        }

                        // Search for messages with this lead's email
                        imap.search([['FROM', lead.email]], (err, uids) => {
                            if (err || !uids || uids.length === 0) {
                                cleanup();
                                return resolve();
                            }

                            if (action === 'archive') {
                                // For Gmail, archiving is removing '\Inbox' label (moving to All Mail)
                                // For standard IMAP, it's moving to an 'Archive' folder
                                const archiveFolder = 'Archive'; // Standard name
                                imap.move(uids, archiveFolder, (moveErr) => {
                                    if (moveErr) {
                                        console.warn(`[IMAP Sync] Move to Archive failed for ${lead.email}:`, moveErr.message);
                                    } else {
                                        console.log(`✅ [IMAP Sync] Archived ${uids.length} messages for ${lead.email}`);
                                    }
                                    cleanup();
                                    resolve();
                                });
                            } else if (action === 'unarchive') {
                                // Move back to INBOX
                                const folders = this.folders.get(integrationId) || { inbox: ['INBOX'], sent: [] };
                                const primaryInbox = folders.inbox[0] || 'INBOX';
                                imap.move(uids, primaryInbox, (moveErr) => {
                                    if (moveErr) {
                                        console.warn(`[IMAP Sync] Move to INBOX failed for ${lead.email}:`, moveErr.message);
                                    } else {
                                        console.log(`✅ [IMAP Sync] Unarchived ${uids.length} messages for ${lead.email}`);
                                    }
                                    cleanup();
                                    resolve();
                                });
                            } else if (action === 'delete') {
                                // Add \Deleted flag and expunge
                                imap.addFlags(uids, '\\Deleted', (delErr) => {
                                    if (delErr) {
                                        console.warn(`[IMAP Sync] Delete failed for ${lead.email}:`, delErr.message);
                                    } else {
                                        imap.expunge((expErr) => {
                                            if (!expErr) console.log(`✅ [IMAP Sync] Deleted/Expunged ${uids.length} messages for ${lead.email}`);
                                        });
                                    }
                                    cleanup();
                                    resolve();
                                });
                            }
                        });
                    });
                });

                imap.once('error', (err) => {
                    cleanup();
                    resolve();
                });

                imap.connect();
            });
        } catch (error) {
            console.error(`[IMAP Sync] Remote action ${action} failed:`, error);
        }
    }


    public async appendSentMessage(userId: string, integrationId: string, rawMessage: string, config: EmailConfig): Promise<void> {
        const MAX_RETRIES = 3;
        const BASE_DELAY = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const discovered = this.folders.get(integrationId);
                    const fallbackFolders = ['Sent', 'Sent Items', 'Sent Messages', '[Gmail]/Sent Mail', 'Sent-Mail', 'SENT', 'INBOX.Sent'];
                    const foldersToTry = discovered?.sent && discovered.sent.length > 0
                        ? [...new Set([...discovered.sent, ...fallbackFolders])]
                        : fallbackFolders;

                    const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
                    const imapPort = config.imap_port || 993;

                    if (!imapHost) {
                        console.warn(`[Append] No IMAP host for integration ${integrationId}`);
                        resolve();
                        return;
                    }

                    const imapOptions: any = {
                        user: config.smtp_user!,
                        password: config.smtp_pass!,
                        host: imapHost,
                        port: imapPort,
                        tls: parseInt(String(imapPort)) === 993,
                        // Force IPv4 and use global DNS lock for reliability
                        family: 4,
                        lookup: (hostname: string, options: any, callback: any) => {
                            dns.resolve4(hostname, (err, addresses) => {
                                if (err || !addresses || addresses.length === 0) {
                                    return callback(err || new Error('No IPv4 found'), null, 4);
                                }
                                callback(null, addresses[0], 4);
                            });
                        },
                        tlsOptions: { rejectUnauthorized: false },
                        authTimeout: 10000,
                        connTimeout: 10000
                    };

                    const appendImap = new Imap(imapOptions);

                    const cleanup = () => {
                        try {
                            if (appendImap.state !== 'disconnected') appendImap.end();
                        } catch (e) {
                            console.warn('[IMAP] Error ending append connection:', (e as Error)?.message);
                        }
                    };

                    appendImap.once('ready', async () => {
                        let appended = false;
                        for (const folder of foldersToTry) {
                            try {
                                await new Promise<void>((res, rej) => {
                                    appendImap.append(rawMessage, { mailbox: folder, flags: ['\\Seen'] }, (err: any) => err ? rej(err) : res());
                                });
                                console.log(`✅ Message mirrored to '${folder}' for integration ${integrationId}`);
                                appended = true;
                                break;
                            } catch (e) {
                                console.warn(`[IMAP] Failed to append to folder '${folder}':`, (e as Error)?.message);
                            }
                        }
                        cleanup();
                        resolve();
                    });

                    appendImap.once('error', (err: any) => {
                        cleanup();
                        reject(err);
                    });

                    appendImap.connect();
                });
                return;
            } catch (error: any) {
                if (attempt === MAX_RETRIES) break;
                await new Promise(res => setTimeout(res, BASE_DELAY * attempt));
            }
        }
    }

    /**
     * Fire-and-forget: after sending, scan the Sent folder for the sent email's
     * headers to detect any delivery-related flags from the sending provider.
     * For Gmail: checks X-Gmail-Labels for outbound spam flagging.
     * For Outlook: checks X-Forefront-Antispam-Report headers.
     * This is best-effort — no error thrown, just logged.
     */
    public async checkSentFolderPlacement(
        userId: string,
        integrationId: string,
        trackingToken: string,
        sentAt: Date,
        config: { smtp_user?: string; smtp_host?: string; smtp_port?: number; smtp_pass?: string; imap_host?: string; imap_port?: number }
    ): Promise<void> {
        const TIMEOUT_MS = 8000;
        const startTime = Date.now();
        let placementDetected: string | null = null;
        let source: string | null = null;

        try {
            const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
            const imapPort = config.imap_port || 993;

            if (!imapHost || !config.smtp_user || !config.smtp_pass) {
                return; // No IMAP available
            }

            // Build search window: sentAt +/- 30 seconds
            const since = new Date(sentAt.getTime() - 30000);
            const before = new Date(sentAt.getTime() + 30000);

            const imapOptions: any = {
                user: config.smtp_user,
                password: config.smtp_pass,
                host: imapHost,
                port: imapPort,
                tls: parseInt(String(imapPort)) === 993,
                family: 4,
                lookup: (hostname: string, options: any, callback: any) => {
                    const dns = require('dns');
                    dns.resolve4(hostname, (err: any, addresses: string[]) => {
                        if (err || !addresses || addresses.length === 0) {
                            return callback(err || new Error('No IPv4 found'), null, 4);
                        }
                        callback(null, addresses[0], 4);
                    });
                },
                tlsOptions: { rejectUnauthorized: false },
                authTimeout: 5000,
                connTimeout: 5000
            };

            const imap = new Imap(imapOptions);

            const sentFolder = this.folders.get(integrationId)?.sent?.[0] || 'Sent';

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    try { if (imap.state !== 'disconnected') imap.end(); } catch { }
                    resolve();
                }, TIMEOUT_MS);

                imap.once('ready', () => {
                    imap.openBox(sentFolder, true, (err: any, box: any) => {
                        if (err || !box || box.messages?.total === 0) {
                            clearTimeout(timeout);
                            try { imap.end(); } catch { }
                            resolve();
                            return;
                        }

                        // Search by X-Audnix-Id header using HEADER search
                        const searchCriteria = ['HEADER', 'X-Audnix-Id', trackingToken];
                        if (!trackingToken) {
                            clearTimeout(timeout);
                            try { imap.end(); } catch { }
                            resolve();
                            return;
                        }

                        imap.search(searchCriteria, (searchErr: any, results: number[]) => {
                            if (searchErr || !results || results.length === 0) {
                                clearTimeout(timeout);
                                try { imap.end(); } catch { }
                                resolve();
                                return;
                            }

                            // Fetch headers of the matching message
                            const fetch = imap.seq.fetch(results.slice(0, 1).join(','), {
                                bodies: 'HEADER.FIELDS (X-GMAIL-LABELS X-FOREFRONT-ANTISPAM-REPORT X-MICROSOFT-ANTISPAM X-SPAM-FLAG X-SPAM-STATUS)',
                                struct: true
                            });

                            fetch.on('message', (msg: any) => {
                                msg.on('body', (stream: any) => {
                                    let headerData = '';
                                    stream.on('data', (chunk: string) => { headerData += chunk; });
                                    stream.on('end', () => {
                                        const headers = headerData.toLowerCase();
                                        // Gmail: check if email was flagged by outbound filter
                                        if (headers.includes('x-gmail-labels')) {
                                            if (headers.includes('spam') || headers.includes('junk') || headers.includes('trash')) {
                                                placementDetected = 'spam';
                                                source = 'sent_folder_gmail_labels';
                                            }
                                        }
                                        // Outlook: check spam headers
                                        if (headers.includes('x-forefront-antispam-report') || headers.includes('x-microsoft-antispam')) {
                                            if (headers.includes('spam') || headers.includes('bulk') || headers.includes('phish')) {
                                                placementDetected = 'spam';
                                                source = 'sent_folder_outlook_header';
                                            }
                                        }
                                        // Generic spam flag headers
                                        if (headers.includes('x-spam-flag: yes') || headers.includes('x-spam-status: yes')) {
                                            placementDetected = 'spam';
                                            source = 'sent_folder_spam_flag';
                                        }
                                    });
                                });
                            });

                            fetch.once('end', () => {
                                clearTimeout(timeout);
                                try { imap.end(); } catch { }
                                resolve();
                            });

                            fetch.once('error', () => {
                                clearTimeout(timeout);
                                try { imap.end(); } catch { }
                                resolve();
                            });
                        });
                    });
                });

                imap.once('error', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                imap.connect();
            });

            // If detected spam, update email_tracking and fire deliverability event
            if (placementDetected) {
                console.log(`[Placement] Sent folder scan for ${trackingToken}: detected ${placementDetected} via ${source}`);
                const { db } = await import('@shared/lib/db/db.js');
                const { sql } = await import('drizzle-orm');
                await db.execute(sql`
                    UPDATE email_tracking
                    SET placement = ${placementDetected},
                        placement_updated_at = NOW()
                    WHERE token = ${trackingToken}
                      AND (placement IS NULL OR placement IN ('unknown', 'delivered'))
                `);
                const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
                await Promise.all([
                    clusterSync.notifyDeliverabilityUpdated(userId, {
                        integrationId,
                        placement: placementDetected,
                        source
                    }),
                    clusterSync.notifyStatsUpdated(userId, { integrationId, type: 'placement_update' }),
                    clusterSync.notifyStatsCacheInvalidate(userId)
                ]);
            }
        } catch (err) {
            console.warn(`[Placement] checkSentFolderPlacement error for ${trackingToken}:`, (err as Error)?.message);
        }
    }

    public async syncHistoricalEmails(userId: string, integrationId: string, limit: number = 5000): Promise<{ success: boolean; count: number; error?: string }> {
        let tempImap: Imap | null = null;
        let folderMap = this.connections.get(integrationId);
        let imap = folderMap?.values().next().value;
        let folders = this.folders.get(integrationId);

        // If no active IMAP connection, create a temporary one for historical sync
        if (!imap || imap.state !== 'authenticated' || !folders) {
            try {
                const integration = await storage.getIntegration(userId, integrationId);
                if (!integration || !integration.connected || !integration.encryptedMeta) {
                    return { success: false, count: 0, error: 'Integration not available' };
                }
                const credentialsStr = await decrypt(integration.encryptedMeta);
                const config = JSON.parse(credentialsStr) as EmailConfig;
                const imapHost = config.imap_host || '';
                const imapPort = config.imap_port || 993;
                if (!imapHost) return { success: false, count: 0, error: 'IMAP host not configured' };

                tempImap = new Imap({
                    user: config.smtp_user!,
                    password: config.smtp_pass!,
                    host: imapHost,
                    port: imapPort,
                    tls: parseInt(String(imapPort)) === 993,
                    tlsOptions: { rejectUnauthorized: false },
                    authTimeout: 10000,
                    connTimeout: 15000
                });

                await new Promise<void>((res, rej) => {
                    tempImap!.once('ready', () => res());
                    tempImap!.once('error', (e: any) => rej(e));
                    tempImap!.connect();
                });

                // Discover folders
                const boxes = await new Promise<any>((res, rej) => {
                    tempImap!.getBoxes((err: any, b: any) => err ? rej(err) : res(b));
                });

                const discoveredInbox: string[] = [];
                const discoveredSent: string[] = [];
                const processBoxes = (obj: any, prefix = '') => {
                    for (const key in obj) {
                        const box = obj[key];
                        const fullName = prefix + key;
                        const attribs = box.attribs || [];
                        const isInbox = attribs.some((a: string) => a.toLowerCase() === '\\inbox');
                        const isSent = attribs.some((a: string) => a.toLowerCase() === '\\sent');
                        if (isInbox) discoveredInbox.push(fullName);
                        else if (isSent) discoveredSent.push(fullName);
                        else {
                            const lk = key.toLowerCase();
                            if (lk === 'inbox') discoveredInbox.push(fullName);
                            else if (['sent','sent items','sent messages'].includes(lk)) discoveredSent.push(fullName);
                        }
                        if (box.children) processBoxes(box.children, fullName + (box.delimiter || '/'));
                    }
                };
                processBoxes(boxes);

                folders = { inbox: discoveredInbox, sent: discoveredSent, spam: [] };
                imap = tempImap;
            } catch (error: any) {
                const errMsg = error.message || 'Temp connection failed';
                if (tempImap) try { tempImap.end(); } catch {}
                return { success: false, count: 0, error: errMsg };
            }
        }

        if (!imap || imap.state !== 'authenticated') {
            if (tempImap) try { tempImap.end(); } catch {}
            return { success: false, count: 0, error: 'IMAP not active' };
        }
        if (!folders) {
            if (tempImap) try { tempImap.end(); } catch {}
            return { success: false, count: 0, error: 'Folders not discovered' };
        }

        let totalImported = 0;
        wsSync.notifySyncStatus(userId, { syncing: true, integrationId });

        try {
            const syncFolder = async (folderName: string, direction: 'inbound' | 'outbound'): Promise<number> => {
                const result = await this.executeImapCommand<number>(imap!, (cb) => {
                    imap!.openBox(folderName, true, (err, box) => {
                        if (err || !box || box.messages.total === 0) return cb(null, 0);

                        const total = box.messages.total;
                        const fetchRange = `${Math.max(1, total - Math.min(total, limit) + 1)}:*`;
                        const fetch = imap.seq.fetch(fetchRange, { bodies: '', struct: true });
                        const emails: any[] = [];
                        
                        fetch.on('message', (msg: any) => {
                            let flags: string[] = [];
                            msg.on('attributes', (attrs: any) => flags = attrs.flags || []);
                            msg.on('body', (stream: any) => {
                                simpleParser(stream, async (err2: any, parsed: any) => {
                                    if (!err2 && parsed) {
                                        emails.push({
                                            from: parsed.from?.text,
                                            to: parsed.to?.text,
                                            subject: parsed.subject,
                                            text: parsed.text || parsed.html || '',
                                            date: parsed.date,
                                            html: parsed.html,
                                            flags,
                                            messageId: parsed.messageId,
                                            inReplyTo: parsed.inReplyTo,
                                            headers: parsed.headers
                                        });
                                    }
                                });
                            });
                        });
                        
                        fetch.once('error', (err: any) => cb(err, 0));
                        fetch.once('end', async () => {
                            try {
                                if (emails.length > 0) {
                                    const nonWarmupEmails = emails.filter(e => !e.headers?.get('x-audnix-warmup'));
                                    if (nonWarmupEmails.length < emails.length) {
                                        console.log(`[IMAP] Filtered out ${emails.length - nonWarmupEmails.length} warmup email(s)`);
                                    }
                                    const res = await pagedEmailImport(userId, nonWarmupEmails.map(e => ({
                                        from: e.from?.split('<')[1]?.split('>')[0] || e.from,
                                        to: e.to?.split('<')[1]?.split('>')[0] || e.to,
                                        subject: e.subject,
                                        text: e.text,
                                        date: e.date,
                                        html: e.html,
                                        isRead: e.flags?.includes('\\Seen') || false,
                                        messageId: e.messageId,
                                        inReplyTo: e.inReplyTo,
                                        integrationId
                                    })), undefined, direction);
                                    cb(null, res.imported);
                                } else {
                                    cb(null, 0);
                                }
                            } catch (error) {
                                console.error(`[IMAP] Historical sync error for folder ${folderName}:`, error);
                                cb(null, 0); // Still return 0 so the chain doesn't break
                            } finally {
                                // Guaranteed safety for the IMAP connection pool
                            }
                        });
                    });
                });
                return result || 0;
            };

            for (const inbox of (folders?.inbox || [])) totalImported += await syncFolder(inbox, 'inbound');
            for (const sent of (folders?.sent || [])) totalImported += await syncFolder(sent, 'outbound');

            return { success: true, count: totalImported };
        } catch (error: any) {
            return { success: false, count: totalImported, error: error.message };
        } finally {
            wsSync.notifySyncStatus(userId, { syncing: false, integrationId });
            if (tempImap) {
                try { tempImap.end(); } catch {}
                console.log(`[IMAP] Closed temporary historical sync connection for ${integrationId}`);
            }
        }
    }

    /**
     * Phase 11: Zombie Watchdog Logic
     * Periodically checks all active connections to ensure they've seen activity.
     * If a connection is 'silent' for > 2 hours, we assume it's a zombie and recycle it.
     */
    private startWatchdog(): void {
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
        
        this.watchdogInterval = setInterval(async () => {
            // Phase 11: Zombie detection
            const now = new Date().getTime();
            const redis = await getRedisClient();
            for (const [key, lastSeen] of this.lastActivity.entries()) {
                const [integrationId, folderName] = key.split(':');
                // Skip custom_email — Rust IMAP worker handles all of them
                if (!this.connections.has(integrationId)) continue;
                const idleTime = now - lastSeen.getTime();
                if (idleTime > this.ZOMBIE_TIMEOUT_MS) {
                    // Check if this integration is now managed by the autonomous worker cluster
                    if (redis) {
                        const activeKey = IMAP_KEYS.active(integrationId);
                        const isWorkerManaged = await redis.exists(activeKey);
                        if (isWorkerManaged) {
                            console.log(`[WATCHDOG] 🤖 ${integrationId}:${folderName} is managed by worker cluster. Cleaning up local state.`);
                            this.cleanupIntegration(integrationId);
                            continue;
                        }
                    }
                    console.warn(`🚨 [WATCHDOG] Zombie detected on ${integrationId}:${folderName} (${Math.round(idleTime/1000/60)}m idle). Recycling...`);
                    this.forceRecycleConnection(integrationId, folderName);
                }
            }

            // Phase 21: Active Resurrection
            // Proactively scan for any mailbox that SHOULD be connected but has dropped.
            try {
                // custom_email is handled entirely by the Rust IMAP worker — never touch it here
                const providers = ['gmail', 'outlook'];
                for (const provider of providers) {
                    const integrations = await storage.getIntegrationsByProvider(provider);
                    for (const integration of integrations) {
                        if (!integration.connected) continue;
                        if (this.connections.has(integration.id)) continue;

                        // Skip if failure cooldown is active (recent failures should back off)
                        const cooldownUntil = this.failureCooldowns.get(integration.id);
                        if (cooldownUntil && Date.now() < cooldownUntil) continue;

                        // Skip if worker cluster is already managing this integration
                        if (redis) {
                            const activeKey = IMAP_KEYS.active(integration.id);
                            const isWorkerManaged = await redis.exists(activeKey);
                            if (isWorkerManaged) continue;
                        }

                        console.log(`🔦 [WATCHDOG] Active resurrection for ${integration.provider} integration ${integration.id} (User: ${integration.userId})`);
                        this.setupConnection(integration.id, integration);
                    }
                }
            } catch (resErr) {
                console.error('[WATCHDOG] Resurrection scan failed:', resErr);
            }
        }, 15 * 1000 + Math.floor(Math.random() * 5000)); // 15s frequency + jitter — zombie detection near-instant
    }

    private forceRecycleConnection(integrationId: string, folderName: string): void {
        const folderMap = this.connections.get(integrationId);
        if (!folderMap) return;

        const imap = folderMap.get(folderName);
        if (imap) {
            try {
                // Destroying the connection will trigger the 'error' or 'close' listener, which triggers reconnect()
                imap.destroy();
                this.lastActivity.delete(`${integrationId}:${folderName}`);
            } catch (e) {
                console.error(`[WATCHDOG] Failed to destroy zombie connection ${integrationId}:`, e);
            }
        }
    }

    /**
     * Get available folders for an integration
     */
    async getAvailableFolders(integrationId: string): Promise<string[]> {
        return new Promise(async (resolve, reject) => {
            const integration = await storage.getIntegrationById(integrationId);
            if (!integration) return reject(new Error('Integration not found'));

            const config = JSON.parse(decrypt(integration.encryptedMeta));
            const imap = new Imap({
                user: config.smtp_user || config.user,
                password: config.smtp_pass || config.password,
                host: config.imap_host,
                port: config.imap_port,
                tls: true,
                tlsOptions: { rejectUnauthorized: false },
                connTimeout: 10000, // 10s TCP timeout
                authTimeout: 10000 // 10s Auth timeout
            });

            // Safety Guard: Force end after 30s total
            const safetyTimer = setTimeout(() => {
                console.warn(`[IMAP] getAvailableFolders timed out for ${integrationId}. Force closing.`);
                imap.end();
                reject(new Error('IMAP operation timed out (30s)'));
            }, 30000);

            imap.once('ready', () => {
                imap.getBoxes((err, boxes) => {
                    clearTimeout(safetyTimer);
                    if (err) {
                        imap.end();
                        return reject(err);
                    }
                    const folderList: string[] = [];
                    const parseBoxes = (obj: any, prefix = '') => {
                        for (const key in obj) {
                            const name = prefix + key;
                            folderList.push(name);
                            if (obj[key].children) parseBoxes(obj[key].children, name + obj[key].delimiter);
                        }
                    };
                    parseBoxes(boxes);
                    imap.end();
                    resolve(folderList);
                });
            });

            imap.once('error', (err) => {
                clearTimeout(safetyTimer);
                imap.end();
                reject(err);
            });

            imap.connect();
        });
    }

    /**
     * Get recent messages from a specific folder
     */
    async getRecentMessages(integrationId: string, folderName: string, hours = 24): Promise<any[]> {
        return new Promise(async (resolve, reject) => {
            const integration = await storage.getIntegrationById(integrationId);
            if (!integration) return reject(new Error('Integration not found'));

            const config = JSON.parse(decrypt(integration.encryptedMeta));
            const imap = new Imap({
                user: config.smtp_user || config.user,
                password: config.smtp_pass || config.password,
                host: config.imap_host,
                port: config.imap_port,
                tls: true,
                tlsOptions: { rejectUnauthorized: false },
                connTimeout: 15000,
                authTimeout: 15000
            });

            // Safety Guard: Force end after 45s total
            const safetyTimer = setTimeout(() => {
                console.warn(`[IMAP] getRecentMessages timed out for ${integrationId} (${folderName}). Force closing.`);
                imap.end();
                reject(new Error('IMAP message retrieval timed out (45s)'));
            }, 45000);

            imap.once('ready', () => {
                imap.openBox(folderName, true, (err, box) => {
                    if (err) {
                        clearTimeout(safetyTimer);
                        imap.end();
                        return reject(err);
                    }

                    if (box.messages.total === 0) {
                        clearTimeout(safetyTimer);
                        imap.end();
                        return resolve([]);
                    }

                    const sinceDate = new Date();
                    sinceDate.setHours(sinceDate.getHours() - hours);
                    
                    imap.search([['SINCE', sinceDate]], (err2, results) => {
                        if (err2 || !results || results.length === 0) {
                            clearTimeout(safetyTimer);
                            imap.end();
                            return resolve([]);
                        }

                        const fetch = imap.fetch(results, { bodies: '', struct: true });
                        const messages: any[] = [];

                        fetch.on('message', (msg) => {
                            msg.on('body', (stream) => {
                                simpleParser(stream as any, (err3, parsed) => {
                                    if (!err3 && parsed) {
                                        messages.push({
                                            subject: parsed.subject,
                                            body: parsed.text || parsed.html || '',
                                            headers: parsed.headers,
                                            date: parsed.date
                                        });
                                    }
                                });
                            });
                        });

                        fetch.once('error', (err4) => {
                            clearTimeout(safetyTimer);
                            imap.end();
                            reject(err4);
                        });

                        fetch.once('end', () => {
                            clearTimeout(safetyTimer);
                            imap.end();
                            // Give simpleParser a tiny bit of time to finish the last few streams
                            setTimeout(() => resolve(messages), 500);
                        });
                    });
                });
            });

            imap.once('error', (err) => {
                clearTimeout(safetyTimer);
                imap.end();
                reject(err);
            });

            imap.connect();
        });
    }

    /**
     * Fetch envelope + snippet for the newest `count` messages in INBOX for a given integrationId.
     * Called by email-sync-queue's `process-new-mail` handler.
     * Uses a transient IMAP connection to avoid conflicting with the persistent IDLE session.
     */
    async fetchNewMessages(
        userId: string,
        integrationId: string,
        count: number = 1
    ): Promise<Array<{
        uid: number;
        messageId: string;
        subject: string;
        from: string;
        to: string;
        date: string;
        snippet: string;
    }>> {
        try {
            const integration = await storage.getIntegrationById(integrationId);
            if (!integration || !integration.connected) return [];

            const isOAuth = integration.provider === 'gmail' || integration.provider === 'outlook';
            let config: EmailConfig = {};

            if (!isOAuth) {
                if (!integration.encryptedMeta) return [];
                try { config = JSON.parse(await decrypt(integration.encryptedMeta)) as EmailConfig; }
                catch { console.warn('[IMAP] Failed to decrypt config for', integrationId); return []; }
            }

            let imapHost = config.imap_host || (config.smtp_host || '').replace('smtp', 'imap');
            const imapPort = config.imap_port || 993;

            if (!imapHost) {
                if (integration.provider === 'gmail') imapHost = 'imap.gmail.com';
                else if (integration.provider === 'outlook') imapHost = 'outlook.office365.com';
            }
            if (!imapHost) return [];

            const imapOptions: any = {
                user: config.smtp_user || integration.accountType || '',
                host: imapHost,
                port: imapPort,
                tls: imapPort === 993,
                family: 4,
                tlsOptions: { rejectUnauthorized: false },
                connTimeout: 20000,
                authTimeout: 20000,
                keepalive: false,
            };

            if (isOAuth) {
                const token = integration.provider === 'gmail'
                    ? await gmailOAuth.getValidToken(userId, integration.accountType || undefined)
                    : await outlookOAuth.getValidToken(userId);
                if (!token) return [];
                imapOptions.xoauth2 = Buffer.from(
                    `user=${imapOptions.user}\x01auth=Bearer ${token}\x01\x01`
                ).toString('base64');
            } else {
                imapOptions.password = config.smtp_pass!;
            }

            const { simpleParser } = await import('mailparser');

            return await new Promise((resolve) => {
                const imap = new Imap(imapOptions);
                const messages: any[] = [];
                let pendingMessages = 0;
                const safeEnd = () => { try { if (imap.state !== 'disconnected') imap.end(); } catch { console.warn('[IMAP] Error in fetchNewMessages safeEnd for', integrationId); } };

                const tryResolve = () => {
                    if (pendingMessages <= 0) { safeEnd(); }
                };

                imap.once('ready', () => {
                    imap.openBox('INBOX', true, (err: any, box: any) => {
                        if (err || !box || box.messages.total === 0) { safeEnd(); resolve(messages); return; }

                        const total = box.messages.total;
                        const fetchCount = Math.min(count, total);
                        const fetchRange = `${total - fetchCount + 1}:${total}`;

                        const f = imap.seq.fetch(fetchRange, { bodies: ['HEADER', 'TEXT'], struct: true });

                        f.on('message', (msg: any) => {
                            pendingMessages++;
                            const item: any = {};
                            let bodyResolved = false;

                            const pushItem = () => {
                                if (bodyResolved) {
                                    messages.push(item);
                                    pendingMessages--;
                                    tryResolve();
                                } else {
                                    // Wait for body to resolve then push
                                    const check = setInterval(() => {
                                        if (bodyResolved) {
                                            clearInterval(check);
                                            messages.push(item);
                                            pendingMessages--;
                                            tryResolve();
                                        }
                                    }, 5);
                                }
                            };

                            let rawParts: string[] = [];

                            msg.on('body', (stream: any) => {
                                let raw = '';
                                stream.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
                                stream.once('end', () => { rawParts.push(raw); });
                            });

                            msg.once('attributes', (attrs: any) => {
                                item.uid       = attrs.uid;
                                item.messageId = attrs.envelope?.messageId || `imap-${integrationId}-${attrs.uid}`;
                            });

                            msg.once('end', () => {
                                const combined = rawParts.join('\n');
                                simpleParser(combined).then(parsed => {
                                    item.messageId = parsed.messageId || item.messageId;
                                    item.subject = parsed.subject || '(no subject)';
                                    item.from = Array.isArray(parsed.from) ? parsed.from[0]?.text : parsed.from?.text || '';
                                    item.to = Array.isArray(parsed.to) ? parsed.to[0]?.text : parsed.to?.text || '';
                                    item.date = parsed.date?.toISOString() || new Date().toISOString();
                                    const bodyText = parsed.text || (typeof parsed.html === 'string' ? parsed.html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() : '') || '';
                                    item.snippet = (bodyText || item.subject).replace(/\s+/g, ' ').trim().slice(0, 200);
                                }).catch(() => {
                                    console.warn('[IMAP] Failed to parse email body during fetchNewMessages');
                                }).finally(() => {
                                    bodyResolved = true;
                                });
                                pushItem();
                            });
                        });

                        f.once('error', () => { safeEnd(); resolve(messages); });
                        f.once('end', () => {
                            if (pendingMessages <= 0) safeEnd();
                        });
                    });
                });

                imap.once('error', () => resolve(messages));
                imap.once('end',   () => resolve(messages));
                imap.connect();
            });
        } catch (err: any) {
            console.error(`[ImapIdleManager] fetchNewMessages failed for ${integrationId}:`, err.message);
            return [];
        }
    }
}


// ── Graceful Shutdown ──────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
    console.log('[ImapIdleManager] SIGTERM received. Cleaning up connections...');
    try {
        await imapIdleManager.releaseAllMailboxClaims();
    } catch (_e) {
        console.warn('[ImapIdleManager] Failed to release mailbox claims during shutdown:', (_e as Error)?.message);
    }
    try {
        await imapIdleManager.stop();
    } catch (err: any) {
        console.error('[ImapIdleManager] Shutdown error:', err.message);
    }
});

export const imapIdleManager = new ImapIdleManager();








