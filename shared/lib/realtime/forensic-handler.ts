let forensicHandlerInitialized = false;

export async function initForensicHandler() {
  if (forensicHandlerInitialized) return;
  forensicHandlerInitialized = true;

  try {
    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
    const { getRedisClient } = await import('@shared/lib/redis/redis.js');
    const client = await getRedisClient();
    if (!client) {
      console.warn('[ForensicHandler] Redis not available');
      return;
    }

    const subClient = client.duplicate();
    await subClient.connect();

    await subClient.subscribe('audnix-cluster:events', async (message: string) => {
      try {
        const data = JSON.parse(message);
        const eventType = data.type || data.event;

        if (eventType === 'DMARC_REPORT' || eventType === 'DMARC_FAILURE') {
          await handleDmarcReport(data.payload || data);
        } else if (eventType === 'SEED_MONITOR' || eventType === 'SEED_PLACEMENT') {
          await handleSeedPlacement(data.payload || data);
        }
      } catch (e: any) {
        console.warn('[ForensicHandler] Parse error:', e.message);
      }
    });

    console.log('[ForensicHandler] Listening for DMARC/seed events');
  } catch (e: any) {
    console.warn('[ForensicHandler] Init failed:', e.message);
  }
}

async function handleDmarcReport(payload: any) {
  const recipient = payload?.original_rcpt_to;
  if (!recipient) return;

  try {
    const { db } = await import('@shared/lib/db/db.js');
    const { sql } = await import('drizzle-orm');
    const result: any = await db.execute(sql`SELECT id, user_id FROM email_tracking WHERE recipient_email = ${recipient} ORDER BY created_at DESC LIMIT 1`);
    const row = result?.rows?.[0];
    if (!row) return;

    await db.execute(sql`UPDATE email_tracking SET placement = 'spam' WHERE id = ${row.id}`);

    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
    await clusterSync.notifyDeliverabilityUpdated(row.user_id, {
      placement: 'spam',
      source: 'dmarc_ruf',
      email: recipient,
      emailTrackingId: row.id,
    });
    await clusterSync.notifyStatsUpdated(row.user_id);
  } catch (e: any) {
    console.warn('[ForensicHandler] DMARC report error:', e.message);
  }
}

async function handleSeedPlacement(payload: any) {
  const messageId = payload?.message_id;
  if (!messageId) return;

  try {
    const { db } = await import('@shared/lib/db/db.js');
    const { sql } = await import('drizzle-orm');
    const result: any = await db.execute(sql`SELECT id, user_id FROM email_tracking WHERE token = ${messageId} OR message_id = ${messageId} ORDER BY created_at DESC LIMIT 1`);
    const row = result?.rows?.[0];
    if (!row) return;

    const placement = payload.placement || 'inbox';

    await db.execute(sql`UPDATE email_tracking SET placement = ${placement}, seed_folder = ${payload.folder || null} WHERE id = ${row.id}`);

    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
    await clusterSync.notifyDeliverabilityUpdated(row.user_id, {
      placement,
      source: 'seed_monitor',
      email: payload.seed_email,
      emailTrackingId: row.id,
      seedFolder: payload.folder,
    });
    await clusterSync.notifyStatsUpdated(row.user_id);
  } catch (e: any) {
    console.warn('[ForensicHandler] Seed placement error:', e.message);
  }
}
