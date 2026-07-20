import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { db } from "@shared/lib/db/db.js";
import { pool } from "@shared/lib/db/db.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

/**
 * POST /api/admin/run-migrations
 * Manually trigger database migrations
 */
router.post("/run-migrations", requireAdmin, async (req: Request, res: Response): Promise<void> => {
    try {
        console.log("📦 [Admin] Manual migration trigger requested");

        const migrationsDir = path.join(process.cwd(), "migrations");

        if (!fs.existsSync(migrationsDir)) {
            res.status(404).json({ error: "No migrations directory found" });
            return;
        }

        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith(".sql"))
            .sort();

        const results: Array<{ file: string; status: string; error?: string }> = [];

        for (const file of migrationFiles) {
            const migrationPath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(migrationPath, "utf-8");

            console.log(`  ⏳ Running ${file}...`);

            try {
                if (pool) {
                    await pool.query(sql);
                } else {
                    await db.execute(sql as any);
                }
                console.log(`  ✅ ${file} complete`);
                results.push({ file, status: "success" });
            } catch (error: any) {
                if (error.message?.includes("already exists") || error.code === "42P07") {
                    console.log(`  ⏭️  ${file} (already exists)`);
                    results.push({ file, status: "skipped", error: "already exists" });
                } else {
                    console.log(`  ⚠️  ${file} failed: ${error.message}`);
                    results.push({ file, status: "error", error: error.message });
                }
            }
        }

        console.log("✅ [Admin] Migration run complete");

        res.json({
            success: true,
            message: "Migrations complete",
            results
        });
    } catch (error: any) {
        console.error("❌ [Admin] Migration error:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/admin/db-status
 * Check database table counts
 */
router.get("/db-status", requireAdmin, async (req: Request, res: Response): Promise<void> => {
    try {
        const tableCountQuery = `
      SELECT table_name, 
             (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

        const result = await pool.query(tableCountQuery);

        // Get row counts for key tables
        const countQueries = [
            { table: "users", query: "SELECT COUNT(*) FROM users" },
            { table: "content_library", query: "SELECT COUNT(*) FROM content_library" },
            { table: "leads", query: "SELECT COUNT(*) FROM leads" },
            { table: "prospects", query: "SELECT COUNT(*) FROM prospects" },
        ];

        const counts: Record<string, number> = {};
        for (const q of countQueries) {
            try {
                const countResult = await pool.query(q.query);
                counts[q.table] = parseInt(countResult.rows[0].count);
            } catch {
                counts[q.table] = -1; // Table doesn't exist
            }
        }

        res.json({
            success: true,
            tables: result.rows,
            rowCounts: counts,
            databaseUrl: (process.env.DATABASE_URL_POOL || process.env.DATABASE_URL)?.replace(/:[^@]+@/, ":****@") // Hide password
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
