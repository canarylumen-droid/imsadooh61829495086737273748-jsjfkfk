import { Queue } from "bullmq";
import { createFreshConnection } from "/home/ubuntu/app/shared/lib/queues/redis-config.js";
const conn = createFreshConnection();
const q = new Queue("campaign-engine", { connection: conn });
const mids = ["831f4b22-8be9-4bce-a46b-3f51bb85bbf5","15dfd404-921c-47b2-8e35-2d41651c0a59","577b4535-862b-44ec-b311-676a99e33598"];
const jobs = mids.map(id => ({
  name: "sb-" + id.slice(-8),
  data: { type: "campaign:send-batch", campaignId: "a4f0868e-73f5-4536-b230-ce1902b637cf", userId: "784005b5-f6d4-4d1f-a98e-2aa2fb811d1a", integrationId: id, dailyLimit: 45 },
  opts: { delay: 1000, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } }
}));
await q.addBulk(jobs);
console.log("Added", jobs.length, "send-batch jobs");
await q.close();
await conn.quit();
