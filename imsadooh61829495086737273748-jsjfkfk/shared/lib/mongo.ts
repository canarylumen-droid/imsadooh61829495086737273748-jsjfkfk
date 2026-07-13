import mongoose from "mongoose";
import dns from "dns";

let connectionPromise: Promise<typeof mongoose> | null = null;

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export function hasMongoUri(): boolean {
  return Boolean(process.env.MONGODB_URI || process.env.MONGO_URL);
}

async function probeMongoDns(uri: string): Promise<void> {
  try {
    const srvMatch = uri.match(/^mongodb\+srv:\/\/(?:[^@]+@)?([^/?]+)/);
    if (srvMatch) {
      const hostname = srvMatch[1];
      const { address: resolvedIp } = await dns.promises.lookup(hostname).catch(() => ({ address: "" }));
      if (!resolvedIp) {
        const srvHost = `_mongodb._tcp.${hostname}`;
        const srvRecords = await dns.promises.resolveSrv(srvHost).catch(() => []);
        if (srvRecords.length === 0) {
          console.warn(`[MongoDB] ⚠️ DNS SRV lookup failed for ${srvHost}. SRV records are required for mongodb+srv:// connections.`);
          console.warn(`[MongoDB] 💡 Verify the cluster exists in MongoDB Atlas and this environment can resolve *.mongodb.net`);
        }
      }
    }
  } catch {
    // Probe failure is non-fatal - the actual connect will also fail with a clear error
  }
}

export async function connectMongo(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) {
    throw new Error("MONGODB_URI is required for Lead Recovery storage");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  // Probe DNS before connecting to provide better error messages for SRV issues
  probeMongoDns(uri).catch(err => console.warn('[MongoDB] DNS probe failed:', err.message));

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      autoIndex: process.env.NODE_ENV !== "production",
      serverSelectionTimeoutMS: readInt("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 15000),
      connectTimeoutMS: readInt("MONGODB_CONNECT_TIMEOUT_MS", 10000),
      socketTimeoutMS: readInt("MONGODB_SOCKET_TIMEOUT_MS", 30000),
    }).catch((err: any) => {
      connectionPromise = null;
      const msg = err?.message || String(err);
      if (msg.includes("ENOTFOUND") || msg.includes("querySrv")) {
        console.error(`[MongoDB] ❌ DNS resolution failed for MongoDB cluster. URI uses SRV format (mongodb+srv://). Error: ${msg}`);
        console.error(`[MongoDB] 💡 Ensure the cluster exists and DNS can resolve *.mongodb.net from this network.`);
        console.error(`[MongoDB] 💡 Try using a direct (non-SRV) connection string, or check the cluster name in MongoDB Atlas.`);
      }
      throw err;
    });
  }

  return connectionPromise;
}
