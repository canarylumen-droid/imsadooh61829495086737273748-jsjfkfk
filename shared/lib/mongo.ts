import mongoose from "mongoose";

let connectionPromise: Promise<typeof mongoose> | null = null;

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
      serverSelectionTimeoutMS: 5000,
    });
  }

  return connectionPromise;
}
