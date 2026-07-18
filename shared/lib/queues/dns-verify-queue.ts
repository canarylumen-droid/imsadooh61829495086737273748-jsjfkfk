import { getSharedRedisConnection } from './redis-config.js';

const DNS_QUEUE = process.env.DNS_QUEUE_NAME || 'dns-verify-queue';
const DNS_RESULT_QUEUE = process.env.DNS_RESULT_QUEUE_NAME || 'dns-verify-results';
const POLL_INTERVAL = 1000;

let consumerRunning = false;

export function enqueueDnsVerification(
  jobId: string,
  userId: string,
  domain: string,
  dkimSelector?: string
): void {
  const redis = getSharedRedisConnection();
  const job = JSON.stringify({ job_id: jobId, user_id: userId, domain, dkim_selector: dkimSelector || null });
  redis.lpush(DNS_QUEUE, job).catch((err: any) => {
    console.error('[DnsVerifyQueue] Failed to enqueue:', err);
  });
}

export function startDnsResultConsumer(
  onResult: (result: any) => void
): void {
  if (consumerRunning) return;
  consumerRunning = true;

  const poll = async () => {
    try {
      const redis = getSharedRedisConnection();
      while (true) {
        const result = await redis.brpop(DNS_RESULT_QUEUE, 1);
        if (result) {
          try {
            const data = JSON.parse(result[1]);
            onResult(data);
          } catch (e) {
            console.error('[DnsVerifyQueue] Failed to parse result:', e);
          }
        }
      }
    } catch (err: any) {
      console.error('[DnsVerifyQueue] Consumer error:', err);
      setTimeout(poll, POLL_INTERVAL);
    }
  };

  poll();
}
