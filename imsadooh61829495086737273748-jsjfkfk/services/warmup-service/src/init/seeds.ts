import { seedFleetManager } from '../engine/seed-fleet-manager.js';

const MAX_SEED_RETRIES = 3;
const SEED_RETRY_DELAY_MS = 5_000;

export async function provisionSeedsOnStartup(): Promise<void> {
  console.log('[Warmup][Init] Checking for seed provisioning...');

  if (!process.env.WARMUP_SEEDS) {
    console.log('[Warmup][Init] No WARMUP_SEEDS env var — skipping seed provisioning.');
    return;
  }

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_SEED_RETRIES; attempt++) {
    try {
      const provisioned = await seedFleetManager.provisionFromEnv();
      if (provisioned > 0 || process.env.WARMUP_SEEDS) {
        console.log(`[Warmup][Init] Seed provisioning — ${provisioned} new seed(s) provisioned`);
      }

      const metrics = await seedFleetManager.getSeedMetrics();
      console.log(`[Warmup][Init] Seed fleet status: ${metrics.active} active, ${metrics.total} total, ${metrics.googleSeeds} Google, ${metrics.msSeeds} Microsoft seeds`);

      if (metrics.active > 0) {
        console.log(`[Warmup][Init] ✅ Seed fleet ready — ${metrics.active} seeds can serve domains`);
        return;
      }

      console.warn(`[Warmup][Init] ⚠️  No active seeds available (attempt ${attempt}/${MAX_SEED_RETRIES}).`);
      if (attempt < MAX_SEED_RETRIES) {
        console.warn(`[Warmup][Init] Retrying in ${SEED_RETRY_DELAY_MS / 1000}s...`);
      }
    } catch (err: any) {
      lastError = err;
      console.error(`[Warmup][Init] Seed provisioning failed (attempt ${attempt}/${MAX_SEED_RETRIES}):`, err.message);
      if (attempt < MAX_SEED_RETRIES) {
        console.warn(`[Warmup][Init] Retrying in ${SEED_RETRY_DELAY_MS / 1000}s...`);
      }
    }

    if (attempt < MAX_SEED_RETRIES) {
      await new Promise(r => setTimeout(r, SEED_RETRY_DELAY_MS));
    }
  }

  console.warn('[Warmup][Init] ⚠️  Seed provisioning failed after 3 attempts. Falling back to normal warmup without platform seeds.');
  console.warn('[Warmup][Init] To enable: set WARMUP_PLATFORM_SEEDS=true and WARMUP_SEEDS=[...] in env');
  console.warn('[Warmup][Init]   Example:');
  console.warn('[Warmup][Init]   WARMUP_SEEDS=[{"email":"seed1@gmail.com","smtpPass":"...","provider":"gmail"},{"email":"seed2@outlook.com","smtpPass":"...","provider":"outlook"}]');
}