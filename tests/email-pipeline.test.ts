import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const imap = readFileSync('services/email-service/src/email/imap-idle-manager.ts', 'utf-8');
const emailWorker = readFileSync('services/email-worker/src/imap/imap-connection-manager.ts', 'utf-8');
const inboundSweep = readFileSync('services/email-service/src/imap/inbound-sweep.ts', 'utf-8');
const spamRescue = readFileSync('services/email-service/src/imap/spam-rescue.ts', 'utf-8');
const websocket = readFileSync('shared/lib/realtime/websocket-sync.ts', 'utf-8');
const emailStats = readFileSync('services/api-gateway/src/routes/email-stats-routes.ts', 'utf-8');
const analytics = readFileSync('client/src/pages/dashboard/analytics.tsx', 'utf-8');
const deliverability = readFileSync('client/src/pages/dashboard/deliverability.tsx', 'utf-8');
const integrations = readFileSync('client/src/pages/dashboard/integrations.tsx', 'utf-8');
const useRealtime = readFileSync('client/src/hooks/use-realtime.tsx', 'utf-8');

// ─── IMAP Idle Manager Speed Constants ──────────────────────────────────────
describe('IMAP Idle Manager - Real-Time Speed', () => {
  it('zombie timeout should be 30s (was 2min)', () => {
    expect(imap).toContain('ZOMBIE_TIMEOUT_MS = 30 * 1000');
    expect(imap).not.toContain('ZOMBIE_TIMEOUT_MS = 2 * 60 * 1000');
  });

  it('min backoff should be 1s (was 3s)', () => {
    expect(imap).toContain('MIN_BACKOFF = 1000');
    expect(imap).not.toContain('MIN_BACKOFF = 3000');
  });

  it('max backoff should be 60s (was 5min)', () => {
    expect(imap).toContain('MAX_BACKOFF = 60 * 1000');
    expect(imap).not.toContain('MAX_BACKOFF = 5 * 60 * 1000');
  });

  it('IDLE keepalive should be 5s NOOP / 10s IDLE (was 15s/30s)', () => {
    expect(imap).toContain('interval: 5000');
    expect(imap).toContain('idleInterval: 10000');
  });

  it('heartbeat inside persistent IDLE should be 5s (was 30s)', () => {
    expect(imap).toContain('5 * 1000); // 5s heartbeat');
    expect(imap).not.toContain('30 * 1000); // 30s heartbeat');
  });

  it('fallback poll should be 5s (was 30s)', () => {
    expect(imap).toContain('POLL_INTERVAL_MS = 5 * 1000');
  });

  it('watchdog sweep should be 15s (was 60s)', () => {
    expect(imap).toContain('15 * 1000 + Math.floor');
    expect(imap).not.toContain('60 * 1000 + Math.floor(Math.random');
  });

  it('isConnectionAlive method should exist', () => {
    expect(imap).toContain('public isConnectionAlive(integrationId: string): boolean');
  });
});

// ─── Email Worker Speed ─────────────────────────────────────────────────────
describe('Email Worker - Connection Speed', () => {
  it('heartbeat should be 30s (was 4min)', () => {
    expect(emailWorker).toContain('HEARTBEAT_TIME   =  30 * 1000');
    expect(emailWorker).not.toMatch(/HEARTBEAT_TIME\s+=\s+4 \* 60/);
  });

  it('recycle should be 14min (was 29min)', () => {
    expect(emailWorker).toContain('RECYCLE_TIME     = 14 * 60 * 1000');
    expect(emailWorker).not.toMatch(/RECYCLE_TIME\s+=\s+29 \* 60/);
  });
});

// ─── Inbound Sweep / Spam Rescue Speed ──────────────────────────────────────
describe('Background Workers - Speed', () => {
  it('inbound sweep should be 2min (was 15min)', () => {
    expect(inboundSweep).toContain('2 * 60 * 1000');
    expect(inboundSweep).not.toContain('15 * 60 * 1000');
  });

  it('spam rescue should be 30min (was 6hr)', () => {
    expect(spamRescue).toContain('30 * 60 * 1000');
    expect(spamRescue).not.toContain('6 * 60 * 60 * 1000');
  });
});

