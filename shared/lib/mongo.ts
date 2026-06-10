import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | null = null;

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export function hasMongoUri(): boolean {
  return Boolean(process.env.MONGODB_URI || process.env.MONGO_URL);
}

export async function connectMongo(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri) {
    throw new Error("MONGODB_URI is required for Lead Recovery storage");
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      autoIndex: process.env.NODE_ENV !== "production",
      serverSelectionTimeoutMS: readInt("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 5000),
      connectTimeoutMS: readInt("MONGODB_CONNECT_TIMEOUT_MS", 5000),
      socketTimeoutMS: readInt("MONGODB_SOCKET_TIMEOUT_MS", 15000),
    }).catch((err) => {
      connectionPromise = null;
      throw err;
    });
  }

  return connectionPromise;
}
