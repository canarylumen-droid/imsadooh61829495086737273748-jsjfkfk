import type { RecoveryEmail } from "./mailbox.js";

const FILTER_PATTERNS = [
  /\b(one[-\s]?time|otp|verification|verify your|security code|auth code|2fa|two[-\s]?factor)\b/i,
  /\b(receipt|invoice|order confirmation|shipping|delivered|your order|payment received)\b/i,
  /\b(unsubscribe|newsletter|weekly digest|promotion|sale ends|special offer)\b/i,
  /\b(no[-\s]?reply|donotreply|do-not-reply|mailer-daemon)\b/i,
];

export function shouldFilterEmail(email: RecoveryEmail): { filtered: boolean; reason?: string } {
  const from = email.from || "";
  const haystack = `${from}\n${email.subject}\n${email.text.slice(0, 1000)}`;
  const matched = FILTER_PATTERNS.find((pattern) => pattern.test(haystack));
  if (matched) return { filtered: true, reason: matched.source };

  if (email.text.length < 12) {
    return { filtered: true, reason: "too_short" };
  }

  return { filtered: false };
}
