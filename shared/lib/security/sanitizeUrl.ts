import { URL } from 'url';

/**
 * Sanitize a URL string.
 * Throws an error if the URL is invalid, uses a non‑HTTPS protocol, or is not in the allowed whitelist.
 */
export function sanitizeUrl(input: string, allowedHosts: string[] = []): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch (e) {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  if (allowedHosts.length && !allowedHosts.includes(url.hostname)) {
    throw new Error(`Host ${url.hostname} is not allowed`);
  }

  return url.toString();
}
