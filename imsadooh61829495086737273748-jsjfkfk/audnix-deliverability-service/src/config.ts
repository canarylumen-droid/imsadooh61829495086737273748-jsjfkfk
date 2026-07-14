import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  internalApiKey: process.env.INTERNAL_API_KEY || '',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:password@helium/heliumdb?sslmode=disable',
  },

  warmup: {
    url: process.env.WARMUP_SERVICE_URL || 'http://localhost:3001',
    apiKey: process.env.WARMUP_API_KEY || '',
  },

  webhook: {
    url: process.env.CORE_WEBHOOK_URL || 'http://localhost:5000/api/webhooks/deliverability',
    secret: process.env.CORE_WEBHOOK_SECRET || '',
  },

  postmaster: {
    apiKey: process.env.POSTMASTER_API_KEY || '',
    clientId: process.env.POSTMASTER_CLIENT_ID || '',
    clientSecret: process.env.POSTMASTER_CLIENT_SECRET || '',
    refreshToken: process.env.POSTMASTER_REFRESH_TOKEN || '',
  },

  snds: {
    clientId: process.env.SNDSS_CLIENT_ID || '',
    clientSecret: process.env.SNDSS_CLIENT_SECRET || '',
    tenantId: process.env.SNDSS_TENANT_ID || '',
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
    maxWaitMinutes: 120,
    cacheTtlMs: 60 * 60 * 1000,
  },
} as const;
