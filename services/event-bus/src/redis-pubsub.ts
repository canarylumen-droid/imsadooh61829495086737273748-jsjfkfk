import { getPubClient, getSubClient } from '@shared/lib/redis/redis.js';

export const publish = async (channel: string, message: any) => {
  const client = await getPubClient();
  if (!client) {
    console.warn(`[EventBus] Redis unavailable; dropped publish on ${channel}`);
    return;
  }
  await client.publish(channel, JSON.stringify(message));
};

export const subscribe = (channel: string, handler: (msg: any) => void) => {
  void (async () => {
    const sub = await getSubClient();
    if (!sub) {
      console.warn(`[EventBus] Redis unavailable; skipped subscribe on ${channel}`);
      return;
    }

    await sub.subscribe(channel, (payload) => {
      try {
        handler(JSON.parse(payload));
      } catch (e) {
        console.error('Failed to parse Redis message', e);
      }
    });
  })().catch((err) => {
    console.error(`Redis subscribe error for ${channel}:`, err);
  });
};
