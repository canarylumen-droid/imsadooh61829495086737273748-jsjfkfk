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
    const { getMySqlPool, connectMySql } = await import('@shared/lib/mysql.js');
    const pool = getMySqlPool() || await connectMySql();
    const [rows]: any = await pool.query(
      `SELECT id, user_id FROM email_tracking WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1`,
      [recipient]
    );
    if (!rows?.length) return;

    const { id, user_id } = rows[0];
    await pool.query(
      `UPDATE email_tracking SET placement = 'spam', spam_detected_at = NOW() WHERE id = ?`,
      [id]
    );

    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
    await clusterSync.notifyDeliverabilityUpdated(user_id, {
      placement: 'spam',
      source: 'dmarc_ruf',
      email: recipient,
      emailTrackingId: id,
    });
    await clusterSync.notifyStatsUpdated(user_id);
  } catch (e: any) {
    console.warn('[ForensicHandler] DMARC report error:', e.message);
  }
}

async function handleSeedPlacement(payload: any) {
  const messageId = payload?.message_id;
  if (!messageId) return;

  try {
    const { getMySqlPool, connectMySql } = await import('@shared/lib/mysql.js');
    const pool = getMySqlPool() || await connectMySql();
    const [rows]: any = await pool.query(
      `SELECT id, user_id FROM email_tracking WHERE message_id = ? OR metadata->>'$.messageId' = ? ORDER BY created_at DESC LIMIT 1`,
      [messageId, messageId]
    );
    if (!rows?.length) return;

    const { id, user_id } = rows[0];
    const placement = payload.placement || 'inbox';

    await pool.query(
      `UPDATE email_tracking SET placement = ?, seed_folder = ? WHERE id = ?`,
      [placement, payload.folder || null, id]
    );

    const { clusterSync } = await import('@shared/lib/realtime/redis-pubsub.js');
    await clusterSync.notifyDeliverabilityUpdated(user_id, {
      placement,
      source: 'seed_monitor',
      email: payload.seed_email,
      emailTrackingId: id,
      seedFolder: payload.folder,
    });
    await clusterSync.notifyStatsUpdated(user_id);
  } catch (e: any) {
    console.warn('[ForensicHandler] Seed placement error:', e.message);
  }
}
