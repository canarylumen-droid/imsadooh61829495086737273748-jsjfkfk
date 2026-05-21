import { subscribe } from '../redis-pubsub.js';

/**
 * Register a handler that will be invoked whenever a message is published on the given channel.
 * The handler can be async; any errors are logged.
 */
export function onScheduledTask(channel: string, handler: () => Promise<void> | void) {
  // Subscribe once; the Redis client will keep the connection alive.
  subscribe(channel, async (_msg: unknown) => {
    try {
      await handler();
    } catch (err) {
      console.error(`Error handling scheduled task on channel ${channel}:`, err);
    }
  });
}
