import { Router, Request, Response } from "express";
import { handleInstagramWebhook, handleInstagramVerification } from "@services/api-gateway/src/webhooks/instagram-webhook.js";
import { webhookLimiter } from "../middleware/rate-limit.js";

const router = Router();

/**
 * GET /webhook
 * Meta webhook verification endpoint
 * Responds to hub.challenge for webhook subscription verification
 */
router.get("/", webhookLimiter, (req: Request, res: Response): void => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[Webhook] GET /webhook called (Meta verification)");
  console.log("[Webhook] Mode:", mode || "NOT SET");
  console.log("[Webhook] Verify token received:", token ? "YES" : "NONE");
  console.log("[Webhook] Challenge:", challenge ? "YES" : "NONE");
  console.log("[Webhook] META_VERIFY_TOKEN configured:", process.env.META_VERIFY_TOKEN ? "YES" : "NO");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  handleInstagramVerification(req, res);
});

/**
 * POST /webhook
 * Meta webhook event handler
 * Receives Instagram DM events, comments, and reactions
 */
router.post("/", webhookLimiter, async (req: Request, res: Response): Promise<void> => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("[Webhook] POST /webhook called (Meta event)");
  console.log("[Webhook] Object type:", req.body?.object || "UNKNOWN");
  console.log("[Webhook] Entry count:", req.body?.entry?.length || 0);
  if (process.env.NODE_ENV === "development") {
    console.log("[Webhook] Full payload:", JSON.stringify(req.body, null, 2));
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await handleInstagramWebhook(req, res);
});

export default router;
