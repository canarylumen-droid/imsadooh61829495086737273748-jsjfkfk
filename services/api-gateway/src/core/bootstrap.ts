// ─── GLOBAL DNS FIX (ABSOLUTE FIRST LINE) ────────────────────────────────────
import dns from "dns";
// Force all lookups to prefer IPv4
dns.setDefaultResultOrder("ipv4first");

// Monkey-patch dns.lookup to strictly filter for IPv4
const originalLookup = dns.lookup;
const patchedLookup = ((hostname: string, options: any, callback: any) => {
  const cb = typeof options === 'function' ? options : callback;
  const originalOptions = typeof options === 'function' ? {} : options;

  // Try IPv4 first for stability in cloud environments (Railway/Neon)
  originalLookup(hostname, { ...originalOptions, family: 4 }, (err, address, family) => {
    if (!err) {
      return cb(null, address, family);
    }
    // Fallback to default behavior if IPv4 fails or is unavailable
    originalLookup(hostname, originalOptions, cb);
  });
}) as any;
dns.lookup = patchedLookup;

// Also override promises.lookup
if (dns.promises && dns.promises.lookup) {
    const originalPromisesLookup = dns.promises.lookup;
    dns.promises.lookup = (async (hostname: string, options: any) => {
        try {
            // Try IPv4 first
            return await originalPromisesLookup(hostname, { ...options, family: 4 });
        } catch (err) {
            // Fallback to default
            return await originalPromisesLookup(hostname, options);
        }
    }) as any;
}

// Also override resolve4/resolve6 to prevent bypass
const nativeResolve4 = dns.resolve4;
(dns as any).resolve = nativeResolve4;
(dns as any).resolve6 = (hostname: string, options: any, callback: any) => {
    const cb = typeof options === 'function' ? options : callback;
    if (cb) cb(new Error('IPv6 is disabled for production stability'), []);
    return Promise.reject(new Error('IPv6 is disabled'));
};
// ─────────────────────────────────────────────────────────────────────────────

import "dotenv/config";
import * as Sentry from "@sentry/node";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}

// Global Exception Handlers for Production Stability
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] 🛑 Unhandled Rejection at:', promise, 'reason:', reason);
  if (process.env.OBSERVABILITY_SENTRY_DSN) {
    Sentry.captureException(reason);
  }
});

process.on('uncaughtException', (err) => {
  console.error('[FATAL] 🛑 Uncaught Exception:', err);
  if (process.env.OBSERVABILITY_SENTRY_DSN) {
    Sentry.captureException(err);
  }
  // In production, we let the process exit for uncaught exceptions 
  // so the orchestrator (Railway/K8s) can restart it cleanly.
  if (process.env.NODE_ENV === 'production') {
    setTimeout(() => process.exit(1), 1000);
  }
});

export const bootstrapSystem = () => {
  console.log("✅ Core System Bootstrapped");
};
