import { Queue } from "bullmq";
import { createFreshConnection } from "../shared/lib/queues/redis-config.js";

const conn = createFreshConnection();
const queue = new Queue("campaign-engine", { connection: conn });

const mailboxIds = [
  "831f4b22-8be9-4bce-a46b-3f51bb85bbf5",
  "15dfd404-921c-47b2-8e35-2d41651c0a59",
  "577b4535-862b-44ec-b311-676a99e33598"
];

const campaignId = "a4f0868e-73f5-4536-b230-ce1902b637cf";
const userId = "784005b5-f6d4-4d1f-a98e-2aa2fb811d1a";

const jobs = mailboxIds.map(mbId => ({
  name: "send-batch-" + campaignId + "-" + mbId,
  data: {
    type: "campaign:send-batch" as const,
    campaignId: campaignId,
    userId: userId,
    integrationId: mbId,
    dailyLimit: 45,
  },
  opts: { delay: 1000, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } },
}));

await queue.addBulk(jobs);
console.log("Added " + jobs.length + " send-batch jobs");
await queue.close();
await (conn as any).quit();
