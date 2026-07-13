import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get encryption key from environment
 * Falls back to SESSION_SECRET for development
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error("ENCRYPTION_KEY must be set in production - generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  }

  // Convert key to proper length buffer
  const hash = crypto.createHash("sha256").update(key).digest();
  return hash.slice(0, KEY_LENGTH);
}

/**
 * Encrypt data using AES-256-GCM
 * @param plaintext - Data to encrypt
 * @returns Encrypted data as hex string (iv:authTag:ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:ciphertext
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt data encrypted with encrypt()
 * @param ciphertext - Encrypted data (iv:authTag:ciphertext)
 * @returns Decrypted plaintext
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }
  
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

/**
 * Encrypt JSON object
 * @param obj - Object to encrypt
 * @returns Encrypted JSON as hex string
 */
export function encryptJSON(obj: any): string {
  return encrypt(JSON.stringify(obj));
}

/**
 * Decrypt JSON object
 * SECURITY: Safely parses decrypted JSON with error handling
 * @param ciphertext - Encrypted JSON
 * @returns Decrypted object
 */
export function decryptToJSON<T = any>(ciphertext: string): T {
  try {
    const decrypted = decrypt(ciphertext);
    const parsed = JSON.parse(decrypted);
    
    // Basic validation to prevent injection
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error("Decrypted data must be a valid JSON object");
    }
    
    return parsed as T;
  } catch (error: any) {
    throw new Error(`Data decryption failed: ${error.message}`);
  }
}

/**
 * Safely attempt to decrypt JSON without throwing
 */
export function tryDecryptToJSON<T = any>(ciphertext: string | null | undefined): T | null {
  if (!ciphertext) return null;
  try {
    return decryptToJSON<T>(ciphertext);
  } catch (err) {
    return null;
  }
}

/**
 * Generate a secure random encryption key
 * @returns 32-byte hex key suitable for ENCRYPTION_KEY
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
}

/**
 * Securely encrypt state data for OAuth flows
 * @param data - Data to encrypt in state parameter
 * @returns Encrypted state string
 */
export function encryptState(data: string): string {
  return encrypt(data);
}

/**
 * Securely decrypt state data from OAuth flows
 * @param state - Encrypted state parameter
 * @returns Decrypted data or null if invalid/expired
 */
export function decryptState(state: string, maxAgeMs: number = 10 * 60 * 1000): { userId: string; timestamp: number } | null {
  try {
    const decrypted = decrypt(state);
    const [userId, timestamp] = decrypted.split(":");
    
    // Check if state is within max age
    const age = Date.now() - parseInt(timestamp);
    if (age > maxAgeMs) {
      return null;
    }
    
    return { userId, timestamp: parseInt(timestamp) };
  } catch (error) {
    console.error('Failed to decrypt state:', error);
    return null;
  }
}
