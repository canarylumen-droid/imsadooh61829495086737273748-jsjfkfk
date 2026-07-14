// shared/lib/security/secureRandomInt.ts
import { randomInt } from 'crypto';

/**
 * Returns a cryptographically secure random integer between min (inclusive) and max (exclusive).
 */
export function secureRandomInt(min: number, max: number): number {
  if (min >= max) {
    throw new Error('secureRandomInt: min must be less than max');
  }
  return randomInt(min, max);
}
