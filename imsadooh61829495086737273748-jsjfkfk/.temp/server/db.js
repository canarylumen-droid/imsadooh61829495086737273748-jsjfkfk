"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = exports.db = void 0;
exports.getDatabase = getDatabase;
const neon_serverless_1 = require("drizzle-orm/neon-serverless");
const serverless_1 = require("@neondatabase/serverless");
const schema = require("../shared/schema.js");
const ws_1 = require("ws");
// Configure neon to use ws for pooling in Node environments
serverless_1.neonConfig.webSocketConstructor = ws_1.default;
let _db = null;
let _pool = null;
function initializeDb() {
    if (_db)
        return { db: _db, pool: _pool };
    const url = process.env.DATABASE_URL;
    if (!url) {
        console.warn('⚠️ DATABASE_URL not set. Running in demo mode.');
        return { db: null, pool: null };
    }
    const connectionString = url;
    try {
        _pool = new serverless_1.Pool({
            connectionString,
        });
        _db = (0, neon_serverless_1.drizzle)(_pool, { schema });
        console.log('✅ PostgreSQL database connected (Neon Serverless compatibility restored)');
        return { db: _db, pool: _pool };
    }
    catch (error) {
        console.error('❌ Database connection failed:', error);
        return { db: null, pool: null };
    }
}
const result = initializeDb();
exports.db = result.db;
exports.pool = result.pool;
function getDatabase() {
    if (!_db)
        return initializeDb().db;
    return _db;
}
