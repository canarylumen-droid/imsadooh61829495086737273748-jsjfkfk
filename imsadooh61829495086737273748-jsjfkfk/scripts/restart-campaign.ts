import { db } from "../shared/lib/db/db.js";
import { outreachCampaigns } from "../packages/shared/index.js";
import { eq } from "drizzle-orm";

const CAMPAIGN_ID = "a4f0868e-73f5-4536-b230-ce1902b637cf";

async function main() {
  console.log("Fetching campaign...");
  const [campaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, CAMPAIGN_ID));
  if (!campaign) { console.log("Campaign not found"); process.exit(1); }
  
  console.log("Campaign found:", campaign.name, "| Status:", campaign.status);
  console.log("Re-adding send-batch jobs...");
  
  const { campaignQueueManager } = await import("../shared/lib/queues/campaign-queue.js");
  await campaignQueueManager.startCampaign(campaign);
  console.log("Done! Send-batch jobs re-added.");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
