import dotenv from 'dotenv';

dotenv.config({ path: new URL('../../../.env', import.meta.url) });
dotenv.config({ path: new URL('../.env', import.meta.url), override: true });

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  internalApiKey: process.env.INTERNAL_API_KEY || '',

  database: {
    url: process.env.DATABASE_URL || '',
  },

  warmup: {
    url: firstEnv('WARMUP_SERVICE_URL', 'WARMUP_INTERNAL_URL') || 'http://localhost:3101',
    apiKey: firstEnv('WARMUP_API_KEY', 'INTERNAL_API_KEY'),
  },

  webhook: {
    url: firstEnv('CORE_WEBHOOK_URL', 'DELIVERABILITY_WEBHOOK_URL') || 'http://localhost:5000/api/webhooks/deliverability',
    secret: firstEnv('CORE_WEBHOOK_SECRET', 'DELIVERABILITY_WEBHOOK_SECRET'),
  },

  postmaster: {
    apiKey: process.env.POSTMASTER_API_KEY || '',
    clientId: process.env.POSTMASTER_CLIENT_ID || '',
    clientSecret: process.env.POSTMASTER_CLIENT_SECRET || '',
    refreshToken: process.env.POSTMASTER_REFRESH_TOKEN || '',
  },

  snds: {
    clientId: firstEnv('SNDS_CLIENT_ID', 'SNDSS_CLIENT_ID'),
    clientSecret: firstEnv('SNDS_CLIENT_SECRET', 'SNDSS_CLIENT_SECRET'),
    tenantId: firstEnv('SNDS_TENANT_ID', 'SNDSS_TENANT_ID'),
  },

  intervals: {
    seedPoll: process.env.SEED_POLL_INTERVAL || '*/10 * * * *',
    postmasterPoll: process.env.POSTMASTER_POLL_INTERVAL || '0 6 * * *',
    sndsPoll: process.env.SNDS_POLL_INTERVAL || '0 7 * * *',
  },

  thresholds: {
    inboxRateWarn: parseFloat(process.env.INBOX_RATE_WARN || '0.85'),
    inboxRatePause: parseFloat(process.env.INBOX_RATE_PAUSE || '0.70'),
    postmasterSpamRateWarn: parseFloat(process.env.POSTMASTER_SPAM_RATE_WARN || '0.003'),
  },

  seedCheck: {
    maxWaitMinutes: parseInt(process.env.SEED_CHECK_MAX_WAIT_MINUTES || '120', 10),
    cacheTtlMs: parseInt(process.env.SEED_CACHE_TTL_MS || `${60 * 60 * 1000}`, 10),
  },

  imap: {
    rejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false',
  },
} as const;

export function validateConfig(): void {
  const missing: string[] = [];

  if (!config.database.url) missing.push('DATABASE_URL');

  if (config.nodeEnv === 'production') {
    if (!config.internalApiKey) missing.push('INTERNAL_API_KEY');
    if (!config.webhook.secret) missing.push('CORE_WEBHOOK_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}
