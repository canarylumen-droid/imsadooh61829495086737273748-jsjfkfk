import { Express, Response } from "express";
import http from "http";
import net from "net";
import path from "path";
import fs from "fs";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { apiLimiter } from "../middleware/rate-limit.js";
import userAuthRouter from "./user-auth.js";
import adminAuthRouter from "./admin-auth.js";
import adminPdfRoutes from "./admin-pdf-routes.js";
import adminPdfRoutesV2 from "./admin-pdf-routes-v2.js";
import adminRoutes from "./admin-routes.js";
import aiRoutes from "./ai-routes.js";
import aiSalesSuggestion from "./ai-sales-suggestion.js";
import authClean from "./auth-clean.js";
import authUsernameOnboarding from "./auth-username-onboarding.js";
import billingRoutes from "./billing-routes.js";
import bulkActionsRoutes from "./bulk-actions-routes.js";
import calendarRoutes from "./calendar-routes.js";
import commentAutomationRoutes from "./comment-automation-routes.js";
import customEmailRoutes from "./custom-email-routes.js";
import dashboardRoutes from "./dashboard-routes.js";
import emailOtpRoutes from "./email-otp-routes.js";
import emailStatsRoutes from "./email-stats-routes.js";
import leadIntelligence from "./lead-intelligence.js";
import leadRecoveryRoutes from "./lead-recovery-routes.js";
import oauthRoutes from "./oauth.js";
import otpRoutes from "./otp-routes.js";
import outreach from "./outreach.js";
import { paymentApprovalRouter as paymentApproval } from "./payment-approval.js";
import { paymentCheckoutRouter as paymentCheckout } from "./payment-checkout.js";
import salesEngine from "./sales-engine.js";
import stripePaymentConfirmation from "./stripe-payment-confirmation.js";
import videoAutomationRoutes from "./video-automation-routes.js";
import voiceRoutes from "./voice-routes.js";
import webhookRouter from "./webhook.js";
import workerRoutes from "./worker.js";
import messagesRoutes from "./messages-routes.js";
import healthRoutes from "./health-routes.js";
import pendingPaymentsRoutes from "./pending-payments.js";

import webhookMetaRoutes from "./webhook-meta.js";
import automationRulesRoutes from "./automation-rules-routes.js";
import channelStatusRoutes from "./channel-status-routes.js";
import dealsRoutes from "./deals-routes.js";
import integrationsRoutes from "./integrations-routes.js";
import objectionsRoutes from "./objections-routes.js";
import customTrainingRoutes from "./custom-training-routes.js";
import expertChatRoutes from "./expert-chat.js";
import userSettingsRoutes from "./user-settings-routes.js";
import prospectingRoutes from "./prospecting.js";
import developerRoutes from "./developer-routes.js";
import mcpRoutes from "./mcp-routes.js";
import { organizationRouter } from "./organization-routes.js";
import adminMigrationsRouter from "./admin-migrations.js";
import notificationRoutes from "./notification-routes.js";
import emailTrackingRoutes, { stealthRouter as stealthTrackingRoutes } from "./email-tracking-routes.js";
import { registerAnalyticsRoutes } from "./analytics-routes.js";
import revenueWebhook from "../webhooks/revenue-webhook.js";
import unsubscribeRoutes from "./unsubscribe-routes.js";
import fblWebhookRoutes from "./fbl-webhook.js";
import deliverabilityWebhookRoutes from './deliverability-webhook.js';
import { sseRouter } from "./sse-routes";

