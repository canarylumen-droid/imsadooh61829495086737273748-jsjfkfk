/**
 * Feature Flags Service
 * Pushes config/feature updates to all connected clients in real-time via SSE.
 * No page refresh needed — new features activate in seconds.
 */

import { Router, Request, Response } from "express";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuth, getCurrentUserId } from "@services/api-gateway/src/middleware/auth.js";
import { wsSync } from "./websocket-sync.js";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  payload?: any;
}

interface FeatureFlagsConfig {
  version: number;
  flags: Record<string, FeatureFlag>;
  updatedAt: string;
}

let currentConfig: FeatureFlagsConfig = {
  version: Date.now(),
  flags: {},
  updatedAt: new Date().toISOString()
};

// SSE clients registry
const sseClients = new Map<string, Set<Response>>();

export function updateFeatureFlags(flags: Record<string, FeatureFlag>) {
  currentConfig = {
    version: Date.now(),
    flags: { ...currentConfig.flags, ...flags },
    updatedAt: new Date().toISOString()
  };
  broadcastToAll();
}

export function getFeatureFlags(): FeatureFlagsConfig {
  return currentConfig;
}

function broadcastToAll() {
  const data = JSON.stringify({ type: 'feature_flags_updated', config: currentConfig });
  for (const [userId, clients] of sseClients) {
    for (const res of clients) {
      try {
        res.write(`data: ${data}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
    if (clients.size === 0) sseClients.delete(userId);
  }
}

export function registerRoutes(router: Router) {
  // SSE endpoint: frontend connects here and receives feature flag updates in real-time
  router.get("/feature-flags/stream", requireAuth, (req: Request, res: Response) => {
    const userId = getCurrentUserId(req)!;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send current config immediately on connect
    res.write(`data: ${JSON.stringify({ type: 'feature_flags_updated', config: currentConfig })}\n\n`);

    // Register client
    if (!sseClients.has(userId)) sseClients.set(userId, new Set());
    sseClients.get(userId)!.add(res);

    // Keep alive every 15s
    const keepAlive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(keepAlive); }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      const clients = sseClients.get(userId);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) sseClients.delete(userId);
      }
    });
  });

  // Ping endpoint: deploy script calls this after deploy to trigger flag broadcast
  router.post("/feature-flags/ping", (req: Request, res: Response) => {
    const { flags } = req.body || {};
    if (flags) updateFeatureFlags(flags);
    else broadcastToAll();
    res.json({ ok: true, version: currentConfig.version });
  });

  // GET endpoint for clients that can't use SSE (polling fallback)
  router.get("/feature-flags", (_req: Request, res: Response) => {
    res.json(currentConfig);
  });
}
