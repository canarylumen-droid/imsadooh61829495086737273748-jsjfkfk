// services/event-bus/src/redis-pubsub.ts
import IORedis from 'ioredis';

const redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');

export const publish = async (channel: string, message: any) => {
  await redis.publish(channel, JSON.stringify(message));
};

export const subscribe = (channel: string, handler: (msg: any) => void) => {
  const sub = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379');
  sub.subscribe(channel, (err) => {
    if (err) console.error('Redis subscribe error:', err);
  });
  sub.on('message', (chan, payload) => {
    if (chan === channel) {
      try {
        handler(JSON.parse(payload));
      } catch (e) {
        console.error('Failed to parse Redis message', e);
      }
    }
  });
  return sub;
};
