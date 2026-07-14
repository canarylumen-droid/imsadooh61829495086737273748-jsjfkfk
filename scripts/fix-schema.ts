import pg from "pg";
import { resolve } from "path";
import dotenv from "dotenv";

dotenv.config({ path: resolve(process.cwd(), ".env") });

async function main() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }

  const dbUrl = new URL(url);
  const isNeon = url.includes('neon.tech');

  if (isNeon) {
    dbUrl.searchParams.set('uselibpqcompat', 'true');
    if (!dbUrl.searchParams.has('sslmode')) {
      dbUrl.searchParams.set('sslmode', 'require');
    }
  }

  const pool = new pg.Pool({ 
    connectionString: dbUrl.toString(),
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    console.log("Adding business_logo to users");
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS business_logo text;`);
    console.log("Success.");
  } catch (e: any) {
    console.error("Error adding business_logo:", e.message);
  }

  try {
    console.log("Adding intelligence_metadata to users");
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS intelligence_metadata jsonb DEFAULT '{}'::jsonb NOT NULL;`);
    console.log("Success.");
  } catch (e: any) {
    console.error("Error adding intelligence_metadata:", e.message);
  }

  try {
    console.log("Adding bant to leads");
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS bant jsonb DEFAULT '{}'::jsonb;`);
    console.log("Success.");
  } catch (e: any) {
    console.error("Error adding bant:", e.message);
  }

  console.log("All queries executed.");
  await pool.end();
  process.exit(0);
}

main().catch(console.error);