export async function registerRoutes(app: Express): Promise<http.Server> {
  // 1. Static Assets & Public Manifests (Served before auth/rate limiting for common assets)
  let staticDistPath = "";
  for (const p of [path.join(process.cwd(), "dist", "public"), path.join(process.cwd(), "dist", "dist", "public"), path.join(process.cwd(), "client", "dist")]) {
    if (fs.existsSync(p)) { staticDistPath = p; break; }
  }
  const sendPublicFile = (fileName: string, res: Response) => {
    if (staticDistPath) {
      const filePath = path.join(staticDistPath, fileName);
      if (fs.existsSync(filePath)) return res.sendFile(filePath);
    }
    res.status(404).end();
  };

  app.get("/robots.txt", (req, res) => sendPublicFile("robots.txt", res));
  app.get("/sitemap.xml", (req, res) => sendPublicFile("sitemap.xml", res));
  app.get("/favicon.ico", (req, res) => sendPublicFile("favicon.ico", res));
  app.get("/favicon.svg", (req, res) => sendPublicFile("favicon.svg", res));
  app.get("/manifest.json", (req, res) => sendPublicFile("manifest.json", res));
  app.get("/logo.svg", (req, res) => sendPublicFile("logo.svg", res));
  app.get("/logo.png", (req, res) => sendPublicFile("logo.png", res));
  app.get("/", (req, res) => sendPublicFile("index.html", res));

  // Stealth tracking routes mounted at root level so pixel URLs like
  // {baseUrl}/t/{token} work without an obvious /api/email-tracking/ prefix.
  app.use("/", stealthTrackingRoutes);

  const { handleInstagramWebhook, handleInstagramVerification } = await import("@services/api-gateway/src/webhooks/instagram-webhook.js");

  app.get("/api/instagram/callback", apiLimiter, (req, res) => {
    console.log(`[Root Callback] GET /api/instagram/callback`);
    if (req.query['hub.mode'] === 'subscribe') {
      return handleInstagramVerification(req, res);
    }
    const query = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    res.redirect(307, `/api/oauth/instagram/callback${query}`);
  });

  app.post("/api/instagram/callback", apiLimiter, async (req, res) => {
    console.log(`[Root Callback] POST /api/instagram/callback (Webhook)`);
    await handleInstagramWebhook(req, res);
  });


  // Mount all other routes
  app.use("/api/organizations", organizationRouter);

  // Auth routes — single mount per router to prevent duplicate path handling
  app.use("/api/user/auth", userAuthRouter);
  app.use("/api/auth", authClean);
  app.use("/api/auth/username", authUsernameOnboarding);

  app.use("/api/admin/auth", adminAuthRouter);
  app.use("/api/billing", billingRoutes);
  app.use("/api/bulk", bulkActionsRoutes);
  app.use("/api/calendar", calendarRoutes);
  app.use("/api/comments", commentAutomationRoutes);
  app.use("/api/custom-email", customEmailRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api", dashboardRoutes);
  app.use("/api/email/otp", emailOtpRoutes);
  app.use("/api/email/stats", emailStatsRoutes);
  app.use("/api/smtp", customEmailRoutes); // Mount at /api/smtp to handle /api/smtp/settings
  app.use("/api/leads/intelligence", leadIntelligence);
  app.use("/api/lead-recovery", leadRecoveryRoutes);
  app.use("/api/leads", aiRoutes);
  app.use("/api/messages", messagesRoutes);
  app.use("/api/brand-pdf", adminPdfRoutes);
  app.use("/api/admin", adminPdfRoutes);
  app.use("/api/admin", adminPdfRoutesV2); // Added to support /api/admin/analyze-pdf-v2
  app.use("/api/pdf", adminPdfRoutes); // Alias for /api/pdf/upload calls
  app.use("/api/oauth", oauthRoutes);
  app.use("/api/otp", otpRoutes);
  app.use("/api/outreach", outreach);
  // Mailbox health management routes (same prefix)
  const { healthRouter } = await import("./outreach.js");
  app.use("/api/outreach", healthRouter);
  app.use("/api/payment/approval", paymentApproval);
  app.use("/api/payment/checkout", paymentCheckout);
  app.use("/api/pending-payments", pendingPaymentsRoutes);
  app.use("/api/sales", salesEngine);
  app.use("/api/stripe/confirmation", stripePaymentConfirmation);
  app.use("/api/video", videoAutomationRoutes);
  app.use("/api/video-automation", videoAutomationRoutes);
  app.use("/api/voice", voiceRoutes);
  app.use("/api/webhook", webhookRouter);
  app.use("/api/webhooks/fbl", fblWebhookRoutes);  // Specific FIRST
  app.use('/api/webhooks/deliverability', deliverabilityWebhookRoutes);
  app.use("/api/webhooks", revenueWebhook);        // Generic AFTER
  app.use("/webhook", webhookMetaRoutes); // Root-level Meta webhook

  app.use("/api/worker", workerRoutes);
  app.use("/api/automation", automationRulesRoutes);
  app.use("/api/channels", channelStatusRoutes);
  app.use("/api/deals", dealsRoutes);
  app.use("/api/integrations", integrationsRoutes);
  app.use("/api/objections", objectionsRoutes);
  app.use("/api/custom-training", customTrainingRoutes);
  app.use("/api", userSettingsRoutes);
  app.use("/api/sales-engine", salesEngine);
  app.use("/api/expert-chat", expertChatRoutes);
  app.use("/api/expert-chat-v2", expertChatRoutes);
  app.use("/api/prospecting", prospectingRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/email-tracking", emailTrackingRoutes);
  app.use("/api/admin", adminMigrationsRouter); // Admin-only migration controls
  app.use("/api/cron", (await import("./cron-routes.js")).default);
  app.use("/api/health", healthRoutes);
  app.use("/api/unsubscribe", unsubscribeRoutes);
  app.use("/api/sse", sseRouter); // Server-Sent Events for real-time updates
  app.use("/api/developer", developerRoutes); // API keys, account deletion queue, MCP config
  app.use("/", mcpRoutes); // POST /mcp + /api/mcp/*
  // Feature flags: SSE stream + polling + deploy ping
  const { registerRoutes: registerFeatureFlagRoutes } = await import("@shared/lib/realtime/feature-flags.js");
  const featureFlagRouter = (await import("express")).Router();
  registerFeatureFlagRoutes(featureFlagRouter);
  app.use("/api", featureFlagRouter);
  registerAnalyticsRoutes(app); // Phase 14: KPI & Conversion Analytics

  // Catch-all for unmatched API routes — return JSON instead of Express HTML
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  });
  app.use("/mcp", (req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global error handler — return JSON instead of HTML for unhandled errors
  app.use((err: any, req: any, res: any, next: any) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
    });
  });

  // Create HTTP server
  const server = http.createServer(app);

  // When running in API-only mode, proxy /socket.io requests to the dedicated socket service
  if (process.env.API_DISABLE_SOCKET === 'true') {
    const SOCKET_PORT = process.env.SOCKET_PORT || '5001';
    const SOCKET_HOST = process.env.SOCKET_HOST || '127.0.0.1';

    // Proxy HTTP requests for socket.io polling transport
    app.use('/socket.io', (req, res) => {
      const options = {
        hostname: SOCKET_HOST,
        port: parseInt(SOCKET_PORT, 10),
        path: req.url,
        method: req.method,
        headers: { ...req.headers, connection: 'close' },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on('error', (err: Error) => {
        console.error('[SocketProxy] Proxy error:', err.message);
        if (!res.headersSent) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Socket service unavailable' }));
        }
      });

      req.pipe(proxyReq, { end: true });
    });

    // Proxy WebSocket upgrade requests for socket.io
    server.on('upgrade', (req, socket, head) => {
      if (req.url?.startsWith('/socket.io')) {
        const proxySocket = net.createConnection(parseInt(SOCKET_PORT, 10), SOCKET_HOST, () => {
          proxySocket.write(
            `${req.method} ${req.url} HTTP/1.1\r\n` +
            Object.entries(req.headers).map(([k, v]) => `${k}: ${v}\r\n`).join('') +
            '\r\n'
          );
          proxySocket.write(head);
          proxySocket.pipe(socket);
          socket.pipe(proxySocket);
        });

        proxySocket.on('error', () => {
          socket.destroy();
        });

        socket.on('error', () => {
          proxySocket.destroy();
        });
      }
    });
  } else {
    // Initialize WebSocket server for real-time sync
    wsSync.initialize(server);
  }

  return server;
}

