import { config } from '../config.js';

export interface WebhookPayload {
  campaignId: string;
  userId?: string;
  source: 'seed' | 'postmaster' | 'snds';
  inboxRate: number;
  spamRate: number;
  action: 'warn' | 'pause' | 'completed';
}

export async function notifyCore(payload: WebhookPayload): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.webhook.secret) {
      headers['X-Webhook-Secret'] = config.webhook.secret;
    }

    const res = await fetch(config.webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[Webhook] HTTP ${res.status} for ${payload.source} on ${payload.campaignId}`);
      return false;
    }

    console.log(`[Webhook] Sent ${payload.action} for campaign ${payload.campaignId} (${payload.source})`);
    return true;
  } catch (err: any) {
    console.warn(`[Webhook] Failed: ${err.message}`);
    return false;
  }
}

export interface SeedUpdatePayload {
  campaignId: string;
  testId: string;
  seedEmail: string;
  folder: string;
  provider: string;
  userId?: string;
}

export async function notifySeedUpdate(payload: SeedUpdatePayload): Promise<boolean> {
  try {
    const base = config.webhook.url.replace(/\/+$/, '');
    const url = base.endsWith('/deliverability') ? `${base}/seed-update` : `${base}/deliverability/seed-update`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.webhook.secret) {
      headers['X-Webhook-Secret'] = config.webhook.secret;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });

    return res.ok;
  } catch {
    return false;
  }
}
