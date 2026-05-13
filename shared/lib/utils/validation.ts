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