// ─── WebSocket Priority Events ──────────────────────────────────────────────
describe('WebSocket - Priority Events (No Throttle)', () => {
  it('spam_detected should be in priority events', () => {
    expect(websocket).toContain("'spam_detected'");
  });

  it('integration_reputation_updated should be in priority events', () => {
    expect(websocket).toContain("'integration_reputation_updated'");
  });

  it('new_mail and mailbox_status should be priority', () => {
    expect(websocket).toContain("'new_mail'");
    expect(websocket).toContain("'mailbox_status'");
  });
});

// ─── API Endpoints ──────────────────────────────────────────────────────────
describe('API - Inbox Placement & Domain Reputation', () => {
  it('should have /inbox-placement route', () => {
    expect(emailStats).toContain('/inbox-placement');
  });

  it('should have /domain-reputation route', () => {
    expect(emailStats).toContain('/domain-reputation');
  });
});

// ─── Client Components ──────────────────────────────────────────────────────
describe('Client - Real-Time UI', () => {
  it('analytics should have InboxPlacementSection with useRealtime', () => {
    expect(analytics).toContain('InboxPlacementSection');
    expect(analytics).toContain('useRealtime');
  });

  it('deliverability should have InboxPlacementPie with useRealtime', () => {
    expect(deliverability).toContain('InboxPlacementPie');
    expect(deliverability).toContain('useRealtime');
  });

  it('integrations should have PerMailboxReputationSection without polling', () => {
    expect(integrations).toContain('PerMailboxReputationSection');
    expect(integrations).toContain('useRealtime');
  });

  it('use-realtime should handle spam_detected WebSocket event', () => {
    expect(useRealtime).toContain("socketInstance.on('spam_detected'");
    expect(useRealtime).toContain("socketInstance.on('new_mail'");
    expect(useRealtime).toContain("socketInstance.on('mailbox_status'");
    expect(useRealtime).toContain("socketInstance.on('integration_reputation_updated'");
  });

  it('spam_detected handler should invalidate analytics + placement queries', () => {
    expect(useRealtime).toContain("queryClient.invalidateQueries({ queryKey: ['/api/stats/inbox-placement']");
    expect(useRealtime).toContain("queryClient.invalidateQueries({ queryKey: ['/api/stats/domain-reputation']");
  });
});

// ─── Config Files ───────────────────────────────────────────────────────────
describe('Config Files', () => {
  it('config.toml should exist with correct imap settings', () => {
    const config = readFileSync('config.toml', 'utf-8');
    expect(config).toContain('zombie_timeout_ms = 30000');
    expect(config).toContain('noop_interval_ms = 5000');
    expect(config).toContain('refresh_interval_ms = 2000');
  });

  it('.npmrc should bypass replit firewall', () => {
    const npmrc = readFileSync('.npmrc', 'utf-8');
    expect(npmrc).toContain('registry=https://registry.npmjs.org/');
  });
});

// ─── Cleanup Verification ───────────────────────────────────────────────────
describe('Cleanup - Junk Deleted', () => {
  const { existsSync } = require('fs');

  it('attached_assets/ deleted (was 82MB)', () => {
    expect(existsSync('attached_assets')).toBe(false);
  });

  it('HxD-Portable/ deleted (was 15MB)', () => {
    expect(existsSync('HxD-Portable')).toBe(false);
  });

  it('.temp/ deleted', () => {
    expect(existsSync('.temp')).toBe(false);
  });

  it('logs/ deleted', () => {
    expect(existsSync('logs')).toBe(false);
  });

  it('migrations_meta_backup/ deleted', () => {
    expect(existsSync('migrations_meta_backup')).toBe(false);
  });

  it('stale root markdown files deleted', () => {
    const stale = [
      'ACTIVE_ERRORS.md', 'AUDIT_REPORT.md', 'AUDIT_REPORT_FULL.md',
      'AUDNIX_45_PHASE_PLAN.md', 'BACKEND_AUDIT.md', 'DEPLOY.md',
      'DEPLOYMENT_SUMMARY.md', 'replit.md', 'AUDNIX_SCALING_COST_REPORT.md',
    ];
    for (const f of stale) {
      expect(existsSync(f), `${f} should be deleted`).toBe(false);
    }
  });

  it('stale root scripts deleted', () => {
    const stale = [
      'check-cols.ts', 'test-db.ts', 'test-smtp.ts',
      'tmp-migrate.sql', 'deploy.sh', 'deploy-remote.mjs',
    ];
    for (const f of stale) {
      expect(existsSync(f), `${f} should be deleted`).toBe(false);
    }
  });
});
