/**
 * VERIFICATION ROUTES
 * 
 * Validates:
 * 1. Environment variables
 * 2. Database connection (Neon)
 * 3. Core table access (Users)
 * 
 * Note: Supabase dependencies have been removed.
 */

import type { Express } from "express";
import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";

const VERIFICATION_LOG_PREFIX = "🔍 [VERIFICATION]";

function verificationLog(message: string, data?: any) {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${timestamp} ${VERIFICATION_LOG_PREFIX} ${message}`, data ? JSON.stringify(data, null, 2) : "");
}

/**
 * ROUTE 1: /api/verify/env
 * Checks that all required environment variables are present
 */
async function verifyEnvironmentVariables() {
  verificationLog("=== ENVIRONMENT VARIABLES CHECK ===");

  const requiredVars = [
    "DATABASE_URL",
    // "SESSION_SECRET" // Good to check if you have it
  ];

  const optionalVars = [
    "OPENAI_API_KEY",
    "TWILIO_SENDGRID_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN"
  ];

  const status: Record<string, any> = {
    required: {},
    optional: {},
    missing: [],
  };

  // Check required variables
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (value) {
      status.required[varName] = {
        present: true,
        length: value.length,
        preview: value.substring(0, 20) + "...",
      };
      verificationLog(`✅ ${varName} is set (${value.length} chars)`);
    } else {
      status.required[varName] = { present: false };
      status.missing.push(varName);
      verificationLog(`❌ ${varName} is MISSING`);
    }
  }

  // Check optional variables
  for (const varName of optionalVars) {
    const value = process.env[varName];
    if (value) {
      status.optional[varName] = {
        present: true,
        length: value.length,
        preview: value.substring(0, 20) + "...",
      };
      verificationLog(`✅ ${varName} is set (${value.length} chars)`);
    } else {
      status.optional[varName] = { present: false };
      verificationLog(`⚠️  ${varName} is optional and not set`);
    }
  }

  return status;
}

/**
 * ROUTE 2: /api/verify/database
 * Checks database connection and reads from users table
 */
async function verifyDatabaseConnection() {
  verificationLog("=== DATABASE CONNECTION VERIFICATION ===");

  const status: Record<string, any> = {
    connected: false,
    canRead: false,
    userCount: 0,
    version: null,
    error: null,
  };

  if (!process.env.DATABASE_URL) {
    status.error = "DATABASE_URL environment variable not set";
    verificationLog(`❌ ${status.error}`);
    return status;
  }

  try {
    verificationLog("Testing database connection...");

    if (!db) {
      status.error = "Database client not initialized";
      verificationLog(`❌ ${status.error}`);
      return status;
    }

    // Check version
    try {
      const versionResult = await db.execute(sql`SELECT version()`);
      status.version = versionResult.rows[0]?.version;
      status.connected = true;
      verificationLog(`✅ Database connected: ${status.version}`);
    } catch (e: any) {
      status.error = `Connection failed: ${e.message}`;
      verificationLog(`❌ ${status.error}`);
      return status;
    }

    // Try to query the users table
    verificationLog("Attempting to read from users table...");
    try {
      const users = await db.query.users.findMany({ limit: 5 });
      status.canRead = true;
      verificationLog(`✅ Users table is readable (retrieved ${users.length} rows)`);

      // Get user count (approximate or actual)
      const allUsers = await db.query.users.findMany();
      status.userCount = allUsers?.length || 0;
      verificationLog(`✅ Total users in database: ${status.userCount}`);

    } catch (e: any) {
      status.error = `Read failed: ${e.message}`;
      verificationLog(`❌ ${status.error}`);
    }

    return status;
  } catch (error: any) {
    status.error = `Database error: ${error.message}`;
    verificationLog(`❌ ${status.error}`);
    return status;
  }
}

/**
 * Register all verification routes
 */
export function registerVerificationRoutes(app: Express) {
  // ENDPOINT 1: Environment Variables Verification
  app.get("/api/verify/env", async (req, res) => {
    try {
      const result = await verifyEnvironmentVariables();
      res.json({
        success: true,
        endpoint: "/api/verify/env",
        timestamp: new Date().toISOString(),
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ENDPOINT 2: Database Connection Verification
  app.get("/api/verify/database", async (req, res) => {
    try {
      const result = await verifyDatabaseConnection();
      res.json({
        success: result.connected && result.canRead,
        endpoint: "/api/verify/database",
        timestamp: new Date().toISOString(),
        data: result,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Legacy/Compatibility endpoints that just return success or skipped
  app.get("/api/verify/supabase", async (req, res) => {
    res.json({
      success: true,
      message: "Supabase verification skipped (Using Neon)",
      timestamp: new Date().toISOString(),
      data: { configured: false, initialized: false, note: "Deprecated" }
    });
  });

  app.get("/api/verify/storage-test", async (req, res) => {
    res.json({
      success: true,
      message: "Storage test skipped (Using Postgres for Avatars/PDFs)",
      timestamp: new Date().toISOString(),
      data: { bucketAccessible: true, note: "Deprecated" }
    });
  });

  // MASTER ENDPOINT: Full Verification Suite
  app.get("/api/verify/all", async (req, res) => {
    try {
      verificationLog("=== RUNNING FULL VERIFICATION SUITE ===");

      const envCheck = await verifyEnvironmentVariables();
      const dbCheck = await verifyDatabaseConnection();

      // Supabase checks are always "passed" as they are deprecated
      const supabaseCheck = { configured: true, initialized: true, note: "Deprecated" };
      const storageCheck = { bucketAccessible: true, note: "Deprecated" };

      const allPassed =
        Object.keys(envCheck.required).every(k => envCheck.required[k].present) &&
        dbCheck.connected &&
        dbCheck.canRead;

      verificationLog(allPassed ? "✅ ALL CHECKS PASSED" : "⚠️  SOME CHECKS FAILED");

      res.json({
        success: allPassed,
        timestamp: new Date().toISOString(),
        checks: {
          environment: envCheck,
          database: dbCheck,
          supabase: supabaseCheck,
          storage: storageCheck
        },
        summary: {
          allPassed,
          envConfigured: Object.keys(envCheck.required).every(k => envCheck.required[k].present),
          databaseConnected: dbCheck.connected,
          supabaseReady: true, // Legacy
          storageAccessible: true // Legacy
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  verificationLog("✅ Verification routes registered:");
  verificationLog("   - GET /api/verify/env - Check environment variables");
  verificationLog("   - GET /api/verify/database - Check database connection");
  verificationLog("   - GET /api/verify/all - Run full verification suite");
}
