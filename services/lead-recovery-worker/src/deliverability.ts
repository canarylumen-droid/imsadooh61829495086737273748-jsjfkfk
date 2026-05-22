import dns from "dns/promises";
import validator from "validator";

export type DeliverabilityStatus = "safe" | "risky" | "invalid" | "unknown";

export async function checkDeliverability(email: string): Promise<DeliverabilityStatus> {
  if (!validator.isEmail(email)) return "invalid";
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "invalid";

  try {
    const mx = await dns.resolveMx(domain);
    return mx.length > 0 ? "safe" : "risky";
  } catch {
    return "unknown";
  }
}
