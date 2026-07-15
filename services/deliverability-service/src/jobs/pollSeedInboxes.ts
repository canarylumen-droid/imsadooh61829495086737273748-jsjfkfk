import { db } from '../db/client.js';
import { seedResults } from '../db/schema.js';
import { eq, isNull } from 'drizzle-orm';
import { fetchSeedAccounts, type SeedAccount } from '../services/warmupServiceClient.js';
import { checkSeedPlacement } from '../services/imapClient.js';
import { notifyCore } from '../webhooks/notifyCore.js';
import { notifySeedUpdate } from '../webhooks/notifyCore.js';
import { config } from '../config.js';
import { v4 as uuid } from 'uuid';

interface RegisterSeedInput {
  campaignId: string;
  testId: string;
  sentAt: string;
  userId?: string;
  seedAccountRefs?: string[];
}

export async function pollSeedInboxes(): Promise<void> {
  console.log('[SeedPoll] Starting seed inbox check...');

  const seeds = await fetchSeedAccounts();
  if (seeds.length === 0) {
    console.log('[SeedPoll] No seed accounts available — skipping');
    return;
  }

  const pendingRows = await db
    .select()
    .from(seedResults)
    .where(isNull(seedResults.folderFound));

  if (pendingRows.length === 0) {
    console.log('[SeedPoll] No pending seed results to check');
    return;
  }

  console.log(`[SeedPoll] Checking ${pendingRows.length} pending results across ${seeds.length} seeds`);

  const seedMap = new Map<string, SeedAccount>();
  for (const s of seeds) {
    seedMap.set(s.email.toLowerCase(), s);
    seedMap.set(s.id, s);
  }

  let checked = 0;
  let found = 0;

  for (const row of pendingRows) {
    const createdAt = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    const ageMinutes = createdAt ? (Date.now() - createdAt) / (1000 * 60) : Infinity;
    if (ageMinutes > config.seedCheck.maxWaitMinutes) {
      await db.update(seedResults)
        .set({ folderFound: 'not_found', checkedAt: new Date().toISOString() })
        .where(eq(seedResults.id, row.id));
      checked++;
      continue;
    }

    const seed = seedMap.get(row.seedAccountRef.toLowerCase()) || seedMap.get(row.seedAccountRef);
    if (!seed) continue;

    try {
      const result = await checkSeedPlacement(seed, row.testId, 20);
      await db.update(seedResults)
        .set({ folderFound: result.folder, checkedAt: new Date().toISOString() })
        .where(eq(seedResults.id, row.id));
      notifySeedUpdate({
        campaignId: row.campaignId,
        testId: row.testId,
        seedEmail: seed.email,
        folder: result.folder,
        provider: seed.provider,
        userId: row.userId || undefined,
      }).catch(() => {});
      checked++;
      if (result.folder === 'inbox') found++;
    } catch (err: any) {
      console.warn(`[SeedPoll] Check failed for ${seed.email}: ${err.message}`);
    }
  }

  console.log(`[SeedPoll] Checked ${checked} results, ${found} in inbox`);
  await evaluateCampaignRates();
}

async function evaluateCampaignRates(): Promise<void> {
  const campaignRows = await db
    .select({ campaignId: seedResults.campaignId })
    .from(seedResults)
    .groupBy(seedResults.campaignId);

  for (const { campaignId } of campaignRows) {
    const rows = await db
      .select()
      .from(seedResults)
      .where(eq(seedResults.campaignId, campaignId));

    const totalChecked = rows.filter(r => r.folderFound !== null);
    if (totalChecked.length === 0) continue;
    if (totalChecked.length < rows.length) continue;

    const inboxCount = totalChecked.filter(r => r.folderFound === 'inbox').length;
    const spamCount = totalChecked.filter(r => r.folderFound === 'spam').length;
    const inboxRate = inboxCount / totalChecked.length;
    const spamRate = spamCount / totalChecked.length;
    const userId = rows.find(r => r.userId)?.userId || undefined;

    if (inboxRate < config.thresholds.inboxRatePause) {
      await notifyCore({ campaignId, userId, source: 'seed', inboxRate, spamRate, action: 'pause' });
    } else if (inboxRate < config.thresholds.inboxRateWarn) {
      await notifyCore({ campaignId, userId, source: 'seed', inboxRate, spamRate, action: 'warn' });
    } else {
      await notifyCore({ campaignId, userId, source: 'seed', inboxRate, spamRate, action: 'completed' });
    }
  }
}

export async function registerSeed(input: RegisterSeedInput) {
  const seeds = await fetchSeedAccounts();
  const requestedRefs = new Set(input.seedAccountRefs?.map(ref => ref.toLowerCase()) || []);
  const selectedSeeds = requestedRefs.size > 0
    ? seeds.filter(seed => requestedRefs.has(seed.id.toLowerCase()) || requestedRefs.has(seed.email.toLowerCase()))
    : seeds;

  if (selectedSeeds.length === 0) {
    const error = new Error(requestedRefs.size > 0
      ? 'No matching active seed accounts found'
      : 'No active seed accounts available from warmup service');
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }

  const createdAt = input.sentAt || new Date().toISOString();
  const rows = selectedSeeds.map(seed => ({
    id: uuid(),
    userId: input.userId || null,
    campaignId: input.campaignId,
    testId: input.testId,
    seedAccountRef: seed.id,
    provider: seed.provider,
    createdAt,
  }));

  await db.insert(seedResults)
    .values(rows)
    .onConflictDoNothing();

  return {
    campaignId: input.campaignId,
    testId: input.testId,
    registered: rows.length,
    seedAccountRefs: rows.map(row => row.seedAccountRef),
  };
}

export async function getSeedStatus(campaignId: string) {
  const rows = await db
    .select()
    .from(seedResults)
    .where(eq(seedResults.campaignId, campaignId));

  const total = rows.length;
  const checked = rows.filter(r => r.folderFound !== null);
  const inboxCount = checked.filter(r => r.folderFound === 'inbox').length;
  const spamCount = checked.filter(r => r.folderFound === 'spam').length;
  const promoCount = checked.filter(r => r.folderFound === 'promotions').length;

  return {
    campaignId,
    total,
    checked: checked.length,
    inboxRate: checked.length > 0 ? inboxCount / checked.length : 0,
    spamRate: checked.length > 0 ? spamCount / checked.length : 0,
    promotionsRate: checked.length > 0 ? promoCount / checked.length : 0,
    results: rows.map(r => ({
      id: r.id,
      userId: r.userId,
      seedAccountRef: r.seedAccountRef,
      provider: r.provider,
      folderFound: r.folderFound,
      checkedAt: r.checkedAt,
    })),
  };
}
