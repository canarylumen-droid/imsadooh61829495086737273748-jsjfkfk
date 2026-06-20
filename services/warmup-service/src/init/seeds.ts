import { seedFleetManager } from '../engine/seed-fleet-manager.js';

export async function provisionSeedsOnStartup(): Promise<void> {
  console.log('[Warmup][Init] Checking for seed provisioning...');

  const provisioned = await seedFleetManager.provisionFromEnv();

  if (process.env.WARMUP_SEEDS) {
    console.log(`[Warmup][Init] WARMUP_SEEDS env found — ${provisioned} new seed(s) provisioned`);
  }

  const metrics = await seedFleetManager.getSeedMetrics();
  console.log(`[Warmup][Init] Seed fleet status: ${metrics.active} active, ${metrics.total} total, ${metrics.googleSeeds} Google, ${metrics.msSeeds} Microsoft seeds`);

  if (metrics.active === 0) {
    console.warn('[Warmup][Init] ⚠️  No active seeds available. Platform seed warmup disabled.');
    console.warn('[Warmup][Init] To enable: set WARMUP_PLATFORM_SEEDS=true and WARMUP_SEEDS=[...] in env');
    console.warn('[Warmup][Init]   Example:');
    console.warn('[Warmup][Init]   WARMUP_SEEDS=[{"email":"seed1@gmail.com","smtpPass":"...","provider":"gmail"},{"email":"seed2@outlook.com","smtpPass":"...","provider":"outlook"}]');
  } else {
    console.log(`[Warmup][Init] ✅ Seed fleet ready — ${metrics.active} seeds can serve domains`);
  }
}