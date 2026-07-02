/**
 * Validates if a string is a valid UUID
 */
export function isValidUUID(uuid: string | null | undefined): boolean {
  if (!uuid) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validates if a string is a valid URL
 */
export function isValidURL(link: string | null | undefined): boolean {
  if (!link) return false;
  try {
    const url = new URL(link.startsWith('http') ? link : `https://${link}`);
    // Basic sanity check: must have a hostname and look like a real URL
    return !!url.hostname && url.hostname.includes('.');
  } catch (e) {
    return false;
  }
}

/**
 * Checks if a given date falls on a weekend (Saturday or Sunday)
 */
export function isWeekend(date: Date = new Date()): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Adds business days to a date, skipping weekends.
 * If the result falls on a weekend, it advances to Monday.
 */
export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) {
      remaining--;
    }
  }
  return result;
}

/**
 * Returns the next business day from the given date.
 * If date is already a weekday, returns it unchanged.
 */
export function nextBusinessDay(date: Date = new Date()): Date {
  const result = new Date(date);
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}
