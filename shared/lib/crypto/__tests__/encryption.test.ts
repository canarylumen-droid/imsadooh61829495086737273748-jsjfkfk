import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

describe('Encryption Module', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abc';
  });

  afterEach(() => {
    if (ORIGINAL_KEY) {
      process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a string correctly', async () => {
      const { encrypt, decrypt } = await import('../encryption.js');
      const original = 'sensitive-data-123';
      const encrypted = encrypt(original);
      expect(encrypted).not.toBe(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertext for the same plaintext (different IV)', async () => {
      const { encrypt } = await import('../encryption.js');
      const original = 'same-data';
      const result1 = encrypt(original);
      const result2 = encrypt(original);
      expect(result1).not.toBe(result2);
    });

    it('should handle empty string', async () => {
      const { encrypt, decrypt } = await import('../encryption.js');
      const encrypted = encrypt('');
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe('');
    });

    it('should handle special characters', async () => {
      const { encrypt, decrypt } = await import('../encryption.js');
      const special = '!@#$%^&*()_+-=[]{}|;:,.<>?~`"\n\t';
      const encrypted = encrypt(special);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(special);
    });
  });

  describe('encryptJSON and decryptToJSON', () => {
    it('should encrypt and decrypt JSON objects', async () => {
      const { encryptJSON, decryptToJSON } = await import('../encryption.js');
      const obj = { userId: '123', role: 'admin', scopes: ['read', 'write'] };
      const encrypted = encryptJSON(obj);
      expect(typeof encrypted).toBe('string');
      const decrypted = decryptToJSON(encrypted);
      expect(decrypted).toEqual(obj);
    });

    it('should throw on non-object decryption', async () => {
      const { encrypt, decryptToJSON } = await import('../encryption.js');
      const encrypted = encrypt('plain-string-not-json');
      expect(() => decryptToJSON(encrypted)).toThrow();
    });
  });

  describe('tryDecryptToJSON', () => {
    it('should return null on failure instead of throwing', async () => {
      const { tryDecryptToJSON } = await import('../encryption.js');
      const result = tryDecryptToJSON('invalid:format:data');
      expect(result).toBeNull();
    });
  });

  describe('generateEncryptionKey', () => {
    it('should generate a 64-character hex key', async () => {
      const { generateEncryptionKey } = await import('../encryption.js');
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(/^[0-9a-f]+$/.test(key)).toBe(true);
    });
  });

  describe('encryptState and decryptState', () => {
    it('should encrypt and decrypt OAuth state', async () => {
      const { encryptState, decryptState } = await import('../encryption.js');
      const state = `user-1:${Date.now()}`;
      const encrypted = encryptState(state);
      const decrypted = decryptState(encrypted, 600000);
      expect(decrypted.userId).toBe('user-1');
    });

    it('should reject expired state', async () => {
      const { encryptState, decryptState } = await import('../encryption.js');
      const state = `user-1:${Date.now() - 3600000}`;
      const encrypted = encryptState(state);
      const result = decryptState(encrypted, 1000);
      expect(result).toBeNull();
    });
  });
});
