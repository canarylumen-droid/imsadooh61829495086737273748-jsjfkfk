/**
 * Warmup Service DB
 * Reuses the shared Neon/Drizzle pool — but ONLY touches warmup_* tables.
 */

import { db } from '@shared/lib/db/db.js';
export { db };
