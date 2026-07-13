import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

// ─── MIGRATION PIPE: Direct Connection ───────────────────────────────────────
// NEVER run migrations through a transaction pooler.
// DDL (CREATE TABLE, ALTER COLUMN, etc.) uses ACCESS EXCLUSIVE locks
// that poolers cannot hold. Always use the direct connection line.
// ───────────────────────────────────────────────────────────────────────────────

const MIGRATION_URL = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!MIGRATION_URL) {
  throw new Error(
    "DATABASE_URL_DIRECT (or fallback DATABASE_URL) is not set. " +
    "Migrations require a direct (non-pooled) database connection."
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: MIGRATION_URL,
  },
});
