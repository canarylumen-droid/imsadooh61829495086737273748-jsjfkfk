import { hasRedis } from "../shared/lib/queues/redis-config.js";
import { campaignQueue } from "../shared/lib/queues/campaign-queue.js";
console.log("hasRedis:", hasRedis);
console.log("campaignQueue exists:", !!campaignQueue);
if (campaignQueue) {
  const counts = await campaignQueue.getJobCounts();
  console.log("Job counts:", JSON.stringify(counts));
  const repeatable = await campaignQueue.getRepeatableJobs();
  console.log("Repeatable jobs:", repeatable.length);
}
