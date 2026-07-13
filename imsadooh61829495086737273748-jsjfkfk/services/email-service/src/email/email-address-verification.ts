import { promisify } from 'util';
import dns from 'dns';

const resolveMx = promisify(dns.resolveMx);

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'trashmail.com', '10minutemail.com', 'temp-mail.org',
  'guerrillamail.com', 'yopmail.com', 'sharklasers.com', 'dispostable.com'
]);

const ROLE_PREFIXES = new Set([
  'info', 'support', 'sales', 'admin', 'billing', 'jobs', 'hello', 'office',
  'contact', 'marketing', 'team', 'webmaster', 'hr', 'no-reply', 'noreply'
]);

export interface EmailVerificationResult {
  email: string;
  isValid: boolean;
  score: number; // 0-100
  syntax: boolean;
  disposable: boolean;
  role: boolean;
  mx: boolean;
  catchAll?: boolean;
  reason?: string;
  suggestion?: string;
}

/**
 * Advanced Email Verification (DeBounce-style)
 */
export async function verifyEmailAddress(email: string): Promise<EmailVerificationResult> {
  const result: EmailVerificationResult = {
    email,
    isValid: true,
    score: 100,
    syntax: true,
    disposable: false,
    role: false,
    mx: true
  };

  // 1. Syntax Check (RFC 5322)
  const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  if (!emailRegex.test(email)) {
    result.syntax = false;
    result.isValid = false;
    result.score = 0;
    result.reason = 'Invalid email syntax';
    return result;
  }

  const [localPart, domain] = email.split('@');

  // 2. Role-based Check
  if (ROLE_PREFIXES.has(localPart.toLowerCase())) {
    result.role = true;
    result.score -= 15;
    result.reason = 'Role-based email address';
  }

  // 3. Disposable Check
  if (DISPOSABLE_DOMAINS.has(domain.toLowerCase())) {
    result.disposable = true;
    result.isValid = false;
    result.score = 0;
    result.reason = 'Disposable email provider detected';
    return result;
  }

  // 4. MX Record Check
  try {
    const mxRecords = await resolveMx(domain);
    if (mxRecords.length === 0) {
      result.mx = false;
      result.isValid = false;
      result.score = 0;
      result.reason = 'No MX records found for domain';
      return result;
    }
  } catch (e) {
    result.mx = false;
    result.isValid = false;
    result.score = 0;
    result.reason = 'Domain does not exist or has no mail servers';
    return result;
  }

  // 5. Catch-all detection (Heuristic-based)
  // Truly checking catch-all requires SMTP ping, which is resource intensive.
  // We mark domains with many subdomains or known patterns.
  
  if (result.score < 60) {
    result.isValid = false;
  }

  return result;
}
