import { storage } from '@shared/lib/storage/storage.js';
import { verifyDomainDns } from "@services/email-service/src/email/dns-verification.js";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { tryDecryptToJSON } from "@shared/lib/crypto/encryption.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";

export class ReputationWorker {
    private interval: NodeJS.Timeout | null = null;
    private isProcessing = false;

    start(intervalMs = 120000) { // Set to 2 minutes as requested
        if (this.interval) return;

        console.log('🚀 Autonomous Reputation Worker Started (2m interval)');

        // Initial run after 5 seconds
        setTimeout(() => this.process(), 5000);

        this.interval = setInterval(() => {
            this.process();
        }, intervalMs);
    }

    async process() {
        if (this.isProcessing) return;
        if (quotaService.isRestricted()) {
            console.log('[ReputationWorker] Skipping check: Database quota restricted');
            return;
        }
        this.isProcessing = true;

        try {
            console.log('🔍 Running autonomous reputation checks (Every 2m)...');
            const { db } = await import('@shared/lib/db/db.js');
            const { integrations, users } = await import('@audnix/shared');
            const { eq, and, inArray } = await import('drizzle-orm');
            const { mailboxHealthService } = await import("@services/email-service/src/email/mailbox-health-service.js");

            const emailIntegrations = await db.select({
                integration: integrations,
                user: users
            }).from(integrations)
            .innerJoin(users, eq(users.id, integrations.userId))
            .where(
                and(
                    eq(integrations.connected, true),
                    inArray(integrations.provider, ['gmail', 'outlook', 'custom_email'])
                )
            );

            for (const { integration, user } of emailIntegrations) {
                try {
                    const meta = tryDecryptToJSON(integration.encryptedMeta) || ({} as any);
                    const email = meta.email || meta.user || (integration as any).email;
                    if (!email) continue;

                    const domain = email.split('@')[1];
                    if (!domain) continue;

                    // Extract DKIM selector if available in metadata
                    const dkimSelector = meta.dkim_selector || meta.dkimSelector || undefined;

                    console.log(`📡 Autonomous DNS Check for ${domain} (${user.email}) selector: ${dkimSelector || 'default'}`);
                    const result = await verifyDomainDns(domain, dkimSelector, true);

                    // Persist for Reputation Monitor to pick up
                    await storage.createDomainVerification(user.id, { 
                        domain, 
                        verificationResult: result 
                    });

                    await storage.createAuditLog({
                        userId: user.id,
                        leadId: undefined,
                        integrationId: integration.id,
                        action: 'domain_reputation_check',
                        details: { domain, result, selector: dkimSelector, autonomous: true },
                        createdAt: new Date()
                    });

                    const { calculateReputationScore } = await import("@services/email-service/src/email/reputation-monitor.js");
                    await calculateReputationScore(integration.id);

                    wsSync.notifyStatsUpdated(user.id);
                } catch (innerError: any) {
                    console.error(`[ReputationWorker] Failed for integration ${integration.id}:`, innerError.message);
                    if (mailboxHealthService.isMailboxError(innerError.message)) {
                        await mailboxHealthService.handleMailboxFailure(integration, `Reputation check failed: ${innerError.message}`);
                    }
                }
            }

            // Phase 22: Autonomous Spam Folder Discovery
            try {
                const { spamMonitorService } = await import("@services/email-service/src/email/spam-monitor.js");
                await spamMonitorService.scanAllSpamFolders();
            } catch (spamErr) {
                console.error('[ReputationWorker] Spam monitor sweep failed:', spamErr);
            }
        } catch (error: any) {
            console.error('[ReputationWorker] Fatal loop error:', error);
            quotaService.reportDbError(error);
        } finally {
            this.isProcessing = false;
        }
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

export const reputationWorker = new ReputationWorker();







